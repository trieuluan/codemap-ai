# CodeMap v0.2 performance baseline

Measured 2026-10-09T17:13:20.040Z on darwin arm64, Apple M4 Pro, Node v24.2.0. Single-run diagnostic measurements, not performance guarantees or CI thresholds.

| Fixture | Files / edges | Collect ms | Cold analysis ms | Unchanged ms | One edit ms | Parsed / resolved on edit | File layout ms | Folder layout ms (nodes) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| codemap-ai | 19 / 29 | 7.4 | 64.9 | 1.1 | 2.2 | 1 / 1 | 11.4 | 1.9 (9) |
| 200-file chain | 200 / 199 | 3.7 | 25.6 | 8.2 | 7.8 | 1 / 1 | 20.4 | 1.7 (10) |
| 1000-file chain | 1000 / 999 | 18.7 | 108.6 | 38.0 | 35.4 | 1 / 1 | 135.4 | 5.0 (50) |

Collection uses disk reads in this standalone benchmark, not VS Code document loading. Layout uses the same Dagre dimensions/options in Node; it excludes Webview rendering. Update times exclude the 750 ms debounce. Synthetic chains stress layout depth; 1,000 files is a stress fixture, not a support guarantee.
