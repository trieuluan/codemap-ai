# CodeMap AI

Explore TypeScript and JavaScript file dependencies as an interactive graph inside VS Code. v0.3 adds editor synchronization, barrel routes, on-demand symbol nodes and dependency impact analysis, alongside folder views, filters, saved layouts and automatic incremental updates. The extension is read-only; AI editing is planned for later.

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

### Inspect imports without expanding a folder

Select a file such as `Dashboard.tsx`. Collapsed folders preview the files it imports and their imported symbol names, while the rest stay grouped. The preview shows up to two files; **View imports** opens all matching relationships in the sidebar. Click any arrow to inspect its directed file relationships, source import lines and symbol bindings. Edge labels distinguish file relationships from symbol bindings.

Bindings show default/named/namespace imports, aliases (`Card → DashboardCard`), type-only imports and a declaration kind when known (`function`, `class`, `interface`, `type`, `enum`, `value`). **Declaration ↗** opens a validated declaration in the current snapshot, including statically resolvable barrel re-exports. The original import line remains separately navigable. File details also have an expandable **Declared symbols** list.

**Peek N files** puts only the directly imported members onto the canvas; the remaining members stay in their folder. **Close Peek** regroups them; **Expand Folder** still opens all members. Peek is temporary and follows the import context of the selected file. Explicit Peek/Close Peek rearranges the visible graph; background source updates preserve positions. Folder layouts from earlier versions are laid out once to accommodate the larger summary cards; Files layouts are retained.

Symbol linking uses static declarations and exports over TypeScript-resolved graph edges. Unknown/computed CommonJS exports, namespace members, external declarations and ambiguous barrel exports remain unclassified and have no declaration shortcut. An import is not proof that a function is called or a binding is used. Imported-symbol counts count bindings across import sites, not unique functions or runtime calls.

### Follow the editor

The file open in the editor has a highlighted border on its visible node (or collapsed folder). **Reveal Active File**, also available as **CodeMap: Reveal Active File** in the Command Palette, selects the file, clears filters hiding it, expands its folder and centers the canvas. Files outside the current graph are ignored. Webview focus keeps the last text editor context.

**View Options → Follow editor** also selects/reveals files as the active editor changes. It defaults to off and is saved per workspace root. Following is suspended while a temporary path/symbol canvas is being inspected. Background refreshes do not repeatedly recenter the active file.

### Barrel routes and symbol exploration

Expand **Import route** under a resolved import binding to distinguish the directly imported file from the declaration file, including named/default aliases, static star exports and imported local re-exports. Route file buttons open source; **Show path on graph** displays only the real directed edges in that chain. Ambiguous or unresolved exports have no invented route.

File details include a **Symbols** section for top-level function/class/interface/type/enum/value declarations. React components appear under their syntactic declaration kind (usually function); framework wrappers are not inferred. Click a declaration to open its exact source position. **Show symbols on graph** temporarily isolates the file and its declarations with dashed **declares** connections. These connections express ownership and are distinct from import arrows; they do not add source dependencies or imply calls. Nested methods and runtime usage are not analyzed.

Path and symbol canvases are temporary. **Back to graph** restores the saved file/folder layout and viewport; dragging or Auto Layout during inspection does not overwrite them. Live updates refresh investigation data; deleted targets or broken routes close the affected inspection.

### Potential impact

**Analyze file impact** follows imports in reverse to list direct and transitive dependents across the complete graph, regardless of display filters. Each result includes one shortest directed dependency explanation ending at the changed file. **Show path on graph** isolates that explanation; cycles terminate and the target does not appear as its own dependent.

**Analyze symbol impact** starts from statically linked import bindings and their barrel routes, then includes file dependents of consumers. Consumers of unrelated named exports are not seeded just because they share a re-export barrel. This is a potential impact estimate: namespace property access, computed exports, runtime calls, dynamic dispatch and consumers outside this workspace are not covered. Transitive results describe file dependencies, not proven symbol usage.

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
pnpm run format       # Format source, styles, build scripts and configuration
pnpm run format:check # Check formatting without changing files
pnpm run compile      # Host/UI typecheck, lint and both local bundles
pnpm run watch        # Watch host/UI TypeScript and esbuild
pnpm run test:unit    # Analyzer, projection, scheduler and view storage tests
pnpm test            # Unit tests and integration tests in real VS Code windows
pnpm run benchmark   # Regenerate docs/BENCHMARK.md
pnpm run package     # Production bundles
```

Integration tests create temporary workspaces and require a desktop session; the first run may download VS Code. Fixtures cover React/barrels, Node ESM/CJS, monorepo symlinks, incremental/full equivalence, exclusions, watchers, persistence and empty workspaces. See [performance baseline](docs/BENCHMARK.md) for this machine's measurements. **Output → CodeMap** logs collection, analysis, parse/resolve counts and layout times without source content.

Architecture: workspace adapter for editor/filesystem access; cached TypeScript analyzer; per-root controller/scheduler; independent graph projection and versioned view storage; React Flow/Dagre Webview. Host and browser bundles use separate TypeScript configs, local assets and a restrictive CSP.

### Source organization

- `src/webview/index.tsx` mounts the app; `App.tsx` coordinates graph, selection and canvas state.
- `src/webview/components/` contains the toolbar, view options, node labels and dependency details.
- `src/webview/hooks/useHostMessages.ts` owns the host message subscription; `bridge.ts` owns the single VS Code API handle.
- `src/webview/graph-layout.ts` handles Dagre layout; `src/shared/view.ts` handles filtering, Focus, grouping and saved view reconciliation.
- `src/shared/investigation.ts` computes impact paths and temporary symbol/path projections without changing the source graph.
- `src/analyzer/` handles import resolution and static symbol linking; controller and scheduler modules handle live updates.

Prettier configuration lives in `.prettierrc.json`. Run `pnpm run format` before committing source changes. Generated `dist/` and `out/` files are build artifacts; edit files under `src/`.
