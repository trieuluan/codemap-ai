import type { AiProposal } from './ai';
import type { VerificationReport } from './verification';
import type { GraphSnapshot } from './model';
export interface ReviewState {
  proposal: AiProposal;
  accepted: string[];
  reviewed: string[];
  state: string;
  applied: string[];
}
export function reviewFileState(
  review: ReviewState,
  fileId: string,
  observation?: VerificationReport,
) {
  const edits = review.proposal.changes.filter((c) => c.fileId === fileId);
  if (!edits.length) {
    return undefined;
  }
  if (review.state === 'applied') {
    if (!edits.some((c) => review.applied.includes(c.id))) {
      return 'Rejected';
    }
    const sourceState =
      observation?.proposalId === review.proposal.id
        ? observation.changedFiles?.find((f) => f.id === fileId)?.sourceState
        : undefined;
    if (sourceState === 'reverted') {
      return 'Undone';
    }
    if (sourceState === 'modified') {
      return 'Modified after Apply';
    }
    if (sourceState === 'unavailable') {
      return 'Source unavailable';
    }
    return observation?.proposalId === review.proposal.id && !observation.stale
      ? 'Applied'
      : 'Applied earlier';
  }
  if (review.state !== 'ready') {
    return 'Expired';
  }
  const accepted = edits.filter((c) => review.accepted.includes(c.id));
  if (!accepted.length) {
    return 'Rejected';
  }
  return accepted.every((c) => review.reviewed.includes(c.id)) ? 'Reviewed' : 'Needs review';
}
export function importDelta(before: GraphSnapshot, after: GraphSnapshot) {
  const key = (source: string, target: string) => JSON.stringify([source, target]);
  const previous = new Set(before.edges.map((e) => key(e.source, e.target)));
  const current = new Set(after.edges.map((e) => key(e.source, e.target)));
  return {
    added: after.edges.filter((e) => !previous.has(key(e.source, e.target))),
    removed: before.edges.filter((e) => !current.has(key(e.source, e.target))),
  };
}
