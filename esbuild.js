const esbuild = require('esbuild');
const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const problemMatcher = {
  name: 'esbuild-problem-matcher',
  setup(build) {
    build.onStart(() => console.log('[watch] build started'));
    build.onEnd(result => {
      for (const { text, location } of result.errors) {
        console.error(`✘ [ERROR] ${text}`);
        if (location) { console.error(`    ${location.file}:${location.line}:${location.column}:`); }
      }
      console.log('[watch] build finished');
    });
  },
};
async function main() {
  const common = { bundle: true, minify: production, sourcemap: !production,
    sourcesContent: false, logLevel: 'silent' };
  const contexts = await Promise.all([
    esbuild.context({ ...common, entryPoints: ['src/extension.ts'], platform: 'node', format: 'cjs',
      outfile: 'dist/extension.js', external: ['vscode'], plugins: [problemMatcher] }),
    esbuild.context({ ...common, entryPoints: ['src/webview/index.tsx'], platform: 'browser', format: 'iife',
      outfile: 'dist/webview.js', plugins: [problemMatcher], define: { 'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development') } }),
  ]);
  if (watch) { await Promise.all(contexts.map(context => context.watch())); }
  else {
    try { await Promise.all(contexts.map(context => context.rebuild())); }
    finally { await Promise.all(contexts.map(context => context.dispose())); }
  }
}
main().catch(error => { console.error(error); process.exit(1); });
