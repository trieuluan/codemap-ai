import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { packageTestScripts } from '../shared/test-scripts';
import { reviewFileState } from '../shared/review-graph';
import type { VerificationReport } from '../shared/verification';
import type { AiProposal } from '../shared/ai';

test('monorepo test choices rank affected packages, inherit manager and keep root explicit', () => {
  const choices = packageTestScripts(
    [
      {
        directory: '',
        manifest: {
          packageManager: 'pnpm@10.0.0',
          scripts: { test: 'pnpm -r test', build: 'tsc' },
        },
      },
      {
        directory: 'packages/core',
        manifest: {
          scripts: { test: 'node --test', 'test:unit': 'node --test unit', testing: 'ignored' },
        },
      },
      {
        directory: 'packages/ui',
        manifest: { packageManager: 'yarn@4', scripts: { test: 'vitest' } },
      },
      { directory: 'bad', manifest: { scripts: { test: 42 } } },
    ],
    ['packages/core/src/a.ts'],
  );
  assert.deepEqual(
    choices.map((s) => [s.directory, s.name, s.manager]),
    [
      ['packages/core', 'test', 'pnpm'],
      ['packages/core', 'test:unit', 'pnpm'],
      ['', 'test', 'pnpm'],
      ['packages/ui', 'test', 'yarn'],
    ],
  );
  assert.match(choices[0].detail, /cwd: packages\/core/);
  assert.match(choices[2].label, /Workspace root/);
  assert.equal(packageTestScripts([{ directory: '', manifest: null }]).length, 0);
  assert.equal(
    packageTestScripts([
      { directory: '', manifest: { packageManager: 'unsupported@1', scripts: { test: 'x' } } },
    ]).length,
    0,
  );
});

test('Applied badge requires matching current observations; undo invalidates it', () => {
  const review = {
    proposal: { id: 'p', changes: [{ id: 'edit', fileId: 'a' }] } as AiProposal,
    accepted: ['edit'],
    reviewed: ['edit'],
    applied: ['edit'],
    state: 'applied',
  };
  const report = { proposalId: 'p', stale: false } as VerificationReport;
  assert.equal(reviewFileState(review, 'a', report), 'Applied');
  assert.equal(reviewFileState(review, 'a', { ...report, stale: true }), 'Applied earlier');
  assert.equal(reviewFileState(review, 'a', { ...report, proposalId: 'other' }), 'Applied earlier');
  assert.equal(reviewFileState(review, 'a'), 'Applied earlier');
});
