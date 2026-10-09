# CodeMap v0.5 performance baseline

Measured 2026-10-09T19:40:42.112Z on darwin arm64, Apple M4 Pro, Node v24.2.0. Single-run diagnostic measurements, not performance guarantees or CI thresholds.

| Fixture | Files / edges | Collect ms | Cold analysis ms | Unchanged ms | One edit ms | Parsed / resolved on edit | File layout ms | Folder layout ms (nodes) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| codemap-ai | 46 / 126 | 7.1 | 103.7 | 2.7 | 5.4 | 1 / 1 | 59.1 | 1.9 (9) |
| 200-file chain | 200 / 199 | 4.5 | 26.2 | 9.0 | 7.8 | 1 / 1 | 25.6 | 1.4 (10) |
| 1000-file chain | 1000 / 999 | 17.9 | 112.0 | 37.8 | 37.6 | 1 / 1 | 153.1 | 6.3 (50) |

| Fixture | Record 50 navigation visits ms | Reconcile saved view ms | Validate 50 saved views ms |
| --- | --- | --- | --- |
| codemap-ai | 1.5 | 0.5 | 0.8 |
| 200-file chain | 19.5 | 0.9 | 1.1 |
| 1000-file chain | 52.5 | 3.5 | 14.4 |

| Fixture | Architecture summary ms | Build up to 50 context files ms |
| --- | --- | --- |
| codemap-ai | 0.5 | 0.3 |
| 200-file chain | 0.3 | 0.2 |
| 1000-file chain | 1.8 | 0.9 |

Context source reads use in-memory fixture text; browser rendering, VS Code document loading and clipboard are excluded.

Collection uses disk reads in this standalone benchmark, not VS Code document loading. Layout uses the same Dagre dimensions/options in Node; it excludes Webview rendering. Update times exclude the 750 ms debounce. Synthetic chains stress layout depth; 1,000 files is a stress fixture, not a support guarantee.
