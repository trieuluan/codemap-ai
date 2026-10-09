import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { defaultView } from '../shared/view';
import {
  NavigationHistory,
  readLocation,
  reconcileLocation,
  resolveAnchor,
  type NavigationLocation,
} from '../shared/navigation';
import { readLibrary, annotationExists } from '../shared/library';
import { LibraryStore } from '../library-store';
import type { GraphSnapshot } from '../shared/model';

const graph: GraphSnapshot = {
  revision: 1,
  root: { id: 'root', name: 'root' },
  scannedAt: '',
  warnings: [],
  nodes: ['a', 'b'].map((id) => ({
    id,
    path: `src/${id}.ts`,
    name: id,
    language: 'typescript',
    outside: [],
    declarations: [{ id: 'new-offset', name: 'run', kind: 'function', line: 20, character: 0 }],
  })),
  edges: [{ id: 'ab', source: 'a', target: 'b', sites: [] }],
};
const location = (selected = 'a'): NavigationLocation => ({
  view: { ...defaultView(), selected },
  peek: [],
  positions: {},
  viewport: { x: 20, y: 30, zoom: 0.8 },
});

test('history restores camera, branches after Back, and bounds long sessions', () => {
  const history = new NavigationHistory();
  history.visit(location('a'));
  history.visit(location('b'));
  assert.equal(history.canBack, true);
  assert.equal(history.move(-1)?.view.selected, 'a');
  history.update({ ...location('a'), viewport: { x: 100, y: 200, zoom: 1 } });
  assert.equal(history.move(1)?.view.selected, 'b');
  assert.equal(history.move(-1)?.viewport?.x, 100);
  history.visit(location('branch'));
  assert.equal(history.canForward, false);
  for (let i = 0; i < 100; i++) {
    history.visit(location(`${i}`));
  }
  let count = 0;
  while (history.move(-1)) {
    count++;
  }
  assert.equal(count, 49);
});
test('restoration reconciles fresh graph, invalid paths and deleted selections', () => {
  const saved = {
    ...location('deleted'),
    path: ['a', 'b'],
    contextId: 'deleted',
    symbolsFileId: 'deleted',
  };
  const result = reconcileLocation(saved, graph);
  assert.equal(result.stale, true);
  assert.equal(result.location.view.selected, undefined);
  assert.equal(result.location.contextId, undefined);
  assert.deepEqual(result.location.path, ['a', 'b']);
  assert.equal(result.location.symbolsFileId, undefined);
  assert.equal(result.location.viewport, undefined);
  const removed = reconcileLocation(saved, { ...graph, edges: [] });
  assert.equal(removed.location.path, undefined);
  assert.equal(removed.stale, true);
});
test('symbol anchors survive source offsets and disappear safely when renamed', () => {
  const anchor = { nodeId: 'a', name: 'run', kind: 'function' as const };
  assert.equal(resolveAnchor(graph, anchor)?.id, 'new-offset');
  const result = reconcileLocation(
    { ...location(), symbol: anchor, impact: { nodeId: 'a', symbol: anchor } },
    graph,
  );
  assert.equal(result.stale, false);
  const changed = reconcileLocation(
    {
      ...location(),
      symbol: { ...anchor, name: 'old' },
      impact: { nodeId: 'a', symbol: { ...anchor, name: 'old' } },
    },
    graph,
  );
  assert.equal(changed.location.impact, undefined);
  assert.equal(changed.location.symbol, undefined);
});
test('saved data rejects malformed records and keeps no source or graph snapshot', () => {
  assert.deepEqual(readLibrary({ version: 99 }), { version: 1, views: [], annotations: [] });
  assert.equal(
    readLocation({
      view: defaultView(),
      peek: [],
      symbol: { nodeId: 'a', name: 'x', kind: 'bad' },
    }),
    undefined,
  );
  const library = readLibrary({
    version: 1,
    views: [
      { id: 'v', name: ' View ', location: { ...location(), source: 'secret', snapshot: graph } },
    ],
    annotations: [
      null,
      { target: { kind: 'file', id: 'a' }, text: 'Purpose', role: 'UI' },
      { target: { kind: 'folder', id: 'src' }, text: 'Layer', role: 'API' },
      { target: { kind: 'file', id: 'b' }, text: 'x', role: 'invalid' },
    ],
  });
  assert.equal(library.views[0].name, 'View');
  assert.equal(library.annotations.length, 2);
  assert.ok(!JSON.stringify(library).includes('secret'));
  assert.ok(!JSON.stringify(library).includes('snapshot'));
  assert.equal(annotationExists({ kind: 'folder', id: 'src' }, graph), true);
  assert.equal(annotationExists({ kind: 'folder', id: 'sr' }, graph), false);
});
test('library persists across store restart, separates roots and retains orphan notes', async () => {
  const data = new Map<string, unknown>();
  const storage = {
    get: <T>(key: string) => data.get(key) as T | undefined,
    update: async (key: string, value: unknown) => {
      data.set(key, structuredClone(value));
    },
  };
  const store = new LibraryStore(storage);
  const library = {
    version: 1,
    views: [{ id: 'v', name: 'Architecture', location: location() }],
    annotations: [
      { target: { kind: 'file', id: 'deleted' }, text: 'Keep this note', role: 'Shared' },
    ],
  };
  await store.save('root', library);
  await store.flush();
  const restarted = new LibraryStore(storage);
  assert.equal(restarted.get('root').views[0].name, 'Architecture');
  assert.equal(restarted.get('other').views.length, 0);
  assert.equal(restarted.get('root').annotations[0].text, 'Keep this note');
  await restarted.save('root', { ...library, views: [] });
  assert.equal(new LibraryStore(storage).get('root').views.length, 0);
});
test('malformed library entries cannot crash loading', () => {
  for (const input of [
    null,
    1,
    'bad',
    {
      version: 1,
      views: [
        null,
        {},
        { id: 'x', name: 'x', location: { view: defaultView(), peek: [], impact: 3 } },
      ],
      annotations: [{}, { target: 3, text: 'bad' }],
    },
  ]) {
    assert.doesNotThrow(() => readLibrary(input));
  }
});

test('restoration retains existing positions, removes deleted geometry and leaves new nodes for placement', () => {
  const original = location('a');
  original.view.positions = { a: { x: 4, y: 8 }, deleted: { x: 99, y: 99 } };
  original.view.layouts.files = { positions: { a: { x: 4, y: 8 }, deleted: { x: 99, y: 99 } } };
  original.positions = { a: { x: 4, y: 8 }, deleted: { x: 99, y: 99 } };
  original.symbolsFileId = 'a';
  const restored = reconcileLocation(original, graph).location;
  assert.deepEqual(restored.view.positions, { a: { x: 4, y: 8 } });
  assert.deepEqual(restored.view.layouts.files.positions, { a: { x: 4, y: 8 } });
  assert.deepEqual(restored.positions, { a: { x: 4, y: 8 } });
  assert.equal(Object.hasOwn(restored.view.positions, 'b'), false);
});
test('saved metadata strips unknown fields from nested view, viewport and anchors', () => {
  const saved = location();
  const malicious = {
    ...saved,
    view: {
      ...saved.view,
      source: 'private source',
      viewport: { x: 0, y: 0, zoom: 1, source: 'private source' },
    },
    symbol: { nodeId: 'a', name: 'run', kind: 'function', source: 'private source' },
    impact: { nodeId: 'a', source: 'private source' },
  };
  const cleaned = readLocation(malicious);
  assert.ok(cleaned);
  assert.ok(!JSON.stringify(cleaned).includes('private source'));
});
