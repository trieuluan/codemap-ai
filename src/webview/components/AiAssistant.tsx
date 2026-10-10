import type { AiTurn } from '../../shared/conversation';
import { AiMarkdown } from './AiMarkdown';
import type { PreparedContext } from '../hooks/useContextPreview';
import React, { useEffect, useRef, useState } from 'react';
import type { AiModelInfo, AiProposal, AiReference } from '../../shared/ai';
import type { HostMessage, SyncState } from '../../shared/model';
import { send } from '../bridge';

export function AiAssistant({
  prepareContext,
  regionKey,
  conversationKey,
  rootId,
  revision,
  fileCount,
  sync,
}: {
  prepareContext: (action?: 'ask' | 'propose') => Promise<PreparedContext>;
  regionKey: string;
  conversationKey: string;
  rootId: string;
  revision: number;
  fileCount: number;
  sync: SyncState;
}) {
  const [turns, setTurns] = useState<AiTurn[]>([]);
  const [connection, setConnection] = useState<{ state: string; message: string }>({
    state: 'unknown',
    message: '',
  });
  const [usage, setUsage] = useState<{
    inputTokens: number;
    maxInputTokens: number;
    historyTurns: number;
  }>();
  const [copied, setCopied] = useState('');
  const conversation = useRef(conversationKey);
  conversation.current = conversationKey;
  const [model, setModel] = useState<AiModelInfo>();
  const [configuredId, setConfiguredId] = useState('');
  const [modelError, setModelError] = useState('');
  const [question, setQuestion] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'ask' | 'propose'>('ask');
  const [preparing, setPreparing] = useState(false);
  const [proposal, setProposal] = useState<AiProposal>();
  const [references, setReferences] = useState<AiReference[]>([]);
  const [reviewed, setReviewed] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);
  const request = useRef<string | undefined>(undefined);
  const proposalId = useRef<string | undefined>(undefined);
  useEffect(() => {
    const receive = (event: MessageEvent<HostMessage>) => {
      const value = event.data;
      if (value.type === 'aiConversation' && value.regionKey === conversation.current) {
        setTurns(value.turns);
      } else if (value.type === 'aiConnection') {
        setConnection(value);
      } else if (value.type === 'aiCopied') {
        setCopied(value.requestId);
      } else if (value.type === 'aiUsage' && value.requestId === request.current) {
        setUsage(value);
      } else if (value.type === 'aiModel') {
        setModel(value.model);
        setConfiguredId(value.configuredId);
        setModelError(value.error ?? '');
      } else if (value.type === 'aiProgress' && value.requestId === request.current) {
        setBusy(!value.done);
        if (value.text) {
          setText(value.text);
        }
        setError(value.error ?? '');
        if (value.done) {
          if (!value.error) {
            setConnection({ state: 'ready', message: 'Model responded successfully.' });
          }
          setProposal(value.proposal);
          proposalId.current = value.proposal?.id;
          setReferences(value.references ?? []);
        }
      } else if (value.type === 'aiDiffOpened' && value.proposalId === proposalId.current) {
        setReviewed((ids) => [...new Set([...ids, value.fileId])]);
      } else if (value.type === 'aiApplied' && value.proposalId === proposalId.current) {
        setApplying(false);
        setError(value.error ?? '');
        if (!value.error) {
          setProposal(undefined);
          proposalId.current = undefined;
          setText('Changes applied to editor buffers. Review and save them when ready.');
        }
      }
    };
    window.addEventListener('message', receive);
    send({ type: 'aiStatus' });
    return () => {
      window.removeEventListener('message', receive);
      send({ type: 'aiCancel' });
    };
  }, []);
  useEffect(() => {
    send({ type: 'aiCancel' });
    request.current = undefined;
    proposalId.current = undefined;
    setBusy(false);
    setPreparing(false);
    setApplying(false);
    setProposal(undefined);
    setReferences([]);
    setReviewed([]);
    setError('');
    setText('');
  }, [regionKey]);
  useEffect(() => {
    setTurns([]);
    setUsage(undefined);
    send({ type: 'aiHistory', rootId, regionKey: conversationKey });
  }, [rootId, conversationKey]);
  useEffect(() => {
    if (sync !== 'up-to-date') {
      request.current = undefined;
      setPreparing(false);
      send({ type: 'aiCancel' });
      setBusy(false);
    }
  }, [sync]);
  const ready = fileCount > 0 && sync === 'up-to-date';
  const stop = () => {
    request.current = undefined;
    send({ type: 'aiCancel' });
    setBusy(false);
    setPreparing(false);
    setError('Request stopped.');
  };
  const start = async (action: 'ask' | 'propose') => {
    const requestId = crypto.randomUUID();
    request.current = requestId;
    proposalId.current = undefined;
    setBusy(true);
    setPreparing(true);
    setProposal(undefined);
    setReferences([]);
    setReviewed([]);
    setText('');
    setError('');
    setUsage(undefined);
    setCopied('');
    try {
      const prepared = await prepareContext(action);
      if (request.current !== requestId) {
        return;
      }
      setPreparing(false);
      send({
        type: 'aiRequest',
        rootId: prepared.bundle.rootId,
        contextId: prepared.contextId,
        requestId,
        question,
        mode: action,
      });
    } catch (error) {
      if (request.current === requestId) {
        setBusy(false);
        setPreparing(false);
        setError(String(error));
      }
    }
  };
  return (
    <section className="ai-assistant" aria-label="CodeMap AI">
      <div className="ai-section-title">
        <div className="ai-identity">
          <span className="ai-avatar" aria-hidden="true">
            ✦
          </span>
          <div>
            <strong>CodeMap Assistant</strong>
            <small>Understand & improve your code</small>
          </div>
        </div>
        <span
          className={`ai-connection ${connection.state === 'ready' ? 'connected' : ''}`}
          title="Models supplied by VS Code"
        >
          {connection.state === 'checking'
            ? 'Checking…'
            : connection.state === 'ready'
              ? 'Verified'
              : model || configuredId
                ? 'Selected'
                : 'Set up'}
        </span>
      </div>
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
      <div className="ai-composer">
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
          aria-label="Ask about selected source"
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
      {!question && !text && !busy && !turns.length && (
        <div className="ai-suggestions">
          {['Explain this region', 'Find potential issues'].map((prompt) => (
            <button
              key={prompt}
              onClick={() => {
                setMode('ask');
                setQuestion(prompt);
              }}
            >
              {prompt}
            </button>
          ))}
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
      {proposal && (
        <div className="ai-proposal">
          <span className="eyebrow">{proposal.changes.length} proposed file changes</span>
          {proposal.changes.map((change) => (
            <div className="ai-change" key={change.fileId}>
              <span title={change.path}>{change.path}</span>
              <button
                onClick={() => {
                  send({ type: 'aiDiff', proposalId: proposal.id, fileId: change.fileId });
                }}
              >
                {reviewed.includes(change.fileId) ? 'Reopen diff' : 'Review diff'}
              </button>
            </div>
          ))}
          {!!proposal.changes.length && (
            <>
              <p className="helper-text">
                Review each diff before applying. Source changes since preview will block Apply.
                Changes remain unsaved and can be undone in VS Code.
              </p>
              <button
                className="primary"
                disabled={!ready || applying || reviewed.length !== proposal.changes.length}
                onClick={() => {
                  setApplying(true);
                  send({ type: 'aiApply', proposalId: proposal.id });
                }}
              >
                {applying ? 'Applying…' : 'Apply reviewed changes'}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
