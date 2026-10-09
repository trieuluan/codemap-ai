import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlow, ReactFlowProvider, Background, Controls, MarkerType, Position, useNodesState, useReactFlow,
  useNodesInitialized, type Node, type Edge } from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import type { GraphSnapshot, GraphViewState, HostMessage, ImportSite, UiMessage, SyncState } from '../shared/model';
import { defaultView, groupId, layoutKey, projectGraph, readView, reconcileView, revealFile, switchLayout } from '../shared/view';
import '@xyflow/react/dist/style.css';
import './style.css';

declare function acquireVsCodeApi(): { postMessage(message: UiMessage): void };
const vscode = acquireVsCodeApi();
const send = (message: UiMessage) => vscode.postMessage(message);
const width = 220;
const height = 70;
function layout(nodes: Node[], edges: Edge[]): Node[] {
  const started = performance.now();
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: 'LR', nodesep: 28, ranksep: 90 }); graph.setDefaultEdgeLabel(() => ({}));
  nodes.forEach(node => graph.setNode(node.id, { width, height }));
  edges.forEach(edge => graph.setEdge(edge.source, edge.target)); dagre.layout(graph);
  send({ type: 'layoutStats', milliseconds: performance.now() - started, nodes: nodes.length });
  return nodes.map(node => { const position = graph.node(node.id);
    return { ...node, position: { x: position.x - width / 2, y: position.y - height / 2 } }; });
}
const syncLabels: Record<SyncState, string> = { 'up-to-date': 'Up to date', 'out-of-date': 'Out of date', updating: 'Updating', error: 'Error' };
function App() {
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
  const flow = useReactFlow();
  const initialized = useNodesInitialized();
  const needsViewport = useRef(true);
  const fitMembers = useRef<string[] | undefined>(undefined);
  const pendingCenter = useRef<string | undefined>(undefined);
  const readyToSaveViewport = useRef(false);
  const applyView = useCallback((next: GraphViewState, save = true) => {
    viewRef.current = next; setView(next);
    if (save && rootId.current) { send({ type: 'saveView', rootId: rootId.current, state: next }); }
  }, []);
  const updateView = (patch: Partial<GraphViewState>) => applyView({ ...viewRef.current, ...patch });
  const changeLayout = (mode: GraphViewState['mode'], depth = viewRef.current.depth) => {
    setGroupSelection(undefined);
    needsViewport.current = true; readyToSaveViewport.current = false;
    fitMembers.current = undefined; pendingCenter.current = undefined;
    applyView(switchLayout({ ...viewRef.current, viewport: flow.getViewport() }, mode, depth));
  };
  useEffect(() => {
    function receive(event: MessageEvent<HostMessage>) {
      const message = event.data;
      switch (message.type) {
        case 'snapshot': {
          const next = message.snapshot;
          const sameRoot = rootId.current === next.root.id;
          if (!sameRoot) { setQuery(''); needsViewport.current = true; readyToSaveViewport.current = false; }
          rootId.current = next.root.id;
          const restored = reconcileView(sameRoot ? viewRef.current : readView(message.viewState), next);
          // Initial viewState is sent before the first snapshot.
          applyView(restored, false);
          setSnapshot(next); setError('');
          setEmpty({ message: next.nodes.length ? '' : 'No supported source files found.', openFolder: false });
          break;
        }
        case 'viewState':
          rootId.current = message.rootId;
          applyView(readView(message.state), false);
          needsViewport.current = true; readyToSaveViewport.current = false; setGroupSelection(undefined);
          break;
        case 'sync': setSync(message.state); applyView({ ...viewRef.current, autoUpdate: message.autoUpdate }, false); break;
        case 'status': setScanning(message.scanning); setStatus(message.message); if (message.scanning) { setError(''); } break;
        case 'empty': rootId.current = undefined; needsViewport.current = true; readyToSaveViewport.current = false;
          setSnapshot(undefined); setNodes([]); setGroupSelection(undefined); setEmpty(message); break;
        case 'error': setError(message.message); break;
      }
    }
    window.addEventListener('message', receive); send({ type: 'ready' });
    return () => window.removeEventListener('message', receive);
  }, [applyView, setNodes]);
  const display = useMemo(() => snapshot ? projectGraph(snapshot, view) : { nodes: [], edges: [], visibleFiles: 0 }, [snapshot, view]);
  const baseEdges: Edge[] = useMemo(() => display.edges.map(edge => ({ ...edge,
    label: edge.count > 1 || edge.source.startsWith('folder:') || edge.target.startsWith('folder:') ? String(edge.count) : undefined,
    markerEnd: { type: MarkerType.ArrowClosed }, type: 'default' })), [display]);
  useEffect(() => {
    const current = viewRef.current;
    const initial: Node[] = display.nodes.map(node => ({ id: node.id, position: current.positions[node.id] ?? { x: 0, y: 0 },
      sourcePosition: Position.Right, targetPosition: Position.Left, style: { width, height },
      data: { layoutKey: layoutKey(current), label: <div className="file-label"><strong>{node.kind === 'folder' ? '▣ ' : ''}{node.label}</strong>
        <small>{node.kind === 'folder' ? `${node.members.length} files · ${node.internalEdges} internal dependencies` : node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : '.'}</small></div> },
      ariaLabel: node.path, className: node.kind === 'folder' ? 'folder-node' : '' }));
    if (!initial.length) { setNodes([]); return; }
    const savedPositions = Object.values(current.positions);
    let next = initial;
    if (!initial.some(node => current.positions[node.id])) { next = layout(initial, baseEdges); }
    else {
      const right = Math.max(...savedPositions.map(position => position.x)) + width + 90;
      let index = 0;
      next = initial.map(node => current.positions[node.id] ? node : { ...node, position: { x: right, y: index++ * (height + 28) } });
    }
    setNodes(next);
    const missing = next.filter(node => !current.positions[node.id]);
    if (missing.length) {
      applyView({ ...current, positions: { ...current.positions, ...Object.fromEntries(missing.map(node => [node.id, node.position])) } });
    }
  }, [display, baseEdges, setNodes, applyView]);
  useEffect(() => {
    if (!initialized || !nodes.length || nodes.some(node => node.data.layoutKey !== layoutKey(viewRef.current))) { return; }
    if (fitMembers.current?.every(id => flow.getNode(id))) {
      const members = fitMembers.current; fitMembers.current = undefined;
      void flow.fitView({ nodes: members.map(id => ({ id })), padding: 0.2, duration: 250 });
    } else if (pendingCenter.current) {
      const node = flow.getNode(pendingCenter.current);
      if (node) { pendingCenter.current = undefined; void flow.setCenter(node.position.x + width / 2, node.position.y + height / 2, { zoom: 1, duration: 250 }); }
    } else if (needsViewport.current) {
      needsViewport.current = false;
      const viewport = viewRef.current.viewport;
      if (viewport) { void flow.setViewport(viewport); } else { void flow.fitView({ padding: 0.15 }); }
    }
    readyToSaveViewport.current = true;
  }, [initialized, nodes, flow]);
  const selectFile = (id: string) => {
    if (!snapshot) { return; }
    setGroupSelection(undefined); pendingCenter.current = id;
    applyView(revealFile(viewRef.current, snapshot, id));
  };
  const matches = useMemo(() => snapshot?.nodes.filter(node => query.trim() && node.path.toLowerCase().includes(query.trim().toLowerCase())) ?? [], [snapshot, query]);
  const matchingIds = new Set(matches.map(node => node.id));
  const decoratedNodes = nodes.map(node => ({ ...node, selected: node.id === (groupSelection ?? view.selected),
    className: `${node.className ?? ''} ${display.nodes.find(item => item.id === node.id)?.members.some(id => matchingIds.has(id)) ? 'search-match' : ''}` }));
  const selected = groupSelection ?? view.selected;
  const edges = baseEdges.map(edge => ({ ...edge, className: edge.source === selected || edge.target === selected ? 'related-edge' : '',
    style: { opacity: selected && edge.source !== selected && edge.target !== selected ? 0.2 : 1 } }));
  const filesById = useMemo(() => new Map(snapshot?.nodes.map(node => [node.id, node]) ?? []), [snapshot]);
  const file = filesById.get(view.selected ?? '');
  const group = display.nodes.find(node => node.id === (groupSelection ?? view.selected) && node.kind === 'folder');
  const outgoing = snapshot?.edges.filter(edge => edge.source === file?.id) ?? [];
  const incoming = snapshot?.edges.filter(edge => edge.target === file?.id) ?? [];
  const folders = [...new Set(snapshot?.nodes.flatMap(node => node.path.split('/').slice(0, -1).map((_, i) => node.path.split('/').slice(0, i + 1).join('/'))) ?? [])].sort();
  const maxDepth = Math.max(1, ...folders.map(folder => folder.split('/').length));
  const openSite = (nodeId: string, site: ImportSite) => <button className="site" key={site.id}
    onClick={() => send({ type: 'openImport', nodeId, siteId: site.id })}>L{site.line + 1} · {site.kind} · {site.specifier}</button>;
  const resetFilters = () => updateView({ folder: '', hideTests: false, hideIsolated: false, focus: 0 });
  const expand = (id: string) => { fitMembers.current = display.nodes.find(node => node.id === id)?.members; updateView({ expanded: [...new Set([...view.expanded, id])] }); setGroupSelection(undefined); };
  const collapse = (id: string) => { fitMembers.current = [id]; updateView({ expanded: view.expanded.filter(group => group !== id), focus: 0 }); setGroupSelection(id); };
  return <div className="app">
    <header><div className="brand"><strong>CodeMap</strong><span>{snapshot?.root.name ?? 'Workspace'}</span></div>
      <div className="search"><input aria-label="Find a file" placeholder="Find file by path…" value={query}
        onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && matches[0]) { selectFile(matches[0].id); setQuery(''); } }} />
        {query.trim() && <div className="results">{matches.length ? matches.slice(0, 30).map(node => <button key={node.id}
          onClick={() => { selectFile(node.id); setQuery(''); }}>{node.path}</button>) : <span>No matching files</span>}
          {matches.length > 30 && <span>{matches.length} matches — narrow your search</span>}</div>}</div>
      <button disabled={scanning} onClick={() => send({ type: 'refresh' })}>Refresh</button>
      <button onClick={() => setOptionsOpen(!optionsOpen)} aria-expanded={optionsOpen}>View Options</button>
      <button disabled={!nodes.length} onClick={() => { void flow.fitView({ padding: 0.15, duration: 250 }); }}>Fit View</button>
      <button disabled={!nodes.length} onClick={() => {
        const arranged = layout(nodes, baseEdges); setNodes(arranged);
        updateView({ positions: { ...view.positions, ...Object.fromEntries(arranged.map(node => [node.id, node.position])) } });
        requestAnimationFrame(() => requestAnimationFrame(() => { void flow.fitView({ padding: 0.15, duration: 250 }); }));
      }}>Auto Layout</button>
    </header>
    {optionsOpen && <section className="view-options" aria-label="View Options">
      <label>Mode <select aria-label="Graph mode" value={view.mode} onChange={event => changeLayout(event.target.value as GraphViewState['mode'])}>
        <option value="files">Files</option><option value="folders">Folders</option></select></label>
      {view.mode === 'folders' && <><label>Depth <select aria-label="Folder depth" value={view.depth} onChange={event => changeLayout('folders', Number(event.target.value))}>
        {Array.from({ length: maxDepth }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select></label>
        <button disabled={!view.expanded.length} onClick={() => updateView({ expanded: [], focus: 0 })}>Collapse All</button></>}
      <label>Folder <select aria-label="Filter folder" value={view.folder} onChange={event => updateView({ folder: event.target.value, focus: 0 })}><option value="">All folders</option>{folders.map(folder => <option key={folder}>{folder}</option>)}</select></label>
      <label><input type="checkbox" checked={view.hideTests} onChange={event => updateView({ hideTests: event.target.checked })} />Hide tests</label>
      <label><input type="checkbox" checked={view.hideIsolated} onChange={event => updateView({ hideIsolated: event.target.checked })} />Hide isolated files</label>
      <label>Focus <select aria-label="Focus distance" value={view.focus} onChange={event => updateView({ focus: Number(event.target.value) as 0 | 1 | 2 })}>
        <option value="0">Off</option><option value="1" disabled={!file}>1 hop</option><option value="2" disabled={!file}>2 hops</option></select></label>
      <label><input type="checkbox" checked={view.autoUpdate} onChange={event => {
        updateView({ autoUpdate: event.target.checked }); send({ type: 'autoUpdate', enabled: event.target.checked });
      }} />Auto Update</label>
      <button onClick={resetFilters}>Reset Filters</button><button onClick={() => send({ type: 'resetView' })}>Reset View</button>
      <button onClick={() => send({ type: 'changeFolder' })}>Change Folder</button>
    </section>}
    {error && <div className="error" role="alert">{error}<button onClick={() => setError('')}>Dismiss</button></div>}
    <div className="content"><main>
      <ReactFlow nodes={decoratedNodes} edges={edges} onNodesChange={onNodesChange}
        onNodeClick={(_event, node) => { if (node.id.startsWith('folder:')) { setGroupSelection(node.id); updateView({ selected: node.id, focus: 0 }); }
          else { setGroupSelection(undefined); updateView({ selected: node.id }); } }}
        onPaneClick={() => { setGroupSelection(undefined); updateView({ selected: undefined, focus: 0 }); }}
        onNodeDoubleClick={(_event, node) => node.id.startsWith('folder:') ? expand(node.id) : send({ type: 'openFile', nodeId: node.id })}
        onNodeDragStop={(_event, node) => updateView({ positions: { ...viewRef.current.positions, [node.id]: node.position } })}
        onMoveEnd={(_event, viewport) => { if (readyToSaveViewport.current) { updateView({ viewport }); } }}
        nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={null} minZoom={0.05} maxZoom={2} onlyRenderVisibleElements>
        <Background /><Controls showInteractive={false} />
      </ReactFlow>
      {!nodes.length && <div className="empty"><h2>{scanning ? 'Mapping your source…' : 'Your code, connected'}</h2>
        <p>{scanning ? status : snapshot?.nodes.length ? 'No files match the current view.' : empty.message || 'Use Refresh to scan the workspace.'}</p>
        {empty.openFolder ? <button onClick={() => send({ type: 'openFolder' })}>Open Folder</button> : !!snapshot?.nodes.length && <button onClick={resetFilters}>Reset Filters</button>}</div>}
    </main><aside>
      {group ? <><h2>{group.path}</h2><p>{group.members.length} files · {group.internalEdges} internal dependencies</p>
        <button className="primary" onClick={() => expand(group.id)}>Expand Folder</button>
        <h3>Members</h3>{group.members.map(id => <button className="link" key={id} onClick={() => selectFile(id)}>{filesById.get(id)?.path}</button>)}</>
      : file ? <><h2>{file.name}</h2><p className="path">{file.path}</p><span className="badge">{file.language}</span>
        <p><button className="primary" onClick={() => send({ type: 'openFile', nodeId: file.id })}>Open Source</button></p>
        {view.mode === 'folders' && groupId(file, view.depth) && view.expanded.includes(groupId(file, view.depth)!) && <button onClick={() => collapse(groupId(file, view.depth)!)}>Collapse Folder</button>}
        <h3>Dependencies <span>{outgoing.length}</span></h3>{outgoing.length ? outgoing.map(edge => <div className="dependency" key={edge.id}>
          <button className="link" onClick={() => selectFile(edge.target)}>{filesById.get(edge.target)?.path}</button>{edge.sites.map(site => openSite(file.id, site))}</div>) : <p className="muted">No internal dependencies.</p>}
        <h3>Dependents <span>{incoming.length}</span></h3>{incoming.length ? incoming.map(edge => <div className="dependency" key={edge.id}>
          <button className="link" onClick={() => selectFile(edge.source)}>{filesById.get(edge.source)?.path}</button>{edge.sites.map(site => openSite(edge.source, site))}</div>) : <p className="muted">No internal dependents.</p>}
        <h3>Outside graph <span>{file.outside.length}</span></h3>{file.outside.map(item => <div className="dependency" key={item.site.id}><span className={`badge ${item.status}`}>{item.status}</span>
          {openSite(file.id, item.site)}{item.resolvedPath && <small className="path">{item.resolvedPath}</small>}</div>)}</>
      : <><h2>Explore your workspace</h2><p className="muted">Select a file or folder to inspect its dependencies.</p><p className="legend">A → B: A imports or re-exports B</p>
        <p className="muted">View Options groups folders, filters files and focuses your exploration. Auto Update follows unsaved source changes.</p></>}
      {!!snapshot?.warnings.length && <section className="warnings"><h3>Scan warnings <span>{snapshot.warnings.length}</span></h3>
        {snapshot.warnings.filter(warning => !file || !warning.fileId || warning.fileId === file.id).map((warning, index) => <p key={index}>
          {warning.fileId && <button className="link" onClick={() => selectFile(warning.fileId!)}>{filesById.get(warning.fileId)?.path}</button>}{warning.message}</p>)}</section>}
    </aside></div>
    <footer><span className={`sync ${sync}`}>{syncLabels[sync]}{scanning && <button onClick={() => send({ type: 'cancel' })}>Cancel</button>}
      {snapshot && ` · ${display.visibleFiles}/${snapshot.nodes.length} files · ${snapshot.edges.length} dependencies · ${snapshot.warnings.length} warnings`}</span>
      <span>{snapshot && `Synced ${new Date(snapshot.scannedAt).toLocaleTimeString()} · Auto Update ${view.autoUpdate ? 'on' : 'off'}`}</span></footer>
  </div>;
}
createRoot(document.getElementById('root')!).render(<ReactFlowProvider><App /></ReactFlowProvider>);
