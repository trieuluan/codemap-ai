import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { defaultView, groupId, projectGraph, readView, reconcileView, revealFile, switchLayout } from '../shared/view';
import type { GraphSnapshot } from '../shared/model';
import { ViewStore, type StateStorage } from '../view-store';
const graph: GraphSnapshot = {
  revision: 1, root: { id: 'root', name: 'root' }, scannedAt: '', warnings: [],
  nodes: ['entry.ts', 'src/services/a.ts', 'src/services/b.ts', 'src/ui/App.tsx', 'test/a.test.ts', 'src/alone.ts'].map((path, i) =>
    ({ id: String(i), path, name: path.split('/').pop()!, language: 'typescript', outside: [] })),
  edges: [[0, 1], [1, 2], [2, 1], [1, 3], [2, 3], [4, 1]].map(([a, b], i) => ({ id: String(i), source: String(a), target: String(b), sites: [] })),
};
test('folder projection aggregates directed edges and internal cycles, root files remain files', () => {
  const view = { ...defaultView(), mode: 'folders' as const };
  const display = projectGraph(graph, view);
  const services = display.nodes.find(node => node.path === 'src/services')!;
  assert.deepEqual(services.members, ['1', '2']); assert.equal(services.internalEdges, 2);
  assert.equal(display.nodes.find(node => node.id === '0')?.kind, 'file');
  assert.equal(display.edges.find(edge => edge.source === services.id && edge.target === 'folder:2:src/ui')?.count, 2);
  assert.equal(display.visibleFiles, 6);
  view.expanded = [services.id];
  assert.ok(projectGraph(graph, view).nodes.some(node => node.id === '1'));
  assert.ok(projectGraph(graph, view).edges.some(edge => edge.source === '1' && edge.target === '2'));
});
test('shallow files group under immediate parent; depth changes stable group IDs', () => {
  assert.equal(groupId(graph.nodes[5], 2), 'folder:2:src');
  const display = projectGraph(graph, { ...defaultView(), mode: 'folders', depth: 1 });
  assert.equal(display.nodes.find(node => node.path === 'src')?.members.length, 4);
});
test('filters precede bidirectional BFS without changing edge directions', () => {
  const one = projectGraph(graph, { ...defaultView(), selected: '0', focus: 1 });
  assert.deepEqual(one.nodes.map(node => node.id), ['0', '1']);
  const two = projectGraph(graph, { ...defaultView(), selected: '0', focus: 2, hideTests: true });
  assert.deepEqual(two.nodes.map(node => node.id), ['0', '1', '2', '3']);
  assert.ok(two.edges.some(edge => edge.source === '2' && edge.target === '1'));
  assert.deepEqual(projectGraph(graph, { ...defaultView(), folder: 'src/services', hideIsolated: true }).nodes.map(node => node.id), ['1', '2']);
  assert.equal(projectGraph(graph, { ...defaultView(), hideTests: true, hideIsolated: true }).visibleFiles, 4);
});
test('search reveals hidden results and opens containing group', () => {
  const view = revealFile({ ...defaultView(), mode: 'folders', folder: 'src', hideTests: true, hideIsolated: true, focus: 1 }, graph, '4');
  assert.equal(view.folder, ''); assert.equal(view.hideTests, false); assert.equal(view.selected, '4');
  assert.ok(view.expanded.includes('folder:2:test'));
  assert.ok(projectGraph(graph, view).nodes.some(node => node.id === '4'));
});
test('state validation and reconciliation remove stale IDs while retaining hidden positions', () => {
  assert.deepEqual(readView({ version: 99 }), defaultView());
  const restored = readView({ ...defaultView(), positions: { '1': { x: 10, y: 20 }, bad: { x: NaN, y: 0 } }, viewport: { x: 0, y: 0, zoom: 100 } });
  assert.deepEqual(restored.positions, { '1': { x: 10, y: 20 } }); assert.equal(restored.viewport, undefined);
  const reconciled = reconcileView({ ...restored, selected: 'deleted', focus: 2, expanded: ['folder:2:src/services', 'folder:2:deleted'], positions: { ...restored.positions, deleted: { x: 1, y: 1 } } }, graph);
  assert.equal(reconciled.selected, undefined); assert.equal(reconciled.focus, 0);
  assert.deepEqual(reconciled.expanded, ['folder:2:src/services']); assert.deepEqual(reconciled.positions, { '1': { x: 10, y: 20 } });
});
test('view storage flushes latest changes before close and separates roots/restarts', async () => {
  const values = new Map<string, unknown>();
  const storage: StateStorage = { get<T>(key: string) { return values.get(key) as T | undefined; }, update: async (key, value) => { values.set(key, value); } };
  const store = new ViewStore(storage);
  store.save('one', { ...defaultView(), hideTests: true });
  store.save('one', { ...defaultView(), hideTests: true, viewport: { x: 5, y: 10, zoom: 0.8 } });
  store.save('two', { ...defaultView(), mode: 'folders' });
  await store.flush();
  const reopened = new ViewStore(storage);
  assert.equal(reopened.get('one').hideTests, true); assert.equal(reopened.get('two').mode, 'folders');
  assert.equal(reopened.get('one').viewport?.zoom, 0.8);
  reopened.save('one', defaultView()); await reopened.flush();
  assert.equal(new ViewStore(storage).get('one').hideTests, false);
});
test('mode and folder depth keep independent positions and viewports, including after restart', () => {
  const files = { ...defaultView(), positions: { '1': { x: 9000, y: 2000 } }, viewport: { x: -8000, y: 30, zoom: 0.2 } };
  const freshFolders = switchLayout(files, 'folders');
  assert.deepEqual(freshFolders.positions, {}); assert.equal(freshFolders.viewport, undefined);
  const folders = { ...freshFolders, positions: { '1': { x: 20, y: 30 } }, viewport: { x: 5, y: 10, zoom: 1 } };
  const freshDepth = switchLayout(folders, 'folders', 1);
  assert.deepEqual(freshDepth.positions, {}); assert.equal(freshDepth.viewport, undefined);
  const depthOne = { ...freshDepth, positions: { 'folder:1:src': { x: 40, y: 50 } }, viewport: { x: 3, y: 4, zoom: 0.7 } };
  const restarted = readView(JSON.parse(JSON.stringify(depthOne)));
  const backToFiles = switchLayout(restarted, 'files');
  assert.deepEqual(backToFiles.positions, files.positions); assert.deepEqual(backToFiles.viewport, files.viewport);
  const backToFolders = switchLayout(backToFiles, 'folders', 2);
  assert.deepEqual(backToFolders.positions, folders.positions); assert.deepEqual(backToFolders.viewport, folders.viewport);
  const backToDepthOne = switchLayout(backToFolders, 'folders', 1);
  assert.deepEqual(backToDepthOne.positions, depthOne.positions); assert.deepEqual(backToDepthOne.viewport, depthOne.viewport);
});
test('legacy shared layouts migrate without leaking file coordinates into folders', () => {
  const legacy = { ...defaultView(), version: 1, mode: 'folders', positions: { '1': { x: 9000, y: 0 }, 'folder:2:src/services': { x: 20, y: 30 } }, viewport: { x: 100, y: 200, zoom: 0.5 } };
  const migrated = readView(legacy);
  assert.equal(migrated.version, 3); assert.deepEqual(migrated.positions, {}); assert.equal(migrated.viewport, undefined);
  assert.deepEqual(switchLayout(migrated, 'files').positions, { '1': { x: 9000, y: 0 } });
  assert.deepEqual(readView({ ...legacy, mode: 'files' }).viewport, legacy.viewport);
});
test('reconciliation removes deleted nodes from all layout profiles and validates stored profiles', () => {
  const state = readView({ ...defaultView(), layouts: {
    files: { positions: { '1': { x: 10, y: 20 }, deleted: { x: 30, y: 40 } } },
    'folders:2': { positions: { 'folder:2:src/services': { x: 50, y: 60 }, bad: { x: 'invalid', y: 0 } }, viewport: { x: 0, y: 0, zoom: 100 } },
    invalid: { positions: { '1': { x: 10, y: 20 } } },
  } });
  const restored = reconcileView(state, graph);
  assert.deepEqual(restored.layouts.files.positions, { '1': { x: 10, y: 20 } });
  assert.deepEqual(restored.layouts['folders:2'].positions, { 'folder:2:src/services': { x: 50, y: 60 } });
  assert.equal(restored.layouts['folders:2'].viewport, undefined); assert.equal(restored.layouts.invalid, undefined);
});
test('folder context and Peek expose only imported members, preserving directed file relationships', () => {
  const state = { ...defaultView(), mode: 'folders' as const, selected: '0' };
  const collapsed = projectGraph(graph, state, { fileId: '0', groups: [] });
  const folder = collapsed.nodes.find(node => node.id === 'folder:2:src/services')!;
  assert.deepEqual(folder.related?.map(item => item.fileId), ['1']);
  const peeked = projectGraph(graph, state, { fileId: '0', groups: [folder.id] });
  assert.ok(peeked.nodes.some(node => node.id === '1' && node.kind === 'file'));
  assert.deepEqual(peeked.nodes.find(node => node.id === folder.id)?.members, ['2']);
  assert.ok(peeked.edges.some(edge => edge.source === '0' && edge.target === '1'));
  assert.ok(peeked.edges.some(edge => edge.source === '1' && edge.target === folder.id));
  assert.ok(peeked.edges.some(edge => edge.source === folder.id && edge.target === '1'));
  assert.equal(peeked.edges.flatMap(edge => edge.fileEdges ?? []).length, graph.edges.length);
  assert.equal(peeked.visibleFiles, graph.nodes.length);
  assert.deepEqual(state.expanded, []);
  assert.deepEqual(projectGraph(graph, state, { fileId: '0', groups: [] }).nodes.map(node => node.id), collapsed.nodes.map(node => node.id));
});
test('larger folder cards migrate old folder layouts once without losing Files coordinates', () => {
  const files = { positions: { '1': { x: 100, y: 20 } }, viewport: { x: 1, y: 2, zoom: 0.5 } };
  const migrated = readView({ ...defaultView(), version: 2, mode: 'folders', positions: { '1': { x: 5, y: 6 } }, layouts: { files, 'folders:2': files } });
  assert.deepEqual(migrated.positions, {}); assert.equal(migrated.layouts['folders:2'], undefined);
  assert.deepEqual(switchLayout(migrated, 'files').positions, files.positions);
});
