import { createRequire } from 'node:module';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
const require = createRequire(import.meta.url);
const { analyze, AnalyzerCache } = require('../out/analyzer/analyzer.js');
const { projectGraph, defaultView } = require('../out/shared/view.js');
const dagre = require('@dagrejs/dagre');
const ignored = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.vscode-test',
  '.pnpm-store',
]);
function collect(root) {
  const started = performance.now();
  const files = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fileName = path.join(directory, entry.name);
      if (entry.isDirectory() && !ignored.has(entry.name)) {
        visit(fileName);
      } else if (
        entry.isFile() &&
        /\.[cm]?[jt]sx?$/.test(entry.name) &&
        !/\.d\.[cm]?ts$/.test(entry.name)
      ) {
        files.push({
          id: pathToFileURL(fileName).toString(),
          fileName,
          text: readFileSync(fileName, 'utf8'),
        });
      }
    }
  }
  visit(root);
  files.sort((a, b) => a.fileName.localeCompare(b.fileName));
  return { files, milliseconds: performance.now() - started };
}
function layout(graph) {
  const started = performance.now();
  const model = new dagre.graphlib.Graph();
  model.setGraph({ rankdir: 'LR', nodesep: 28, ranksep: 90 });
  model.setDefaultEdgeLabel(() => ({}));
  graph.nodes.forEach((node) =>
    model.setNode(node.id, { width: 300, height: node.kind === 'folder' ? 240 : 70 }),
  );
  graph.edges.forEach((edge) => model.setEdge(edge.source, edge.target));
  dagre.layout(model);
  return performance.now() - started;
}
async function measure(label, root) {
  const { files, milliseconds: collectMs } = collect(root);
  const cache = new AnalyzerCache();
  let stats;
  const opts = {
    rootPath: root,
    rootId: pathToFileURL(root).toString(),
    rootName: label,
    files,
    cache,
    stats: (value) => {
      stats = value;
    },
  };
  const graph = await analyze(opts);
  const cold = { ...stats };
  await analyze(opts);
  const warm = { ...stats };
  const edited = files.map((file, i) =>
    i === 0 ? { ...file, text: file.text + '\n// benchmark edit\n' } : file,
  );
  await analyze({ ...opts, files: edited });
  const edit = { ...stats };
  const fileLayout = layout(projectGraph(graph, defaultView()));
  const folders = projectGraph(graph, { ...defaultView(), mode: 'folders', depth: 2 });
  const folderLayout = layout(folders);
  return {
    label,
    files: files.length,
    edges: graph.edges.length,
    collectMs,
    cold,
    warm,
    edit,
    fileLayout,
    folderLayout,
    groups: folders.nodes.length,
  };
}
const rows = [await measure('codemap-ai', process.cwd())];
for (const count of [200, 1000]) {
  const root = mkdtempSync(path.join(tmpdir(), 'codemap-benchmark-'));
  try {
    for (let index = 0; index < count; index++) {
      const directory = path.join(root, 'src', `module${Math.floor(index / 20)}`);
      mkdirSync(directory, { recursive: true });
      const previous =
        index > 0
          ? path
              .relative(
                directory,
                path.join(root, 'src', `module${Math.floor((index - 1) / 20)}`, `file${index - 1}`),
              )
              .split(path.sep)
              .join('/')
          : undefined;
      writeFileSync(
        path.join(directory, `file${index}.ts`),
        previous
          ? `import '${previous.startsWith('.') ? previous : './' + previous}';\nexport const value=${index};`
          : 'export const value=0;',
      );
    }
    rows.push(await measure(`${count}-file chain`, root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
const ms = (value) => value.toFixed(1);
const report =
  `# CodeMap v0.2 performance baseline\n\nMeasured ${new Date().toISOString()} on ${os.platform()} ${os.arch()}, ${os.cpus()[0]?.model}, Node ${process.version}. Single-run diagnostic measurements, not performance guarantees or CI thresholds.\n\n| Fixture | Files / edges | Collect ms | Cold analysis ms | Unchanged ms | One edit ms | Parsed / resolved on edit | File layout ms | Folder layout ms (nodes) |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n` +
  rows
    .map(
      (row) =>
        `| ${row.label} | ${row.files} / ${row.edges} | ${ms(row.collectMs)} | ${ms(row.cold.milliseconds)} | ${ms(row.warm.milliseconds)} | ${ms(row.edit.milliseconds)} | ${row.edit.parsed} / ${row.edit.resolved} | ${ms(row.fileLayout)} | ${ms(row.folderLayout)} (${row.groups}) |`,
    )
    .join('\n') +
  '\n\nCollection uses disk reads in this standalone benchmark, not VS Code document loading. Layout uses the same Dagre dimensions/options in Node; it excludes Webview rendering. Update times exclude the 750 ms debounce. Synthetic chains stress layout depth; 1,000 files is a stress fixture, not a support guarantee.\n';
mkdirSync('docs', { recursive: true });
writeFileSync('docs/BENCHMARK.md', report);
console.log(report);
