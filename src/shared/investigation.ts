import type { DependencyEdge, DisplayGraph, FileNode, GraphSnapshot } from './model';

export interface ImpactTarget {
  nodeId: string;
  symbolId?: string;
}
export interface ImpactEntry {
  nodeId: string;
  /** The affected file imports the next file, ending at the changed file. */
  path: string[];
  direct: boolean;
}

/** One shortest dependency explanation per affected file; cycles never include the target. */
export function analyzeImpact(graph: GraphSnapshot, target: ImpactTarget): ImpactEntry[] {
  if (
    !graph.nodes.some(
      (node) =>
        node.id === target.nodeId &&
        (!target.symbolId || node.declarations?.some((symbol) => symbol.id === target.symbolId)),
    )
  ) {
    return [];
  }
  const incoming = new Map<string, DependencyEdge[]>();
  for (const edge of graph.edges) {
    const entries = incoming.get(edge.target) ?? [];
    entries.push(edge);
    incoming.set(edge.target, entries);
  }
  const paths = new Map<string, string[]>();
  const seeds = new Set<string>();
  const queue: string[] = [];
  const relayPaths: string[][] = [];
  const add = (id: string, path: string[], seed = false, propagate = true) => {
    if (seed) {
      seeds.add(id);
    }
    if (id === target.nodeId || (paths.has(id) && paths.get(id)!.length <= path.length)) {
      return;
    }
    paths.set(id, path);
    if (propagate) {
      queue.push(id);
    }
  };
  if (target.symbolId) {
    // Seed known bindings, not every consumer of a barrel's unrelated exports.
    for (const edge of graph.edges) {
      for (const site of edge.sites) {
        for (const symbol of site.symbols ?? []) {
          if (
            symbol.declaration?.nodeId !== target.nodeId ||
            symbol.declaration.symbolId !== target.symbolId
          ) {
            continue;
          }
          const route = symbol.resolutionPath;
          if (!route || route[0] !== edge.source || route.at(-1) !== target.nodeId) {
            continue;
          }
          relayPaths.push(route);
          // Pure re-export edges relay a symbol; other exports from that barrel
          // must not seed every unrelated consumer as impacted.
          add(edge.source, route, true, site.kind !== 're-export');
        }
      }
    }
  } else {
    for (const edge of incoming.get(target.nodeId) ?? []) {
      add(edge.source, [edge.source, target.nodeId], true);
    }
  }
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    for (const edge of incoming.get(id) ?? []) {
      const path = paths.get(id)!;
      if (!path.includes(edge.source)) {
        add(edge.source, [edge.source, ...path]);
      }
    }
  }
  for (const route of relayPaths) {
    for (let index = 1; index < route.length - 1; index++) {
      add(route[index], route.slice(index), false, false);
    }
  }
  return [...paths]
    .map(([nodeId, path]) => ({ nodeId, path, direct: seeds.has(nodeId) }))
    .sort(
      (a, b) =>
        Number(b.direct) - Number(a.direct) ||
        a.path.length - b.path.length ||
        a.nodeId.localeCompare(b.nodeId),
    );
}

/** A temporary view of an existing route. Never create guessed dependency edges. */
export function graphForPath(graph: GraphSnapshot, path: string[]): GraphSnapshot {
  const ids = new Set(path);
  const pairs = new Set(path.slice(1).map((id, index) => JSON.stringify([path[index], id])));
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => ids.has(node.id)),
    edges: graph.edges.filter((edge) => pairs.has(JSON.stringify([edge.source, edge.target]))),
  };
}

export function symbolNodeId(nodeId: string, symbolId: string): string {
  return `symbol:${JSON.stringify([nodeId, symbolId])}`;
}

/** Declaration nodes are a display projection; they never enter the source dependency graph. */
export function withSymbols(display: DisplayGraph, file?: FileNode): DisplayGraph {
  if (!file || !display.nodes.some((node) => node.id === file.id)) {
    return display;
  }
  const nodes = (file.declarations ?? []).map((symbol) => ({
    id: symbolNodeId(file.id, symbol.id),
    kind: 'symbol' as const,
    ownerId: file.id,
    symbolId: symbol.id,
    label: symbol.name,
    path: `${symbol.kind} · L${symbol.line + 1}`,
    members: [],
    internalEdges: 0,
  }));
  return {
    ...display,
    nodes: [...display.nodes, ...nodes],
    edges: [
      ...display.edges,
      ...nodes.map((node) => ({
        id: `declares:${node.id}`,
        source: file.id,
        target: node.id,
        count: 0,
        relation: 'declaration' as const,
      })),
    ],
  };
}
