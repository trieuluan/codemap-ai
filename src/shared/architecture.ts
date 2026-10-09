import type { DisplayGraph, GraphSnapshot } from './model';
import { defaultView, isTest, projectGraph } from './view';

/** Strongly connected components use actual directed imports, including self-imports. */
export function dependencyCycles(ids: string[], edges: { source: string; target: string }[]) {
  const adjacency = new Map(ids.map((id) => [id, [] as string[]]));
  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
  }
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const stacked = new Set<string>();
  const cycles: string[][] = [];
  let index = 0;
  const visit = (id: string) => {
    indices.set(id, index);
    low.set(id, index++);
    stack.push(id);
    stacked.add(id);
    for (const target of adjacency.get(id) ?? []) {
      if (!adjacency.has(target)) {
        continue;
      }
      if (!indices.has(target)) {
        visit(target);
        low.set(id, Math.min(low.get(id)!, low.get(target)!));
      } else if (stacked.has(target)) {
        low.set(id, Math.min(low.get(id)!, indices.get(target)!));
      }
    }
    if (low.get(id) !== indices.get(id)) {
      return;
    }
    const component: string[] = [];
    let target: string;
    do {
      target = stack.pop()!;
      stacked.delete(target);
      component.push(target);
    } while (target !== id);
    if (component.length > 1 || adjacency.get(id)?.includes(id)) {
      cycles.push(component.sort());
    }
  };
  ids.forEach((id) => {
    if (!indices.has(id)) {
      visit(id);
    }
  });
  return cycles.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}
export function architectureOverview(graph: GraphSnapshot, depth = 2) {
  const display: DisplayGraph = projectGraph(graph, { ...defaultView(), mode: 'folders', depth });
  const incoming = new Map(graph.nodes.map((n) => [n.id, 0]));
  const outgoing = new Map(graph.nodes.map((n) => [n.id, 0]));
  for (const e of graph.edges) {
    incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
    outgoing.set(e.source, (outgoing.get(e.source) ?? 0) + 1);
  }
  const files = graph.nodes.map((file) => ({
    file,
    incoming: incoming.get(file.id) ?? 0,
    outgoing: outgoing.get(file.id) ?? 0,
  }));
  return {
    display,
    modules: display.nodes
      .map((node) => ({
        ...node,
        incoming: display.edges
          .filter((e) => e.target === node.id)
          .reduce((sum, e) => sum + e.count, 0),
        outgoing: display.edges
          .filter((e) => e.source === node.id)
          .reduce((sum, e) => sum + e.count, 0),
      }))
      .sort((a, b) => b.members.length - a.members.length || a.path.localeCompare(b.path)),
    central: files
      .filter((item) => item.incoming > 0)
      .sort(
        (a, b) =>
          b.incoming - a.incoming ||
          b.outgoing - a.outgoing ||
          a.file.path.localeCompare(b.file.path),
      ),
    entries: files
      .filter((item) => !item.incoming && item.outgoing && !isTest(item.file.path))
      .sort((a, b) => b.outgoing - a.outgoing || a.file.path.localeCompare(b.file.path)),
    cycles: dependencyCycles(
      graph.nodes.map((n) => n.id),
      graph.edges,
    ),
  };
}
