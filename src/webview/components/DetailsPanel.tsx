import React from 'react';
import type {
  DependencyEdge,
  DisplayNode,
  FileNode,
  GraphSnapshot,
  GraphViewState,
} from '../../shared/model';
import { groupId } from '../../shared/view';
import { send } from '../bridge';
import { ImportSiteDetails } from './ImportSiteDetails';

interface DetailsPanelProps {
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
  onBack: () => void;
  onSelectFile: (id: string) => void;
  onPeek: (id: string) => void;
  onExpand: (id: string) => void;
  onCollapse: (id: string) => void;
}

export function DetailsPanel({
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
  onBack,
  onSelectFile,
  onPeek,
  onExpand,
  onCollapse,
}: DetailsPanelProps) {
  return (
    <aside>
      {inspectedEdge ? (
        <>
          <button className="link" onClick={() => onBack()}>
            ← Back
          </button>
          <h2>Import relationships</h2>
          <p>
            {inspectedEdge.count} file relationships · {inspectedEdge.symbolCount ?? 0} imported
            symbols
          </p>
          <p className="muted">Imports describe dependencies, not proof of a function call.</p>
          {inspectedImports.map((edge) => (
            <div className="dependency" key={edge.id}>
              <small>{filesById.get(edge.source)?.path} →</small>
              <button className="link" onClick={() => onSelectFile(edge.target)}>
                {filesById.get(edge.target)?.path}
              </button>
              {edge.sites.map((site) => (
                <ImportSiteDetails
                  key={site.id}
                  nodeId={edge.source}
                  site={site}
                  filesById={filesById}
                />
              ))}
            </div>
          ))}
        </>
      ) : group ? (
        <>
          <h2>{group.path}</h2>
          <p>
            {group.members.length} files · {group.internalEdges} internal dependencies
          </p>
          {!!group.related?.length && (
            <>
              <h3>Imported by {contextFile?.name}</h3>
              {group.related.map((item) => (
                <div className="dependency" key={item.fileId}>
                  <button className="link" onClick={() => onSelectFile(item.fileId)}>
                    {filesById.get(item.fileId)?.path}
                  </button>
                  {item.sites.map((site) => (
                    <ImportSiteDetails
                      key={site.id}
                      nodeId={contextFile!.id}
                      site={site}
                      filesById={filesById}
                    />
                  ))}
                </div>
              ))}
              <button onClick={() => onPeek(group.id)}>
                Peek {group.related.length} related files
              </button>
            </>
          )}
          <p>
            <button className="primary" onClick={() => onExpand(group.id)}>
              Expand Folder
            </button>
          </p>
          <h3>Members</h3>
          {group.members.map((id) => (
            <button className="link" key={id} onClick={() => onSelectFile(id)}>
              {filesById.get(id)?.path}
            </button>
          ))}
        </>
      ) : file ? (
        <>
          <h2>{file.name}</h2>
          <p className="path">{file.path}</p>
          <span className="badge">{file.language}</span>
          <p>
            <button className="primary" onClick={() => send({ type: 'openFile', nodeId: file.id })}>
              Open Source
            </button>
          </p>
          {view.mode === 'folders' &&
            groupId(file, view.depth) &&
            view.expanded.includes(groupId(file, view.depth)!) && (
              <button onClick={() => onCollapse(groupId(file, view.depth)!)}>
                Collapse Folder
              </button>
            )}
          {!!file.declarations?.length && (
            <details>
              <summary>Declared symbols · {file.declarations.length}</summary>
              {file.declarations.map((symbol) => (
                <div className="symbol-row" key={symbol.id}>
                  <span className="badge">{symbol.kind}</span>
                  <span>{symbol.name}</span>
                  <small>L{symbol.line + 1}</small>
                </div>
              ))}
            </details>
          )}
          <h3>
            Dependencies <span>{outgoing.length}</span>
          </h3>
          {outgoing.length ? (
            outgoing.map((edge) => (
              <div className="dependency" key={edge.id}>
                <button className="link" onClick={() => onSelectFile(edge.target)}>
                  {filesById.get(edge.target)?.path}
                </button>
                {edge.sites.map((site) => (
                  <ImportSiteDetails
                    key={site.id}
                    nodeId={file.id}
                    site={site}
                    filesById={filesById}
                  />
                ))}
              </div>
            ))
          ) : (
            <p className="muted">No internal dependencies.</p>
          )}
          <h3>
            Dependents <span>{incoming.length}</span>
          </h3>
          {incoming.length ? (
            incoming.map((edge) => (
              <div className="dependency" key={edge.id}>
                <button className="link" onClick={() => onSelectFile(edge.source)}>
                  {filesById.get(edge.source)?.path}
                </button>
                {edge.sites.map((site) => (
                  <ImportSiteDetails
                    key={site.id}
                    nodeId={edge.source}
                    site={site}
                    filesById={filesById}
                  />
                ))}
              </div>
            ))
          ) : (
            <p className="muted">No internal dependents.</p>
          )}
          <h3>
            Outside graph <span>{file.outside.length}</span>
          </h3>
          {file.outside.map((item) => (
            <div className="dependency" key={item.site.id}>
              <span className={`badge ${item.status}`}>{item.status}</span>
              {
                <ImportSiteDetails
                  key={item.site.id}
                  nodeId={file.id}
                  site={item.site}
                  filesById={filesById}
                />
              }
              {item.resolvedPath && <small className="path">{item.resolvedPath}</small>}
            </div>
          ))}
        </>
      ) : (
        <>
          <h2>Explore your workspace</h2>
          <p className="muted">Select a file or folder to inspect its dependencies.</p>
          <p className="legend">A → B: A imports or re-exports B</p>
          <p className="muted">
            View Options groups folders, filters files and focuses your exploration. Auto Update
            follows unsaved source changes.
          </p>
        </>
      )}
      {!!snapshot?.warnings.length && (
        <section className="warnings">
          <h3>
            Scan warnings <span>{snapshot.warnings.length}</span>
          </h3>
          {snapshot.warnings
            .filter((warning) => !file || !warning.fileId || warning.fileId === file.id)
            .map((warning, index) => (
              <p key={index}>
                {warning.fileId && (
                  <button className="link" onClick={() => onSelectFile(warning.fileId!)}>
                    {filesById.get(warning.fileId)?.path}
                  </button>
                )}
                {warning.message}
              </p>
            ))}
        </section>
      )}
    </aside>
  );
}
