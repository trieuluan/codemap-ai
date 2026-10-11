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

### Signed-in desktop follow-up — 2026-10-12

Manually verified in the normal VS Code profile, using an Extension Development Host and a disposable synthetic workspace. Provider: `copilot`, model label: `Auto` (the underlying model is not identified). No credentials or trust settings were changed. The isolated-profile result above still applies to that separate environment.

| Check | Observed result |
| --- | --- |
| Test connection | Passed; source-free request responded in 807 ms. |
| Ask | Explained `total(values)` correctly, including the zero initial accumulator, with a clickable single-line citation. |
| Follow-up | Reported one prior turn included; correctly answered `total([]) === 0`. |
| Edit | Produced one range edit adding `: number` to the function signature; body and formatting preserved. |
| Review | Opened the proposal in a VS Code diff; review count changed from 0/1 to 1/1 and enabled Apply. |
| Apply | Applied to an unsaved editor buffer; Explorer showed one unsaved file. Verification observed one changed file, two static dependents, no diagnostic or import deltas. |
| Save and test | Used **Save changed files & choose test**, then selected the fixture's `test` script. CodeMap reported `npm run test · passed (exit 0)`. |

The fixture test checks empty and positive arrays. Its script is `node --experimental-strip-types --test test.mjs`; Node emitted experimental type-stripping and missing package module-type warnings. Only synthetic source was selected for the model. Report sharing stayed unchecked. The temporary development host was closed and the fixture moved out of the repository after the test.

Two response-format issues were observed during the live smoke test (fixed in the follow-up below):

- Range citations such as `[[src/stats.ts:L2-L3]]` remain literal text; single-line citations render as buttons. Citation navigation was not exercised in this run.
- A follow-up graph suggestion appeared as a raw JSON code block rather than an action card. The first Ask did produce graph action cards; their execution was not exercised.

This is a successful live smoke test for one simple single-file edit, not a broad model-quality or multi-file/conflict verification. Screenshot evidence: `codemap-live-ai-pass.png` in the local visualization artifacts. Fake models and visual fixtures remain separate evidence.

## UI and manual checks

No browser console warnings/errors were observed. The actual React review/verification components are exercised with a localhost fixture (simulated host/model data) in dark/light themes. Checkboxes reject individual edits; only accepted, reviewed edits enable Apply. The report separates diagnostics, static import impact and tests on disk. Test output is escaped text; sharing is unchecked by default.

Assistant redesign was checked using the actual full App bundle with a synthetic five-file graph and simulated host/model. Direct Edit opens and focuses the composer; the draft survives tab changes; a proposal completes while Context is open and switches to Changes. Rejected edits and reviewed status survive tab changes; Apply enables only the accepted reviewed edit. Keyboard resize, dark/light themes and a 600px-wide viewport were checked; no browser console errors were observed. These visual checks do not call a live model or edit source files.

Context/review follow-up: unit coverage checks omitted/truncated/excerpted source summaries, ordered per-file grouping and precise range-conflict IDs. Desktop integration verifies that conflicts leave the buffer untouched and carry the affected file/edit IDs. Browser fixture checks local pre-submit source summary, bulk Accept/Reject, sequential Review next and Apply gating.

Before release, manually verify normal-editor Undo, multi-file partial Apply, conflict recovery with a live model, project-specific save hooks, tests with other unsaved buffers, and diagnostics from the project's language provider. The response-format fixes below use recorded response shapes; a new live model run was not needed for deterministic parser regression.

## Operational limits

Maximum 40 non-overlapping edits across 10 complete existing context files; no creates/deletes/renames. Rebase anchors retain up to 80 source characters on each side and must match uniquely. Declaration labels describe declarations starting inside the edit range, not complete semantic impact.

Diagnostics are provider observations (up to 100, messages capped at 2,000 characters), not a type-check completion guarantee. Import deltas compare resolved file pairs; static dependents are potential impact. Any subsequent root source/config synchronization marks a report stale.

Only root `package.json` scripts named `test` or `test:*` are selectable. Package managers: npm/pnpm/yarn/bun, from `packageManager` with npm fallback. Commands run in a VS Code task on disk, only after user selection, and time out after five minutes. Stop/dispose terminates the process group on macOS/Linux (SIGTERM, then SIGKILL); Windows uses child termination. Save is optional and covers changed files only; other dirty buffers may remain untested. Logs are capped at 32,000 characters and are shared only when the user explicitly includes the report in a subsequent Ask.

## Response-format regression fixes — 2026-10-12

Range citations now support `[[path:L1-L3]]` and `[[path:L1-3]]`. The host validates the entire range against supplied source (one contiguous excerpt for focused context), rejects reversed/out-of-bounds ranges and keeps distinct references sharing a start line. Markdown links require the exact validated range, display the range and navigate to its first line. Fenced code, inline code and existing links are not rewritten.

A trailing generic `json` fence is recovered only when its nonempty array clearly describes known graph actions with reasons. It then goes through the same catalog, path, symbol, route and count checks as `codemap-actions`. Ordinary JSON examples and malformed generic JSON remain Markdown. Suggestions still require an explicit user click; no action runs from model output alone. The prompt also reinforces the dedicated fence language.

Validation: **111 tests passed** (84 unit, 26 workspace integration, one empty-window integration), including source-range/excerpt bounds, exact range Markdown links, recorded follow-up JSON, unrelated JSON preservation, archived actions and citation navigation. Compile, lint, format and production build passed. The sandbox could not launch Electron (SIGABRT); the official cached VS Code test runtime succeeded outside that sandbox. Navigation integration waits for asynchronous selection propagation before asserting the destination.

Actual `AiMarkdown` and `AiActions` components were checked in a local browser fixture in dark/light themes. The recorded response shape displays a `stats.ts:1–3` citation and a Focus files action card, with both callbacks verified. No provider request or real source edit occurs in this visual fixture. Screenshot: `codemap-response-format-fixed.png` in the local visualization artifacts.
