import type { AiReference } from './ai';
import { citationMatches } from './citations';
interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
}
/** Only text nodes become citations; code, images and existing links stay untouched. */
export function linkCitations(tree: unknown, references: AiReference[]) {
  const visit = (node: MarkdownNode) => {
    if (!node.children || ['code', 'inlineCode', 'link', 'image'].includes(node.type)) {
      return;
    }
    node.children = node.children.flatMap((child) => {
      if (child.type !== 'text' || !child.value) {
        visit(child);
        return [child];
      }
      const result: MarkdownNode[] = [];
      let offset = 0;
      for (const match of citationMatches(child.value)) {
        const index = references.findIndex(
          (r) =>
            r.path === match[1] &&
            r.line === Number(match[2]) &&
            (r.endLine ?? r.line) === Number(match[3] ?? match[2]),
        );
        if (index < 0) {
          continue;
        }
        result.push({ type: 'text', value: child.value.slice(offset, match.index) });
        result.push({
          type: 'link',
          url: `#codemap-citation-${index}`,
          children: [
            {
              type: 'text',
              value: `${references[index].path.split('/').at(-1)}:${references[index].line}${references[index].endLine ? `–${references[index].endLine}` : ''}`,
            },
          ],
        });
        offset = match.index! + match[0].length;
      }
      result.push({ type: 'text', value: child.value.slice(offset) });
      return result;
    });
  };
  visit(tree as MarkdownNode);
}
