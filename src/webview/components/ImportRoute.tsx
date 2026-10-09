import React, { createContext, useContext } from 'react';
import type { FileNode, ImportedSymbol } from '../../shared/model';
import { send } from '../bridge';

export const ShowPathContext = createContext<(path: string[]) => void>(() => {});

export function ImportRoute({
  symbol,
  filesById,
}: {
  symbol: ImportedSymbol;
  filesById: Map<string, FileNode>;
}) {
  const showPath = useContext(ShowPathContext);
  if (!symbol.declaration) {
    return null;
  }
  return (
    <details className="import-route">
      <summary>Import route · {symbol.local}</summary>
      <p>
        <small>Declaration: {filesById.get(symbol.declaration.nodeId)?.path}</small>
      </p>
      {symbol.resolutionPath?.map((id, index) => (
        <React.Fragment key={`${index}:${id}`}>
          {index > 0 && <span aria-hidden="true"> → </span>}
          <button className="link inline" onClick={() => send({ type: 'openFile', nodeId: id })}>
            {filesById.get(id)?.path}
          </button>
        </React.Fragment>
      ))}
      {!!symbol.resolutionPath?.length && (
        <p>
          <button onClick={() => showPath(symbol.resolutionPath!)}>Show path on graph</button>
        </p>
      )}
    </details>
  );
}
