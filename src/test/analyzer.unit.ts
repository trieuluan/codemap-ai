import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyze, ScanCancelled, AnalyzerCache, type SourceInput, type AnalysisStats } from '../analyzer/analyzer';

async function fixture(contents: Record<string, string>, run: (root: string, files: SourceInput[]) => Promise<void>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codemap-'));
  try {
    for (const [name, text] of Object.entries(contents)) {
      const file = path.join(root, name);
      fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text);
    }
    const files = Object.entries(contents).filter(([name]) => /\.[cm]?[jt]sx?$/.test(name) && !/\.d\.[cm]?ts$/.test(name) && !name.includes('node_modules/'))
      .map(([name, text]) => ({ fileName: path.join(root, name), id: pathToFileURL(path.join(root, name)).toString(), text }));
    await run(root, files);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
const options = (root: string, files: SourceInput[]) => ({ rootPath: root, rootId: pathToFileURL(root).toString(), rootName: 'fixture', files });

test('merges import kinds, retains source locations, isolated nodes and cycles', async () => {
  await fixture({ 'a.ts': `import { b } from './b';\nimport type { B } from './b';\nexport { b } from './b';\nconst loaded = import('./b');\nconst required = require('./b');\nimport alias = require('./b');`,
    'b.ts': `import './a'; export const b = 1; export type B = number;`, 'isolated.ts': 'export {};' }, async (root, files) => {
    const graph = await analyze(options(root, files));
    assert.equal(graph.nodes.length, 3); assert.equal(graph.edges.length, 2);
    const edge = graph.edges.find(edge => edge.source.endsWith('/a.ts'))!;
    assert.equal(edge.sites.length, 6);
    assert.equal(new Set(edge.sites.map(site => site.id)).size, 6);
    assert.deepEqual(edge.sites.map(site => site.line), [0, 1, 2, 3, 4, 5]);
    assert.deepEqual(edge.sites.map(site => site.kind), ['import', 'type-import', 're-export', 'dynamic-import', 'require', 'require']);
    assert.equal(graph.warnings.length, 0);
  });
});
test('resolves inherited paths and nearest config, JS/TSX, extension substitution', async () => {
  await fixture({ 'base.json': JSON.stringify({ compilerOptions: { paths: { '@lib/*': ['./lib/*'] }, moduleResolution: 'bundler', module: 'esnext' } }),
    'tsconfig.json': '{"extends":"./base.json"}', 'lib/value.ts': 'export const value=1;',
    'view.tsx': `import {value} from '@lib/value'; export const View = () => <div>{value}</div>;`,
    'main.js': `import './view'; import './lib/value.js';`,
    'nested/jsconfig.json': '{"compilerOptions":{"paths":{"@local":["./local.js"]}}}',
    'nested/entry.jsx': `import '@local';`, 'nested/local.js': 'export {};' }, async (root, files) => {
    const graph = await analyze(options(root, files));
    assert.equal(graph.edges.length, 4);
    assert.equal(graph.nodes.flatMap(node => node.outside).length, 0);
    assert.equal(graph.warnings.length, 0);
  });
});
test('distinguishes external, unresolved and excluded imports, warns on computed imports', async () => {
  await fixture({ 'a.ts': `import 'node:fs'; import 'fs'; import 'pkg'; import '@bundler/missing'; import './types'; import './missing'; const value = import(name);`,
    'types.d.ts': 'export {};', 'node_modules/pkg/package.json': '{"name":"pkg","types":"index.d.ts"}',
    'node_modules/pkg/index.d.ts': 'export {};' }, async (root, files) => {
    const graph = await analyze(options(root, files));
    assert.deepEqual(graph.nodes[0].outside.map(item => item.status), ['external', 'external', 'external', 'unresolved', 'excluded', 'unresolved']);
    assert.equal(graph.edges.length, 0);
    assert.match(graph.warnings[0].message, /non-literal dynamic-import/);
  });
});
test('uses unsaved source and config overlays', async () => {
  await fixture({ 'tsconfig.json': '{}', 'a.ts': '', 'b.ts': 'export {};' }, async (root, files) => {
    files[0].text = `import '@alias';`;
    const overlays = new Map([[path.join(root, 'tsconfig.json'), '{"compilerOptions":{"paths":{"@alias":["./b.ts"]}}}']]);
    const graph = await analyze({ ...options(root, files), overlays });
    assert.equal(graph.edges.length, 1);
  });
});
test('bad config and syntax produce warnings without discarding readable nodes', async () => {
  await fixture({ 'tsconfig.json': '{"compilerOptions":{"moduleResolution":"invalid"}}',
    'a.ts': `import './b'; const = ;`, 'b.ts': 'export {};' }, async (root, files) => {
    const graph = await analyze(options(root, files));
    assert.equal(graph.nodes.length, 2); assert.equal(graph.edges.length, 1);
    assert.ok(graph.warnings.length >= 2);
  });
});
test('supports ESM and CommonJS extensions', async () => {
  await fixture({ 'a.mts': `import './b.mjs';`, 'b.mts': 'export {};', 'c.cts': `import d = require('./d.cjs');`, 'd.cts': 'export = 1;' }, async (root, files) => {
    const graph = await analyze(options(root, files)); assert.equal(graph.edges.length, 2);
  });
});
test('cancellation aborts without publishing a partial graph', async () => {
  await assert.rejects(analyze({ ...options('/tmp', [{ id: 'a', fileName: '/tmp/a.ts', text: '' }]), cancelled: () => true }), ScanCancelled);
});
test('a 200-file graph retains all dependency chains', async () => {
  const contents = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`file${index}.ts`, index ? `import './file${index - 1}';` : 'export {};']));
  await fixture(contents, async (root, files) => {
    const graph = await analyze(options(root, files)); assert.equal(graph.nodes.length, 200); assert.equal(graph.edges.length, 199);
  });
});
test('resolves files outside the selected root without adding their nodes', async () => {
  await fixture({ 'src/a.ts': `import '../outside';`, 'outside.ts': 'export {};' }, async (root, files) => {
    const selectedRoot = path.join(root, 'src');
    const graph = await analyze(options(selectedRoot, files.filter(file => file.fileName.startsWith(selectedRoot + path.sep))));
    assert.equal(graph.nodes.length, 1);
    assert.equal(graph.edges.length, 0);
    assert.equal(graph.nodes[0].outside[0].status, 'external');
  });
});
test('honors NodeNext conditional exports for CJS static imports and ESM dynamic imports', async () => {
  await fixture({ 'tsconfig.json': '{"compilerOptions":{"module":"nodenext","moduleResolution":"nodenext"}}',
    'entry.cts': `import 'dual'; const dynamic = import('dual');`,
    'node_modules/dual/package.json': '{"name":"dual","exports":{"import":"./esm.d.mts","require":"./cjs.d.cts"}}',
    'node_modules/dual/esm.d.mts': 'export {};', 'node_modules/dual/cjs.d.cts': 'export {};' }, async (root, files) => {
    const graph = await analyze(options(root, files));
    assert.equal(graph.nodes[0].outside[0].resolvedPath, fs.realpathSync(path.join(root, 'node_modules/dual/cjs.d.cts')));
    assert.equal(graph.nodes[0].outside[1].resolvedPath, fs.realpathSync(path.join(root, 'node_modules/dual/esm.d.mts')));
  });
});
test('React fixture verifies alias/barrel edges and exact source locations without CSS nodes', async () => {
  await fixture({ 'tsconfig.json': '{"compilerOptions":{"paths":{"@ui/*":["./src/ui/*"]}}}',
    'src/App.tsx': `import {Button} from '@ui/index';\nimport './styles.css';\nexport const App=()=> <Button/>;`,
    'src/ui/index.ts': `export {Button} from './Button';`, 'src/ui/Button.tsx': 'export const Button=()=> <button/>;',
    'src/styles.css': 'button {}', 'src/App.test.tsx': `import {App} from './App';` }, async (root, files) => {
    const graph = await analyze(options(root, files));
    const byId = new Map(graph.nodes.map(node => [node.id, node.path]));
    assert.deepEqual(graph.nodes.map(node => node.path).sort(), ['src/App.test.tsx', 'src/App.tsx', 'src/ui/Button.tsx', 'src/ui/index.ts']);
    assert.deepEqual(graph.edges.map(edge => [byId.get(edge.source), byId.get(edge.target), edge.sites[0].kind, edge.sites[0].line, edge.sites[0].character]).sort(), [
      ['src/App.test.tsx', 'src/App.tsx', 'import', 0, 18],
      ['src/App.tsx', 'src/ui/index.ts', 'import', 0, 21],
      ['src/ui/index.ts', 'src/ui/Button.tsx', 're-export', 0, 21],
    ].sort());
    assert.equal(graph.nodes.find(node => node.path === 'src/App.tsx')!.outside[0].site.specifier, './styles.css');
  });
});
test('monorepo fixture resolves inherited cross-package paths and symlinked packages to original URIs', async () => {
  await fixture({ 'base.json': '{"compilerOptions":{"paths":{"@core":["./packages/core/index.ts"]}}}',
    'tsconfig.json': '{"extends":"./base.json"}',
    'packages/core/package.json': '{"name":"@workspace/core","types":"index.ts"}',
    'packages/core/index.ts': 'export const core=1;',
    'packages/app/tsconfig.json': '{"extends":"../../tsconfig.json"}',
    'packages/app/index.ts': `import '@core';\nimport '@workspace/core';` }, async (root, files) => {
    fs.mkdirSync(path.join(root, 'node_modules/@workspace'), { recursive: true });
    fs.symlinkSync(path.join(root, 'packages/core'), path.join(root, 'node_modules/@workspace/core'), 'dir');
    const graph = await analyze(options(root, files));
    assert.deepEqual(graph.edges.map(edge => [edge.source, edge.target, edge.sites.map(site => [site.kind, site.line, site.character])]), [[
      pathToFileURL(path.join(root, 'packages/app/index.ts')).toString(),
      pathToFileURL(path.join(root, 'packages/core/index.ts')).toString(), [['import', 0, 7], ['import', 1, 7]],
    ]]);
    assert.equal(graph.nodes.flatMap(node => node.outside).length, 0);
  });
});
test('incremental edits, structural changes and config invalidation match fresh full scans', async () => {
  await fixture({ 'tsconfig.json': '{"compilerOptions":{"paths":{"@target":["./b.ts"]}}}',
    'a.ts': `import './missing'; const dynamic=import(name);`, 'b.ts': 'export {};' }, async (root, initial) => {
    const cache = new AnalyzerCache(); let files = initial; let stats!: AnalysisStats;
    const run = (invalidateConfig = false) => analyze({ ...options(root, files), cache, invalidateConfig, stats: value => { stats = value; } });
    const comparable = (graph: Awaited<ReturnType<typeof analyze>>) => ({ nodes: graph.nodes, edges: graph.edges, warnings: graph.warnings });
    const compare = async (invalidate = false) => {
      const incremental = await run(invalidate);
      assert.deepEqual(comparable(incremental), comparable(await analyze(options(root, files))));
      return incremental;
    };
    await compare(); assert.equal(stats.parsed, 2);
    await compare(); assert.equal(stats.parsed, 0); assert.equal(stats.resolved, 0);
    files = files.map(file => file.fileName.endsWith('/a.ts') ? { ...file, text: `import './late'; import '@target';` } : file);
    assert.equal((await compare()).warnings.length, 0); assert.equal(stats.parsed, 1); assert.equal(stats.resolved, 1);
    const late = path.join(root, 'late.ts'); fs.writeFileSync(late, 'export {};');
    files = [...files, { id: pathToFileURL(late).toString(), fileName: late, text: 'export {};' }];
    assert.equal((await compare()).edges.length, 2); assert.equal(stats.parsed, 1); assert.equal(stats.resolved, 3);
    fs.unlinkSync(path.join(root, 'b.ts')); files = files.filter(file => !file.fileName.endsWith('/b.ts'));
    assert.equal((await compare()).edges.length, 1); assert.equal(stats.parsed, 0);
    const renamed = path.join(root, 'renamed.ts'); fs.renameSync(late, renamed);
    files = files.map(file => file.fileName === late ? { ...file, fileName: renamed, id: pathToFileURL(renamed).toString() } : file);
    await compare();
    fs.writeFileSync(path.join(root, 'tsconfig.json'), '{"compilerOptions":{"paths":{"@target":["./renamed.ts"]}}}');
    assert.equal((await compare(true)).edges.length, 1); assert.equal(stats.parsed, 2);
    const entries = cache.entries;
    await assert.rejects(analyze({ ...options(root, files), cache, cancelled: () => true }), ScanCancelled);
    assert.equal(cache.entries, entries);
  });
});
test('config and file warnings remain deduplicated across repeated incremental scans', async () => {
  await fixture({ 'tsconfig.json': '{"compilerOptions":{"module":"invalid"}}', 'a.ts': `import(name);`, 'b.ts': '' }, async (root, files) => {
    const cache = new AnalyzerCache();
    const first = await analyze({ ...options(root, files), cache });
    for (let i = 0; i < 4; i++) {
      files[1] = { ...files[1], text: String(i) };
      const graph = await analyze({ ...options(root, files), cache });
      assert.deepEqual(graph.warnings, first.warnings);
    }
    assert.equal(cache.configWarnings.length, 1);
  });
});
