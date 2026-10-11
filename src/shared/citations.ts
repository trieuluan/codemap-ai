/** Shared syntax for model citations; source bounds are validated by the host. */
export function citationMatches(text: string) {
  return text.matchAll(/\[\[([^\]\n]+):L(\d+)(?:-L?(\d+))?\]\]/g);
}
