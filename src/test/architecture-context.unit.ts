import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { GraphSnapshot } from '../shared/model';
import { architectureOverview, dependencyCycles } from '../shared/architecture';
import { buildContext, contextCandidates, contextLimits, contextMarkdown } from '../shared/context';
import { defaultView } from '../shared/view';
import { readLocation, reconcileLocation } from '../shared/navigation';
const graph: GraphSnapshot = {
  revision: 3,
  root: { id: 'root', name: 'fixture' },
  scannedAt: '',
  warnings: [],
  nodes: [
    'src/pages/main.ts',
    'src/ui/card.ts',
    'src/ui/theme.ts',
    'src/pages/main.test.ts',
    'isolated.ts',
  ].map((path) => ({
    id: path,
    path,
    name: path.split('/').at(-1)!,
    language: 'typescript',
    outside: [],
    declarations: [],
  })),
  edges: [
    ['src/pages/main.ts', 'src/ui/card.ts'],
    ['src/ui/card.ts', 'src/ui/theme.ts'],
    ['src/ui/theme.ts', 'src/ui/card.ts'],
    ['src/pages/main.test.ts', 'src/ui/card.ts'],
  ].map(([source, target]) => ({ id: source + target, source, target, sites: [] })),
};

test('architecture summarizes directed module imports, central files, candidates and actual cycles', () => {
  const result = architectureOverview(graph, 2);
  assert.equal(result.modules.find((n) => n.path === 'src/ui')?.members.length, 2);
  assert.equal(result.modules.find((n) => n.path === 'src/ui')?.incoming, 2);
  assert.equal(result.modules.find((n) => n.path === 'src/ui')?.internalEdges, 2);
  assert.deepEqual(
    result.entries.map((n) => n.file.path),
    ['src/pages/main.ts'],
  );
  assert.equal(result.central[0].file.path, 'src/ui/card.ts');
  assert.equal(result.central[0].incoming, 3);
  assert.deepEqual(result.cycles, [['src/ui/card.ts', 'src/ui/theme.ts']]);
  assert.ok(
    result.display.edges.some(
      (e) => e.source === 'folder:2:src/pages' && e.target === 'folder:2:src/ui' && e.count === 2,
    ),
  );
});
test('cycles handle self-imports, disconnected components and exclude one-way paths', () => {
  assert.deepEqual(
    dependencyCycles(
      ['a', 'b', 'c', 'd'],
      [
        { source: 'a', target: 'a' },
        { source: 'b', target: 'c' },
        { source: 'c', target: 'b' },
        { source: 'd', target: 'b' },
      ],
    ),
    [['b', 'c'], ['a']],
  );
  assert.deepEqual(dependencyCycles(['a', 'b'], [{ source: 'a', target: 'b' }]), []);
  assert.deepEqual(dependencyCycles([], []), []);
});
test('aggregated module cycles are not mislabeled as file cycles', () => {
  const nodes = ['a/one.ts', 'a/two.ts', 'b/one.ts', 'b/two.ts'].map((path) => ({
    id: path,
    path,
    name: path,
    language: 'typescript',
    outside: [],
  }));
  assert.deepEqual(
    architectureOverview({
      ...graph,
      nodes,
      edges: [
        { id: 'ab', source: nodes[0].id, target: nodes[2].id, sites: [] },
        { id: 'ba', source: nodes[3].id, target: nodes[1].id, sites: [] },
      ],
    }).cycles,
    [],
  );
});
test('context candidates include only requested direct neighbors, with selected files first', () => {
  assert.deepEqual(
    contextCandidates(graph, ['src/ui/card.ts'], true, true).map((n) => n.id),
    ['src/ui/card.ts', 'src/pages/main.test.ts', 'src/pages/main.ts', 'src/ui/theme.ts'],
  );
  assert.deepEqual(
    contextCandidates(graph, ['src/pages/main.ts'], true, false).map((n) => n.id),
    ['src/pages/main.ts', 'src/ui/card.ts'],
  );
});
test('context reads chosen files, keeps metadata and scoped notes, and continues on read failure', async () => {
  const readIds: string[] = [];
  const bundle = await buildContext(
    graph,
    ['src/pages/main.ts', 'src/ui/card.ts', 'foreign'],
    [
      { target: { kind: 'folder', id: 'src/pages' }, text: 'Page layer', role: 'UI' },
      { target: { kind: 'file', id: 'src/ui/card.ts' }, text: 'Card' },
      { target: { kind: 'folder', id: 'src/page' }, text: 'Wrong prefix' },
    ],
    async (id) => {
      readIds.push(id);
      if (id.includes('card')) {
        throw new Error('missing');
      }
      return 'unsaved contents';
    },
  );
  assert.deepEqual(readIds, ['src/pages/main.ts', 'src/ui/card.ts']);
  assert.equal(bundle.files.length, 1);
  assert.equal(bundle.files[0].content, 'unsaved contents');
  assert.equal(bundle.files[0].imports[0].path, 'src/ui/card.ts');
  assert.equal(bundle.files[0].notes.length, 1);
  assert.equal(bundle.warnings.length, 2);
});
test('context budgets cap file count, per-file source and total source explicitly', async () => {
  const nodes = Array.from({ length: 60 }, (_, i) => ({
    id: String(i),
    path: `${i}.ts`,
    name: `${i}.ts`,
    language: 'typescript',
    outside: [],
  }));
  const large = await buildContext(
    { ...graph, nodes, edges: [] },
    nodes.map((n) => n.id),
    [],
    async () => 'x'.repeat(30000),
  );
  assert.equal(large.characters, contextLimits.total);
  assert.ok(large.files.every((file) => file.content.length <= contextLimits.perFile));
  assert.ok(large.warnings.some((w) => w.includes('first 50')));
  assert.ok(large.warnings.some((w) => w.includes('remaining files')));
  const count = await buildContext(
    { ...graph, nodes, edges: [] },
    nodes.map((n) => n.id),
    [],
    async () => 'x',
  );
  assert.equal(count.files.length, 50);
});
test('copy uses exact reviewed source with fence-safe Markdown and architecture metadata', async () => {
  const bundle = await buildContext(
    graph,
    ['src/pages/main.ts'],
    [{ target: { kind: 'folder', id: 'src' }, text: 'Layer', role: 'UI' }],
    async () => 'const text = "```";',
  );
  const markdown = contextMarkdown(bundle);
  assert.ok(markdown.includes('````typescript\nconst text = "```";\n````'));
  assert.ok(markdown.includes('Architecture UI (folder): Layer'));
  assert.ok(markdown.includes('src/ui/card.ts'));
});
test('architecture view restores depth/camera without overwriting file layout', () => {
  const location = readLocation({
    view: { ...defaultView(), positions: { 'src/pages/main.ts': { x: 8, y: 4 } } },
    peek: [],
    positions: { 'folder:2:src/ui': { x: 100, y: 200 } },
    overviewDepth: 2,
    viewport: { x: 10, y: 20, zoom: 0.7 },
  })!;
  const reconciled = reconcileLocation(location, graph).location;
  assert.equal(reconciled.overviewDepth, 2);
  assert.equal(reconciled.viewport?.zoom, 0.7);
  assert.deepEqual(reconciled.positions, { 'folder:2:src/ui': { x: 100, y: 200 } });
  assert.deepEqual(reconciled.view.positions, { 'src/pages/main.ts': { x: 8, y: 4 } });
  assert.equal(readLocation({ ...location, overviewDepth: -1 }), undefined);
});

test('context Markdown retains import aliases, type-only bindings and source locations', async () => {
  const source = graph.nodes[0].id,
    target = graph.nodes[1].id;
  const fixture = {
    ...graph,
    edges: [
      {
        id: 'alias',
        source,
        target,
        sites: [
          {
            id: 'site',
            kind: 'import' as const,
            specifier: './card',
            line: 4,
            character: 0,
            symbols: [
              {
                id: 'binding',
                imported: 'Props',
                local: 'CardProps',
                form: 'named' as const,
                typeOnly: true,
                line: 4,
                character: 8,
              },
            ],
          },
        ],
      },
    ],
  };
  const bundle = await buildContext(fixture, [source], [], async () => 'source');
  assert.ok(contextMarkdown(bundle).includes('L5 import: type Props as CardProps'));
});
