import * as vscode from 'vscode';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiSession } from '../ai/session';
import { buildContext, contextRegionKey } from '../shared/context';
import type { AiHostMessage } from '../shared/ai';
import type { GraphSnapshot } from '../shared/model';

/** Opt-in: three model requests on disposable synthetic source, never on workspace source. */
export async function liveWorkflow(model: vscode.LanguageModelChat) {
  const dir = mkdtempSync(join(tmpdir(), 'codemap-ai-workflow-'));
  const a = vscode.Uri.file(join(dir, 'a.ts'));
  const b = vscode.Uri.file(join(dir, 'b.ts'));
  const original = 'import { value } from "./b";\nexport const result = value;\n';
  writeFileSync(a.fsPath, original);
  writeFileSync(b.fsPath, 'export const value = 1;\n');
  const graph: GraphSnapshot = {
    root: { id: vscode.Uri.file(dir).toString(), name: 'synthetic-ai-fixture' },
    revision: 1,
    scannedAt: new Date().toISOString(),
    warnings: [],
    nodes: [
      {
        id: a.toString(),
        path: 'a.ts',
        name: 'a.ts',
        language: 'typescript',
        outside: [],
        declarations: [{ id: 'result', name: 'result', kind: 'value', line: 1, character: 13 }],
      },
      {
        id: b.toString(),
        path: 'b.ts',
        name: 'b.ts',
        language: 'typescript',
        outside: [],
        declarations: [{ id: 'value', name: 'value', kind: 'value', line: 0, character: 13 }],
      },
    ],
    edges: [
      {
        id: 'ab',
        source: a.toString(),
        target: b.toString(),
        sites: [{ id: 'import', specifier: './b', kind: 'import', line: 0, character: 0 }],
      },
    ],
  };
  const bundle = await buildContext(graph, [a.toString()], [], async (id) =>
    (await vscode.workspace.openTextDocument(vscode.Uri.parse(id))).getText(),
  );
  bundle.regionKey = contextRegionKey(graph.root.id, [a.toString()]);
  const events: AiHostMessage[] = [];
  let applied = 0;
  const session = new AiSession({
    post: (m) => events.push(m),
    context: () => bundle,
    graph: () => graph,
    afterApply: async () => {
      applied++;
    },
    configuredModel: () => model.id,
    selectModels: async () => [model],
  });
  const report: Record<string, unknown> = { syntheticSourceOnly: true, steps: [] };
  const steps = report.steps as { name: string; status: string; detail?: string }[];
  const ask = async (id: string, question: string, mode: 'ask' | 'propose') => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        session.handle({
          type: 'aiRequest',
          rootId: graph.root.id,
          contextId: 'synthetic',
          requestId: id,
          question,
          mode,
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            session.cancel();
            reject(new Error('Model request timed out after 60 seconds.'));
          }, 60000);
        }),
      ]);
      const done = [...events]
        .reverse()
        .find((m) => m.type === 'aiProgress' && m.requestId === id && m.done);
      if (!done || done.type !== 'aiProgress' || done.error) {
        throw new Error(done?.type === 'aiProgress' ? done.error : 'No completed reply');
      }
      return done;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  };
  try {
    const answer = await ask(
      'explain',
      'Explain the import in a.ts, cite its source line, and suggest adding b.ts to context because its implementation is missing. Include a focus action for a.ts and b.ts.',
      'ask',
    );
    const turn = [...events].reverse().find((m) => m.type === 'aiConversation');
    const actions = turn?.type === 'aiConversation' ? turn.turns.at(-1)?.actions : [];
    if (!answer.references?.length || !actions?.some((a) => a.kind === 'addContext')) {
      throw new Error('Model did not supply a valid citation and missing-context action.');
    }
    steps.push({ name: 'Explain + citations + graph suggestions', status: 'passed' });
    await ask(
      'followup',
      'Which implementation remains unknown? Use the previous answer and do not guess b.ts source.',
      'ask',
    );
    const usage = [...events]
      .reverse()
      .find((m) => m.type === 'aiUsage' && m.requestId === 'followup');
    if (usage?.type !== 'aiUsage' || usage.historyTurns < 1) {
      throw new Error('Follow-up omitted conversation history.');
    }
    steps.push({ name: 'Follow-up with fresh context', status: 'passed' });
    const proposal = await ask(
      'edit',
      'Replace a.ts with exactly: export const result = 42; followed by a newline. Remove the unused import.',
      'propose',
    );
    if (!proposal.proposal?.changes.length) {
      throw new Error('Model did not return an applicable proposal.');
    }
    steps.push({ name: 'Propose structured edit', status: 'passed' });
    for (const change of proposal.proposal.changes) {
      await session.diff(proposal.proposal.id, change.fileId);
    }
    await session.apply(proposal.proposal.id);
    const result = events.find((m) => m.type === 'aiApplied' && !m.error);
    const doc = await vscode.workspace.openTextDocument(a);
    if (!result || applied !== 1 || !doc.isDirty || !/result\s*=\s*42/.test(doc.getText())) {
      throw new Error('Reviewed proposal failed to apply to the synthetic buffer.');
    }
    steps.push({ name: 'Readonly diff + Apply to disposable unsaved buffer', status: 'passed' });
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.reason = String(error);
  } finally {
    session.dispose();
    const doc = await vscode.workspace.openTextDocument(a);
    if (doc.isDirty) {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        a,
        new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)),
        original,
      );
      await vscode.workspace.applyEdit(edit);
      await doc.save();
    }
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    rmSync(dir, { recursive: true, force: true });
  }
  return report;
}
