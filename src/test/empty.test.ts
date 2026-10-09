import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { CodeMapPanel } from '../extension';
suite('CodeMap empty window', () => {
  test('opens and refreshes safely without a workspace', async () => {
    assert.equal(vscode.workspace.workspaceFolders?.length ?? 0, 0);
    const extension = vscode.extensions.all.find((item) => item.packageJSON.name === 'codemap-ai')!;
    const panel = new CodeMapPanel(extension.extensionUri, () => {});
    try {
      await panel.handleMessage({ type: 'ready' });
      await panel.handleMessage({ type: 'refresh' });
      await panel.handleMessage({ type: 'openFile', nodeId: 'file:///etc/hosts' });
      assert.equal(vscode.window.activeTextEditor, undefined);
    } finally {
      panel.dispose();
    }
  });
});
