# CodeMap v0.7 verification

Date: 2026-10-10. macOS arm64, Node 24.2.0, VS Code test runtime 1.141.0.

## Automated checks

- Compile/type checks, lint, formatting and production host/browser builds pass.
- 94 tests: 71 unit, 22 workspace integration and one empty-window integration.
- New cases cover metadata-only catalogs and limits, all five action kinds, directed paths through cycles/barrels, nonexistent/ambiguous/uncataloged targets, malformed/oversized blocks, inert commands, expired routes/symbols/files, temporary focus history/Saved View parsing and reconciliation.
- Extension-host coverage checks that suggestions cannot execute before an explicit ID request, forged IDs are rejected, adding context forks conversation without reading source, and stale revisions/unsynchronized graphs reject actions.
- Existing streaming/cancellation, context ranges, citation, token, proposal, conflict, diff/Apply and workspace regressions remain covered. Fake models make no network requests.

## UI checks

Real browser bundle, localhost host bridge, the repository's 65-file/197-edge graph, real context builder/focused selector/action parser; model replies are fixtures. Checked dark/light cards, Focus's four-file canvas, two-file directed route, adding aiPrompt source without an automatic request, retained conversation in the expanded region, the next Ask's fresh focused context/history, Inspect symbol, static impact, and stale actions/citations disabled after Refresh. No console warnings/errors. Screenshots are verification artifacts outside the repository.

## Live result

Executed `pnpm run test:ai:workflow`. Result **unavailable**: zero models exposed in the isolated test profile. No source was sent; the synthetic workflow was skipped. Report: `codemap-live-model-DEPB3I/report.json` under the system temporary directory. This does not determine availability in the user's normal signed-in VS Code profile.

The opt-in workflow is implemented but its live Explain/follow-up/proposal/diff/Apply path remains unverified until a compatible signed-in provider exposes a model. Source transmission, provider authorization/quotas and response quality must be checked there. Fake-model tests and browser fixtures are not live-model verification.

## Limits

Graph actions navigate UI or extend an explicit context selection. They never run project commands, create source files or apply source edits. Edits remain the separate reviewed-proposal flow. Catalog limits are 80 files, 20 declaration names/file and 200 import pairs. Actions use the current revision and supplied index only; semantic correctness still depends on the model and user review. Existing code/source storage limits remain unchanged.
