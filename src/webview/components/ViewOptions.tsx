import React from 'react';
import type { GraphViewState } from '../../shared/model';
import { send } from '../bridge';

interface ViewOptionsProps {
  view: GraphViewState;
  folders: string[];
  maxDepth: number;
  hasSelectedFile: boolean;
  hasPeek: boolean;
  onChangeLayout: (mode: GraphViewState['mode'], depth?: number) => void;
  onUpdateView: (patch: Partial<GraphViewState>) => void;
  onCollapseAll: () => void;
  onResetFilters: () => void;
}

export function ViewOptions({
  view,
  folders,
  maxDepth,
  hasSelectedFile,
  hasPeek,
  onChangeLayout,
  onUpdateView,
  onCollapseAll,
  onResetFilters,
}: ViewOptionsProps) {
  return (
    <section className="view-options" aria-label="View Options">
      <label>
        Mode{' '}
        <select
          aria-label="Graph mode"
          value={view.mode}
          onChange={(event) => onChangeLayout(event.target.value as GraphViewState['mode'])}
        >
          <option value="files">Files</option>
          <option value="folders">Folders</option>
        </select>
      </label>
      {view.mode === 'folders' && (
        <>
          <label>
            Depth{' '}
            <select
              aria-label="Folder depth"
              value={view.depth}
              onChange={(event) => onChangeLayout('folders', Number(event.target.value))}
            >
              {Array.from({ length: maxDepth }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
          <button disabled={!view.expanded.length && !hasPeek} onClick={onCollapseAll}>
            Collapse All
          </button>
        </>
      )}
      <label>
        Folder{' '}
        <select
          aria-label="Filter folder"
          value={view.folder}
          onChange={(event) => onUpdateView({ folder: event.target.value, focus: 0 })}
        >
          <option value="">All folders</option>
          {folders.map((folder) => (
            <option key={folder}>{folder}</option>
          ))}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={view.hideTests}
          onChange={(event) => onUpdateView({ hideTests: event.target.checked })}
        />
        Hide tests
      </label>
      <label>
        <input
          type="checkbox"
          checked={view.hideIsolated}
          onChange={(event) => onUpdateView({ hideIsolated: event.target.checked })}
        />
        Hide isolated files
      </label>
      <label>
        Focus{' '}
        <select
          aria-label="Focus distance"
          value={view.focus}
          onChange={(event) => onUpdateView({ focus: Number(event.target.value) as 0 | 1 | 2 })}
        >
          <option value="0">Off</option>
          <option value="1" disabled={!hasSelectedFile}>
            1 hop
          </option>
          <option value="2" disabled={!hasSelectedFile}>
            2 hops
          </option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={view.autoUpdate}
          onChange={(event) => {
            onUpdateView({ autoUpdate: event.target.checked });
            send({ type: 'autoUpdate', enabled: event.target.checked });
          }}
        />
        Auto Update
      </label>
      <button onClick={onResetFilters}>Reset Filters</button>
      <button onClick={() => send({ type: 'resetView' })}>Reset View</button>
      <button onClick={() => send({ type: 'changeFolder' })}>Change Folder</button>
    </section>
  );
}
