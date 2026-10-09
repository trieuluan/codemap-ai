import React, { useMemo } from 'react';
import type { DisplayNode, GraphSnapshot } from '../../shared/model';
import { architectureOverview } from '../../shared/architecture';
import { PanelHeading, PanelSection } from './InspectorParts';

export function ArchitecturePanel({
  snapshot,
  depth,
  onDepth,
  onExplore,
  onSelectFile,
  onClose,
}: {
  snapshot: GraphSnapshot;
  depth: number;
  onDepth: (depth: number) => void;
  onExplore: (path: string) => void;
  onSelectFile: (id: string) => void;
  onClose: () => void;
}) {
  const overview = useMemo(() => architectureOverview(snapshot, depth), [snapshot, depth]);
  const files = new Map(snapshot.nodes.map((n) => [n.id, n]));
  return (
    <aside className="inspector" aria-label="Architecture overview">
      <PanelHeading
        eyebrow="Workspace architecture"
        title={snapshot.root.name}
        subtitle="Modules and their real import relationships."
        action={
          <button className="icon-button" aria-label="Close overview" onClick={onClose}>
            ×
          </button>
        }
      />
      <div className="inspector-body">
        <div className="inspector-stats">
          <div>
            <strong>{snapshot.nodes.length}</strong>
            <span>Files</span>
          </div>
          <div>
            <strong>{overview.modules.length}</strong>
            <span>Modules</span>
          </div>
          <div>
            <strong>{overview.cycles.length}</strong>
            <span>Cycle groups</span>
          </div>
        </div>
        <label className="architecture-depth">
          Module depth
          <select
            aria-label="Module depth"
            value={depth}
            onChange={(e) => onDepth(Number(e.target.value))}
          >
            {Array.from(
              { length: Math.max(1, ...snapshot.nodes.map((n) => n.path.split('/').length - 1)) },
              (_, i) => (
                <option key={i} value={i + 1}>
                  {i + 1}
                </option>
              ),
            )}
          </select>
        </label>
        <PanelSection title="Modules" count={overview.modules.length}>
          {overview.modules.map((module) => (
            <button
              className="module-row"
              key={module.id}
              onClick={() =>
                module.kind === 'file' ? onSelectFile(module.id) : onExplore(module.path)
              }
            >
              <strong>{module.path}</strong>
              <small>
                {module.members.length} files · {module.incoming} in / {module.outgoing} out
              </small>
              <span aria-hidden="true">↗</span>
            </button>
          ))}
        </PanelSection>
        <PanelSection title="Entry candidates" count={overview.entries.length}>
          <p className="helper-text">
            No internal importers and at least one import; tests excluded. These may not be runtime
            entry points.
          </p>
          {overview.entries.slice(0, 10).map((item) => (
            <button
              className="file-row"
              key={item.file.id}
              onClick={() => onSelectFile(item.file.id)}
            >
              <span className="file-row-text">
                <strong>{item.file.name}</strong>
                <small>
                  {item.file.path} · {item.outgoing} imports
                </small>
              </span>
            </button>
          ))}
          {!overview.entries.length && <p className="helper-text">No candidates found.</p>}
        </PanelSection>
        <PanelSection title="Most imported files" count={overview.central.length}>
          {overview.central.slice(0, 10).map((item) => (
            <button
              className="file-row"
              key={item.file.id}
              onClick={() => onSelectFile(item.file.id)}
            >
              <span className="file-row-text">
                <strong>{item.file.name}</strong>
                <small>{item.file.path}</small>
              </span>
              <span className="badge">{item.incoming} users</span>
            </button>
          ))}
        </PanelSection>
        <PanelSection
          title="Dependency cycles"
          count={overview.cycles.length}
          open={!!overview.cycles.length}
        >
          <p className="helper-text">
            Includes type-only imports. Cycle groups describe dependency reachability, not runtime
            execution.
          </p>
          {overview.cycles.slice(0, 20).map((cycle, i) => (
            <details className="cycle-card" key={JSON.stringify(cycle)}>
              <summary>
                Cycle group {i + 1} · {cycle.length} files
              </summary>
              {cycle.map((id) => (
                <button className="link" key={id} onClick={() => onSelectFile(id)}>
                  {files.get(id)?.path}
                </button>
              ))}
            </details>
          ))}
          {!overview.cycles.length && (
            <p className="helper-text">No directed import cycles found.</p>
          )}
        </PanelSection>
      </div>
    </aside>
  );
}

export function ArchitectureNodeLabel({
  node,
  incoming,
  outgoing,
}: {
  node: DisplayNode;
  incoming: number;
  outgoing: number;
}) {
  return (
    <div className="architecture-node-label">
      <span className="eyebrow">{node.kind === 'folder' ? 'Module' : 'Root file'}</span>
      <strong title={node.path}>{node.path}</strong>
      <small>
        {node.members.length} files · {incoming} in / {outgoing} out
      </small>
    </div>
  );
}
