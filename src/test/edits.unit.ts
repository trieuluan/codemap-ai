import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseEdits, prepareEdits, editContent, sourceOffset, rebaseEdit } from '../shared/edits';
import type { ContextBundle } from '../shared/context';
import {
  graphChanges,
  diagnosticChanges,
  verificationContext,
  type ObservedDiagnostic,
  type VerificationReport,
} from '../shared/verification';
import type { GraphSnapshot } from '../shared/model';
import { readAiMessage } from '../shared/ai';
const source = 'export const a = 1;\nexport const b = 2;\n';
const bundle: ContextBundle = {
  rootId: 'file:///root',
  revision: 1,
  builtAt: '',
  warnings: [],
  requested: 1,
  characters: source.length,
  files: [
    {
      id: 'file:///root/a.ts',
      path: 'a.ts',
      language: 'typescript',
      content: source,
      truncated: false,
      declarations: [],
      imports: [],
      dependents: [],
      outside: [],
      notes: [],
    },
  ],
};
const raw = (line = 1, oldText = '1', content = '42') => ({
  path: 'a.ts',
  start: { line, character: 17 },
  end: { line, character: 18 },
  oldText,
  content,
  reason: 'Change constant',
});
const parse = (changes: unknown[], context = bundle) =>
  parseEdits(JSON.stringify({ summary: 'Update values', changes }), context, 'p');
test('range positions count UTF-16 and CRLF, support EOF insertion, reject invalid positions', () => {
  assert.equal(sourceOffset('😀\r\nb\n', { line: 1, character: 2 }), 2);
  assert.equal(sourceOffset('😀\r\nb\n', { line: 2, character: 1 }), 5);
  assert.equal(sourceOffset('😀\r\nb\n', { line: 3, character: 0 }), 6);
  for (const pos of [
    { line: 0, character: 0 },
    { line: 1, character: -1 },
    { line: 1, character: 3 },
    { line: 4, character: 0 },
    { line: 1.5, character: 0 },
  ]) {
    assert.throws(() => sourceOffset('😀\r\nb\n', pos));
  }
  const insertion = parse([
    {
      path: 'a.ts',
      start: { line: 3, character: 0 },
      end: { line: 3, character: 0 },
      oldText: '',
      content: '// end\n',
      reason: 'Append comment',
    },
  ]);
  assert.equal(editContent(source, insertion.changes), source + '// end\n');
});
test('multiple small edits retain unrelated source and partial acceptance applies only selected ranges', () => {
  const proposal = parse([raw(), raw(2, '2', '3')]);
  assert.equal(
    editContent(source, proposal.changes),
    'export const a = 42;\nexport const b = 3;\n',
  );
  const edits = prepareEdits(
    proposal,
    bundle,
    [proposal.changes[1].id],
    new Map([[bundle.files[0].id, source]]),
  );
  assert.equal(editContent(source, edits), 'export const a = 1;\nexport const b = 3;\n');
  for (const ids of [[], ['unknown'], [proposal.changes[0].id, proposal.changes[0].id]]) {
    assert.throws(() =>
      prepareEdits(proposal, bundle, ids, new Map([[bundle.files[0].id, source]])),
    );
  }
});
test('parser rejects incorrect oldText, overlapping ranges, incomplete files and non-range replacements', () => {
  assert.throws(() => parse([raw(1, '9')]));
  assert.throws(() => parse([raw(), raw()]));
  assert.throws(() => parse([{ ...raw(), end: { line: 2, character: 18 } }, raw(2, '2')]));
  assert.throws(() => parse([{ path: 'a.ts', content: 'replacement' }]));
  assert.throws(() =>
    parse([raw()], { ...bundle, files: [{ ...bundle.files[0], excerpted: true }] }),
  );
  assert.equal(parse([raw(1, '1', '1')]).changes.length, 0);
});
test('rebasing preserves distant edits but blocks changed surrounding text and ambiguous repeats', () => {
  const edit = parse([raw()]).changes[0];
  const current = '// user header\n' + source + '// user footer';
  assert.equal(
    editContent(current, [rebaseEdit(edit, source, current)]),
    '// user header\nexport const a = 42;\nexport const b = 2;\n// user footer',
  );
  assert.throws(() => rebaseEdit(edit, source, source.replace('1', '9')));
  assert.throws(() => rebaseEdit(edit, source, source + source));
  const supporting = {
    ...bundle.files[0],
    id: 'file:///root/b.ts',
    path: 'b.ts',
    content: 'dependency',
  };
  assert.throws(() =>
    prepareEdits(
      parse([raw()]),
      { ...bundle, files: [bundle.files[0], supporting] },
      ['p:0'],
      new Map([
        [bundle.files[0].id, source],
        [supporting.id, 'changed'],
      ]),
    ),
  );
});
test('verification compares exact directed edges and diagnostics, including old and new dependents', () => {
  const before: GraphSnapshot = {
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
    edges: [{ id: 'ab', source: 'a', target: 'b', sites: [] }],
  };
  const after = {
    ...before,
    revision: 2,
    edges: [{ id: 'cb', source: 'c', target: 'b', sites: [] }],
  };
  const delta = graphChanges(before, after, ['b']);
  assert.deepEqual(delta.addedImports, [{ source: 'c.ts', target: 'b.ts' }]);
  assert.deepEqual(delta.removedImports, [{ source: 'a.ts', target: 'b.ts' }]);
  assert.deepEqual(delta.affectedFiles, ['a', 'c']);
  const error: ObservedDiagnostic = {
    fileId: 'b',
    path: 'b.ts',
    line: 1,
    character: 0,
    severity: 'error',
    message: 'Type mismatch',
  };
  assert.deepEqual(diagnosticChanges([error], [{ ...error, line: 2 }]), {
    addedDiagnostics: [{ ...error, line: 2 }],
    removedDiagnostics: [error],
  });
  const report: VerificationReport = {
    id: 'v',
    proposalId: 'p',
    rootId: 'root',
    revision: 2,
    observedAt: '',
    stale: false,
    changedFiles: [],
    diagnostics: [],
    addedDiagnostics: [],
    removedDiagnostics: [],
    ...delta,
  };
  assert.match(verificationContext(report), /BEGIN UNTRUSTED VERIFICATION/);
});
test('UI boundary validates partial edits, explicit verification sharing and test intent', () => {
  assert.equal(readAiMessage({ type: 'aiApply', proposalId: 'p', changeIds: [7] }), undefined);
  assert.equal(
    readAiMessage({ type: 'aiDiff', proposalId: 'p', fileId: 'f', changeId: 7 }),
    undefined,
  );
  assert.equal(readAiMessage({ type: 'aiRunTest', reportId: 'v', save: 'yes' }), undefined);
  assert.deepEqual(readAiMessage({ type: 'aiRunTest', reportId: 'v', save: false }), {
    type: 'aiRunTest',
    reportId: 'v',
    save: false,
  });
  assert.equal(
    readAiMessage({
      type: 'aiRequest',
      rootId: 'r',
      contextId: 'c',
      requestId: 'q',
      question: 'q',
      mode: 'ask',
      verificationId: 1,
    }),
    undefined,
  );
});
