# Change Log

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
