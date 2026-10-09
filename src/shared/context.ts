import type { FileNode, GraphSnapshot } from './model';
import type { Annotation } from './library';

export const contextLimits = { files: 50, perFile: 20000, total: 150000 };
export interface ContextFile {
  id: string;
  path: string;
  language: string;
  content: string;
  truncated: boolean;
  declarations: FileNode['declarations'];
  imports: { path: string; sites: GraphSnapshot['edges'][number]['sites'] }[];
  dependents: string[];
  outside: FileNode['outside'];
  notes: Annotation[];
}
export interface ContextBundle {
  rootId: string;
  revision: number;
  builtAt: string;
  files: ContextFile[];
  warnings: string[];
  requested: number;
  characters: number;
}
export function contextCandidates(
  graph: GraphSnapshot,
  selected: string[],
  dependencies: boolean,
  dependents: boolean,
) {
  const seeds = new Set(selected);
  const ids = new Set(selected);
  for (const edge of graph.edges) {
    if (dependencies && seeds.has(edge.source)) {
      ids.add(edge.target);
    }
    if (dependents && seeds.has(edge.target)) {
      ids.add(edge.source);
    }
  }
  return graph.nodes
    .filter((n) => ids.has(n.id))
    .sort(
      (a, b) => Number(seeds.has(b.id)) - Number(seeds.has(a.id)) || a.path.localeCompare(b.path),
    );
}
export async function buildContext(
  graph: GraphSnapshot,
  fileIds: string[],
  notes: Annotation[],
  read: (fileId: string) => Promise<string>,
): Promise<ContextBundle> {
  const filesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const ids = [...new Set(fileIds)];
  const bundle: ContextBundle = {
    rootId: graph.root.id,
    revision: graph.revision,
    builtAt: new Date().toISOString(),
    files: [],
    warnings: [],
    requested: ids.length,
    characters: 0,
  };
  if (ids.length > contextLimits.files) {
    bundle.warnings.push(
      `Only the first ${contextLimits.files} files were included. Narrow the selection and preview again.`,
    );
  }
  for (const id of ids.slice(0, contextLimits.files)) {
    const file = filesById.get(id);
    if (!file) {
      bundle.warnings.push('A selected file no longer exists in the current graph.');
      continue;
    }
    try {
      const text = await read(id);
      const remaining = contextLimits.total - bundle.characters;
      if (remaining <= 0) {
        bundle.warnings.push('Source budget reached; remaining files were omitted.');
        break;
      }
      const content = text.slice(0, Math.min(contextLimits.perFile, remaining));
      const truncated = content.length < text.length;
      if (truncated) {
        bundle.warnings.push(`${file.path}: source was truncated to the context budget.`);
      }
      bundle.characters += content.length;
      bundle.files.push({
        id,
        path: file.path,
        language: file.language,
        content,
        truncated,
        declarations: file.declarations ?? [],
        imports: graph.edges
          .filter((e) => e.source === id)
          .map((e) => ({ path: filesById.get(e.target)?.path ?? e.target, sites: e.sites })),
        dependents: graph.edges
          .filter((e) => e.target === id)
          .map((e) => filesById.get(e.source)?.path ?? e.source),
        outside: file.outside,
        notes: notes.filter((a) =>
          a.target.kind === 'file' ? a.target.id === id : file.path.startsWith(`${a.target.id}/`),
        ),
      });
    } catch {
      bundle.warnings.push(`${file.path}: source could not be read.`);
    }
  }
  return bundle;
}
function importSummary(edge: ContextFile['imports'][number]) {
  const locations = edge.sites.map((site) => {
    const bindings =
      site.symbols
        ?.map((symbol) => {
          const name =
            symbol.imported === symbol.local
              ? symbol.local
              : `${symbol.imported} as ${symbol.local}`;
          return `${symbol.typeOnly ? 'type ' : ''}${name}`;
        })
        .join(', ') || 'module';
    return `L${site.line + 1} ${site.kind}: ${bindings}`;
  });
  return `${edge.path} [${locations.join('; ')}]`;
}
/** Preview and copy use the same local bundle. No network or project execution. */
export function contextMarkdown(bundle: ContextBundle) {
  const fence = (content: string) =>
    '`'.repeat(Math.max(3, ...[...content.matchAll(/`+/g)].map((m) => m[0].length + 1)));
  return [
    `# CodeMap context`,
    `Revision: ${bundle.revision} · ${bundle.files.length}/${bundle.requested} files · ${bundle.characters} source characters`,
    ...bundle.warnings.map((w) => `Warning: ${w}`),
    ...bundle.files.map((file) => {
      const delimiter = fence(file.content);
      return [
        `## ${file.path}`,
        `Symbols: ${(file.declarations ?? []).map((s) => `${s.kind} ${s.name} (L${s.line + 1})`).join(', ') || 'None'}`,
        `Imports: ${file.imports.map(importSummary).join(', ') || 'None'}`,
        `Used by: ${file.dependents.join(', ') || 'None'}`,
        `Outside: ${file.outside.map((d) => `${d.site.specifier} (${d.status})`).join(', ') || 'None'}`,
        ...file.notes.map((n) => `Architecture ${n.role ?? 'note'} (${n.target.kind}): ${n.text}`),
        file.truncated ? 'Source truncated.' : '',
        `${delimiter}${file.language}\n${file.content}\n${delimiter}`,
      ]
        .filter(Boolean)
        .join('\n\n');
    }),
  ].join('\n\n');
}
