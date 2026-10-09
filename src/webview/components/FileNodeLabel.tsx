import React from 'react';
import type { DisplayNode, FileNode } from '../../shared/model';

interface FileNodeLabelProps {
  node: DisplayNode;
  contextFile?: FileNode;
  filesById: Map<string, FileNode>;
  onPeek: (groupId: string) => void;
  onInspectImports: (groupId: string) => void;
}

export function FileNodeLabel({
  node,
  contextFile,
  filesById,
  onPeek,
  onInspectImports,
}: FileNodeLabelProps) {
  return (
    <div className="file-label">
      <strong>
        {node.kind === 'folder' ? '▣ ' : ''}
        {node.label}
      </strong>
      <small>
        {node.kind === 'folder'
          ? `${node.members.length} files · ${node.internalEdges} internal dependencies`
          : node.path.includes('/')
            ? node.path.slice(0, node.path.lastIndexOf('/'))
            : '.'}
      </small>
      {node.kind === 'folder' && (
        <div className="folder-context">
          {contextFile ? (
            <>
              <small>
                Imported by {contextFile.name}: {node.related?.length ?? 0} files
              </small>
              {node.related?.slice(0, 2).map((item) => (
                <div className="folder-import" key={item.fileId}>
                  <span>{filesById.get(item.fileId)?.name}</span>
                  <small>
                    {item.sites
                      .flatMap(
                        (site) =>
                          site.symbols?.map(
                            (symbol) => `${symbol.typeOnly ? 'type ' : ''}${symbol.local}`,
                          ) ?? [],
                      )
                      .join(', ') || 'Module import'}
                  </small>
                </div>
              ))}
              {(node.related?.length ?? 0) > 2 && (
                <small>+{node.related!.length - 2} more files</small>
              )}
              {!!node.related?.length && (
                <div className="node-actions nodrag nopan">
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      onPeek(node.id);
                    }}
                  >
                    Peek {node.related.length} files
                  </button>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      onInspectImports(node.id);
                    }}
                  >
                    View imports
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="muted">Select a file to preview its imports here.</p>
          )}
        </div>
      )}
    </div>
  );
}
