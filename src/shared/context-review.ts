export function contextReviewKey(
  rootId: string,
  revision: number,
  sourceIds: string[],
  regionKey: string,
  question: string,
  editableIds?: string[],
) {
  return JSON.stringify([
    rootId,
    revision,
    [...sourceIds].sort(),
    regionKey,
    question.trim(),
    editableIds ? [...editableIds].sort() : null,
  ]);
}
