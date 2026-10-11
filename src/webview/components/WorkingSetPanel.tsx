import React, { useEffect, useState } from 'react';
import type { GraphSnapshot } from '../../shared/model';
import type { WorkingSet } from '../../shared/working-set';
export function WorkingSetPanel({
  set,
  graph,
  onChange,
  onExit,
  onReturn,
  onSave,
  onNeighbors,
  onAssistant,
  onOpen,
  stage,
  onStage,
}: {
  stage: 'explore' | 'plan' | 'review' | 'verify';
  onStage: (stage: 'explore' | 'plan' | 'review' | 'verify') => void;
  set: WorkingSet;
  graph: GraphSnapshot;
  onChange: (set: WorkingSet) => void;
  onExit: () => void;
  onReturn: () => void;
  onSave: () => void;
  onNeighbors: () => void;
  onAssistant: (mode: 'ask' | 'plan' | 'propose') => void;
  onOpen: (id: string) => void;
}) {
  const [name, setName] = useState(set.name);
  useEffect(() => setName(set.name), [set.name]);
  const toggle = (key: 'context' | 'editable' | 'pinned', id: string) => {
    const ids = set[key].includes(id) ? set[key].filter((x) => x !== id) : [...set[key], id];
    onChange({
      ...set,
      [key]: ids,
      ...(key === 'context' ? { editable: set.editable.filter((x) => ids.includes(x)) } : {}),
    });
  };
  return (
    <section className="working-set" aria-label="Working Set">
      <div className="task-toolbar">
        <span className="eyebrow">Working Set</span>
        <input
          aria-label="Task name"
          value={name}
          maxLength={100}
          onChange={(e) => {
            setName(e.target.value);
            if (e.target.value.trim()) {
              onChange({ ...set, name: e.target.value });
            }
          }}
          onBlur={() => {
            if (!name.trim()) {
              setName(set.name);
            }
          }}
        />
        <span>
          {set.files.length} on map · {set.context.length} source · {set.editable.length} editable
        </span>
        <button onClick={onReturn}>Back to working set</button>
        <button onClick={onSave} disabled={!name.trim()}>
          Save task
        </button>
        <button onClick={onExit}>Full graph</button>
      </div>
      <details>
        <summary>Scope & permissions · {set.pinned.length} pinned</summary>
        <p className="helper-text">
          Map visibility, AI source and edit permissions are separate. Adding a neighbor never
          grants edit access. Use Shift-click or search to add files. Symbol anchors focus
          navigation; edit permission covers the whole file.
        </p>
        <div className="task-file-list">
          {set.files.map((id) => {
            const file = graph.nodes.find((n) => n.id === id);
            if (!file) {
              return null;
            }
            return (
              <div key={id} className="task-file-row">
                <button onClick={() => onOpen(id)} title={file.path}>
                  {file.path}
                </button>
                <label>
                  <input
                    type="checkbox"
                    aria-label={`Pin ${file.path}`}
                    checked={set.pinned.includes(id)}
                    onChange={() => toggle('pinned', id)}
                  />
                  Pin
                </label>
                <label>
                  <input
                    type="checkbox"
                    aria-label={`Include ${file.path} as AI source`}
                    checked={set.context.includes(id)}
                    disabled={!set.context.includes(id) && set.context.length >= 50}
                    onChange={() => toggle('context', id)}
                  />
                  Source
                </label>
                <label>
                  <input
                    type="checkbox"
                    aria-label={`Allow AI edits to ${file.path}`}
                    checked={set.editable.includes(id)}
                    disabled={!set.context.includes(id)}
                    onChange={() => toggle('editable', id)}
                  />
                  Allow edits
                </label>
                <button
                  aria-label={`Remove ${file.path} from task`}
                  disabled={set.pinned.includes(id)}
                  onClick={() =>
                    onChange({
                      ...set,
                      files: set.files.filter((x) => x !== id),
                      context: set.context.filter((x) => x !== id),
                      editable: set.editable.filter((x) => x !== id),
                      symbols: set.symbols.filter((s) => s.nodeId !== id),
                    })
                  }
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
        {!!set.symbols.length && (
          <p className="helper-text">Symbol anchors: {set.symbols.map((s) => s.name).join(', ')}</p>
        )}
      </details>
      <nav className="task-stages" aria-label="Task workflow">
        {(['explore', 'plan', 'review', 'verify'] as const).map((item, index) => (
          <button
            key={item}
            aria-current={stage === item ? 'step' : undefined}
            onClick={() => onStage(item)}
          >
            <span>{index + 1}</span>
            {item === 'explore'
              ? 'Explore'
              : item === 'plan'
                ? 'Plan'
                : item === 'review'
                  ? 'Review'
                  : 'Verify'}
          </button>
        ))}
        <small>
          {stage === 'explore'
            ? 'Choose source and allow edits in Scope, then open Plan.'
            : stage === 'plan'
              ? 'Describe the goal, then review steps before Generate.'
              : stage === 'review'
                ? 'Accept ranges and review their diffs before Apply.'
                : 'Check diagnostics and run a selected test.'}
        </small>
      </nav>
      <details className="task-more-actions">
        <summary>Task actions</summary>
        <div className="task-toolbar">
          <button onClick={onNeighbors}>Add direct neighbors</button>
          <button disabled={!set.context.length} onClick={() => onAssistant('ask')}>
            Ask about task
          </button>
          <button disabled={!set.editable.length} onClick={() => onAssistant('plan')}>
            Plan changes
          </button>
          <button disabled={!set.editable.length} onClick={() => onAssistant('propose')}>
            Edit allowed files
          </button>
          <small>Boundary groups show related files outside this task.</small>
        </div>
      </details>
    </section>
  );
}
