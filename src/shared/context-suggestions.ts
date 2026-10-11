import type { GraphSnapshot } from './model';

export interface ContextSuggestion {
  fileId: string;
  path: string;
  reasons: string[];
  score: number;
}
/** Metadata-only candidates; this function never reads source or grants edit permission. */
export function suggestContext(
  graph: GraphSnapshot,
  included: string[],
  question: string,
  limit = 12,
): ContextSuggestion[] {
  const known = new Map(graph.nodes.map((n) => [n.id, n]));
  const selected = new Set(included);
  const found = new Map<string, ContextSuggestion>();
  const add = (id: string, reason: string, score: number) => {
    const file = known.get(id);
    if (!file || selected.has(id)) {
      return;
    }
    const item = found.get(id) ?? { fileId: id, path: file.path, reasons: [], score: 0 };
    if (!item.reasons.includes(reason)) {
      item.reasons.push(reason);
      item.score += score;
    }
    found.set(id, item);
  };
  for (const edge of graph.edges) {
    if (selected.has(edge.source)) {
      add(edge.target, `Imported by ${known.get(edge.source)?.path}`, 30);
      for (const site of edge.sites) {
        for (const symbol of site.symbols ?? []) {
          if (symbol.declaration) {
            add(
              symbol.declaration.nodeId,
              `Declaration of ${symbol.local} through an import/re-export route`,
              40,
            );
          }
        }
      }
    }
    if (selected.has(edge.target)) {
      add(
        edge.source,
        `Imports ${known.get(edge.target)?.path}; check dependent file compatibility`,
        10,
      );
    }
  }
  const stem = (path: string) =>
    path
      .split('/')
      .at(-1)!
      .replace(/\.[^.]+$/, '')
      .replace(/\.(test|spec)$/, '')
      .toLowerCase();
  const names = new Set(
    graph.nodes
      .filter((n) => selected.has(n.id))
      .map((n) => stem(n.path))
      .filter((n) => !['index', 'types', 'utils'].includes(n)),
  );
  const terms = new Set(
    (question.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [])
      .filter((s) => s.length >= 3)
      .slice(0, 30),
  );
  for (const node of graph.nodes) {
    if (
      /(^|\/)(test|tests|__tests__)(\/|$)|\.(test|spec)\.[^.]+$/i.test(node.path) &&
      names.has(stem(node.path))
    ) {
      add(node.id, 'Test filename matches a selected file; relevance needs review', 35);
    }
    const symbols = (node.declarations ?? [])
      .filter((d) => terms.has(d.name.toLowerCase()))
      .slice(0, 2);
    if (symbols.length) {
      add(
        node.id,
        `Declares a symbol named in your request: ${symbols.map((s) => s.name).join(', ')}`,
        25,
      );
    }
    if (terms.has(stem(node.path))) {
      add(node.id, 'Filename matches your request; source not inspected', 20);
    }
  }
  return [...found.values()]
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, Math.max(0, Math.min(20, limit)));
}
