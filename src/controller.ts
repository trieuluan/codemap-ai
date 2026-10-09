import * as vscode from 'vscode';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { sys } from 'typescript';
import { AnalyzerCache, type SourceInput } from './analyzer/analyzer';
import { scanWorkspace } from './workspace';
import { UpdateScheduler } from './scheduler';
import type { GraphSnapshot, SyncState } from './shared/model';

const sourcePattern = /\.(?:[cm]?[jt]sx?)$/i;
const ignored = /(?:^|[/\\])(?:\.git|node_modules|dist|build|out|coverage|\.next|\.vscode-test)(?:[/\\]|$)/;
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
export class GraphController implements vscode.Disposable {
  readonly cache = new AnalyzerCache();
  private inputs = new Map<string, SourceInput>();
  private hashes = new Map<string, string>();
  private disposables: vscode.Disposable[] = [];
  private metadataWatchers = new Map<string, vscode.Disposable[]>();
  private disposed = false;
  readonly scheduler: UpdateScheduler<GraphSnapshot>;
  snapshot?: GraphSnapshot;
  constructor(readonly root: vscode.WorkspaceFolder,
    publish: (snapshot: GraphSnapshot) => void,
    status: (state: SyncState, autoUpdate: boolean, error?: unknown) => void,
    private log: (message: string) => void = () => {}) {
    this.scheduler = new UpdateScheduler(async (batch, signal) => {
      const cancellation = new vscode.CancellationTokenSource();
      const abort = () => cancellation.cancel();
      signal.addEventListener('abort', abort);
      if (signal.aborted) { abort(); }
      try {
        const graph = await scanWorkspace(root, cancellation.token, () => {}, {
          cache: this.cache, sources: this.inputs, changes: batch.ids, full: batch.full,
          forceResolve: batch.full, invalidateConfig: batch.invalidateConfig, revision: batch.revision, log,
        });
        for (const input of this.inputs.values()) { this.hashes.set(input.id, digest(input.text)); }
        this.watchMetadata();
        return graph;
      } finally { signal.removeEventListener('abort', abort); cancellation.dispose(); }
    }, graph => { this.snapshot = graph; publish(graph); }, (state, error) => status(state, this.scheduler.autoUpdate, error));
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '**/*'));
    this.disposables.push(watcher,
      watcher.onDidCreate(uri => this.changed(uri, true)),
      watcher.onDidDelete(uri => this.changed(uri, true)),
      watcher.onDidChange(uri => this.changed(uri, false)));
    this.disposables.push(vscode.workspace.onDidChangeTextDocument(event => {
      if (event.contentChanges.length) { this.changed(event.document.uri, false, event.document.getText()); }
    }), vscode.workspace.onDidCloseTextDocument(document => {
      if (this.inputs.has(document.uri.toString())) { this.changed(document.uri, false); }
    }), vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('files.exclude', root.uri)) { this.scheduler.mark([], true, true); }
    }));
  }
  private watchMetadata() {
    if (this.disposed) { return; }
    for (const [file, watchers] of this.metadataWatchers) {
      if (!this.cache.metadata.has(file)) {
        watchers.forEach(watcher => watcher.dispose()); this.metadataWatchers.delete(file);
      }
    }
    for (const file of this.cache.metadata) {
      if (this.metadataWatchers.has(file)) { continue; }
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.dirname(file)), path.basename(file)));
      this.metadataWatchers.set(file, [watcher,
        watcher.onDidChange(uri => this.changed(uri, false)),
        watcher.onDidCreate(uri => this.changed(uri, true)),
        watcher.onDidDelete(uri => this.changed(uri, true))]);
    }
  }
  private changed(uri: vscode.Uri, structural: boolean, text?: string) {
    if (this.disposed || uri.scheme !== 'file') { return; }
    const file = path.normalize(uri.fsPath);
    const inRoot = file.startsWith(this.root.uri.fsPath + path.sep);
    const metadata = this.cache.metadata.has(file) || (inRoot && /(?:^|[/\\])(?:tsconfig\.json|jsconfig\.json|package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/.test(file) && !ignored.test(path.relative(this.root.uri.fsPath, file)));
    if (metadata) {
      const content = text ?? vscode.workspace.textDocuments.find(document => document.uri.toString() === uri.toString())?.getText() ?? sys.readFile(file);
      const hash = content === undefined ? undefined : digest(content);
      if (this.cache.metadataHashes.has(file) && this.cache.metadataHashes.get(file) === hash) { return; }
      this.cache.metadataHashes.set(file, hash);
      this.log(`Resolver metadata changed: ${file}`);
      this.scheduler.mark([], true, true); return;
    }
    if (!inRoot || ignored.test(path.relative(this.root.uri.fsPath, file))) { return; }
    // Directory create/delete may add/remove entire subtrees.
    if (structural && !sourcePattern.test(file)) { this.scheduler.mark([], true); return; }
    if (!sourcePattern.test(file) || /\.d\.[cm]?ts$/.test(file)) { return; }
    if (!structural) {
      // Closing an analysis-only document or a duplicate filesystem notification
      // must not start another scan. Read disk without reopening a VS Code document.
      const content = text ?? vscode.workspace.textDocuments.find(document => document.uri.toString() === uri.toString())?.getText() ?? sys.readFile(file);
      const hash = content === undefined ? undefined : digest(content);
      if (this.hashes.get(uri.toString()) === hash) { return; }
      if (hash === undefined) { this.hashes.delete(uri.toString()); structural = true; }
      else { this.hashes.set(uri.toString(), hash); }
    }
    this.log(`Source ${structural ? 'set' : 'content'} changed: ${vscode.workspace.asRelativePath(uri)}`);
    this.scheduler.mark([uri.toString()], structural || !this.inputs.has(uri.toString()));
  }
  refresh() { return this.scheduler.refresh(); }
  dispose() {
    this.disposed = true;
    this.scheduler.dispose();
    for (const disposable of [...this.disposables, ...[...this.metadataWatchers.values()].flat()]) { disposable.dispose(); }
    this.metadataWatchers.clear(); this.hashes.clear();
    this.inputs.clear(); this.cache.entries.clear(); this.log('Controller disposed');
  }
}
