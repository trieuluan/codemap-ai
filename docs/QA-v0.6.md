# CodeMap v0.6 verification

Date: 2026-10-10. macOS arm64, Node 24.2.0, VS Code test runtime 1.141.0.

## Automated

- `pnpm run compile`: host/browser type checks, lint and both bundles pass.
- `pnpm run format:check`: pass.
- `pnpm test`: 87 tests pass (65 unit, 21 workspace integration, 1 empty-window).
- `pnpm run package`: production host/browser bundles pass.
- `git diff --check`: pass.

AI tests use an injected fake VS Code model: no provider authorization, paid requests or source transmission. Cases include prompt construction, unknown/duplicate/truncated proposal files, invalid citations, malformed webview messages, directed dependency/impact tools, streaming, unavailable models, input token limits, stale context, Stop with late responses, read-only diff review, unsaved source conflicts, single-use Apply and registered agent tools. Added focused AST ranges, original-line citations, focused-edit rejection, bounded region history, inline citation parsing, source-free connection success/provider errors, fresh follow-up context, history trimming and validated clipboard copying. The integration edit changes temporary editor buffers, verifies a fresh graph and restores the fixture afterwards.

## UI

Production browser bundle tested against a localhost host bridge using the extension's own 53-file/153-edge graph and real local context builder. Model responses in this preview are fixtures. Checked Context selection, Preview, disabled AI without a question/selection, model display, direct Ask without manual Preview, automatic context preparation, Markdown headings/lists/code blocks/tables, prompt entry and citation buttons with light/dark theme variables. The follow-up preview also checks Focused excerpts, connection states, history retention through Refresh, stale citations, Copy code and follow-up input usage. No browser console errors. Screenshots are local verification artifacts outside the repository.

## Remaining live check

`pnpm run test:ai:live` was executed on this machine using the installed extension directory and a fresh isolated VS Code profile. Result: **unavailable**, zero exposed models. No source was read or sent, no login credentials were copied. This does not establish model availability in the user's normal signed-in profile.

In the normal development host, choose a compatible model and use **CodeMap: Test AI Connection**; then ask about a small selection and review a small proposal. Live quotas, authorization and response quality remain unverified. CodeMap does not reuse arbitrary third-party extension sessions or credentials.

## Editing limits

Only existing complete context files may be replaced (maximum 10 files/proposal). No creation, deletion, rename, command execution or automatic test execution. Each diff must be opened before Apply; every context buffer must still match the reviewed source. Applied changes remain unsaved. Model ID is saved in user settings; source bundles, answers and proposals are held in memory only.
