import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  Position,
  useNodesState,
  useReactFlow,
  useNodesInitialized,
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
import { FileNodeLabel } from './components/FileNodeLabel';
import { DetailsPanel } from './components/DetailsPanel';
import { ViewOptions } from './components/ViewOptions';
import { GraphToolbar } from './components/GraphToolbar';

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
  const arrangePeek = useRef(false);
  const flow = useReactFlow();
  const initialized = useNodesInitialized();
  const needsViewport = useRef(true);
  const fitMembers = useRef<string[] | undefined>(undefined);
  const pendingCenter = useRef<string | undefined>(undefined);
  const readyToSaveViewport = useRef(false);
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
    setGroupSelection(undefined);
    setPeekGroups([]);
    setEdgeSelection(undefined);
    needsViewport.current = true;
    readyToSaveViewport.current = false;
    fitMembers.current = undefined;
    pendingCenter.current = undefined;
    applyView(switchLayout({ ...viewRef.current, viewport: flow.getViewport() }, mode, depth));
  };
  useHostMessages((message: HostMessage) => {
    switch (message.type) {
      case 'snapshot': {
        const next = message.snapshot;
        const sameRoot = rootId.current === next.root.id;
        if (!sameRoot) {
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
  const display = useMemo(
    () =>
      snapshot
        ? projectGraph(snapshot, view, { fileId: contextFile?.id, groups: peekGroups })
        : { nodes: [], edges: [], visibleFiles: 0 },
    [snapshot, view, contextFile?.id, peekGroups],
  );
  const baseEdges: Edge[] = useMemo(
    () =>
      display.edges.map((edge) => ({
        ...edge,
        label: `${edge.count} ${edge.count === 1 ? 'file' : 'files'}${edge.symbolCount ? ` · ${edge.symbolCount} ${edge.symbolCount === 1 ? 'symbol' : 'symbols'}` : ''}`,
        ariaLabel: `Imports from ${display.nodes.find((node) => node.id === edge.source)?.path} to ${display.nodes.find((node) => node.id === edge.target)?.path}`,
        markerEnd: { type: MarkerType.ArrowClosed },
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
    const initial: Node[] = display.nodes.map((node) => ({
      id: node.id,
      position: current.positions[node.id] ?? { x: 0, y: 0 },
      initialWidth: width,
      initialHeight: node.kind === 'folder' ? 240 : height,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      style: { width, height: node.kind === 'folder' ? 240 : height },
      data: {
        layoutKey: layoutKey(current),
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
      className: node.kind === 'folder' ? 'folder-node' : '',
    }));
    if (!initial.length) {
      setNodes([]);
      return;
    }
    const savedPositions = Object.values(current.positions);
    let next = initial;
    const rearrange = arrangePeek.current;
    arrangePeek.current = false;
    if (rearrange || !initial.some((node) => current.positions[node.id])) {
      next = layout(initial, baseEdges);
    } else {
      const right = Math.max(...savedPositions.map((position) => position.x)) + width + 90;
      let index = 0;
      next = initial.map((node) =>
        current.positions[node.id] ? node : { ...node, position: { x: right, y: index++ * 268 } },
      );
    }
    setNodes(next);
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
  }, [display, baseEdges, setNodes, applyView]);
  useEffect(() => {
    if (
      !initialized ||
      !nodes.length ||
      nodes.some((node) => node.data.layoutKey !== layoutKey(viewRef.current))
    ) {
      return;
    }
    if (fitMembers.current?.every((id) => flow.getNode(id))) {
      const members = fitMembers.current;
      fitMembers.current = undefined;
      void flow.fitView({ nodes: members.map((id) => ({ id })), padding: 0.2, duration: 250 });
    } else if (pendingCenter.current) {
      const node = flow.getNode(pendingCenter.current);
      if (node) {
        pendingCenter.current = undefined;
        void flow.setCenter(node.position.x + width / 2, node.position.y + height / 2, {
          zoom: 1,
          duration: 250,
        });
      }
    } else if (needsViewport.current) {
      needsViewport.current = false;
      const viewport = viewRef.current.viewport;
      if (viewport) {
        void flow.setViewport(viewport);
      } else {
        void flow.fitView({ padding: 0.15 });
      }
    }
    readyToSaveViewport.current = true;
  }, [initialized, nodes, flow]);
  const selectFile = (id: string) => {
    if (!snapshot) {
      return;
    }
    setGroupSelection(undefined);
    pendingCenter.current = id;
    setContextId(id);
    setPeekGroups([]);
    setEdgeSelection(undefined);
    applyView(revealFile(viewRef.current, snapshot, id));
  };
  const matches = useMemo(
    () =>
      snapshot?.nodes.filter(
        (node) => query.trim() && node.path.toLowerCase().includes(query.trim().toLowerCase()),
      ) ?? [],
    [snapshot, query],
  );
  const matchingIds = new Set(matches.map((node) => node.id));
  const decoratedNodes = nodes.map((node) => ({
    ...node,
    selected: node.id === (groupSelection ?? view.selected),
    className: `${node.className ?? ''} ${display.nodes.find((item) => item.id === node.id)?.members.some((id) => matchingIds.has(id)) ? 'search-match' : ''}`,
  }));
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
    const arranged = layout(nodes, baseEdges);
    setNodes(arranged);
    updateView({
      positions: {
        ...view.positions,
        ...Object.fromEntries(arranged.map((node) => [node.id, node.position])),
      },
    });
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        void flow.fitView({ padding: 0.15, duration: 250 });
      }),
    );
  };
  return (
    <div className="app">
      <GraphToolbar
        workspaceName={snapshot?.root.name ?? 'Workspace'}
        query={query}
        matches={matches}
        scanning={scanning}
        optionsOpen={optionsOpen}
        hasPeek={!!peekGroups.length}
        hasNodes={!!nodes.length}
        onQueryChange={setQuery}
        onSelectFile={selectFile}
        onToggleOptions={() => setOptionsOpen(!optionsOpen)}
        onClosePeek={() => togglePeek()}
        onFitView={() => {
          void flow.fitView({ padding: 0.15, duration: 250 });
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
      {contextFile && view.mode === 'folders' && (
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
        <main>
          <ReactFlow
            nodes={decoratedNodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgeClick={(_event, edge) => setEdgeSelection(edge.id)}
            onNodeClick={(_event, node) => {
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
              setEdgeSelection(undefined);
              setContextId(undefined);
              setPeekGroups([]);
              setGroupSelection(undefined);
              updateView({ selected: undefined, focus: 0 });
            }}
            onNodeDoubleClick={(_event, node) =>
              node.id.startsWith('folder:')
                ? expand(node.id)
                : send({ type: 'openFile', nodeId: node.id })
            }
            onNodeDragStop={(_event, node) =>
              updateView({ positions: { ...viewRef.current.positions, [node.id]: node.position } })
            }
            onMoveEnd={(_event, viewport) => {
              if (readyToSaveViewport.current) {
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
            <Controls showInteractive={false} />
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
          onBack={() => setEdgeSelection(undefined)}
          onSelectFile={selectFile}
          onPeek={togglePeek}
          onExpand={expand}
          onCollapse={collapse}
        />
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
  );
}
