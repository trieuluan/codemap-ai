import { modelUnavailableReason, emptyResponseMessage } from '../shared/ai-model';
import { EditConflict, editContent, prepareEdits } from '../shared/edits';
import { Verification } from './verification';
import type { TestRunner } from './test-runner';
import {
  actionCatalog,
  actionInstructions,
  parseAiActions,
  actionStillValid,
  type AiGraphAction,
} from '../shared/ai-actions';
import { ConversationStore } from '../shared/conversation';
import { contextRegionKey } from '../shared/context';
import * as vscode from 'vscode';
import { randomUUID, createHash } from 'node:crypto';
import {
  aiPrompt,
  aiReferences,
  parseProposal,
  type AiHostMessage,
  type AiModelInfo,
  type AiProposal,
  type AiUiMessage,
} from '../shared/ai';
import type { ContextBundle } from '../shared/context';
import type { GraphSnapshot } from '../shared/model';
import { parseCodingPlan, planPrompt, planEditScope, type CodingPlan } from '../shared/ai-plan';

export interface AiSessionOptions {
  testRunner?: TestRunner;
  post: (message: AiHostMessage) => void;
  context: (rootId: string, contextId: string) => ContextBundle;
  graph: () => GraphSnapshot | undefined;
  editableFiles?: () => string[] | undefined;
  afterApply: () => Promise<void>;
  previewGraph?: (
    texts: Map<string, string>,
    token: vscode.CancellationToken,
  ) => Promise<GraphSnapshot>;
  log?: (message: string) => void;
  isCurrent?: () => boolean;
  configuredModel?: () => string;
  selectModels?: (
    selector?: vscode.LanguageModelChatSelector,
  ) => Thenable<readonly vscode.LanguageModelChat[]>;
}

/** Owns requests and proposals in memory; model calls and edits never run in the webview. */
export class AiSession implements vscode.Disposable {
  private model?: vscode.LanguageModelChat;
  private active?: { id: string; cancellation: vscode.CancellationTokenSource };
  private proposal?: {
    value: AiProposal;
    bundle: ContextBundle;
    state: 'ready' | 'applied' | 'expired';
    appliedIds?: string[];
  };
  private verification: Verification;
  private conversations = new ConversationStore();
  private answers = new Map<
    string,
    {
      bundle: ContextBundle;
      text: string;
      references: ReturnType<typeof aiReferences>;
      actions: AiGraphAction[];
    }
  >();
  private checking?: vscode.CancellationTokenSource;
  private previews = new Map<string, string>();
  private scheme = `codemap-ai-${randomUUID()}`;
  private provider: vscode.Disposable;
  private reviewed = new Set<string>();
  private applying = false;
  private disposed = false;
  private plan?: { value: CodingPlan; bundle: ContextBundle };
  private previewRevision = 0;
  private previewCancellation?: vscode.CancellationTokenSource;
  constructor(private options: AiSessionOptions) {
    this.verification = new Verification(options.graph, options.post, options.testRunner);
    this.provider = vscode.workspace.registerTextDocumentContentProvider(this.scheme, {
      provideTextDocumentContent: (uri) => this.previews.get(uri.toString()) ?? '',
    });
  }
  private configuredId() {
    if (this.options.configuredModel) {
      return this.options.configuredModel();
    }
    return vscode.workspace.getConfiguration('codemap.ai').get<string>('model', '');
  }
  private assertEditable(ids: string[]) {
    const allowed = this.options.editableFiles?.();
    if (allowed && ids.some((id) => !allowed.includes(id))) {
      throw new Error(
        'Edit permission was removed. Adjust task permissions and generate a fresh proposal.',
      );
    }
  }
  status(error?: string) {
    const model: AiModelInfo | undefined = this.model && {
      id: this.model.id,
      name: this.model.name,
      vendor: this.model.vendor,
      maxInputTokens: this.model.maxInputTokens,
    };
    this.options.post({ type: 'aiModel', model, configuredId: this.configuredId(), error });
    this.publishProposal();
    this.verification.publish();
  }
  private select(selector?: vscode.LanguageModelChatSelector) {
    return (this.options.selectModels ?? vscode.lm.selectChatModels)(selector);
  }
  async chooseModel() {
    try {
      const listed = await this.select();
      const models = listed.filter((model) => !modelUnavailableReason(model));
      if (this.disposed) {
        return;
      }
      if (!models.length) {
        throw new Error(
          'No compatible VS Code chat models available. Copilot CLI entries cannot serve CodeMap requests. Enable/sign in to a compatible provider, then choose a model again.',
        );
      }
      const picked = await vscode.window.showQuickPick(
        models.map((model) => ({
          label: model.name,
          description: model.vendor,
          detail: model.id,
          model,
        })),
        {
          title: 'CodeMap · VS Code Models',
          placeHolder: 'Choose a model for reviewed CodeMap context',
        },
      );
      if (picked && !this.disposed) {
        this.cancel();
        this.model = picked.model;
        this.options.post({
          type: 'aiConnection',
          state: 'idle',
          message: 'Model selected. Test connection to verify access.',
        });
        await vscode.workspace
          .getConfiguration('codemap.ai')
          .update('model', picked.model.id, vscode.ConfigurationTarget.Global);
      }
      this.status();
    } catch (error) {
      this.status(String(error));
    }
  }
  cancel() {
    this.previewRevision++;
    this.previewCancellation?.cancel();
    this.previewCancellation?.dispose();
    this.previewCancellation = undefined;
    if (this.checking) {
      this.options.post({
        type: 'aiConnection',
        state: 'error',
        message: 'Connection check stopped.',
      });
      this.checking.cancel();
      this.checking.dispose();
      this.checking = undefined;
    }
    const active = this.active;
    this.active = undefined;
    if (active) {
      active.cancellation.cancel();
      active.cancellation.dispose();
      this.options.post({
        type: 'aiProgress',
        requestId: active.id,
        text: '',
        done: true,
        error: 'Request stopped.',
      });
    }
  }
  graphChanged(outOfDate = false) {
    if (outOfDate) {
      this.verification.changed();
    } else {
      this.verification.publish();
    }
  }
  private publishProposal() {
    const saved = this.proposal;
    if (saved) {
      this.options.post({
        type: 'aiProposalState',
        rootId: saved.bundle.rootId,
        regionKey:
          saved.bundle.regionKey ??
          contextRegionKey(
            saved.bundle.rootId,
            saved.bundle.files.map((f) => f.id),
          ),
        proposal: saved.value,
        state: saved.state,
        appliedIds: saved.appliedIds,
        reviewed: [...this.reviewed],
      });
    }
  }
  invalidate() {
    this.plan = undefined;
    this.previewRevision++;
    this.cancel();
    if (this.proposal) {
      this.proposal.state = 'expired';
      this.publishProposal();
    }
    this.proposal = undefined;
    this.verification.reset();

    this.previews.clear();
    this.reviewed.clear();
  }
  async handle(message: AiUiMessage) {
    if (this.disposed) {
      return;
    }
    switch (message.type) {
      case 'aiStatus':
        this.status();
        break;
      case 'aiChooseModel':
        await this.chooseModel();
        break;
      case 'aiCancel':
        this.cancel();
        break;
      case 'aiTestConnection':
        await this.testConnection();
        break;
      case 'aiHistory':
      case 'aiClearHistory': {
        if (message.rootId !== this.options.graph()?.root.id) {
          return;
        }
        let key: unknown;
        try {
          key = JSON.parse(message.regionKey);
        } catch {
          return;
        }
        if (!Array.isArray(key) || key[0] !== message.rootId) {
          return;
        }
        if (message.type === 'aiClearHistory') {
          this.conversations.clear(message.regionKey);
          this.pruneAnswers();
        }
        this.options.post({
          type: 'aiConversation',
          regionKey: message.regionKey,
          turns: this.conversations.get(message.regionKey),
        });
        break;
      }
      case 'aiExecuteAction': {
        const saved = this.answers.get(message.requestId);
        const graph = this.options.graph();
        const action = saved?.actions.find((a) => a.id === message.actionId);
        const key =
          saved &&
          (saved.bundle.regionKey ??
            contextRegionKey(
              saved.bundle.rootId,
              saved.bundle.files.map((f) => f.id),
            ));
        if (
          this.options.isCurrent?.() === false ||
          !saved ||
          !graph ||
          !action ||
          graph.root.id !== message.rootId ||
          saved.bundle.rootId !== message.rootId ||
          key !== message.regionKey ||
          graph.revision !== saved.bundle.revision ||
          !actionStillValid(action, graph)
        ) {
          this.options.post({
            type: 'aiActionError',
            requestId: message.requestId,
            message:
              'Suggestion expired or is outside the current region. Ask again with fresh context.',
          });
          break;
        }
        if (action.kind === 'addContext') {
          const region = JSON.parse(key!) as [string, string[], string];
          const ids = [...new Set([...region[1], ...action.targets.map((t) => t.fileId)])];
          if (ids.length > 50) {
            this.options.post({
              type: 'aiActionError',
              requestId: message.requestId,
              message: 'Context supports at most 50 files. Remove some files before adding more.',
            });
            break;
          }
          const focused = action.targets.find((t) => t.symbol);
          const declaration =
            focused &&
            graph.nodes
              .find((n) => n.id === focused.fileId)
              ?.declarations?.find((s) => s.id === focused.symbol!.id);
          const nextKey = contextRegionKey(
            graph.root.id,
            ids,
            declaration && focused
              ? `${focused.fileId}:${declaration.kind}:${declaration.name}`
              : region[2],
          );
          if (nextKey !== key) {
            for (const turn of [...this.conversations.get(key!)]) {
              this.conversations.add(nextKey, {
                ...turn,
                actions: [],
                actionWarnings: turn.actions?.length
                  ? ['Context expanded. Ask again for suggestions using the new selection.']
                  : turn.actionWarnings,
              });
            }
            this.pruneAnswers();
          }
        }
        // Only approved IDs from an archived answer can reach the graph UI.
        this.options.post({
          type: 'aiAction',
          rootId: graph.root.id,
          revision: graph.revision,
          requestId: message.requestId,
          regionKey: message.regionKey,
          action,
        });
        break;
      }
      case 'aiCopy': {
        const answer = this.answers.get(message.requestId);
        if (
          answer &&
          answer.bundle.rootId === this.options.graph()?.root.id &&
          message.text &&
          answer.text.includes(message.text)
        ) {
          await vscode.env.clipboard.writeText(message.text);
          this.options.post({ type: 'aiCopied', requestId: message.requestId });
        }
        break;
      }
      case 'aiRequest':
        await this.request(message);
        break;
      case 'aiRunTest':
        await this.verification.test(message.reportId, message.save);
        break;
      case 'aiOpenDiagnostic':
        await this.verification.openDiagnostic(message.reportId, message.index);
        break;
      case 'aiStopTest':
        this.verification.stop();
        break;
      case 'aiDiff':
        await this.diff(message.proposalId, message.fileId, message.changeId);
        break;
      case 'aiApply':
        await this.apply(message.proposalId, message.changeIds);
        break;
      case 'aiPreviewGraph':
        await this.previewGraph(message.proposalId, message.changeIds);
        break;
      case 'aiOpenReference': {
        const refs = this.answers.get(message.requestId);
        const ref =
          refs &&
          refs.references.find((r) => r.fileId === message.fileId && r.line === message.line);
        if (!ref || !this.options.graph()?.nodes.some((f) => f.id === ref.fileId)) {
          return;
        }
        const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(ref.fileId));
        const original = refs!.bundle.files.find((f) => f.id === ref.fileId)!;
        if (
          original.sourceDigest
            ? createHash('sha256').update(document.getText()).digest('hex') !==
              original.sourceDigest
            : !document.getText().startsWith(original.content)
        ) {
          throw new Error('Citation source changed. Ask again with fresh context.');
        }
        const pos = new vscode.Position(ref.line - 1, 0);
        await vscode.window.showTextDocument(document, {
          viewColumn: vscode.ViewColumn.Beside,
          selection: new vscode.Range(pos, pos),
          preview: true,
        });
        break;
      }
    }
  }
  private pruneAnswers() {
    for (const id of this.answers.keys()) {
      if (!this.conversations.has(id)) {
        this.answers.delete(id);
      }
    }
  }
  private async resolveModel() {
    const id = this.configuredId();
    if (!this.model || (id && this.model.id !== id)) {
      if (!id) {
        throw new Error('Choose a VS Code model first.');
      }
      this.model = (await this.select({ id })).find((m) => m.id === id);
    }
    if (!this.model) {
      throw new Error('Selected model is unavailable. Choose another model.');
    }
    const issue = modelUnavailableReason(this.model);
    if (issue) {
      this.status(issue);
      throw new Error(issue);
    }
    return this.model;
  }
  async testConnection() {
    this.cancel();
    const cancellation = new vscode.CancellationTokenSource();
    this.checking = cancellation;
    const timer = setTimeout(() => cancellation.cancel(), 20000);
    this.options.post({
      type: 'aiConnection',
      state: 'checking',
      message: 'Testing model with a source-free request…',
    });
    const start = Date.now();
    try {
      let cancelListener: vscode.Disposable | undefined;
      const stopped = new Promise<never>((_, reject) => {
        cancelListener = cancellation.token.onCancellationRequested(() =>
          reject(new Error('Connection check stopped or timed out.')),
        );
      });
      const check = async () => {
        const model = await this.resolveModel();
        if (cancellation.token.isCancellationRequested) {
          throw new Error('Connection check stopped or timed out.');
        }
        const response = await model.sendRequest(
          [vscode.LanguageModelChatMessage.User('Connection check. Reply with CODEMAP_OK only.')],
          {},
          cancellation.token,
        );
        let result = '';
        for await (const chunk of response.text) {
          if (cancellation.token.isCancellationRequested) {
            throw new Error('Connection check stopped or timed out.');
          }
          result += chunk;
          if (result.length > 1000) {
            throw new Error('Unexpected connection-check response.');
          }
        }
        if (!result.trim()) {
          throw new Error(emptyResponseMessage(model.name));
        }
        return model;
      };
      const model = await Promise.race([check(), stopped]).finally(() => cancelListener?.dispose());
      if (this.checking !== cancellation || this.disposed) {
        return false;
      }
      this.status();
      this.options.post({
        type: 'aiConnection',
        state: 'ready',
        message: `${model.name} responded in ${Date.now() - start} ms. No source was sent.`,
        checkedAt: new Date().toISOString(),
      });
      this.options.log?.(
        `AI connection OK: ${model.vendor}, ${Date.now() - start} ms; source-free request`,
      );
      return true;
    } catch (error) {
      if (this.checking === cancellation && !this.disposed) {
        const code = error instanceof vscode.LanguageModelError ? error.code : 'connection';
        this.options.post({
          type: 'aiConnection',
          state: 'error',
          code,
          message: String(error).slice(0, 2000),
        });
        this.options.log?.(`AI connection failed: ${code}; source-free request`);
      }
      return false;
    } finally {
      clearTimeout(timer);
      if (this.checking === cancellation) {
        this.checking = undefined;
      }
      cancellation.dispose();
    }
  }
  private async validateSource(bundle: ContextBundle, expected?: Map<string, string>) {
    const documents = await Promise.all(
      bundle.files.map((f) => vscode.workspace.openTextDocument(vscode.Uri.parse(f.id))),
    );
    const digests = new Map<string, string>();
    for (const [index, file] of bundle.files.entries()) {
      const current = documents[index].getText();
      const digest = createHash('sha256').update(current).digest('hex');
      const expectedDigest = expected?.get(file.id) ?? file.sourceDigest;
      if (
        expectedDigest
          ? digest !== expectedDigest
          : !file.excerpted &&
            (file.truncated ? !current.startsWith(file.content) : current !== file.content)
      ) {
        throw new Error(
          'Source changed while preparing or receiving the response. Review fresh context and retry.',
        );
      }
      digests.set(file.id, digest);
    }
    return digests;
  }
  private async request(message: Extract<AiUiMessage, { type: 'aiRequest' }>) {
    this.cancel();
    if (this.proposal) {
      this.proposal.state = 'expired';
      this.publishProposal();
    }
    this.proposal = undefined;
    this.previews.clear();
    this.reviewed.clear();
    const cancellation = new vscode.CancellationTokenSource();
    this.active = { id: message.requestId, cancellation };
    const valid = () =>
      !this.disposed &&
      this.active?.cancellation === cancellation &&
      !cancellation.token.isCancellationRequested;
    let text = '';
    let context: ContextBundle | undefined;
    let completed = false;
    const remember = (
      answer: string,
      references: ReturnType<typeof aiReferences>,
      error?: string,
      actions: AiGraphAction[] = [],
      actionWarnings: string[] = [],
    ) => {
      if (!context || this.disposed) {
        return;
      }
      const key =
        context.regionKey ??
        contextRegionKey(
          context.rootId,
          context.files.map((f) => f.id),
        );
      this.conversations.add(key, {
        id: message.requestId,
        question: message.question,
        answer,
        revision: context.revision,
        model: this.model?.name ?? '',
        createdAt: new Date().toISOString(),
        references,
        actions,
        actionWarnings,
        error,
      });
      this.answers.set(message.requestId, { bundle: context, text: answer, references, actions });
      this.pruneAnswers();
      this.options.post({
        type: 'aiConversation',
        regionKey: key,
        turns: this.conversations.get(key),
      });
      completed = true;
    };
    try {
      if (!vscode.workspace.isTrusted) {
        throw new Error('Trust the workspace before sending source to AI.');
      }
      if (
        typeof message.question !== 'string' ||
        !message.question.trim() ||
        message.question.length > 8000 ||
        !['ask', 'propose', 'plan'].includes(message.mode)
      ) {
        throw new Error('Enter a question of at most 8,000 characters.');
      }
      const bundle = this.options.context(message.rootId, message.contextId);
      context = bundle;
      let editable = message.editableFileIds ?? bundle.files.map((f) => f.id);
      const permissions = this.options.editableFiles?.();
      if (permissions) {
        editable = editable.filter((id) => permissions.includes(id));
      }
      if (editable.some((id) => !bundle.files.some((f) => f.id === id))) {
        throw new Error('Editable files must be included in source context.');
      }
      if (message.mode === 'plan' && !editable.length) {
        throw new Error('Allow at least one file to be edited before planning.');
      }
      let approvedPlan = '';
      if (message.mode === 'propose' && message.planId) {
        const saved = this.plan;
        if (
          !saved ||
          saved.value.id !== message.planId ||
          saved.bundle.rootId !== bundle.rootId ||
          saved.bundle.revision !== bundle.revision ||
          saved.bundle.files.some(
            (f) => bundle.files.find((n) => n.id === f.id)?.content !== f.content,
          )
        ) {
          throw new Error('Plan expired or source changed. Create a fresh plan.');
        }
        const scope = planEditScope(saved.value, message.planStepIds ?? []);
        if (scope.some((id) => !editable.includes(id))) {
          throw new Error('Plan includes files no longer allowed for editing.');
        }
        editable = scope;
        approvedPlan =
          '\n\nApproved plan steps (data):\n' +
          JSON.stringify(saved.value.steps.filter((s) => message.planStepIds?.includes(s.id)));
      }
      if (message.mode === 'propose' && !editable.length) {
        throw new Error('No editable files selected.');
      }
      if (!bundle.files.length) {
        throw new Error('Preview at least one file first.');
      }
      if (
        message.mode !== 'ask' &&
        (bundle.warnings.length || bundle.files.some((f) => f.truncated || f.excerpted))
      ) {
        throw new Error(
          'Changes require complete context with no warnings. Narrow the selection and preview again.',
        );
      }
      const model = await this.resolveModel();
      if (!valid()) {
        return;
      }
      this.status();
      const key =
        bundle.regionKey ??
        contextRegionKey(
          bundle.rootId,
          bundle.files.map((f) => f.id),
        );
      const history =
        message.mode === 'ask'
          ? this.conversations
              .get(key)
              .filter((t) => !t.error && t.answer.trim())
              .slice(-4)
          : [];
      const graph = this.options.graph();
      const catalog =
        message.mode === 'ask' &&
        graph?.root.id === bundle.rootId &&
        graph.revision === bundle.revision
          ? actionCatalog(graph, bundle)
          : undefined;
      const prompt = vscode.LanguageModelChatMessage.User(
        aiPrompt(bundle, message.question, message.mode) +
          (message.mode === 'plan' ? '\n\n' + planPrompt(editable, bundle) : '') +
          (message.mode === 'propose'
            ? '\n\nEdit only these paths (other source is read-only): ' +
              JSON.stringify(
                bundle.files.filter((f) => editable.includes(f.id)).map((f) => f.path),
              ) +
              approvedPlan
            : '') +
          (catalog ? '\n\n' + actionInstructions(catalog) : '') +
          (message.verificationId
            ? '\n\n' + this.verification.context(message.verificationId, message.rootId)
            : ''),
      );
      const messages = history.flatMap((turn) => [
        vscode.LanguageModelChatMessage.User(turn.question),
        vscode.LanguageModelChatMessage.Assistant(turn.answer),
      ]);
      messages.push(prompt);
      const count = async () => {
        let tokens = 0;
        for (const item of messages) {
          tokens += await model.countTokens(item, cancellation.token);
        }
        return tokens;
      };
      let tokens = await count();
      while (tokens > Math.max(0, model.maxInputTokens - 1024) && messages.length > 1) {
        messages.splice(0, 2);
        tokens = await count();
      }
      if (!valid()) {
        return;
      }
      if (tokens > Math.max(0, model.maxInputTokens - 1024)) {
        throw new Error(
          `Context exceeds ${model.name}'s input budget. Select fewer files and preview again.`,
        );
      }
      this.options.post({
        type: 'aiUsage',
        requestId: message.requestId,
        inputTokens: tokens,
        maxInputTokens: model.maxInputTokens,
        historyTurns: (messages.length - 1) / 2,
      });
      // Preview may become stale while authorization or token counting is pending.
      this.options.context(message.rootId, message.contextId);
      const requestSource = await this.validateSource(bundle);
      if (!valid()) {
        return;
      }
      const response = await model.sendRequest(messages, {}, cancellation.token);
      let publishedAt = 0;
      for await (const part of response.text) {
        if (!valid()) {
          return;
        }
        text += part;
        if (text.length > 250000) {
          cancellation.cancel();
          throw new Error('Response too large. Ask for a smaller change.');
        }
        if (message.mode === 'ask' && Date.now() - publishedAt >= 50) {
          this.options.post({
            type: 'aiProgress',
            requestId: message.requestId,
            text:
              message.mode === 'ask'
                ? text.replace(/^```codemap-actions[\s\S]*$/m, '').trimEnd()
                : text,
            done: false,
          });
          publishedAt = Date.now();
        }
      }
      if (!valid()) {
        return;
      }
      if (!text.trim()) {
        throw new Error(emptyResponseMessage(model.name));
      }
      await this.validateSource(bundle, requestSource);
      if (!valid()) {
        return;
      }
      this.options.context(message.rootId, message.contextId);
      const proposal =
        message.mode === 'propose' ? parseProposal(text, bundle, randomUUID()) : undefined;
      if (proposal?.changes.some((c) => !editable.includes(c.fileId))) {
        throw new Error(
          'Model attempted to edit read-only source. Nothing applied; adjust the plan and try again.',
        );
      }
      if (proposal) {
        this.assertEditable(proposal.changes.map((c) => c.fileId));
      }
      const currentGraph = this.options.graph();
      const plan =
        message.mode === 'plan' && currentGraph
          ? parseCodingPlan(text, bundle, currentGraph, editable, randomUUID())
          : undefined;
      if (message.mode === 'plan' && !plan) {
        throw new Error('Graph is no longer available.');
      }
      if (plan) {
        this.assertEditable(
          plan.steps.filter((step) => step.role === 'edit').map((step) => step.fileId),
        );
        this.plan = { value: plan, bundle };
      }
      if (proposal) {
        this.proposal = { value: proposal, bundle, state: 'ready' };
        this.publishProposal();
      }
      const parsed =
        catalog && graph
          ? parseAiActions(text, graph, catalog)
          : { answer: text, actions: [], warnings: [] };
      const answer = plan ? plan.summary : proposal ? proposal.summary : parsed.answer;
      const references = proposal ? [] : aiReferences(answer, bundle);
      remember(answer, references, undefined, proposal ? [] : parsed.actions, parsed.warnings);
      this.options.post({
        type: 'aiProgress',
        requestId: message.requestId,
        text: answer,
        done: true,
        proposal,
        plan,
        references,
      });
    } catch (error) {
      if (text.trim()) {
        remember(message.mode === 'ask' ? text : 'Proposal generation failed.', [], String(error));
      }
      if (this.active?.cancellation === cancellation) {
        this.options.post({ type: 'aiConnection', state: 'error', message: String(error) });
        this.options.log?.(
          `AI request failed: ${this.model?.vendor ?? 'unavailable'}; ${error instanceof vscode.LanguageModelError ? error.code : 'request'}; receivedText=${!!text.trim()}`,
        );
        this.options.post({
          type: 'aiProgress',
          requestId: message.requestId,
          text: message.mode === 'ask' ? text : '',
          done: true,
          error: String(error),
        });
      }
    } finally {
      if (!completed && text.trim() && message.mode === 'ask') {
        remember(text, [], 'Stopped before completion.');
      }
      if (this.active?.cancellation === cancellation) {
        this.active = undefined;
      }
      cancellation.dispose();
    }
  }
  private async previewGraph(proposalId: string, ids: string[]) {
    this.previewCancellation?.cancel();
    this.previewCancellation?.dispose();
    const cancellation = new vscode.CancellationTokenSource();
    this.previewCancellation = cancellation;
    const job = ++this.previewRevision;
    const saved = this.proposal,
      before = this.options.graph();
    try {
      if (
        !saved ||
        saved.value.id !== proposalId ||
        saved.state !== 'ready' ||
        !before ||
        before.root.id !== saved.bundle.rootId ||
        this.options.isCurrent?.() === false ||
        !this.options.previewGraph
      ) {
        throw new Error('A current proposal is required to preview its graph.');
      }
      const current = new Map<string, string>();
      for (const file of saved.bundle.files) {
        current.set(
          file.id,
          (await vscode.workspace.openTextDocument(vscode.Uri.parse(file.id))).getText(),
        );
      }
      const edits = prepareEdits(saved.value, saved.bundle, ids, current);
      this.assertEditable(edits.map((c) => c.fileId));
      const texts = new Map<string, string>();
      for (const id of new Set(edits.map((e) => e.fileId))) {
        texts.set(
          id,
          editContent(
            current.get(id)!,
            edits.filter((e) => e.fileId === id),
          ),
        );
      }
      const proposed = await this.options.previewGraph(texts, cancellation.token);
      if (this.disposed || job !== this.previewRevision || this.proposal !== saved) {
        return;
      }
      if (
        this.options.graph()?.revision !== before.revision ||
        this.options.graph()?.root.id !== before.root.id ||
        this.options.isCurrent?.() === false
      ) {
        throw new Error('Source changed during graph preview. Preview again.');
      }
      for (const [id, text] of current) {
        if ((await vscode.workspace.openTextDocument(vscode.Uri.parse(id))).getText() !== text) {
          throw new Error('Source changed during graph preview. Preview again.');
        }
      }
      this.options.post({ type: 'aiGraphPreview', proposalId, before, proposed, changeIds: ids });
    } catch (error) {
      if (!this.disposed && job === this.previewRevision) {
        this.options.post({ type: 'aiGraphPreviewError', proposalId, message: String(error) });
      }
    } finally {
      if (this.previewCancellation === cancellation) {
        this.previewCancellation = undefined;
      }
      cancellation.dispose();
    }
  }
  async diff(proposalId: string, fileId: string, changeId?: string) {
    const saved = this.proposal;
    const change =
      saved?.value.id === proposalId && saved.value.changes.find((c) => c.fileId === fileId);
    if (!saved || !change || saved.state !== 'ready') {
      return;
    }
    const changes = saved.value.changes.filter(
      (c) => c.fileId === fileId && (!changeId || c.id === changeId),
    );
    if (!changes.length) {
      return;
    }
    const original = saved.bundle.files.find((f) => f.id === fileId)!;
    const uri = (side: string) =>
      vscode.Uri.from({
        scheme: this.scheme,
        path: `/${proposalId}/${changeId ?? 'all'}/${side}/${change.path}`,
      });
    const before = uri('before'),
      after = uri('after');
    this.previews.set(before.toString(), original.content);
    this.previews.set(after.toString(), editContent(original.content, changes));
    await vscode.commands.executeCommand(
      'vscode.diff',
      before,
      after,
      `CodeMap proposal · ${change.path}`,
      { viewColumn: vscode.ViewColumn.Beside, preview: true },
    );
    if (this.proposal === saved && !this.disposed) {
      changes.forEach((c) => this.reviewed.add(c.id));
      this.options.post({
        type: 'aiDiffOpened',
        proposalId,
        fileId,
        changeIds: changes.map((c) => c.id),
      });
      this.publishProposal();
    }
  }
  async apply(proposalId: string, changeIds?: string[]) {
    if (this.applying) {
      return;
    }
    this.applying = true;
    try {
      const saved = this.proposal;
      const graph = this.options.graph();
      if (
        !saved ||
        saved.value.id !== proposalId ||
        !saved.value.changes.length ||
        saved.state !== 'ready'
      ) {
        throw new Error('Proposal no longer available. Generate a new proposal.');
      }
      if (this.verification.isRunning) {
        throw new Error('Stop the running project test before applying more changes.');
      }
      const ids = changeIds ?? saved.value.changes.map((c) => c.id);
      if (ids.some((id) => !this.reviewed.has(id))) {
        throw new Error('Review every accepted change diff before applying.');
      }
      if (
        !vscode.workspace.isTrusted ||
        graph?.root.id !== saved.bundle.rootId ||
        saved.bundle.files.some((f) => !graph.nodes.some((n) => n.id === f.id))
      ) {
        throw new Error('Workspace changed. Preview fresh context.');
      }
      const documents = await Promise.all(
        saved.bundle.files.map((f) => vscode.workspace.openTextDocument(vscode.Uri.parse(f.id))),
      );
      // No awaits between comparing current buffers and submitting the edit.
      const changes = prepareEdits(
        saved.value,
        saved.bundle,
        ids,
        new Map(documents.map((d) => [d.uri.toString(), d.getText()])),
      );
      this.assertEditable(changes.map((c) => c.fileId));
      if (
        this.disposed ||
        this.proposal !== saved ||
        this.options.graph()?.root.id !== saved.bundle.rootId
      ) {
        throw new Error('Proposal expired.');
      }
      const edit = new vscode.WorkspaceEdit();
      const diagnostics = this.verification.diagnostics(graph);
      for (const change of changes) {
        const document = documents.find((d) => d.uri.toString() === change.fileId)!;
        edit.replace(
          document.uri,
          new vscode.Range(
            document.positionAt(change.startOffset),
            document.positionAt(change.endOffset),
          ),
          change.content,
        );
      }
      if (!(await vscode.workspace.applyEdit(edit, { isRefactoring: true }))) {
        throw new Error('VS Code could not apply the edit.');
      }
      saved.state = 'applied';
      saved.appliedIds = ids;
      this.publishProposal();
      this.options.post({ type: 'aiApplied', proposalId });
      // Apply succeeded even if the following graph refresh fails.
      try {
        await this.verification.observe(
          graph!,
          diagnostics,
          proposalId,
          [...new Set(changes.map((c) => c.fileId))],
          this.options.afterApply,
        );
      } catch (error) {
        this.options.log?.(`Post-Apply verification failed: ${String(error)}`);
      }
    } catch (error) {
      this.options.post({
        type: 'aiApplied',
        proposalId,
        error: String(error),
        ...(error instanceof EditConflict
          ? { conflict: { fileId: error.fileId, changeId: error.changeId } }
          : {}),
      });
    } finally {
      this.applying = false;
    }
  }
  dispose() {
    this.disposed = true;
    this.invalidate();
    this.answers.clear();
    this.provider.dispose();
    this.verification.dispose();
  }
}
