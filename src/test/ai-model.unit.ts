import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { modelUnavailableReason } from '../shared/ai-model';

test('model eligibility excludes CLI session entries and invalid input budgets', () => {
  assert.match(modelUnavailableReason({ vendor: 'copilotcli', maxInputTokens: 0 })!, /Copilot CLI/);
  assert.match(
    modelUnavailableReason({ vendor: 'copilotcli', maxInputTokens: 128000 })!,
    /Copilot CLI/,
  );
  for (const maxInputTokens of [0, -1, NaN, Infinity]) {
    assert.match(modelUnavailableReason({ vendor: 'other', maxInputTokens })!, /input budget/);
  }
  assert.equal(modelUnavailableReason({ vendor: 'copilot', maxInputTokens: 128000 }), undefined);
  assert.equal(modelUnavailableReason({ vendor: 'local', maxInputTokens: 8192 }), undefined);
});
