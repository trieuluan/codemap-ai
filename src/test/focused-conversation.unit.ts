import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { focusedSource } from '../ai/focused-context';
import { buildContext, contextMarkdown, contextRegionKey } from '../shared/context';
import { aiReferences, parseProposal } from '../shared/ai';
import { ConversationStore } from '../shared/conversation';
import { linkCitations } from '../shared/markdown';
import type { GraphSnapshot } from '../shared/model';
const text =
  'import { helper } from "./helper";\n\nexport function first() { return 1; }\n\nexport function selected() {\n  return helper();\n}\n\nexport const unrelated = "omit";\n';
const graph: GraphSnapshot = {
  root: { id: 'root', name: 'test' },
  revision: 1,
  scannedAt: '',
  warnings: [],
  nodes: [
    {
      id: 'a',
      name: 'a.ts',
      path: 'a.ts',
      language: 'typescript',
      outside: [],
      declarations: [
        { id: 'selected', name: 'selected', kind: 'function', line: 4, character: 16 },
        { id: 'first', name: 'first', kind: 'function', line: 2, character: 16 },
      ],
    },
  ],
  edges: [],
};
test('focused context prioritizes the selected AST declaration/imports and retains original source lines', async () => {
  const bundle = await buildContext(
    graph,
    ['a'],
    [],
    async () => text,
    focusedSource(graph, ['a'], { mode: 'focused', symbol: { nodeId: 'a', symbolId: 'selected' } }),
  );
  const file = bundle.files[0];
  assert.ok(file.content.includes('helper'));
  assert.ok(file.content.includes('function selected'));
  assert.ok(!file.content.includes('unrelated'));
  assert.ok(!file.content.includes('function first'));
  assert.equal(file.sourceDigest?.length, 64);
  assert.ok(file.excerpts?.some((e) => e.startLine <= 5 && e.endLine >= 7));
  assert.equal(aiReferences('[[a.ts:L6]] [[a.ts:L9]]', bundle).length, 1);
  assert.ok(contextMarkdown(bundle).includes('omitted source is unknown'));
  assert.throws(() =>
    parseProposal(
      '{"summary":"x","changes":[{"path":"a.ts","content":"replacement"}]}',
      bundle,
      'p',
    ),
  );
});
test('focused context follows imported declaration names only inside explicitly included files', async () => {
  const target = {
    ...graph.nodes[0],
    id: 'helper',
    path: 'helper.ts',
    declarations: [
      { id: 'h', name: 'helper', kind: 'function' as const, line: 0, character: 16 },
      { id: 'u', name: 'unrelated', kind: 'function' as const, line: 1, character: 16 },
    ],
  };
  const input = {
    ...graph,
    nodes: [...graph.nodes, target],
    edges: [
      {
        id: 'edge',
        source: 'a',
        target: 'helper',
        sites: [
          {
            id: 'site',
            specifier: './helper',
            kind: 'import' as const,
            line: 0,
            character: 0,
            symbols: [
              {
                id: 'binding',
                imported: 'helper',
                local: 'helper',
                form: 'named' as const,
                typeOnly: false,
                line: 0,
                character: 9,
                declaration: { nodeId: 'helper', symbolId: 'h' },
              },
            ],
          },
        ],
      },
    ],
  };
  const source =
    'export function helper() { return 1; }\nexport function unrelated() { return 2; }';
  const bundle = await buildContext(
    input,
    ['a', 'helper'],
    [],
    async (id) => (id === 'a' ? text : source),
    focusedSource(input, ['a', 'helper'], { mode: 'focused' }),
  );
  assert.ok(bundle.files.find((f) => f.id === 'helper')!.content.includes('function helper'));
  assert.ok(!bundle.files.find((f) => f.id === 'helper')!.content.includes('unrelated'));
  const limited = await buildContext(
    input,
    ['a'],
    [],
    async () => text,
    focusedSource(input, ['a'], { mode: 'focused' }),
  );
  assert.deepEqual(
    limited.files.map((f) => f.id),
    ['a'],
  );
});
test('conversation keys survive revision, symbol offsets and selection order; memory is bounded and isolated', () => {
  assert.equal(contextRegionKey('root', ['b', 'a', 'a']), contextRegionKey('root', ['a', 'b']));
  assert.notEqual(contextRegionKey('other', ['a']), contextRegionKey('root', ['a']));
  const store = new ConversationStore();
  for (let i = 0; i < 12; i++) {
    store.add('region', {
      id: String(i),
      question: 'q',
      answer: 'a',
      revision: i,
      model: 'test',
      createdAt: '',
      references: [],
    });
  }
  assert.equal(store.get('region').length, 8);
  assert.equal(store.get('region')[0].id, '4');
  for (let i = 0; i < 9; i++) {
    store.add('other' + i, {
      id: 'other' + i,
      question: 'q',
      answer: 'a',
      revision: 1,
      model: '',
      createdAt: '',
      references: [],
    });
  }
  assert.deepEqual(store.get('region'), []);
  store.clear('other8');
  assert.deepEqual(store.get('other8'), []);
});
test('inline citations transform validated plain text only, never fenced/inline code or guessed paths', () => {
  const root = {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        children: [{ type: 'text', value: 'See [[a.ts:L6]] and [[missing.ts:L1]].' }],
      },
      { type: 'code', value: '[[a.ts:L6]]' },
      { type: 'inlineCode', value: '[[a.ts:L6]]' },
    ],
  };
  linkCitations(root, [{ fileId: 'a', path: 'a.ts', line: 6 }]);
  const serialized = JSON.stringify(root);
  assert.equal(serialized.match(/#codemap-citation-0/g)?.length, 1);
  assert.ok(serialized.includes('missing.ts:L1'));
  assert.equal(root.children[1].value, '[[a.ts:L6]]');
});
