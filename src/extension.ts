import { buildContext, contextMarkdown, type ContextBundle } from './shared/context';
import * as vscode from 'vscode';
import { LibraryStore } from './library-store';
import { readAnnotation, annotationExists, targetKey } from './shared/library';
import { readLocation } from './shared/navigation';
import { randomBytes } from 'node:crypto';
import { GraphController } from './controller';
import { ViewStore, type StateStorage } from './view-store';
import { defaultView, reconcileView } from './shared/view';
import type { GraphSnapshot, HostMessage, ImportSite } from './shared/model';

export class CodeMapPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel;
  private snapshot?: GraphSnapshot;
  private root?: vscode.WorkspaceFolder;
  private controller?: GraphController;
  private store: ViewStore;
  private library: LibraryStore;
  private syncState = 'updating';
  private contextGeneration = 0;
  private contextPreview?: { requestId: string; bundle: ContextBundle };
  private choosing = false;
  private disposed = false;
  private ready = false;
  private activeUri = vscode.window.activeTextEditor?.document.uri.toString();
  private pendingReveal = false;
  private disposables: vscode.Disposable[] = [];

  constructor(
    extensionUri: vscode.Uri,
    private onDispose: () => void,
    private storage?: StateStorage,
    private log: (message: string) => void = () => {},
  ) {
    this.library = new LibraryStore(storage);
    this.store = new ViewStore(storage, (error) => log(`View storage: ${String(error)}`));
    this.panel = vscode.window.createWebviewPanel('codemap', 'CodeMap', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')],
    });
    const webview = this.panel.webview;
    const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js'));
    const css = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview.css'));
    const nonce = randomBytes(16).toString('hex');
    webview.html = `<!doctype html><html lang="en"><head><meta charset="UTF-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};">
      <link rel="stylesheet" href="${css}"><title>CodeMap</title></head>
      <body><div id="root"></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
    this.disposables.push(this.panel.onDidDispose(() => this.dispose()));
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.activeUri = editor.document.uri.toString();
          this.publishActiveFile();
        }
      }),
    );
    this.disposables.push(
      webview.onDidReceiveMessage((message) => {
        void this.handleMessage(message);
      }),
    );
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        if (
          this.root &&
          !vscode.workspace.workspaceFolders?.some(
            (root) => root.uri.toString() === this.root?.uri.toString(),
          )
        ) {
          this.controller?.dispose();
          this.controller = undefined;
          this.root = undefined;
          this.snapshot = undefined;
          this.post({
            type: 'empty',
            message: 'Workspace changed.',
            openFolder: !vscode.workspace.workspaceFolders?.length,
          });
          void this.refresh();
        }
      }),
    );
  }
  reveal() {
    this.panel.reveal();
  }
  revealActiveFile() {
    this.pendingReveal = true;
    if (this.snapshot) {
      this.publishActiveFile();
    }
  }
  private publishActiveFile() {
    const nodeId = this.snapshot?.nodes.find((node) => node.id === this.activeUri)?.id;
    this.post({ type: 'activeFile', nodeId, reveal: this.pendingReveal });
    this.pendingReveal = false;
  }
  private post(message: HostMessage) {
    if (!this.disposed) {
      void this.panel.webview.postMessage(message);
    }
  }
  async handleMessage(message: unknown) {
    if (!message || typeof message !== 'object' || !('type' in message)) {
      return;
    }
    try {
      switch (message.type) {
        case 'ready':
          if (!this.ready) {
            this.ready = true;
            await this.refresh();
          }
          break;
        case 'revealActiveFile':
          this.revealActiveFile();
          break;
        case 'refresh':
          await this.refresh();
          break;
        case 'cancel':
          this.controller?.scheduler.cancel();
          if (this.root) {
            const state = { ...this.store.get(this.root.uri.toString()), autoUpdate: false };
            this.store.save(this.root.uri.toString(), state);
            this.post({ type: 'viewState', rootId: this.root.uri.toString(), state });
          }
          break;
        case 'changeFolder':
          await this.refresh(true);
          break;
        case 'buildContext': {
          if (
            !this.snapshot ||
            !('rootId' in message) ||
            message.rootId !== this.snapshot.root.id ||
            !('requestId' in message) ||
            typeof message.requestId !== 'string' ||
            !('fileIds' in message) ||
            !Array.isArray(message.fileIds) ||
            !message.fileIds.every((id) => typeof id === 'string')
          ) {
            return;
          }
          const rootId = this.snapshot.root.id;
          const requestId = message.requestId;
          const generation = ++this.contextGeneration;
          this.contextPreview = undefined;
          if (
            !('revision' in message) ||
            message.revision !== this.snapshot.revision ||
            this.syncState !== 'up-to-date'
          ) {
            this.post({
              type: 'contextResult',
              rootId,
              requestId,
              error:
                'Graph is out of date. Refresh or wait for synchronization, then preview again.',
            });
            break;
          }
          const graph = this.snapshot;
          const allowed = new Set(graph.nodes.map((n) => n.id));
          if (message.fileIds.length > 10000 || message.fileIds.some((id) => !allowed.has(id))) {
            this.post({
              type: 'contextResult',
              rootId,
              requestId,
              error: 'Selection contains files outside the current graph.',
            });
            break;
          }
          const bundle = await buildContext(
            graph,
            message.fileIds,
            this.library.get(rootId).annotations,
            async (id) => {
              if (this.disposed || generation !== this.contextGeneration) {
                throw new Error('Preview cancelled');
              }
              return (await vscode.workspace.openTextDocument(vscode.Uri.parse(id))).getText();
            },
          );
          if (
            this.disposed ||
            generation !== this.contextGeneration ||
            this.snapshot?.root.id !== rootId
          ) {
            break;
          }
          if (this.snapshot.revision !== graph.revision || this.syncState !== 'up-to-date') {
            this.post({
              type: 'contextResult',
              rootId,
              requestId,
              error: 'Source changed during preview. Preview again after synchronization.',
            });
            break;
          }
          this.contextPreview = { requestId, bundle };
          this.post({ type: 'contextResult', rootId, requestId, bundle });
          break;
        }
        case 'copyContext': {
          if (
            !this.snapshot ||
            !this.contextPreview ||
            !('rootId' in message) ||
            message.rootId !== this.snapshot?.root.id ||
            !('requestId' in message) ||
            message.requestId !== this.contextPreview.requestId
          ) {
            break;
          }
          const { bundle, requestId } = this.contextPreview;
          if (bundle.revision !== this.snapshot.revision || this.syncState !== 'up-to-date') {
            this.post({
              type: 'contextResult',
              rootId: bundle.rootId,
              requestId,
              error: 'Preview is stale. Preview again before copying.',
            });
            break;
          }
          await vscode.env.clipboard.writeText(contextMarkdown(bundle));
          this.post({ type: 'contextCopied', rootId: bundle.rootId, requestId });
          break;
        }
        case 'saveBookmark':
        case 'renameBookmark':
        case 'deleteBookmark':
        case 'saveAnnotation':
        case 'deleteAnnotation': {
          if (
            !this.snapshot ||
            !this.root ||
            !('rootId' in message) ||
            message.rootId !== this.root.uri.toString()
          ) {
            return;
          }
          const root = this.root.uri.toString();
          const library = structuredClone(this.library.get(root));
          if (message.type === 'saveAnnotation' || message.type === 'deleteAnnotation') {
            const annotation = readAnnotation(
              'annotation' in message ? message.annotation : undefined,
            );
            if (
              !annotation ||
              (message.type === 'saveAnnotation' &&
                !annotationExists(annotation.target, this.snapshot))
            ) {
              return;
            }
            library.annotations = library.annotations.filter(
              (a) => targetKey(a.target) !== targetKey(annotation.target),
            );
            if (message.type === 'saveAnnotation') {
              library.annotations.push(annotation);
            }
          } else {
            const id = 'id' in message && typeof message.id === 'string' ? message.id : undefined;
            const existing = library.views.find((v) => v.id === id);
            if (message.type === 'deleteBookmark') {
              library.views = library.views.filter((v) => v.id !== id);
            } else {
              if (
                !('name' in message) ||
                typeof message.name !== 'string' ||
                !message.name.trim() ||
                message.name.length > 100
              ) {
                return;
              }
              if (message.type === 'renameBookmark') {
                if (!existing) {
                  return;
                }
                existing.name = message.name.trim();
              } else {
                const location = readLocation('location' in message ? message.location : undefined);
                if (!location || (id && !existing) || (!existing && library.views.length >= 100)) {
                  return;
                }
                const saved = {
                  id: id ?? randomBytes(12).toString('hex'),
                  name: message.name.trim(),
                  location,
                };
                library.views = [...library.views.filter((v) => v.id !== id), saved];
              }
            }
          }
          await this.library.save(root, library);
          if (this.root?.uri.toString() === root) {
            this.post({ type: 'library', rootId: root, library: this.library.get(root) });
          }
          break;
        }
        case 'saveView':
          if (
            'rootId' in message &&
            message.rootId === this.root?.uri.toString() &&
            'state' in message
          ) {
            this.store.save(message.rootId as string, message.state);
          }
          break;
        case 'autoUpdate':
          if ('enabled' in message && typeof message.enabled === 'boolean' && this.root) {
            this.store.save(this.root.uri.toString(), {
              ...this.store.get(this.root.uri.toString()),
              autoUpdate: message.enabled,
            });
            this.controller?.scheduler.setAutoUpdate(message.enabled);
          }
          break;
        case 'resetView':
          if (this.root) {
            const state = defaultView();
            this.store.save(this.root.uri.toString(), state);
            this.controller?.scheduler.setAutoUpdate(true);
            this.post({ type: 'viewState', rootId: this.root.uri.toString(), state });
          }
          break;
        case 'layoutStats':
          if (
            'milliseconds' in message &&
            typeof message.milliseconds === 'number' &&
            Number.isFinite(message.milliseconds) &&
            'nodes' in message &&
            typeof message.nodes === 'number'
          ) {
            this.log(`Layout ${message.nodes} nodes: ${message.milliseconds.toFixed(1)} ms`);
          }
          break;
        case 'openFolder':
          await vscode.commands.executeCommand('vscode.openFolder');
          break;
        case 'openFile':
        case 'openSymbol':
        case 'openDeclaration':
        case 'openImport': {
          if (!('nodeId' in message) || typeof message.nodeId !== 'string') {
            return;
          }
          const node = this.snapshot?.nodes.find((item) => item.id === message.nodeId);
          if (!node) {
            return;
          }
          let site: ImportSite | undefined;
          if (message.type === 'openImport' || message.type === 'openDeclaration') {
            if (!('siteId' in message) || typeof message.siteId !== 'string') {
              return;
            }
            site = this.snapshot?.edges
              .filter((edge) => edge.source === node.id)
              .flatMap((edge) => edge.sites)
              .concat(node.outside.map((item) => item.site))
              .find((item) => item.id === message.siteId);
            if (!site) {
              return;
            }
          }
          let target = node;
          let location: { line: number; character: number } | undefined = site;
          if (message.type === 'openSymbol') {
            if (!('symbolId' in message) || typeof message.symbolId !== 'string') {
              return;
            }
            const symbol = node.declarations?.find((item) => item.id === message.symbolId);
            if (!symbol) {
              return;
            }
            location = symbol;
          }
          if (message.type === 'openDeclaration') {
            if (!('symbolId' in message) || typeof message.symbolId !== 'string') {
              return;
            }
            const declaration = site?.symbols?.find(
              (symbol) => symbol.id === message.symbolId,
            )?.declaration;
            const declarationNode = this.snapshot?.nodes.find(
              (item) => item.id === declaration?.nodeId,
            );
            const symbol = declarationNode?.declarations?.find(
              (item) => item.id === declaration?.symbolId,
            );
            if (!declarationNode || !symbol) {
              return;
            }
            target = declarationNode;
            location = symbol;
          }
          const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(target.id));
          const position = location
            ? document.validatePosition(new vscode.Position(location.line, location.character))
            : undefined;
          await vscode.window.showTextDocument(document, {
            viewColumn: vscode.ViewColumn.Beside,
            selection: position ? new vscode.Range(position, position) : undefined,
            preview: true,
          });
          break;
        }
      }
    } catch (error) {
      this.post({ type: 'error', message: String(error) });
    }
  }
  private async refresh(changeRoot = false) {
    if (this.disposed || this.choosing) {
      return;
    }
    if (this.controller && !changeRoot) {
      await this.controller.refresh();
      return;
    }
    const roots = vscode.workspace.workspaceFolders ?? [];
    if (!roots.length) {
      this.post({
        type: 'empty',
        message: 'Open a folder to map its source code.',
        openFolder: true,
      });
      return;
    }
    this.choosing = true;
    try {
      const previousRoot = !changeRoot ? this.storage?.get<string>('codemap.lastRoot') : undefined;
      const remembered = roots.find((root) => root.uri.toString() === previousRoot);
      const root =
        roots.length === 1
          ? roots[0]
          : (remembered ??
            (await vscode.window
              .showQuickPick(
                roots.map((folder) => ({
                  label: folder.name,
                  description: folder.uri.fsPath,
                  folder,
                })),
                { placeHolder: 'Choose the workspace folder to map' },
              )
              .then((item) => item?.folder)));
      if (!root || this.disposed) {
        return;
      }
      if (root.uri.scheme !== 'file') {
        this.post({ type: 'error', message: 'CodeMap supports filesystem workspaces only.' });
        return;
      }
      if (root.uri.toString() === this.root?.uri.toString() && this.controller) {
        await this.controller.refresh();
        return;
      }
      this.controller?.dispose();
      this.root = root;
      this.snapshot = undefined;
      this.contextPreview = undefined;
      this.contextGeneration++;
      const rootId = root.uri.toString();
      await this.store.flush();
      await this.storage?.update('codemap.lastRoot', rootId);
      this.post({ type: 'empty', message: 'Scanning selected workspace…', openFolder: false });
      this.post({ type: 'viewState', rootId, state: this.store.get(rootId) });
      this.controller = new GraphController(
        root,
        (snapshot) => {
          if (this.disposed || this.root?.uri.toString() !== rootId) {
            return;
          }
          this.snapshot = snapshot;
          this.post({
            type: 'library',
            rootId: snapshot.root.id,
            library: this.library.get(snapshot.root.id),
          });
          const state = reconcileView(this.store.get(rootId), snapshot);
          this.store.save(rootId, state);
          this.post({ type: 'snapshot', snapshot, viewState: state });
          this.publishActiveFile();
        },
        (state, autoUpdate, error) => {
          this.syncState = state;
          this.post({ type: 'sync', state, autoUpdate });
          this.post({
            type: 'status',
            scanning: state === 'updating',
            message: state === 'updating' ? 'Updating source map…' : '',
          });
          if (error) {
            this.post({ type: 'error', message: `Update failed: ${String(error)}` });
          }
        },
        this.log,
      );
      this.controller.scheduler.setAutoUpdate(this.store.get(rootId).autoUpdate);
      await this.controller.refresh();
    } finally {
      this.choosing = false;
    }
  }
  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.contextPreview = undefined;
    this.contextGeneration++;
    this.controller?.dispose();
    void this.store.flush();
    void this.library.flush();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.panel.dispose();
    this.onDispose();
  }
}
export function activate(context: vscode.ExtensionContext) {
  let panel: CodeMapPanel | undefined;
  const output = vscode.window.createOutputChannel('CodeMap');
  context.subscriptions.push(output);
  context.subscriptions.push(
    vscode.commands.registerCommand('codemap-ai.openGraph', () => {
      if (panel) {
        panel.reveal();
      } else {
        panel = new CodeMapPanel(
          context.extensionUri,
          () => {
            panel = undefined;
          },
          context.workspaceState,
          (message) => output.appendLine(message),
        );
      }
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('codemap-ai.revealActiveFile', async () => {
      await vscode.commands.executeCommand('codemap-ai.openGraph');
      panel?.revealActiveFile();
    }),
  );
  context.subscriptions.push({ dispose: () => panel?.dispose() });
}
export function deactivate() {}
