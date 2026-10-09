# CodeMap v0.4 verification

Verified locally on macOS arm64 (Apple M4 Pro), 2026-10-10.

## Automated

- 46 unit tests: analyzer fixtures, projection, scheduler, layout profiles, navigation branching and 50-entry bound, camera capture, stale paths/targets, symbol anchors, deleted geometry, corrupted library data and per-root persistence.
- 12 workspace integration tests: existing unsaved documents/watchers/navigation coverage plus Saved View and note CRUD across panel instances, root validation and source-free storage.
- 1 empty-workspace integration test.
- Type checks, ESLint, Prettier check, development compilation and production bundling.
- Standalone analysis/layout/state baseline for this repository, a 200-file chain and a 1,000-file chain: [BENCHMARK.md](BENCHMARK.md). Timings exclude browser rendering and VS Code document loading.

## UI checks

The production Webview bundle was exercised in a local browser harness with a 200-file React-style graph and mocked host messages. Real workspace storage and message validation were separately covered in VS Code integration tests.

- Open symbol canvas, Back to the graph, then Forward: correct node set and exact original viewport.
- Open a three-file route through a barrel, Back: correct graph and exact original viewport.
- Save/open a symbol view; rename the bookmark; reload the harness and reopen it.
- Save a UI role and note; check the node badge, Refresh and reload persistence.
- Replace the graph with a fresh revision missing Dashboard; open its bookmark: fallback notice, available graph retained and orphan note listed.
- Verify light/dark rendering and no Webview console errors during normal navigation, save/restore and Refresh.

The browser harness does not replace a manual F5 check of native VS Code interactions. Run `pnpm run compile`, restart the Extension Development Host and open **CodeMap: Open Graph** to try the controls in the installed theme. Notes and named views remain separate from **Reset View**; history is panel-local.

## Sidebar redesign follow-up

Verified the production bundle on the same 200-file browser fixture in light/dark themes: Connections/Symbols/Notes navigation, collapsed import details and barrel routes, symbol impact/back navigation, note draft retained across section switches, and Saved View create/rename/restore/replace/delete. Library Notes shows saved note content and role. Type checks, lint, format and production build pass. Analyzer/storage behavior was unchanged by this presentation update.

Outside graph follow-up: verified light/dark module cards, External/Excluded/Unresolved states, long resolved paths, expandable import details and grouping five import sites into four module cards while retaining both React source locations. Production build, lint and formatting checks pass.
