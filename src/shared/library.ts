import { readLocation, type NavigationLocation } from './navigation';
import type { GraphSnapshot } from './model';
export const roles = ['UI', 'API', 'Data', 'Shared', 'Other'] as const;
export type ArchitectureRole = (typeof roles)[number];
export interface AnnotationTarget {
  kind: 'file' | 'folder';
  id: string;
}
export interface Annotation {
  target: AnnotationTarget;
  text: string;
  role?: ArchitectureRole;
}
export interface SavedView {
  id: string;
  name: string;
  location: NavigationLocation;
}
export interface WorkspaceLibrary {
  version: 1;
  views: SavedView[];
  annotations: Annotation[];
}
export function readAnnotation(value: unknown): Annotation | undefined {
  if (!value || typeof value !== 'object') {
    return;
  }
  const a = value as Annotation;
  if (
    !a.target ||
    !['file', 'folder'].includes(a.target.kind) ||
    typeof a.target.id !== 'string' ||
    !a.target.id ||
    typeof a.text !== 'string' ||
    a.text.length > 4000 ||
    (a.role !== undefined && !roles.includes(a.role))
  ) {
    return;
  }
  return { target: { kind: a.target.kind, id: a.target.id }, text: a.text, role: a.role };
}
export function annotationExists(target: AnnotationTarget, graph: GraphSnapshot) {
  return graph.nodes.some((n) =>
    target.kind === 'file' ? n.id === target.id : n.path.startsWith(`${target.id}/`),
  );
}
export function targetKey(target: AnnotationTarget) {
  return JSON.stringify([target.kind, target.id]);
}
export function readLibrary(value: unknown): WorkspaceLibrary {
  const empty: WorkspaceLibrary = { version: 1, views: [], annotations: [] };
  if (!value || typeof value !== 'object') {
    return empty;
  }
  const data = value as WorkspaceLibrary;
  if (data.version !== 1 || !Array.isArray(data.views) || !Array.isArray(data.annotations)) {
    return empty;
  }
  const views = new Map<string, SavedView>();
  for (const v of data.views.slice(0, 100)) {
    if (
      !v ||
      typeof v.id !== 'string' ||
      typeof v.name !== 'string' ||
      !v.name.trim() ||
      v.name.length > 100
    ) {
      continue;
    }
    const location = readLocation(v.location);
    if (location) {
      views.set(v.id, { id: v.id, name: v.name.trim(), location });
    }
  }
  const annotations = new Map<string, Annotation>();
  for (const a of data.annotations.slice(0, 10000)) {
    const valid = readAnnotation(a);
    if (valid) {
      annotations.set(targetKey(valid.target), valid);
    }
  }
  return { version: 1, views: [...views.values()], annotations: [...annotations.values()] };
}
