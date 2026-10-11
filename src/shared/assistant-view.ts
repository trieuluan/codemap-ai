import type { ContextBundle } from './context';
import type { SourceEdit } from './edits';

/** Presentation only: source-token estimate excludes prompt, history and provider overhead. */
export function contextSummary(bundle: ContextBundle) {
  return {
    files: bundle.files.length,
    omitted: Math.max(0, bundle.requested - bundle.files.length),
    tokens: bundle.estimatedTokens ?? Math.ceil(bundle.characters / 4),
    truncated: bundle.files.filter((file) => file.truncated).length,
    focused: bundle.files.filter((file) => file.excerpted).length,
  };
}

export function reviewGroups(changes: SourceEdit[], accepted: string[], reviewed: string[]) {
  const groups = new Map<string, { fileId: string; path: string; changes: SourceEdit[] }>();
  for (const change of changes) {
    let group = groups.get(change.fileId);
    if (!group) {
      group = { fileId: change.fileId, path: change.path, changes: [] };
      groups.set(change.fileId, group);
    }
    group.changes.push(change);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    accepted: group.changes.filter((change) => accepted.includes(change.id)).length,
    reviewed: group.changes.filter((change) => reviewed.includes(change.id)).length,
  }));
}
