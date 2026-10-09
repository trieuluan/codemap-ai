import type { DisplayGraph, FileNode, GraphLayoutState, GraphSnapshot, GraphViewState } from './model';
export function defaultView(): GraphViewState {
  return { version: 3, mode: 'files', depth: 2, expanded: [], positions: {}, layouts: {}, folder: '', hideTests: false,
    hideIsolated: false, focus: 0, autoUpdate: true };
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export const layoutKey = (state: Pick<GraphViewState, 'mode' | 'depth'>) => state.mode === 'files' ? 'files' : `folders:${state.depth}`;
export function switchLayout(state: GraphViewState, mode: GraphViewState['mode'], depth = state.depth): GraphViewState {
  const nextKey = layoutKey({ mode, depth });
  if (nextKey === layoutKey(state)) { return { ...state, mode, depth }; }
  const layouts = { ...state.layouts, [layoutKey(state)]: { positions: state.positions, viewport: state.viewport } };
  const next = layouts[nextKey];
  return { ...state, mode, depth, layouts, positions: next?.positions ?? {}, viewport: next?.viewport };
}
function readLayout(value: unknown): GraphLayoutState {
  const state = (value && typeof value === 'object' ? value : {}) as GraphLayoutState;
  const positions: GraphLayoutState['positions'] = {};
  for (const [id, position] of Object.entries(state.positions && typeof state.positions === 'object' ? state.positions : {})) {
    if (position && finite(position.x) && finite(position.y) && id !== '__proto__') { positions[id] = { x: position.x, y: position.y }; }
  }
  const viewport = state.viewport && finite(state.viewport.x) && finite(state.viewport.y) && finite(state.viewport.zoom) &&
    state.viewport.zoom >= 0.05 && state.viewport.zoom <= 2 ? state.viewport : undefined;
  return { positions, viewport };
}
export function readView(value: unknown): GraphViewState {
  if (!value || typeof value !== 'object') { return defaultView(); }
  const state = value as Omit<GraphViewState, 'version'> & { version: number };
  if (![1, 2, 3].includes(state.version) || !['files', 'folders'].includes(state.mode) || !Number.isInteger(state.depth) || state.depth < 1 ||
    ![0, 1, 2].includes(state.focus) || typeof state.folder !== 'string' || typeof state.autoUpdate !== 'boolean' ||
    typeof state.hideTests !== 'boolean' || typeof state.hideIsolated !== 'boolean' || !Array.isArray(state.expanded) ||
    !state.expanded.every(id => typeof id === 'string') || !state.positions || typeof state.positions !== 'object') { return defaultView(); }
  const layouts: GraphViewState['layouts'] = {};
  if (state.version >= 2 && state.layouts && typeof state.layouts === 'object') {
    for (const [key, value] of Object.entries(state.layouts)) {
      if (/^(files|folders:[1-9]\d*)$/.test(key)) { layouts[key] = readLayout(value); }
    }
  }
  let active = readLayout(state);
  if (state.version === 1) {
    // Old file/group coordinates shared one map. Keep file positions only in Files;
    // rebuild folder views once so their expanded files cannot inherit a sparse layout.
    const files = { positions: Object.fromEntries(Object.entries(active.positions).filter(([id]) => !id.startsWith('folder:'))),
      viewport: state.mode === 'files' ? active.viewport : undefined };
    layouts.files = files;
    active = state.mode === 'files' ? files : { positions: {}, viewport: undefined };
  }
  if (state.version < 3) {
    // Taller folder cards need one fresh layout; preserve the user's Files layout.
    for (const key of Object.keys(layouts)) { if (key !== 'files') { delete layouts[key]; } }
    if (state.mode === 'folders') { active = { positions: {}, viewport: undefined }; }
  }
  return { ...defaultView(), ...state, version: 3, layouts,
    selected: typeof state.selected === 'string' ? state.selected : undefined, ...active };
}
export const isTest = (path: string) => /(^|\/)(test|tests|__tests__)(\/|$)|\.(test|spec)\./i.test(path);
export function groupId(file: FileNode, depth: number): string | undefined {
  const folders = file.path.split('/').slice(0, -1);
  return folders.length ? `folder:${depth}:${folders.slice(0, depth).join('/')}` : undefined;
}
export function reconcileView(state: GraphViewState, graph: GraphSnapshot): GraphViewState {
  const ids = new Set(graph.nodes.map(node => node.id));
  const maxDepth = Math.max(1, ...graph.nodes.map(node => node.path.split('/').length - 1));
  const groupIds = new Set(graph.nodes.flatMap(node => Array.from({ length: maxDepth }, (_, index) => groupId(node, index + 1)).filter((id): id is string => !!id)));
  const selected = state.selected && (ids.has(state.selected) || groupIds.has(state.selected)) ? state.selected : undefined;
  const folders = new Set(graph.nodes.flatMap(node => node.path.split('/').slice(0, -1).map((_, index) => node.path.split('/').slice(0, index + 1).join('/'))));
  const prune = (layout: GraphLayoutState): GraphLayoutState => ({ ...layout,
    positions: Object.fromEntries(Object.entries(layout.positions).filter(([id]) => ids.has(id) || groupIds.has(id))) });
  const reconciled = { ...state, selected,
    focus: selected && ids.has(selected) ? state.focus : 0,
    folder: folders.has(state.folder) ? state.folder : '',
    expanded: state.expanded.filter(id => groupIds.has(id)),
    positions: prune(state).positions,
    layouts: Object.fromEntries(Object.entries(state.layouts).map(([key, value]) => [key, prune(value)])) };
  return switchLayout(reconciled, state.mode, Math.min(state.depth, maxDepth));
}
export interface PeekState { fileId?: string; groups: string[] }
export function projectGraph(graph: GraphSnapshot, state: GraphViewState, peek: PeekState = { groups: [] }): DisplayGraph {
  const connected = new Set(graph.edges.flatMap(edge => [edge.source, edge.target]));
  let files = graph.nodes.filter(file => (!state.folder || file.path.startsWith(state.folder + '/')) &&
    (!state.hideTests || !isTest(file.path)) && (!state.hideIsolated || connected.has(file.id)));
  if (state.focus && state.selected) {
    const allowed = new Set(files.map(file => file.id));
    const visited = new Set(allowed.has(state.selected) ? [state.selected] : []);
    let frontier = [...visited];
    const adjacency = new Map<string, Set<string>>();
    for (const edge of graph.edges) {
      if (!allowed.has(edge.source) || !allowed.has(edge.target)) { continue; }
      for (const [a, b] of [[edge.source, edge.target], [edge.target, edge.source]]) {
        if (!adjacency.has(a)) { adjacency.set(a, new Set()); }
        adjacency.get(a)!.add(b);
      }
    }
    for (let hop = 0; hop < state.focus; hop++) {
      const next = new Set<string>();
      for (const id of frontier) { for (const neighbor of adjacency.get(id) ?? []) { if (!visited.has(neighbor)) { visited.add(neighbor); next.add(neighbor); } } }
      frontier = [...next];
    }
    files = files.filter(file => visited.has(file.id));
  }
  const nodeMap = new Map<string, DisplayGraph['nodes'][number]>();
  const representative = new Map<string, string>();
  const related = new Map(graph.edges.filter(edge => edge.source === peek.fileId).map(edge => [edge.target, edge.sites]));
  for (const file of files) {
    const group = state.mode === 'folders' ? groupId(file, state.depth) : undefined;
    const collapsed = group && !state.expanded.includes(group) && !(peek.groups.includes(group) && related.has(file.id));
    const id = collapsed ? group : file.id;
    const groupPath = collapsed ? group.split(':').slice(2).join(':') : file.path;
    const node = nodeMap.get(id) ?? { id, kind: collapsed ? 'folder' : 'file', label: collapsed ? groupPath : file.name,
      path: groupPath, members: [], internalEdges: 0 };
    node.members.push(file.id);
    nodeMap.set(id, node);
    representative.set(file.id, id);
  }
  for (const node of nodeMap.values()) {
    if (node.kind === 'folder') { node.related = node.members.filter(id => related.has(id)).map(fileId => ({ fileId, sites: related.get(fileId)! })); }
  }
  const edges = new Map<string, DisplayGraph['edges'][number]>();
  for (const edge of graph.edges) {
    const source = representative.get(edge.source);
    const target = representative.get(edge.target);
    if (!source || !target) { continue; }
    if (source === target && nodeMap.get(source)?.kind === 'folder') { nodeMap.get(source)!.internalEdges++; continue; }
    const id = JSON.stringify([source, target]);
    const entry = edges.get(id) ?? { id, source, target, count: 0, fileEdges: [], symbolCount: 0 };
    entry.count++;
    entry.fileEdges!.push(edge.id);
    entry.symbolCount! += edge.sites.reduce((count, site) => count + (site.symbols?.length ?? 0), 0);
    edges.set(id, entry);
  }
  return { nodes: [...nodeMap.values()], edges: [...edges.values()], visibleFiles: files.length };
}
export function revealFile(state: GraphViewState, graph: GraphSnapshot, id: string): GraphViewState {
  const file = graph.nodes.find(node => node.id === id);
  if (!file) { return state; }
  const connected = graph.edges.some(edge => edge.source === id || edge.target === id);
  const group = groupId(file, state.depth);
  return { ...state, selected: id,
    folder: state.folder && !file.path.startsWith(state.folder + '/') ? '' : state.folder,
    hideTests: isTest(file.path) ? false : state.hideTests,
    hideIsolated: connected ? state.hideIsolated : false,
    expanded: group ? [...new Set([...state.expanded, group])] : state.expanded };
}
