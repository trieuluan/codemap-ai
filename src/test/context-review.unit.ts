import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { contextReviewKey } from '../shared/context-review';
import {
  appliedSourceState,
  verificationFailureScope,
  type VerificationReport,
} from '../shared/verification';
import { readAiMessage } from '../shared/ai';

test('context approval is invalidated by source, symbol, question, revision or edit permission changes', () => {
  const key = contextReviewKey('root', 1, ['b', 'a'], 'symbol', 'fix', ['a']);
  assert.equal(key, contextReviewKey('root', 1, ['a', 'b'], 'symbol', ' fix ', ['a']));
  for (const changed of [
    contextReviewKey('other', 1, ['a', 'b'], 'symbol', 'fix', ['a']),
    contextReviewKey('root', 2, ['a', 'b'], 'symbol', 'fix', ['a']),
    contextReviewKey('root', 1, ['a'], 'symbol', 'fix', ['a']),
    contextReviewKey('root', 1, ['a', 'b'], 'other', 'fix', ['a']),
    contextReviewKey('root', 1, ['a', 'b'], 'symbol', 'explain', ['a']),
    contextReviewKey('root', 1, ['a', 'b'], 'symbol', 'fix', ['a', 'b']),
  ]) {
    assert.notEqual(key, changed);
  }
});
test('applied source comparison distinguishes original, applied, manual edits and missing source', () => {
  assert.equal(appliedSourceState('before', 'after', 'after'), 'applied');
  assert.equal(appliedSourceState('before', 'after', 'before'), 'reverted');
  assert.equal(appliedSourceState('before', 'after', 'manual'), 'modified');
  assert.equal(appliedSourceState('before', 'after'), 'unavailable');
});
test('old failed tests do not mark the current file as failed', () => {
  const report = {
    id: 'r',
    rootId: 'root',
    proposalId: 'p',
    revision: 1,
    observedAt: '',
    affectedFiles: [],
    addedDiagnostics: [],
    removedDiagnostics: [],
    addedImports: [],
    removedImports: [],
    stale: false,
    changedFiles: [{ id: 'a', path: 'a.ts' }],
    diagnostics: [],
    test: {
      name: 'test',
      state: 'failed',
      stale: true,
      output: '',
      truncated: false,
      startedAt: '',
      saved: false,
    },
  } as VerificationReport;
  assert.equal(verificationFailureScope(report).testScope.size, 0);
  report.test!.stale = false;
  assert.ok(verificationFailureScope(report).testScope.has('a'));
});
test('recheck protocol rejects missing and oversized report IDs', () => {
  assert.ok(readAiMessage({ type: 'aiRecheckVerification', reportId: 'r' }));
  assert.equal(readAiMessage({ type: 'aiRecheckVerification' }), undefined);
  assert.equal(
    readAiMessage({ type: 'aiRecheckVerification', reportId: 'x'.repeat(201) }),
    undefined,
  );
});
