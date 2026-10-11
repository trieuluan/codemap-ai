import { SourceSummary } from './SourceSummary';
import type { ContextBundle } from '../../shared/context';
import { ProposalReview } from './ProposalReview';
import { VerificationPanel } from './VerificationPanel';
import { AiActions } from './AiActions';
import type { AiGraphAction } from '../../shared/ai-actions';
import { AiMarkdown } from './AiMarkdown';
import type { PreparedContext } from '../hooks/useContextPreview';
import React from 'react';
import { useAssistantSession } from '../hooks/useAssistantSession';
import type { AiReference } from '../../shared/ai';
import type { SyncState } from '../../shared/model';
import { send } from '../bridge';

export function AiAssistant({
  prepareContext,
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
}: {
  contextBundle?: ContextBundle;
  contextContent?: React.ReactNode;
  contextSummary?: string;
  contextWarning?: string;
  intent?: { mode: 'ask' | 'propose'; id: string };
  prepareContext: (action?: 'ask' | 'propose') => Promise<PreparedContext>;
  onAction: (action: AiGraphAction) => void;
  regionKey: string;
  conversationKey: string;
  rootId: string;
  revision: number;
  fileCount: number;
  sync: SyncState;
}) {
  const {
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
  });
  return (
    <section className="ai-assistant assistant-workspace" aria-label="CodeMap AI">
      <div className="assistant-model-row">
        {' '}
        <button
          className="ai-model-picker"
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
            {modelError && (
              <p role="alert" className="context-warning">
                {modelError}
              </p>
            )}
          </div>
        </details>
      </div>
      <div className="assistant-tabs" role="tablist" aria-label="Assistant sections">
        {(['chat', 'changes', 'context'] as const).map((id) => (
          <button
            key={id}
            id={`assistant-tab-${id}`}
            role="tab"
            aria-selected={tab === id}
            aria-controls={`assistant-page-${id}`}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            onKeyDown={(event) => {
              const ids = ['chat', 'changes', 'context'] as const;
              const index = ids.indexOf(id);
              const next =
                event.key === 'ArrowRight'
                  ? ids[(index + 1) % 3]
                  : event.key === 'ArrowLeft'
                    ? ids[(index + 2) % 3]
                    : event.key === 'Home'
                      ? 'chat'
                      : event.key === 'End'
                        ? 'context'
                        : undefined;
              if (next) {
                event.preventDefault();
                setTab(next);
                document.getElementById(`assistant-tab-${next}`)?.focus();
              }
            }}
          >
            {id === 'chat' ? 'Chat' : id === 'changes' ? 'Changes' : 'Context'}
            {id !== 'chat' && (
              <span>{id === 'changes' ? (proposal?.changes.length ?? 0) : fileCount}</span>
            )}
          </button>
        ))}
      </div>
      <div
        className="assistant-page assistant-chat"
        id="assistant-page-chat"
        role="tabpanel"
        aria-labelledby="assistant-tab-chat"
        hidden={tab !== 'chat'}
      >
        <button className="assistant-context-strip" onClick={() => setTab('context')}>
          <span>
            <small>SOURCE</small>
            <strong title={contextSummary}>{contextSummary ?? `${fileCount} files`}</strong>
          </span>
          <span>Manage →</span>
        </button>
        <div
          className="assistant-chat-scroll"
          ref={chatScroll}
          onScroll={(event) => {
            const node = event.currentTarget;
            followAnswer.current = node.scrollHeight - node.scrollTop - node.clientHeight < 64;
          }}
        >
          {!question && !text && !busy && !turns.length && (
            <div className="assistant-empty">
              <span aria-hidden="true">✦</span>
              <h3>
                {!fileCount
                  ? 'Start with a file'
                  : mode === 'propose'
                    ? 'Describe the change'
                    : 'Explore your selected source'}
              </h3>
              <p>
                {fileCount
                  ? mode === 'propose'
                    ? 'Explain what should change. Review each proposed edit before applying it.'
                    : 'Ask how it works or find a potential issue.'
                  : 'Select a node on the graph or add files in Context.'}
              </p>
              <div className="ai-suggestions">
                {(mode === 'propose'
                  ? ['Improve readability without changing behavior', 'Fix a potential bug']
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
          {error && (
            <p role="alert" className="context-warning">
              {error}
            </p>
          )}
          {!!turns.length && (
            <div className="ai-thread">
              <div className="section-toolbar">
                <span className="eyebrow">Conversation · {turns.length} turns</span>
                <button
                  disabled={busy || applying}
                  className="quiet-button"
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
              </div>
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
                      <button className="quiet-button" onClick={() => copy(turn.answer)}>
                        {copied === turn.id ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    {stale && (
                      <p className="ai-stale">
                        Source updated since this answer · revision {turn.revision}
                      </p>
                    )}
                    {turn.error && <p className="context-warning">{turn.error}</p>}
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
          {text && !turns.some((turn) => turn.id === request.current) && (
            <div className="ai-answer" aria-label="AI response">
              <div className="ai-answer-heading">
                <span>✦ {proposal ? 'Suggested change' : 'Assistant'}</span>
                {busy && <small>Responding…</small>}
              </div>
              <AiMarkdown text={text} />
            </div>
          )}
          {!!references.length && !turns.some((turn) => turn.id === request.current) && (
            <div className="ai-citations">
              <span className="eyebrow">Source references</span>
              {references.map((ref) => (
                <button
                  key={`${ref.fileId}:${ref.line}`}
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
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="assistant-source-meta">
          <SourceSummary
            fileCount={fileCount}
            bundle={contextBundle}
            regionKey={regionKey}
            mode={mode}
            ready={ready}
            busy={busy || applying}
            prepare={prepareContext}
            onManage={() => setTab('context')}
          />
        </div>
        <div className="assistant-composer-dock">
          {!!turns.length && (
            <p className="assistant-history-note">
              Follow-ups use the current files/symbol region above. Earlier answers may refer to
              older source.
            </p>
          )}
          <div className="ai-composer assistant-composer">
            <div className="ai-mode-tabs" role="group" aria-label="AI action">
              <button
                aria-pressed={mode === 'ask'}
                disabled={busy || applying}
                onClick={() => setMode('ask')}
              >
                Ask
              </button>
              <button
                aria-pressed={mode === 'propose'}
                disabled={busy || applying}
                onClick={() => setMode('propose')}
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
                  : 'Describe the change you want to make…'
              }
              value={question}
              maxLength={8000}
              rows={4}
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
                  (model || configuredId)
                ) {
                  e.preventDefault();
                  void start(mode);
                }
              }}
            />
            {(error || contextWarning) && (
              <p role="alert" className="context-warning">
                {error || contextWarning}
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
                  disabled={!ready || !question.trim() || applying || (!model && !configuredId)}
                  onClick={() => {
                    void start(mode);
                  }}
                >
                  {mode === 'ask' ? 'Ask selection ↗' : 'Propose changes ↗'}
                </button>
              )}
            </div>
          </div>
          <p className="ai-disclosure">
            {!fileCount
              ? 'Select files on the graph to begin.'
              : sync !== 'up-to-date'
                ? 'Waiting for graph synchronization…'
                : 'Selected source is prepared automatically and sent only when you submit.'}
          </p>
          {usage && (
            <p className="helper-text">
              {usage.inputTokens.toLocaleString()} / {usage.maxInputTokens.toLocaleString()} input
              tokens · {usage.historyTurns} prior turns included
            </p>
          )}
        </div>
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
            conflict={conflict}
            onRegenerate={() => {
              setMode('propose');
              setTab('chat');
              requestAnimationFrame(() => input.current?.focus());
            }}
            onApply={() => setApplying(true)}
          />
        )}
        {verification && (
          <VerificationPanel
            report={verification}
            error={verificationError}
            include={includeVerification}
            onInclude={setIncludeVerification}
            onAction={onAction}
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
        {contextContent}
      </div>
    </section>
  );
}
