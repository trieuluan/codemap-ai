import * as path from 'node:path';
import * as ts from 'typescript';
import { isBuiltin } from 'node:module';
import { createHash } from 'node:crypto';
import { collectDeclarations, importSymbols, linkSymbols } from './symbols';
import type {
  FileNode,
  GraphSnapshot,
  GraphWarning,
  ImportSite,
  RelationKind,
} from '../shared/model';

export interface SourceInput {
  id: string;
  fileName: string;
  text: string;
}
export interface AnalyzeOptions {
  rootPath: string;
  rootId: string;
  rootName: string;
  files: SourceInput[];
  overlays?: Map<string, string>;
  warnings?: GraphWarning[];
  cancelled?: () => boolean;
  progress?: (completed: number, total: number) => void;
  cache?: AnalyzerCache;
  forceResolve?: boolean;
  invalidateConfig?: boolean;
  revision?: number;
  stats?: (stats: AnalysisStats) => void;
}
export interface AnalysisStats {
  milliseconds: number;
  parsed: number;
  resolved: number;
  files: number;
}
interface CachedFile {
  hash: string;
  source: ts.SourceFile;
  imports: ReturnType<typeof collectImports>;
  node: FileNode;
  edges: GraphSnapshot['edges'];
  warnings: GraphWarning[];
}
export class AnalyzerCache {
  entries = new Map<string, CachedFile>();
  metadata = new Set<string>();
  metadataHashes = new Map<string, string | undefined>();
  configWarnings: GraphWarning[] = [];
  rootId?: string;
}
const canonical = (file: string) => {
  let resolved = normalize(file);
  try {
    resolved = ts.sys.realpath?.(resolved) ?? resolved;
  } catch {
    /* New/removed path. */
  }
  return ts.sys.useCaseSensitiveFileNames ? resolved : resolved.toLowerCase();
};
export class ScanCancelled extends Error {
  constructor() {
    super('Scan cancelled');
  }
}
const normalize = (file: string) => path.normalize(path.resolve(file));
const defaults: ts.CompilerOptions = {
  allowJs: true,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.Preserve,
  resolveJsonModule: true,
};

export function collectImports(file: ts.SourceFile): {
  sites: ImportSite[];
  warnings: string[];
  usages: Map<string, ts.StringLiteralLike>;
} {
  const sites: ImportSite[] = [];
  const usages = new Map<string, ts.StringLiteralLike>();
  const warnings: string[] = [];
  function add(node: ts.Node, value: ts.Expression, kind: RelationKind) {
    if (ts.isStringLiteralLike(value)) {
      const position = file.getLineAndCharacterOfPosition(value.getStart(file));
      const id = `${node.getStart(file)}:${kind}`;
      usages.set(id, value);
      sites.push({
        id,
        specifier: value.text,
        kind,
        line: position.line,
        character: position.character,
        symbols: importSymbols(node, file),
      });
    } else {
      const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
      warnings.push(`Cannot resolve non-literal ${kind} at line ${line}.`);
    }
  }
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const onlyTypes =
        clause?.isTypeOnly ||
        (clause &&
          !clause.name &&
          clause.namedBindings &&
          ts.isNamedImports(clause.namedBindings) &&
          clause.namedBindings.elements.length > 0 &&
          clause.namedBindings.elements.every((element) => element.isTypeOnly));
      add(node, node.moduleSpecifier, onlyTypes ? 'type-import' : 'import');
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      add(node, node.moduleSpecifier, 're-export');
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression
    ) {
      add(node, node.moduleReference.expression, node.isTypeOnly ? 'type-import' : 'require');
    } else if (ts.isCallExpression(node) && node.arguments.length > 0) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        add(node, node.arguments[0], 'dynamic-import');
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        add(node, node.arguments[0], 'require');
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return { sites, warnings, usages };
}

export async function analyze(options: AnalyzeOptions): Promise<GraphSnapshot> {
  const started = performance.now();
  let parsedCount = 0;
  let resolvedCount = 0;
  const cache = options.cache ?? new AnalyzerCache();
  const reset = options.invalidateConfig || cache.rootId !== options.rootId;
  const previous = reset ? new Map<string, CachedFile>() : cache.entries;
  const metadata = new Set(reset ? [] : cache.metadata);
  const metadataHashes = new Map(reset ? [] : cache.metadataHashes);
  const warnings = [...(options.warnings ?? []), ...(reset ? [] : cache.configWarnings)];
  const configWarnings: GraphWarning[] = reset ? [] : [...cache.configWarnings];
  const configWarning = (message: string) => {
    configWarnings.push({ message });
    warnings.push({ message });
  };
  const nextEntries = new Map<string, CachedFile>();
  const structural =
    options.files.length !== previous.size || options.files.some((file) => !previous.has(file.id));
  const resolveAll = reset || structural || options.forceResolve;
  const overlays = new Map<string, string>();
  for (const [file, text] of options.overlays ?? []) {
    overlays.set(normalize(file), text);
  }
  for (const file of options.files) {
    overlays.set(normalize(file.fileName), file.text);
  }
  const readFile = (file: string) => {
    const text = overlays.get(normalize(file)) ?? ts.sys.readFile(file);
    if (/\.json$/i.test(file)) {
      metadata.add(normalize(file));
      metadataHashes.set(
        normalize(file),
        text === undefined ? undefined : createHash('sha256').update(text).digest('hex'),
      );
    }
    return text;
  };
  const fileExists = (file: string) => overlays.has(normalize(file)) || ts.sys.fileExists(file);
  const host: ts.ModuleResolutionHost = {
    fileExists,
    readFile,
    directoryExists: ts.sys.directoryExists,
    getCurrentDirectory: () => options.rootPath,
    getDirectories: ts.sys.getDirectories,
    realpath: ts.sys.realpath,
  };
  const configCache = new Map<string, ts.CompilerOptions>();
  const root = normalize(options.rootPath);
  function compilerOptions(fileName: string): ts.CompilerOptions {
    let directory = path.dirname(normalize(fileName));
    while (directory === root || directory.startsWith(root + path.sep)) {
      for (const name of ['tsconfig.json', 'jsconfig.json']) {
        const configPath = path.join(directory, name);
        if (!fileExists(configPath)) {
          continue;
        }
        const cached = configCache.get(configPath);
        if (cached) {
          return cached;
        }
        const configHost: ts.ParseConfigFileHost = {
          ...ts.sys,
          readFile,
          fileExists,
          onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
            configWarning(
              `${configPath}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`,
            );
          },
        };
        const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, configHost);
        // Empty projects are valid for graph analysis; their discovered files are supplied separately.
        const errors =
          parsed?.errors.filter((error) => error.code !== 18003 && error.code !== 18002) ?? [];
        const result =
          !parsed || errors.length
            ? { ...defaults }
            : {
                ...defaults,
                ...parsed.options,
                moduleResolution:
                  parsed.options.moduleResolution ??
                  (parsed.options.module === ts.ModuleKind.Node16
                    ? ts.ModuleResolutionKind.Node16
                    : parsed.options.module === ts.ModuleKind.NodeNext
                      ? ts.ModuleResolutionKind.NodeNext
                      : parsed.options.module === undefined ||
                          parsed.options.module === ts.ModuleKind.Preserve
                        ? ts.ModuleResolutionKind.Bundler
                        : ts.ModuleResolutionKind.Node10),
              };
        for (const error of errors) {
          configWarning(
            `${configPath}: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`,
          );
        }
        configCache.set(configPath, result);
        return result;
      }
      if (directory === root) {
        break;
      }
      directory = path.dirname(directory);
    }
    return defaults;
  }
  const nodes: FileNode[] = options.files.map((file) => ({
    id: file.id,
    path: path.relative(root, file.fileName).split(path.sep).join('/'),
    name: path.basename(file.fileName),
    language: /\.[cm]?tsx?$/.test(file.fileName) ? 'typescript' : 'javascript',
    outside: [],
  }));
  const byPath = new Map(
    options.files.map((file, index) => [canonical(file.fileName), nodes[index]]),
  );
  const edgeMap = new Map<string, GraphSnapshot['edges'][number]>();
  for (let index = 0; index < options.files.length; index++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (options.cancelled?.()) {
      throw new ScanCancelled();
    }
    const input = options.files[index];
    const node = nodes[index];
    const hash = createHash('sha256').update(input.text).digest('hex');
    const cached = previous.get(input.id);
    if (cached?.hash === hash && !resolveAll) {
      nodes[index] = cached.node;
      for (const edge of cached.edges) {
        edgeMap.set(edge.id, edge);
      }
      warnings.push(...cached.warnings);
      nextEntries.set(input.id, cached);
      options.progress?.(index + 1, options.files.length);
      continue;
    }
    const ownWarnings: GraphWarning[] = [];
    try {
      const compiler = compilerOptions(input.fileName);
      const reuse = cached?.hash === hash;
      const source = reuse
        ? cached.source
        : ts.createSourceFile(
            input.fileName,
            input.text,
            {
              languageVersion: ts.ScriptTarget.Latest,
              impliedNodeFormat: ts.getImpliedNodeFormatForFile(
                input.fileName,
                undefined,
                host,
                compiler,
              ),
            },
            true,
          );
      if (!reuse) {
        parsedCount++;
      }
      resolvedCount++;
      const imports = reuse ? cached.imports : collectImports(source);
      Object.assign(node, collectDeclarations(source));
      ownWarnings.push(...imports.warnings.map((message) => ({ fileId: node.id, message })));
      const parsedDiagnostics =
        (source as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] })
          .parseDiagnostics ?? [];
      ownWarnings.push(
        ...parsedDiagnostics.map((diagnostic) => ({
          fileId: node.id,
          message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
        })),
      );
      for (const site of imports.sites) {
        if (options.cancelled?.()) {
          throw new ScanCancelled();
        }
        const mode = ts.getModeForUsageLocation(source, imports.usages.get(site.id)!, compiler);
        const resolved = ts.resolveModuleName(
          site.specifier,
          input.fileName,
          compiler,
          host,
          undefined,
          undefined,
          mode,
        ).resolvedModule;
        const target = resolved && byPath.get(canonical(resolved.resolvedFileName));
        if (target) {
          const id = JSON.stringify([node.id, target.id]);
          const edge = edgeMap.get(id) ?? { id, source: node.id, target: target.id, sites: [] };
          edge.sites.push(site);
          edgeMap.set(id, edge);
        } else {
          const builtin = isBuiltin(site.specifier);
          // Bare unresolved names are still unresolved (e.g. bundler-only aliases).
          const status = resolved
            ? resolved.isExternalLibraryImport ||
              !canonical(resolved.resolvedFileName).startsWith(canonical(root) + path.sep)
              ? 'external'
              : 'excluded'
            : builtin
              ? 'external'
              : 'unresolved';
          node.outside.push({ site, status, resolvedPath: resolved?.resolvedFileName });
        }
      }
      nextEntries.set(input.id, {
        hash,
        source,
        imports,
        node,
        edges: [...edgeMap.values()].filter((edge) => edge.source === node.id),
        warnings: ownWarnings,
      });
    } catch (error) {
      if (error instanceof ScanCancelled) {
        throw error;
      }
      ownWarnings.push({
        fileId: node.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    warnings.push(...ownWarnings);
    options.progress?.(index + 1, options.files.length);
  }
  if (options.cancelled?.()) {
    throw new ScanCancelled();
  }
  const edges = linkSymbols(nodes, [...edgeMap.values()]);
  cache.entries = nextEntries;
  cache.metadata = metadata;
  cache.metadataHashes = metadataHashes;
  cache.configWarnings = [
    ...new Map(configWarnings.map((warning) => [JSON.stringify(warning), warning])).values(),
  ];
  cache.rootId = options.rootId;
  options.stats?.({
    milliseconds: performance.now() - started,
    parsed: parsedCount,
    resolved: resolvedCount,
    files: nodes.length,
  });
  return {
    revision: options.revision ?? 1,
    root: { id: options.rootId, name: options.rootName },
    nodes,
    edges,
    scannedAt: new Date().toISOString(),
    warnings: [...new Map(warnings.map((warning) => [JSON.stringify(warning), warning])).values()],
  };
}
