import React, { useState } from 'react';
import { PanelHeading, PanelSection, PanelTabs, ConnectionCard } from './InspectorParts';
import type {
  DependencyEdge,
  DisplayNode,
  FileNode,
  GraphSnapshot,
  GraphViewState,
} from '../../shared/model';
import { groupId } from '../../shared/view';
import { send } from '../bridge';
import type { ImpactTarget } from '../../shared/investigation';
import { SymbolExplorer } from './InvestigationPanel';
import { OutsideDependencies } from './OutsideDependencies';
import { ImportSiteDetails } from './ImportSiteDetails';

interface DetailsPanelProps {
  annotationEditor?: React.ReactNode;
  snapshot?: GraphSnapshot;
  view: GraphViewState;
  file?: FileNode;
  group?: DisplayNode;
  contextFile?: FileNode;
  filesById: Map<string, FileNode>;
  inspectedEdge?: { count: number; symbolCount?: number };
  inspectedImports: DependencyEdge[];
  outgoing: DependencyEdge[];
  incoming: DependencyEdge[];
  symbolsShown: boolean;
  onToggleSymbols: () => void;
  onImpact: (target: ImpactTarget) => void;
  onBack: () => void;
  onSelectFile: (id: string) => void;
  onPeek: (id: string) => void;
  onExpand: (id: string) => void;
  onCollapse: (id: string) => void;
}

export function DetailsPanel({
  annotationEditor,
  snapshot,
  view,
  file,
  group,
  contextFile,
  filesById,
  inspectedEdge,
  inspectedImports,
  outgoing,
  incoming,
  symbolsShown,
  onToggleSymbols,
  onImpact,
  onBack,
  onSelectFile,
  onPeek,
  onExpand,
  onCollapse,
}: DetailsPanelProps) {
  const [tab, setTab] = useState<'connections' | 'symbols' | 'notes'>('connections');
  const warnings =
    snapshot?.warnings.filter(
      (warning) => !file || !warning.fileId || warning.fileId === file.id,
    ) ?? [];
  return (
    <aside className="inspector" aria-label="Source details">
      {inspectedEdge ? (
        <>
          <PanelHeading
            eyebrow="Connection details"
            title="Import relationships"
            action={
              <button
                className="icon-button"
                title="Back to details"
                aria-label="Back to details"
                onClick={onBack}
              >
                ←
              </button>
            }
          />
          <div className="inspector-body">
            <div className="inspector-stats">
              <div>
                <strong>{inspectedEdge.count}</strong>
                <span>File relations</span>
              </div>
              <div>
                <strong>{inspectedEdge.symbolCount ?? 0}</strong>
                <span>Imported symbols</span>
              </div>
            </div>
            <p className="helper-text">A → B means A imports from B.</p>
            {inspectedImports.map((edge) => (
              <div key={edge.id}>
                <p className="connection-source">{filesById.get(edge.source)?.path} →</p>
                <ConnectionCard
                  edge={edge}
                  nodeId={edge.target}
                  filesById={filesById}
                  onSelectFile={onSelectFile}
                />
              </div>
            ))}
          </div>
        </>
      ) : group ? (
        <>
          <PanelHeading
            eyebrow="Folder details"
            title={group.path.split('/').at(-1) ?? group.path}
            subtitle={group.path}
          />
          <div className="inspector-body">
            <div className="inspector-stats">
              <div>
                <strong>{group.members.length}</strong>
                <span>Files</span>
              </div>
              <div>
                <strong>{group.internalEdges}</strong>
                <span>Internal imports</span>
              </div>
            </div>
            <div className="inspector-actions">
              <button className="primary" onClick={() => onExpand(group.id)}>
                Expand Folder
              </button>
              {!!group.related?.length && (
                <button onClick={() => onPeek(group.id)}>Peek {group.related.length} files</button>
              )}
            </div>
            {!!group.related?.length && (
              <PanelSection title={`Imported by ${contextFile?.name}`} count={group.related.length}>
                {group.related.map((item) => (
                  <div className="connection-card" key={item.fileId}>
                    <button className="file-row" onClick={() => onSelectFile(item.fileId)}>
                      <span className="file-row-text">
                        <strong>{filesById.get(item.fileId)?.name}</strong>
                        <small>{filesById.get(item.fileId)?.path}</small>
                      </span>
                    </button>
                    <details className="connection-imports">
                      <summary>Import details</summary>
                      {item.sites.map((site) => (
                        <ImportSiteDetails
                          key={site.id}
                          nodeId={contextFile!.id}
                          site={site}
                          filesById={filesById}
                        />
                      ))}
                    </details>
                  </div>
                ))}
              </PanelSection>
            )}
            <PanelSection
              title="Members"
              count={group.members.length}
              open={group.members.length <= 12}
            >
              {group.members.map((id) => (
                <button className="file-row" key={id} onClick={() => onSelectFile(id)}>
                  <span className="file-row-text">
                    <strong>{filesById.get(id)?.name}</strong>
                    <small>{filesById.get(id)?.path}</small>
                  </span>
                  <span aria-hidden="true">↗</span>
                </button>
              ))}
            </PanelSection>
            {annotationEditor}
          </div>
        </>
      ) : file ? (
        <>
          <PanelHeading
            eyebrow="File details"
            title={file.name}
            subtitle={file.path}
            action={
              <span className="badge">
                {file.language === 'typescript'
                  ? 'TS'
                  : file.language === 'javascript'
                    ? 'JS'
                    : file.language}
              </span>
            }
          />
          <div className="inspector-overview">
            <div className="inspector-stats">
              <div>
                <strong>{outgoing.length}</strong>
                <span>Imports</span>
              </div>
              <div>
                <strong>{incoming.length}</strong>
                <span>Used by</span>
              </div>
              <div>
                <strong>{file.declarations?.length ?? 0}</strong>
                <span>Symbols</span>
              </div>
            </div>
            <div className="inspector-actions">
              <button
                className="primary"
                onClick={() => send({ type: 'openFile', nodeId: file.id })}
              >
                Open Source ↗
              </button>
              <button onClick={() => onImpact({ nodeId: file.id })}>Analyze impact</button>
              {view.mode === 'folders' &&
                groupId(file, view.depth) &&
                view.expanded.includes(groupId(file, view.depth)!) && (
                  <button
                    className="quiet-button"
                    onClick={() => onCollapse(groupId(file, view.depth)!)}
                  >
                    Collapse Folder
                  </button>
                )}
            </div>
          </div>
          <PanelTabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'connections', label: 'Connections' },
              { id: 'symbols', label: 'Symbols', count: file.declarations?.length ?? 0 },
              { id: 'notes', label: 'Notes' },
            ]}
          />
          <div className="inspector-body" key={file.id}>
            {tab === 'connections' && (
              <>
                <PanelSection title="Imports" count={outgoing.length}>
                  {outgoing.length ? (
                    outgoing.map((edge) => (
                      <ConnectionCard
                        key={edge.id}
                        edge={edge}
                        nodeId={edge.target}
                        filesById={filesById}
                        onSelectFile={onSelectFile}
                      />
                    ))
                  ) : (
                    <p className="helper-text">No internal dependencies.</p>
                  )}
                </PanelSection>
                <PanelSection title="Used by" count={incoming.length}>
                  {incoming.length ? (
                    incoming.map((edge) => (
                      <ConnectionCard
                        key={edge.id}
                        edge={edge}
                        nodeId={edge.source}
                        filesById={filesById}
                        onSelectFile={onSelectFile}
                      />
                    ))
                  ) : (
                    <p className="helper-text">No internal dependents.</p>
                  )}
                </PanelSection>
                <PanelSection title="Outside graph" count={file.outside.length} open={false}>
                  <OutsideDependencies file={file} filesById={filesById} />
                </PanelSection>
              </>
            )}
            {tab === 'symbols' && (
              <SymbolExplorer
                file={file}
                shown={symbolsShown}
                onToggle={onToggleSymbols}
                onImpact={onImpact}
              />
            )}
            <div hidden={tab !== 'notes'}>{annotationEditor}</div>
          </div>
        </>
      ) : (
        <div className="inspector-empty">
          <span className="empty-mark" aria-hidden="true">
            ⌘
          </span>
          <h2>Explore your code</h2>
          <p>Select a file or folder to see connections, symbols and architecture notes.</p>
          <span className="legend">A → B: A imports from B</span>
        </div>
      )}
      {!!warnings.length && (
        <div className="inspector-body warnings">
          <PanelSection title="Scan warnings" count={warnings.length} open={false}>
            {warnings.map((warning, index) => (
              <p key={index}>
                {warning.fileId && (
                  <button className="link" onClick={() => onSelectFile(warning.fileId!)}>
                    {filesById.get(warning.fileId)?.path}
                  </button>
                )}
                {warning.message}
              </p>
            ))}
          </PanelSection>
        </div>
      )}
    </aside>
  );
}
