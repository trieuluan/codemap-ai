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
  const [activeFileId, setActiveFileId] = useState<string>();
  const [revealRequest, setRevealRequest] = useState<{ nodeId: string }>();
  const [tracePath, setTracePath] = useState<string[]>();
  const [symbolsFileId, setSymbolsFileId] = useState<string>();
  const [selectedSymbolId, setSelectedSymbolId] = useState<string>();
  const [impactTarget, setImpactTarget] = useState<ImpactTarget>();
  const inspectionPositions = useRef<GraphViewState['positions']>({});
  const inspecting = !!tracePath || !!symbolsFileId;
  const canvasKey = tracePath
    ? `path:${JSON.stringify(tracePath)}`
    : symbolsFileId
      ? `symbols:${symbolsFileId}`
      : layoutKey(view);
  const clearInspection = () => {
    setTracePath(undefined);
    setSymbolsFileId(undefined);
    setSelectedSymbolId(undefined);
    inspectionPositions.current = {};
    needsViewport.current = true;
    readyToSaveViewport.current = false;
  };
  const showPath = (path: string[]) => {
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
          clearInspection();
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
        // Initial viewState is sent before the first snapshot.
        applyView(restored, false);
        setSnapshot(next);
        setError('');
        setEmpty({
          message: next.nodes.length ? '' : 'No supported source files found.',
          openFolder: false,
        });
        break;
      }
      case 'viewState':
        setRevealRequest(undefined);
        clearInspection();
        setImpactTarget(undefined);
        rootId.current = message.rootId;
        applyView(readView(message.state), false);
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
        clearInspection();
        setImpactTarget(undefined);
        setActiveFileId(undefined);
        rootId.current = undefined;
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
  const filesById = useMemo(
    () => new Map(snapshot?.nodes.map((node) => [node.id, node]) ?? []),
    [snapshot],
  );
  const contextFile = snapshot?.nodes.find((node) => node.id === (contextId ?? view.selected));
  const display = useMemo(() => {
    if (!snapshot) {
      return { nodes: [], edges: [], visibleFiles: 0 };
    }
    const source = tracePath
      ? graphForPath(snapshot, tracePath)
      : symbolsFileId
        ? {
            ...snapshot,
            nodes: snapshot.nodes.filter((node) => node.id === symbolsFileId),
            edges: [],
          }
        : snapshot;
    const state = inspecting
      ? {
          ...view,
          mode: 'files' as const,
          folder: '',
          hideTests: false,
          hideIsolated: false,
          focus: 0 as const,
        }
      : view;
    return withSymbols(
      projectGraph(source, state, { fileId: contextFile?.id, groups: peekGroups }),
      filesById.get(symbolsFileId ?? ''),
    );
  }, [snapshot, view, contextFile?.id, peekGroups, tracePath, symbolsFileId, filesById]);
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
      initialHeight: node.kind === 'folder' ? 240 : height,
      sourcePosition: tracePath ? Position.Bottom : Position.Right,
      targetPosition: tracePath ? Position.Top : Position.Left,
      style: { width, height: node.kind === 'folder' ? 240 : height },
      data: {
        layoutKey: canvasKey,
        label: (
          <FileNodeLabel
            node={node}
            contextFile={contextFile}
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
  }, [display, baseEdges, setNodes, applyView, inspecting, canvasKey]);
  const selectFile = (id: string) => {
    if (!snapshot) {
      return;
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
      clearInspection();
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
      clearInspection();
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
        className: `${node.className ?? ''} ${display.nodes.find((item) => item.id === node.id)?.members.includes(activeFileId ?? '') ? 'active-editor-node' : ''} ${display.nodes.find((item) => item.id === node.id)?.members.some((id) => matchingIds.has(id)) ? 'search-match' : ''}`,
      })),
    [
      nodes,
      selectedSymbolId,
      groupSelection,
      view.selected,
      display.nodes,
      activeFileId,
      matchingIds,
    ],
  );
  const selected = groupSelection ?? view.selected;
  const contextTarget = edgeSelection?.startsWith('context:') ? edgeSelection.slice(8) : undefined;
  const contextSource = display.nodes.find(
    (node) => contextFile && node.members.includes(contextFile.id),
  )?.id;
  const edges = baseEdges.map((edge) => {
    const picked =
      edge.id === edgeSelection ||
      (!!contextTarget && edge.source === contextSource && edge.target === contextTarget);
    return {
      ...edge,
      selected: picked,
      className:
        picked || edge.source === selected || edge.target === selected ? 'related-edge' : '',
      style: {
        ...edge.style,
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
  const resetFilters = () =>
    updateView({ folder: '', hideTests: false, hideIsolated: false, focus: 0 });
  const expand = (id: string) => {
    fitMembers.current = display.nodes.find((node) => node.id === id)?.members;
    updateView({ expanded: [...new Set([...view.expanded, id])] });
    setGroupSelection(undefined);
  };
  const collapse = (id: string) => {
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
        {optionsOpen && (
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
            <strong>{tracePath ? 'Import / impact path' : 'Symbol declarations'}</strong>
            <span>Temporary canvas · saved layout is preserved</span>
            <button onClick={clearInspection}>Back to graph</button>
          </div>
        )}
        {contextFile && view.mode === 'folders' && !inspecting && (
          <div className="context-bar">
            Import context: <strong>{contextFile.path}</strong>
            <span>Click an arrow to inspect imports · Peek shows only related files</span>
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
              onEdgeClick={(_event, edge) => {
                if (!display.edges.find((item) => item.id === edge.id)?.relation) {
                  setEdgeSelection(edge.id);
                }
              }}
              onNodeClick={(_event, node) => {
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
                if (node.id.startsWith('folder:')) {
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
          {impactTarget && snapshot ? (
            <InvestigationPanel
              snapshot={snapshot}
              target={impactTarget}
              onClose={() => setImpactTarget(undefined)}
              onShowPath={showPath}
              onSelectFile={selectFile}
            />
          ) : (
            <DetailsPanel
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
                if (symbolsFileId === file?.id) {
                  clearInspection();
                  return;
                }
                if (!file || !snapshot) {
                  return;
                }
                setTracePath(undefined);
                setSymbolsFileId(file.id);
                setSelectedSymbolId(undefined);
                inspectionPositions.current = {};
                arrangePeek.current = true;
                needsViewport.current = true;
                readyToSaveViewport.current = false;
              }}
              onImpact={setImpactTarget}
              onBack={() => setEdgeSelection(undefined)}
              onSelectFile={selectFile}
              onPeek={togglePeek}
              onExpand={expand}
              onCollapse={collapse}
            />
          )}
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
