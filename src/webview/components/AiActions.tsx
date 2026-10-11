import React from 'react';
import type { AiGraphAction } from '../../shared/ai-actions';

const titles = {
  addContext: 'Read more source',
  focus: 'Focus files',
  path: 'Show import path',
  inspect: 'Inspect symbol',
  impact: 'Analyze impact',
};
export function AiActions({
  actions,
  warnings,
  disabled,
  pending,
  onRun,
}: {
  actions?: AiGraphAction[];
  warnings?: string[];
  disabled: boolean;
  pending?: string;
  onRun: (action: AiGraphAction) => void;
}) {
  if (!actions?.length && !warnings?.length) {
    return null;
  }
  return (
    <div className="ai-graph-actions" aria-label="Suggested graph actions">
      {!!actions?.length && <span className="eyebrow">Explore next · {actions.length}</span>}
      {actions?.map((action) => {
        const targets =
          action.kind === 'addContext'
            ? action.targets.map((t) => t.path + (t.symbol ? ` · ${t.symbol.name}` : ''))
            : action.kind === 'focus' || action.kind === 'path'
              ? action.paths
              : [
                  action.target.path +
                    (action.target.symbol ? ` · ${action.target.symbol.name}` : ''),
                ];
        return (
          <article key={action.id} className="ai-action-card">
            <strong>{titles[action.kind]}</strong>
            <p>{action.reason}</p>
            <ul>
              {targets.map((path) => (
                <li key={path} title={path}>
                  {path}
                </li>
              ))}
            </ul>
            <button disabled={disabled || !!pending} onClick={() => onRun(action)}>
              {pending === action.id
                ? 'Opening…'
                : action.kind === 'addContext'
                  ? 'Add to context'
                  : titles[action.kind]}
            </button>
          </article>
        );
      })}
      {disabled && !!actions?.length && (
        <p className="helper-text">
          Suggestions need the current graph revision. Ask again after synchronization.
        </p>
      )}
      {warnings?.map((warning, i) => (
        <p className="helper-text" key={i}>
          {warning}
        </p>
      ))}
    </div>
  );
}
