import React from 'react';
import type { FileNode, ImportSite } from '../../shared/model';
import { send } from '../bridge';

interface ImportSiteDetailsProps {
  nodeId: string;
  site: ImportSite;
  filesById: Map<string, FileNode>;
}

export function ImportSiteDetails({ nodeId, site, filesById }: ImportSiteDetailsProps) {
  return (
    <div key={site.id}>
      <button
        className="site"
        onClick={() => send({ type: 'openImport', nodeId, siteId: site.id })}
      >
        L{site.line + 1} · {site.kind} · {site.specifier}
      </button>
      {site.symbols?.map((symbol) => (
        <div className="symbol-row" key={symbol.id}>
          <span className="badge">
            {symbol.typeOnly ? 'type · ' : ''}
            {symbol.kind ?? symbol.form}
          </span>
          <span>
            {symbol.imported}
            {symbol.local !== symbol.imported ? ` → ${symbol.local}` : ''}
          </span>
          {symbol.declaration && (
            <button
              className="link"
              title={`Open declaration in ${filesById.get(symbol.declaration.nodeId)?.path}`}
              onClick={() =>
                send({ type: 'openDeclaration', nodeId, siteId: site.id, symbolId: symbol.id })
              }
            >
              Declaration ↗
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
