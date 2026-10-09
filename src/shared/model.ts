export type RelationKind = 'import' | 'type-import' | 're-export' | 'require' | 'dynamic-import';
export type SymbolKind = 'function' | 'class' | 'type' | 'interface' | 'enum' | 'value';
export interface SourceSymbol { id: string; name: string; kind: SymbolKind; line: number; character: number }
export interface ImportedSymbol {
  id: string; imported: string; local: string; form: 'named' | 'default' | 'namespace' | 'require'; typeOnly: boolean;
  line: number; character: number; kind?: SymbolKind;
  declaration?: { nodeId: string; symbolId: string };
}
export interface ExportBinding { name: string; local?: string; siteId?: string; imported?: string }
export interface ImportSite {
  id: string;
  specifier: string;
  kind: RelationKind;
  line: number;
  character: number;
  symbols?: ImportedSymbol[];
}
export interface OutsideDependency {
  site: ImportSite;
  status: 'external' | 'unresolved' | 'excluded';
  resolvedPath?: string;
}
export interface FileNode {
  id: string;
  path: string;
  name: string;
  language: string;
  outside: OutsideDependency[];
  declarations?: SourceSymbol[];
  exports?: ExportBinding[];
}
export interface DependencyEdge {
  id: string;
  source: string;
  target: string;
  sites: ImportSite[];
}
export interface GraphWarning { fileId?: string; message: string }
export interface GraphSnapshot {
  revision: number;
  root: { id: string; name: string };
  nodes: FileNode[];
  edges: DependencyEdge[];
  scannedAt: string;
  warnings: GraphWarning[];
}
export type UiMessage =
  | { type: 'ready' | 'refresh' | 'openFolder' | 'cancel' | 'changeFolder' | 'resetView' }
  | { type: 'saveView'; rootId: string; state: GraphViewState }
  | { type: 'autoUpdate'; enabled: boolean }
  | { type: 'layoutStats'; milliseconds: number; nodes: number }
  | { type: 'openFile'; nodeId: string }
  | { type: 'openDeclaration'; nodeId: string; siteId: string; symbolId: string }
  | { type: 'openImport'; nodeId: string; siteId: string };
export type HostMessage =
  | { type: 'snapshot'; snapshot: GraphSnapshot; viewState?: GraphViewState }
  | { type: 'status'; scanning: boolean; message: string; completed?: number; total?: number }
  | { type: 'empty'; message: string; openFolder: boolean }
  | { type: 'viewState'; rootId: string; state: GraphViewState }
  | { type: 'sync'; state: SyncState; autoUpdate: boolean }
  | { type: 'error'; message: string };

export type SyncState = 'up-to-date' | 'out-of-date' | 'updating' | 'error';
export interface GraphLayoutState {
  positions: Record<string, { x: number; y: number }>;
  viewport?: { x: number; y: number; zoom: number };
}
export interface GraphViewState {
  version: 3;
  mode: 'files' | 'folders';
  depth: number;
  expanded: string[];
  positions: Record<string, { x: number; y: number }>;
  viewport?: { x: number; y: number; zoom: number };
  layouts: Record<string, GraphLayoutState>;
  folder: string;
  hideTests: boolean;
  hideIsolated: boolean;
  focus: 0 | 1 | 2;
  selected?: string;
  autoUpdate: boolean;
}
export interface DisplayNode {
  id: string;
  kind: 'file' | 'folder';
  label: string;
  path: string;
  members: string[];
  internalEdges: number;
  related?: { fileId: string; sites: ImportSite[] }[];
}
export interface DisplayEdge { id: string; source: string; target: string; count: number; fileEdges?: string[]; symbolCount?: number }
export interface DisplayGraph { nodes: DisplayNode[]; edges: DisplayEdge[]; visibleFiles: number }
