import { codeMapTools, graphToolData } from '../shared/ai-tools';
import * as vscode from 'vscode';
import type { GraphSnapshot } from '../shared/model';
import type { ContextBundle } from '../shared/context';
import { contextMarkdown } from '../shared/context';

export function registerCodeMapTools(
  context: vscode.ExtensionContext,
  getData: () => Promise<{ graph: GraphSnapshot; bundle?: ContextBundle }>,
) {
  for (const name of codeMapTools) {
    context.subscriptions.push(
      vscode.lm.registerTool(name, {
        async invoke(
          options: vscode.LanguageModelToolInvocationOptions<{ path?: string; depth?: number }>,
          token,
        ) {
          if (token.isCancellationRequested) {
            throw new vscode.CancellationError();
          }
          if (name === 'codemap_get_selected_context' && !vscode.workspace.isTrusted) {
            throw new Error('Trust this workspace before sharing source context.');
          }
          const { graph, bundle } = await getData();
          if (token.isCancellationRequested) {
            throw new vscode.CancellationError();
          }
          let text: string;
          if (name === 'codemap_get_selected_context') {
            if (!bundle || bundle.revision !== graph.revision || bundle.rootId !== graph.root.id) {
              throw new Error('Open CodeMap → Context, select files and Preview context first.');
            }
            text = contextMarkdown(bundle);
          } else {
            text = JSON.stringify(graphToolData(name, graph, options.input));
          }
          const budget = options.tokenizationOptions;
          if (budget && (await budget.countTokens(text, token)) > budget.tokenBudget) {
            throw new Error(
              'CodeMap result exceeds the tool token budget. Narrow the context selection or request a file dependency/impact tool.',
            );
          }
          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
        },
        prepareInvocation() {
          return {
            invocationMessage:
              name === 'codemap_get_selected_context'
                ? 'Reading reviewed CodeMap source context'
                : 'Reading CodeMap import graph',
            confirmationMessages: {
              title: 'Use CodeMap context',
              message:
                name === 'codemap_get_selected_context'
                  ? 'Provide the latest reviewed source context and notes to this agent?'
                  : 'Provide local file paths, symbols and dependency metadata to this agent?',
            },
          };
        },
      }),
    );
  }
}
