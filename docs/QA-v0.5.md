# CodeMap v0.5 verification

Verified on macOS arm64 (Apple M4 Pro), 2026-10-10.

- 55 unit tests: existing analyzer/projection/scheduler/persistence coverage plus directed module aggregation, central-file ranking, entry candidates, SCC/self-cycle detection, avoiding false file cycles from aggregation, context neighbor selection, source/notes/read-failure handling, budgets, fence-safe Markdown and architecture-view restoration.
- 13 workspace integration tests plus one empty-window test. New integration coverage verifies unsaved source in context, root/revision/ID validation, no source in workspace storage, copying reviewed text and refusing stale copies. Tests restore the original clipboard.
- Compile, TypeScript checks, lint, formatting and production build pass.
- Browser UI tested on a 200-file React fixture and the current `codemap-ai` source graph (46 files, 126 import pairs at test time), using the production Webview bundle. The preview harness invokes the real context builder against source files; VS Code document loading and clipboard behavior are covered separately by integration tests.
- UI checks: Overview depth 1/2, directed aggregate edges, module drill-down, camera restore, navigation history, named Overview save/restore, context selection by details/search/Shift-click, optional neighbors, source exclusion, fresh preview, symbols/notes/outside metadata, source budget warnings and light/dark themes. No console errors in these flows.
- Local `.vsix` packages include bundled host/UI assets; archive contents are inspected to exclude source, tests, dependencies and package-manager caches. Installation is checked using VS Code CLI with isolated user-data/extension directories.

Runtime context remains in memory and is never stored with Saved Views or source graph snapshots. Refresh invalidates the preview. Entry candidates and type-only cycle groups are described as dependency analysis, not runtime execution facts. Performance baselines are in [BENCHMARK.md](BENCHMARK.md); browser rendering, VS Code document reads and clipboard are excluded from the standalone context timings.
