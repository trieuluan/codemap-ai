import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
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
      await setText(original);
      await session.apply(proposal.id, [proposal.changes[0].id]);
      const document = await vscode.workspace.openTextDocument(uri);
      assert.equal(document.getText(), 'export const a = 11;\nexport const b = 2;\n');
      assert.ok(document.isDirty);
      assert.equal(events.filter((e) => e.type === 'aiApplied' && !e.error).length, 1);
      const observed = events.find((e) => e.type === 'aiVerification');
      assert.ok(observed?.type === 'aiVerification');
      assert.ok(observed.report.stale);
      assert.match(observed.report.graphError!, /Synthetic graph failure/);
      const last = events.at(-1);
      assert.notEqual(last?.type, 'aiApplied');
      session.status();
      assert.ok(events.some((e) => e.type === 'aiProposalState' && e.state === 'applied'));
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
});
