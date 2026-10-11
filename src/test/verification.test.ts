import { createHash } from 'node:crypto';
import { scanWorkspace } from '../workspace';
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { mkdtemp, writeFile, rm, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiSession } from '../ai/session';
import { Verification } from '../ai/verification';
import { TestRunner } from '../ai/test-runner';
import { buildContext } from '../shared/context';
import type { AiHostMessage } from '../shared/ai';
import type { GraphSnapshot } from '../shared/model';
import type { TestResult } from '../shared/verification';

suite('Range review and post-Apply verification', () => {
  test('only accepted reviewed hunks apply; refresh failure preserves successful Apply and stale local report', async () => {
    const root = vscode.workspace.workspaceFolders![0].uri;
    const uri = vscode.Uri.joinPath(root, 'partial.ts');
    const original = 'export const a = 1;\nexport const b = 2;\n';
    await vscode.workspace.fs.writeFile(uri, Buffer.from(original));
    const graph: GraphSnapshot = {
      root: { id: root.toString(), name: 'test' },
      revision: 1,
      scannedAt: '',
      warnings: [],
      nodes: [
        {
          id: uri.toString(),
          path: 'partial.ts',
          name: 'partial.ts',
          language: 'typescript',
          outside: [],
        },
      ],
      edges: [],
    };
    const bundle = await buildContext(graph, [uri.toString()], [], async () => original);
    const events: AiHostMessage[] = [];
    const answer = JSON.stringify({
      summary: 'Change two constants',
      changes: [1, 2].map((line) => ({
        path: 'partial.ts',
        start: { line, character: 17 },
        end: { line, character: 18 },
        oldText: String(line),
        content: String(line + 10),
        reason: 'Update value',
      })),
    });
    const session = new AiSession({
      post: (m) => events.push(m),
      context: () => bundle,
      graph: () => graph,
      afterApply: async () => {
        throw new Error('Synthetic graph failure');
      },
      configuredModel: () => 'fake',
      selectModels: async () => [
        {
          id: 'fake',
          name: 'fake',
          vendor: 'test',
          family: 'fake',
          version: '1',
          maxInputTokens: 20000,
          countTokens: async () => 10,
          sendRequest: async () => ({
            text: (async function* () {
              yield answer;
            })(),
            stream: (async function* () {})(),
          }),
        },
      ],
    });
    try {
      await session.handle({
        type: 'aiRequest',
        rootId: graph.root.id,
        contextId: 'c',
        requestId: 'p',
        question: 'Update values',
        mode: 'propose',
      });
      const done = events.find((e) => e.type === 'aiProgress' && e.proposal);
      assert.ok(done?.type === 'aiProgress' && done.proposal);
      const proposal = done.proposal;
      await session.diff(proposal.id, uri.toString(), proposal.changes[0].id);
      const reviewed = events.find((e) => e.type === 'aiDiffOpened');
      assert.ok(reviewed?.type === 'aiDiffOpened');
      assert.deepEqual(reviewed.changeIds, [proposal.changes[0].id]);
      await session.apply(proposal.id, [proposal.changes[1].id]);
      assert.ok(events.some((e) => e.type === 'aiApplied' && e.error?.includes('Review every')));
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      await vscode.window.showTextDocument(uri, {
        viewColumn: vscode.ViewColumn.One,
        preview: false,
      });
      const conflicted = await vscode.workspace.openTextDocument(uri);
      const setText = async (text: string) => {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
          uri,
          new vscode.Range(
            conflicted.positionAt(0),
            conflicted.positionAt(conflicted.getText().length),
          ),
          text,
        );
        assert.ok(await vscode.workspace.applyEdit(edit));
      };
      await setText(original.replace('a = 1', 'a = 9'));
      await session.apply(proposal.id, [proposal.changes[0].id]);
      const conflict = events.find((e) => e.type === 'aiApplied' && e.conflict);
      assert.ok(conflict?.type === 'aiApplied' && conflict.conflict);
      assert.deepEqual(conflict.conflict, {
        fileId: uri.toString(),
        changeId: proposal.changes[0].id,
      });
      assert.equal(conflicted.getText(), original.replace('a = 1', 'a = 9'));
      const beforeApply = '// Unrelated edit preserved when ranges are rebased.\n' + original;
      await setText(beforeApply);
      await session.apply(proposal.id, [proposal.changes[0].id]);
      const document = await vscode.workspace.openTextDocument(uri);
      assert.equal(document.getText(), beforeApply.replace('a = 1', 'a = 11'));
      assert.ok(document.isDirty);
      assert.equal(events.filter((e) => e.type === 'aiApplied' && !e.error).length, 1);
      const observed = events.find((e) => e.type === 'aiVerification');
      assert.ok(observed?.type === 'aiVerification');
      assert.ok(observed.report.stale);
      assert.equal(observed.report.changedFiles[0].sourceState, 'applied');
      assert.match(observed.report.graphError!, /Synthetic graph failure/);
      const last = events.at(-1);
      assert.notEqual(last?.type, 'aiApplied');
      session.status();
      assert.ok(events.some((e) => e.type === 'aiProposalState' && e.state === 'applied'));
      await setText(beforeApply);
      await session.handle({ type: 'aiRecheckVerification', reportId: observed.report.id });
      const undone = [...events].reverse().find((e) => e.type === 'aiVerification');
      assert.ok(undone?.type === 'aiVerification');
      assert.equal(undone.report.changedFiles[0].sourceState, 'reverted');
      // Restore explicitly: global Undo is focus-dependent in the desktop test host.
      const restore = new vscode.WorkspaceEdit();
      restore.replace(
        uri,
        new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
        original,
      );
      await vscode.workspace.applyEdit(restore);
      await document.save();
    } finally {
      session.dispose();
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.workspace.fs.delete(uri);
    }
  });
  test('diagnostics update, explicit report sharing, stale source and root changes are guarded', async () => {
    const root = vscode.workspace.workspaceFolders![0].uri;
    const uri = vscode.Uri.joinPath(root, 'verification.ts');
    await vscode.workspace.fs.writeFile(uri, Buffer.from('export const v = 1;'));
    let graph: GraphSnapshot = {
      root: { id: root.toString(), name: 'test' },
      revision: 1,
      scannedAt: '',
      warnings: [],
      nodes: [
        {
          id: uri.toString(),
          path: 'verification.ts',
          name: 'verification.ts',
          language: 'typescript',
          outside: [],
        },
      ],
      edges: [],
    };
    const events: AiHostMessage[] = [];
    const service = new Verification(
      () => graph,
      (m) => events.push(m),
    );
    const diagnostics = vscode.languages.createDiagnosticCollection('CodeMap verification test');
    try {
      const before = graph;
      await service.observe(before, [], 'p', [uri.toString()], async () => {
        graph = { ...graph, revision: 2 };
      });
      const report = events.find((e) => e.type === 'aiVerification');
      assert.ok(report?.type === 'aiVerification');
      assert.match(service.context(report.report.id, root.toString()), /UNTRUSTED VERIFICATION/);
      assert.throws(() => service.context('unknown', root.toString()));
      assert.throws(() => service.context(report.report.id, 'different-root'));
      diagnostics.set(uri, [
        new vscode.Diagnostic(
          new vscode.Range(0, 0, 0, 1),
          'Synthetic diagnostic',
          vscode.DiagnosticSeverity.Error,
        ),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.ok(
        events.some(
          (e) =>
            e.type === 'aiVerification' &&
            e.report.addedDiagnostics.some((d) => d.message === 'Synthetic diagnostic'),
        ),
      );
      const document = await vscode.workspace.openTextDocument(uri);
      const edit = new vscode.WorkspaceEdit();
      edit.insert(uri, new vscode.Position(0, 0), '// unsaved\n');
      await vscode.workspace.applyEdit(edit);
      assert.throws(() => service.context(report.report.id, root.toString()), /stale/);
      assert.ok(events.some((e) => e.type === 'aiVerification' && e.report.stale));
      const restore = new vscode.WorkspaceEdit();
      restore.replace(
        uri,
        new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
        'export const v = 1;',
      );
      await vscode.workspace.applyEdit(restore);
      await document.save();
      graph = { ...graph, root: { id: 'file:///different', name: 'different' } };
      const count = events.length;
      service.publish();
      assert.equal(events.length, count);
    } finally {
      service.dispose();
      diagnostics.dispose();
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.workspace.fs.delete(uri);
    }
  });
  test('verification rounds are bounded, root scoped and navigate only current validated diagnostics', async () => {
    const root = vscode.workspace.workspaceFolders![0].uri;
    const uri = vscode.Uri.joinPath(root, 'rounds.ts');
    await vscode.workspace.fs.writeFile(uri, Buffer.from('export const value = 1;\n'));
    let graph: GraphSnapshot = {
      root: { id: root.toString(), name: 'test' },
      revision: 1,
      scannedAt: '',
      warnings: [],
      edges: [],
      nodes: [
        {
          id: uri.toString(),
          path: 'rounds.ts',
          name: 'rounds.ts',
          language: 'typescript',
          outside: [],
        },
      ],
    };
    const events: AiHostMessage[] = [];
    const service = new Verification(
      () => graph,
      (m) => events.push(m),
    );
    const diagnostics = vscode.languages.createDiagnosticCollection('CodeMap rounds');
    try {
      diagnostics.set(uri, [
        new vscode.Diagnostic(
          new vscode.Range(0, 13, 0, 18),
          'Fixture error',
          vscode.DiagnosticSeverity.Error,
        ),
      ]);
      for (let i = 0; i < 10; i++) {
        await service.observe(graph, [], `p${i}`, [uri.toString()], async () => {
          graph = { ...graph, revision: graph.revision + 1 };
        });
      }
      const history = events.filter((m) => m.type === 'aiVerificationHistory').at(-1);
      assert.ok(history?.type === 'aiVerificationHistory');
      assert.equal(history.reports.length, 8);
      assert.equal(history.reports[0].proposalId, 'p9');
      assert.equal(history.reports[0].stale, false);
      assert.ok(history.reports.slice(1).every((r) => r.stale));
      const current = history.reports[0];
      const index = current.diagnostics.findIndex((d) => d.message === 'Fixture error');
      assert.ok(index >= 0);
      await service.openDiagnostic(current.id, index);
      const editor = () =>
        vscode.window.visibleTextEditors.find(
          (e) => e.document.uri.toString() === uri.toString() && e.selection.start.character === 13,
        );
      const deadline = Date.now() + 2000;
      while (!editor() && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.ok(editor());
      await service.openDiagnostic(current.id, 100);
      assert.ok(
        events.some(
          (m) => m.type === 'aiVerificationError' && m.message.includes('no longer available'),
        ),
      );
      const document = await vscode.workspace.openTextDocument(uri);
      const edit = new vscode.WorkspaceEdit();
      edit.insert(uri, new vscode.Position(0, 0), '// changed\n');
      await vscode.workspace.applyEdit(edit);
      await service.openDiagnostic(current.id, index);
      assert.ok(
        events.some((m) => m.type === 'aiVerificationError' && m.message.includes('stale')),
      );
      // Previously emitted historical data is immutable.
      assert.equal(current.stale, false);
      service.reset();
      events.length = 0;
      service.publish();
      assert.equal(events.length, 0);
      const restore = new vscode.WorkspaceEdit();
      restore.replace(
        uri,
        new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
        'export const value = 1;\n',
      );
      await vscode.workspace.applyEdit(restore);
      await document.save();
    } finally {
      service.dispose();
      diagnostics.dispose();
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.workspace.fs.delete(uri);
    }
  });
  test('user-selected package test tasks report exit codes, bounded logs and cancellation', async function () {
    this.timeout(20000);
    const directory = await mkdtemp(join(tmpdir(), 'codemap-test-task-'));
    const root = vscode.Uri.file(directory);
    const runner = new TestRunner();
    const results: TestResult[] = [];
    try {
      await writeFile(
        join(directory, 'package.json'),
        JSON.stringify({
          scripts: {
            'test:pass': 'node -e "console.log(\'TASK_OK\')"',
            'test:fail': 'node -e "process.stdout.write(\'x\'.repeat(40000));process.exit(2)"',
            'test:wait': 'node -e "setTimeout(()=>{},100000)"',
          },
        }),
      );
      await runner.run(root, { manager: 'npm', name: 'test:pass' }, false, (r) => results.push(r));
      assert.equal(results.at(-1)?.state, 'passed', results.at(-1)?.output);
      assert.match(results.at(-1)!.output, /TASK_OK/);
      assert.equal(results.at(-1)?.saved, false);
      await runner.run(root, { manager: 'npm', name: 'test:fail' }, true, (r) => results.push(r));
      assert.equal(results.at(-1)?.state, 'failed');
      assert.equal(results.at(-1)?.exitCode, 2);
      assert.equal(results.at(-1)?.output.length, 32000);
      assert.equal(results.at(-1)?.truncated, true);
      const waiting = runner.run(root, { manager: 'npm', name: 'test:wait' }, false, (r) =>
        results.push(r),
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      runner.stop();
      await waiting;
      assert.equal(results.at(-1)?.state, 'cancelled');
    } finally {
      runner.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
  test('package discovery and execution use package cwd; escaping symlinks are rejected', async () => {
    const root = vscode.Uri.joinPath(
      vscode.workspace.workspaceFolders![0].uri,
      'package-test-fixture',
    );
    const outside = await mkdtemp(join(tmpdir(), 'codemap-outside-test-'));
    const runner = new TestRunner();
    const results: TestResult[] = [];
    try {
      await mkdir(join(root.fsPath, 'packages/core'), { recursive: true });
      await writeFile(
        join(root.fsPath, 'package.json'),
        JSON.stringify({ scripts: { test: 'node -e "process.exit(9)"' } }),
      );
      await writeFile(
        join(root.fsPath, 'packages/core/package.json'),
        JSON.stringify({ scripts: { test: 'node -e "console.log(process.cwd())"' } }),
      );
      const choices = await runner.choices(root, ['packages/core/src/a.ts']);
      assert.equal(choices[0].directory, 'packages/core');
      assert.equal(choices[0].related, true);
      assert.ok(choices.some((c) => c.directory === ''));
      await runner.run(root, choices[0], false, (r) => results.push(r));
      assert.equal(results.at(-1)?.state, 'passed');
      assert.match(results.at(-1)!.output, /packages\/core/);
      assert.match(results.at(-1)!.name, /packages\/core/);
      await assert.rejects(
        runner.run(root, { manager: 'npm', name: 'test', directory: '../' }, false, () => {}),
        /Invalid package/,
      );
      await assert.rejects(
        runner.run(
          root,
          choices[0],
          false,
          () => {},
          () => false,
        ),
        /source changed/,
      );
      const pending = runner.run(root, choices[0], false, () => {});
      await assert.rejects(
        runner.run(root, choices[0], false, () => {}),
        /already active/,
      );
      runner.stop();
      await assert.rejects(pending, /cancelled/);
      await symlink(outside, join(root.fsPath, 'escape'));
      await assert.rejects(
        runner.run(root, { manager: 'npm', name: 'test', directory: 'escape' }, false, () => {}),
        /outside the workspace/,
      );
      await assert.rejects(
        runner.run(
          root,
          { manager: 'npm', name: 'test:removed', directory: 'packages/core' },
          false,
          () => {},
        ),
        /no longer exists/,
      );
    } finally {
      runner.dispose();
      await rm(root.fsPath, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
  test('stale reports and source changes during test selection cannot execute tasks', async () => {
    const root = vscode.workspace.workspaceFolders![0].uri;
    const graph: GraphSnapshot = {
      root: { id: root.toString(), name: 'test' },
      revision: 1,
      scannedAt: '',
      warnings: [],
      nodes: [],
      edges: [],
    };
    const events: AiHostMessage[] = [];
    const runner = new TestRunner();
    let chosen = 0,
      runs = 0;
    const service = new Verification(
      () => graph,
      (m) => events.push(m),
      runner,
    );
    runner.choose = async () => {
      chosen++;
      service.changed();
      return { manager: 'npm', name: 'test' };
    };
    runner.run = async () => {
      runs++;
    };
    try {
      await service.observe(graph, [], 'p', [], async () => {});
      const message = events.find((e) => e.type === 'aiVerification');
      assert.ok(message?.type === 'aiVerification');
      await service.test(message.report.id, true);
      assert.equal(chosen, 1);
      assert.equal(runs, 0);
      await service.test(message.report.id, false);
      assert.equal(chosen, 1);
      assert.equal(runs, 0);
      assert.ok(
        events.some((e) => e.type === 'aiVerificationError' && /stale|changed/.test(e.message)),
      );
    } finally {
      service.dispose();
    }
  });
  test('refresh observations tracks manual edits and Undo without treating old tests as current', async () => {
    const root = vscode.workspace.workspaceFolders![0].uri;
    const uri = vscode.Uri.joinPath(root, 'source-observation.ts');
    const before = 'export const value = 1;\n';
    const applied = 'export const value = 2;\n';
    await vscode.workspace.fs.writeFile(uri, Buffer.from(applied));
    const document = await vscode.workspace.openTextDocument(uri);
    let graph: GraphSnapshot = {
      root: { id: root.toString(), name: 'test' },
      revision: 1,
      scannedAt: '',
      warnings: [],
      edges: [],
      nodes: [
        {
          id: uri.toString(),
          path: 'source-observation.ts',
          name: 'source-observation.ts',
          language: 'typescript',
          outside: [],
        },
      ],
    };
    const events: AiHostMessage[] = [];
    const runner = new TestRunner();
    runner.choose = async () => ({ manager: 'npm', name: 'test' });
    runner.run = async (_root, _choice, saved, publish) => {
      publish({
        name: 'test',
        state: 'failed',
        exitCode: 1,
        output: 'fixture failure',
        truncated: false,
        startedAt: '',
        saved,
      });
    };
    const service = new Verification(
      () => graph,
      (m) => events.push(m),
      runner,
    );
    const latest = () => {
      const event = [...events].reverse().find((e) => e.type === 'aiVerification');
      assert.ok(event?.type === 'aiVerification');
      return event.report;
    };
    const refresh = async () => {
      graph = { ...graph, revision: graph.revision + 1 };
    };
    const replace = async (text: string) => {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        uri,
        new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
        text,
      );
      assert.ok(await vscode.workspace.applyEdit(edit));
    };
    try {
      const digest = (text: string) => createHash('sha256').update(text).digest('hex');
      await service.observe(
        graph,
        [],
        'p',
        [uri.toString()],
        refresh,
        new Map([[uri.toString(), { before: digest(before), applied: digest(applied) }]]),
      );
      assert.equal(latest().changedFiles[0].sourceState, 'applied');
      const id = latest().id;
      await service.test(id, false);
      assert.equal(latest().test?.stale, undefined);
      await replace(applied + '// manual change\n');
      assert.equal(latest().changedFiles[0].sourceState, 'modified');
      assert.ok(latest().stale);
      assert.ok(latest().test?.stale);
      await service.recheck(id, refresh);
      assert.equal(latest().stale, false);
      assert.equal(latest().changedFiles[0].sourceState, 'modified');
      assert.ok(latest().test?.stale);
      await replace(before);
      assert.equal(latest().changedFiles[0].sourceState, 'reverted');
      await service.recheck(id, refresh);
      assert.equal(latest().stale, false);
      assert.equal(latest().changedFiles[0].sourceState, 'reverted');
      await service.test(id, false);
      assert.equal(latest().test?.stale, undefined);
      await service.recheck(id, async () => {
        throw new Error('Synthetic refresh failure');
      });
      assert.ok(latest().stale);
      assert.equal(latest().refreshing, false);
      assert.ok(
        events.some(
          (e) => e.type === 'aiVerificationError' && /Synthetic refresh failure/.test(e.message),
        ),
      );
      await service.recheck(id, refresh);
      let release!: () => void;
      let refreshCount = 0;
      const pending = service.recheck(id, async () => {
        refreshCount++;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      });
      await service.recheck(id, refresh);
      assert.equal(refreshCount, 1);
      assert.throws(() => service.context(id, root.toString()), /running/);
      service.reset();
      const count = events.length;
      release();
      await pending;
      assert.equal(
        events.length,
        count,
        'disposed/reset recheck must not publish stale observations',
      );
    } finally {
      service.dispose();
      await document.save();
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.workspace.fs.delete(uri);
    }
  });
  if (process.env.CODEMAP_QA_ROOT) {
    test('real codemap scan preserves known imports and declaration routes without changing source', async function () {
      this.timeout(120000);
      const root = vscode.Uri.file(process.env.CODEMAP_QA_ROOT!);
      const token = new vscode.CancellationTokenSource();
      const target = vscode.Uri.joinPath(root, 'packages/runtime-node/src/harness/plan-actions.ts');
      const original = await vscode.workspace.fs.readFile(target);
      try {
        const started = performance.now();
        const graph = await scanWorkspace(
          { uri: root, name: 'codemap', index: 0 },
          token.token,
          () => {},
        );
        assert.ok(graph.nodes.length > 200);
        const node = graph.nodes.find((n) => n.id === target.toString());
        assert.ok(node);
        const dependencies = graph.edges.filter((e) => e.source === node.id);
        assert.ok(dependencies.length);
        assert.ok(
          dependencies.some(
            (e) =>
              graph.nodes.find((n) => n.id === e.target)?.path ===
              'packages/runtime-node/src/runtime-input.ts',
          ),
        );
        assert.ok(
          dependencies.some((edge) =>
            edge.sites.some((site) =>
              site.symbols?.some(
                (symbol) =>
                  symbol.local === 'PlanReviewAction' &&
                  symbol.typeOnly &&
                  symbol.declaration?.nodeId === edge.target,
              ),
            ),
          ),
        );
        assert.ok(
          dependencies.every((e) => e.sites.length && e.sites.every((site) => site.line >= 0)),
        );
        assert.deepEqual(await vscode.workspace.fs.readFile(target), original);
        console.log(
          `Real codemap scan: ${graph.nodes.length} files, ${graph.edges.length} edges, ${graph.warnings.length} warnings, ${Math.round(performance.now() - started)} ms`,
        );
      } finally {
        token.dispose();
      }
    });
    test('read-only discovery on the real codemap monorepo recommends runtime-node tests', async () => {
      const runner = new TestRunner();
      try {
        const choices = await runner.choices(vscode.Uri.file(process.env.CODEMAP_QA_ROOT!), [
          'packages/runtime-node/src/harness/plan-actions.ts',
        ]);
        assert.ok(choices.length > 2);
        assert.equal(choices[0].directory, 'packages/runtime-node');
        assert.ok(choices.some((c) => c.directory === '' && c.name === 'test'));
        console.log('Real repo test choices:', choices.map((c) => c.label).join(', '));
      } finally {
        runner.dispose();
      }
    });
  }
});
