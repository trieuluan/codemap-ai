import type { GraphSnapshot, DisplayGraph, DisplayNode, DisplayEdge } from './model';
import type { SymbolAnchor } from './navigation';

/** Metadata only; source and AI replies never enter persisted view state. */
export interface WorkingSet {
  name: string;
  files: string[];
  context: string[];
  editable: string[];
  pinned: string[];
  symbols: SymbolAnchor[];
}
export function readWorkingSet(value: unknown): WorkingSet | undefined {
  if (!value || typeof value !== 'object') {
    return;
  }
  const data = value as WorkingSet;
  if (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 100) {
    return;
  }
  const list = (v: unknown): v is string[] =>
    Array.isArray(v) &&
    v.length <= 200 &&
    v.every((id) => typeof id === 'string' && id.length <= 10000);
  if (![data.files, data.context, data.editable, data.pinned].every(list)) {
    return;
  }
  const files = [...new Set(data.files)];
  const subset = (ids: string[]) => [...new Set(ids)].filter((id) => files.includes(id));
  const kinds = ['function', 'class', 'type', 'interface', 'enum', 'value'];
  const symbols = Array.isArray(data.symbols)
    ? data.symbols
        .slice(0, 200)
        .filter(
          (s) =>
            s && files.includes(s.nodeId) && typeof s.name === 'string' && kinds.includes(s.kind),
        )
        .map((s) => ({ nodeId: s.nodeId, name: s.name, kind: s.kind }))
    : [];
  const context = subset(data.context);
  return {
    name: data.name.trim(),
    files,
    context,
    editable: subset(data.editable).filter((id) => context.includes(id)),
    pinned: subset(data.pinned),
    symbols,
  };
}
export function reconcileWorkingSet(set: WorkingSet, graph: GraphSnapshot) {
  const valid = new Set(graph.nodes.map((n) => n.id));
  return readWorkingSet({
    ...set,
    files: set.files.filter((id) => valid.has(id)),
    symbols: set.symbols.filter((s) =>
      graph.nodes
        .find((n) => n.id === s.nodeId)
        ?.declarations?.some((d) => d.name === s.name && d.kind === s.kind),
    ),
  })!;
}
export function createWorkingSet(files: string[], name = 'New task'): WorkingSet {
  return {
    name,
    files: [...new Set(files)].slice(0, 200),
    context: [...new Set(files)].slice(0, 50),
    editable: [],
    pinned: [],
    symbols: [],
  };
}
export function extendWorkingSet(set: WorkingSet, ids: string[]) {
  return readWorkingSet({ ...set, files: [...new Set([...set.files, ...ids])].slice(0, 200) })!;
}
/** Real file edges only. Boundary groups aggregate immediate outside neighbors. */
export function workingGraph(graph: GraphSnapshot, set: WorkingSet) {
  const members = new Set(set.files);
  const neighbors = new Set<string>();
  for (const edge of graph.edges) {
    if (members.has(edge.source)) {
      neighbors.add(edge.target);
    }
    if (members.has(edge.target)) {
      neighbors.add(edge.source);
    }
  }
  return {
    ...graph,
    nodes: graph.nodes.filter((n) => members.has(n.id) || neighbors.has(n.id)),
    edges: graph.edges.filter((e) => members.has(e.source) || members.has(e.target)),
  };
}
export function workingDisplay(graph: GraphSnapshot, set: WorkingSet): DisplayGraph {
  const source = workingGraph(graph, set);
  const members = new Set(set.files);
  const nodes = new Map<string, DisplayNode>();
  const owners = new Map<string, string>();
  for (const file of source.nodes) {
    const folder = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '.';
    const id = members.has(file.id) ? file.id : `boundary:${folder}`;
    owners.set(file.id, id);
    const node = nodes.get(id) ?? {
      id,
      kind: members.has(file.id) ? 'file' : 'folder',
      label: members.has(file.id) ? file.name : folder,
      path: members.has(file.id) ? file.path : folder,
      members: [],
      internalEdges: 0,
    };
    node.members.push(file.id);
    nodes.set(id, node);
  }
  const edges = new Map<string, DisplayEdge>();
  for (const edge of source.edges) {
    const from = owners.get(edge.source)!,
      to = owners.get(edge.target)!;
    if (from === to) {
      nodes.get(from)!.internalEdges++;
      continue;
    }
    const id = JSON.stringify([from, to]);
    const item = edges.get(id) ?? {
      id,
      source: from,
      target: to,
      count: 0,
      fileEdges: [],
      symbolCount: 0,
    };
    item.count++;
    item.fileEdges!.push(edge.id);
    item.symbolCount! += edge.sites.reduce((n, s) => n + (s.symbols?.length ?? 0), 0);
    edges.set(id, item);
  }
  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    visibleFiles: source.nodes.length,
  };
}
