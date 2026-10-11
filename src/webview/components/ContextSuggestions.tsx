import React, { useEffect, useState } from 'react';
import type { ContextSuggestion } from '../../shared/context-suggestions';
export function ContextSuggestions({
  suggestions,
  count,
  disabled,
  onAdd,
  onReveal,
}: {
  suggestions: ContextSuggestion[];
  count: number;
  disabled: boolean;
  onAdd: (ids: string[]) => void;
  onReveal?: (id: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const key = suggestions.map((s) => s.fileId).join('\n');
  useEffect(
    () => setSelected((ids) => ids.filter((id) => suggestions.some((s) => s.fileId === id))),
    [key],
  );
  const room = Math.max(0, 50 - count);
  return (
    <section className="context-suggestions" aria-label="Suggested context">
      <span className="eyebrow">Suggested context · {suggestions.length}</span>
      <p className="helper-text">
        Local import/symbol metadata and filename matches. Review relevance before adding source.
        Nothing is sent. Task edit permissions stay unchanged; outside a task, all included source
        can be edited.
      </p>
      {!!suggestions.length && (
        <p className="context-warning">
          Potential context gaps: these candidates are outside the selected source. Review the
          relevant files before asking about behavior across files.
        </p>
      )}
      {!suggestions.length && (
        <p className="helper-text">
          No more graph-based candidates. Describe the task or add a file explicitly; missing
          behavior remains unknown.
        </p>
      )}
      {suggestions.map((item) => (
        <div className="context-candidate" key={item.fileId}>
          <label className="context-suggestion">
            <input
              type="checkbox"
              checked={selected.includes(item.fileId)}
              disabled={disabled || (!selected.includes(item.fileId) && selected.length >= room)}
              onChange={(e) =>
                setSelected((ids) =>
                  e.target.checked ? [...ids, item.fileId] : ids.filter((id) => id !== item.fileId),
                )
              }
            />
            <span>
              <strong>{item.path}</strong>
              <small>{item.reasons.join(' · ')}</small>
            </span>
          </label>
          {onReveal && (
            <button
              className="quiet-button"
              onClick={() => onReveal(item.fileId)}
              aria-label={`Show ${item.path} on graph`}
            >
              On map ↗
            </button>
          )}
        </div>
      ))}
      {!!suggestions.length && (
        <button
          disabled={disabled || !selected.length || selected.length > room}
          onClick={() => {
            onAdd(selected);
            setSelected([]);
          }}
        >
          Add {selected.length} reviewed {selected.length === 1 ? 'file' : 'files'} to source
        </button>
      )}
      {!room && (
        <p className="context-warning">Source limit reached. Remove files before adding context.</p>
      )}
    </section>
  );
}
