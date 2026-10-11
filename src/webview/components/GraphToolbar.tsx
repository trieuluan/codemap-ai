import React, { useEffect, useRef } from 'react';
import type { FileNode } from '../../shared/model';
import { send } from '../bridge';

interface GraphToolbarProps {
  taskActive: boolean;
  canWork: boolean;
  onWork?: () => void;
  onOverview: () => void;
  onContext: () => void;
  contextCount: number;
  hasSnapshot: boolean;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onLibrary: () => void;
  workspaceName: string;
  query: string;
  matches: FileNode[];
  scanning: boolean;
  optionsOpen: boolean;
  hasPeek: boolean;
  hasNodes: boolean;
  hasActiveFile: boolean;
  onQueryChange: (query: string) => void;
  onSelectFile: (id: string) => void;
  onToggleOptions: () => void;
  onClosePeek: () => void;
  onFitView: () => void;
  onAutoLayout: () => void;
}

export function GraphToolbar({
  taskActive,
  canWork,
  onWork,
  onOverview,
  onContext,
  contextCount,
  hasSnapshot,
  canBack,
  canForward,
  onBack,
  onForward,
  onLibrary,
  workspaceName,
  query,
  matches,
  scanning,
  optionsOpen,
  hasPeek,
  hasNodes,
  hasActiveFile,
  onQueryChange,
  onSelectFile,
  onToggleOptions,
  onClosePeek,
  onFitView,
  onAutoLayout,
}: GraphToolbarProps) {
  const more = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (more.current && !more.current.contains(event.target as Node)) {
        more.current.open = false;
      }
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);
  return (
    <header className="graph-toolbar">
      <nav className="graph-navigation" aria-label="Graph navigation">
        <button aria-label="Navigate back" disabled={!canBack} onClick={onBack}>
          ←
        </button>
        <button aria-label="Navigate forward" disabled={!canForward} onClick={onForward}>
          →
        </button>
        <button disabled={!hasSnapshot} onClick={onOverview}>
          Overview
        </button>
        <button disabled={!hasSnapshot} onClick={onContext}>
          Assistant{contextCount ? ` (${contextCount})` : ''}
        </button>
        <button onClick={onLibrary}>Saved Views</button>
        {onWork && (
          <button
            disabled={!hasSnapshot || !canWork}
            title={canWork ? 'Create a task from selected files' : 'Select a file or folder first'}
            onClick={onWork}
          >
            Work on this
          </button>
        )}
      </nav>
      <div className="brand">
        <strong>CodeMap</strong>
        <span title={workspaceName}>{workspaceName}</span>
      </div>
      <div className="search">
        <input
          aria-label="Find a file"
          placeholder="Find file by path…"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              onQueryChange('');
            }
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
      <div className="graph-actions">
        <button disabled={scanning} onClick={() => send({ type: 'refresh' })}>
          {scanning ? 'Refreshing…' : 'Refresh'}
        </button>
        <button
          disabled={taskActive}
          title={
            taskActive
              ? 'Return to Full graph to change filters and folder display'
              : 'Configure graph display'
          }
          onClick={() => onToggleOptions()}
          aria-expanded={!taskActive && optionsOpen}
        >
          View Options
        </button>
        {hasPeek && <button onClick={() => onClosePeek()}>Close Peek</button>}
        <details
          className="graph-more"
          ref={more}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && more.current) {
              more.current.open = false;
              more.current.querySelector('summary')?.focus();
            }
          }}
        >
          <summary>More</summary>
          <div
            className="graph-more-menu"
            onClick={(event) => {
              if ((event.target as HTMLElement).closest('button')) {
                event.currentTarget.parentElement?.removeAttribute('open');
              }
            }}
          >
            <button disabled={!hasActiveFile} onClick={() => send({ type: 'revealActiveFile' })}>
              Reveal Active File
            </button>
            <button disabled={!hasNodes} onClick={onFitView}>
              Fit View
            </button>
            <button disabled={!hasNodes} onClick={onAutoLayout}>
              Auto Layout
            </button>
          </div>
        </details>
      </div>
    </header>
  );
}
