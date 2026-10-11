import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { build } from 'esbuild';

// Render the actual components, including their disabled/open attributes, without a Webview.
const components = build({
  stdin: {
    contents: `
      import React from 'react';
      import { renderToStaticMarkup as render } from 'react-dom/server';
      import { VerificationPanel } from './src/webview/components/VerificationPanel';
      import { LibraryPanel } from './src/webview/components/WorkspaceLibrary';
      import { InvestigationPanel } from './src/webview/components/InvestigationPanel';
      import { defaultView } from './src/shared/view';
      export function verification(stale) {
        return render(<VerificationPanel report={{ id:'r', stale, observedAt:'2026-10-12', revision:1, changedFiles:[], affectedFiles:[], diagnostics:[], addedDiagnostics:[], removedDiagnostics:[], addedImports:[], removedImports:[] }} error="" include={false} onInclude={()=>{}} onAction={()=>{}} />);
      }
      export function observed(refreshing=false) {
        return render(<VerificationPanel report={{id:'r',stale:false,refreshing,observedAt:'2026-10-12',revision:2,changedFiles:[{id:'a',path:'a.ts',sourceState:'reverted'},{id:'b',path:'b.ts',sourceState:'modified'}],affectedFiles:[],diagnostics:[],addedDiagnostics:[],removedDiagnostics:[],addedImports:[],removedImports:[],test:{name:'test',state:'failed',stale:true,output:'earlier failure',saved:true}}} error="" include={false} onInclude={()=>{}} onAction={()=>{}} onRepair={()=>{}} />);
      }
      export function library() {
        return render(<LibraryPanel snapshot={{root:{id:'root'},nodes:[]}} library={{annotations:[], views:[{id:'v',name:'My task',location:{view:{...defaultView(),workingSet:{files:['a'],context:['a'],editable:[],pinned:[],symbols:[],name:'My task'}}}}]}} capture={()=>{}} restore={()=>{}} onClose={()=>{}} />);
      }
      export function impact() {
        const graph = { nodes:['a','b','c'].map(id=>({id,path:id})), edges:[{source:'b',target:'a',sites:[]},{source:'c',target:'b',sites:[]}] };
        return render(<InvestigationPanel snapshot={graph} target={{nodeId:'a'}} onClose={()=>{}} onShowPath={()=>{}} onSelectFile={()=>{}} />);
      }
    `,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  external: ['react', 'react-dom/server'],
  banner: { js: 'const acquireVsCodeApi = () => ({ postMessage() {} });' },
}).then((bundle) => {
  const module = { exports: {} as Record<string, (...args: unknown[]) => string> };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(
    require,
    module,
    module.exports,
  );
  return module.exports;
});

test('stale verification disables both test actions in actual UI markup', async () => {
  const { verification } = await components;
  for (const stale of [false, true]) {
    const html = verification(stale);
    const buttons = [
      ...html.matchAll(
        /<button([^>]*)>(Choose test · disk only|Save changed files &amp; choose test)<\/button>/g,
      ),
    ];
    assert.equal(buttons.length, 2);
    assert.ok(buttons.every((button) => button[1].includes('disabled') === stale));
  }
});
test('saved task cards describe actual scopes rather than all files', async () => {
  const html = (await components).library();
  assert.match(html, /Working Set/);
  assert.match(html, /1 on map · 1 source · 0 editable/);
  assert.doesNotMatch(html, /All files/);
});
test('impact UI expands direct dependents and initially collapses indirect impact', async () => {
  const html = (await components).impact();
  assert.match(html, /<details[^>]*open=""[^>]*><summary>Direct dependents · 1<\/summary>/);
  assert.match(html, /<details class="impact-section"><summary>Indirect impact · 1<\/summary>/);
});

test('Verify shows Undo/manual edits and cannot repair from a stale failed test alone', async () => {
  const html = (await components).observed(false);
  assert.match(html, /Undone/);
  assert.match(html, /Edited after Apply/);
  assert.match(html, /Previous source/);
  assert.match(html, /<button disabled="">Prepare repair plan/);
  assert.match(html, /Refresh observations/);
});
test('Verify disables test selection while refreshing observations', async () => {
  const html = (await components).observed(true);
  assert.match(html, /Refreshing observations…/);
  const actions = [
    ...html.matchAll(
      /<button([^>]*)>(Choose test · disk only|Save changed files &amp; choose test)<\/button>/g,
    ),
  ];
  assert.equal(actions.length, 2);
  assert.ok(actions.every((button) => button[1].includes('disabled')));
});
