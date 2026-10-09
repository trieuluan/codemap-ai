import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { GraphSnapshot, HostMessage, SyncState } from '../../shared/model';
import { contextCandidates, contextLimits, type ContextBundle } from '../../shared/context';
import { PanelHeading, PanelSection } from './InspectorParts';
import { send } from '../bridge';

export function ContextPanel({
  snapshot,
  selected,
  onToggle,
  onClear,
  onClose,
  sync,
}: {
  snapshot: GraphSnapshot;
  selected: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
  sync: SyncState;
}) {
  const [query, setQuery] = useState('');
  const [dependencies, setDependencies] = useState(false);
  const [dependents, setDependents] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [bundle, setBundle] = useState<ContextBundle>();
  const [building, setBuilding] = useState(false);
  const [message, setMessage] = useState('');
  const request = useRef<string | undefined>(undefined);
  const candidates = useMemo(
    () => contextCandidates(snapshot, selected, dependencies, dependents),
    [snapshot, selected, dependencies, dependents],
  );
  const fileIds = candidates.filter((file) => !excluded.includes(file.id)).map((file) => file.id);
  const selectionKey = JSON.stringify(fileIds);
  useEffect(() => {
    request.current = undefined;
    setBundle(undefined);
    setBuilding(false);
    setMessage('');
  }, [snapshot.root.id, snapshot.revision, selectionKey]);
  useEffect(() => {
    const receive = (event: MessageEvent<HostMessage>) => {
      const value = event.data;
      if (value.type !== 'contextResult' && value.type !== 'contextCopied') {
        return;
      }
      if (value.rootId !== snapshot.root.id || value.requestId !== request.current) {
        return;
      }
      if (value.type === 'contextCopied') {
        setMessage('Copied to clipboard.');
        return;
      }
      setBuilding(false);
      setMessage(value.error ?? '');
      if (value.bundle?.revision === snapshot.revision) {
        setBundle(value.bundle);
      } else {
        setBundle(undefined);
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [snapshot.root.id, snapshot.revision]);
  const matches = snapshot.nodes
    .filter(
      (file) =>
        file.path.toLowerCase().includes(query.toLowerCase()) && !selected.includes(file.id),
    )
    .slice(0, 20);
  return (
    <aside className="inspector" aria-label="Context builder">
      <PanelHeading
        eyebrow="Working region"
        title="Build context"
        subtitle="Select files, review source, then copy locally."
        action={
          <button className="icon-button" aria-label="Close context" onClick={onClose}>
            ×
          </button>
        }
      />
      <div className="inspector-body">
        <p className="helper-text">
          Shift-click files or folders on the canvas to add/remove a region. Search here to add
          hidden files.
        </p>
        <input
          aria-label="Add context file"
          placeholder="Find a file to add…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <div className="context-results">
            {matches.map((file) => (
              <button
                className="file-row"
                key={file.id}
                onClick={() => {
                  onToggle(file.id);
                  setExcluded((ids) => ids.filter((id) => id !== file.id));
                  setQuery('');
                }}
              >
                <span className="file-row-text">
                  <strong>{file.name}</strong>
                  <small>{file.path}</small>
                </span>
                <span>+</span>
              </button>
            ))}
            {!matches.length && <p className="helper-text">No other matching files.</p>}
          </div>
        )}
        <div className="context-options">
          <label>
            <input
              type="checkbox"
              checked={dependencies}
              onChange={(e) => setDependencies(e.target.checked)}
            />
            Include direct dependencies
          </label>
          <label>
            <input
              type="checkbox"
              checked={dependents}
              onChange={(e) => setDependents(e.target.checked)}
            />
            Include direct dependents
          </label>
        </div>
        <div className="section-toolbar">
          <span className="eyebrow">
            {fileIds.length} included · {selected.length} selected
          </span>
          <button
            className="quiet-button"
            onClick={() => {
              onClear();
              setExcluded([]);
            }}
          >
            Clear
          </button>
        </div>
        <div className="context-file-list">
          {candidates.map((file) => (
            <label className="context-file-row" key={file.id}>
              <input
                type="checkbox"
                aria-label={`Include ${file.path}`}
                checked={!excluded.includes(file.id)}
                onChange={(e) =>
                  setExcluded((ids) =>
                    e.target.checked ? ids.filter((id) => id !== file.id) : [...ids, file.id],
                  )
                }
              />
              <span title={file.path}>{file.path}</span>
              <small>{selected.includes(file.id) ? 'selected' : 'related'}</small>
              <button
                className="icon-button"
                aria-label={`Remove ${file.path}`}
                onClick={() => {
                  setExcluded((ids) => [...ids, file.id]);
                  if (selected.includes(file.id)) {
                    onToggle(file.id);
                  }
                }}
              >
                ×
              </button>
            </label>
          ))}
        </div>
        {!candidates.length && (
          <p className="helper-text">Select files on the graph or add them above.</p>
        )}
        <p className="helper-text">
          Preview budget: {contextLimits.files} files, {contextLimits.perFile.toLocaleString()}{' '}
          characters/file, {contextLimits.total.toLocaleString()} total. Truncation is shown
          explicitly.
        </p>
        {sync !== 'up-to-date' && (
          <p className="context-warning">
            Graph is out of date. Refresh or wait for synchronization before building context.
          </p>
        )}
        <div className="form-actions">
          <button
            className="primary"
            disabled={!fileIds.length || building || sync !== 'up-to-date'}
            onClick={() => {
              const requestId = crypto.randomUUID();
              request.current = requestId;
              setBuilding(true);
              setBundle(undefined);
              setMessage('');
              send({
                type: 'buildContext',
                rootId: snapshot.root.id,
                revision: snapshot.revision,
                requestId,
                fileIds,
              });
            }}
          >
            {building ? 'Building…' : 'Preview context'}
          </button>
          <button
            disabled={!bundle?.files.length || sync !== 'up-to-date'}
            onClick={() => {
              if (request.current) {
                send({ type: 'copyContext', rootId: snapshot.root.id, requestId: request.current });
              }
            }}
          >
            Copy Markdown
          </button>
        </div>
        {message && (
          <p role="status" className="helper-text">
            {message}
          </p>
        )}
        {bundle && (
          <div className="context-preview">
            <h3>Preview · {bundle.files.length} files</h3>
            <p className="helper-text">
              {bundle.characters.toLocaleString()} source characters · revision {bundle.revision}
            </p>
            {bundle.warnings.map((warning, i) => (
              <p className="context-warning" key={i}>
                {warning}
              </p>
            ))}
            {bundle.files.map((file) => (
              <PanelSection title={file.path} key={file.id}>
                <p className="helper-text">
                  {file.imports.length} imports · {file.declarations?.length ?? 0} declarations ·{' '}
                  {file.notes.length} notes
                </p>
                {!!file.declarations?.length && (
                  <p className="helper-text">
                    Symbols:{' '}
                    {file.declarations
                      .map((symbol) => `${symbol.kind} ${symbol.name} · L${symbol.line + 1}`)
                      .join(', ')}
                  </p>
                )}
                {!!file.outside.length && (
                  <p className="helper-text">
                    Outside:{' '}
                    {file.outside
                      .map((item) => `${item.site.specifier} (${item.status})`)
                      .join(', ')}
                  </p>
                )}
                {!!file.dependents.length && (
                  <p className="helper-text">Used by: {file.dependents.join(', ')}</p>
                )}
                {file.imports.map((edge) => (
                  <p className="helper-text" key={edge.path}>
                    {edge.path} ·{' '}
                    {edge.sites
                      .flatMap((site) => site.symbols?.map((s) => s.local) ?? [])
                      .join(', ') || 'module import'}
                  </p>
                ))}
                {file.notes.map((note) => (
                  <p className="architecture-text" key={JSON.stringify(note.target)}>
                    <span className="badge">{note.role ?? 'Note'}</span> {note.text}
                  </p>
                ))}
                <details className="context-source">
                  <summary>Source {file.truncated ? '· truncated' : ''}</summary>
                  <pre>{file.content}</pre>
                </details>
              </PanelSection>
            ))}
          </div>
        )}
      </div>
      <div className="inspector-footnote">Local preview only · no network · no source changes</div>
    </aside>
  );
}
