import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  aiPrompt,
  aiReferences,
  assertContextUnchanged,
  parseProposal,
  readAiMessage,
} from '../shared/ai';
import { graphToolData } from '../shared/ai-tools';
import type { ContextBundle } from '../shared/context';
import type { GraphSnapshot } from '../shared/model';

const bundle: ContextBundle = {
  rootId: 'root',
  revision: 1,
  builtAt: '',
  warnings: [],
  requested: 1,
  characters: 12,
  files: [
    {
      id: 'file:///a.ts',
      path: 'src/a.ts',
      language: 'typescript',
      content: 'const a = 1;\nexport { a };',
      truncated: false,
      declarations: [],
      imports: [],
      dependents: [],
      outside: [],
      notes: [],
    },
  ],
};
const proposal = (changes: unknown[]) => JSON.stringify({ summary: 'Change value', changes });
test('AI prompt delimits untrusted source and requests small range edits for proposals', () => {
  assert.ok(aiPrompt(bundle, 'Giải thích', 'ask').includes('[[relative/path.ts:L12]]'));
  assert.ok(aiPrompt(bundle, 'Change', 'propose').includes('Never create/delete/rename'));
  assert.ok(aiPrompt(bundle, 'Change', 'propose').includes('BEGIN UNTRUSTED CONTEXT'));
  assert.ok(aiPrompt(bundle, 'Change', 'propose').includes('1|const a = 1;'));
  assert.ok(!aiPrompt(bundle, 'Explain', 'ask').includes('1|const a = 1;'));
});
test('proposal parser rejects unknown paths, duplicates, partial files and malformed output', () => {
  const change = {
    path: 'src/a.ts',
    start: { line: 1, character: 10 },
    end: { line: 1, character: 11 },
    oldText: '1',
    content: '2',
    reason: 'Update value',
  };
  assert.equal(parseProposal(proposal([change]), bundle, 'p').changes[0].fileId, 'file:///a.ts');
  assert.throws(() => parseProposal(proposal([{ ...change, path: '../secret.ts' }]), bundle, 'p'));
  assert.throws(() => parseProposal(proposal([change, change]), bundle, 'p'));
  assert.throws(() =>
    parseProposal(
      proposal([change]),
      { ...bundle, files: [{ ...bundle.files[0], truncated: true }] },
      'p',
    ),
  );
  assert.throws(() => parseProposal('not json', bundle, 'p'));
  assert.throws(() => parseProposal(proposal([{ path: 'src/a.ts', content: 1 }]), bundle, 'p'));
  assert.throws(() => parseProposal(proposal(Array(11).fill(change)), bundle, 'p'));
  assert.deepEqual(parseProposal(proposal([{ ...change, content: '1' }]), bundle, 'p').changes, []);
});
test('citations accept only reviewed file paths and valid one-based source lines', () => {
  assert.deepEqual(
    aiReferences(
      '[[src/a.ts:L2]] [[src/a.ts:L2]] [[src/a.ts:L99]] [[secret:L1]] [[src/a.ts:L0]]',
      bundle,
    ),
    [{ fileId: 'file:///a.ts', path: 'src/a.ts', line: 2 }],
  );
});
test('range citations validate both bounds and deduplicate without losing single-line references', () => {
  assert.deepEqual(
    aiReferences(
      '[[src/a.ts:L1-L2]] [[src/a.ts:L1-2]] [[src/a.ts:L1]] ' +
        '[[src/a.ts:L2-L1]] [[src/a.ts:L1-L99]] [[src/a.ts:L0-L2]] ' +
        '[[missing.ts:L1-L2]] [[src/a.ts:L1-L9007199254740992]]',
      bundle,
    ),
    [
      { fileId: 'file:///a.ts', path: 'src/a.ts', line: 1, endLine: 2 },
      { fileId: 'file:///a.ts', path: 'src/a.ts', line: 1 },
    ],
  );
  const excerpted = {
    ...bundle,
    files: [
      {
        ...bundle.files[0],
        excerpts: [
          { startLine: 2, endLine: 3, content: 'visible\nvisible' },
          { startLine: 5, endLine: 6, content: 'visible\nvisible' },
        ],
      },
    ],
  };
  assert.deepEqual(
    aiReferences('[[src/a.ts:L2-L3]] [[src/a.ts:L3-L5]] [[src/a.ts:L1-L3]]', excerpted),
    [{ fileId: 'file:///a.ts', path: 'src/a.ts', line: 2, endLine: 3 }],
  );
});
test('apply guard rejects any changed or missing context, including unmodified dependency files', () => {
  assert.doesNotThrow(() =>
    assertContextUnchanged(bundle, new Map([['file:///a.ts', bundle.files[0].content]])),
  );
  assert.throws(() => assertContextUnchanged(bundle, new Map()));
  assert.throws(() =>
    assertContextUnchanged(bundle, new Map([['file:///a.ts', 'new unsaved edit']])),
  );
});
test('webview AI boundary rejects malformed request, arbitrary commands and invalid source positions', () => {
  assert.equal(
    readAiMessage({
      type: 'aiRequest',
      rootId: 'root',
      contextId: 'c',
      requestId: 'r',
      question: 'q',
      mode: 'execute',
    }),
    undefined,
  );
  assert.equal(readAiMessage({ type: 'aiApply', proposalId: 3 }), undefined);
  assert.equal(
    readAiMessage({ type: 'aiOpenReference', requestId: 'r', fileId: 'f', line: -1 }),
    undefined,
  );
  assert.equal(readAiMessage({ type: 'executeCommand', command: 'x' }), undefined);
  assert.deepEqual(readAiMessage({ type: 'aiCancel' }), { type: 'aiCancel' });
});
test('agent tools use the full graph and preserve import direction and impact routes', () => {
  const graph: GraphSnapshot = {
    root: { id: 'root', name: 'test' },
    revision: 1,
    scannedAt: '',
    warnings: [],
    nodes: ['a', 'b', 'c'].map((id) => ({
      id,
      name: id,
      path: id + '.ts',
      language: 'typescript',
      outside: [],
    })),
    edges: [
      { id: 'ab', source: 'a', target: 'b', sites: [] },
      { id: 'bc', source: 'b', target: 'c', sites: [] },
    ],
  };
  const dependencies = graphToolData('codemap_get_dependencies', graph, { path: 'b.ts' });
  assert.ok('dependencies' in dependencies);
  assert.equal(dependencies.dependencies![0].path, 'c.ts');
  assert.equal(dependencies.dependents![0].path, 'a.ts');
  const impact = graphToolData('codemap_get_impact', graph, { path: 'c.ts' });
  assert.ok('affected' in impact);
  assert.deepEqual(
    impact.affected!.map((entry) => entry.route),
    [
      ['b.ts', 'c.ts'],
      ['a.ts', 'b.ts', 'c.ts'],
    ],
  );
  assert.throws(() => graphToolData('codemap_get_dependencies', graph, { path: '/etc/passwd' }));
});
