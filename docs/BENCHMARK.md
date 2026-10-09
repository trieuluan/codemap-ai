# CodeMap v0.4 performance baseline

Measured 2026-10-09T18:23:03.827Z on darwin arm64, Apple M4 Pro, Node v24.2.0. Single-run diagnostic measurements, not performance guarantees or CI thresholds.

| Fixture | Files / edges | Collect ms | Cold analysis ms | Unchanged ms | One edit ms | Parsed / resolved on edit | File layout ms | Folder layout ms (nodes) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| codemap-ai | 39 / 98 | 6.6 | 87.4 | 2.1 | 3.6 | 1 / 1 | 37.2 | 1.9 (9) |
| 200-file chain | 200 / 199 | 4.1 | 25.9 | 8.2 | 8.0 | 1 / 1 | 25.2 | 1.5 (10) |
| 1000-file chain | 1000 / 999 | 18.1 | 116.1 | 38.5 | 37.3 | 1 / 1 | 135.6 | 6.0 (50) |

| Fixture | Record 50 navigation visits ms | Reconcile saved view ms | Validate 50 saved views ms |
| --- | --- | --- | --- |
| codemap-ai | 1.3 | 0.4 | 0.7 |
| 200-file chain | 17.7 | 0.7 | 4.2 |
| 1000-file chain | 27.5 | 1.9 | 9.2 |

Collection uses disk reads in this standalone benchmark, not VS Code document loading. Layout uses the same Dagre dimensions/options in Node; it excludes Webview rendering. Update times exclude the 750 ms debounce. Synthetic chains stress layout depth; 1,000 files is a stress fixture, not a support guarantee.
