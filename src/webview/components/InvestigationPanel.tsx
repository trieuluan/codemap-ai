import React, { useMemo } from 'react';
import { send } from '../bridge';
import type { FileNode, GraphSnapshot } from '../../shared/model';
import { analyzeImpact, type ImpactTarget } from '../../shared/investigation';

interface InvestigationPanelProps {
  snapshot: GraphSnapshot;
  target: ImpactTarget;
  onClose: () => void;
  onShowPath: (path: string[]) => void;
  onSelectFile: (id: string) => void;
}

export function InvestigationPanel({
  snapshot,
  target,
  onClose,
  onShowPath,
  onSelectFile,
}: InvestigationPanelProps) {
  const filesById = useMemo(
    () => new Map(snapshot.nodes.map((node) => [node.id, node])),
    [snapshot],
  );
  const file = filesById.get(target.nodeId);
  const symbol = file?.declarations?.find((item) => item.id === target.symbolId);
  const entries = useMemo(() => analyzeImpact(snapshot, target), [snapshot, target]);
  return (
    <aside aria-label="Impact analysis">
      <button className="link" onClick={onClose}>
        ← Back to details
      </button>
      <h2>Potential impact</h2>
      <p className="path">
        {file?.path}
        {symbol ? ` · ${symbol.name}` : ''}
      </p>
      <p className="muted">
        Dependency reachability, not proof of runtime behavior or a function call.
      </p>
      {target.symbolId && (
        <p className="muted">
          Known static bindings and barrel routes, then file dependents of their consumers.
          Namespace access, computed exports and external consumers are not covered.
        </p>
      )}
      <p>
        {entries.filter((entry) => entry.direct).length}{' '}
        {target.symbolId ? 'known bindings' : 'direct dependents'} ·{' '}
        {entries.filter((entry) => !entry.direct).length} indirect files
      </p>
      {!entries.length && (
        <p className="muted">
          No {target.symbolId ? 'statically linked consumers' : 'dependents'} found in this
          workspace.
        </p>
      )}
      {entries.map((entry) => (
        <section className="dependency" key={entry.nodeId}>
          <button className="link" onClick={() => onSelectFile(entry.nodeId)}>
            {filesById.get(entry.nodeId)?.path}
          </button>
          <span className="badge">
            {entry.direct ? (target.symbolId ? 'binding' : 'direct') : 'indirect'}
          </span>
          <p className="path">
            {entry.path.map((id) => filesById.get(id)?.path ?? id).join(' → ')}
          </p>
          <button onClick={() => onShowPath(entry.path)}>Show path on graph</button>
        </section>
      ))}
    </aside>
  );
}

interface SymbolExplorerProps {
  file: FileNode;
  shown: boolean;
  onToggle: () => void;
  onImpact: (target: ImpactTarget) => void;
}

export function SymbolExplorer({ file, shown, onToggle, onImpact }: SymbolExplorerProps) {
  return (
    <section className="symbol-explorer" aria-label="Symbol explorer">
      <h3>
        Symbols <span>{file.declarations?.length ?? 0}</span>
      </h3>
      <p className="muted">
        Top-level declarations. Import bindings describe dependencies; no call graph is inferred.
      </p>
      {!!file.declarations?.length && (
        <button onClick={onToggle}>
          {shown ? 'Hide symbols on graph' : 'Show symbols on graph'}
        </button>
      )}
      {file.declarations?.map((symbol) => (
        <div className="dependency" key={symbol.id}>
          <span className="badge">{symbol.kind}</span>
          <button
            className="link"
            onClick={() => send({ type: 'openSymbol', nodeId: file.id, symbolId: symbol.id })}
          >
            {symbol.name} · L{symbol.line + 1} ↗
          </button>
          <button onClick={() => onImpact({ nodeId: file.id, symbolId: symbol.id })}>
            Analyze symbol impact
          </button>
        </div>
      ))}
      {!file.declarations?.length && <p className="muted">No supported top-level declarations.</p>}
    </section>
  );
}
