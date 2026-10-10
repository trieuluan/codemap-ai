import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { AiSession } from '../ai/session';
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
            changes: [{ path: file.path, content: replacement }],
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
      await replace(file.content + '// unsaved concurrent edit');
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
    }
  });
  test('all four graph tools register with the extension', async () => {
    const extension = vscode.extensions.all.find((e) => e.packageJSON.name === 'codemap-ai')!;
    await extension.activate();
    const tools = vscode.lm.tools.filter((t) => t.name.startsWith('codemap_get_'));
    assert.equal(tools.length, 4);
  });
});
