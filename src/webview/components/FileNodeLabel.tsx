import type { Annotation } from '../../shared/library';
import React from 'react';
import type { DisplayNode, FileNode } from '../../shared/model';

interface FileNodeLabelProps {
  badges?: string[];
  onReview?: () => void;
  onIssue?: () => void;
  annotation?: Annotation;
  node: DisplayNode;
  contextFile?: FileNode;
  filesById: Map<string, FileNode>;
  onPeek: (groupId: string) => void;
  onInspectImports: (groupId: string) => void;
}

export function FileNodeLabel({
  badges,
  onReview,
  onIssue,
  annotation,
  node,
  contextFile,
  filesById,
  onPeek,
  onInspectImports,
}: FileNodeLabelProps) {
  return (
    <div className="file-label">
      <strong>
        {node.kind === 'folder' ? '▣ ' : node.kind === 'symbol' ? '◇ ' : ''}
        {node.label}
        {annotation && (
          <span className="architecture-badge" title={annotation.text}>
            {annotation.role ?? 'Note'}
          </span>
        )}
      </strong>
      <small>
        {node.kind === 'folder'
          ? node.id.startsWith('boundary:')
            ? `${node.members.length} related files · outside task`
            : `${node.members.length} files · ${node.internalEdges} internal dependencies`
          : node.kind === 'symbol'
            ? node.path
            : node.path.includes('/')
              ? node.path.slice(0, node.path.lastIndexOf('/'))
              : '.'}
      </small>
      {!!badges?.length && (
        <div className="node-badges">
          {badges.map((b) => (
            <span key={b}>{b}</span>
          ))}
        </div>
      )}
      {onIssue && (
        <button
          className="nodrag nopan"
          onClick={(event) => {
            event.stopPropagation();
            onIssue();
          }}
        >
          Inspect failure ↗
        </button>
      )}
      {onReview && (
        <button
          className="nodrag nopan node-review"
          onClick={(e) => {
            e.stopPropagation();
            onReview();
          }}
        >
          Review next edit
        </button>
      )}
      {node.id.startsWith('boundary:') ? (
        <div className="folder-context">
          <small>Connected to this task through real imports.</small>
          {node.members.slice(0, 2).map((id) => (
            <div key={id} className="folder-import">
              <span>{filesById.get(id)?.name}</span>
            </div>
          ))}
          <button
            className="nodrag nopan"
            onClick={(e) => {
              e.stopPropagation();
              onPeek(node.id);
            }}
          >
            Add related files to task
          </button>
        </div>
      ) : (
        node.kind === 'folder' && (
          <div className="folder-context">
            {contextFile ? (
              <>
                <small>
                  {contextFile.name} imports {node.related?.length ?? 0}/{node.members.length} files
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
                      Show {node.related.length} related files
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
        )
      )}
    </div>
  );
}
