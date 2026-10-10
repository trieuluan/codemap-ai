import { ConversationStore } from '../shared/conversation';
import { contextRegionKey } from '../shared/context';
import * as vscode from 'vscode';
import { randomUUID, createHash } from 'node:crypto';
import {
  aiPrompt,
  aiReferences,
  assertContextUnchanged,
  parseProposal,
  type AiHostMessage,
  type AiModelInfo,
  type AiProposal,
  type AiUiMessage,
} from '../shared/ai';
import type { ContextBundle } from '../shared/context';
import type { GraphSnapshot } from '../shared/model';

export interface AiSessionOptions {
  post: (message: AiHostMessage) => void;
  context: (rootId: string, contextId: string) => ContextBundle;
  graph: () => GraphSnapshot | undefined;
  afterApply: () => Promise<void>;
  log?: (message: string) => void;
  configuredModel?: () => string;
  selectModels?: (
    selector?: vscode.LanguageModelChatSelector,
  ) => Thenable<readonly vscode.LanguageModelChat[]>;
}

/** Owns requests and proposals in memory; model calls and edits never run in the webview. */
export class AiSession implements vscode.Disposable {
  private model?: vscode.LanguageModelChat;
  private active?: { id: string; cancellation: vscode.CancellationTokenSource };
  private proposal?: { value: AiProposal; bundle: ContextBundle };
  private conversations = new ConversationStore();
  private answers = new Map<
    string,
    { bundle: ContextBundle; text: string; references: ReturnType<typeof aiReferences> }
  >();
  private checking?: vscode.CancellationTokenSource;
  private previews = new Map<string, string>();
  private scheme = `codemap-ai-${randomUUID()}`;
  private provider: vscode.Disposable;
  private reviewed = new Set<string>();
  private applying = false;
  private disposed = false;
  constructor(private options: AiSessionOptions) {
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
  status(error?: string) {
    const model: AiModelInfo | undefined = this.model && {
      id: this.model.id,
      name: this.model.name,
      vendor: this.model.vendor,
      maxInputTokens: this.model.maxInputTokens,
    };
    this.options.post({ type: 'aiModel', model, configuredId: this.configuredId(), error });
  }
  private select(selector?: vscode.LanguageModelChatSelector) {
    return (this.options.selectModels ?? vscode.lm.selectChatModels)(selector);
  }
  async chooseModel() {
    try {
      const models = await this.select();
      if (this.disposed) {
        return;
      }
      if (!models.length) {
        throw new Error(
          'No VS Code models available. Enable a language model provider, sign in, then choose a model again.',
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
  invalidate() {
    this.cancel();
    this.proposal = undefined;

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
      case 'aiDiff':
        await this.diff(message.proposalId, message.fileId);
        break;
      case 'aiApply':
        await this.apply(message.proposalId);
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
          throw new Error('No response from model.');
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
  private async request(message: Extract<AiUiMessage, { type: 'aiRequest' }>) {
    this.invalidate();
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
        error,
      });
      this.answers.set(message.requestId, { bundle: context, text: answer, references });
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
        !['ask', 'propose'].includes(message.mode)
      ) {
        throw new Error('Enter a question of at most 8,000 characters.');
      }
      const bundle = this.options.context(message.rootId, message.contextId);
      context = bundle;
      if (!bundle.files.length) {
        throw new Error('Preview at least one file first.');
      }
      if (
        message.mode === 'propose' &&
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
              .filter((t) => !t.error)
              .slice(-4)
          : [];
      const prompt = vscode.LanguageModelChatMessage.User(
        aiPrompt(bundle, message.question, message.mode),
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
            text,
            done: false,
          });
          publishedAt = Date.now();
        }
      }
      if (!valid()) {
        return;
      }
      this.options.context(message.rootId, message.contextId);
      const proposal =
        message.mode === 'propose' ? parseProposal(text, bundle, randomUUID()) : undefined;
      if (proposal) {
        this.proposal = { value: proposal, bundle };
      }
      const references = proposal ? [] : aiReferences(text, bundle);
      remember(proposal ? proposal.summary : text, references);
      this.options.post({
        type: 'aiProgress',
        requestId: message.requestId,
        text: proposal ? proposal.summary : text,
        done: true,
        proposal,
        references,
      });
    } catch (error) {
      if (text) {
        remember(message.mode === 'ask' ? text : 'Proposal generation failed.', [], String(error));
      }
      if (this.active?.cancellation === cancellation) {
        this.options.post({
          type: 'aiProgress',
          requestId: message.requestId,
          text: message.mode === 'ask' ? text : '',
          done: true,
          error: String(error),
        });
      }
    } finally {
      if (!completed && text && message.mode === 'ask') {
        remember(text, [], 'Stopped before completion.');
      }
      if (this.active?.cancellation === cancellation) {
        this.active = undefined;
      }
      cancellation.dispose();
    }
  }
  async diff(proposalId: string, fileId: string) {
    const saved = this.proposal;
    const change =
      saved?.value.id === proposalId && saved.value.changes.find((c) => c.fileId === fileId);
    if (!saved || !change) {
      return;
    }
    const original = saved.bundle.files.find((f) => f.id === fileId)!;
    const uri = (side: string) =>
      vscode.Uri.from({ scheme: this.scheme, path: `/${proposalId}/${side}/${change.path}` });
    const before = uri('before'),
      after = uri('after');
    this.previews.set(before.toString(), original.content);
    this.previews.set(after.toString(), change.content);
    await vscode.commands.executeCommand(
      'vscode.diff',
      before,
      after,
      `CodeMap proposal · ${change.path}`,
      { viewColumn: vscode.ViewColumn.Beside, preview: true },
    );
    if (this.proposal === saved && !this.disposed) {
      this.reviewed.add(fileId);
      this.options.post({ type: 'aiDiffOpened', proposalId, fileId });
    }
  }
  async apply(proposalId: string) {
    if (this.applying) {
      return;
    }
    this.applying = true;
    try {
      const saved = this.proposal;
      const graph = this.options.graph();
      if (!saved || saved.value.id !== proposalId || !saved.value.changes.length) {
        throw new Error('Proposal no longer available. Generate a new proposal.');
      }
      if (saved.value.changes.some((c) => !this.reviewed.has(c.fileId))) {
        throw new Error('Review every proposed file diff before applying.');
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
      assertContextUnchanged(
        saved.bundle,
        new Map(documents.map((d) => [d.uri.toString(), d.getText()])),
      );
      if (
        this.disposed ||
        this.proposal !== saved ||
        this.options.graph()?.root.id !== saved.bundle.rootId
      ) {
        throw new Error('Proposal expired.');
      }
      const edit = new vscode.WorkspaceEdit();
      for (const change of saved.value.changes) {
        const document = documents.find((d) => d.uri.toString() === change.fileId)!;
        edit.replace(
          document.uri,
          new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
          change.content,
        );
      }
      if (!(await vscode.workspace.applyEdit(edit, { isRefactoring: true }))) {
        throw new Error('VS Code could not apply the edit.');
      }
      this.proposal = undefined;
      this.options.post({ type: 'aiApplied', proposalId });
      await this.options.afterApply();
    } catch (error) {
      this.options.post({ type: 'aiApplied', proposalId, error: String(error) });
    } finally {
      this.applying = false;
    }
  }
  dispose() {
    this.disposed = true;
    this.invalidate();
    this.answers.clear();
    this.provider.dispose();
  }
}
