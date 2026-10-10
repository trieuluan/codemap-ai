import { runTests } from '@vscode/test-electron';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const session = mkdtempSync(join(tmpdir(), 'codemap-live-model-'));
const report = join(session, 'report.json');
await runTests({
  version: '1.141.0',
  extensionDevelopmentPath: root,
  extensionTestsPath: resolve(root, 'out/test/live-ai.js'),
  extensionTestsEnv: {
    CODEMAP_LIVE_REPORT: report,
    ...(process.env.CODEMAP_TEST_MODEL_ID
      ? { CODEMAP_TEST_MODEL_ID: process.env.CODEMAP_TEST_MODEL_ID }
      : {}),
  },
  launchArgs: [
    '--new-window',
    '--skip-welcome',
    '--user-data-dir',
    join(session, 'profile'),
    '--extensions-dir',
    join(homedir(), '.vscode/extensions'),
  ],
});
console.log(readFileSync(report, 'utf8'));
console.log(`Report: ${report}`);
