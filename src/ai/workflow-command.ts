import * as vscode from 'vscode';
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { modelUnavailableReason } from '../shared/ai-model';
import { liveWorkflow } from './workflow-check';

let running = false;
/** Explicit diagnostic command; only generated fixture files are sent or edited. */
export async function runWorkflowCheck(output: vscode.OutputChannel) {
  if (running) {
    void vscode.window.showInformationMessage('A CodeMap workflow check is already running.');
    return;
  }
  if (!vscode.workspace.isTrusted || !vscode.workspace.workspaceFolders?.length) {
    void vscode.window.showWarningMessage(
      'Open a trusted local folder before checking the AI workflow.',
    );
    return;
  }
  running = true;
  try {
    const models = (await vscode.lm.selectChatModels()).filter((m) => !modelUnavailableReason(m));
    if (!models.length) {
      void vscode.window.showWarningMessage(
        'No compatible VS Code AI model. Enable a provider and sign in first.',
      );
      return;
    }
    const configured = vscode.workspace.getConfiguration('codemap.ai').get<string>('model');
    const model =
      models.find((m) => m.id === configured) ??
      (
        await vscode.window.showQuickPick(
          models.map((model) => ({ label: model.name, description: model.vendor, model })),
          {
            title: 'CodeMap · AI workflow check',
            placeHolder: 'Six AI requests using synthetic source only; no workspace source sent',
          },
        )
      )?.model;
    if (!model) {
      return;
    }
    output.show(true);
    output.appendLine(
      `Workflow check started: ${model.vendor} / ${model.name}. Synthetic source only.`,
    );
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'CodeMap · Synthetic AI workflow check',
        cancellable: true,
      },
      (progress, token) =>
        liveWorkflow(model, {
          token,
          progress: (message) => {
            progress.report({ message });
            output.appendLine(`Workflow: ${message}`);
          },
        }),
    );
    const path = join(tmpdir(), `codemap-workflow-report-${randomUUID()}.json`);
    await writeFile(
      path,
      JSON.stringify({ checkedAt: new Date().toISOString(), ...result }, null, 2),
    );
    output.appendLine(JSON.stringify(result, null, 2));
    output.appendLine(`Workflow report: ${path}`);
    if (result.status === 'passed') {
      void vscode.window.showInformationMessage(
        'CodeMap workflow passed: Plan, preview, Apply, tests and repair.',
      );
    } else {
      void vscode.window.showWarningMessage(
        `CodeMap workflow ${result.status}. See Output → CodeMap.`,
      );
    }
    return result;
  } catch (error) {
    output.appendLine(`Workflow check failed: ${String(error)}`);
    void vscode.window.showErrorMessage(`CodeMap workflow check: ${String(error)}`);
  } finally {
    running = false;
  }
}
