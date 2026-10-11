# Working Set / Plan / Change Map QA

Date: 2026-10-12. macOS local workspace, desktop VS Code test host.

## Automated verification

- `pnpm run compile`: host and webview TypeScript, lint, development bundles passed.
- `pnpm run test:unit`: 92 passed, including task scope validation, directed boundary projection, persistence across store instances/roots, coding-plan validation and import deltas.
- `pnpm exec vscode-test`: 28 workspace integration tests and 1 empty-window test passed. New coverage verifies read-only permission enforcement despite forged client scope, plan-step selection, real TypeScript graph preview without buffer mutation, cancellation without stale publication, and permission revocation before Apply.
- `pnpm run package`: production bundles passed.
- `pnpm run format:check` and `git diff --check`: passed.

## UI verification

Ran the real compiled React application against a temporary localhost host/model fixture. The fixture contains Dashboard, App, StatsCard, a hook and an isolated utility. Its AI responses, editor navigation, test failure and Apply events are simulated. No provider request or real project edit was made by this UI test.

Verified:

- Plan has a dedicated scrollable tab, validated edit selection and Generate action.
- Accepted graph preview displays a removed import as a dashed edge with a negative count; Before/Proposed controls and node review states appear.
- Review enables Apply; Applied state and dirty/error badges appear after the fixture publishes new source.
- Test failure offers repair context; repair opens Context, prepares a draft question and does not submit automatically.
- Named Save task appears in Saved Views and restores map/source/edit scope after Full graph.
- Searching a file outside the task changes map scope only; source/edit counts remain unchanged.
- Reload restores task name, scope and camera against a fresh graph.
- Dark/light theme variables render readable task, scope and graph controls.

Proof images are kept in the Codex visualization output: `codemap-working-set-plan.png`, `codemap-change-map-review.png`, `codemap-working-set-light.png`.

## Limits / remaining manual provider check

The new Plan → Generate flow has automated fake-model coverage and UI fixture coverage. It has not yet been rerun end-to-end against a signed-in live provider. Earlier real-provider Ask/Edit/Apply evidence is recorded separately in QA-v0.8.md; that is not evidence for the new Plan mode.

Graph previews compare static file imports only. Edit permission covers whole existing files, while plan symbol names describe intent. Plans/proposals are session-only; stored tasks contain view metadata, never source or AI replies. Large task sets remain subject to source budgets and provider input limits.

## Empty Chat regression — 2026-10-12

A user screenshot showed `copilotcli` / Auto, 0/0 tokens and blank successful turns. Inspection of the installed VS Code bundled Copilot provider confirmed its `copilotcli` registration implements an empty `provideLanguageModelChatResponse` and a zero-returning `provideTokenCount`.

CodeMap now excludes CLI-only entries and invalid input budgets from its picker, rejects already configured unsupported models before token counting/source requests, treats empty/whitespace output as failure, and excludes empty turns from future history. Model errors appear outside the collapsed settings with a Choose another model action; request failures appear beside the composer. Existing blank turns show a fallback explanation and disable Copy.

Validation: 93 unit tests and 31 VS Code integration tests passed (30 workspace, one empty window). Regression cases include both zero/positive-budget CLI entries, other zero-budget providers, empty/whitespace output, no successful history for empty output and a valid retry. A localhost fixture verifies the rendered model error; it does not contact a provider. No model setting is changed automatically.

## Explore → Plan → Review → Verify — 2026-10-12

Automated coverage now passes **130 tests: 96 unit, 33 workspace integration and one empty-window integration**. Compile/type checks, lint, production build and formatting pass. Added coverage checks:

- Metadata suggestions: exact candidates, barrel declaration reasons, test filename heuristics, included-file exclusion and bounded results.
- Unsaved changes during Ask/Plan responses reject stale results, including changes beyond a truncated source excerpt; no completed plan is published.
- Report-backed repair Plan/Generate prompts include only the explicitly selected current report; stale reports are rejected before provider submission.
- Verification history is root scoped, bounded to eight, cloned before publication and cleared on reset. Only a current validated diagnostic opens its exact editor character; stale/invalid indices are rejected.
- Existing Apply tests cover exact/rebased conflicts and permission revocation before Apply. Failed task termination, cancellation and bounded output remain covered by integration tests.

Browser smoke checks used the actual production React bundle and a five-file synthetic host/model fixture, in dark and light themes. Verified collapsed Scope/Task actions and workflow hints, reviewed context adds source without edit permission, unchecked relevance candidates and potential context-gap warning, Plan selection → Generate → import preview → reviewed diff → Apply → automatic Verify. The current report opens diagnostics; historical rounds disable tests/sharing/repair. A simulated failing test marks the changed edit scope. Prepare repair plan opens source/report review and prepares a Plan question without sending it. The fixture does not execute real commands or modify project source. Screenshots: `codemap-workflow-context.png` and `codemap-workflow-verify-light.png` in the local visualization artifacts.

Live discovery was rerun in an isolated desktop profile. The report returned `models: []`, `status: unavailable`, `sourceSent: false`. Thus a real-provider Plan/Generate/Apply run is still unverified. The updated opt-in `pnpm run test:ai:workflow` is ready for a compatible signed-in provider: connection check, single-file then multi-file plans, graph previews without buffer mutation, per-edit diffs, Apply, a passing local fixture test and a deliberately failing test. It uses only disposable synthetic source and creates an empty workspace for VS Code task execution. No workspace source or credentials were copied to the profile.

Verification rounds remain session-only observations, not a complete persisted conversation/plan audit. Failed test badges identify changed edit scope rather than a proven failing file. Context recommendations are metadata/filename heuristics and require relevance review.

## UI audit — 2026-10-12

Reviewed and corrected toolbar wrapping, Plan draft/tab mismatch, request controls hidden by tab navigation, nested Context padding, wrapping tab badges, long verification-round options, ambiguous scope checkbox labels and collapsed failing test output. View Options was an inert control during a Working Set because that panel is rendered only in full graph; it now disables with an explanation. Work on this disables without file/folder/context selection. More dismisses after selection, outside pointer input or Escape; search clears with Escape.

Production-bundle browser fixtures verified Plan → Generate → preview → diff → Apply → Verify, no-edit permission blocking with an explanatory message, Stop from Context during a delayed synthetic response, visible stopped-request feedback, and automatically expanded failure output. Checked dark/light, 900×600 and 640×700 breakpoints. Low-height panels prioritize the draft input and submit button; source remains accessible in Context. UI checks use synthetic model/editor/task events only. Unit (96) and VS Code integration (33 workspace + one empty window) passed; compile, lint and production build passed. Screenshots: `codemap-ui-audit-dark.png`, `codemap-ui-audit-light.png` in visualization artifacts.


### Signed-in synthetic workflow — 2026-10-12

**Passed with the real `copilot / Auto` VS Code provider** in the normal signed-in development host via `CodeMap: Run AI Workflow Check`. Six model calls completed: single-file Plan/Generate, multi-file Plan/Generate and failure-report-backed repair Plan/Generate. Each edit flow validated in-memory graph preview, readonly diff review and guarded Apply. Actual VS Code tasks observed `test:pass` exit 0, `test:repair` exit 1 before repair and exit 0 after repair. Repair allowed edits only to `b.ts`; `a.ts` stayed unchanged. Only synthetic temporary source was sent; no open-workspace source or credentials were copied. Temporary source/diff tabs were closed by fixture identity, preserving existing editors.

The isolated profile still exposed zero models and sent no source. This is distinct from the successful signed-in run. The regression uses six scripted model replies with actual tasks; overall coverage is **131 tests: 96 unit, 34 workspace integration and one empty-window integration**. The live check exercises host logic, not automated clicks through the Assistant webview; existing browser fixture checks cover that UI separately. This small fixture establishes one provider run, not all model/project behavior.

Live metadata report: [ai-workflow-2026-10-12.json](reports/ai-workflow-2026-10-12.json).

One repeat of the full integration suite timed out in the existing external inherited-config watcher test; the next full run passed 34 workspace + one empty-window test. The AI workflow regression passed on all runs. This watcher timing instability is separate from the live AI result and remains worth investigating. Compile, lint (zero warnings), formatting and production build passed.
