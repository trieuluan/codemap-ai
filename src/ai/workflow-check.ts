import * as vscode from 'vscode';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiSession } from './session';
import { TestRunner } from './test-runner';
import { analyze } from '../analyzer/analyzer';
import { buildContext, contextRegionKey, type ContextBundle } from '../shared/context';
import type { AiHostMessage } from '../shared/ai';
import type { GraphSnapshot } from '../shared/model';
import type { TestResult } from '../shared/verification';

/** Opt-in live Plan/Generate calls and local tests on disposable synthetic source only. */
export async function liveWorkflow(
  model: vscode.LanguageModelChat,
  options: { token?: vscode.CancellationToken; progress?: (message: string) => void } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'codemap-ai-workflow-'));
  const files = ['a.ts', 'b.ts'].map((path) => vscode.Uri.file(join(dir, path)));
  const original = [
    'import { value } from "./b";\nexport const result = value;\n',
    'export const value = 1;\n',
  ];
  files.forEach((uri, index) => writeFileSync(uri.fsPath, original[index]));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      scripts: {
        'test:pass': 'node check.cjs',
        'test:repair': 'node repair.cjs',
      },
    }),
  );
  writeFileSync(
    join(dir, 'check.cjs'),
    'const fs=require("node:fs"),assert=require("node:assert/strict"); assert.match(fs.readFileSync("a.ts","utf8"),/result\\s*=\\s*43/); assert.match(fs.readFileSync("b.ts","utf8"),/value\\s*=\\s*2/); console.log("fixture tests passed");',
  );
  writeFileSync(
    join(dir, 'repair.cjs'),
    'const fs=require("node:fs"),assert=require("node:assert/strict"); assert.match(fs.readFileSync("b.ts","utf8"),/value\\s*=\\s*3/,"b.ts must export value = 3"); console.log("repair fixture passed");',
  );
  let graph: GraphSnapshot;
  let bundle: ContextBundle;
  let revision = 0;
  const scan = async (overrides = new Map<string, string>()) =>
    analyze({
      rootPath: dir,
      rootId: vscode.Uri.file(dir).toString(),
      rootName: 'synthetic-ai-fixture',
      revision: ++revision,
      files: await Promise.all(
        files.map(async (uri) => ({
          id: uri.toString(),
          fileName: uri.fsPath,
          text:
            overrides.get(uri.toString()) ??
            (await vscode.workspace.openTextDocument(uri)).getText(),
        })),
      ),
    });
  const prepare = async (ids: string[]) => {
    bundle = await buildContext(graph, ids, [], async (id) =>
      (await vscode.workspace.openTextDocument(vscode.Uri.parse(id))).getText(),
    );
    bundle.regionKey = contextRegionKey(graph.root.id, ids);
  };
  graph = await scan();
  const events: AiHostMessage[] = [];
  const proposalIds = new Set<string>();
  const runner = new TestRunner();
  let testScript = 'test:pass';
  let editableIds: string[] | undefined;
  runner.choose = async () => ({ manager: 'npm', name: testScript });
  const session = new AiSession({
    testRunner: runner,
    post: (m) => events.push(m),
    context: () => bundle,
    graph: () => graph,
    afterApply: async () => {
      graph = await scan();
    },
    previewGraph: scan,
    editableFiles: () => editableIds ?? bundle.files.map((f) => f.id),
    configuredModel: () => model.id,
    selectModels: async () => [model],
  });
  const cancellation = options.token?.onCancellationRequested(() => {
    session.cancel();
    runner.stop();
  });
  const checkCancelled = () => {
    if (options.token?.isCancellationRequested) {
      throw new Error('Workflow check cancelled.');
    }
  };
  const report: Record<string, unknown> = {
    model: { id: model.id, vendor: model.vendor, name: model.name },
    syntheticSourceOnly: true,
    workspaceSourceSent: false,
    steps: [],
  };
  const steps = report.steps as { name: string; status: string; detail?: string }[];
  const request = async (
    id: string,
    question: string,
    mode: 'ask' | 'plan' | 'propose',
    extra = {},
  ) => {
    checkCancelled();
    options.progress?.(id);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        session.handle({
          type: 'aiRequest',
          rootId: graph.root.id,
          contextId: 'synthetic',
          requestId: id,
          question,
          mode,
          editableFileIds: editableIds ?? bundle.files.map((f) => f.id),
          ...extra,
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            session.cancel();
            reject(new Error('Model request timed out after 60 seconds.'));
          }, 60000);
        }),
      ]);
      checkCancelled();
      const done = events.find((m) => m.type === 'aiProgress' && m.requestId === id && m.done);
      if (!done || done.type !== 'aiProgress' || done.error) {
        throw new Error(done?.type === 'aiProgress' ? done.error : 'No completed reply');
      }
      return done;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  };
  const latestReport = () => events.filter((m) => m.type === 'aiVerification').at(-1)?.report;
  const runTest = async (name: string, expected: TestResult['state']) => {
    checkCancelled();
    options.progress?.(name);
    testScript = name;
    const current = latestReport();
    if (!current) {
      throw new Error('Post-Apply report missing.');
    }
    await session.handle({ type: 'aiRunTest', reportId: current.id, save: true });
    checkCancelled();
    const result = latestReport()?.test;
    if (result?.state !== expected) {
      throw new Error(`Unexpected ${name}: ${result?.state}`);
    }
    steps.push({ name, status: 'passed', detail: `Observed ${expected}, exit ${result.exitCode}` });
  };
  const reviewApply = async (
    proposal: NonNullable<Extract<AiHostMessage, { type: 'aiProgress' }>['proposal']>,
  ) => {
    checkCancelled();
    proposalIds.add(proposal.id);
    const ids = proposal.changes.map((c) => c.id);
    for (const edit of proposal.changes) {
      await session.diff(proposal.id, edit.fileId, edit.id);
    }
    checkCancelled();
    await session.apply(proposal.id, ids);
    if (!events.some((m) => m.type === 'aiApplied' && m.proposalId === proposal.id && !m.error)) {
      throw new Error('Apply failed');
    }
  };
  try {
    for (const multiple of [false, true]) {
      await prepare(multiple ? files.map((u) => u.toString()) : [files[0].toString()]);
      const question = multiple
        ? 'Set a.ts to exactly export const result = 43; and b.ts to exactly export const value = 2; with trailing newlines. Edit both files.'
        : 'Set a.ts to exactly export const result = 42; with a trailing newline. Remove its unused import.';
      const prefix = multiple ? 'multiple' : 'single';
      const plan = (await request(`${prefix}-plan`, question, 'plan')).plan;
      if (!plan || !plan.steps.some((s) => s.role === 'edit')) {
        throw new Error('Missing edit plan');
      }
      const edits = plan.steps.filter((s) => s.role === 'edit');
      if (multiple && new Set(edits.map((s) => s.fileId)).size !== 2) {
        throw new Error('Multi-file plan did not target both files');
      }
      const proposal = (
        await request(`${prefix}-generate`, question, 'propose', {
          planId: plan.id,
          planStepIds: edits.map((s) => s.id),
        })
      ).proposal;
      if (!proposal?.changes.length) {
        throw new Error('Missing source proposal');
      }
      const ids = proposal.changes.map((c) => c.id);
      const before = await Promise.all(
        files.map(async (u) => (await vscode.workspace.openTextDocument(u)).getText()),
      );
      await session.handle({ type: 'aiPreviewGraph', proposalId: proposal.id, changeIds: ids });
      const preview = events.find(
        (m) => m.type === 'aiGraphPreview' && m.proposalId === proposal.id,
      );
      if (
        preview?.type !== 'aiGraphPreview' ||
        (!multiple && preview.proposed.edges.length !== 0)
      ) {
        throw new Error('Incorrect import graph preview');
      }
      for (const [i, uri] of files.entries()) {
        if ((await vscode.workspace.openTextDocument(uri)).getText() !== before[i]) {
          throw new Error('Preview modified source');
        }
      }
      await reviewApply(proposal);
      const a = (await vscode.workspace.openTextDocument(files[0])).getText();
      if (!(multiple ? /result\s*=\s*43/ : /result\s*=\s*42/).test(a)) {
        throw new Error('Unexpected applied source');
      }
      if (
        multiple &&
        !/value\s*=\s*2/.test((await vscode.workspace.openTextDocument(files[1])).getText())
      ) {
        throw new Error('Second file not updated');
      }
      steps.push({
        name: `${prefix}: Plan → Generate → in-memory graph → diff → Apply`,
        status: 'passed',
      });
    }
    await runTest('test:pass', 'passed');
    await runTest('test:repair', 'failed');
    await prepare(files.map((u) => u.toString()));
    const verification = latestReport();
    if (!verification || verification.stale) {
      throw new Error('Repair requires a current report.');
    }
    editableIds = [files[1].toString()];
    const goal =
      'Repair the included failing test: b.ts must export value = 3. Keep a.ts unchanged. Only edit b.ts.';
    const plan = (await request('repair-plan', goal, 'plan', { verificationId: verification.id }))
      .plan;
    if (!plan || !plan.steps.some((s) => s.role === 'edit' && s.fileId === files[1].toString())) {
      throw new Error('Repair plan missing b.ts edit');
    }
    const proposal = (
      await request('repair-generate', goal, 'propose', {
        planId: plan.id,
        planStepIds: plan.steps.filter((s) => s.role === 'edit').map((s) => s.id),
        verificationId: verification.id,
      })
    ).proposal;
    if (
      !proposal?.changes.length ||
      proposal.changes.some((c) => c.fileId !== files[1].toString())
    ) {
      throw new Error('Repair must change only b.ts');
    }
    await session.handle({
      type: 'aiPreviewGraph',
      proposalId: proposal.id,
      changeIds: proposal.changes.map((c) => c.id),
    });
    if (!events.some((m) => m.type === 'aiGraphPreview' && m.proposalId === proposal.id)) {
      throw new Error('Repair graph preview missing');
    }
    await reviewApply(proposal);
    await runTest('test:repair', 'passed');
    steps.push({
      name: 'report-backed repair Plan → Generate → preview → diff → Apply → test passed',
      status: 'passed',
    });
    report.status = 'passed';
  } catch (error) {
    report.status = options.token?.isCancellationRequested ? 'cancelled' : 'failed';
    report.reason = String(error);
  } finally {
    cancellation?.dispose();
    runner.dispose();
    session.dispose();
    for (const [i, uri] of files.entries()) {
      const doc = await vscode.workspace.openTextDocument(uri);
      if (doc.isDirty) {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
          uri,
          new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)),
          original[i],
        );
        await vscode.workspace.applyEdit(edit);
        await doc.save();
      }
    }
    const fixtureTabs = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter((tab) => {
        const input = tab.input;
        if (input instanceof vscode.TabInputText) {
          return files.some((uri) => uri.toString() === input.uri.toString());
        }
        if (input instanceof vscode.TabInputTextDiff) {
          return (
            input.original.scheme.startsWith('codemap-ai-') &&
            proposalIds.has(input.original.path.split('/')[1])
          );
        }
        return false;
      });
    if (fixtureTabs.length) {
      await vscode.window.tabGroups.close(fixtureTabs);
    }
    rmSync(dir, { recursive: true, force: true });
  }
  return report;
}
