import { useEffect, useRef, useState } from 'react';
import type { AiGraphAction } from '../../shared/ai-actions';
import type { AiTurn } from '../../shared/conversation';
import type { AiModelInfo, AiProposal, AiReference } from '../../shared/ai';
import type { VerificationReport } from '../../shared/verification';
import type { HostMessage, SyncState } from '../../shared/model';
import type { PreparedContext } from './useContextPreview';
import { send } from '../bridge';
import type { CodingPlan } from '../../shared/ai-plan';

export interface AssistantSessionOptions {
  prepareContext: (action?: 'ask' | 'propose' | 'plan') => Promise<PreparedContext>;
  onAction: (action: AiGraphAction) => void;
  regionKey: string;
  conversationKey: string;
  rootId: string;
  revision: number;
  fileCount: number;
  sync: SyncState;
  intent?: {
    mode: 'ask' | 'propose' | 'plan';
    id: string;
    tab?: 'chat' | 'plan' | 'changes' | 'verify' | 'context';
  };
  editableFileIds?: string[];
}
/** Keeps the request, draft and review session alive while the user switches tabs. */
export function useAssistantSession({
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
}: AssistantSessionOptions) {
  const [tab, setTab] = useState<'chat' | 'plan' | 'changes' | 'verify' | 'context'>('chat');
  const input = useRef<HTMLTextAreaElement>(null);
  const chatScroll = useRef<HTMLDivElement>(null);
  const followAnswer = useRef(true);
  useEffect(() => {
    if (intent) {
      setMode(intent.mode);
      setTab(intent.tab ?? (intent.mode === 'plan' ? 'plan' : 'chat'));
      requestAnimationFrame(() => input.current?.focus());
    }
  }, [intent?.id]);
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
  const [pendingAction, setPendingAction] = useState<string>();
  const actionHandler = useRef(onAction);
  actionHandler.current = onAction;
  const currentGraph = useRef({ rootId, revision });
  currentGraph.current = { rootId, revision };
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
  const [mode, setMode] = useState<'ask' | 'propose' | 'plan'>('ask');
  const [preparing, setPreparing] = useState(false);
  const [verificationHistory, setVerificationHistory] = useState<VerificationReport[]>([]);
  const [verification, setVerification] = useState<VerificationReport>();
  const [verificationError, setVerificationError] = useState('');
  const [includeVerification, setIncludeVerification] = useState(false);
  const [appliedIds, setAppliedIds] = useState<string[]>();
  const [proposalState, setProposalState] = useState('ready');
  const [proposal, setProposal] = useState<AiProposal>();
  const [plan, setPlan] = useState<CodingPlan>();
  const [references, setReferences] = useState<AiReference[]>([]);
  const [reviewed, setReviewed] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);
  const [conflict, setConflict] = useState<{ fileId: string; changeId?: string }>();
  const request = useRef<string | undefined>(undefined);
  const proposalId = useRef<string | undefined>(undefined);
  useEffect(() => {
    const receive = (event: MessageEvent<HostMessage>) => {
      const value = event.data;
      if (value.type === 'aiVerificationHistory' && value.rootId === currentGraph.current.rootId) {
        setVerificationHistory(value.reports);
      } else if (
        value.type === 'aiVerification' &&
        value.report.rootId === currentGraph.current.rootId
      ) {
        setVerification(value.report);
        setVerificationError('');
        if (value.report.stale) {
          setIncludeVerification(false);
        }
      } else if (value.type === 'aiVerificationError') {
        setVerificationError(value.message);
      } else if (
        value.type === 'aiProposalState' &&
        value.rootId === currentGraph.current.rootId &&
        value.regionKey === conversation.current
      ) {
        setProposal(value.proposal);
        proposalId.current = value.proposal.id;
        setProposalState(value.state);
        setAppliedIds(value.appliedIds);
        setReviewed(value.reviewed);
      } else if (value.type === 'aiAction') {
        setPendingAction(undefined);
        if (
          value.rootId === currentGraph.current.rootId &&
          value.revision === currentGraph.current.revision &&
          value.regionKey === conversation.current
        ) {
          actionHandler.current(value.action);
        }
      } else if (value.type === 'aiActionError') {
        setPendingAction(undefined);
        setError(value.message);
      } else if (value.type === 'aiConversation' && value.regionKey === conversation.current) {
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
          if (value.proposal) {
            setProposal(value.proposal);
            setProposalState('ready');
            setAppliedIds(undefined);
            proposalId.current = value.proposal.id;
            setTab('changes');
          }
          if (value.plan) {
            setPlan(value.plan);
            setTab('plan');
          }
          setReferences(value.references ?? []);
        }
      } else if (value.type === 'aiDiffOpened' && value.proposalId === proposalId.current) {
        setReviewed((ids) => [...new Set([...ids, ...value.changeIds])]);
      } else if (value.type === 'aiApplied' && value.proposalId === proposalId.current) {
        setApplying(false);
        setConflict(value.conflict);
        setError(value.error ?? '');
        if (!value.error) {
          setProposalState('applied');
          setTab('verify');
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
    setPendingAction(undefined);
    setBusy(false);
    setPreparing(false);
    setApplying(false);
    setReferences([]);
    setError('');
    setText('');
  }, [regionKey]);
  useEffect(() => {
    setProposal(undefined);
    setPlan(undefined);
    setConflict(undefined);
    proposalId.current = undefined;
    setReviewed([]);
    setTurns([]);
    setUsage(undefined);
    send({ type: 'aiHistory', rootId, regionKey: conversationKey });
    send({ type: 'aiStatus' });
  }, [rootId, conversationKey]);
  useEffect(() => {
    setVerification(undefined);
    setVerificationHistory([]);
    setIncludeVerification(false);
    setVerificationError('');
    send({ type: 'aiStatus' });
  }, [rootId]);
  useEffect(() => {
    if (sync !== 'up-to-date') {
      request.current = undefined;
      setPreparing(false);
      send({ type: 'aiCancel' });
      setBusy(false);
    }
  }, [sync]);
  useEffect(() => {
    if (tab === 'chat' && followAnswer.current && chatScroll.current) {
      chatScroll.current.scrollTop =
        text || turns.length || busy ? chatScroll.current.scrollHeight : 0;
    }
  }, [text, turns, busy, tab]);
  const ready = fileCount > 0 && sync === 'up-to-date';
  const stop = () => {
    request.current = undefined;
    send({ type: 'aiCancel' });
    setBusy(false);
    setPreparing(false);
    setError('Request stopped.');
  };
  const start = async (action: 'ask' | 'propose' | 'plan', planStepIds?: string[]) => {
    const requestId = crypto.randomUUID();
    request.current = requestId;
    proposalId.current = undefined;
    setTab(action === 'plan' ? 'plan' : 'chat');
    if (action === 'plan') {
      setPlan(undefined);
    }
    followAnswer.current = true;
    setBusy(true);
    setPreparing(true);
    setProposal(undefined);
    setConflict(undefined);
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
        ...(action !== 'ask' && editableFileIds
          ? {
              editableFileIds: editableFileIds.filter((id) =>
                prepared.bundle.files.some((f) => f.id === id),
              ),
            }
          : {}),
        ...(action === 'propose' && plan && planStepIds ? { planId: plan.id, planStepIds } : {}),
        ...(includeVerification &&
        verification &&
        !verification.stale &&
        verification.test?.state !== 'running'
          ? { verificationId: verification.id }
          : {}),
      });
    } catch (error) {
      if (request.current === requestId) {
        setBusy(false);
        setPreparing(false);
        setError(String(error));
      }
    }
  };
  return {
    conflict,
    plan,
    setPlan,
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
  };
}
