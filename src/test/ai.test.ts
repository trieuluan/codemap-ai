import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { AiSession } from '../ai/session';
import { liveWorkflow } from '../ai/workflow-check';
import { buildContext, contextRegionKey } from '../shared/context';
import type { AiHostMessage } from '../shared/ai';
import { scanWorkspace } from '../workspace';

suite('CodeMap AI integration (fake model, no network)', () => {
  const fixture = async () => {
    const graph = await scanWorkspace(
      vscode.workspace.workspaceFolders![0],
      new vscode.CancellationTokenSource().token,
      () => {},
    );
    const bundle = await buildContext(
      graph,
      graph.nodes.map((n) => n.id),
      [],
      async (id) => (await vscode.workspace.openTextDocument(vscode.Uri.parse(id))).getText(),
    );
    return { graph, bundle };
  };
  function model(
    text: string,
    extra: Partial<vscode.LanguageModelChat> = {},
  ): vscode.LanguageModelChat {
    return {
      id: 'codemap-test',
      name: 'Test model',
      vendor: 'test',
      family: 'test',
      version: '1',
      maxInputTokens: 20000,
      countTokens: async () => 100,
      sendRequest: async () => ({
        text: (async function* () {
          yield text;
        })(),
        stream: (async function* () {})(),
      }),
      ...extra,
    };
  }
  test('synthetic workflow verifies single/multiple edits and report-backed repair with actual tasks', async function () {
    this.timeout(20000);
    const plan = (paths: string[]) =>
      JSON.stringify({
        summary: 'Fixture plan',
        steps: paths.map((path) => ({ path, role: 'edit', reason: 'Follow fixture goal' })),
      });
    const change = (path: string, oldText: string, content: string) => ({
      path,
      start: { line: 1, character: 0 },
      end: { line: 1, character: oldText.length },
      oldText,
      content,
      reason: 'Fixture edit',
    });
    const replies = [
      plan(['a.ts']),
      JSON.stringify({
        summary: 'Single file',
        changes: [
          {
            path: 'a.ts',
            start: { line: 1, character: 0 },
            end: { line: 3, character: 0 },
            oldText: 'import { value } from "./b";\nexport const result = value;\n',
            content: 'export const result = 42;\n',
            reason: 'Fixture edit',
          },
        ],
      }),
      plan(['a.ts', 'b.ts']),
      JSON.stringify({
        summary: 'Multiple files',
        changes: [
          change('a.ts', 'export const result = 42;', 'export const result = 43;'),
          change('b.ts', 'export const value = 1;', 'export const value = 2;'),
        ],
      }),
      plan(['b.ts']),
      JSON.stringify({
        summary: 'Repair test',
        changes: [change('b.ts', 'export const value = 2;', 'export const value = 3;')],
      }),
    ];
    let calls = 0;
    const current = vscode.window.activeTextEditor;
    const response = await liveWorkflow(
      model('', {
        sendRequest: async (messages) => {
          if (calls >= 4) {
            const prompt = messages
              .flatMap((m) => m.content)
              .filter(
                (c): c is vscode.LanguageModelTextPart => c instanceof vscode.LanguageModelTextPart,
              )
              .map((c) => c.value)
              .join('\n');
            assert.match(prompt, /BEGIN UNTRUSTED VERIFICATION/);
            assert.match(prompt, /b.ts must export value = 3/);
          }
          const reply = replies[calls++];
          assert.ok(reply, 'No unexpected provider calls');
          return {
            text: (async function* () {
              yield reply;
            })(),
            stream: (async function* () {})(),
          };
        },
      }),
    );
    assert.equal(response.status, 'passed', JSON.stringify(response));
    assert.equal(calls, 6);
    assert.equal(response.workspaceSourceSent, false);
    assert.equal((response.steps as { status: string }[]).length, 6);
    if (current) {
      assert.ok(!current.document.isClosed, 'Existing editor is preserved');
    }
  });
  test('streams responses and returns only valid citations; no unsolicited model calls', async () => {
    const { graph, bundle } = await fixture();
    const messages: AiHostMessage[] = [];
    let calls = 0;
    const session = new AiSession({
      post: (m) => messages.push(m),
      context: () => bundle,
      graph: () => graph,
      afterApply: async () => {},
      configuredModel: () => 'codemap-test',
      selectModels: async () => {
        calls++;
        return [model('Fact [[a.ts:L1]] [[secret.ts:L2]]')];
      },
    });
    try {
      session.status();
      assert.equal(calls, 0);
      await session.handle({
        type: 'aiRequest',
        rootId: graph.root.id,
        contextId: 'context',
        requestId: 'ask',
        question: 'Explain imports',
        mode: 'ask',
      });
      const done = [...messages].reverse().find((m) => m.type === 'aiProgress' && m.done);
      assert.ok(done?.type === 'aiProgress');
      assert.equal(done.error, undefined);
      assert.deepEqual(
        done.references?.map((r) => r.path),
        ['a.ts'],
      );
      assert.ok(messages.some((m) => m.type === 'aiProgress' && !m.done));
      assert.equal(calls, 1);
    } finally {
      session.dispose();
    }
  });
  test('empty model responses fail visibly, never become successful history and allow retry', async () => {
    const { graph, bundle } = await fixture();
    const events: AiHostMessage[] = [];
    let response = '';
    const session = new AiSession({
      post: (m) => events.push(m),
      context: () => bundle,
      graph: () => graph,
      afterApply: async () => {},
      configuredModel: () => 'codemap-test',
      selectModels: async () => [
        model('', {
          sendRequest: async () => ({
            text: (async function* () {
              yield response;
            })(),
            stream: (async function* () {})(),
          }),
        }),
      ],
    });
    const base = {
      type: 'aiRequest' as const,
      rootId: graph.root.id,
      contextId: 'ctx',
      question: 'Explain',
      mode: 'ask' as const,
    };
    try {
      for (const [index, empty] of ['', '  \n'].entries()) {
        response = empty;
        const requestId = `empty-${index}`;
        await session.handle({ ...base, requestId });
        const done = events.find(
          (m) => m.type === 'aiProgress' && m.requestId === requestId && m.done,
        );
        assert.ok(done?.type === 'aiProgress' && done.error?.includes('returned no text'));
        assert.ok(!events.some((m) => m.type === 'aiConnection' && m.state === 'ready'));
      }
      await session.handle({
        type: 'aiHistory',
        rootId: graph.root.id,
        regionKey:
          bundle.regionKey ??
          contextRegionKey(
            graph.root.id,
            bundle.files.map((f) => f.id),
          ),
      });
      const history = events.filter((m) => m.type === 'aiConversation').at(-1);
      assert.ok(history?.type === 'aiConversation');
      assert.equal(history.turns.length, 0);
      response = 'Here is the explanation.';
      await session.handle({ ...base, requestId: 'retry' });
      const done = events.find((m) => m.type === 'aiProgress' && m.requestId === 'retry' && m.done);
      assert.ok(done?.type === 'aiProgress' && !done.error);
      assert.equal(done.text, response);
      const usage = events.find((m) => m.type === 'aiUsage' && m.requestId === 'retry');
      assert.ok(usage?.type === 'aiUsage');
      assert.equal(usage.historyTurns, 0);
    } finally {
      session.dispose();
    }
  });
  test('unsupported CLI and zero-budget models never receive source requests or pass connection checks', async () => {
    const { graph, bundle } = await fixture();
    for (const metadata of [
      { vendor: 'copilotcli', maxInputTokens: 0 },
      { vendor: 'copilotcli', maxInputTokens: 128000 },
      { vendor: 'test', maxInputTokens: 0 },
    ]) {
      const events: AiHostMessage[] = [];
      let requests = 0,
        counts = 0;
      const session = new AiSession({
        post: (m) => events.push(m),
        context: () => bundle,
        graph: () => graph,
        afterApply: async () => {},
        configuredModel: () => 'codemap-test',
        selectModels: async () => [
          model('', {
            ...metadata,
            countTokens: async () => {
              counts++;
              return 0;
            },
            sendRequest: async () => {
              requests++;
              return { text: (async function* () {})(), stream: (async function* () {})() };
            },
          }),
        ],
      });
      try {
        await session.handle({
          type: 'aiRequest',
          rootId: graph.root.id,
          contextId: 'ctx',
          requestId: 'unsupported',
          question: 'Explain',
          mode: 'ask',
        });
        assert.ok(events.some((m) => m.type === 'aiProgress' && m.done && m.error));
        assert.ok(events.some((m) => m.type === 'aiModel' && m.error));
        assert.equal(await session.testConnection(), false);
        assert.equal(requests, 0);
        assert.equal(counts, 0);
        assert.ok(!events.some((m) => m.type === 'aiConversation'));
      } finally {
        session.dispose();
      }
    }
  });
  test('unsaved edits while the model is responding reject stale Ask and Plan results', async () => {
    for (const [mode, truncated] of [
      ['ask', false],
      ['plan', false],
      ['ask', true],
    ] as const) {
      const { graph, bundle } = await fixture();
      const document = await vscode.workspace.openTextDocument(
        vscode.Uri.parse(bundle.files[0].id),
      );
      const original = document.getText();
      if (truncated) {
        bundle.files[0].content = original.slice(0, 5);
        bundle.files[0].truncated = true;
      }
      const events: AiHostMessage[] = [];
      let release!: () => void;
      let start!: () => void;
      const started = new Promise<void>((resolve) => {
        start = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const session = new AiSession({
        post: (m) => events.push(m),
        context: () => bundle,
        graph: () => graph,
        afterApply: async () => {},
        configuredModel: () => 'codemap-test',
        selectModels: async () => [
          model('', {
            sendRequest: async () => ({
              text: (async function* () {
                start();
                await gate;
                yield mode === 'ask'
                  ? 'A stale answer'
                  : JSON.stringify({
                      summary: 'Stale plan',
                      steps: [
                        { path: bundle.files[0].path, role: 'edit', reason: 'Change source' },
                      ],
                    });
              })(),
              stream: (async function* () {})(),
            }),
          }),
        ],
      });
      let pending: Promise<void> | undefined;
      try {
        pending = session.handle({
          type: 'aiRequest',
          rootId: graph.root.id,
          contextId: 'ctx',
          requestId: mode,
          question: 'Explain or plan',
          mode,
        });
        await Promise.race([
          started,
          pending.then(() => {
            throw new Error('Request completed before the model stream started.');
          }),
        ]);
        const edit = new vscode.WorkspaceEdit();
        edit.insert(document.uri, document.positionAt(original.length), '\n// manual change\n');
        await vscode.workspace.applyEdit(edit);
        release();
        await pending;
        const done = events.find((m) => m.type === 'aiProgress' && m.done);
        assert.ok(done?.type === 'aiProgress' && done.error?.includes('Source changed'));
        assert.equal(done.plan, undefined);
        assert.ok(!events.some((m) => m.type === 'aiConnection' && m.state === 'ready'));
      } finally {
        release();
        await pending;
        session.dispose();
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
          document.uri,
          new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
          original,
        );
        await vscode.workspace.applyEdit(edit);
        await document.save();
      }
    }
  });
  test('repair Plan and generated edits include only an explicitly selected current verification report', async () => {
    let { graph, bundle } = await fixture();
    const file = bundle.files.find((f) => f.path === 'b.ts')!;
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(file.id));
    const original = document.getText();
    const events: AiHostMessage[] = [];
    const prompts: string[] = [];
    let response = '';
    const proposalText = (oldText: string, content: string) =>
      JSON.stringify({
        summary: 'Change value',
        changes: [
          {
            path: file.path,
            start: { line: 1, character: 17 },
            end: { line: 1, character: 18 },
            oldText,
            content,
            reason: 'Fixture repair',
          },
        ],
      });
    response = proposalText('2', '3');
    const session = new AiSession({
      post: (m) => events.push(m),
      context: () => bundle,
      graph: () => graph,
      afterApply: async () => {
        graph = await scanWorkspace(
          vscode.workspace.workspaceFolders![0],
          new vscode.CancellationTokenSource().token,
          () => {},
          { revision: graph.revision + 1 },
        );
      },
      editableFiles: () => [file.id],
      configuredModel: () => 'codemap-test',
      selectModels: async () => [
        model('', {
          sendRequest: async (messages) => {
            prompts.push(
              messages
                .flatMap((m) =>
                  m.content
                    .filter((c) => c instanceof vscode.LanguageModelTextPart)
                    .map((c) => c.value),
                )
                .join('\n'),
            );
            return {
              text: (async function* () {
                yield response;
              })(),
              stream: (async function* () {})(),
            };
          },
        }),
      ],
    });
    const base = {
      type: 'aiRequest' as const,
      rootId: graph.root.id,
      contextId: 'ctx',
      question: 'Repair source',
      editableFileIds: [file.id],
    };
    try {
      await session.handle({ ...base, requestId: 'initial', mode: 'propose' });
      const initial = events.find(
        (m) => m.type === 'aiProgress' && m.requestId === 'initial' && m.proposal,
      );
      assert.ok(initial?.type === 'aiProgress' && initial.proposal);
      await session.diff(initial.proposal.id, file.id, initial.proposal.changes[0].id);
      await session.apply(initial.proposal.id);
      const report = events.filter((m) => m.type === 'aiVerification').at(-1);
      assert.ok(report?.type === 'aiVerification' && !report.report.stale);
      assert.ok(!prompts[0].includes('BEGIN UNTRUSTED VERIFICATION'));
      bundle = await buildContext(graph, [file.id], [], async () => document.getText());
      response = JSON.stringify({
        summary: 'Repair current source',
        steps: [{ path: file.path, role: 'edit', reason: 'Fix current value after verification' }],
      });
      await session.handle({
        ...base,
        requestId: 'repair-plan',
        mode: 'plan',
        verificationId: report.report.id,
      });
      const planning = events.find(
        (m) => m.type === 'aiProgress' && m.requestId === 'repair-plan' && m.plan,
      );
      assert.ok(planning?.type === 'aiProgress' && planning.plan, JSON.stringify(events.at(-1)));
      assert.ok(prompts[1].includes('BEGIN UNTRUSTED VERIFICATION'));
      assert.ok(prompts[1].includes(report.report.id));
      response = proposalText('3', '4');
      await session.handle({
        ...base,
        requestId: 'repair-generate',
        mode: 'propose',
        planId: planning.plan.id,
        planStepIds: [planning.plan.steps[0].id],
        verificationId: report.report.id,
      });
      const generated = events.find(
        (m) => m.type === 'aiProgress' && m.requestId === 'repair-generate' && m.done,
      );
      assert.ok(generated?.type === 'aiProgress' && generated.proposal, JSON.stringify(generated));
      assert.ok(prompts[2].includes('BEGIN UNTRUSTED VERIFICATION'));
      const manual = new vscode.WorkspaceEdit();
      manual.insert(document.uri, new vscode.Position(0, 0), '// manual\n');
      await vscode.workspace.applyEdit(manual);
      await session.handle({
        ...base,
        requestId: 'stale-report',
        mode: 'plan',
        verificationId: report.report.id,
      });
      assert.equal(
        prompts.length,
        3,
        'Stale verification must be rejected before provider request',
      );
      assert.ok(
        events.some(
          (m) =>
            m.type === 'aiProgress' && m.requestId === 'stale-report' && m.error?.includes('stale'),
        ),
      );
    } finally {
      session.dispose();
      const restore = new vscode.WorkspaceEdit();
      restore.replace(
        document.uri,
        new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
        original,
      );
      await vscode.workspace.applyEdit(restore);
      await document.save();
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    }
  });
  test('live response formats archive range citations and JSON-fenced actions for explicit navigation', async () => {
    const { graph, bundle } = await fixture();
    const file = bundle.files.find((f) => f.path === 'a.ts')!;
    const events: AiHostMessage[] = [];
    const session = new AiSession({
      post: (m) => events.push(m),
      context: () => bundle,
      graph: () => graph,
      afterApply: async () => {},
      configuredModel: () => 'codemap-test',
      selectModels: async () => [
        model(
          'Evidence [[a.ts:L1-L2]].\n\n```json\n' +
            JSON.stringify([{ kind: 'focus', paths: ['a.ts'], reason: 'Inspect source' }]) +
            '\n```',
        ),
      ],
    });
    try {
      await session.handle({
        type: 'aiRequest',
        rootId: graph.root.id,
        contextId: 'ctx',
        requestId: 'range',
        question: 'Explain',
        mode: 'ask',
      });
      const done = events.find((m) => m.type === 'aiProgress' && m.done);
      assert.ok(done?.type === 'aiProgress');
      assert.equal(done.text, 'Evidence [[a.ts:L1-L2]].');
      assert.deepEqual(done.references, [{ fileId: file.id, path: 'a.ts', line: 1, endLine: 2 }]);
      const conversation = [...events].reverse().find((m) => m.type === 'aiConversation');
      assert.ok(conversation?.type === 'aiConversation');
      assert.equal(conversation.turns[0].actions?.[0].kind, 'focus');
      assert.ok(!events.some((m) => m.type === 'aiAction'));
      await session.handle({
        type: 'aiOpenReference',
        requestId: 'range',
        fileId: file.id,
        line: 1,
      });
      // showTextDocument resolves before selection/activation reaches the UI.
      const editor = () =>
        vscode.window.visibleTextEditors.find(
          (e) => e.document.uri.toString() === file.id && e.selection.start.line === 0,
        );
      const deadline = Date.now() + 2000;
      while (!editor() && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const opened = editor();
      assert.ok(opened);
      assert.equal(opened.selection.start.line, 0);
    } finally {
      session.dispose();
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    }
  });
  test('missing model, token budget and stale context produce scoped errors', async () => {
    const { graph, bundle } = await fixture();
    for (const scenario of ['missing', 'budget', 'stale']) {
      const messages: AiHostMessage[] = [];
      let contextCalls = 0;
      const session = new AiSession({
        post: (m) => messages.push(m),
        context: () => {
          if (scenario === 'stale' && ++contextCalls > 1) {
            throw new Error('stale context');
          }
          return bundle;
        },
        graph: () => graph,
        afterApply: async () => {},
        configuredModel: () => 'codemap-test',
        selectModels: async () =>
          scenario === 'missing'
            ? []
            : [model('answer', { countTokens: async () => (scenario === 'budget' ? 30000 : 100) })],
      });
      try {
        await session.handle({
          type: 'aiRequest',
          rootId: graph.root.id,
          contextId: 'context',
          requestId: scenario,
          question: 'Explain',
          mode: 'ask',
        });
        assert.ok(
          messages.some((m) => m.type === 'aiProgress' && m.done && !!m.error),
          scenario,
        );
      } finally {
        session.dispose();
      }
    }
  });
  test('task plans enforce approved files, preview real imports without mutation and recheck permission at Apply', async () => {
    const { graph, bundle } = await fixture();
    const file = bundle.files.find((f) => f.path === 'a.ts')!;
    const other = bundle.files.find((f) => f.path === 'b.ts')!;
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(file.id));
    const original = document.getText(),
      dirty = document.isDirty;
    const first = original.split('\n')[0];
    let allowed = [file.id];
    let response = JSON.stringify({
      summary: 'Remove an import',
      steps: [
        { path: file.path, role: 'edit', reason: 'Remove the dependency' },
        { path: other.path, role: 'read', reason: 'Check exported source' },
      ],
    });
    let calls = 0;
    let holdPreview = false;
    let releasePreview: (() => void) | undefined;
    let previewStarted: (() => void) | undefined;
    const events: AiHostMessage[] = [];
    const session = new AiSession({
      post: (m) => events.push(m),
      context: () => bundle,
      graph: () => graph,
      afterApply: async () => {},
      editableFiles: () => allowed,
      previewGraph: async (texts, token) => {
        if (holdPreview) {
          await new Promise<void>((resolve) => {
            releasePreview = resolve;
            previewStarted?.();
          });
          assert.ok(token.isCancellationRequested);
          return graph;
        }
        return scanWorkspace(vscode.workspace.workspaceFolders![0], token, () => {}, {
          textOverrides: texts,
          revision: graph.revision,
        });
      },
      configuredModel: () => 'codemap-test',
      selectModels: async () => [
        model('', {
          sendRequest: async () => {
            calls++;
            return {
              text: (async function* () {
                yield response;
              })(),
              stream: (async function* () {})(),
            };
          },
        }),
      ],
    });
    const request = {
      type: 'aiRequest' as const,
      rootId: graph.root.id,
      contextId: 'ctx',
      question: 'Remove the dependency',
    };
    try {
      await session.handle({
        ...request,
        requestId: 'plan',
        mode: 'plan',
        editableFileIds: [file.id],
      });
      const planning = events.find((m) => m.type === 'aiProgress' && m.plan);
      assert.ok(planning?.type === 'aiProgress' && planning.plan);
      assert.equal(document.getText(), original);
      response = JSON.stringify({
        summary: 'Remove import',
        changes: [
          {
            path: file.path,
            start: { line: 1, character: 0 },
            end: { line: 1, character: first.length },
            oldText: first,
            content: '// Dependency removed',
            reason: 'Remove import',
          },
        ],
      });
      await session.handle({
        ...request,
        requestId: 'bad-plan',
        mode: 'propose',
        planId: planning.plan.id,
        planStepIds: [planning.plan.steps[1].id],
        editableFileIds: [file.id, other.id],
      });
      assert.equal(calls, 1);
      assert.ok(
        events.some((m) => m.type === 'aiProgress' && m.requestId === 'bad-plan' && m.error),
      );
      await session.handle({
        ...request,
        requestId: 'generate',
        mode: 'propose',
        planId: planning.plan.id,
        planStepIds: [planning.plan.steps[0].id],
        editableFileIds: [file.id],
      });
      const done = events.find(
        (m) => m.type === 'aiProgress' && m.requestId === 'generate' && m.done,
      );
      assert.ok(done?.type === 'aiProgress' && done.proposal, JSON.stringify(done));
      const proposal = done.proposal;
      await session.handle({
        type: 'aiPreviewGraph',
        proposalId: proposal.id,
        changeIds: proposal.changes.map((c) => c.id),
      });
      const preview = events.find((m) => m.type === 'aiGraphPreview');
      assert.ok(preview?.type === 'aiGraphPreview', JSON.stringify(events.at(-1)));
      assert.ok(preview.before.edges.some((e) => e.source === file.id && e.target === other.id));
      assert.ok(!preview.proposed.edges.some((e) => e.source === file.id && e.target === other.id));
      assert.equal(document.getText(), original);
      assert.equal(document.isDirty, dirty);
      holdPreview = true;
      const started = new Promise<void>((resolve) => {
        previewStarted = resolve;
      });
      const cancelledPreview = session.handle({
        type: 'aiPreviewGraph',
        proposalId: proposal.id,
        changeIds: proposal.changes.map((c) => c.id),
      });
      await started;
      await session.handle({ type: 'aiCancel' });
      releasePreview!();
      await cancelledPreview;
      assert.equal(
        events.filter((m) => m.type === 'aiGraphPreview').length,
        1,
        'Cancelled preview must not publish stale results',
      );
      await session.handle({
        type: 'aiDiff',
        proposalId: proposal.id,
        fileId: file.id,
        changeId: proposal.changes[0].id,
      });
      allowed = [];
      await session.handle({
        type: 'aiApply',
        proposalId: proposal.id,
        changeIds: proposal.changes.map((c) => c.id),
      });
      assert.ok(events.some((m) => m.type === 'aiApplied' && m.error?.includes('permission')));
      assert.equal(document.getText(), original);
      assert.equal(document.isDirty, dirty);
    } finally {
      session.dispose();
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    }
  });
  test('model cannot propose edits in read-only task context even with forged client permissions', async () => {
    const { graph, bundle } = await fixture();
    const file = bundle.files.find((f) => f.path === 'b.ts')!;
    const events: AiHostMessage[] = [];
    const response = JSON.stringify({
      summary: 'Forbidden',
      changes: [
        {
          path: file.path,
          start: { line: 1, character: 0 },
          end: { line: 1, character: 0 },
          oldText: '',
          content: '// Unexpected edit\n',
          reason: 'Attempt',
        },
      ],
    });
    const session = new AiSession({
      post: (m) => events.push(m),
      context: () => bundle,
      graph: () => graph,
      afterApply: async () => {},
      editableFiles: () => bundle.files.filter((f) => f.id !== file.id).map((f) => f.id),
      configuredModel: () => 'codemap-test',
      selectModels: async () => [model(response)],
    });
    try {
      await session.handle({
        type: 'aiRequest',
        rootId: graph.root.id,
        contextId: 'ctx',
        requestId: 'forged',
        question: 'Edit',
        mode: 'propose',
        editableFileIds: [
          file.id,
          ...bundle.files.filter((f) => f.id !== file.id).map((f) => f.id),
        ],
      });
      const done = events.find((m) => m.type === 'aiProgress' && m.done);
      assert.ok(done?.type === 'aiProgress' && done.error?.includes('read-only'));
      assert.equal(done.proposal, undefined);
    } finally {
      session.dispose();
    }
  });
  test('Stop suppresses a late response and prevents proposal publication', async () => {
    const { graph, bundle } = await fixture();
    const messages: AiHostMessage[] = [];
    let release!: () => void;
    const delayed = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const session = new AiSession({
      post: (m) => messages.push(m),
      context: () => bundle,
      graph: () => graph,
      afterApply: async () => {},
      configuredModel: () => 'codemap-test',
      selectModels: async () => [
        model('', {
          sendRequest: async () => {
            entered();
            await delayed;
            return {
              text: (async function* () {
                yield 'late response';
              })(),
              stream: (async function* () {})(),
            };
          },
        }),
      ],
    });
    try {
      const task = session.handle({
        type: 'aiRequest',
        rootId: graph.root.id,
        contextId: 'context',
        requestId: 'cancel',
        question: 'Explain',
        mode: 'ask',
      });
      await started;
      session.cancel();
      release();
      await task;
      assert.ok(messages.some((m) => m.type === 'aiProgress' && m.error === 'Request stopped.'));
      assert.ok(!messages.some((m) => m.type === 'aiProgress' && m.text.includes('late response')));
    } finally {
      release();
      session.dispose();
    }
  });
  test('proposal opens readonly diff, requires review, rejects unsaved conflicts and applies once without saving', async () => {
    const { graph, bundle } = await fixture();
    const file = bundle.files.find((f) => f.path === 'a.ts')!;
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(file.id));
    const replacement = 'export const aiResult = 42;\n';
    const messages: AiHostMessage[] = [];
    let refreshed = 0;
    const session = new AiSession({
      post: (m) => messages.push(m),
      context: () => bundle,
      graph: () => graph,
      afterApply: async () => {
        refreshed++;
      },
      configuredModel: () => 'codemap-test',
      selectModels: async () => [
        model(
          JSON.stringify({
            summary: 'Replace entry',
            changes: [
              {
                path: file.path,
                start: { line: 1, character: 0 },
                end: {
                  line: file.content.split('\n').length,
                  character: file.content.split('\n').at(-1)!.length,
                },
                oldText: file.content,
                content: replacement,
                reason: 'Replace synthetic entry',
              },
            ],
          }),
        ),
      ],
    });
    const replace = async (text: string) => {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        document.uri,
        new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
        text,
      );
      assert.ok(await vscode.workspace.applyEdit(edit));
    };
    try {
      await session.handle({
        type: 'aiRequest',
        rootId: graph.root.id,
        contextId: 'context',
        requestId: 'propose',
        question: 'Replace entry',
        mode: 'propose',
      });
      const result = [...messages].reverse().find((m) => m.type === 'aiProgress' && m.done);
      assert.ok(result?.type === 'aiProgress' && result.proposal, JSON.stringify(result));
      const id = result.proposal.id;
      await session.apply(id);
      assert.ok(messages.some((m) => m.type === 'aiApplied' && m.error?.includes('Review every')));
      assert.equal(document.getText(), file.content);
      await session.diff(id, file.id);
      assert.ok(messages.some((m) => m.type === 'aiDiffOpened'));
      await replace('// unsaved concurrent edit\n' + file.content.replace('1', '9'));
      await session.apply(id);
      assert.ok(
        messages.some((m) => m.type === 'aiApplied' && m.error?.includes('Source changed')),
      );
      assert.ok(document.getText().includes('concurrent edit'));
      await replace(file.content);
      await session.apply(id);
      assert.equal(document.getText(), replacement);
      assert.ok(document.isDirty);
      assert.equal(refreshed, 1);
      const newGraph = await scanWorkspace(
        vscode.workspace.workspaceFolders![0],
        new vscode.CancellationTokenSource().token,
        () => {},
      );
      assert.ok(!newGraph.edges.some((e) => e.source === file.id));
      await session.apply(id);
      assert.equal(refreshed, 1);
    } finally {
      await replace(file.content);
      await document.save();
      session.dispose();
    }
  });
  test('connection check sends a fixed source-free prompt and reports provider failure', async () => {
    const { graph } = await fixture();
    for (const fails of [false, true]) {
      const events: AiHostMessage[] = [];
      const prompts: vscode.LanguageModelChatMessage[][] = [];
      const session = new AiSession({
        post: (m) => events.push(m),
        context: () => {
          throw new Error('Must not read source');
        },
        graph: () => graph,
        afterApply: async () => {},
        configuredModel: () => 'codemap-test',
        selectModels: async () => [
          model('CODEMAP_OK', {
            sendRequest: async (messages) => {
              prompts.push([...messages]);
              if (fails) {
                throw vscode.LanguageModelError.NoPermissions('Sign in first');
              }
              return {
                text: (async function* () {
                  yield 'CODEMAP_OK';
                })(),
                stream: (async function* () {})(),
              };
            },
          }),
        ],
      });
      try {
        assert.equal(await session.testConnection(), !fails);
        assert.equal(prompts.length, 1);
        assert.equal(prompts[0].length, 1);
        assert.equal(
          (prompts[0][0].content[0] as vscode.LanguageModelTextPart).value,
          'Connection check. Reply with CODEMAP_OK only.',
        );
        assert.ok(
          events.some((m) => m.type === 'aiConnection' && m.state === (fails ? 'error' : 'ready')),
        );
      } finally {
        session.dispose();
      }
    }
  });
  test('connection Stop completes even when the provider ignores cancellation', async () => {
    const { graph, bundle } = await fixture();
    let entered!: () => void;
    let release!: (models: readonly vscode.LanguageModelChat[]) => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending = new Promise<readonly vscode.LanguageModelChat[]>((resolve) => {
      release = resolve;
    });
    const session = new AiSession({
      post: () => {},
      context: () => bundle,
      graph: () => graph,
      afterApply: async () => {},
      configuredModel: () => 'codemap-test',
      selectModels: () => {
        entered();
        return pending;
      },
    });
    try {
      const check = session.testConnection();
      await started;
      session.cancel();
      assert.equal(await check, false);
    } finally {
      release([]);
      session.dispose();
    }
  });
  test('conversation survives refresh, uses fresh context and trims history to the token budget', async () => {
    const { graph, bundle } = await fixture();
    bundle.regionKey = contextRegionKey(
      graph.root.id,
      bundle.files.map((f) => f.id),
    );
    let current = bundle;
    let tokenCost = 100;
    const events: AiHostMessage[] = [];
    const prompts: vscode.LanguageModelChatMessage[][] = [];
    const session = new AiSession({
      post: (m) => events.push(m),
      context: () => current,
      graph: () => graph,
      afterApply: async () => {},
      configuredModel: () => 'codemap-test',
      selectModels: async () => [
        model('', {
          maxInputTokens: 2000,
          countTokens: async () => tokenCost,
          sendRequest: async (messages) => {
            prompts.push([...messages]);
            return {
              text: (async function* () {
                yield 'Answer ' + prompts.length;
              })(),
              stream: (async function* () {})(),
            };
          },
        }),
      ],
    });
    const ask = (id: string) =>
      session.handle({
        type: 'aiRequest',
        requestId: id,
        rootId: graph.root.id,
        contextId: 'context',
        question: id,
        mode: 'ask',
      });
    try {
      await ask('first');
      session.invalidate();
      current = {
        ...bundle,
        revision: bundle.revision + 1,
        files: bundle.files.map((f) => ({ ...f, content: f.content + '\n// fresh source' })),
      };
      const changed = new vscode.WorkspaceEdit();
      for (const file of current.files) {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(file.id));
        changed.replace(
          doc.uri,
          new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)),
          file.content,
        );
      }
      await vscode.workspace.applyEdit(changed);
      await session.handle({
        type: 'aiHistory',
        rootId: graph.root.id,
        regionKey: bundle.regionKey,
      });
      assert.ok(events.some((m) => m.type === 'aiConversation' && m.turns.length === 1));
      await ask('second');
      assert.equal(prompts[1].length, 3);
      assert.equal(prompts[1][1].role, vscode.LanguageModelChatMessageRole.Assistant);
      assert.ok(JSON.stringify(prompts[1][2]).includes('fresh source'));
      tokenCost = 600;
      await ask('third');
      assert.equal(prompts[2].length, 1);
      assert.ok(
        events.some((m) => m.type === 'aiUsage' && m.requestId === 'third' && m.historyTurns === 0),
      );
      const clipboard = await vscode.env.clipboard.readText();
      try {
        await session.handle({ type: 'aiCopy', requestId: 'second', text: 'Answer 2' });
        assert.equal(await vscode.env.clipboard.readText(), 'Answer 2');
        await session.handle({ type: 'aiCopy', requestId: 'second', text: 'arbitrary text' });
        assert.equal(await vscode.env.clipboard.readText(), 'Answer 2');
      } finally {
        await vscode.env.clipboard.writeText(clipboard);
      }
      await session.handle({
        type: 'aiClearHistory',
        rootId: graph.root.id,
        regionKey: bundle.regionKey,
      });
      const last = events.at(-1);
      assert.ok(last?.type === 'aiConversation' && last.turns.length === 0);
    } finally {
      session.dispose();
      const restore = new vscode.WorkspaceEdit();
      for (const file of bundle.files) {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(file.id));
        restore.replace(
          doc.uri,
          new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)),
          file.content,
        );
      }
      await vscode.workspace.applyEdit(restore);
      for (const file of bundle.files) {
        await (await vscode.workspace.openTextDocument(vscode.Uri.parse(file.id))).save();
      }
    }
  });
  test('AI graph suggestions require an explicit archived action ID and current revision', async () => {
    const { graph, bundle } = await fixture();
    const included = bundle.files.find((f) => f.path === 'a.ts')!;
    const other = graph.nodes.find((n) => n.id !== included.id)!;
    const context = {
      ...bundle,
      files: [included],
      regionKey: contextRegionKey(graph.root.id, [included.id]),
    };
    const events: AiHostMessage[] = [];
    let prompt = '';
    let current = true;
    const session = new AiSession({
      post: (m) => events.push(m),
      context: () => context,
      graph: () => graph,
      isCurrent: () => current,
      afterApply: async () => {},
      configuredModel: () => 'codemap-test',
      selectModels: async () => [
        model('', {
          sendRequest: async (messages) => {
            prompt = JSON.stringify(messages);
            const text =
              'Need more source.\n\n```codemap-actions\n' +
              JSON.stringify([
                {
                  kind: 'addContext',
                  targets: [{ path: other.path }],
                  reason: 'Read the imported implementation',
                },
                {
                  kind: 'focus',
                  paths: [included.path, other.path],
                  reason: 'Compare dependencies',
                },
              ]) +
              '\n```';
            return {
              text: (async function* () {
                yield text;
              })(),
              stream: (async function* () {})(),
            };
          },
        }),
      ],
    });
    try {
      await session.handle({
        type: 'aiRequest',
        rootId: graph.root.id,
        contextId: 'ctx',
        requestId: 'suggest',
        question: 'What source is missing?',
        mode: 'ask',
      });
      assert.ok(prompt.includes('UNTRUSTED GRAPH CATALOG'));
      const conversation = events.find((m) => m.type === 'aiConversation');
      assert.ok(conversation?.type === 'aiConversation');
      assert.equal(conversation.turns[0].actions?.length, 2);
      assert.ok(!conversation.turns[0].answer.includes('codemap-actions'));
      assert.ok(!events.some((m) => m.type === 'aiAction'));
      const click = (actionId: string) =>
        session.handle({
          type: 'aiExecuteAction',
          rootId: graph.root.id,
          regionKey: context.regionKey,
          requestId: 'suggest',
          actionId,
        });
      await click('forged');
      assert.equal(events.at(-1)?.type, 'aiActionError');
      await click('action-1');
      assert.equal(events.at(-1)?.type, 'aiAction');
      await click('action-0');
      const expanded = contextRegionKey(graph.root.id, [included.id, other.id]);
      await session.handle({ type: 'aiHistory', rootId: graph.root.id, regionKey: expanded });
      const fork = events.at(-1);
      assert.ok(fork?.type === 'aiConversation');
      assert.equal(fork.turns.length, 1);
      assert.deepEqual(fork.turns[0].actions, []);
      current = false;
      await click('action-1');
      assert.equal(events.at(-1)?.type, 'aiActionError');
      current = true;
      graph.revision++;
      await click('action-1');
      assert.equal(events.at(-1)?.type, 'aiActionError');
    } finally {
      session.dispose();
    }
  });
  test('all four graph tools register with the extension', async () => {
    const extension = vscode.extensions.all.find((e) => e.packageJSON.name === 'codemap-ai')!;
    await extension.activate();
    const tools = vscode.lm.tools.filter((t) => t.name.startsWith('codemap_get_'));
    assert.equal(tools.length, 4);
  });
});
