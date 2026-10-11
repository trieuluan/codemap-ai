import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { contextSummary, reviewGroups } from '../shared/assistant-view';
import { EditConflict, parseEdits, prepareEdits } from '../shared/edits';
import type { ContextBundle } from '../shared/context';

function context(): ContextBundle {
  return {
    rootId: 'file:///root',
    revision: 1,
    builtAt: '',
    warnings: [],
    requested: 2,
    characters: 24,
    files: [
      {
        id: 'file:///root/a.ts',
        path: 'a.ts',
        language: 'typescript',
        content: 'const a = 1;\nconst b = 2;\n',
        truncated: false,
        declarations: [],
        imports: [],
        dependents: [],
        outside: [],
        notes: [],
      },
    ],
  };
}
function proposal(bundle: ContextBundle) {
  return parseEdits(
    JSON.stringify({
      summary: 'Two edits',
      changes: [
        {
          path: 'a.ts',
          start: { line: 1, character: 10 },
          end: { line: 1, character: 11 },
          oldText: '1',
          content: '3',
          reason: 'a',
        },
        {
          path: 'a.ts',
          start: { line: 2, character: 10 },
          end: { line: 2, character: 11 },
          oldText: '2',
          content: '4',
          reason: 'b',
        },
      ],
    }),
    bundle,
    'proposal',
  );
}

test('source summary separates missing files, excerpts, truncation and source-only estimates', () => {
  const bundle = context();
  bundle.files[0].truncated = true;
  bundle.files[0].excerpted = true;
  assert.deepEqual(contextSummary(bundle), {
    files: 1,
    omitted: 1,
    tokens: 6,
    truncated: 1,
    focused: 1,
  });
  bundle.estimatedTokens = 12;
  assert.equal(contextSummary(bundle).tokens, 12);
});

test('review groups retain original edit order and distinguish accepted from reviewed', () => {
  const changes = proposal(context()).changes;
  const other = { ...changes[0], id: 'other', fileId: 'file:///root/b.ts', path: 'b.ts' };
  const groups = reviewGroups(
    [changes[0], other, changes[1]],
    [changes[1].id, 'other'],
    [changes[0].id, 'other'],
  );
  assert.deepEqual(
    groups.map((g) => [g.path, g.accepted, g.reviewed, g.changes.map((c) => c.id)]),
    [
      ['a.ts', 1, 1, [changes[0].id, changes[1].id]],
      ['b.ts', 1, 1, ['other']],
    ],
  );
});

test('source conflict identifies the affected edit and aborts the entire preparation', () => {
  const bundle = context(),
    value = proposal(bundle);
  assert.throws(
    () =>
      prepareEdits(
        value,
        bundle,
        value.changes.map((c) => c.id),
        new Map([[bundle.files[0].id, 'const a = 9;\nconst b = 2;\n']]),
      ),
    (error) => {
      assert.ok(error instanceof EditConflict);
      assert.equal(error.fileId, bundle.files[0].id);
      assert.equal(error.changeId, value.changes[0].id);
      return true;
    },
  );
});
