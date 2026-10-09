import React from 'react';
import type { FileNode } from '../../shared/model';
import { send } from '../bridge';

interface GraphToolbarProps {
  workspaceName: string;
  query: string;
  matches: FileNode[];
  scanning: boolean;
  optionsOpen: boolean;
  hasPeek: boolean;
  hasNodes: boolean;
  onQueryChange: (query: string) => void;
  onSelectFile: (id: string) => void;
  onToggleOptions: () => void;
  onClosePeek: () => void;
  onFitView: () => void;
  onAutoLayout: () => void;
}

export function GraphToolbar({
  workspaceName,
  query,
  matches,
  scanning,
  optionsOpen,
  hasPeek,
  hasNodes,
  onQueryChange,
  onSelectFile,
  onToggleOptions,
  onClosePeek,
  onFitView,
  onAutoLayout,
}: GraphToolbarProps) {
  return (
    <header>
      <div className="brand">
        <strong>CodeMap</strong>
        <span>{workspaceName}</span>
      </div>
      <div className="search">
        <input
          aria-label="Find a file"
          placeholder="Find file by path…"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && matches[0]) {
              onSelectFile(matches[0].id);
              onQueryChange('');
            }
          }}
        />
        {query.trim() && (
          <div className="results">
            {matches.length ? (
              matches.slice(0, 30).map((node) => (
                <button
                  key={node.id}
                  onClick={() => {
                    onSelectFile(node.id);
                    onQueryChange('');
                  }}
                >
                  {node.path}
                </button>
              ))
            ) : (
              <span>No matching files</span>
            )}
            {matches.length > 30 && <span>{matches.length} matches — narrow your search</span>}
          </div>
        )}
      </div>
      <button disabled={scanning} onClick={() => send({ type: 'refresh' })}>
        Refresh
      </button>
      <button onClick={() => onToggleOptions()} aria-expanded={optionsOpen}>
        View Options
      </button>
      {hasPeek && <button onClick={() => onClosePeek()}>Close Peek</button>}
      <button disabled={!hasNodes} onClick={onFitView}>
        Fit View
      </button>
      <button disabled={!hasNodes} onClick={onAutoLayout}>
        Auto Layout
      </button>
    </header>
  );
}
