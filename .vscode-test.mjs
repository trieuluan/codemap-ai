import { defineConfig } from '@vscode/test-cli';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const workspace = mkdtempSync(join(tmpdir(), 'codemap-vscode-test-'));
writeFileSync(join(workspace, 'a.ts'), 'import "./b";\nexport const a = 1;\n');
writeFileSync(join(workspace, 'b.ts'), 'export const b = 2;\n');
mkdirSync(join(workspace, 'dist'));
writeFileSync(join(workspace, 'dist', 'ignored.ts'), 'export {};');
writeFileSync(join(workspace, 'types.d.ts'), 'export {};');
mkdirSync(join(workspace, '.vscode'));
writeFileSync(join(workspace, 'hidden.ts'), 'export {};');
writeFileSync(join(workspace, 'hidden.js'), 'export {};');
writeFileSync(
  join(workspace, '.vscode', 'settings.json'),
  JSON.stringify({
    'files.exclude': { '**/hidden.ts': true, '**/*.js': { when: '$(basename).ts' } },
  }),
);
process.on('exit', () => rmSync(workspace, { recursive: true, force: true }));
export default defineConfig([
  {
    label: 'workspace',
    files: 'out/test/extension.test.js',
    launchArgs: [workspace, '--disable-extensions', '--skip-welcome'],
  },
  {
    label: 'empty',
    files: 'out/test/empty.test.js',
    launchArgs: ['--new-window', '--disable-extensions', '--skip-welcome'],
  },
]);
