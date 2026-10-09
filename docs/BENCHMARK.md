# CodeMap v0.2 performance baseline

Measured 2026-10-09T16:34:08.031Z on darwin arm64, Apple M4 Pro, Node v24.2.0. Single-run diagnostic measurements, not performance guarantees or CI thresholds.

| Fixture | Files / edges | Collect ms | Cold analysis ms | Unchanged ms | One edit ms | Parsed / resolved on edit | File layout ms | Folder layout ms (nodes) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| codemap-ai | 18 / 27 | 6.2 | 50.8 | 0.8 | 2.2 | 1 / 1 | 8.8 | 1.7 (9) |
| 200-file chain | 200 / 199 | 3.8 | 25.1 | 7.8 | 8.2 | 1 / 1 | 21.7 | 1.5 (10) |
| 1000-file chain | 1000 / 999 | 17.2 | 112.5 | 36.5 | 35.9 | 1 / 1 | 132.5 | 5.1 (50) |

Collection uses disk reads in this standalone benchmark, not VS Code document loading. Layout uses the same Dagre dimensions/options in Node; it excludes Webview rendering. Update times exclude the 750 ms debounce. Synthetic chains stress layout depth; 1,000 files is a stress fixture, not a support guarantee.
