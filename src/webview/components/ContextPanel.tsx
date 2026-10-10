import { useContextPreview } from '../hooks/useContextPreview';
import { AiAssistant } from './AiAssistant';
import React, { useMemo, useState } from 'react';
import type { GraphSnapshot, SyncState } from '../../shared/model';
import { contextCandidates, contextLimits } from '../../shared/context';
import { PanelHeading, PanelSection } from './InspectorParts';
import { send } from '../bridge';

export function ContextPanel({
  snapshot,
  selected,
  onToggle,
  onClear,
  onClose,
  sync,
  selectedSymbol,
}: {
  snapshot: GraphSnapshot;
  selected: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
  sync: SyncState;
  selectedSymbol?: { nodeId: string; symbolId: string };
}) {
  const [focused, setFocused] = useState(true);
  const [symbolChoice, setSymbolChoice] = useState<string>();
  const [query, setQuery] = useState('');
  const [dependencies, setDependencies] = useState(false);
  const [dependents, setDependents] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([]);
  const candidates = useMemo(
    () => contextCandidates(snapshot, selected, dependencies, dependents),
    [snapshot, selected, dependencies, dependents],
  );
  const fileIds = candidates.filter((file) => !excluded.includes(file.id)).map((file) => file.id);
  const symbolOptions = snapshot.nodes
    .filter((n) => fileIds.includes(n.id))
    .flatMap((n) =>
      (n.declarations ?? []).map((s) => ({
        key: JSON.stringify([n.id, s.kind, s.name]),
        label: `${n.name} · ${s.name}`,
        nodeId: n.id,
        symbolId: s.id,
      })),
    );
  const focus =
    symbolChoice === undefined
      ? symbolOptions.find(
          (s) => s.nodeId === selectedSymbol?.nodeId && s.symbolId === selectedSymbol.symbolId,
        )
      : symbolOptions.find((s) => s.key === symbolChoice);
  const { bundle, building, message, contextId, regionKey, conversationKey, prepare } =
    useContextPreview(snapshot, fileIds, {
      mode: focused ? 'focused' : 'full',
      symbol: focus ? { nodeId: focus.nodeId, symbolId: focus.symbolId } : undefined,
    });
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
        subtitle="Choose a working region, then ask AI. Preview is optional."
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
        <div className="context-strategy">
          <label>
            Source context
            <select
              aria-label="Source context strategy"
              value={focused ? 'focused' : 'full'}
              onChange={(e) => setFocused(e.target.value === 'focused')}
            >
              <option value="focused">Focused excerpts</option>
              <option value="full">Whole files</option>
            </select>
          </label>
          {!!symbolOptions.length && (
            <label>
              Prioritize symbol
              <select
                aria-label="Prioritize context symbol"
                value={focus?.key ?? ''}
                onChange={(e) => setSymbolChoice(e.target.value)}
              >
                <option value="">Region overview</option>
                {symbolOptions.map((symbol) => (
                  <option key={symbol.key} value={symbol.key}>
                    {symbol.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="helper-text">
            Ask uses relevant declarations and imports. Edit always prepares whole files. Related
            files are included only when selected above.
          </p>
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
              void prepare().catch(() => {});
            }}
          >
            {building ? 'Building…' : 'Preview context'}
          </button>
          <button
            disabled={!bundle?.files.length || sync !== 'up-to-date'}
            onClick={() => {
              if (contextId) {
                send({ type: 'copyContext', rootId: snapshot.root.id, requestId: contextId });
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
        <AiAssistant
          prepareContext={prepare}
          regionKey={regionKey}
          conversationKey={conversationKey}
          rootId={snapshot.root.id}
          revision={snapshot.revision}
          fileCount={fileIds.length}
          sync={sync}
        />
        {bundle && (
          <div className="context-preview">
            <h3>Preview · {bundle.files.length} files</h3>
            <p className="helper-text">
              {bundle.characters.toLocaleString()} source characters · ~
              {bundle.estimatedTokens?.toLocaleString()} source tokens (estimate) ·{' '}
              {bundle.mode ?? 'full'} · revision {bundle.revision}
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
                  {file.excerpts ? (
                    <>
                      <p className="helper-text">Focused source; other lines omitted.</p>
                      {file.excerpts.map((excerpt) => (
                        <div key={excerpt.startLine}>
                          <small>
                            L{excerpt.startLine}–L{excerpt.endLine}
                          </small>
                          <pre>{excerpt.content}</pre>
                        </div>
                      ))}
                    </>
                  ) : (
                    <pre>{file.content}</pre>
                  )}
                </details>
              </PanelSection>
            ))}
          </div>
        )}
      </div>
      <div className="inspector-footnote">
        Preview stays local · AI sends only on request · edits require Apply
      </div>
    </aside>
  );
}
