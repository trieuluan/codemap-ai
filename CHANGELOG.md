# Change Log

## Unreleased

- Add CodeMap: Run AI Workflow Check in the signed-in profile, with synthetic single/multi-file edits, real tasks, report-backed repair and scoped cleanup. Verify the six-request workflow with copilot / Auto.

- Refine graph toolbar and responsive Assistant: Plan drafts stay in Plan, request Stop/errors remain reachable across tabs, compact composers keep submission visible, context spacing is consistent, and failed test logs expand.
- Guide tasks through Explore, Plan, Review and Verify with collapsed scope/actions and a next-step hint.
- Suggest source context with import/declaration/test/request reasons and explicit review, independently of edit permissions.
- Keep eight session verification rounds, open validated diagnostic locations and prepare report-backed repair plans using current source.
- Reject stale Ask/Plan results after unsaved edits; extend the opt-in live fixture to single/multi-file Plan, graph preview, Apply and local tests.

- Prevent blank AI conversations from CLI-only/invalid models and empty provider output; show model errors and a direct picker action.

- Add named Working Sets with separate map, AI source and file edit scopes, pins, symbol anchors and Saved View persistence.
- Group immediate outside neighbors and preserve task/editor navigation with dirty/error and review badges.
- Add validated read/edit plans, selectable generation steps and current host-side file permission checks.
- Preview accepted source replacements as Before/Proposed static import graphs without modifying buffers; show Applied graph after review.
- Prepare a report-backed repair question after diagnostics or test failure, requiring explicit submission.
- Cover task projection/persistence, plan permissions, preview cancellation and actual in-memory import analysis.

## 0.8.0

- Prepare a local context summary before submission; expose token estimates, excerpt ranges and truncated/omitted files.
- Group edits by file with bulk acceptance/rejection, accepted review progress and next-diff navigation. Report structured source conflicts without applying partial changes.

- Redesign the Assistant sidebar with Chat/Changes/Context tabs, direct Ask/Edit shortcuts, a bottom composer, optional source settings and keyboard-accessible resizing.

- Replace full-file AI replacements with validated range edits, exact original text and conservative conflict-aware rebasing.
- Review, accept/reject and Apply individual edits; preserve applied proposal status through graph refresh and sidebar remounts.
- Observe VS Code diagnostics, directed import deltas and static dependents after Apply; keep Apply successful when verification refresh fails.
- Run a user-selected root package test script in a cancellable VS Code task, with optional saving, exit status and bounded output.
- Keep verification local by default; explicitly include a current report and test log in the next Ask.
- Add range, partial Apply, diagnostics and real task integration coverage. Live-model workflow remains unavailable in the isolated profile; see docs/QA-v0.8.md.

## 0.7.0

- Add validated AI suggestions to request file/symbol context, focus files, show directed import paths, inspect declarations and analyze impact.
- Send a bounded, previewable graph metadata index for Ask; unselected source is never read automatically.
- Continue the current conversation when explicitly adding suggested context; stale suggestions are disabled and rejected by the host.
- Preserve the base layout with temporary file focus and support focus in navigation/Saved Views.
- Add action validation/regression coverage and an opt-in synthetic live AI workflow check.

## 0.6.0

- Add source-free model connection diagnostics and an opt-in live smoke test.
- Prioritize AST symbol/import excerpts for Ask, preserve original line ranges and show estimated/exact input usage; Edit uses full files.
- Keep bounded conversation history per file/symbol region through Refresh, with stale markers, Copy reply/code and inline Markdown citations.

- Redesign the AI composer with Ask/Edit tabs, a compact model picker, keyboard submit and Markdown replies (including GFM tables and code blocks).
- Prepare selected context automatically on Ask/Edit; manual Preview is optional.

- Add VS Code model selection and AI questions in the Context panel with streaming, cancellation, token checks and validated source references.
- Contribute architecture, dependency, reviewed-context and static-impact tools to VS Code Agent.
- Add structured proposals for existing context files, read-only VS Code diff previews and explicit Apply after all diffs are opened.
- Reject unknown/truncated proposal targets and conflicting editor changes; refresh the graph after unsaved edits are applied.
- Add fake-model unit/integration coverage; source previews remain local and AI sends only on user request.


## 0.5.0

- Add a temporary Architecture Overview canvas with module depth, entry candidates, most imported files and actual directed cycle groups.
- Navigate from modules to files while preserving the base graph layout; save/restore architecture views through history and Saved Views.
- Select working regions with Shift-click, add files via search/details and review optional direct dependency/dependent context.
- Preview current unsaved source, import bindings, declarations and scoped architecture notes; copy the reviewed context as Markdown locally.
- Bound preview source sizes, report truncation/read errors, validate graph IDs/root/revision and reject stale previews/copies.

## 0.4.0

- Add bounded Back/Forward history for graph selection, symbols and import/impact paths, including camera restoration.
- Save, open, rename, replace and delete named views per workspace root against freshly scanned source.
- Add architecture notes and role badges for files/folders without changing source or dependency data.
- Reconcile deleted targets and broken paths, retain orphan notes and anchor symbols by name/kind across source offsets.
- Validate stored UI metadata, cover persistence across panels and update performance baselines for this repo and 200/1,000-file fixtures.

## 0.3.0

- Highlight the active editor file, add Reveal Active File and persist optional Follow editor per root.
- Explain resolved import bindings with directed barrel routes and temporary path canvases.
- Explore top-level declarations on demand, open exact symbol locations and distinguish ownership connections from imports.
- Analyze potential file/symbol impact with dependency explanations, cycle handling and filtering of unrelated barrel exports.
- Preserve saved file/folder layouts while inspecting paths and symbol nodes.
- Refactor Webview presentation components and standardize source formatting with Prettier.

- Preview imported files and symbols inside collapsed folders for the selected file.
- Inspect directed file relationships, aliases and type-only imports by clicking edges.
- Peek only directly imported members while keeping other folder files grouped.
- Link static symbols to declarations through barrel exports; show declaration kinds and file symbol lists.

## 0.2.0

- Add file/folder views, folder depth, expand/collapse, directed aggregate edges, filters and 1–2 hop Focus.
- Restore per-root layouts, viewport, selection, filters and Auto Update through VS Code workspace state.
- Keep independent layouts/cameras for Files and each Folders depth; lay out new modes automatically and migrate older saved views.
- Prevent Refresh loops from duplicate metadata/document events; reuse metadata watchers and bound immediate refresh follow-ups.
- Update unsaved source and filesystem changes after a 750 ms debounce; cache parse/resolution results and suppress stale publications.
- Watch resolver metadata, including inherited configs outside the workspace; retain previous graphs on cancellation/errors.
- Match symlinked package targets to scanned file URIs.
- Add React/Node/monorepo regression fixtures, live watcher/persistence tests and 200/1,000-file performance baselines.

## 0.1.0

- Add **CodeMap: Open Graph**, source/import navigation and manual scanning of TS/JS dependency graphs.
