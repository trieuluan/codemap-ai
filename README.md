# CodeMap AI

Explore TypeScript and JavaScript file dependencies as an interactive graph inside VS Code. v0.2 adds folder views, filters, saved layouts and automatic incremental updates. The extension is read-only; AI editing is planned for later.

## Run locally

```sh
pnpm install
pnpm run compile
```

Open this folder in VS Code and press **F5** (or **Fn + F5** on macOS). In the Extension Development Host window, open the project you want to inspect and run **CodeMap: Open Graph** from the Command Palette. You can open `codemap-ai` itself to map this extension's source. With no workspace, use **Open Folder**. Multi-root workspaces remember the last selected root; **View Options → Change Folder** chooses another.

## Explore

- **A → B means A imports or re-exports B**, not execution order.
- Click a file for its full dependencies/dependents. Double-click or **Open Source** opens source beside the graph; `L…` buttons jump to import locations.
- Search across all scanned files. Choosing a hidden result removes filters hiding it, opens its group and focuses it. Enter selects the first match.
- Pan, zoom and drag nodes. **Fit View** frames the current display. **Auto Layout** rearranges visible nodes only.

### View Options

| Option | Behavior |
| --- | --- |
| Files / Folders | Show file nodes, or group by a chosen folder depth (default 2). Files at the root remain file nodes. Shallow files belong to their immediate parent. |
| Expand / Collapse Folder | A collapsed folder is replaced by its member files. Double-click a folder to expand it; its sidebar lists members and internal dependency count. No nested group containers. |
| Folder depth | Group by the first N directory segments. Group positions are saved separately by depth. |
| Filter folder | Include the folder and all descendants. |
| Hide tests | Hide `*.test.*`, `*.spec.*` and files under `test`, `tests`, `__tests__`. |
| Hide isolated files | Hide files with no internal edges in the full source graph. |
| Focus | Show the selected file plus dependencies/dependents within 1 or 2 hops. File filters apply before traversal; arrows retain their original direction. |
| Reset Filters | Clear folder/test/isolated/Focus filters. |
| Reset View | Reset this root's layout, viewport, selection, grouping and filters; enable Auto Update. |

Folder edges aggregate directed file-to-file relations; labels count those relations, not individual import statements. Dependencies inside a collapsed folder appear as an internal count. File details always use the complete source graph. Footer counts show **visible files / total files**.

### Live updates

**Auto Update is on by default.** After 750 ms without new changes, CodeMap updates from unsaved editor text or filesystem changes. Ordinary edits parse/resolve the changed file only. Adding/deleting/renaming files re-resolves all imports with cached parsing, so missing targets can become valid edges. Config/package changes invalidate resolver state. Known inherited configs outside the root are watched too.

The footer shows **Up to date**, **Out of date**, **Updating** or **Error**. Disable Auto Update to keep the current graph and mark pending changes; re-enable it to synchronize. **Refresh** does a full reconciliation, including configuration. **Cancel** keeps the prior published graph and disables Auto Update. Failed scans keep the previous map and wait for a new change, re-enabling Auto Update, or Refresh to retry.

Updates do not fit or rearrange existing nodes. New nodes are placed in free space beside the current layout. Files and each Folders depth have independent node positions and viewports. The first visit to a mode/depth lays out its visible nodes and fits the view; returning restores that view's saved layout and camera. Expanded files in Folders do not reuse Files coordinates. Expanding a folder frames its files. The extension does not modify source or execute project code.

### Saved state

Layout, zoom/pan, selection, filters, grouping, expanded folders and Auto Update are saved through VS Code workspace state, separately for each root URI. Closing/reopening the panel or restarting VS Code scans fresh source and restores valid state. Deleted nodes are discarded; renamed files are treated as removed/new nodes. Search text is temporary. Source, ASTs and dependency snapshots are never persisted by CodeMap. View state is local to the VS Code workspace, not shared through a repository file.

## Analysis and limitations

Source extensions: `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`, `.mjs`, `.cjs`. Declaration files are excluded, along with `.git`, `node_modules`, `dist`, `build`, `out`, `coverage`, `.next`, `.vscode-test`, and enabled `files.exclude` patterns including sibling conditions. `search.exclude` and `.gitignore` are not source filters.

Recognizes static/side-effect/type-only imports, re-exports, `import = require`, literal `require()` and literal dynamic `import()`. Multiple imports share one edge and retain source locations. Cycles remain visible. Resolved symlinked targets map to their original scanned URI.

The nearest ancestor `tsconfig.json`/`jsconfig.json` within the root supplies resolver options and inherited aliases. With no config, resolution defaults to JS-enabled ESNext/Bundler. Invalid configuration warns and falls back. Scanned files are selected by the source filters, not `tsconfig`'s `include`/`exclude`.

| Outside graph status | Meaning |
| --- | --- |
| external | Node built-in, installed package, or resolved target outside the selected root |
| excluded | Target resolves inside the root but is outside the scanned set |
| unresolved | TypeScript cannot resolve the target; no speculative edge is created |

Bundler-only aliases and runtime-computed imports remain unsupported. CSS imports normally appear unresolved unless the TypeScript resolver finds a declaration. `require` detection is syntactic and does not check shadowing. This is a file graph, not a call graph or business architecture. Desktop filesystem workspaces only; no VS Code Web/virtual workspace support. Source stays on the machine; there is no model/server connection.

The initial target is about 200 files; 1,000-file fixtures are stress tests, not support guarantees. Package installs are detected through watched metadata and lockfiles; use Refresh if an external tool changes dependencies without those signals.

## Development and verification

```sh
pnpm run compile      # Host/UI typecheck, lint and both local bundles
pnpm run watch        # Watch host/UI TypeScript and esbuild
pnpm run test:unit    # Analyzer, projection, scheduler and view storage tests
pnpm test            # Unit tests and integration tests in real VS Code windows
pnpm run benchmark   # Regenerate docs/BENCHMARK.md
pnpm run package     # Production bundles
```

Integration tests create temporary workspaces and require a desktop session; the first run may download VS Code. Fixtures cover React/barrels, Node ESM/CJS, monorepo symlinks, incremental/full equivalence, exclusions, watchers, persistence and empty workspaces. See [performance baseline](docs/BENCHMARK.md) for this machine's measurements. **Output → CodeMap** logs collection, analysis, parse/resolve counts and layout times without source content.

Architecture: workspace adapter for editor/filesystem access; cached TypeScript analyzer; per-root controller/scheduler; independent graph projection and versioned view storage; React Flow/Dagre Webview. Host and browser bundles use separate TypeScript configs, local assets and a restrictive CSP.
