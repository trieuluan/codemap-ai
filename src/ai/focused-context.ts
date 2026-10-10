import * as ts from 'typescript';
import { createHash } from 'node:crypto';
import type { ContextOptions, ContextExcerpt } from '../shared/context';
import type { FileNode, GraphSnapshot } from '../shared/model';

/** AST statement ranges preserve original line numbers and never expand the selected file set. */
export function focusedSource(graph: GraphSnapshot, ids: string[], options: ContextOptions) {
  return (file: FileNode, text: string) => {
    const source = ts.createSourceFile(file.path, text, ts.ScriptTarget.Latest, true);
    const lines = text.split('\n');
    const selected = new Set(ids);
    const names = new Set(
      graph.edges
        .filter((e) => selected.has(e.source))
        .flatMap((e) => e.sites.flatMap((s) => s.symbols ?? []))
        .filter((s) => s.declaration?.nodeId === file.id)
        .map((s) => file.declarations?.find((d) => d.id === s.declaration?.symbolId)?.name)
        .filter((n): n is string => !!n),
    );
    const focus =
      options.symbol?.nodeId === file.id
        ? file.declarations?.find((s) => s.id === options.symbol?.symbolId)
        : undefined;
    if (focus) {
      names.add(focus.name);
    }
    const statementAt = (line: number) =>
      source.statements.find((s) => {
        const start = source.getLineAndCharacterOfPosition(s.getStart(source)).line;
        const end = source.getLineAndCharacterOfPosition(
          Math.max(s.getStart(source), s.end - 1),
        ).line;
        return line >= start && line <= end;
      });
    const priority = [
      ...(focus ? [statementAt(focus.line)] : []),
      ...source.statements.filter(
        (s) =>
          ts.isImportDeclaration(s) || ts.isImportEqualsDeclaration(s) || ts.isExportDeclaration(s),
      ),
      ...(file.declarations ?? []).filter((s) => names.has(s.name)).map((s) => statementAt(s.line)),
      ...(!focus && !names.size
        ? (file.declarations ?? []).slice(0, 3).map((s) => statementAt(s.line))
        : []),
    ].filter((s): s is ts.Statement => !!s);
    if (!priority.length) {
      priority.push(...source.statements.slice(0, 3));
    }
    const ranges: { start: number; end: number }[] = [];
    let budget = focus ? 12000 : 6000;
    for (const statement of new Set(priority)) {
      const start = source.getLineAndCharacterOfPosition(statement.getStart(source, true)).line;
      const end = source.getLineAndCharacterOfPosition(
        Math.max(statement.getStart(source), statement.end - 1),
      ).line;
      let last = start - 1;
      for (let line = start; line <= end; line++) {
        if (lines[line].length + 1 > budget) {
          break;
        }
        budget -= lines[line].length + 1;
        last = line;
      }
      if (last >= start) {
        ranges.push({ start, end: last });
      }
    }
    ranges.sort((a, b) => a.start - b.start);
    const merged: typeof ranges = [];
    for (const range of ranges) {
      const previous = merged.at(-1);
      if (previous && range.start <= previous.end + 1) {
        previous.end = Math.max(previous.end, range.end);
      } else {
        merged.push({ ...range });
      }
    }
    const excerpts: ContextExcerpt[] = merged.map((r) => ({
      startLine: r.start + 1,
      endLine: r.end + 1,
      content: lines.slice(r.start, r.end + 1).join('\n'),
    }));
    return {
      content: excerpts.map((e) => e.content).join('\n'),
      excerpts,
      sourceDigest: createHash('sha256').update(text).digest('hex'),
      excerpted: true,
    };
  };
}
