import { architectureOverview } from './architecture';
import { analyzeImpact } from './investigation';
import type { GraphSnapshot } from './model';

export const codeMapTools = [
  'codemap_get_architecture',
  'codemap_get_dependencies',
  'codemap_get_selected_context',
  'codemap_get_impact',
] as const;
export type CodeMapToolName = (typeof codeMapTools)[number];
export function graphToolData(
  name: CodeMapToolName,
  graph: GraphSnapshot,
  input: { path?: string; depth?: number },
) {
  const path = (id: string) => graph.nodes.find((n) => n.id === id)?.path ?? id;
  if (name === 'codemap_get_architecture') {
    const depth = Math.max(1, Math.min(10, Number.isInteger(input.depth) ? input.depth! : 2));
    const overview = architectureOverview(graph, depth);
    return {
      root: graph.root.name,
      revision: graph.revision,
      files: graph.nodes.length,
      modules: overview.modules.map((m) => ({
        path: m.path,
        files: m.members.length,
        incoming: m.incoming,
        outgoing: m.outgoing,
        internal: m.internalEdges,
      })),
      central: overview.central
        .slice(0, 30)
        .map((f) => ({ path: f.file.path, incoming: f.incoming, outgoing: f.outgoing })),
      entryCandidates: overview.entries.slice(0, 30).map((f) => f.file.path),
      cycles: overview.cycles.map((c) => c.map(path)),
      warnings: graph.warnings,
      semantics:
        'A → B means A imports/re-exports B. Includes type imports; entry candidates and cycles are not runtime analysis.',
    };
  }
  const node = graph.nodes.find((n) => n.path === input.path);
  if (!node) {
    throw new Error('Use an exact workspace-relative file path present in the CodeMap graph.');
  }
  if (name === 'codemap_get_impact') {
    return {
      file: node.path,
      affected: analyzeImpact(graph, { nodeId: node.id }).map((entry) => ({
        path: path(entry.nodeId),
        direct: entry.direct,
        route: entry.path.map(path),
      })),
      semantics: 'Static import reachability, not proof of runtime impact.',
    };
  }
  return {
    file: node.path,
    declarations: node.declarations,
    dependencies: graph.edges
      .filter((e) => e.source === node.id)
      .map((e) => ({ path: path(e.target), sites: e.sites })),
    dependents: graph.edges
      .filter((e) => e.target === node.id)
      .map((e) => ({ path: path(e.source), sites: e.sites })),
    outside: node.outside,
  };
}
