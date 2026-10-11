# Real-repository developer workflow QA

Date: 2026-10-12. Target: local `codemap` monorepo at `bcc60d62c`, including its four pre-existing local changes. Extension: `codemap-ai` at `4d18c66`. Tested through the actual VS Code Extension Development Host, not a browser fixture or scripted model.

## Result

The selected navigation and coding workflow completed successfully on the real repository: **331 files, 906 dependencies, two existing analyzer warnings**. This establishes a useful real-project trial, not exhaustive graph correctness or usability across repositories.

| Task | Observed result |
| --- | --- |
| Discover project structure | Overview showed nine modules and directed package relationships; entry candidates are explicitly heuristics. |
| Find a feature/file | Path search found `plan-actions.ts` and desktop `ChatPage.tsx`, returning from Overview to the file graph. ChatPage's importer led to `app.tsx`; source confirmed its import at line 7 and persistent mount at lines 127–129. Semantic feature search was not tested or implied. |
| Read imports and dependents | `plan-actions.ts`: one internal import, two direct consumers, three declarations, matching source. `ChatPage.tsx`: eleven internal imports, one importer (`app.tsx`), two external imports (`react`, `react-router-dom`), matching source. |
| Follow an import location | `normalizePlanAction` opened `harness-runner.ts` at line 9, column 37, matching the import. |
| Follow a symbol through package exports/barrels | `ChatPage.tsx` → `core/agent/contracts/index.ts` → `contracts/types.ts`; Declaration opened `ThreadSummary` at line 13, column 18. |
| Inspect potential impact | `normalizePlanAction` showed two known bindings and 72 indirect files. Its barrel route rendered on a temporary canvas. This is static reachability, not a list of proven runtime callers. |
| Create and restore a Working Set | One map file, one source file and initially zero editable files. Explicit permission enabled one editable file. Save task → Full graph → Saved Views → Restore recovered the name and the 1/1/1 scopes. |
| Plan and generate with a real model | `copilot / Auto` produced one edit step for `IMPLEMENT_SYNONYMS`, then one insertion adding the exact string `"triển khai"`. No other file or import changed. |
| Preview and review | Proposed graph retained dependencies. Source on disk matched its original hash before Apply. Editor diff showed precisely one inserted line. Apply remained disabled until diff review. |
| Apply and verify | Apply updated the unsaved buffer and graph; Verify showed zero import delta. Save changed files & choose test ran the root `npm run test` task and reported **passed, exit 0**. |
| Validate the requested behavior independently | Before editing, a temporary three-case test failed only the new synonym case. After editing, those three cases plus all thirteen runtime-node tests passed: **16/16**. Existing approve/cancel synonyms and raw unmatched instructions were checked. |
| Edit manually and detect stale observations | Editor Undo + Save restored the original source. Auto Update synchronized the graph. Verify marked the previous report Out of date and disabled sharing/repair. |

The three-case test lived outside the repository in a temporary file. The runtime package baseline was also **13/13** before editing. The root test exit code above is distinct from those sixteen targeted cases; no full-monorepo test count was inferred from the bounded UI log.

## Findings to prioritize

1. **Stale change presentation:** after Undo, the node still displayed Applied and the Change map still selected Applied. The verification report correctly said Out of date. After leaving the task and selecting ChatPage, the previous change toolbar remained visible. Scope the presentation to the current proposal/task and explicitly mark prior Apply observations as historical.
2. **Monorepo test selection:** the chooser offered only root `test` and `test:integration`. A developer working in runtime-node could not select that package or a targeted file there. Offer package-scoped declared scripts and show the working directory; keep arbitrary model-generated commands out of this flow.
3. **Impact overload:** a one-function change produced two known bindings plus 72 indirect file rows through barrels. Default to direct bindings and nearby consumers; make further depth explicit and collapsible.
4. **Canvas readability during diff review:** opening the editor beside the graph while Scope was expanded left little canvas space and tiny nodes. Collapsing Scope and using Fit View recovered readability. Consider a compact review layout and an explicit reveal-selection action while preserving user positions.
5. **Saved task labeling:** the library card said `Files · All files` even though restoring it correctly produced a one-file Working Set. Show task identity and map/source/edit counts on the card.
6. **Transitions and freshness cues:** Generate briefly selected Explore before Review appeared. Immediately after Apply, Verify briefly instructed the user to apply first while observation was running. Stale reports still displayed enabled test-choice buttons even though report sharing/repair were disabled; the host guards stale operations. Use pending states and consistent disabled explanations.

These are observations and follow-up recommendations, not fixes shipped by this QA pass.

## Preservation and limits

- The source sent to Copilot was the explicitly selected real `plan-actions.ts` source, with CodeMap's bounded metadata/context protocol. The diagnostic synthetic-workflow command was not used for this trial.
- The initial Vietnamese request was altered by the macOS input method during simulated typing. It was stopped before any edit, then resubmitted with exact text via paste. This was a test-input issue, not evidence of an extension Unicode bug.
- The experiment's single-line edit was undone through VS Code. SHA-256 checks verified the original target source and all four pre-existing changed files were unchanged afterward. Git status returned to the original four paths.
- The QA-created Saved View and source/diff tabs were removed. No commit or push was made in the target repository.
- CodeMap MCP tools requested by the target's local instructions were not available in this session. The actual extension UI, source reads and local tests supplied the evidence instead. The system Git initially hit the Xcode license gate; Homebrew Git worked. No license acceptance or system setting change was performed.
- This pass did not test restart persistence, every import edge, concurrent edits, another model, or another developer's comprehension. It is not a performance benchmark or proof that all 72 indirect files require changes.

Proof screenshots in this task's visualization artifacts: `codemap-real-impact.png`, `codemap-real-review.png`, `codemap-real-verify.png`, `codemap-real-barrel.png`.

## Follow-up fixes (working tree)

- Applied badges now require matching, current verification. Historical/stale observations read “Applied earlier”; Applied graph comparison becomes unavailable and the canvas returns to Current. Task exit/restore and conversation scope changes clear the graph's proposal/plan presentation without clearing AI history.
- Test selection discovers root and nested packages, labels command/cwd and prioritizes packages containing the Apply's changed paths. Execution validates the declared script and real package directory. Stale reports, source changes during selection/start, cancellation during preflight and concurrent runs are guarded.
- Direct impact/known bindings appear first; indirect entries are initially collapsed with their count. Source/path navigation is retained.
- Review/Verify collapses Scope; saved task cards describe map/source/editable scopes.

Validation: 101 unit tests, including actual component markup for stale test buttons, impact sections and task scope labels; VS Code integration covers package cwd, symlink escape rejection and stale report selection. Read-only discovery on the actual codemap monorepo returned runtime-node first for plan-actions.ts, plus root, cli, core and desktop tests. A separate UI profile was launched, but the UI automation tool could not select/capture that process; visual layout and theme verification of this patch remain unconfirmed. The original development session was not reloaded. No new real-model edit was requested during this follow-up.

## Chat layout follow-up

The Assistant now uses a single model/window toolbar, a compact source row and a transcript-first grid. Source preview/token details moved to Context; the composer grows within a bounded height. Expand/restore and Escape preserve the mounted conversation. A browser fixture mounting the real ContextPanel/AiAssistant components verified long Markdown, code blocks, input growth, Context navigation, expansion/Escape and light/dark styles at reduced height. This was synthetic conversation data, not a new model trial or native Extension Development Host run. Package/type/lint/format checks and 101 unit tests passed.

## Coding workflow completion

- Assistant remains mounted when temporarily opening details/impact/library; conversation, draft and transcript position survive returning. Context selection still switches conversations explicitly. Validated source citations also reveal their file on the map. Context offers explicit graph-selection/active-editor shortcuts; canvas badges distinguish source and editor roles.
- Plan/Edit now first opens a local context review with dependency/barrel/test candidates and the editable source count. Candidates can be revealed on the map before adding. Adding source neither submits a model request nor expands working-set edit permissions. Scope/question/symbol/revision/permission changes invalidate acknowledgement; plans for a different scope must be recreated. Outside a working set, included files remain editable and this is stated explicitly.
- Verify compares local whole-file digests for AI edits present, restored original (Undo), subsequent manual modification and unavailable source. Refresh observations updates diagnostics/imports against the Apply baseline without reapplying. Earlier test output is explicitly stale; a stale failed test alone cannot prepare repair or mark current nodes as failed. Concurrent refresh/test, reset and failed synchronization are guarded.

Validation: 107 unit tests (including actual component markup), 39 workspace integration tests plus one empty-workspace integration test. The workflow suite uses a deterministic model fixture and real VS Code diffs/editor edits/test tasks; no new real-model request was made in this follow-up. Read-only scan of the actual codemap repo confirmed 331 nodes, 906 edges and two warnings, the plan-actions.ts → runtime-input.ts import and PlanReviewAction declaration binding, plus package test discovery. Full scans took 36.5–57.9 seconds across two isolated desktop test runs; first-scan performance remains a limitation, not a throughput guarantee. All five protected source hashes remained unchanged.

Browser QA mounted the actual ContextPanel/AiAssistant components with synthetic host messages: draft/history survived hiding/showing Assistant, Plan sent zero requests before acknowledgement, adding a candidate did not send or expand edit scope, Stop recovered input, and Verify displayed Undo/manual edits plus previous test evidence and disabled test actions during refresh. No browser console errors. Native signed-in UI/provider behavior remains covered by the earlier real-model trial, not revalidated here. The original development host was not reloaded.

Compile, production package, lint, format check and Git whitespace checks passed. Screenshot: `codemap-workflow-verify.png` in the task visualization output directory (synthetic UI fixture).

## Stabilization and native regression pass — 2026-10-12

The current source passed type checking for host and webview, ESLint, Prettier, development and production builds, Git whitespace checks and **107/107 unit tests**. The initial desktop integration launch aborted inside the sandbox; running the desktop tests outside the sandbox succeeded with **39 workspace tests and one empty-window test**. This run included the optional read-only real-repository checks: **331 files, 906 edges, two warnings**, a 41.5-second full scan and runtime-node ranked first in the package test choices. No target source was edited by those checks.

A subsequent review found and fixed an Apply verification bug: after rebasing a proposal around unrelated user edits, source digests were computed from the older proposal source with the rebased offsets. Verification now captures the actual editor text immediately before Apply and computes the expected applied text against that same text. The integration regression preserves an unrelated prefix, verifies the resulting source is classified as applied, then restores the actual pre-Apply text and verifies it is classified as reverted. After this fix, all **107 unit tests**, **37 standard workspace integration tests** and **one empty-window test** passed again; the two optional read-only repository checks were not repeated. Production build, lint, formatting and whitespace checks also passed again.

Native UI checks used the latest production webview bundle in the actual VS Code Extension Development Host with a temporary two-file workspace under `/tmp/codemap-native-qa-kj9og87p`:

| Interaction | Observed result |
| --- | --- |
| Save task → Full graph → Saved Views → Restore | Card showed Working Set with 1 map / 1 source / 0 editable; name and scopes restored. |
| Close Assistant → reopen | The exact unsent QA draft survived. The older already-open webview lost its draft on this transition; that behavior did not reproduce after loading the current bundle. |
| Plan without edit permission | Create plan was disabled with an explanation. |
| Allow one file → Create plan | Opened Context review with the included editable count and an imported declaration candidate; explicitly stated that no request had been sent. |
| Enter Review with Scope expanded | Scope collapsed; Assistant opened Review. |
| Expand Assistant → Escape | Returned to the sidebar size. |
| Impact in the real-repo window before restart | Direct dependents were visible; indirect impact was initially collapsed and expanded on demand. |

The native fixture remained in Restricted Mode; no new provider request or native manual Apply was performed. Apply, source restoration, observation refresh, package cwd execution and stale-report guards were exercised by the automated tests in real desktop VS Code, using deterministic model responses. These are separate from the earlier signed-in real-model trial. The native screenshot inspection covered the dark-theme Context review layout; it did not repeat all viewport/theme combinations.

Launching another development host for the same extension unexpectedly reused/restarted the original development host instead of keeping it separate. Its in-memory AI session was reset; the original `codemap` folder was reopened after QA. The original repository still had its four pre-existing modified paths, and no target-repository commit or push was performed. Temporary QA task metadata belongs to the temporary workspace only.
