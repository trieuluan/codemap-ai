import * as vscode from 'vscode';
import * as path from 'node:path';
import { analyze, ScanCancelled, type SourceInput, AnalyzerCache } from './analyzer/analyzer';
import type { GraphSnapshot, GraphWarning } from './shared/model';

export interface ScanOptions {
  cache?: AnalyzerCache;
  sources?: Map<string, SourceInput>;
  changes?: Set<string>;
  full?: boolean;
  invalidateConfig?: boolean;
  forceResolve?: boolean;
  revision?: number;
  log?: (message: string) => void;
}
const sources = '**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}';
const ignored = '**/{.git,node_modules,dist,build,out,coverage,.next,.vscode-test}/**';
export async function scanWorkspace(
  root: vscode.WorkspaceFolder,
  token: vscode.CancellationToken,
  progress: (completed: number, total: number, stage: string) => void,
  options: ScanOptions = {},
): Promise<GraphSnapshot> {
  const started = performance.now();
  const full = options.full !== false || !options.sources?.size;
  const excluded = vscode.workspace
    .getConfiguration('files', root.uri)
    .get<Record<string, boolean | { when: string }>>('exclude', {});
  const enabled = Object.entries(excluded)
    .filter(([, value]) => value === true)
    .map(([pattern]) => pattern);
  const exclusion = `{${[ignored, '**/*.d.{ts,mts,cts}', ...enabled].join(',')}}`;
  const files = full
    ? await vscode.workspace.findFiles(
        new vscode.RelativePattern(root, sources),
        exclusion,
        undefined,
        token,
      )
    : [...options.sources!.keys()].map((id) => vscode.Uri.parse(id));
  const conditional = new Set<string>();
  for (const [pattern, value] of full ? Object.entries(excluded) : []) {
    if (!value || typeof value !== 'object' || !value.when) {
      continue;
    }
    const matches = await vscode.workspace.findFiles(
      new vscode.RelativePattern(root, pattern),
      null,
      undefined,
      token,
    );
    for (const uri of matches) {
      if (token.isCancellationRequested) {
        throw new ScanCancelled();
      }
      const basename = path.basename(uri.fsPath, path.extname(uri.fsPath));
      const sibling = vscode.Uri.joinPath(
        uri,
        '..',
        value.when.replace(/\$\(basename\)/g, basename),
      );
      try {
        await vscode.workspace.fs.stat(sibling);
        conditional.add(uri.toString());
      } catch {
        /* No matching sibling. */
      }
    }
  }
  const inputs: SourceInput[] = [];
  const warnings: GraphWarning[] = [];
  const sorted = files
    .filter((file) => !conditional.has(file.toString()))
    .sort((a, b) => a.fsPath.localeCompare(b.fsPath));
  for (const [index, uri] of sorted.entries()) {
    if (token.isCancellationRequested) {
      throw new ScanCancelled();
    }
    try {
      const existing =
        !full && !options.changes?.has(uri.toString())
          ? options.sources?.get(uri.toString())
          : undefined;
      if (existing) {
        inputs.push(existing);
      } else {
        const document = await vscode.workspace.openTextDocument(uri);
        inputs.push({ id: uri.toString(), fileName: uri.fsPath, text: document.getText() });
      }
    } catch (error) {
      warnings.push({
        message: `Cannot read ${vscode.workspace.asRelativePath(uri)}: ${String(error)}`,
      });
    }
    progress(index + 1, sorted.length, 'Reading source');
  }
  const overlays = new Map(
    vscode.workspace.textDocuments
      .filter((document) => document.uri.scheme === 'file')
      .map((document) => [document.uri.fsPath, document.getText()]),
  );
  options.log?.(`Collect ${inputs.length} files: ${(performance.now() - started).toFixed(1)} ms`);
  const snapshot = await analyze({
    cache: options.cache,
    forceResolve: options.forceResolve,
    invalidateConfig: options.invalidateConfig,
    revision: options.revision,
    stats: (stats) =>
      options.log?.(
        `Analyze ${stats.files} files: ${stats.milliseconds.toFixed(1)} ms; parsed=${stats.parsed}, resolved=${stats.resolved}`,
      ),
    rootId: root.uri.toString(),
    rootName: root.name,
    rootPath: root.uri.fsPath,
    files: inputs,
    overlays,
    warnings,
    cancelled: () => token.isCancellationRequested,
    progress: (done, total) => progress(done, total, 'Analyzing imports'),
  });
  if (options.sources) {
    options.sources.clear();
    for (const input of inputs) {
      options.sources.set(input.id, input);
    }
  }
  return snapshot;
}
