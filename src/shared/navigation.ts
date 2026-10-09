import type { GraphSnapshot, GraphViewState, SymbolKind } from './model';
import { symbolNodeId } from './investigation';
import { readView, reconcileView } from './view';

export interface SymbolAnchor {
  nodeId: string;
  name: string;
  kind: SymbolKind;
}
export interface NavigationLocation {
  view: GraphViewState;
  overviewDepth?: number;
  viewport?: GraphViewState['viewport'];
  path?: string[];
  symbolsFileId?: string;
  symbol?: SymbolAnchor;
  impact?: { nodeId: string; symbol?: SymbolAnchor };
  contextId?: string;
  group?: string;
  peek: string[];
  positions: GraphViewState['positions'];
}
export function readLocation(value: unknown): NavigationLocation | undefined {
  if (!value || typeof value !== 'object') {
    return;
  }
  const item = value as NavigationLocation;
  if (!item.view || !Array.isArray(item.peek) || item.peek.some((id) => typeof id !== 'string')) {
    return;
  }
  if (
    item.path !== undefined &&
    (!Array.isArray(item.path) || item.path.some((id) => typeof id !== 'string'))
  ) {
    return;
  }
  const anchor = (a: SymbolAnchor | undefined) =>
    !a ||
    (typeof a.nodeId === 'string' &&
      typeof a.name === 'string' &&
      ['function', 'class', 'type', 'interface', 'enum', 'value'].includes(a.kind));
  if (!anchor(item.symbol) || !anchor(item.impact?.symbol)) {
    return;
  }
  if (item.impact && typeof item.impact.nodeId !== 'string') {
    return;
  }
  for (const key of ['contextId', 'group', 'symbolsFileId'] as const) {
    if (item[key] !== undefined && typeof item[key] !== 'string') {
      return;
    }
  }
  if (
    item.overviewDepth !== undefined &&
    (!Number.isInteger(item.overviewDepth) || item.overviewDepth < 1 || item.overviewDepth > 1000)
  ) {
    return;
  }
  const geometry = readView({ ...item.view, positions: item.positions, viewport: item.viewport });
  return {
    view: readView(item.view),
    overviewDepth: item.overviewDepth,
    viewport: geometry.viewport,
    positions: geometry.positions,
    peek: item.peek.slice(0, 10000),
    path: item.path?.slice(0, 10000),
    symbolsFileId: item.symbolsFileId,
    symbol: item.symbol
      ? { nodeId: item.symbol.nodeId, name: item.symbol.name, kind: item.symbol.kind }
      : undefined,
    impact: item.impact
      ? {
          nodeId: item.impact.nodeId,
          symbol: item.impact.symbol
            ? {
                nodeId: item.impact.symbol.nodeId,
                name: item.impact.symbol.name,
                kind: item.impact.symbol.kind,
              }
            : undefined,
        }
      : undefined,
    contextId: item.contextId,
    group: item.group,
  };
}
export function resolveAnchor(graph: GraphSnapshot, anchor?: SymbolAnchor) {
  if (!anchor) {
    return;
  }
  return graph.nodes
    .find((n) => n.id === anchor.nodeId)
    ?.declarations?.find((s) => s.name === anchor.name && s.kind === anchor.kind);
}
export function reconcileLocation(location: NavigationLocation, graph: GraphSnapshot) {
  const ids = new Set(graph.nodes.map((n) => n.id));
  const view = reconcileView(location.view, graph);
  const edges = new Set(graph.edges.map((e) => JSON.stringify([e.source, e.target])));
  const validPath = location.path?.every(
    (id, i, path) => ids.has(id) && (!i || edges.has(JSON.stringify([path[i - 1], id]))),
  );
  const path = validPath ? location.path : undefined;
  const symbolsFileId = ids.has(location.symbolsFileId ?? '') ? location.symbolsFileId : undefined;
  const impact =
    location.impact &&
    ids.has(location.impact.nodeId) &&
    (!location.impact.symbol || resolveAnchor(graph, location.impact.symbol))
      ? location.impact
      : undefined;
  const visibleIds = new Set([
    ...ids,
    ...graph.nodes.flatMap((n) => (n.declarations ?? []).map((s) => symbolNodeId(n.id, s.id))),
  ]);
  const groupPositions = reconcileView(
    { ...location.view, positions: location.positions },
    graph,
  ).positions;
  const positions = Object.fromEntries(
    Object.entries(location.positions).filter(
      ([id]) => visibleIds.has(id) || Object.hasOwn(groupPositions, id),
    ),
  );
  const stale = !!(
    (location.path && !validPath) ||
    (location.symbolsFileId && !symbolsFileId) ||
    (location.view.selected && location.view.selected !== view.selected) ||
    (location.impact && !impact) ||
    (location.symbol && !resolveAnchor(graph, location.symbol))
  );
  return {
    location: {
      ...location,
      view,
      overviewDepth: location.overviewDepth
        ? Math.min(
            location.overviewDepth,
            Math.max(1, ...graph.nodes.map((n) => n.path.split('/').length - 1)),
          )
        : undefined,
      path,
      symbolsFileId,
      impact,
      symbol: resolveAnchor(graph, location.symbol) ? location.symbol : undefined,
      contextId: ids.has(location.contextId ?? '') ? location.contextId : undefined,
      group:
        location.group && projectGroupExists(location.group, graph) ? location.group : undefined,
      peek: location.peek.filter((id) => projectGroupExists(id, graph)),
      positions: path || symbolsFileId || location.overviewDepth ? positions : {},
      viewport: stale ? undefined : location.viewport,
    },
    stale,
  };
}
function projectGroupExists(id: string, graph: GraphSnapshot) {
  const match = /^folder:\d+:(.+)$/.exec(id);
  return !!match && graph.nodes.some((n) => n.path.startsWith(`${match[1]}/`));
}
/** History contains UI state only. Camera changes update an entry, never add a visit. */
export class NavigationHistory {
  private entries: NavigationLocation[] = [];
  private cursor = -1;
  get canBack() {
    return this.cursor > 0;
  }
  get canForward() {
    return this.cursor + 1 < this.entries.length;
  }
  update(location: NavigationLocation) {
    if (this.cursor >= 0) {
      this.entries[this.cursor] = structuredClone(location);
    }
  }
  visit(location: NavigationLocation) {
    const identity = (value: NavigationLocation) =>
      JSON.stringify([
        value.overviewDepth,
        value.view.mode,
        value.view.depth,
        value.view.selected,
        value.path,
        value.symbolsFileId,
        value.symbol,
        value.impact,
        value.contextId,
        value.group,
        value.peek,
        value.view.expanded,
      ]);
    if (this.cursor >= 0 && identity(this.entries[this.cursor]) === identity(location)) {
      this.update(location);
      return;
    }
    this.entries.splice(this.cursor + 1);
    this.entries.push(structuredClone(location));
    if (this.entries.length > 50) {
      this.entries.shift();
    }
    this.cursor = this.entries.length - 1;
  }
  move(direction: -1 | 1) {
    if (direction === -1 ? !this.canBack : !this.canForward) {
      return;
    }
    this.cursor += direction;
    return structuredClone(this.entries[this.cursor]);
  }
}
