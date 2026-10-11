import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { suggestContext } from '../shared/context-suggestions';
import { verificationFailureScope, type VerificationReport } from '../shared/verification';
import { readAiMessage } from '../shared/ai';
import type { GraphSnapshot } from '../shared/model';
const graph: GraphSnapshot = {
  root: { id: 'root', name: 'test' },
  revision: 1,
  scannedAt: '',
  warnings: [],
  nodes: [
    'src/Dashboard.tsx',
    'src/components/index.ts',
    'src/components/Card.tsx',
    'test/Dashboard.test.tsx',
    'src/other.ts',
    'src/useSave.ts',
  ].map((path) => ({
    id: path,
    path,
    name: path.split('/').at(-1)!,
    language: 'typescript',
    outside: [],
    declarations: path.includes('useSave')
      ? [{ id: 'save', kind: 'function' as const, name: 'useSave', line: 0, character: 0 }]
      : [],
  })),
  edges: [
    {
      id: 'edge',
      source: 'src/Dashboard.tsx',
      target: 'src/components/index.ts',
      sites: [
        {
          id: 'site',
          kind: 'import',
          line: 0,
          character: 0,
          specifier: './components',
          symbols: [
            {
              id: 's',
              imported: 'Card',
              local: 'Card',
              form: 'named',
              typeOnly: false,
              line: 0,
              character: 0,
              declaration: { nodeId: 'src/components/Card.tsx', symbolId: 'card' },
            },
          ],
        },
      ],
    },
  ],
};
test('context candidates explain imports, barrel declarations, tests and named request symbols without changing source scope', () => {
  const included = ['src/Dashboard.tsx'];
  const result = suggestContext(graph, included, 'Fix Dashboard with useSave');
  assert.deepEqual(
    new Set(result.map((s) => s.fileId)),
    new Set([
      'src/components/index.ts',
      'src/components/Card.tsx',
      'test/Dashboard.test.tsx',
      'src/useSave.ts',
    ]),
  );
  assert.ok(
    result
      .find((s) => s.fileId.endsWith('Card.tsx'))
      ?.reasons.some((r) => r.includes('Declaration')),
  );
  assert.deepEqual(included, ['src/Dashboard.tsx']);
  assert.ok(!result.some((s) => s.fileId.endsWith('other.ts')));
  assert.equal(suggestContext(graph, included, '', 2).length, 2);
  assert.ok(
    !suggestContext(graph, [...included, 'src/components/Card.tsx'], '').some((s) =>
      s.fileId.endsWith('Card.tsx'),
    ),
  );
});
test('test failures label an edit scope rather than unrelated files; stale reports have no active failure scope', () => {
  const report = {
    stale: false,
    changedFiles: [{ id: 'changed', path: 'changed.ts' }],
    diagnostics: [
      { fileId: 'error', severity: 'error' },
      { fileId: 'warning', severity: 'warning' },
    ],
    test: { state: 'failed' },
  } as VerificationReport;
  assert.deepEqual([...verificationFailureScope(report).testScope], ['changed']);
  assert.deepEqual([...verificationFailureScope(report).diagnostics], ['error']);
  assert.equal(verificationFailureScope({ ...report, stale: true }).testScope.size, 0);
  assert.equal(verificationFailureScope(undefined).diagnostics.size, 0);
});
test('diagnostic navigation accepts only bounded report indices, never arbitrary paths', () => {
  assert.ok(readAiMessage({ type: 'aiOpenDiagnostic', reportId: 'r', index: 0 }));
  for (const index of [-1, 100, 1.2, '0', NaN]) {
    assert.equal(readAiMessage({ type: 'aiOpenDiagnostic', reportId: 'r', index }), undefined);
  }
  assert.equal(readAiMessage({ type: 'aiOpenDiagnostic', path: '/other.ts', line: 1 }), undefined);
});
