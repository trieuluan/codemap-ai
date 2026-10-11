import { verificationFailureScope, type VerificationReport } from '../shared/verification';
import type { AiGraphAction } from '../shared/ai-actions';
import { ArchitecturePanel, ArchitectureNodeLabel } from './components/ArchitecturePanel';
import { ContextPanel } from './components/ContextPanel';
import { readLibrary, targetKey } from '../shared/library';
import { reconcileLocation, resolveAnchor, type NavigationLocation } from '../shared/navigation';
import { symbolNodeId } from '../shared/investigation';
import { useHistory } from './hooks/useHistory';
import { LibraryPanel, AnnotationEditor } from './components/WorkspaceLibrary';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  Position,
  useNodesState,
  type Node,
  type Edge,
} from '@xyflow/react';
import type { GraphSnapshot, GraphViewState, HostMessage, SyncState } from '../shared/model';
import {
  defaultView,
  layoutKey,
  projectGraph,
  readView,
  reconcileView,
  revealFile,
  switchLayout,
} from '../shared/view';
import { send } from './bridge';
import { width, height, layout } from './graph-layout';
import { useHostMessages } from './hooks/useHostMessages';
import { useCanvasNavigation } from './hooks/useCanvasNavigation';
import { FileNodeLabel } from './components/FileNodeLabel';
import { DetailsPanel } from './components/DetailsPanel';
import { ViewOptions } from './components/ViewOptions';
import { GraphToolbar } from './components/GraphToolbar';
import { InvestigationPanel } from './components/InvestigationPanel';
import { ShowPathContext } from './components/ImportRoute';
import { graphForPath, withSymbols, type ImpactTarget } from '../shared/investigation';
import {
  createWorkingSet,
  extendWorkingSet,
  workingDisplay,
  readWorkingSet,
  type WorkingSet,
} from '../shared/working-set';
import { WorkingSetPanel } from './components/WorkingSetPanel';
import { importDelta, reviewFileState, type ReviewState } from '../shared/review-graph';
import type { CodingPlan } from '../shared/ai-plan';

const syncLabels: Record<SyncState, string> = {
  'up-to-date': 'Up to date',
  'out-of-date': 'Out of date',
  updating: 'Updating',
  error: 'Error',
};
export function App() {
  const [snapshot, setSnapshot] = useState<GraphSnapshot>();
  const [view, setView] = useState(defaultView);
  const viewRef = useRef(view);
  const rootId = useRef<string | undefined>(undefined);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [library, setLibrary] = useState(() => readLibrary(undefined));
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [overviewDepth, setOverviewDepth] = useState(2);
  const [taskStage, setTaskStage] = useState<'explore' | 'plan' | 'review' | 'verify'>('explore');
  const [assistantIntent, setAssistantIntent] = useState<{
    mode: 'ask' | 'propose' | 'plan';
    id: string;
    tab?: 'chat' | 'plan' | 'changes' | 'verify' | 'context';
  }>();
  const [contextOpen, setContextOpen] = useState(false);
  const [contextIds, setContextIds] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [sync, setSync] = useState<SyncState>('up-to-date');
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState('Preparing CodeMap…');
  const [error, setError] = useState('');
  const [empty, setEmpty] = useState({ message: '', openFolder: false });
  const [groupSelection, setGroupSelection] = useState<string>();
  const [contextId, setContextId] = useState<string>();
  const [peekGroups, setPeekGroups] = useState<string[]>([]);
  const [edgeSelection, setEdgeSelection] = useState<string>();
  const [effectiveSourceIds, setEffectiveSourceIds] = useState<string[]>([]);
  const [activeFileId, setActiveFileId] = useState<string>();
  const [revealRequest, setRevealRequest] = useState<{ nodeId: string }>();
  const [aiRegion, setAiRegion] = useState<string[]>();
  const [fileStatus, setFileStatus] = useState<
    Extract<HostMessage, { type: 'fileStatus' }>['files']
  >([]);
  const [verification, setVerification] = useState<VerificationReport>();
  const failureScope = useMemo(() => verificationFailureScope(verification), [verification]);
  const [codingPlan, setCodingPlan] = useState<CodingPlan>();
  const reviewConversation = useRef<string | undefined>(undefined);
  const [review, setReview] = useState<ReviewState>();
  const [graphPreview, setGraphPreview] =
    useState<Extract<HostMessage, { type: 'aiGraphPreview' }>>();
  const [graphLayer, setGraphLayer] = useState<'current' | 'before' | 'proposed' | 'applied'>(
    'current',
  );
  const [hoveredEdge, setHoveredEdge] = useState<string>();
  const task = view.workingSet;
  const mappedSnapshot = useMemo(
    () =>
      graphLayer === 'before' && graphPreview
        ? graphPreview.before
        : graphLayer === 'proposed' && graphPreview
          ? {
              ...graphPreview.proposed,
              edges: [
                ...graphPreview.proposed.edges,
                ...importDelta(graphPreview.before, graphPreview.proposed).removed,
              ],
            }
          : snapshot,
    [graphLayer, graphPreview, snapshot],
  );
  // A preview is valid only for the exact accepted edits and source revision.
  useEffect(() => {
    if (graphLayer !== 'proposed' || !graphPreview || !review) {
      return;
    }
    if (
      review.state !== 'ready' ||
      graphPreview.before.revision !== snapshot?.revision ||
      graphPreview.changeIds.slice().sort().join() !== review.accepted.slice().sort().join()
    ) {
      setGraphLayer('current');
    }
  }, [graphLayer, graphPreview, review, snapshot?.revision]);
  useEffect(() => {
    if (
      graphLayer === 'applied' &&
      (!review ||
        verification?.proposalId !== review.proposal.id ||
        verification.stale ||
        verification.changedFiles.some((f) => f.sourceState && f.sourceState !== 'applied'))
    ) {
      setGraphLayer('current');
    }
  }, [graphLayer, review, verification]);
  const [tracePath, setTracePath] = useState<string[]>();
  const [symbolsFileId, setSymbolsFileId] = useState<string>();
  const [selectedSymbolId, setSelectedSymbolId] = useState<string>();
  const [impactTarget, setImpactTarget] = useState<ImpactTarget>();
  const inspectionPositions = useRef<GraphViewState['positions']>({});
  const inspecting = !!aiRegion || !!tracePath || !!symbolsFileId || overviewOpen;
  const canvasKey = aiRegion
    ? `region:${JSON.stringify(aiRegion)}`
    : overviewOpen
      ? `architecture:${overviewDepth}`
      : tracePath
        ? `path:${JSON.stringify(tracePath)}`
        : symbolsFileId
          ? `symbols:${symbolsFileId}`
          : task
            ? 'working-set'
            : layoutKey(view);
  const clearInspection = (record = true) => {
    if (record) {
      history.begin();
    }
    setOverviewOpen(false);
    setAiRegion(undefined);
    setTracePath(undefined);
    setSymbolsFileId(undefined);
    setSelectedSymbolId(undefined);
    inspectionPositions.current = {};
    needsViewport.current = true;
    readyToSaveViewport.current = false;
  };
  const showPath = (path: string[]) => {
    setAiRegion(undefined);
    setOverviewOpen(false);
    history.begin();
    pendingCenter.current = undefined;
    fitMembers.current = undefined;
    setTracePath(path);
    setSymbolsFileId(undefined);
    setSelectedSymbolId(undefined);
    inspectionPositions.current = {};
    arrangePeek.current = true;
    needsViewport.current = true;
    readyToSaveViewport.current = false;
  };
  const arrangePeek = useRef(false);
  const {
    flow,
    restoredViewport,
    canvasRef,
    fitCanvas,
    needsViewport,
    fitMembers,
    pendingCenter,
    readyToSaveViewport,
  } = useCanvasNavigation(nodes, canvasKey, viewRef, inspecting);
  const applyView = useCallback((next: GraphViewState, save = true) => {
    viewRef.current = next;
    setView(next);
    if (save && rootId.current) {
      send({ type: 'saveView', rootId: rootId.current, state: next });
    }
  }, []);
  const capture = (): NavigationLocation => {
    const selected = snapshot?.nodes
      .flatMap((n) => (n.declarations ?? []).map((symbol) => ({ nodeId: n.id, symbol })))
      .find((item) => symbolNodeId(item.nodeId, item.symbol.id) === selectedSymbolId);
    const impactSymbol = snapshot?.nodes
      .find((n) => n.id === impactTarget?.nodeId)
      ?.declarations?.find((symbol) => symbol.id === impactTarget?.symbolId);
    return {
      view: {
        ...viewRef.current,
        viewport: inspecting ? viewRef.current.viewport : flow.getViewport(),
      },
      overviewDepth: overviewOpen ? overviewDepth : undefined,
      viewport: flow.getViewport(),
      path: tracePath,
      region: aiRegion,
      symbolsFileId,
      symbol: selected
        ? { nodeId: selected.nodeId, name: selected.symbol.name, kind: selected.symbol.kind }
        : undefined,
      impact: impactTarget
        ? {
            nodeId: impactTarget.nodeId,
            symbol: impactSymbol
              ? { nodeId: impactTarget.nodeId, name: impactSymbol.name, kind: impactSymbol.kind }
              : undefined,
          }
        : undefined,
      contextId,
      group: groupSelection,
      peek: peekGroups,
      positions: { ...inspectionPositions.current },
    };
  };
  const restore = (saved: NavigationLocation) => {
    if (JSON.stringify(saved.view.workingSet) !== JSON.stringify(viewRef.current.workingSet)) {
      setCodingPlan(undefined);
      setReview(undefined);
      setGraphPreview(undefined);
      setGraphLayer('current');
    }

    setOverviewOpen(false);
    if (!snapshot) {
      return;
    }
    const { location, stale } = reconcileLocation(saved, snapshot);
    setNotice(
      stale
        ? 'Some files, symbols, or path edges no longer exist. Restored the available view.'
        : '',
    );
    setOverviewOpen(!!location.overviewDepth);
    if (location.overviewDepth) {
      setOverviewDepth(location.overviewDepth);
    }
    setAiRegion(location.region);
    setTracePath(location.path);
    setSymbolsFileId(location.symbolsFileId);
    const symbol = resolveAnchor(snapshot, location.symbol);
    setSelectedSymbolId(
      symbol && location.symbol ? symbolNodeId(location.symbol.nodeId, symbol.id) : undefined,
    );
    const impactSymbol = resolveAnchor(snapshot, location.impact?.symbol);
    setImpactTarget(
      location.impact ? { nodeId: location.impact.nodeId, symbolId: impactSymbol?.id } : undefined,
    );
    setContextId(location.contextId);
    setGroupSelection(location.group);
    setPeekGroups(location.peek);
    if (location.view.workingSet) {
      setContextIds(location.view.workingSet.context);
    } else if (viewRef.current.workingSet) {
      setContextIds([]);
    }
    setEdgeSelection(undefined);
    inspectionPositions.current = { ...location.positions };
    arrangePeek.current = false;
    pendingCenter.current = undefined;
    fitMembers.current = undefined;
    readyToSaveViewport.current = false;
    needsViewport.current = true;
    restoredViewport.current = location.viewport;
    applyView({
      ...location.view,
      autoUpdate: viewRef.current.autoUpdate,
      followEditor: viewRef.current.followEditor,
    });
  };
  const history = useHistory(snapshot?.root.id, capture, restore);
  const updateView = (patch: Partial<GraphViewState>) =>
    applyView({ ...viewRef.current, ...patch });
  const changeLayout = (mode: GraphViewState['mode'], depth = viewRef.current.depth) => {
    clearInspection();
    setGroupSelection(undefined);
    setPeekGroups([]);
    setEdgeSelection(undefined);
    needsViewport.current = true;
    readyToSaveViewport.current = false;
    fitMembers.current = undefined;
    pendingCenter.current = undefined;
    applyView(
      switchLayout(
        {
          ...viewRef.current,
          viewport: inspecting ? viewRef.current.viewport : flow.getViewport(),
        },
        mode,
        depth,
      ),
    );
  };
  useHostMessages((message: HostMessage) => {
    switch (message.type) {
      case 'aiReferenceOpened':
        if (
          message.rootId === rootId.current &&
          snapshot?.nodes.some((n) => n.id === message.nodeId)
        ) {
          selectFile(message.nodeId);
        }
        break;
      case 'fileStatus':
        if (message.rootId === rootId.current) {
          setFileStatus(message.files);
        }
        break;
      case 'aiVerification':
        if (message.report.rootId === rootId.current) {
          setVerification(message.report);
        }
        break;
      case 'aiProgress':
        if (message.plan?.rootId === rootId.current) {
          setCodingPlan(message.plan);
          setTaskStage('plan');
        }
        break;
      case 'aiProposalState':
        if (
          message.rootId === rootId.current &&
          (!reviewConversation.current || message.regionKey === reviewConversation.current)
        ) {
          setReview((old) => ({
            proposal: message.proposal,
            accepted:
              old?.proposal.id === message.proposal.id
                ? old.accepted
                : message.proposal.changes.map((c) => c.id),
            reviewed: message.reviewed,
            state: message.state,
            applied: message.appliedIds ?? [],
          }));
          const reviewChanged =
            review?.proposal.id !== message.proposal.id || review?.state !== message.state;
          if (reviewChanged && message.state === 'ready') {
            setTaskStage('review');
          }
          if (reviewChanged && message.state === 'applied') {
            setTaskStage('verify');
            setGraphLayer('applied');
          }
          if (graphPreview?.proposalId !== message.proposal.id) {
            setGraphPreview(undefined);
            setGraphLayer('current');
          }
        }
        break;
      case 'aiDiffOpened':
        setReview((old) =>
          old?.proposal.id === message.proposalId
            ? { ...old, reviewed: [...new Set([...old.reviewed, ...message.changeIds])] }
            : old,
        );
        break;
      case 'aiGraphPreview':
        if (
          message.before.root.id === rootId.current &&
          message.proposalId === review?.proposal.id
        ) {
          setGraphPreview(message);
          setGraphLayer('proposed');
          clearInspection();
        }
        break;
      case 'aiGraphPreviewError':
        setNotice(message.message);
        break;
      case 'library':
        if (message.rootId === rootId.current) {
          setLibrary(readLibrary(message.library));
        }
        break;
      case 'activeFile':
        setActiveFileId(message.nodeId);
        if (message.reveal && message.nodeId) {
          setRevealRequest({ nodeId: message.nodeId });
        }
        break;
      case 'snapshot': {
        const next = message.snapshot;
        const sameRoot = rootId.current === next.root.id;
        if (!sameRoot) {
          setFileStatus([]);
          setVerification(undefined);
          setTaskStage('explore');
          setCodingPlan(undefined);
          setReview(undefined);
          setGraphPreview(undefined);
          setGraphLayer('current');
          clearInspection(false);
          setImpactTarget(undefined);
          setQuery('');
          setContextId(undefined);
          setPeekGroups([]);
          setEdgeSelection(undefined);
          needsViewport.current = true;
          readyToSaveViewport.current = false;
        }
        rootId.current = next.root.id;
        const restored = reconcileView(
          sameRoot ? viewRef.current : readView(message.viewState),
          next,
        );
        if (sameRoot && snapshot) {
          const previous = capture();
          const symbol = resolveAnchor(next, previous.symbol);
          if (previous.symbol) {
            setSelectedSymbolId(
              symbol ? symbolNodeId(previous.symbol.nodeId, symbol.id) : undefined,
            );
          }
          if (previous.impact?.symbol) {
            const impactSymbol = resolveAnchor(next, previous.impact.symbol);
            setImpactTarget(
              impactSymbol
                ? { nodeId: previous.impact.nodeId, symbolId: impactSymbol.id }
                : undefined,
            );
          }
          if (viewRef.current.selected && !restored.selected) {
            setNotice('The selected file or folder was deleted or renamed. Selection cleared.');
          }
        }
        // Initial viewState is sent before the first snapshot.
        applyView(restored, false);
        if (!sameRoot) {
          setContextIds(restored.workingSet?.context ?? []);
        }
        setSnapshot(next);
        setError('');
        setEmpty({
          message: next.nodes.length ? '' : 'No supported source files found.',
          openFolder: false,
        });
        break;
      }
      case 'viewState':
        if (rootId.current !== message.rootId) {
          setReview(undefined);
          setGraphPreview(undefined);
          setCodingPlan(undefined);
          setFileStatus([]);
          setGraphLayer('current');
        }
        setRevealRequest(undefined);
        clearInspection(false);
        setImpactTarget(undefined);
        rootId.current = message.rootId;
        applyView(readView(message.state), false);
        setContextIds(readView(message.state).workingSet?.context ?? []);
        setContextId(undefined);
        setPeekGroups([]);
        setEdgeSelection(undefined);
        needsViewport.current = true;
        readyToSaveViewport.current = false;
        setGroupSelection(undefined);
        break;
      case 'sync':
        setSync(message.state);
        applyView({ ...viewRef.current, autoUpdate: message.autoUpdate }, false);
        break;
      case 'status':
        setScanning(message.scanning);
        setStatus(message.message);
        if (message.scanning) {
          setError('');
        }
        break;
      case 'empty':
        setRevealRequest(undefined);
        clearInspection(false);
        setImpactTarget(undefined);
        setActiveFileId(undefined);
        rootId.current = undefined;
        setLibrary(readLibrary(undefined));
        setLibraryOpen(false);
        setContextOpen(false);
        setContextIds([]);
        setNotice('');
        needsViewport.current = true;
        readyToSaveViewport.current = false;
        setSnapshot(undefined);
        setNodes([]);
        setGroupSelection(undefined);
        setEmpty(message);
        break;
      case 'error':
        setError(message.message);
        break;
    }
  });
  useEffect(() => {
    if (!snapshot) {
      return;
    }
    const valid = new Set(snapshot.nodes.map((n) => n.id));
    setContextIds((ids) =>
      ids.every((id) => valid.has(id)) ? ids : ids.filter((id) => valid.has(id)),
    );
  }, [snapshot]);
  const filesById = useMemo(
    () => new Map(snapshot?.nodes.map((node) => [node.id, node]) ?? []),
    [snapshot],
  );
  const contextFile = snapshot?.nodes.find((node) => node.id === (contextId ?? view.selected));
  const display = useMemo(() => {
    if (!mappedSnapshot) {
      return { nodes: [], edges: [], visibleFiles: 0 };
    }
    if (task && !inspecting) {
      return workingDisplay(mappedSnapshot, task);
    }
    const source = aiRegion
      ? {
          ...mappedSnapshot,
          nodes: mappedSnapshot.nodes.filter((n) => aiRegion.includes(n.id)),
          edges: mappedSnapshot.edges.filter(
            (e) => aiRegion.includes(e.source) && aiRegion.includes(e.target),
          ),
        }
      : tracePath
        ? graphForPath(mappedSnapshot, tracePath)
        : symbolsFileId
          ? {
              ...mappedSnapshot,
              nodes: mappedSnapshot.nodes.filter((node) => node.id === symbolsFileId),
              edges: [],
            }
          : mappedSnapshot;
    const state = inspecting
      ? {
          ...view,
          mode: overviewOpen ? ('folders' as const) : ('files' as const),
          depth: overviewOpen ? overviewDepth : view.depth,
          expanded: overviewOpen ? [] : view.expanded,
          folder: '',
          hideTests: false,
          hideIsolated: false,
          focus: 0 as const,
        }
      : view;
    return withSymbols(
      projectGraph(
        source,
        state,
        overviewOpen ? undefined : { fileId: contextFile?.id, groups: peekGroups },
      ),
      filesById.get(symbolsFileId ?? ''),
    );
  }, [
    snapshot,
    mappedSnapshot,
    task,
    view,
    contextFile?.id,
    peekGroups,
    tracePath,
    aiRegion,
    symbolsFileId,
    filesById,
    overviewOpen,
    overviewDepth,
  ]);
  const baseEdges: Edge[] = useMemo(
    () =>
      display.edges.map((edge) => ({
        ...edge,
        label:
          edge.relation === 'declaration'
            ? 'declares'
            : `${edge.count} ${edge.count === 1 ? 'file' : 'files'}${edge.symbolCount ? ` · ${edge.symbolCount} ${edge.symbolCount === 1 ? 'symbol' : 'symbols'}` : ''}`,
        ariaLabel:
          edge.relation === 'declaration'
            ? `Declares ${display.nodes.find((node) => node.id === edge.target)?.label}`
            : `Imports from ${display.nodes.find((node) => node.id === edge.source)?.path} to ${display.nodes.find((node) => node.id === edge.target)?.path}`,
        markerEnd: edge.relation === 'declaration' ? undefined : { type: MarkerType.ArrowClosed },
        style: edge.relation === 'declaration' ? { strokeDasharray: '5 5' } : undefined,
        type: 'default',
      })),
    [display],
  );
  const togglePeek = (id?: string) => {
    if (id?.startsWith('boundary:') && task) {
      const members = display.nodes.find((n) => n.id === id)?.members ?? [];
      updateTask(extendWorkingSet(task, members));
      return;
    }
    history.begin();
    setEdgeSelection(undefined);
    setPeekGroups((current) =>
      id ? (current.includes(id) ? current.filter((group) => group !== id) : [...current, id]) : [],
    );
    arrangePeek.current = true;
    needsViewport.current = true;
    readyToSaveViewport.current = false;
    updateView({ viewport: undefined });
  };
  useEffect(() => {
    const current = viewRef.current;
    const positions = inspecting
      ? { ...current.positions, ...inspectionPositions.current }
      : current.positions;
    const initial: Node[] = display.nodes.map((node) => ({
      id: node.id,
      position: positions[node.id] ?? { x: 0, y: 0 },
      initialWidth: width,
      initialHeight: overviewOpen
        ? 96
        : node.kind === 'folder'
          ? 240
          : task || review
            ? 120
            : height,
      sourcePosition: tracePath ? Position.Bottom : Position.Right,
      targetPosition: tracePath ? Position.Top : Position.Left,
      style: {
        width,
        height: overviewOpen ? 96 : node.kind === 'folder' ? 240 : task || review ? 120 : height,
      },
      data: {
        layoutKey: canvasKey,
        label: overviewOpen ? (
          <ArchitectureNodeLabel
            node={node}
            incoming={display.edges
              .filter((edge) => edge.target === node.id)
              .reduce((count, edge) => count + edge.count, 0)}
            outgoing={display.edges
              .filter((edge) => edge.source === node.id)
              .reduce((count, edge) => count + edge.count, 0)}
          />
        ) : (
          <FileNodeLabel
            onIssue={
              node.members.some(
                (id) => failureScope.diagnostics.has(id) || failureScope.testScope.has(id),
              )
                ? () => {
                    const index =
                      verification?.diagnostics.findIndex(
                        (d) => node.members.includes(d.fileId) && d.severity === 'error',
                      ) ?? -1;
                    if (index >= 0 && verification) {
                      send({ type: 'aiOpenDiagnostic', reportId: verification.id, index });
                    } else {
                      setContextOpen(true);
                      setLibraryOpen(false);
                      setAssistantIntent({ mode: 'ask', id: crypto.randomUUID(), tab: 'verify' });
                    }
                  }
                : undefined
            }
            badges={[
              ...(node.members.includes(activeFileId ?? '') ? ['Active editor'] : []),
              ...(node.members.some((id) => effectiveSourceIds.includes(id)) ? ['AI source'] : []),
              ...(node.members.some((id) => failureScope.testScope.has(id))
                ? ['Failed test scope']
                : []),
              ...(node.members.some((id) => fileStatus.some((f) => f.id === id && f.dirty))
                ? ['Unsaved']
                : []),
              ...(node.members.some((id) => fileStatus.some((f) => f.id === id && f.errors))
                ? ['Errors']
                : []),
              ...(task?.pinned.some((id) => node.members.includes(id)) ? ['Pinned'] : []),
              ...(task?.editable.some((id) => node.members.includes(id)) ? ['Editable'] : []),
              ...(codingPlan &&
              codingPlan.revision === snapshot?.revision &&
              codingPlan.steps.some((s) => node.members.includes(s.fileId))
                ? [
                    codingPlan.steps.some(
                      (s) => node.members.includes(s.fileId) && s.role === 'edit',
                    )
                      ? 'Plan edit'
                      : 'Plan read',
                  ]
                : []),
              ...(review && node.kind === 'file' && reviewFileState(review, node.id, verification)
                ? [reviewFileState(review, node.id, verification)!]
                : []),
            ]}
            onReview={
              review?.state === 'ready' &&
              review.proposal.changes.some((c) => node.members.includes(c.fileId))
                ? () => {
                    const candidates = review.proposal.changes.filter(
                      (c) => node.members.includes(c.fileId) && review.accepted.includes(c.id),
                    );
                    const change =
                      candidates.find((c) => !review.reviewed.includes(c.id)) ?? candidates[0];
                    if (change) {
                      send({
                        type: 'aiDiff',
                        proposalId: review.proposal.id,
                        fileId: change.fileId,
                        changeId: change.id,
                      });
                    }
                  }
                : undefined
            }
            node={node}
            annotation={library.annotations.find(
              (a) =>
                targetKey(a.target) ===
                targetKey({
                  kind: node.kind === 'folder' ? 'folder' : 'file',
                  id: node.kind === 'folder' ? node.path : node.id,
                }),
            )}
            contextFile={overviewOpen ? undefined : contextFile}
            filesById={filesById}
            onPeek={togglePeek}
            onInspectImports={(id) => setEdgeSelection(`context:${id}`)}
          />
        ),
      },
      ariaLabel: node.path,
      className:
        node.kind === 'folder' ? 'folder-node' : node.kind === 'symbol' ? 'symbol-node' : '',
    }));
    if (!initial.length) {
      setNodes([]);
      return;
    }
    const savedPositions = Object.values(positions);
    let next = initial;
    const rearrange = arrangePeek.current;
    arrangePeek.current = false;
    if (rearrange || !initial.some((node) => positions[node.id])) {
      next = layout(initial, baseEdges, tracePath ? 'TB' : 'LR');
    } else {
      const right = Math.max(...savedPositions.map((position) => position.x)) + width + 90;
      let index = 0;
      next = initial.map((node) =>
        positions[node.id] ? node : { ...node, position: { x: right, y: index++ * 268 } },
      );
    }
    setNodes(next);
    if (inspecting) {
      inspectionPositions.current = Object.fromEntries(
        next.map((node) => [node.id, node.position]),
      );
      return;
    }
    const missing = next.filter((node) => rearrange || !current.positions[node.id]);
    if (missing.length) {
      applyView({
        ...current,
        positions: {
          ...current.positions,
          ...Object.fromEntries(missing.map((node) => [node.id, node.position])),
        },
      });
    }
  }, [
    display,
    baseEdges,
    setNodes,
    applyView,
    inspecting,
    canvasKey,
    library,
    fileStatus,
    verification,
    failureScope,
    review,
    codingPlan,
    activeFileId,
    effectiveSourceIds,
  ]);
  const selectFile = (id: string) => {
    if (!snapshot) {
      return;
    }
    if (task && !task.files.includes(id)) {
      updateTask(extendWorkingSet(task, [id]));
    }
    clearInspection();
    setImpactTarget(undefined);
    setGroupSelection(undefined);
    needsViewport.current = false;
    pendingCenter.current = id;
    setContextId(id);
    setPeekGroups([]);
    setEdgeSelection(undefined);
    applyView(revealFile(viewRef.current, snapshot, id));
  };
  useEffect(() => {
    const id =
      revealRequest?.nodeId ?? (view.followEditor && !inspecting ? activeFileId : undefined);
    if (id && snapshot?.nodes.some((node) => node.id === id)) {
      selectFile(id);
      setRevealRequest(undefined);
    }
  }, [activeFileId, view.followEditor, snapshot?.root.id, revealRequest]);
  useEffect(() => {
    if (!snapshot) {
      return;
    }
    if (symbolsFileId && !snapshot.nodes.some((node) => node.id === symbolsFileId)) {
      clearInspection(false);
      setNotice('The inspected file or path is no longer available. Returned to graph.');
    }
    if (
      impactTarget &&
      !snapshot.nodes.some(
        (node) =>
          node.id === impactTarget.nodeId &&
          (!impactTarget.symbolId ||
            node.declarations?.some((symbol) => symbol.id === impactTarget.symbolId)),
      )
    ) {
      setImpactTarget(undefined);
    }
    if (
      tracePath &&
      graphForPath(snapshot, tracePath).edges.length <
        new Set(tracePath.slice(1).map((id, index) => JSON.stringify([tracePath[index], id]))).size
    ) {
      clearInspection(false);
      setNotice('The inspected file or path is no longer available. Returned to graph.');
    }
  }, [snapshot]);
  const matches = useMemo(
    () =>
      snapshot?.nodes.filter(
        (node) => query.trim() && node.path.toLowerCase().includes(query.trim().toLowerCase()),
      ) ?? [],
    [snapshot, query],
  );
  const matchingIds = useMemo(() => new Set(matches.map((node) => node.id)), [matches]);
  const decoratedNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        selected: node.id === (selectedSymbolId ?? groupSelection ?? view.selected),
        className: `${node.className ?? ''} ${display.nodes.find((item) => item.id === node.id)?.members.some((id) => effectiveSourceIds.includes(id)) ? 'context-region-node' : ''} ${display.nodes.find((item) => item.id === node.id)?.members.includes(activeFileId ?? '') ? 'active-editor-node' : ''} ${display.nodes.find((item) => item.id === node.id)?.members.some((id) => matchingIds.has(id)) ? 'search-match' : ''}`,
      })),
    [
      nodes,
      selectedSymbolId,
      groupSelection,
      view.selected,
      display.nodes,
      activeFileId,
      matchingIds,
      contextIds,
      effectiveSourceIds,
    ],
  );
  const selected = overviewOpen ? groupSelection : (groupSelection ?? view.selected);
  const contextTarget = edgeSelection?.startsWith('context:') ? edgeSelection.slice(8) : undefined;
  const contextSource = display.nodes.find(
    (node) => contextFile && node.members.includes(contextFile.id),
  )?.id;
  const changeEdges = useMemo(() => {
    const delta =
      graphPreview && graphLayer !== 'current'
        ? importDelta(
            graphPreview.before,
            graphLayer === 'applied' && snapshot ? snapshot : graphPreview.proposed,
          )
        : undefined;
    return {
      added: new Set(delta?.added.map((e) => e.id)),
      removed: new Set(delta?.removed.map((e) => e.id)),
      sources: new Map(display.edges.map((e) => [e.id, e.fileEdges])),
    };
  }, [graphPreview, graphLayer, snapshot, display.edges]);
  const edges = baseEdges.map((edge) => {
    const sources = changeEdges.sources.get(edge.id) ?? [];
    const added = sources.filter((id) => changeEdges.added.has(id)).length;
    const removed = sources.filter((id) => changeEdges.removed.has(id)).length;
    const picked =
      edge.id === edgeSelection ||
      (!!contextTarget && edge.source === contextSource && edge.target === contextTarget);
    return {
      ...edge,
      label:
        added || removed
          ? `+${added} / −${removed}`
          : picked ||
              edge.source === selected ||
              edge.target === selected ||
              hoveredEdge === edge.id
            ? edge.label
            : undefined,
      selected: picked,
      className:
        !added && !removed && (picked || edge.source === selected || edge.target === selected)
          ? 'related-edge'
          : '',
      style: {
        ...edge.style,
        ...(added
          ? { stroke: 'var(--vscode-testing-iconPassed, #4caf80)', strokeWidth: 2 }
          : removed
            ? {
                stroke: 'var(--vscode-testing-iconFailed, #e56b6f)',
                strokeDasharray: '6 4',
                strokeWidth: 2,
              }
            : {}),
        opacity: edgeSelection
          ? picked
            ? 1
            : 0.15
          : selected && edge.source !== selected && edge.target !== selected
            ? 0.2
            : 1,
      },
    };
  });
  const file = filesById.get(view.selected ?? '');
  const group = display.nodes.find(
    (node) => node.id === (groupSelection ?? view.selected) && node.kind === 'folder',
  );
  const contextGroup = display.nodes.find(
    (node) => node.kind === 'folder' && `context:${node.id}` === edgeSelection,
  );
  const contextEdges =
    contextGroup && contextFile
      ? (snapshot?.edges.filter(
          (edge) => edge.source === contextFile.id && contextGroup.members.includes(edge.target),
        ) ?? [])
      : [];
  const inspectedEdge =
    display.edges.find((edge) => edge.id === edgeSelection) ??
    (contextGroup
      ? {
          count: contextEdges.length,
          fileEdges: contextEdges.map((edge) => edge.id),
          symbolCount: contextEdges.reduce(
            (total, edge) =>
              total + edge.sites.reduce((count, site) => count + (site.symbols?.length ?? 0), 0),
            0,
          ),
        }
      : undefined);
  const inspectedImports =
    snapshot?.edges.filter((edge) => inspectedEdge?.fileEdges?.includes(edge.id)) ?? [];
  const outgoing = snapshot?.edges.filter((edge) => edge.source === file?.id) ?? [];
  const incoming = snapshot?.edges.filter((edge) => edge.target === file?.id) ?? [];
  const folders = [
    ...new Set(
      snapshot?.nodes.flatMap((node) =>
        node.path
          .split('/')
          .slice(0, -1)
          .map((_, i) =>
            node.path
              .split('/')
              .slice(0, i + 1)
              .join('/'),
          ),
      ) ?? [],
    ),
  ].sort();
  const maxDepth = Math.max(1, ...folders.map((folder) => folder.split('/').length));
  const updateTask = (next: WorkingSet) => {
    const valid = readWorkingSet({ ...next, name: next.name.trim() ? next.name : 'New task' });
    if (!valid) {
      return;
    }
    updateView({ workingSet: valid });
    setContextIds(valid.context);
  };
  const beginTask = (ids: string[]) => {
    if (!ids.length) {
      setNotice('Select files or Shift-click a region first.');
      return;
    }
    if (task) {
      updateTask(extendWorkingSet(task, ids));
      clearInspection();
      return;
    }
    setReview(undefined);
    setGraphPreview(undefined);
    setGraphLayer('current');
    history.begin();
    clearInspection(false);
    setCodingPlan(undefined);
    const set = createWorkingSet(ids);
    setTaskStage('explore');
    const anchor = snapshot?.nodes
      .flatMap((n) =>
        (n.declarations ?? []).map((s) => ({
          nodeId: n.id,
          name: s.name,
          kind: s.kind,
          id: symbolNodeId(n.id, s.id),
        })),
      )
      .find((s) => s.id === selectedSymbolId);
    if (anchor) {
      set.symbols = [{ nodeId: anchor.nodeId, name: anchor.name, kind: anchor.kind }];
    }
    applyView({
      ...viewRef.current,
      workingSet: set,
      positions: {},
      viewport: undefined,
      layouts: {
        ...viewRef.current.layouts,
        [`workspace:${layoutKey(viewRef.current)}`]: {
          positions: viewRef.current.positions,
          viewport: flow.getViewport(),
        },
      },
    });
    setContextIds(set.context);
    setGroupSelection(undefined);
    setEdgeSelection(undefined);
    needsViewport.current = true;
  };
  const exitTask = () => {
    setCodingPlan(undefined);
    setReview(undefined);
    setGraphPreview(undefined);
    setGraphLayer('current');
    clearInspection();
    const saved = viewRef.current.layouts[`workspace:${layoutKey(viewRef.current)}`];
    applyView({
      ...viewRef.current,
      workingSet: undefined,
      positions: saved?.positions ?? {},
      viewport: saved?.viewport,
    });
    setContextIds([]);
    setGroupSelection(undefined);
    setEdgeSelection(undefined);
    needsViewport.current = true;
  };
  const addContext = (ids: string[]) => {
    if (task) {
      updateTask({
        ...extendWorkingSet(task, ids),
        context: [...new Set([...task.context, ...ids])].slice(0, 50),
      });
    } else {
      setContextIds((current) => [...new Set([...current, ...ids])]);
    }
    setContextOpen(true);
    setLibraryOpen(false);
  };
  const openAssistant = (mode: 'ask' | 'propose' | 'plan', ids: string[]) => {
    addContext(ids);
    setAssistantIntent({ mode, id: crypto.randomUUID() });
  };
  const openOverview = () => {
    if (snapshot) {
      setOverviewDepth((depth) =>
        Math.min(depth, Math.max(1, ...snapshot.nodes.map((n) => n.path.split('/').length - 1))),
      );
    }
    clearInspection();
    setOverviewOpen(true);
    setLibraryOpen(false);
    setContextOpen(false);
    setImpactTarget(undefined);
    setGroupSelection(undefined);
    setEdgeSelection(undefined);
    inspectionPositions.current = {};
    arrangePeek.current = true;
    needsViewport.current = true;
  };
  const exploreModule = (path: string) => {
    clearInspection();
    setImpactTarget(undefined);
    setGroupSelection(undefined);
    if (task && snapshot) {
      updateTask(
        extendWorkingSet(
          task,
          snapshot.nodes.filter((n) => n.path.startsWith(`${path}/`)).map((n) => n.id),
        ),
      );
      needsViewport.current = true;
      return;
    }
    const next = switchLayout(viewRef.current, 'folders', overviewDepth);
    applyView({
      ...next,
      folder: path,
      hideTests: false,
      hideIsolated: false,
      focus: 0,
      expanded: [`folder:${overviewDepth}:${path}`],
      selected: undefined,
    });
    needsViewport.current = true;
  };
  const resetFilters = () =>
    updateView({ folder: '', hideTests: false, hideIsolated: false, focus: 0 });
  const expand = (id: string) => {
    if (id.startsWith('boundary:') && task) {
      togglePeek(id);
      return;
    }
    history.begin();
    fitMembers.current = display.nodes.find((node) => node.id === id)?.members;
    updateView({ expanded: [...new Set([...view.expanded, id])] });
    setGroupSelection(undefined);
  };
  const collapse = (id: string) => {
    history.begin();
    fitMembers.current = [id];
    updateView({ expanded: view.expanded.filter((group) => group !== id), focus: 0 });
    setGroupSelection(id);
  };
  const autoLayout = () => {
    const arranged = layout(nodes, baseEdges, tracePath ? 'TB' : 'LR');
    setNodes(arranged);
    if (inspecting) {
      inspectionPositions.current = Object.fromEntries(
        arranged.map((node) => [node.id, node.position]),
      );
    } else {
      updateView({
        positions: {
          ...view.positions,
          ...Object.fromEntries(arranged.map((node) => [node.id, node.position])),
        },
      });
    }
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        fitCanvas(arranged, 250);
      }),
    );
  };
  return (
    <ShowPathContext.Provider value={showPath}>
      <div className="app">
        <GraphToolbar
          taskActive={!!task}
          canWork={!!contextIds.length || !!file || !!group?.members.length}
          onWork={() =>
            beginTask(contextIds.length ? contextIds : file ? [file.id] : (group?.members ?? []))
          }
          onOverview={openOverview}
          onContext={() => {
            if (!contextOpen && !contextIds.length && file) {
              setContextIds([file.id]);
            }
            setContextOpen(!contextOpen);
            setLibraryOpen(false);
          }}
          contextCount={contextIds.length}
          hasSnapshot={!!snapshot}
          canBack={history.canBack}
          canForward={history.canForward}
          onBack={() => history.move(-1)}
          onForward={() => history.move(1)}
          onLibrary={() => {
            setLibraryOpen(!libraryOpen);
            setContextOpen(false);
          }}
          workspaceName={snapshot?.root.name ?? 'Workspace'}
          query={query}
          matches={matches}
          scanning={scanning}
          optionsOpen={optionsOpen}
          hasPeek={!!peekGroups.length}
          hasNodes={!!nodes.length}
          hasActiveFile={!!activeFileId}
          onQueryChange={setQuery}
          onSelectFile={selectFile}
          onToggleOptions={() => setOptionsOpen(!optionsOpen)}
          onClosePeek={() => togglePeek()}
          onFitView={() => {
            fitCanvas(undefined, 250);
          }}
          onAutoLayout={autoLayout}
        />
        {task && snapshot && (
          <WorkingSetPanel
            set={task}
            graph={snapshot}
            onChange={updateTask}
            onExit={exitTask}
            onReturn={() => {
              clearInspection();
              setGraphLayer('current');
              setImpactTarget(undefined);
              setGroupSelection(undefined);
              setEdgeSelection(undefined);
              needsViewport.current = true;
            }}
            onSave={() =>
              send({
                type: 'saveBookmark',
                rootId: snapshot.root.id,
                name: task.name,
                location: capture(),
              })
            }
            onNeighbors={() => {
              const ids = snapshot.edges
                .filter((e) => task.files.includes(e.source) || task.files.includes(e.target))
                .flatMap((e) => [e.source, e.target]);
              updateTask(extendWorkingSet(task, ids));
            }}
            stage={taskStage}
            onStage={(stage) => {
              setTaskStage(stage);
              if (stage === 'explore') {
                setContextOpen(false);
                clearInspection();
                return;
              }
              setContextOpen(true);
              setLibraryOpen(false);
              setContextIds(task.context);
              setAssistantIntent({
                id: crypto.randomUUID(),
                mode: stage === 'plan' ? 'plan' : 'ask',
                tab: stage === 'plan' ? 'plan' : stage === 'review' ? 'changes' : 'verify',
              });
            }}
            onAssistant={(mode) => {
              setTaskStage(mode === 'ask' ? 'explore' : mode === 'plan' ? 'plan' : 'review');
              setContextIds(task.context);
              setContextOpen(true);
              setLibraryOpen(false);
              setAssistantIntent({ mode, id: crypto.randomUUID() });
            }}
            onOpen={(id) => {
              selectFile(id);
              send({ type: 'openFile', nodeId: id });
            }}
          />
        )}
        {review && (
          <div className="context-bar review-map-toolbar">
            <strong>Change map</strong>
            <span>Static imports · node badges show review status</span>
            <button
              onClick={() => setGraphLayer('current')}
              aria-pressed={graphLayer === 'current'}
            >
              Current
            </button>
            <button
              disabled={!graphPreview}
              aria-pressed={graphLayer === 'before'}
              onClick={() => setGraphLayer('before')}
            >
              Before
            </button>
            <button
              disabled={
                !graphPreview ||
                review.state !== 'ready' ||
                graphPreview.before.revision !== snapshot?.revision ||
                graphPreview.changeIds.slice().sort().join() !==
                  review.accepted.slice().sort().join()
              }
              aria-pressed={graphLayer === 'proposed'}
              onClick={() => setGraphLayer('proposed')}
            >
              Proposed
            </button>
            <button
              disabled={
                review.state !== 'applied' ||
                verification?.proposalId !== review.proposal.id ||
                verification.stale ||
                verification.changedFiles.some((f) => f.sourceState && f.sourceState !== 'applied')
              }
              aria-pressed={graphLayer === 'applied'}
              onClick={() => setGraphLayer('applied')}
            >
              Applied
            </button>
            <small>+ Added imports · − Removed imports · impact is not a runtime call graph</small>
          </div>
        )}
        {optionsOpen && !task && (
          <ViewOptions
            view={view}
            folders={folders}
            maxDepth={maxDepth}
            hasSelectedFile={!!file}
            hasPeek={!!peekGroups.length}
            onChangeLayout={changeLayout}
            onUpdateView={updateView}
            onResetFilters={resetFilters}
            onCollapseAll={() => {
              setPeekGroups([]);
              updateView({ expanded: [], focus: 0 });
            }}
          />
        )}
        {inspecting && (
          <div className="context-bar">
            <strong>
              {overviewOpen
                ? 'Architecture overview'
                : tracePath
                  ? 'Import / impact path'
                  : aiRegion
                    ? 'AI file focus'
                    : 'Symbol declarations'}
            </strong>
            <span>Temporary canvas · saved layout is preserved</span>
            <button onClick={() => clearInspection()}>Back to graph</button>
          </div>
        )}
        {contextFile && view.mode === 'folders' && !inspecting && (
          <div className="context-bar">
            Import context: <strong>{contextFile.path}</strong>
            <span>Click an arrow to inspect imports · Peek shows only related files</span>
          </div>
        )}
        {notice && (
          <div className="context-bar" role="status">
            {notice}
            <button onClick={() => setNotice('')}>Dismiss</button>
          </div>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
            <button onClick={() => setError('')}>Dismiss</button>
          </div>
        )}
        <div className="content">
          <main ref={canvasRef}>
            <ReactFlow
              nodes={decoratedNodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgeMouseEnter={(_event, edge) => setHoveredEdge(edge.id)}
              onEdgeMouseLeave={() => setHoveredEdge(undefined)}
              onEdgeClick={(_event, edge) => {
                history.begin();
                if (!display.edges.find((item) => item.id === edge.id)?.relation) {
                  setEdgeSelection(edge.id);
                }
              }}
              onNodeClick={(event, node) => {
                const item = display.nodes.find((item) => item.id === node.id);
                if (event.shiftKey && item) {
                  const ids =
                    item.kind === 'symbol' && item.ownerId ? [item.ownerId] : item.members;
                  if (task) {
                    updateTask(extendWorkingSet(task, ids));
                    return;
                  }
                  setContextIds((current) =>
                    ids.every((id) => current.includes(id))
                      ? current.filter((id) => !ids.includes(id))
                      : [...new Set([...current, ...ids])],
                  );
                  setContextOpen(true);
                  setLibraryOpen(false);
                  return;
                }
                if (overviewOpen) {
                  setGroupSelection(node.id);
                  return;
                }
                history.begin();
                const symbol = display.nodes.find(
                  (item) => item.id === node.id && item.kind === 'symbol',
                );
                if (symbol?.ownerId && symbol.symbolId) {
                  setSelectedSymbolId(node.id);
                  send({ type: 'openSymbol', nodeId: symbol.ownerId, symbolId: symbol.symbolId });
                  return;
                }
                setSelectedSymbolId(undefined);
                setImpactTarget(undefined);
                setEdgeSelection(undefined);
                if (item?.kind === 'folder') {
                  setContextId(contextFile?.id);
                  setGroupSelection(node.id);
                  updateView({ selected: node.id, focus: 0 });
                } else {
                  if (contextFile?.id !== node.id) {
                    setPeekGroups([]);
                  }
                  setContextId(node.id);
                  setGroupSelection(undefined);
                  updateView({ selected: node.id });
                }
              }}
              onPaneClick={() => {
                if (inspecting) {
                  setSelectedSymbolId(undefined);
                  setEdgeSelection(undefined);
                  return;
                }
                setEdgeSelection(undefined);
                setContextId(undefined);
                setPeekGroups([]);
                setGroupSelection(undefined);
                updateView({ selected: undefined, focus: 0 });
              }}
              onNodeDoubleClick={(_event, node) => {
                const item = display.nodes.find((item) => item.id === node.id);
                if (overviewOpen && item) {
                  if (item.kind === 'folder') {
                    exploreModule(item.path);
                  } else {
                    selectFile(item.id);
                  }
                  return;
                }
                if (item?.kind === 'symbol') {
                  return;
                }
                if (item?.kind === 'folder') {
                  expand(node.id);
                } else {
                  send({ type: 'openFile', nodeId: node.id });
                }
              }}
              onNodeDragStop={(_event, node) => {
                if (inspecting) {
                  inspectionPositions.current[node.id] = node.position;
                } else {
                  updateView({
                    positions: { ...viewRef.current.positions, [node.id]: node.position },
                  });
                }
              }}
              onMoveEnd={(_event, viewport) => {
                if (readyToSaveViewport.current && !inspecting) {
                  updateView({ viewport });
                }
              }}
              nodesConnectable={false}
              edgesReconnectable={false}
              deleteKeyCode={null}
              minZoom={0.05}
              maxZoom={2}
              onlyRenderVisibleElements
            >
              <Background />
              <Controls showInteractive={false} onFitView={() => fitCanvas(undefined, 250)} />
            </ReactFlow>
            {!nodes.length && (
              <div className="empty">
                <h2>{scanning ? 'Mapping your source…' : 'Your code, connected'}</h2>
                <p>
                  {scanning
                    ? status
                    : snapshot?.nodes.length
                      ? 'No files match the current view.'
                      : empty.message || 'Use Refresh to scan the workspace.'}
                </p>
                {empty.openFolder ? (
                  <button onClick={() => send({ type: 'openFolder' })}>Open Folder</button>
                ) : (
                  !!snapshot?.nodes.length && <button onClick={resetFilters}>Reset Filters</button>
                )}
              </div>
            )}
          </main>
          {snapshot && (
            <ContextPanel
              hidden={!contextOpen}
              graphSelection={view.selected}
              activeFileId={activeFileId}
              onSourceScope={setEffectiveSourceIds}
              onConversationChange={(key) => {
                if (reviewConversation.current !== key) {
                  reviewConversation.current = key;
                  setCodingPlan(undefined);
                  setReview(undefined);
                  setGraphLayer('current');
                  setGraphPreview(undefined);
                }
              }}
              onNavigate={contextOpen ? setTaskStage : undefined}
              editableFileIds={task?.editable}
              onReview={setReview}
              key={snapshot.root.id}
              intent={assistantIntent}
              snapshot={snapshot}
              selected={contextIds.filter((id) => filesById.has(id))}
              selectedSymbol={snapshot.nodes
                .flatMap((n) =>
                  (n.declarations ?? []).map((s) => ({
                    nodeId: n.id,
                    symbolId: s.id,
                    canvasId: symbolNodeId(n.id, s.id),
                  })),
                )
                .find((s) => s.canvasId === selectedSymbolId)}
              sync={sync}
              onAdd={addContext}
              onGraphAction={(action: AiGraphAction) => {
                if (!snapshot) {
                  return;
                }
                if (action.kind === 'path') {
                  showPath(action.fileIds);
                  return;
                }
                if (action.kind === 'focus') {
                  clearInspection();
                  setAiRegion(action.fileIds);
                  setImpactTarget(undefined);
                  setGroupSelection(undefined);
                  setEdgeSelection(undefined);
                  pendingCenter.current = undefined;
                  fitMembers.current = undefined;
                  arrangePeek.current = true;
                  return;
                }
                if (action.kind === 'inspect' || action.kind === 'impact') {
                  const target = action.target;
                  const node = snapshot.nodes.find((n) => n.id === target.fileId);
                  if (!node) {
                    return;
                  }
                  selectFile(node.id);
                  if (action.kind === 'impact') {
                    setContextOpen(false);
                    setImpactTarget({ nodeId: node.id, symbolId: target.symbol?.id });
                  } else {
                    setContextOpen(false);
                    setAiRegion(undefined);
                    setTracePath(undefined);
                    setSymbolsFileId(node.id);
                    setSelectedSymbolId(
                      target.symbol ? symbolNodeId(node.id, target.symbol.id) : undefined,
                    );
                    pendingCenter.current = undefined;
                    fitMembers.current = target.symbol
                      ? [node.id, symbolNodeId(node.id, target.symbol.id)]
                      : [node.id];
                    inspectionPositions.current = {};
                    arrangePeek.current = true;
                    needsViewport.current = true;
                    readyToSaveViewport.current = false;
                  }
                }
              }}
              onToggle={(id) => {
                if (task) {
                  updateTask({
                    ...extendWorkingSet(task, [id]),
                    context: task.context.includes(id)
                      ? task.context.filter((x) => x !== id)
                      : [...task.context, id],
                  });
                  return;
                }
                setContextIds((current) =>
                  current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
                );
              }}
              onClear={() =>
                task ? updateTask({ ...task, context: [], editable: [] }) : setContextIds([])
              }
              onClose={() => setContextOpen(false)}
            />
          )}
          {!contextOpen &&
            (libraryOpen && snapshot ? (
              <LibraryPanel
                library={library}
                snapshot={snapshot}
                capture={capture}
                restore={(location) => {
                  history.begin();
                  restore(location);
                }}
                onClose={() => setLibraryOpen(false)}
              />
            ) : overviewOpen && snapshot ? (
              <ArchitecturePanel
                snapshot={snapshot}
                depth={overviewDepth}
                onDepth={(depth) => {
                  setOverviewDepth(depth);
                  inspectionPositions.current = {};
                  arrangePeek.current = true;
                  needsViewport.current = true;
                }}
                onExplore={exploreModule}
                onSelectFile={selectFile}
                onClose={() => clearInspection()}
              />
            ) : impactTarget && snapshot ? (
              <InvestigationPanel
                snapshot={snapshot}
                target={impactTarget}
                onClose={() => setImpactTarget(undefined)}
                onShowPath={showPath}
                onSelectFile={selectFile}
              />
            ) : (
              <DetailsPanel
                contextAction={
                  file || group ? (
                    <div className="assistant-file-actions">
                      <button onClick={() => beginTask(file ? [file.id] : group!.members)}>
                        Work on this
                      </button>
                      <button
                        onClick={() => openAssistant('ask', file ? [file.id] : group!.members)}
                      >
                        ✦ Ask AI
                      </button>
                      <button
                        onClick={() => openAssistant('propose', file ? [file.id] : group!.members)}
                      >
                        Edit with AI
                      </button>
                      <button
                        className="quiet-button"
                        onClick={() => addContext(file ? [file.id] : group!.members)}
                      >
                        Add to context
                      </button>
                    </div>
                  ) : undefined
                }
                annotationEditor={
                  snapshot && (file || group)
                    ? (() => {
                        const target = file
                          ? { kind: 'file' as const, id: file.id }
                          : { kind: 'folder' as const, id: group!.path };
                        const annotation = library.annotations.find(
                          (a) => targetKey(a.target) === targetKey(target),
                        );
                        return (
                          <AnnotationEditor
                            key={targetKey(target) + JSON.stringify(annotation)}
                            rootId={snapshot.root.id}
                            target={target}
                            annotation={annotation}
                          />
                        );
                      })()
                    : undefined
                }
                snapshot={snapshot}
                view={view}
                file={file}
                group={group}
                contextFile={contextFile}
                filesById={filesById}
                inspectedEdge={inspectedEdge}
                inspectedImports={inspectedImports}
                outgoing={outgoing}
                incoming={incoming}
                symbolsShown={symbolsFileId === file?.id && !!file}
                onToggleSymbols={() => {
                  history.begin();
                  if (symbolsFileId === file?.id) {
                    clearInspection();
                    return;
                  }
                  if (!file || !snapshot) {
                    return;
                  }
                  setAiRegion(undefined);
                  setTracePath(undefined);
                  setSymbolsFileId(file.id);
                  setSelectedSymbolId(undefined);
                  inspectionPositions.current = {};
                  arrangePeek.current = true;
                  needsViewport.current = true;
                  readyToSaveViewport.current = false;
                }}
                onImpact={(target) => {
                  history.begin();
                  setImpactTarget(target);
                }}
                onBack={() => setEdgeSelection(undefined)}
                onSelectFile={selectFile}
                onPeek={togglePeek}
                onExpand={expand}
                onCollapse={collapse}
              />
            ))}
        </div>
        <footer>
          <span className={`sync ${sync}`}>
            {syncLabels[sync]}
            {scanning && <button onClick={() => send({ type: 'cancel' })}>Cancel</button>}
            {snapshot &&
              ` · ${display.visibleFiles}/${snapshot.nodes.length} files · ${snapshot.edges.length} dependencies · ${snapshot.warnings.length} warnings`}
          </span>
          <span>
            {snapshot &&
              `Synced ${new Date(snapshot.scannedAt).toLocaleTimeString()} · Auto Update ${view.autoUpdate ? 'on' : 'off'}`}
          </span>
        </footer>
      </div>
    </ShowPathContext.Provider>
  );
}
