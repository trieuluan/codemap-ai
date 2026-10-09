import * as ts from 'typescript';
import type {
  ExportBinding,
  FileNode,
  GraphSnapshot,
  ImportedSymbol,
  ImportSite,
  SourceSymbol,
  SymbolKind,
} from '../shared/model';

export function importSymbols(node: ts.Node, source: ts.SourceFile): ImportedSymbol[] {
  const result: ImportedSymbol[] = [];
  const add = (
    name: ts.Node,
    imported: string,
    local: string,
    form: ImportedSymbol['form'],
    typeOnly = false,
  ) => {
    result.push({
      id: String(name.getStart(source)),
      imported,
      local,
      form,
      typeOnly,
      ...source.getLineAndCharacterOfPosition(name.getStart(source)),
    });
  };
  if (ts.isImportDeclaration(node) && node.importClause) {
    const clause = node.importClause;
    if (clause.name) {
      add(clause.name, 'default', clause.name.text, 'default', clause.isTypeOnly);
    }
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      add(bindings.name, '*', bindings.name.text, 'namespace', clause.isTypeOnly);
    } else if (bindings) {
      for (const item of bindings.elements) {
        add(
          item.name,
          (item.propertyName ?? item.name).text,
          item.name.text,
          'named',
          clause.isTypeOnly || item.isTypeOnly,
        );
      }
    }
  } else if (
    ts.isExportDeclaration(node) &&
    node.moduleSpecifier &&
    node.exportClause &&
    ts.isNamedExports(node.exportClause)
  ) {
    for (const item of node.exportClause.elements) {
      add(
        item.name,
        (item.propertyName ?? item.name).text,
        item.name.text,
        'named',
        node.isTypeOnly || item.isTypeOnly,
      );
    }
  } else if (ts.isImportEqualsDeclaration(node)) {
    add(node.name, '*', node.name.text, 'require', node.isTypeOnly);
  } else if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'require' &&
    ts.isVariableDeclaration(node.parent)
  ) {
    const name = node.parent.name;
    if (ts.isIdentifier(name)) {
      add(name, '*', name.text, 'require');
    } else if (ts.isObjectBindingPattern(name)) {
      for (const item of name.elements) {
        if (
          !item.dotDotDotToken &&
          ts.isIdentifier(item.name) &&
          (!item.propertyName ||
            ts.isIdentifier(item.propertyName) ||
            ts.isStringLiteral(item.propertyName))
        ) {
          add(item.name, item.propertyName?.text ?? item.name.text, item.name.text, 'named');
        }
      }
    }
  }
  return result;
}

function expressionKind(expression: ts.Expression | undefined): SymbolKind {
  if (!expression) {
    return 'value';
  }
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    return 'function';
  }
  return ts.isClassExpression(expression) ? 'class' : 'value';
}

export function collectDeclarations(
  source: ts.SourceFile,
): Pick<FileNode, 'declarations' | 'exports'> {
  const declarations: SourceSymbol[] = [];
  const exports: ExportBinding[] = [];
  const add = (
    node: ts.Node,
    name: string,
    kind: SymbolKind,
    exported: boolean,
    isDefault: boolean,
  ) => {
    declarations.push({
      id: String(node.getStart(source)),
      name,
      kind,
      ...source.getLineAndCharacterOfPosition(node.getStart(source)),
    });
    if (exported) {
      exports.push({ name: isDefault ? 'default' : name, local: name });
    }
  };
  for (const statement of source.statements) {
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    const exported = !!modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    const isDefault = !!modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
    );
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      if (statement.name || isDefault) {
        add(
          statement.name ?? statement,
          statement.name?.text ?? 'default',
          ts.isFunctionDeclaration(statement) ? 'function' : 'class',
          exported,
          isDefault,
        );
      }
    } else if (
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isEnumDeclaration(statement)
    ) {
      add(
        statement.name,
        statement.name.text,
        ts.isInterfaceDeclaration(statement)
          ? 'interface'
          : ts.isTypeAliasDeclaration(statement)
            ? 'type'
            : 'enum',
        exported,
        false,
      );
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          const initializer = declaration.initializer;
          add(
            declaration.name,
            declaration.name.text,
            expressionKind(initializer),
            exported,
            false,
          );
        }
      }
    } else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      if (ts.isIdentifier(statement.expression)) {
        exports.push({ name: 'default', local: statement.expression.text });
      } else {
        const value = statement.expression;
        add(value, 'default', expressionKind(value), true, true);
      }
    } else if (ts.isExportDeclaration(statement)) {
      const siteId = statement.moduleSpecifier
        ? `${statement.getStart(source)}:re-export`
        : undefined;
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const item of statement.exportClause.elements) {
          exports.push(
            siteId
              ? { name: item.name.text, imported: (item.propertyName ?? item.name).text, siteId }
              : { name: item.name.text, local: (item.propertyName ?? item.name).text },
          );
        }
      } else if (!statement.exportClause && siteId) {
        exports.push({ name: '*', imported: '*', siteId });
      }
    }
  }
  return { declarations, exports };
}

// Follow only statically known exports over TypeScript-resolved file edges. Unknown
// or ambiguous shapes stay unclassified rather than inventing a declaration.
export function linkSymbols(
  nodes: FileNode[],
  edges: GraphSnapshot['edges'],
): GraphSnapshot['edges'] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const imports = new Map<string, { target: string; site: ImportSite }[]>();
  for (const edge of edges) {
    const items = imports.get(edge.source) ?? [];
    items.push(...edge.sites.map((site) => ({ target: edge.target, site })));
    imports.set(edge.source, items);
  }
  function resolve(
    nodeId: string,
    name: string,
    seen = new Set<string>(),
  ): ImportedSymbol['declaration'] | undefined {
    const key = JSON.stringify([nodeId, name]);
    if (seen.has(key) || name === '*') {
      return;
    }
    const next = new Set(seen).add(key);
    const node = byId.get(nodeId);
    const explicit = node?.exports?.filter((item) => item.name === name) ?? [];
    const bindings = explicit.length
      ? explicit
      : name === 'default'
        ? []
        : (node?.exports?.filter((item) => item.name === '*') ?? []);
    const matches = new Map<string, NonNullable<ImportedSymbol['declaration']>>();
    for (const binding of bindings) {
      let location: ImportedSymbol['declaration'];
      if (binding.local) {
        const local = node?.declarations?.find((item) => item.name === binding.local);
        if (local) {
          location = { nodeId, symbolId: local.id };
        } else {
          for (const item of imports.get(nodeId) ?? []) {
            const symbol = item.site.symbols?.find((symbol) => symbol.local === binding.local);
            if (symbol) {
              location = resolve(item.target, symbol.imported, next);
              break;
            }
          }
        }
      } else {
        const target = imports.get(nodeId)?.find((item) => item.site.id === binding.siteId)?.target;
        if (target) {
          location = resolve(target, binding.imported === '*' ? name : binding.imported!, next);
        }
      }
      if (location) {
        matches.set(JSON.stringify(location), location);
      }
    }
    return matches.size === 1 ? [...matches.values()][0] : undefined;
  }
  const resolutions = new Map<string, ImportedSymbol['declaration']>();
  return edges.map((edge) => ({
    ...edge,
    sites: edge.sites.map((site) => ({
      ...site,
      symbols: site.symbols?.map((symbol) => {
        const key = JSON.stringify([edge.target, symbol.imported]);
        if (!resolutions.has(key)) {
          resolutions.set(key, resolve(edge.target, symbol.imported));
        }
        const declaration = resolutions.get(key);
        const kind =
          declaration &&
          byId
            .get(declaration.nodeId)
            ?.declarations?.find((item) => item.id === declaration.symbolId)?.kind;
        return { ...symbol, declaration, kind };
      }),
    })),
  }));
}
