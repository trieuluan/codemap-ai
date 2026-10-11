import type { ContextBundle } from './context';

/** Lines are one-based, columns zero-based UTF-16; end is exclusive. */
export interface EditPosition {
  line: number;
  character: number;
}
export interface SourceEdit {
  id: string;
  fileId: string;
  path: string;
  start: EditPosition;
  end: EditPosition;
  startOffset: number;
  endOffset: number;
  oldText: string;
  content: string;
  reason: string;
  symbols: string[];
}
export interface EditProposal {
  id: string;
  summary: string;
  changes: SourceEdit[];
}
export function sourceOffset(text: string, position: EditPosition) {
  if (
    !position ||
    !Number.isSafeInteger(position.line) ||
    !Number.isSafeInteger(position.character) ||
    position.line < 1 ||
    position.character < 0
  ) {
    throw new Error('Invalid edit position.');
  }
  const lines = text.split('\n');
  const line = lines[position.line - 1];
  if (line === undefined || position.character > line.replace(/\r$/, '').length) {
    throw new Error('Edit range is outside source.');
  }
  return (
    lines.slice(0, position.line - 1).reduce((n, s) => n + s.length + 1, 0) + position.character
  );
}
export function parseEdits(text: string, bundle: ContextBundle, id: string): EditProposal {
  const value = JSON.parse(text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, '$1'));
  if (
    !value ||
    typeof value.summary !== 'string' ||
    value.summary.length > 8000 ||
    !Array.isArray(value.changes) ||
    value.changes.length > 40
  ) {
    throw new Error('Invalid proposal. Use at most 40 range edits in 10 existing files.');
  }
  const changes: SourceEdit[] = value.changes.map((raw: unknown, index: number) => {
    if (!raw || typeof raw !== 'object') {
      throw new Error('Invalid range edit.');
    }
    const c = raw as {
      path?: unknown;
      start?: EditPosition;
      end?: EditPosition;
      oldText?: unknown;
      content?: unknown;
      reason?: unknown;
    };
    const file = bundle.files.find((f) => f.path === c.path);
    if (!file || file.truncated || file.excerpted) {
      throw new Error('Proposal targets an unknown, duplicate or truncated context file.');
    }
    if (
      typeof c.oldText !== 'string' ||
      typeof c.content !== 'string' ||
      c.content.length > 100000 ||
      typeof c.reason !== 'string' ||
      !c.reason.trim() ||
      c.reason.length > 2000 ||
      !c.start ||
      !c.end
    ) {
      throw new Error('Range edit needs positions, exact oldText, replacement content and reason.');
    }
    const startOffset = sourceOffset(file.content, c.start),
      endOffset = sourceOffset(file.content, c.end);
    if (startOffset > endOffset || file.content.slice(startOffset, endOffset) !== c.oldText) {
      throw new Error('Edit range does not match original source.');
    }
    return {
      id: `${id}:${index}`,
      fileId: file.id,
      path: file.path,
      start: c.start,
      end: c.end,
      startOffset,
      endOffset,
      oldText: c.oldText,
      content: c.content,
      reason: c.reason.trim(),
      symbols: (file.declarations ?? [])
        .filter((s) => s.line + 1 >= c.start!.line && s.line + 1 <= c.end!.line)
        .map((s) => s.name),
    };
  });
  if (new Set(changes.map((c) => c.fileId)).size > 10) {
    throw new Error('At most 10 files per proposal.');
  }
  assertNonOverlapping(changes);
  return { id, summary: value.summary, changes: changes.filter((c) => c.oldText !== c.content) };
}
export function assertNonOverlapping(
  changes: Pick<SourceEdit, 'fileId' | 'startOffset' | 'endOffset'>[],
) {
  const sorted = [...changes].sort(
    (a, b) =>
      a.fileId.localeCompare(b.fileId) ||
      a.startOffset - b.startOffset ||
      a.endOffset - b.endOffset,
  );
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1],
      b = sorted[i];
    if (
      a.fileId === b.fileId &&
      (b.startOffset < a.endOffset ||
        b.startOffset === a.startOffset ||
        (a.startOffset === a.endOffset && a.endOffset === b.startOffset))
    ) {
      throw new Error('Overlapping or ambiguous edits are not allowed.');
    }
  }
}
export function editContent(
  original: string,
  changes: Pick<SourceEdit, 'startOffset' | 'endOffset' | 'content'>[],
) {
  let result = original;
  for (const c of [...changes].sort((a, b) => b.startOffset - a.startOffset)) {
    result = result.slice(0, c.startOffset) + c.content + result.slice(c.endOffset);
  }
  return result;
}
export class EditConflict extends Error {
  constructor(
    message: string,
    public fileId: string,
    public changeId?: string,
  ) {
    super(message);
    this.name = 'EditConflict';
  }
}
/** Rebase only with unique unchanged surrounding source; never guess between repeated matches. */
export function rebaseEdit(edit: SourceEdit, original: string, current: string): SourceEdit {
  if (original === current) {
    return edit;
  }
  const before = original.slice(Math.max(0, edit.startOffset - 80), edit.startOffset);
  const after = original.slice(edit.endOffset, edit.endOffset + 80);
  const anchor = before + edit.oldText + after;
  const first = anchor ? current.indexOf(anchor) : -1;
  if (first < 0 || current.indexOf(anchor, first + 1) >= 0) {
    throw new EditConflict(
      `Source changed near ${edit.path}:${edit.start.line}. Review fresh context and propose again.`,
      edit.fileId,
      edit.id,
    );
  }
  return {
    ...edit,
    startOffset: first + before.length,
    endOffset: first + before.length + edit.oldText.length,
  };
}
export function prepareEdits(
  proposal: EditProposal,
  bundle: ContextBundle,
  ids: string[],
  current: Map<string, string>,
) {
  if (
    !ids.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !proposal.changes.some((c) => c.id === id))
  ) {
    throw new Error('Choose valid changes to apply.');
  }
  const selected = proposal.changes.filter((c) => ids.includes(c.id));
  const targets = new Set(selected.map((c) => c.fileId));
  for (const f of bundle.files) {
    if (
      f.truncated ||
      f.excerpted ||
      !current.has(f.id) ||
      (!targets.has(f.id) && current.get(f.id) !== f.content)
    ) {
      throw new EditConflict(
        `Source changed in supporting context: ${f.path}. Prepare fresh source and propose again.`,
        f.id,
      );
    }
  }
  const rebased = selected.map((c) =>
    rebaseEdit(c, bundle.files.find((f) => f.id === c.fileId)!.content, current.get(c.fileId)!),
  );
  assertNonOverlapping(rebased);
  return rebased;
}
