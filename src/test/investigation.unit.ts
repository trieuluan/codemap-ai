import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { GraphSnapshot } from '../shared/model';
import { analyzeImpact, graphForPath, withSymbols, symbolNodeId } from '../shared/investigation';
import { defaultView, projectGraph, readView, reconcileView } from '../shared/view';

const graph: GraphSnapshot = {
  revision: 1,
  root: { id: 'root', name: 'root' },
  scannedAt: '',
  warnings: [],
  nodes: ['target', 'direct', 'indirect', 'cycle', 'isolated'].map((id) => ({
    id,
    path: `src/${id}.ts`,
    name: `${id}.ts`,
    language: 'typescript',
    outside: [],
    declarations:
      id === 'target' ? [{ id: '0', name: 'Target', kind: 'class', line: 2, character: 3 }] : [],
  })),
  edges: [
    ['direct', 'target'],
    ['indirect', 'direct'],
    ['cycle', 'indirect'],
    ['target', 'cycle'],
    ['cycle', 'target'],
  ].map(([source, target]) => ({ id: `${source}:${target}`, source, target, sites: [] })),
};

test('file impact follows reverse imports with shortest explanations and terminates cycles', () => {
  const entries = analyzeImpact(graph, { nodeId: 'target' });
  assert.deepEqual(
    entries.map((entry) => [entry.nodeId, entry.direct, entry.path]),
    [
      ['cycle', true, ['cycle', 'target']],
      ['direct', true, ['direct', 'target']],
      ['indirect', false, ['indirect', 'direct', 'target']],
    ],
  );
  assert.equal(
    entries.some((entry) => entry.nodeId === 'target' || entry.nodeId === 'isolated'),
    false,
  );
  assert.deepEqual(analyzeImpact(graph, { nodeId: 'missing' }), []);
});

test('path projection retains exact directed source edges without mutating the full graph', () => {
  const saved = JSON.stringify(graph);
  const path = graphForPath(graph, ['cycle', 'indirect', 'direct', 'target']);
  assert.equal(path.nodes.length, 4);
  assert.deepEqual(
    path.edges.map((edge) => edge.id),
    ['direct:target', 'indirect:direct', 'cycle:indirect'],
  );
  assert.equal(
    path.edges.some((edge) => edge.id === 'cycle:target'),
    false,
  );
  assert.equal(JSON.stringify(graph), saved);
});

test('symbol canvas adds declaration relations only and leaves file counts/import edges unchanged', () => {
  const display = projectGraph(graph, defaultView());
  const expanded = withSymbols(display, graph.nodes[0]);
  assert.equal(display.nodes.length, graph.nodes.length);
  assert.equal(expanded.visibleFiles, display.visibleFiles);
  const node = expanded.nodes.find((node) => node.kind === 'symbol')!;
  assert.equal(node.id, symbolNodeId('target', '0'));
  assert.equal(node.ownerId, 'target');
  assert.equal(expanded.edges.at(-1)!.relation, 'declaration');
  assert.deepEqual(expanded.edges.slice(0, -1), display.edges);
  assert.equal(
    withSymbols(
      projectGraph(graph, { ...defaultView(), mode: 'folders' }),
      graph.nodes[0],
    ).nodes.some((node) => node.kind === 'symbol'),
    false,
  );
});

test('Follow editor migrates safely and persists without transient inspection data', () => {
  assert.equal(readView({ ...defaultView(), followEditor: undefined }).followEditor, false);
  assert.equal(readView({ ...defaultView(), followEditor: 'yes' }).followEditor, false);
  const state = reconcileView(
    readView({
      ...defaultView(),
      followEditor: true,
      positions: {
        target: { x: 10, y: 20 },
        [symbolNodeId('target', '0')]: { x: 50, y: 60 },
      },
    }),
    graph,
  );
  assert.equal(state.followEditor, true);
  assert.deepEqual(state.positions, { target: { x: 10, y: 20 } });
});
