import React, { useEffect, useState } from 'react';
import type { AiProposal } from '../../shared/ai';
import { reviewGroups } from '../../shared/assistant-view';
import { send } from '../bridge';

export function ProposalReview({
  proposal,
  appliedIds,
  reviewed,
  state,
  applying,
  ready,
  onApply,
  conflict,
  onRegenerate,
  onSelectionChange,
}: {
  proposal: AiProposal;
  appliedIds?: string[];
  reviewed: string[];
  state: string;
  applying: boolean;
  ready: boolean;
  onApply: () => void;
  conflict?: { fileId: string; changeId?: string };
  onRegenerate: () => void;
  onSelectionChange?: (ids: string[]) => void;
}) {
  const [accepted, setAccepted] = useState<string[]>([]);
  useEffect(
    () => setAccepted(appliedIds ?? proposal.changes.map((c) => c.id)),
    [proposal.id, appliedIds],
  );
  const selectionHandler = React.useRef(onSelectionChange);
  selectionHandler.current = onSelectionChange;
  useEffect(() => selectionHandler.current?.(accepted), [accepted, reviewed, state]);
  const groups = reviewGroups(proposal.changes, accepted, reviewed);
  const pending = proposal.changes.find(
    (change) => accepted.includes(change.id) && !reviewed.includes(change.id),
  );
  const openDiff = (change: AiProposal['changes'][number]) =>
    send({ type: 'aiDiff', proposalId: proposal.id, fileId: change.fileId, changeId: change.id });
  return (
    <section className="ai-proposal" aria-label="Review proposed changes">
      <div className="section-toolbar">
        <span className="eyebrow">
          Review · {groups.length} {groups.length === 1 ? 'file' : 'files'} ·{' '}
          {proposal.changes.length} edits
        </span>
        <span className="ai-connection">{state}</span>
      </div>
      <p className="helper-text">
        Accept the edits you want, then open each accepted diff before Apply. Changes stay unsaved
        in VS Code.
      </p>
      <div className="review-progress" role="status">
        <button
          disabled={!accepted.length || applying || state !== 'ready'}
          onClick={() =>
            send({ type: 'aiPreviewGraph', proposalId: proposal.id, changeIds: accepted })
          }
        >
          Preview accepted graph
        </button>
        <span>
          {
            proposal.changes.filter((c) => accepted.includes(c.id) && reviewed.includes(c.id))
              .length
          }
          /{accepted.length} accepted edits reviewed
        </span>
        <button
          disabled={!pending || applying || state !== 'ready'}
          onClick={() => pending && openDiff(pending)}
        >
          Review next →
        </button>
      </div>
      {conflict && (
        <div className="review-conflict" role="alert">
          <strong>Source conflict · nothing applied</strong>
          <p>
            {proposal.changes.find((c) => c.fileId === conflict.fileId)?.path ??
              'Supporting context'}{' '}
            changed. Refresh the source and generate a new proposal before retrying.
          </p>
          <button disabled={!ready || applying} onClick={onRegenerate}>
            Prepare a new proposal →
          </button>
        </div>
      )}
      {groups.map((group) => (
        <section
          className="review-file-group"
          key={group.fileId}
          aria-label={`Edits for ${group.path}`}
        >
          <header>
            <strong>{group.path}</strong>
            <small>
              {group.accepted}/{group.changes.length} accepted · {group.reviewed} reviewed
            </small>
          </header>
          {state === 'ready' && (
            <div className="review-file-actions">
              <button
                disabled={applying}
                onClick={() =>
                  setAccepted((ids) => [...new Set([...ids, ...group.changes.map((c) => c.id)])])
                }
              >
                Accept file
              </button>
              <button
                disabled={applying}
                onClick={() =>
                  setAccepted((ids) => ids.filter((id) => !group.changes.some((c) => c.id === id)))
                }
              >
                Reject file
              </button>
            </div>
          )}
          {group.changes.map((change) => (
            <article
              className={`ai-edit-card ${accepted.includes(change.id) ? 'accepted' : 'rejected'} ${conflict?.changeId === change.id ? 'conflicted' : ''}`}
              key={change.id}
            >
              <label className="ai-edit-choice">
                <input
                  type="checkbox"
                  checked={accepted.includes(change.id)}
                  disabled={state !== 'ready' || applying}
                  onChange={(event) =>
                    setAccepted((ids) =>
                      event.target.checked
                        ? [...ids, change.id]
                        : ids.filter((id) => id !== change.id),
                    )
                  }
                />
                <span>
                  <strong>{change.path}</strong>
                  <small>
                    L{change.start.line}:{change.start.character}–L{change.end.line}:
                    {change.end.character} ·{' '}
                    {accepted.includes(change.id) ? 'Accepted' : 'Rejected'}
                  </small>
                </span>
              </label>
              {conflict?.changeId === change.id && (
                <small className="context-warning">Source changed near this range</small>
              )}
              <p>{change.reason}</p>
              {!!change.symbols.length && <small>Symbols: {change.symbols.join(', ')}</small>}
              <details>
                <summary>Preview replacement</summary>
                <small>Original</small>
                <pre>{change.oldText || '(insertion)'}</pre>
                <small>Replacement</small>
                <pre>{change.content || '(deletion)'}</pre>
              </details>
              <button
                disabled={state !== 'ready' || applying}
                onClick={() =>
                  send({
                    type: 'aiDiff',
                    proposalId: proposal.id,
                    fileId: change.fileId,
                    changeId: change.id,
                  })
                }
              >
                {reviewed.includes(change.id) ? '✓ Reopen diff' : 'Review in editor'}
              </button>
            </article>
          ))}
        </section>
      ))}
      {state === 'ready' && (
        <button
          className="primary"
          disabled={
            !ready ||
            applying ||
            !!conflict ||
            !accepted.length ||
            accepted.some((id) => !reviewed.includes(id))
          }
          onClick={() => {
            onApply();
            send({ type: 'aiApply', proposalId: proposal.id, changeIds: accepted });
          }}
        >
          {applying
            ? 'Applying…'
            : `Apply ${accepted.length} accepted ${accepted.length === 1 ? 'edit' : 'edits'}`}
        </button>
      )}
      {state === 'applied' && (
        <p className="helper-text">
          Applied to editor buffers. Review verification below, then save when ready.
        </p>
      )}
      {state === 'expired' && (
        <p className="context-warning">Superseded by another request. Generate a fresh proposal.</p>
      )}
    </section>
  );
}
