import { contextReviewKey } from '../../shared/context-review';
import { suggestContext } from '../../shared/context-suggestions';
import { ContextSuggestions } from './ContextSuggestions';
import type { GraphSnapshot } from '../../shared/model';
import { SourceSummary } from './SourceSummary';
import type { ContextBundle } from '../../shared/context';
import { ProposalReview } from './ProposalReview';
import { VerificationPanel } from './VerificationPanel';
import { AiActions } from './AiActions';
import type { AiGraphAction } from '../../shared/ai-actions';
import { AiMarkdown } from './AiMarkdown';
import type { PreparedContext } from '../hooks/useContextPreview';
import React, { useMemo, useState, useEffect } from 'react';
import { useAssistantSession } from '../hooks/useAssistantSession';
import type { AiReference } from '../../shared/ai';
import type { SyncState } from '../../shared/model';
import { send } from '../bridge';
import { CodingPlanReview } from './CodingPlanReview';
import type { ReviewState } from '../../shared/review-graph';

export function AiAssistant({
  prepareContext,
  graph,
  sourceIds,
  onAddSource,
  onAction,
  regionKey,
  conversationKey,
  rootId,
  revision,
  fileCount,
  sync,
  contextContent,
  contextSummary,
  contextWarning,
  contextBundle,
  intent,
  editableFileIds,
  onReview,
  onNavigate,
  windowActions,
}: {
  windowActions?: React.ReactNode;
  graph: GraphSnapshot;
  sourceIds: string[];
  onAddSource: (ids: string[]) => void;
  contextBundle?: ContextBundle;
  editableFileIds?: string[];
  onReview?: (state: ReviewState) => void;
  onNavigate?: (stage: 'explore' | 'plan' | 'review' | 'verify') => void;
  contextContent?: React.ReactNode;
  contextSummary?: string;
  contextWarning?: string;
  intent?: {
    mode: 'ask' | 'propose' | 'plan';
    id: string;
    tab?: 'chat' | 'plan' | 'changes' | 'verify' | 'context';
  };
  prepareContext: (action?: 'ask' | 'propose' | 'plan') => Promise<PreparedContext>;
  onAction: (action: AiGraphAction) => void;
  regionKey: string;
  conversationKey: string;
  rootId: string;
  revision: number;
  fileCount: number;
  sync: SyncState;
}) {
  const {
    plan,
    setPlan,
    conflict,
    tab,
    setTab,
    input,
    chatScroll,
    followAnswer,
    turns,
    setTurns,
    connection,
    usage,
    setUsage,
    pendingAction,
    setPendingAction,
    copied,
    setCopied,
    model,
    configuredId,
    modelError,
    question,
    setQuestion,
    text,
    setText,
    error,
    busy,
    mode,
    setMode,
    preparing,
    verification,
    verificationHistory,
    verificationError,
    includeVerification,
    setIncludeVerification,
    appliedIds,
    proposalState,
    proposal,
    setProposal,
    references,
    reviewed,
    applying,
    setApplying,
    request,
    proposalId,
    ready,
    stop,
    start,
  } = useAssistantSession({
    prepareContext,
    onAction,
    regionKey,
    conversationKey,
    rootId,
    revision,
    fileCount,
    sync,
    intent,
    editableFileIds,
  });
  useEffect(() => {
    if (input.current && (tab === 'chat' || tab === 'plan')) {
      input.current.style.height = '0px';
      input.current.style.height = Math.min(120, input.current.scrollHeight) + 'px';
    }
  }, [question, tab]);
  const [roundId, setRoundId] = useState<string>();
  useEffect(() => setRoundId(undefined), [verification?.id]);
  const round = verificationHistory.find((r) => r.id === roundId) ?? verification;
  const historicalRound = !!round && round.id !== verification?.id;
  const planDraft = tab === 'plan' && !plan;
  const canEdit = editableFileIds === undefined || editableFileIds.length > 0;
  const submitBlocked = !fileCount
    ? 'Add source files in Context to begin.'
    : sync !== 'up-to-date'
      ? 'Refresh or wait for graph synchronization.'
      : !model && !configuredId
        ? 'Choose an AI model to continue.'
        : mode !== 'ask' && !canEdit
          ? 'Allow edits to at least one source file in Scope & permissions.'
          : undefined;
  const navigateTab = (next: typeof tab) => {
    setTab(next);
    if (next !== 'context') {
      onNavigate?.(next === 'chat' ? 'explore' : next === 'changes' ? 'review' : next);
    }
    if (next === 'chat') {
      setMode('ask');
    }
    if (next === 'plan') {
      setMode('plan');
    }
  };
  const suggestions = useMemo(
    () => suggestContext(graph, sourceIds, question),
    [graph, sourceIds.join(), question],
  );
  const reviewKey = contextReviewKey(
    rootId,
    revision,
    sourceIds,
    regionKey,
    question,
    editableFileIds,
  );
  const [reviewedScope, setReviewedScope] = useState<string>();
  const [contextReview, setContextReview] = useState<{
    key: string;
    action: 'plan' | 'propose';
    steps?: string[];
  }>();
  useEffect(() => setContextReview(undefined), [reviewKey]);
  const submit = (action: 'ask' | 'propose' | 'plan', steps?: string[]) => {
    if (action !== 'ask' && reviewedScope !== reviewKey) {
      setContextReview({ key: reviewKey, action, steps });
      setTab('context');
      return;
    }
    void start(action, steps);
  };
  return (
    <section className="ai-assistant assistant-workspace" aria-label="CodeMap AI">
      <div className="assistant-model-row">
        <strong className="assistant-title">Assistant</strong>
        <button
          className="ai-model-picker"
          title={`Model · ${model?.vendor ?? 'VS Code'}`}
          disabled={busy || applying}
          onClick={() => send({ type: 'aiChooseModel' })}
        >
          <span>
            <small>MODEL · {model?.vendor ?? 'VS Code'}</small>
            <strong>{model?.name ?? (configuredId || 'Select a model')}</strong>
          </span>
          <span aria-hidden="true">⌄</span>
        </button>
        <details className="assistant-model-settings">
          <summary aria-label="Model connection settings">⚙</summary>
          <div>
            {' '}
            <div className="ai-connection-actions">
              <button
                disabled={
                  busy || applying || connection.state === 'checking' || (!model && !configuredId)
                }
                onClick={() => send({ type: 'aiTestConnection' })}
              >
                Test connection
              </button>
              <small>No source sent</small>
            </div>
            {connection.message && (
              <p
                className={connection.state === 'error' ? 'context-warning' : 'helper-text'}
                role="status"
              >
                {connection.message}
              </p>
            )}
          </div>
        </details>
        {windowActions}
      </div>
      {modelError && (
        <div role="alert" className="context-warning assistant-model-error">
          <p>{modelError}</p>
          <button disabled={busy || applying} onClick={() => send({ type: 'aiChooseModel' })}>
            Choose another model
          </button>
        </div>
      )}
      {(busy || applying) && (
        <div className="assistant-request-status" role="status">
          <span>
            {applying
              ? 'Applying reviewed edits…'
              : preparing
                ? 'Preparing source…'
                : 'AI is responding…'}
          </span>
          {busy && tab !== 'chat' && !planDraft && <button onClick={stop}>Stop</button>}
        </div>
      )}
      {error && !modelError && tab !== 'chat' && !planDraft && (
        <p className="context-warning assistant-global-error" role="alert">
          {error}
        </p>
      )}
      <div className="assistant-tabs" role="tablist" aria-label="Assistant sections">
        {(['chat', 'plan', 'changes', 'verify', 'context'] as const).map((id) => (
          <button
            key={id}
            id={`assistant-tab-${id}`}
            role="tab"
            aria-selected={tab === id}
            aria-controls={`assistant-page-${id}`}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => navigateTab(id)}
            onKeyDown={(event) => {
              const ids = ['chat', 'plan', 'changes', 'verify', 'context'] as const;
              const index = ids.indexOf(id);
              const next =
                event.key === 'ArrowRight'
                  ? ids[(index + 1) % ids.length]
                  : event.key === 'ArrowLeft'
                    ? ids[(index + ids.length - 1) % ids.length]
                    : event.key === 'Home'
                      ? 'chat'
                      : event.key === 'End'
                        ? 'context'
                        : undefined;
              if (next) {
                event.preventDefault();
                navigateTab(next);
                document.getElementById(`assistant-tab-${next}`)?.focus();
              }
            }}
          >
            {id === 'chat'
              ? 'Explore'
              : id === 'plan'
                ? 'Plan'
                : id === 'changes'
                  ? 'Review'
                  : id === 'verify'
                    ? 'Verify'
                    : 'Context'}
            {((id === 'context' && fileCount > 0) ||
              (id === 'plan' && !!plan?.steps.length) ||
              (id === 'changes' && !!proposal?.changes.length)) && (
              <span>
                {id === 'changes'
                  ? (proposal?.changes.length ?? 0)
                  : id === 'plan'
                    ? (plan?.steps.length ?? 0)
                    : fileCount}
              </span>
            )}
          </button>
        ))}
      </div>
      <div
        className={`assistant-page assistant-chat${planDraft ? ' is-plan-draft' : ''}`}
        id={planDraft ? 'assistant-page-plan' : 'assistant-page-chat'}
        role="tabpanel"
        aria-labelledby={planDraft ? 'assistant-tab-plan' : 'assistant-tab-chat'}
        hidden={tab !== 'chat' && !planDraft}
      >
        <div className="assistant-chat-context">
          <button className="assistant-context-strip" onClick={() => setTab('context')}>
            <span>
              <small>SOURCE</small>
              <strong title={contextSummary}>{contextSummary ?? `${fileCount} files`}</strong>
            </span>
            <span>Manage →</span>
          </button>
          {!!suggestions.length && (
            <button className="suggested-context-link" onClick={() => setTab('context')}>
              + {suggestions.length} suggested files
            </button>
          )}
          {!planDraft && !!turns.length && (
            <button
              disabled={busy || applying}
              className="quiet-button assistant-clear-chat"
              title="Clear conversation"
              aria-label="Clear conversation"
              onClick={() => {
                send({ type: 'aiClearHistory', rootId, regionKey: conversationKey });
                setText('');
                setProposal(undefined);
                proposalId.current = undefined;
                setUsage(undefined);
                setCopied('');
              }}
            >
              Clear
            </button>
          )}
        </div>
        <div
          className="assistant-chat-scroll"
          ref={chatScroll}
          onScroll={(event) => {
            const node = event.currentTarget;
            followAnswer.current = node.scrollHeight - node.scrollTop - node.clientHeight < 64;
          }}
        >
          {((planDraft && !question && !busy) ||
            (!question && !text && !busy && !turns.length)) && (
            <div className="assistant-empty">
              <span aria-hidden="true">✦</span>
              <h3>
                {!fileCount
                  ? 'Start with a file'
                  : mode === 'propose'
                    ? 'Describe the change'
                    : mode === 'plan'
                      ? 'Plan a source change'
                      : 'Explore your selected source'}
              </h3>
              <p>
                {fileCount
                  ? mode === 'propose'
                    ? 'Explain what should change. Review each proposed edit before applying it.'
                    : mode === 'plan'
                      ? 'Describe the goal. Review file-level read and edit steps before generating code.'
                      : 'Ask how it works or find a potential issue.'
                  : 'Select a node on the graph or add files in Context.'}
              </p>
              <div className="ai-suggestions">
                {(mode === 'propose'
                  ? ['Improve readability without changing behavior', 'Fix a potential bug']
                  : mode === 'plan'
                    ? ['Plan a focused refactor', 'Plan a bug fix with tests']
                    : ['Explain this region', 'Find potential issues']
                ).map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => {
                      setQuestion(prompt);
                      input.current?.focus();
                    }}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!planDraft && !!turns.length && (
            <div className="ai-thread">
              {turns.map((turn) => {
                const stale = turn.revision !== revision || sync !== 'up-to-date';
                const copy = (value: string) =>
                  send({ type: 'aiCopy', requestId: turn.id, text: value });
                const open = (ref: AiReference) =>
                  send({
                    type: 'aiOpenReference',
                    requestId: turn.id,
                    fileId: ref.fileId,
                    line: ref.line,
                  });
                return (
                  <article className="ai-history-turn" key={turn.id}>
                    <div className="ai-user-question">{turn.question}</div>
                    <div className="ai-answer-heading">
                      <span>✦ {turn.model || 'Assistant'}</span>
                      <button
                        className="quiet-button"
                        disabled={!turn.answer.trim()}
                        onClick={() => copy(turn.answer)}
                      >
                        {copied === turn.id ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    {stale && (
                      <p className="ai-stale">
                        Source updated since this answer · revision {turn.revision}
                      </p>
                    )}
                    {turn.error && <p className="context-warning">{turn.error}</p>}
                    {!turn.answer.trim() && !turn.error && (
                      <p className="context-warning">
                        No text was returned for this earlier request. Choose another model and
                        retry.
                      </p>
                    )}
                    <AiMarkdown
                      text={turn.answer}
                      references={turn.references}
                      onReference={stale ? undefined : open}
                      onCopy={copy}
                    />
                    <AiActions
                      actions={turn.actions}
                      warnings={turn.actionWarnings}
                      disabled={stale || busy || applying}
                      pending={pendingAction}
                      onRun={(action) => {
                        setPendingAction(action.id);
                        send({
                          type: 'aiExecuteAction',
                          requestId: turn.id,
                          actionId: action.id,
                          rootId,
                          regionKey: conversationKey,
                        });
                      }}
                    />
                  </article>
                );
              })}
            </div>
          )}
          {!planDraft && text && !turns.some((turn) => turn.id === request.current) && (
            <div className="ai-answer" aria-label="AI response">
              <div className="ai-answer-heading">
                <span>✦ {proposal ? 'Suggested change' : 'Assistant'}</span>
                {busy && <small>Responding…</small>}
              </div>
              <AiMarkdown text={text} />
            </div>
          )}
          {!planDraft &&
            !!references.length &&
            !turns.some((turn) => turn.id === request.current) && (
              <div className="ai-citations">
                <span className="eyebrow">Source references</span>
                {references.map((ref) => (
                  <button
                    key={`${ref.fileId}:${ref.line}:${ref.endLine ?? ref.line}`}
                    onClick={() =>
                      send({
                        type: 'aiOpenReference',
                        requestId: request.current!,
                        fileId: ref.fileId,
                        line: ref.line,
                      })
                    }
                  >
                    {ref.path} · L{ref.line}
                    {ref.endLine ? `–L${ref.endLine}` : ''}
                  </button>
                ))}
              </div>
            )}
        </div>
        <div className="assistant-composer-dock">
          {error && !modelError && (
            <p role="alert" className="context-warning">
              {error}
            </p>
          )}
          <div className="ai-composer assistant-composer">
            <div className="ai-mode-tabs" role="group" aria-label="AI action">
              <button
                aria-pressed={mode === 'ask'}
                disabled={busy || applying}
                onClick={() => {
                  navigateTab('chat');
                }}
              >
                Ask
              </button>
              <button
                aria-pressed={mode === 'plan'}
                disabled={busy || applying}
                onClick={() => {
                  setPlan(undefined);
                  navigateTab('plan');
                }}
              >
                Plan
              </button>
              <button
                aria-pressed={mode === 'propose'}
                disabled={busy || applying}
                onClick={() => {
                  setMode('propose');
                  setTab('chat');
                }}
              >
                Edit
              </button>
              <span>
                {fileCount} {fileCount === 1 ? 'file' : 'files'}
              </span>
            </div>
            <textarea
              ref={input}
              aria-label={mode === 'ask' ? 'Ask about selected source' : 'Describe source changes'}
              placeholder={
                mode === 'ask'
                  ? 'What would you like to understand?'
                  : mode === 'plan'
                    ? 'Describe the goal, expected behavior and constraints…'
                    : 'Describe the change you want to make…'
              }
              value={question}
              maxLength={8000}
              rows={2}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={busy || applying}
              onKeyDown={(e) => {
                if (
                  (e.metaKey || e.ctrlKey) &&
                  e.key === 'Enter' &&
                  ready &&
                  question.trim() &&
                  !busy &&
                  !applying &&
                  !submitBlocked &&
                  (model || configuredId)
                ) {
                  e.preventDefault();
                  submit(mode);
                }
              }}
            />
            {contextWarning && (
              <p role="alert" className="context-warning">
                {contextWarning}
              </p>
            )}
            <div className="ai-composer-footer">
              <small>
                {preparing ? 'Preparing context…' : busy ? 'Generating…' : '⌘ / Ctrl + Enter'}
              </small>
              {busy ? (
                <button onClick={stop}>Stop</button>
              ) : (
                <button
                  className="primary"
                  disabled={!ready || !question.trim() || applying || !!submitBlocked}
                  onClick={() => {
                    submit(mode);
                  }}
                >
                  {mode === 'ask'
                    ? 'Ask selection ↗'
                    : mode === 'plan'
                      ? 'Create plan ↗'
                      : 'Propose changes ↗'}
                </button>
              )}
            </div>
          </div>
          {submitBlocked && (
            <p className="ai-disclosure submit-blocked" role="status">
              {submitBlocked}
            </p>
          )}
        </div>
      </div>
      <div
        className="assistant-page assistant-plan"
        id={plan ? 'assistant-page-plan' : undefined}
        role="tabpanel"
        aria-labelledby="assistant-tab-plan"
        hidden={tab !== 'plan' || !plan}
      >
        <button
          onClick={() => {
            setPlan(undefined);
            navigateTab('plan');
            requestAnimationFrame(() => input.current?.focus());
          }}
        >
          Create a new plan →
        </button>
        {!plan && (
          <p className="helper-text">
            Describe the task in Plan. The model proposes file and symbol changes before generating
            any source edits.
          </p>
        )}
        {plan && (
          <CodingPlanReview
            plan={plan}
            revision={revision}
            editable={editableFileIds}
            busy={busy || applying || !ready}
            onGenerate={(ids) => submit('propose', ids)}
            onFocus={(ids) =>
              onAction({
                id: `plan:${plan.id}`,
                kind: 'focus',
                fileIds: ids,
                paths: [],
                reason: 'Inspect coding plan',
              })
            }
          />
        )}
      </div>
      <div
        className="assistant-page assistant-changes"
        id="assistant-page-changes"
        role="tabpanel"
        aria-labelledby="assistant-tab-changes"
        hidden={tab !== 'changes'}
      >
        {!proposal && (
          <div className="assistant-empty">
            <span aria-hidden="true">◇</span>
            <h3>No proposed changes yet</h3>
            <p>
              Describe a change in Edit. You will review each edit here before anything is applied.
            </p>
            <button
              onClick={() => {
                setTab('chat');
                setMode('propose');
                requestAnimationFrame(() => input.current?.focus());
              }}
            >
              Edit with AI →
            </button>
          </div>
        )}
        {error && (
          <p className="context-warning" role="alert">
            {error}
          </p>
        )}
        {proposal && (
          <ProposalReview
            appliedIds={appliedIds}
            proposal={proposal}
            reviewed={reviewed}
            state={proposalState}
            applying={applying}
            ready={ready}
            onSelectionChange={(accepted) =>
              onReview?.({
                proposal,
                accepted,
                reviewed,
                state: proposalState,
                applied: appliedIds ?? [],
              })
            }
            conflict={conflict}
            onRegenerate={() => {
              setMode('propose');
              setTab('chat');
              requestAnimationFrame(() => input.current?.focus());
            }}
            onApply={() => setApplying(true)}
          />
        )}
      </div>
      <div
        className="assistant-page assistant-changes"
        id="assistant-page-verify"
        role="tabpanel"
        aria-labelledby="assistant-tab-verify"
        hidden={tab !== 'verify'}
      >
        {!verification && (
          <div className="assistant-empty">
            <h3>Verify after Apply</h3>
            <p>
              Review and apply source changes first. Diagnostics and user-selected tests will appear
              here.
            </p>
          </div>
        )}
        {!!verificationHistory.length && (
          <label className="verification-rounds">
            Task rounds · session only
            <select
              aria-label="Verification round"
              value={round?.id ?? ''}
              title={round?.changedFiles.map((f) => f.path).join(', ')}
              onChange={(event) => setRoundId(event.target.value)}
            >
              {verificationHistory.map((r, index) => (
                <option key={r.id} value={r.id}>
                  {index === 0 ? 'Latest' : `Earlier round ${verificationHistory.length - index}`} ·{' '}
                  {new Date(r.observedAt).toLocaleTimeString()} · {r.changedFiles.length}{' '}
                  {r.changedFiles.length === 1 ? 'file' : 'files'} · {r.test?.state ?? 'not tested'}
                </option>
              ))}
            </select>
          </label>
        )}
        {round && (
          <VerificationPanel
            historical={historicalRound}
            report={round}
            error={verificationError}
            include={includeVerification}
            onInclude={setIncludeVerification}
            onAction={onAction}
            onRepair={() => {
              setIncludeVerification(true);
              const ids = [
                ...new Set([
                  ...round.changedFiles.map((f) => f.id),
                  ...round.diagnostics.filter((d) => d.severity === 'error').map((d) => d.fileId),
                ]),
              ]
                .filter((id) => !sourceIds.includes(id) && graph.nodes.some((n) => n.id === id))
                .slice(0, Math.max(0, 50 - sourceIds.length));
              onAddSource(ids.filter((id) => !sourceIds.includes(id)));
              setMode('plan');
              setPlan(undefined);
              setQuestion(
                'Plan a minimal repair for the failed tests and diagnostics in the included report using current reviewed source. Identify missing context explicitly. Do not claim to have run tests. Only propose edits to files I allow.',
              );
              setTab('context');
            }}
          />
        )}
      </div>
      <div
        className="assistant-page assistant-context"
        id="assistant-page-context"
        role="tabpanel"
        aria-labelledby="assistant-tab-context"
        hidden={tab !== 'context'}
      >
        {contextReview && contextReview.key === reviewKey && (
          <section className="context-review-gate" role="status">
            <strong>
              Review context before {contextReview.action === 'plan' ? 'planning' : 'editing'}
            </strong>
            <p className="helper-text">
              Check implementations, dependencies and tests below. No request has been sent.
            </p>
            <p className="helper-text">
              {editableFileIds
                ? `${editableFileIds.filter((id) => sourceIds.includes(id)).length} included file(s) allowed for edits. Adding source keeps task edit permissions unchanged.`
                : 'All included source files can be edited. Use Work on this to restrict edit permissions.'}
            </p>
            <div className="ai-connection-actions">
              <button
                disabled={busy || applying || sync !== 'up-to-date'}
                onClick={() => {
                  setReviewedScope(reviewKey);
                  setContextReview(undefined);
                  void start(contextReview.action, contextReview.steps);
                }}
              >
                Continue with current source
              </button>
              <button
                onClick={() => {
                  setContextReview(undefined);
                  setTab(mode === 'plan' ? 'plan' : 'chat');
                }}
              >
                Back to question
              </button>
            </div>
          </section>
        )}
        <ContextSuggestions
          suggestions={suggestions}
          count={fileCount}
          disabled={busy || applying}
          onAdd={(ids) => {
            onAddSource(ids);
            setContextReview(undefined);
          }}
          onReveal={(id) =>
            onAction({
              id: `context:${id}`,
              kind: 'focus',
              fileIds: [id],
              paths: [],
              reason: 'Inspect context candidate',
            })
          }
        />
        <div className="assistant-source-meta">
          <SourceSummary
            fileCount={fileCount}
            bundle={contextBundle}
            regionKey={regionKey}
            mode={mode === 'plan' ? 'propose' : mode}
            ready={ready}
            busy={busy || applying}
            prepare={prepareContext}
            onManage={() => setTab('context')}
          />
        </div>
        <p className="helper-text">
          Selected source is prepared automatically and sent only when you submit. Follow-ups use
          the current source; earlier answers may describe older revisions. After adding source,
          return to Plan/Edit and submit again; plans for a previous scope must be recreated.
        </p>
        {usage && (
          <p className="helper-text">
            {usage.inputTokens.toLocaleString()} / {usage.maxInputTokens.toLocaleString()} input
            tokens · {usage.historyTurns} prior turns included
          </p>
        )}
        {contextContent}
        {includeVerification && verification && (
          <div className="repair-context">
            <details open>
              <summary>Report to include · revision {verification.revision}</summary>
              <p>
                {verification.diagnostics.filter((d) => d.severity === 'error').length} errors ·{' '}
                {verification.test?.name ?? 'No test'} · {verification.test?.state ?? 'not run'}
              </p>
              <pre>{JSON.stringify(verification, null, 2)}</pre>
            </details>
            <div className="context-bar">
              <span>
                Report selected for the next AI request. Review source and report before sending.
              </span>
              <button onClick={() => navigateTab(mode === 'plan' ? 'plan' : 'chat')}>
                Review question →
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
