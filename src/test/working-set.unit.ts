import { ViewStore } from '../view-store';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  createWorkingSet,
  extendWorkingSet,
  readWorkingSet,
  reconcileWorkingSet,
  workingDisplay,
} from '../shared/working-set';
import { parseCodingPlan, planEditScope } from '../shared/ai-plan';
import { importDelta, reviewFileState } from '../shared/review-graph';
import { defaultView, readView, reconcileView } from '../shared/view';
import { readAiMessage, type AiProposal } from '../shared/ai';
import type { GraphSnapshot } from '../shared/model';
import type { ContextBundle } from '../shared/context';
const graph: GraphSnapshot = {
  root: { id: 'root', name: 'test' },
  revision: 1,
  scannedAt: '',
  warnings: [],
  nodes: ['a', 'b', 'c', 'd'].map((id) => ({
    id,
    name: id + '.ts',
    path: (id === 'a' ? 'src/pages/' : 'src/components/') + id + '.ts',
    language: 'typescript',
    outside: [],
    declarations: [
      { id: id + 'symbol', name: id, kind: 'function' as const, line: 1, character: 0 },
    ],
  })),
  edges: [
    ['a', 'b'],
    ['a', 'c'],
    ['b', 'a'],
    ['b', 'd'],
  ].map(([source, target]) => ({ id: source + target, source, target, sites: [] })),
};
const bundle: ContextBundle = {
  rootId: 'root',
  revision: 1,
  builtAt: '',
  requested: 4,
  characters: 8,
  warnings: [],
  files: graph.nodes.map((n) => ({
    ...n,
    declarations: n.declarations ?? [],
    content: 'source',
    truncated: false,
    imports: [],
    dependents: [],
    notes: [],
  })),
};
const raw = (steps: unknown[]) => JSON.stringify({ summary: 'Update a', steps });
const step = {
  path: graph.nodes[0].path,
  role: 'edit',
  reason: 'Fix the calculation',
  symbol: 'a',
};
test('task state separates map/source/edit scope, strips source and limits metadata', () => {
  const set = readWorkingSet({
    ...createWorkingSet(['a', 'b']),
    context: ['a'],
    editable: ['a', 'b', 'foreign'],
    pinned: ['foreign', 'a'],
    source: 'never persist',
    symbols: [{ nodeId: 'a', name: 'a', kind: 'function', source: 'secret' }],
  })!;
  assert.deepEqual(set.editable, ['a']);
  assert.deepEqual(set.pinned, ['a']);
  assert.ok(!JSON.stringify(set).includes('secret'));
  assert.ok(!('source' in set));
  assert.equal(readWorkingSet({ ...set, files: [42] }), undefined);
  assert.equal(
    createWorkingSet(Array.from({ length: 250 }, (_, i) => String(i))).files.length,
    200,
  );
  assert.equal(
    createWorkingSet(Array.from({ length: 250 }, (_, i) => String(i))).context.length,
    50,
  );
  assert.deepEqual(extendWorkingSet(set, ['c']).context, ['a']);
  assert.deepEqual(extendWorkingSet(set, ['c']).editable, ['a']);
});
test('working projection groups only direct outside neighbors and retains exact direction/count', () => {
  const display = workingDisplay(graph, createWorkingSet(['a']));
  assert.deepEqual(
    display.nodes.map((n) => n.id),
    ['a', 'boundary:src/components'],
  );
  assert.deepEqual(display.nodes[1].members, ['b', 'c']);
  assert.deepEqual(
    display.edges.map((e) => [e.source, e.target, e.count, e.fileEdges]),
    [
      ['a', 'boundary:src/components', 2, ['ab', 'ac']],
      ['boundary:src/components', 'a', 1, ['ba']],
    ],
  );
  assert.equal(display.visibleFiles, 3);
  assert.equal(graph.nodes.length, 4);
  assert.equal(graph.edges.length, 4);
});
test('task persists in view metadata, reconciles removed files/symbols and keeps boundary geometry', () => {
  const set = {
    ...createWorkingSet(['a', 'b']),
    editable: ['a'],
    pinned: ['a'],
    symbols: [{ nodeId: 'a', name: 'a', kind: 'function' as const }],
  };
  const view = readView({
    ...defaultView(),
    workingSet: set,
    positions: { a: { x: 10, y: 20 }, 'boundary:src/components': { x: 500, y: 20 } },
    layouts: { 'workspace:files': { positions: { a: { x: 1, y: 2 } } } },
  });
  assert.deepEqual(view.workingSet, set);
  assert.deepEqual(view.layouts['workspace:files'].positions.a, { x: 1, y: 2 });
  const fresh = reconcileView(view, { ...graph, nodes: graph.nodes.filter((n) => n.id !== 'b') });
  assert.deepEqual(fresh.workingSet?.files, ['a']);
  assert.ok(fresh.positions['boundary:src/components']);
  assert.equal(
    reconcileWorkingSet(set, {
      ...graph,
      nodes: graph.nodes.map((n) => ({ ...n, declarations: [] })),
    }).symbols.length,
    0,
  );
  assert.equal(
    readView({ ...defaultView(), workingSet: { name: 'broken' } }).workingSet,
    undefined,
  );
});
test('coding plans accept known context symbols and reject read-only/unknown/ambiguous targets', () => {
  const plan = parseCodingPlan(
    raw([step, { path: graph.nodes[1].path, role: 'read', reason: 'Verify consumer' }]),
    bundle,
    graph,
    ['a'],
    'plan',
  );
  assert.deepEqual(planEditScope(plan, ['plan:0']), ['a']);
  assert.throws(() => planEditScope(plan, ['plan:1']));
  assert.throws(() => planEditScope(plan, ['plan:0', 'plan:0']));
  assert.throws(() => planEditScope(plan, ['invented']));
  for (const invalid of [
    { ...step, path: '../secret' },
    { ...step, role: 'shell' },
    { ...step, symbol: 'invented' },
    { ...step, reason: '' },
    { ...step, path: graph.nodes[1].path, symbol: 'b' },
  ]) {
    assert.throws(() => parseCodingPlan(raw([invalid]), bundle, graph, ['a'], 'p'));
  }
  assert.throws(() => parseCodingPlan(raw(Array(21).fill(step)), bundle, graph, ['a'], 'p'));
  assert.throws(() => parseCodingPlan(raw([step]), bundle, { ...graph, revision: 2 }, ['a'], 'p'));
  const ambiguous = {
    ...graph,
    nodes: graph.nodes.map((n) =>
      n.id === 'a'
        ? { ...n, declarations: [...n.declarations!, { ...n.declarations![0], id: 'other' }] }
        : n,
    ),
  };
  assert.throws(() => parseCodingPlan(raw([step]), bundle, ambiguous, ['a'], 'p'));
});
test('review badges distinguish partial acceptance, reviewed and actually applied edits', () => {
  const proposal = {
    id: 'p',
    changes: [
      { id: 'x', fileId: 'a' },
      { id: 'y', fileId: 'a' },
    ],
  } as AiProposal;
  const review = { proposal, accepted: ['x'], reviewed: [], state: 'ready', applied: [] };
  assert.equal(reviewFileState(review, 'a'), 'Needs review');
  assert.equal(reviewFileState({ ...review, reviewed: ['x'] }, 'a'), 'Reviewed');
  assert.equal(reviewFileState({ ...review, accepted: [] }, 'a'), 'Rejected');
  assert.equal(
    reviewFileState({ ...review, state: 'applied', applied: ['x'] }, 'a'),
    'Applied earlier',
  );
  assert.equal(reviewFileState({ ...review, state: 'applied' }, 'a'), 'Rejected');
  assert.equal(reviewFileState(review, 'b'), undefined);
});
test('graph delta compares directed file pairs rather than unstable edge IDs', () => {
  const after = {
    ...graph,
    edges: [
      { ...graph.edges[0], id: 'new-id' },
      { id: 'ca', source: 'c', target: 'a', sites: [] },
    ],
  };
  const delta = importDelta(graph, after);
  assert.deepEqual(
    delta.added.map((e) => e.id),
    ['ca'],
  );
  assert.deepEqual(
    delta.removed.map((e) => e.id),
    ['ac', 'ba', 'bd'],
  );
});
test('new AI messages validate permission lists, plan step IDs and required preview selection', () => {
  const request = {
    type: 'aiRequest',
    rootId: 'root',
    contextId: 'context',
    requestId: 'p',
    question: 'Plan',
    mode: 'plan',
    editableFileIds: ['a'],
  };
  assert.equal(readAiMessage(request)?.type, 'aiRequest');
  assert.equal(readAiMessage({ ...request, editableFileIds: [42] }), undefined);
  assert.equal(readAiMessage({ ...request, planStepIds: 'all' }), undefined);
  assert.equal(readAiMessage({ type: 'aiPreviewGraph', proposalId: 'p' }), undefined);
  assert.equal(
    readAiMessage({ type: 'aiPreviewGraph', proposalId: 'p', changeIds: ['x'] })?.type,
    'aiPreviewGraph',
  );
});

test('task scope survives storage flush and a new store without crossing roots', async () => {
  const values = new Map<string, unknown>();
  const storage = {
    get: <T>(key: string) => values.get(key) as T | undefined,
    update: async (key: string, value: unknown) => {
      values.set(key, value);
    },
  };
  const store = new ViewStore(storage);
  const task = {
    ...createWorkingSet(['a', 'b'], 'Dashboard cleanup'),
    editable: ['a'],
    pinned: ['b'],
  };
  store.save('root', { ...defaultView(), workingSet: task, positions: { a: { x: 12, y: 34 } } });
  await store.flush();
  const reopened = new ViewStore(storage);
  assert.deepEqual(reopened.get('root').workingSet, task);
  assert.deepEqual(reopened.get('root').positions.a, { x: 12, y: 34 });
  assert.equal(reopened.get('other-root').workingSet, undefined);
});
