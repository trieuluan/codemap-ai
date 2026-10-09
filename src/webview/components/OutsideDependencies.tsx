import React from 'react';
import type { FileNode, OutsideDependency } from '../../shared/model';
import { ImportSiteDetails } from './ImportSiteDetails';

const statusLabels = {
  external: 'External',
  excluded: 'Excluded',
  unresolved: 'Unresolved',
};
const statusDescriptions = {
  external: 'Package, built-in module or file outside this workspace.',
  excluded: 'Resolved to a file omitted by the graph filters.',
  unresolved: 'The source resolver could not locate this module.',
};

/** Group repeated imports without mixing resolver outcomes or losing source locations. */
export function OutsideDependencies({
  file,
  filesById,
}: {
  file: FileNode;
  filesById: Map<string, FileNode>;
}) {
  const groups = new Map<string, OutsideDependency[]>();
  for (const item of file.outside) {
    const key = JSON.stringify([item.site.specifier, item.status, item.resolvedPath]);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  if (!groups.size) {
    return <p className="helper-text">All imports stay inside this graph.</p>;
  }
  return (
    <div className="outside-dependencies">
      <p className="helper-text outside-intro">Imports without a node in this graph.</p>
      {[...groups.entries()].map(([key, items]) => {
        const { site, status, resolvedPath } = items[0];
        const symbols = [
          ...new Set(
            items.flatMap((item) => item.site.symbols?.map((symbol) => symbol.local) ?? []),
          ),
        ];
        return (
          <details className={`outside-card outside-${status}`} key={key}>
            <summary>
              <div className="outside-card-heading">
                <svg
                  className="outside-module-icon"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <path d="m12 3 9 5v8l-9 5-9-5V8l9-5Z M3 8l9 5 9-5 M12 13v8 M7.5 5.5l9 5" />
                </svg>
                <strong title={site.specifier}>{site.specifier}</strong>
                <span className="outside-status" title={statusDescriptions[status]}>
                  {statusLabels[status]}
                </span>
              </div>
              <div className="outside-card-preview">
                <span title={symbols.join(', ')}>
                  {symbols.length
                    ? symbols.slice(0, 3).join(', ') +
                      (symbols.length > 3 ? ` +${symbols.length - 3}` : '')
                    : 'Module import'}
                </span>
                <span>
                  {items.length === 1 ? `L${site.line + 1}` : `${items.length} locations`}
                </span>
                <span className="outside-chevron" aria-hidden="true">
                  ›
                </span>
              </div>
            </summary>
            <div className="outside-card-details">
              <p className="outside-explanation">{statusDescriptions[status]}</p>
              {resolvedPath && (
                <div className="resolved-location">
                  <span className="eyebrow">Resolved file</span>
                  <code>{resolvedPath}</code>
                </div>
              )}
              {items.map((item) => (
                <ImportSiteDetails
                  key={item.site.id}
                  nodeId={file.id}
                  site={item.site}
                  filesById={filesById}
                />
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}
