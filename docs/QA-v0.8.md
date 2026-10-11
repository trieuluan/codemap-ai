# CodeMap v0.8 verification

Date: 2026-10-11. macOS arm64, Node 24.2.0, VS Code test runtime 1.141.0.

## Scope

Range-based proposals with per-edit review/acceptance, partial Apply, post-Apply diagnostics/import/impact observations and explicit package test execution. Source context, proposals, reports and test output remain session-only. Tests and graph actions cannot be initiated by model output.

## Automated coverage

Final result: **106 passing tests** (80 unit, 25 workspace integration, one empty-window integration). Compile/type checks, lint, format checks and production host/browser builds pass. Existing navigation integration now waits for asynchronous editor activation rather than assuming `showTextDocument` immediately updates `activeTextEditor`.

Dependencies were unchanged. This machine's pnpm 11 auto-verification attempted an install after the package version bump; final commands used `pnpm_config_verify_deps_before_run=false` with the existing installed dependency tree.

- Range positions: UTF-16, CRLF, EOF insertion, invalid ranges and exact original text.
- Multiple edits, partial selection, no-op removal, overlap rejection and unknown selections.
- Conservative rebasing: unique unchanged surrounding source preserves unrelated edits; ambiguous or locally changed source conflicts. Supporting context must stay unchanged.
- Exact directed import deltas, old/new static dependents and diagnostic identity deltas.
- Webview validation for range IDs, selected IDs, explicit report sharing and test intent.
- Desktop integration: per-hunk diff review, Apply only accepted reviewed edits, dirty buffers, successful Apply surviving graph-refresh failure, diagnostics updates, stale report/source/root guards.
- Real VS Code CustomExecution tasks on a disposable package: pass/fail exit codes, 32,000-character output limit and cancellation. These tests run synthetic package scripts, not repository tests supplied by an AI.
- Global Undo commands proved focus-dependent in the unattended test host; the automated test restores its buffer explicitly. Manual Undo in a normal focused editor remains a release check.

## Live model result

`pnpm run test:ai:workflow` reported **unavailable**: zero accessible models in its isolated profile, and `sourceSent: false`. Latest repeat report: `codemap-live-model-GDRSVn/report.json` under the system temporary directory. No credentials were copied. This does not establish availability in the normal signed-in VS Code profile.

Live model quality, provider authorization and the full Explain → follow-up → range proposal → diff → Apply workflow remain unverified. Run **CodeMap: Test AI Connection** and that workflow in a signed-in development host. Fake models and visual fixtures are not evidence of live provider success.

## UI and manual checks

No browser console warnings/errors were observed. The actual React review/verification components are exercised with a localhost fixture (simulated host/model data) in dark/light themes. Checkboxes reject individual edits; only accepted, reviewed edits enable Apply. The report separates diagnostics, static import impact and tests on disk. Test output is escaped text; sharing is unchecked by default.

Assistant redesign was checked using the actual full App bundle with a synthetic five-file graph and simulated host/model. Direct Edit opens and focuses the composer; the draft survives tab changes; a proposal completes while Context is open and switches to Changes. Rejected edits and reviewed status survive tab changes; Apply enables only the accepted reviewed edit. Keyboard resize, dark/light themes and a 600px-wide viewport were checked; no browser console errors were observed. These visual checks do not call a live model or edit source files.

Context/review follow-up: unit coverage checks omitted/truncated/excerpted source summaries, ordered per-file grouping and precise range-conflict IDs. Desktop integration verifies that conflicts leave the buffer untouched and carry the affected file/edit IDs. Browser fixture checks local pre-submit source summary, bulk Accept/Reject, sequential Review next and Apply gating.

Before release, manually verify a live model proposal, readonly per-edit diff, normal-editor Undo, multi-file partial Apply, save hooks, project tests with unsaved buffers, and diagnostics from the project's language provider.

## Operational limits

Maximum 40 non-overlapping edits across 10 complete existing context files; no creates/deletes/renames. Rebase anchors retain up to 80 source characters on each side and must match uniquely. Declaration labels describe declarations starting inside the edit range, not complete semantic impact.

Diagnostics are provider observations (up to 100, messages capped at 2,000 characters), not a type-check completion guarantee. Import deltas compare resolved file pairs; static dependents are potential impact. Any subsequent root source/config synchronization marks a report stale.

Only root `package.json` scripts named `test` or `test:*` are selectable. Package managers: npm/pnpm/yarn/bun, from `packageManager` with npm fallback. Commands run in a VS Code task on disk, only after user selection, and time out after five minutes. Stop/dispose terminates the process group on macOS/Linux (SIGTERM, then SIGKILL); Windows uses child termination. Save is optional and covers changed files only; other dirty buffers may remain untested. Logs are capped at 32,000 characters and are shared only when the user explicitly includes the report in a subsequent Ask.
