import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { CodeMapPanel } from '../extension';
import { scanWorkspace } from '../workspace';

suite('CodeMap extension integration', () => {
  const root = () => vscode.workspace.workspaceFolders![0];
  const scan = () => scanWorkspace(root(), new vscode.CancellationTokenSource().token, () => {});
  test('registers the command and opens/reveals its panel', async () => {
    const extension = vscode.extensions.all.find((item) => item.packageJSON.name === 'codemap-ai');
    assert.ok(extension);
    await extension.activate();
    assert.ok((await vscode.commands.getCommands()).includes('codemap-ai.openGraph'));
    await vscode.commands.executeCommand('codemap-ai.openGraph');
    await vscode.commands.executeCommand('codemap-ai.openGraph');
    await new Promise<void>((resolve, reject) => {
      const count = () =>
        vscode.window.tabGroups.all
          .flatMap((group) => group.tabs)
          .filter((tab) => tab.label === 'CodeMap').length;
      if (count() === 1) {
        resolve();
        return;
      }
      const timeout = setTimeout(() => {
        listener.dispose();
        reject(new Error('CodeMap tab did not appear'));
      }, 1500);
      const listener = vscode.window.tabGroups.onDidChangeTabs(() => {
        if (count() === 1) {
          clearTimeout(timeout);
          listener.dispose();
          resolve();
        }
      });
    });
    assert.equal(
      vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .filter((tab) => tab.label === 'CodeMap').length,
      1,
    );
  });
  test('scans workspace source and excludes declarations and build output', async () => {
    const graph = await scan();
    assert.deepEqual(
      graph.nodes.map((node) => node.name),
      ['a.ts', 'b.ts'],
    );
    assert.equal(graph.edges.length, 1);
  });
  test('reads unsaved edits and refreshes after file creation/deletion', async () => {
    const uri = vscode.Uri.joinPath(root().uri, 'a.ts');
    const document = await vscode.workspace.openTextDocument(uri);
    const original = document.getText();
    const added = vscode.Uri.joinPath(root().uri, 'added.ts');
    try {
      await vscode.workspace.fs.writeFile(added, Buffer.from('export {};'));
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        uri,
        new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
        'import "./added";',
      );
      await vscode.workspace.applyEdit(edit);
      assert.ok(document.isDirty);
      const graph = await scan();
      assert.equal(graph.nodes.length, 3);
      assert.ok(graph.edges.some((edge) => edge.target === added.toString()));
    } finally {
      const restore = new vscode.WorkspaceEdit();
      restore.replace(
        uri,
        new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
        original,
      );
      await vscode.workspace.applyEdit(restore);
      await document.save();
      await vscode.workspace.fs.delete(added);
    }
    assert.equal((await scan()).nodes.length, 2);
  });
  test('opens snapshot source/import locations and rejects arbitrary navigation', async () => {
    const extension = vscode.extensions.all.find((item) => item.packageJSON.name === 'codemap-ai')!;
    const panel = new CodeMapPanel(extension.extensionUri, () => {});
    try {
      await panel.handleMessage({ type: 'ready' });
      const graph = await scan();
      const a = graph.nodes.find((node) => node.name === 'a.ts')!;
      const site = graph.edges[0].sites[0];
      await panel.handleMessage({ type: 'openImport', nodeId: a.id, siteId: site.id });
      assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), a.id);
      assert.equal(vscode.window.activeTextEditor?.selection.start.line, site.line);
      assert.equal(vscode.window.activeTextEditor?.selection.start.character, site.character);
      await panel.handleMessage({ type: 'openFile', nodeId: 'file:///etc/hosts' });
      assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), a.id);
      await panel.handleMessage({ type: 'openImport', nodeId: a.id, siteId: 'unknown' });
      assert.equal(vscode.window.activeTextEditor?.selection.start.character, site.character);
    } finally {
      panel.dispose();
    }
  });
  test('opens a symbol declaration through a barrel and rejects unknown symbol IDs', async () => {
    const root = vscode.workspace.workspaceFolders![0];
    const contents = {
      'symbol-source.ts': 'export class Widget {}',
      'symbol-barrel.ts': 'export { Widget as Item } from "./symbol-source";',
      'symbol-consumer.ts': 'import { Item as Card } from "./symbol-barrel";',
    };
    const extension = vscode.extensions.all.find((item) => item.packageJSON.name === 'codemap-ai')!;
    let panel: CodeMapPanel | undefined;
    try {
      for (const [name, text] of Object.entries(contents)) {
        await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(root.uri, name), Buffer.from(text));
      }
      panel = new CodeMapPanel(extension.extensionUri, () => {});
      await panel.handleMessage({ type: 'ready' });
      const graph = await scan();
      const edge = graph.edges.find((edge) => edge.source.endsWith('/symbol-consumer.ts'))!;
      const site = edge.sites[0];
      const symbol = site.symbols![0];
      const declaration = graph.nodes.find((node) => node.id === symbol.declaration?.nodeId)!;
      const location = declaration.declarations!.find(
        (item) => item.id === symbol.declaration!.symbolId,
      )!;
      await panel.handleMessage({
        type: 'openDeclaration',
        nodeId: edge.source,
        siteId: site.id,
        symbolId: symbol.id,
      });
      assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), declaration.id);
      assert.equal(vscode.window.activeTextEditor?.selection.start.line, location.line);
      assert.equal(vscode.window.activeTextEditor?.selection.start.character, location.character);
      await panel.handleMessage({
        type: 'openDeclaration',
        nodeId: edge.source,
        siteId: site.id,
        symbolId: 'unknown',
      });
      assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), declaration.id);
    } finally {
      panel?.dispose();
      for (const name of Object.keys(contents)) {
        await vscode.workspace.fs.delete(vscode.Uri.joinPath(root.uri, name));
      }
    }
  });
});

suite('CodeMap live controller', function () {
  this.timeout(12000);
  async function until(predicate: () => boolean) {
    const deadline = Date.now() + 6000;
    while (!predicate()) {
      if (Date.now() > deadline) {
        throw new Error('Timed out waiting for graph update');
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  test('Refresh stays idle when VS Code closes unchanged documents loaded for analysis', async () => {
    const { GraphController } = await import('../controller.js');
    const root = vscode.workspace.workspaceFolders![0];
    const logs: string[] = [];
    const controller = new GraphController(
      root,
      () => {},
      () => {},
      (message) => logs.push(message),
    );
    const uri = vscode.Uri.joinPath(root.uri, 'b.ts');
    const document = await vscode.workspace.openTextDocument(uri);
    const language = document.languageId;
    let closed = false;
    const listener = vscode.workspace.onDidCloseTextDocument((doc) => {
      if (doc.uri.toString() === uri.toString()) {
        closed = true;
      }
    });
    try {
      await controller.refresh();
      // Files deleted by the previous integration can arrive in the new broad
      // watcher after construction. Let those legitimate structural updates settle.
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const scans = logs.filter((message) => message.startsWith('Analyze ')).length;
      // Changing language emits a real close/open lifecycle without editing source.
      await vscode.languages.setTextDocumentLanguage(document, 'plaintext');
      assert.ok(closed);
      await new Promise((resolve) => setTimeout(resolve, 1800));
      assert.equal(
        logs.filter((message) => message.startsWith('Analyze ')).length,
        scans,
        logs.join('\n'),
      );
    } finally {
      controller.dispose();
      listener.dispose();
      await vscode.languages.setTextDocumentLanguage(
        await vscode.workspace.openTextDocument(uri),
        language,
      );
    }
  });
  test('tracks dirty source, structural events, Auto Update and disposal', async () => {
    const { GraphController } = await import('../controller.js');
    const root = vscode.workspace.workspaceFolders![0];
    const published: import('../shared/model').GraphSnapshot[] = [];
    const statuses: string[] = [];
    const controller = new GraphController(
      root,
      (graph) => published.push(graph),
      (state) => statuses.push(state),
    );
    const a = vscode.Uri.joinPath(root.uri, 'a.ts');
    const added = vscode.Uri.joinPath(root.uri, 'watch.ts');
    const document = await vscode.workspace.openTextDocument(a);
    const original = document.getText();
    async function replace(text: string) {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        a,
        new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
        text,
      );
      await vscode.workspace.applyEdit(edit);
    }
    try {
      await controller.refresh();
      const initial = published.length;
      controller.scheduler.setAutoUpdate(false);
      await replace('import "./watch";');
      await until(() => statuses.at(-1) === 'out-of-date');
      await new Promise((resolve) => setTimeout(resolve, 850));
      assert.equal(published.length, initial);
      controller.scheduler.setAutoUpdate(true);
      await until(() => published.length > initial);
      assert.equal(published.at(-1)!.edges.length, 0);
      const beforeCreate = published.length;
      await vscode.workspace.fs.writeFile(added, Buffer.from('export {};'));
      await until(
        () =>
          published.length > beforeCreate &&
          published.at(-1)!.nodes.some((node) => node.name === 'watch.ts'),
      );
      assert.ok(published.at(-1)!.edges.some((edge) => edge.target === added.toString()));
      const beforeDelete = published.length;
      await vscode.workspace.fs.delete(added);
      await until(
        () =>
          published.length > beforeDelete &&
          !published.at(-1)!.nodes.some((node) => node.name === 'watch.ts'),
      );
      controller.dispose();
      const finalCount = published.length;
      await replace(original);
      await new Promise((resolve) => setTimeout(resolve, 850));
      assert.equal(published.length, finalCount);
    } finally {
      controller.dispose();
      await replace(original);
      await document.save();
      try {
        await vscode.workspace.fs.delete(added);
      } catch {
        /* Already deleted. */
      }
    }
  });
  test('persists and resets view state through the panel protocol', async () => {
    const { defaultView } = await import('../shared/view.js');
    const values = new Map<string, unknown>();
    const storage: import('../view-store').StateStorage = {
      get<T>(key: string) {
        return values.get(key) as T | undefined;
      },
      update: async (key, value) => {
        values.set(key, value);
      },
    };
    const extension = vscode.extensions.all.find((item) => item.packageJSON.name === 'codemap-ai')!;
    const rootId = vscode.workspace.workspaceFolders![0].uri.toString();
    const panel = new CodeMapPanel(extension.extensionUri, () => {}, storage);
    await panel.handleMessage({ type: 'ready' });
    await panel.handleMessage({
      type: 'saveView',
      rootId,
      state: { ...defaultView(), mode: 'folders', hideTests: true },
    });
    panel.dispose();
    await until(
      () => (values.get(`codemap.view.${rootId}`) as { hideTests?: boolean })?.hideTests === true,
    );
    const reopened = new CodeMapPanel(extension.extensionUri, () => {}, storage);
    try {
      await reopened.handleMessage({ type: 'ready' });
      assert.equal((values.get(`codemap.view.${rootId}`) as { mode: string }).mode, 'folders');
      await reopened.handleMessage({ type: 'resetView' });
    } finally {
      reopened.dispose();
    }
    await until(
      () => (values.get(`codemap.view.${rootId}`) as { hideTests?: boolean })?.hideTests === false,
    );
  });
});

suite('CodeMap resolver metadata watching', function () {
  this.timeout(12000);
  test('ignores duplicate config notifications and preserves metadata watchers across Refresh', async () => {
    const { GraphController } = await import('../controller.js');
    const root = vscode.workspace.workspaceFolders![0];
    const config = vscode.Uri.joinPath(root.uri, 'tsconfig.json');
    const content = Buffer.from('{"compilerOptions":{"module":"ESNext"}}');
    const logs: string[] = [];
    let controller: InstanceType<typeof GraphController> | undefined;
    try {
      await vscode.workspace.fs.writeFile(config, content);
      controller = new GraphController(
        root,
        () => {},
        () => {},
        (message) => logs.push(message),
      );
      await controller.refresh();
      await controller.refresh();
      const scans = logs.filter((message) => message.startsWith('Analyze ')).length;
      await vscode.workspace.fs.writeFile(config, content);
      await new Promise((resolve) => setTimeout(resolve, 1800));
      assert.equal(logs.filter((message) => message.startsWith('Analyze ')).length, scans);
    } finally {
      controller?.dispose();
      await vscode.workspace.fs.delete(config);
    }
  });
  test('invalidates inherited config outside the root and updates unsaved aliases', async () => {
    const { GraphController } = await import('../controller.js');
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codemap-config-'));
    const root = vscode.workspace.workspaceFolders![0];
    const base = path.join(directory, 'base.json');
    const config = vscode.Uri.joinPath(root.uri, 'tsconfig.json');
    const a = vscode.Uri.joinPath(root.uri, 'a.ts');
    const document = await vscode.workspace.openTextDocument(a);
    const original = document.getText();
    const graphs: import('../shared/model').GraphSnapshot[] = [];
    let controller: InstanceType<typeof GraphController> | undefined;
    async function replace(text: string) {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        a,
        new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
        text,
      );
      await vscode.workspace.applyEdit(edit);
    }
    try {
      fs.writeFileSync(
        base,
        JSON.stringify({
          compilerOptions: { paths: { '@mapped': [vscode.Uri.joinPath(root.uri, 'b.ts').fsPath] } },
        }),
      );
      await vscode.workspace.fs.writeFile(config, Buffer.from(JSON.stringify({ extends: base })));
      await replace('import "@mapped";');
      controller = new GraphController(
        root,
        (graph) => graphs.push(graph),
        () => {},
      );
      await controller.refresh();
      assert.equal(graphs.at(-1)!.edges.length, 1);
      const count = graphs.length;
      fs.writeFileSync(
        base,
        JSON.stringify({
          compilerOptions: {
            paths: { '@mapped': [vscode.Uri.joinPath(root.uri, 'missing.ts').fsPath] },
          },
        }),
      );
      const deadline = Date.now() + 6000;
      while (graphs.length === count) {
        if (Date.now() > deadline) {
          throw new Error('Inherited config watcher did not update');
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(graphs.at(-1)!.edges.length, 0);
      assert.equal(
        graphs.at(-1)!.nodes.find((node) => node.name === 'a.ts')!.outside[0].status,
        'unresolved',
      );
    } finally {
      controller?.dispose();
      await replace(original);
      await document.save();
      await vscode.workspace.fs.delete(config);
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

suite('CodeMap editor and symbol navigation', () => {
  test('tracks active source files, validates symbol navigation and disposes editor listeners', async () => {
    const extension = vscode.extensions.all.find((item) => item.packageJSON.name === 'codemap-ai')!;
    const root = vscode.workspace.workspaceFolders![0];
    const uri = vscode.Uri.joinPath(root.uri, 'editor-symbol.ts');
    await vscode.workspace.fs.writeFile(uri, Buffer.from('\nexport function Selected() {}'));
    const messages: import('../shared/model').HostMessage[] = [];
    const panel = new CodeMapPanel(extension.extensionUri, () => {});
    const observed = panel as unknown as {
      post(message: import('../shared/model').HostMessage): void;
    };
    const originalPost = observed.post.bind(panel);
    observed.post = (message) => {
      messages.push(message);
      originalPost(message);
    };
    try {
      await panel.handleMessage({ type: 'ready' });
      await vscode.window.showTextDocument(uri);
      panel.revealActiveFile();
      assert.ok(
        messages.some(
          (message) =>
            message.type === 'activeFile' && message.nodeId === uri.toString() && message.reveal,
        ),
      );
      const graph = await scanWorkspace(root, new vscode.CancellationTokenSource().token, () => {});
      const node = graph.nodes.find((node) => node.id === uri.toString())!;
      const symbol = node.declarations![0];
      await panel.handleMessage({ type: 'openSymbol', nodeId: node.id, symbolId: symbol.id });
      assert.equal(vscode.window.activeTextEditor?.selection.start.line, 1);
      assert.equal(vscode.window.activeTextEditor?.selection.start.character, symbol.character);
      await panel.handleMessage({ type: 'openSymbol', nodeId: node.id, symbolId: 'invalid' });
      assert.equal(vscode.window.activeTextEditor?.selection.start.line, 1);
      await vscode.window.showTextDocument(vscode.Uri.joinPath(root.uri, 'b.ts'));
      assert.ok(
        messages.some(
          (message) =>
            message.type === 'activeFile' && message.nodeId?.endsWith('/b.ts') && !message.reveal,
        ),
      );
      assert.ok((await vscode.commands.getCommands()).includes('codemap-ai.revealActiveFile'));
      panel.dispose();
      const count = messages.length;
      await vscode.window.showTextDocument(vscode.Uri.joinPath(root.uri, 'a.ts'));
      assert.equal(messages.length, count);
    } finally {
      panel.dispose();
      await vscode.workspace.fs.delete(uri);
    }
  });
});

suite('CodeMap saved views and architecture notes', () => {
  test('persists library across panels, rejects foreign roots and does not store source', async () => {
    const extension = vscode.extensions.all.find((item) => item.packageJSON.name === 'codemap-ai')!;
    const rootId = vscode.workspace.workspaceFolders![0].uri.toString();
    const data = new Map<string, unknown>();
    const storage = {
      get: <T>(key: string) => data.get(key) as T | undefined,
      update: async (key: string, value: unknown) => {
        data.set(key, structuredClone(value));
      },
    };
    const { defaultView } = await import('../shared/view.js');
    let panel = new CodeMapPanel(extension.extensionUri, () => {}, storage);
    try {
      await panel.handleMessage({ type: 'ready' });
      const nodeId = vscode.Uri.joinPath(
        vscode.workspace.workspaceFolders![0].uri,
        'a.ts',
      ).toString();
      const location = {
        view: { ...defaultView(), selected: nodeId },
        peek: [],
        positions: {},
        source: 'must not persist',
      };
      await panel.handleMessage({
        type: 'saveBookmark',
        rootId: 'foreign',
        name: 'Invalid',
        location,
      });
      await panel.handleMessage({ type: 'saveBookmark', rootId, name: 'Overview', location });
      await panel.handleMessage({
        type: 'saveAnnotation',
        rootId,
        annotation: { target: { kind: 'file', id: nodeId }, text: 'Entry point', role: 'API' },
      });
      await panel.handleMessage({
        type: 'saveAnnotation',
        rootId,
        annotation: { target: { kind: 'file', id: 'foreign' }, text: 'Invalid' },
      });
      const library = data.get(
        `codemap.library.${rootId}`,
      ) as import('../shared/library').WorkspaceLibrary;
      assert.equal(library.views.length, 1);
      assert.equal(library.annotations.length, 1);
      assert.ok(!JSON.stringify(library).includes('must not persist'));
      panel.dispose();
      panel = new CodeMapPanel(extension.extensionUri, () => {}, storage);
      const messages: import('../shared/model').HostMessage[] = [];
      const observed = panel as unknown as {
        post(message: import('../shared/model').HostMessage): void;
      };
      const post = observed.post.bind(panel);
      observed.post = (message) => {
        messages.push(message);
        post(message);
      };
      await panel.handleMessage({ type: 'ready' });
      assert.ok(
        messages.some(
          (m) =>
            m.type === 'library' &&
            m.library.views[0]?.name === 'Overview' &&
            m.library.annotations[0]?.text === 'Entry point',
        ),
      );
      const id = library.views[0].id;
      await panel.handleMessage({ type: 'renameBookmark', rootId, id, name: 'Renamed' });
      await panel.handleMessage({ type: 'deleteBookmark', rootId, id });
      await panel.handleMessage({
        type: 'deleteAnnotation',
        rootId,
        annotation: library.annotations[0],
      });
      const final = data.get(
        `codemap.library.${rootId}`,
      ) as import('../shared/library').WorkspaceLibrary;
      assert.equal(final.views.length, 0);
      assert.equal(final.annotations.length, 0);
    } finally {
      panel.dispose();
    }
  });
});
