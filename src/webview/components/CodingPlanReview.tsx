import React, { useEffect, useState } from 'react';
import type { CodingPlan } from '../../shared/ai-plan';
export function CodingPlanReview({
  plan,
  revision,
  editable,
  busy,
  onGenerate,
  onFocus,
}: {
  plan: CodingPlan;
  revision: number;
  editable?: string[];
  busy: boolean;
  onGenerate: (ids: string[]) => void;
  onFocus: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(
    () => setSelected(plan.steps.filter((s) => s.role === 'edit').map((s) => s.id)),
    [plan.id],
  );
  const stale = plan.revision !== revision;
  const allowed = plan.steps.filter(
    (s) =>
      selected.includes(s.id) && s.role === 'edit' && (!editable || editable.includes(s.fileId)),
  );
  return (
    <section className="coding-plan" aria-label="Coding plan">
      <span className="eyebrow">Plan before editing</span>
      <h3>{plan.summary}</h3>
      <p className="helper-text">
        Choose the intended edits. Read-only files supply context. File permissions apply to the
        whole file; symbol names describe the plan.
      </p>
      {stale && (
        <p className="context-warning">
          Source changed. Create a new plan before generating edits.
        </p>
      )}
      {plan.steps.map((step) => (
        <article key={step.id} className="plan-step">
          <label>
            <input
              type="checkbox"
              checked={step.role === 'edit' && selected.includes(step.id)}
              disabled={
                busy ||
                stale ||
                step.role === 'read' ||
                (!!editable && !editable.includes(step.fileId))
              }
              onChange={(e) =>
                setSelected((ids) =>
                  e.target.checked ? [...ids, step.id] : ids.filter((id) => id !== step.id),
                )
              }
            />
            <span>
              <strong>
                {step.path}
                {step.symbol ? ` · ${step.symbol}` : ''}
              </strong>
              <small>{step.role === 'edit' ? 'Edit' : 'Read only'}</small>
            </span>
          </label>
          <p>{step.reason}</p>
          <button className="quiet-button" onClick={() => onFocus([step.fileId])}>
            Show on map
          </button>
        </article>
      ))}
      <button
        className="primary"
        disabled={busy || stale || !allowed.length}
        onClick={() => onGenerate(allowed.map((s) => s.id))}
      >
        Generate changes · {allowed.length} steps
      </button>
    </section>
  );
}
