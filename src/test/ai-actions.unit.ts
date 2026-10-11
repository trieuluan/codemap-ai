import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  actionCatalog,
  actionInstructions,
  parseAiActions,
  actionStillValid,
  dependencyPath,
} from '../shared/ai-actions';
import type { ContextBundle } from '../shared/context';
import type { GraphSnapshot } from '../shared/model';
import { defaultView } from '../shared/view';
import { readLocation, reconcileLocation, NavigationHistory } from '../shared/navigation';
import { readAiMessage } from '../shared/ai';

const graph: GraphSnapshot = {
  root: { id: 'root', name: 'fixture' },
  revision: 1,
  scannedAt: '',
  warnings: [],
  nodes: ['a', 'barrel', 'b', 'isolated'].map((id) => ({
    id,
    name: id + '.ts',
    path: 'src/' + id + '.ts',
    language: 'typescript',
    outside: [],
    declarations:
      id === 'b'
        ? [{ id: 'symbol', name: 'Widget', kind: 'function' as const, line: 0, character: 0 }]
        : [],
  })),
  edges: [
    ['a', 'barrel'],
    ['barrel', 'b'],
    ['b', 'a'],
  ].map(([source, target]) => ({ id: source + target, source, target, sites: [] })),
};
const bundle: ContextBundle = {
  rootId: 'root',
  revision: 1,
  builtAt: '',
  files: [
    {
      id: 'a',
      path: 'src/a.ts',
      language: 'typescript',
      declarations: [],
      content: 'export const secret = 123;',
      truncated: false,
      imports: [],
      dependents: [],
      outside: [],
      notes: [],
    },
  ],
  requested: 1,
  characters: 24,
  warnings: [],
};
const catalog = actionCatalog(graph, bundle);
const output = (actions: unknown) =>
  '## Answer\n\nEvidence.\n\n```codemap-actions\n' + JSON.stringify(actions) + '\n```';
test('catalog shares bounded metadata without source and prioritizes selected/import neighbors', () => {
  assert.equal(catalog.files[0].path, 'src/a.ts');
  assert.ok(!actionInstructions(catalog).includes('secret'));
  assert.deepEqual(catalog.imports, [
    ['src/a.ts', 'src/barrel.ts'],
    ['src/barrel.ts', 'src/b.ts'],
    ['src/b.ts', 'src/a.ts'],
  ]);
  const large = {
    ...graph,
    nodes: Array.from({ length: 1000 }, (_, i) => ({
      ...graph.nodes[0],
      id: String(i),
      path: `${i}.ts`,
    })),
  };
  assert.equal(actionCatalog(large, bundle).files.length, 80);
  assert.equal(actionCatalog(large, bundle).omitted, 920);
});
test('all five action kinds map paths/symbols to IDs and keep real import direction', () => {
  const parsed = parseAiActions(
    output([
      {
        kind: 'addContext',
        targets: [{ path: 'src/b.ts', symbol: 'Widget' }],
        reason: 'Read implementation',
      },
      { kind: 'focus', paths: ['src/a.ts', 'src/b.ts', 'src/a.ts'], reason: 'Compare' },
      { kind: 'path', from: 'src/a.ts', to: 'src/b.ts', reason: 'Follow barrel' },
      { kind: 'inspect', path: 'src/b.ts', symbol: 'Widget', reason: 'Explore' },
      { kind: 'impact', path: 'src/b.ts', symbol: 'Widget', reason: 'Assess consumers' },
    ]),
    graph,
    catalog,
  );
  assert.equal(parsed.answer, '## Answer\n\nEvidence.');
  assert.equal(parsed.actions.length, 5);
  assert.equal(parsed.warnings.length, 0);
  assert.ok(parsed.actions.every((a) => actionStillValid(a, graph)));
  const path = parsed.actions.find((a) => a.kind === 'path');
  assert.ok(path?.kind === 'path');
  assert.deepEqual(path.fileIds, ['a', 'barrel', 'b']);
  assert.deepEqual(dependencyPath(graph, 'b', 'barrel'), ['b', 'a', 'barrel']);
  assert.equal(dependencyPath(graph, 'isolated', 'a'), undefined);
});
test('unknown files, ambiguous symbols, invalid direction and commands stay inert', () => {
  const parsed = parseAiActions(
    output([
      { kind: 'addContext', targets: [{ path: '../secret' }], reason: 'Read' },
      { kind: 'addContext', targets: [{ path: 'src/a.ts' }], reason: 'Already included' },
      { kind: 'inspect', path: 'src/b.ts', symbol: 'invented', reason: 'Read' },
      { kind: 'path', from: 'src/isolated.ts', to: 'src/a.ts', reason: 'No route' },
      { kind: 'shell', command: 'rm -rf /', reason: 'Never' },
      { kind: 'focus', paths: ['src/a.ts'], reason: 'Valid' },
    ]),
    graph,
    catalog,
  );
  assert.equal(parsed.actions.length, 1);
  assert.equal(parsed.warnings.length, 5);
  const ambiguous = {
    ...graph,
    nodes: graph.nodes.map((n) =>
      n.id === 'b'
        ? { ...n, declarations: [...n.declarations!, { ...n.declarations![0], id: 'duplicate' }] }
        : n,
    ),
  };
  assert.equal(
    parseAiActions(
      output([{ kind: 'inspect', path: 'src/b.ts', symbol: 'Widget', reason: 'Read' }]),
      ambiguous,
      catalog,
    ).actions.length,
    0,
  );
  const restricted = { ...catalog, files: catalog.files.filter((f) => f.path !== 'src/b.ts') };
  assert.equal(
    parseAiActions(
      output([{ kind: 'inspect', path: 'src/b.ts', reason: 'Read' }]),
      graph,
      restricted,
    ).actions.length,
    0,
  );
});
test('malformed/multiple/oversized action blocks never produce executable suggestions', () => {
  for (const text of [
    '```codemap-actions\nno json\n```',
    output([]) + '\n' + output([]),
    output(Array(9).fill({ kind: 'focus', paths: ['src/a.ts'], reason: 'Read' })),
    output([{ kind: 'focus', paths: ['src/a.ts'], reason: '' }]),
  ]) {
    const parsed = parseAiActions(text, graph, catalog);
    assert.equal(parsed.actions.length, 0);
    assert.ok(parsed.warnings.length);
  }
  assert.equal(parseAiActions('plain Markdown', graph, catalog).answer, 'plain Markdown');
  assert.equal(
    readAiMessage({
      type: 'aiExecuteAction',
      rootId: 'root',
      regionKey: '[]',
      requestId: 'ask',
      actionId: 'action-0',
    })?.type,
    'aiExecuteAction',
  );
  assert.equal(readAiMessage({ type: 'aiExecuteAction', rootId: 'root', actionId: 2 }), undefined);
});
test('live follow-up JSON action fences use the same graph validation as explicit action fences', () => {
  const actions = [{ kind: 'focus', paths: ['src/a.ts'], reason: 'Confirm the implementation.' }];
  const text = output(actions).replace('```codemap-actions', '```json');
  assert.deepEqual(
    parseAiActions(text, graph, catalog),
    parseAiActions(output(actions), graph, catalog),
  );
  const unknown = parseAiActions(
    output([{ kind: 'inspect', path: '../secret.ts', reason: 'Unknown file' }]).replace(
      '```codemap-actions',
      '```json',
    ),
    graph,
    catalog,
  );
  assert.equal(unknown.actions.length, 0);
  assert.equal(unknown.warnings.length, 1);
  assert.equal(unknown.answer, '## Answer\n\nEvidence.');
  const oversized = parseAiActions(
    output(Array(9).fill(actions[0])).replace('```codemap-actions', '```json'),
    graph,
    catalog,
  );
  assert.equal(oversized.actions.length, 0);
  assert.ok(oversized.warnings.length);
});
test('ordinary JSON, malformed data and non-trailing examples stay untouched', () => {
  const actionExample = output([{ kind: 'focus', paths: ['src/a.ts'], reason: 'Example' }]).replace(
    '```codemap-actions',
    '```json',
  );
  for (const text of [
    '```json\n{"name":"demo"}\n```',
    '```json\n[{"kind":"event","reason":"example"}]\n```',
    '```json\n[{"kind":"focus","paths":["src/a.ts"]}]\n```',
    '```json\ninvalid\n```',
    actionExample + '\nThis is an example, not a suggestion.',
  ]) {
    const parsed = parseAiActions(text, graph, catalog);
    assert.equal(parsed.answer, text);
    assert.deepEqual(parsed.actions, []);
  }
  const mixed = '```json\n{"example":1}\n```\n\n' + actionExample;
  const parsed = parseAiActions(mixed, graph, catalog);
  assert.equal(parsed.actions.length, 1);
  assert.ok(parsed.answer.includes('{"example":1}'));
});
test('actions expire when an import route, symbol or file disappears', () => {
  const parsed = parseAiActions(
    output([
      { kind: 'path', from: 'src/a.ts', to: 'src/b.ts', reason: 'Trace' },
      { kind: 'impact', path: 'src/b.ts', symbol: 'Widget', reason: 'Impact' },
      { kind: 'focus', paths: ['src/a.ts'], reason: 'Focus' },
    ]),
    graph,
    catalog,
  );
  assert.equal(actionStillValid(parsed.actions[0], { ...graph, edges: [] }), false);
  assert.equal(
    actionStillValid(parsed.actions[1], {
      ...graph,
      nodes: graph.nodes.map((n) => ({ ...n, declarations: [] })),
    }),
    false,
  );
  assert.equal(actionStillValid(parsed.actions[2], { ...graph, nodes: [] }), false);
});
test('temporary focus survives navigation and reconciles missing files independently of paths', () => {
  const location = {
    view: defaultView(),
    region: ['a', 'b'],
    peek: [],
    positions: { a: { x: 2, y: 3 } },
  };
  const parsed = readLocation(location)!;
  assert.deepEqual(parsed.region, ['a', 'b']);
  const restored = reconcileLocation(parsed, {
    ...graph,
    nodes: graph.nodes.filter((n) => n.id !== 'b'),
  });
  assert.equal(restored.stale, true);
  assert.deepEqual(restored.location.region, ['a']);
  assert.deepEqual(restored.location.positions, { a: { x: 2, y: 3 } });
  const history = new NavigationHistory();
  history.visit({ ...location, region: undefined });
  history.visit(location);
  assert.equal(history.canBack, true);
  assert.equal(history.move(-1)?.region, undefined);
  assert.deepEqual(history.move(1)?.region, ['a', 'b']);
  assert.equal(readLocation({ ...location, region: ['a', 42] }), undefined);
});
