import { actionCatalog, type AiGraphAction } from '../../shared/ai-actions';
import { useContextPreview } from '../hooks/useContextPreview';
import { AiAssistant } from './AiAssistant';
import React, { useMemo, useRef, useState } from 'react';
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
  onAdd,
  onGraphAction,
  intent,
}: {
  intent?: { mode: 'ask' | 'propose'; id: string };
  snapshot: GraphSnapshot;
  selected: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
  sync: SyncState;
  selectedSymbol?: { nodeId: string; symbolId: string };
  onAdd: (ids: string[]) => void;
  onGraphAction: (action: AiGraphAction) => void;
}) {
  const [width, setWidth] = useState(420);
  const resize = useRef<{ x: number; width: number } | undefined>(undefined);
  const [added, setAdded] = useState<string[]>([]);
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
  const graphIndex = useMemo(
    () => (bundle ? actionCatalog(snapshot, bundle) : undefined),
    [snapshot, bundle],
  );
  const matches = snapshot.nodes
    .filter(
      (file) =>
        file.path.toLowerCase().includes(query.toLowerCase()) && !selected.includes(file.id),
    )
    .slice(0, 20);
  const contextContent = (
    <div className="assistant-context-content">
      <div className="assistant-section-intro">
        <strong>Source for this conversation</strong>
        <p className="helper-text">
          Choose which files the assistant can read. Nothing is sent until you submit.
        </p>
      </div>

      <p className="helper-text">
        Shift-click files or folders on the canvas to add/remove a region. Search here to add hidden
        files.
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
          <div className="context-file-row" key={file.id}>
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
          </div>
        ))}
      </div>
      {!candidates.length && (
        <p className="helper-text">Select files on the graph or add them above.</p>
      )}
      <details className="assistant-advanced">
        <summary>Source options & preview</summary>{' '}
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
        {!!added.length && (
          <p className="ai-context-added" role="status">
            Added to context: {added.join(', ')}. The next Ask reads fresh source; nothing was sent
            automatically.
          </p>
        )}
        <p className="helper-text">
          Ask also sends a bounded graph index of file paths, declaration names and import pairs to
          suggest what to explore. Source from unselected files is never read for that index.
        </p>
        {bundle && (
          <div className="context-preview">
            <h3>Preview · {bundle.files.length} files</h3>
            <p className="helper-text">
              {bundle.characters.toLocaleString()} source characters · ~
              {bundle.estimatedTokens?.toLocaleString()} source tokens (estimate) ·{' '}
              {bundle.mode ?? 'full'} · revision {bundle.revision}
            </p>
            <details className="context-source">
              <summary>Graph index · {graphIndex?.files.length} files · metadata only</summary>
              <p className="helper-text">
                Used for Ask suggestions; not source evidence. Up to 80 files and 200 import pairs.{' '}
                {graphIndex?.omitted} files omitted.
              </p>
              {graphIndex?.files.map((file) => (
                <p className="helper-text" key={file.path}>
                  {file.path}
                  {file.included ? ' · source included' : ' · source not included'}
                  {file.symbols.length ? ` · ${file.symbols.join(', ')}` : ''}
                </p>
              ))}
            </details>
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
      </details>
    </div>
  );
  return (
    <aside className="inspector assistant-panel" aria-label="CodeMap Assistant" style={{ width }}>
      <div
        className="assistant-resize"
        role="separator"
        aria-label="Resize assistant"
        aria-orientation="vertical"
        aria-valuemin={320}
        aria-valuemax={Math.max(320, Math.min(760, window.innerWidth - 180))}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          resize.current = { x: event.clientX, width };
        }}
        onPointerMove={(event) => {
          if (resize.current) {
            setWidth(
              Math.max(
                320,
                Math.min(
                  760,
                  window.innerWidth - 180,
                  resize.current.width + resize.current.x - event.clientX,
                ),
              ),
            );
          }
        }}
        onPointerUp={() => {
          resize.current = undefined;
        }}
        onPointerCancel={() => {
          resize.current = undefined;
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            setWidth((value) =>
              Math.max(
                320,
                Math.min(
                  760,
                  window.innerWidth - 180,
                  value + (event.key === 'ArrowLeft' ? 24 : -24),
                ),
              ),
            );
          }
        }}
      />
      <PanelHeading
        eyebrow="CodeMap"
        title="Assistant"
        action={
          <button className="icon-button" aria-label="Close assistant" onClick={onClose}>
            ×
          </button>
        }
      />
      <AiAssistant
        intent={intent}
        contextBundle={bundle}
        contextSummary={
          fileIds.length
            ? `${candidates.find((file) => file.id === fileIds[0])?.name ?? 'Selected source'}${fileIds.length > 1 ? ` + ${fileIds.length - 1} files` : ''}`
            : 'No files selected'
        }
        contextWarning={bundle?.warnings.join(' · ') ?? ''}
        contextContent={contextContent}
        onAction={(action) => {
          if (action.kind !== 'addContext') {
            onGraphAction(action);
            return;
          }
          const ids = action.targets.map((t) => t.fileId);
          onAdd(ids);
          setExcluded((current) => current.filter((id) => !ids.includes(id)));
          const target = action.targets.find((t) => t.symbol);
          if (target?.symbol) {
            const symbol = snapshot.nodes
              .find((n) => n.id === target.fileId)
              ?.declarations?.find((s) => s.id === target.symbol!.id);
            if (symbol) {
              setSymbolChoice(JSON.stringify([target.fileId, symbol.kind, symbol.name]));
              setFocused(true);
            }
          }
          setAdded(action.targets.map((t) => t.path));
        }}
        prepareContext={prepare}
        regionKey={regionKey}
        conversationKey={conversationKey}
        rootId={snapshot.root.id}
        revision={snapshot.revision}
        fileCount={fileIds.length}
        sync={sync}
      />
    </aside>
  );
}
