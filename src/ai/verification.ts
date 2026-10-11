import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import type { GraphSnapshot } from '../shared/model';
import {
  diagnosticChanges,
  graphChanges,
  verificationContext,
  type ObservedDiagnostic,
  type VerificationReport,
} from '../shared/verification';
import type { AiHostMessage } from '../shared/ai';
import { TestRunner } from './test-runner';

/** Observations remain local unless a subsequent AI request explicitly includes this report. */
export class Verification implements vscode.Disposable {
  private report?: VerificationReport;
  private history: VerificationReport[] = [];
  private baseline?: { graph: GraphSnapshot; diagnostics: ObservedDiagnostic[] };
  private disposed = false;
  private running = false;
  private sourceRevision = 0;
  private generation = 0;
  private listeners: vscode.Disposable[];
  constructor(
    private graph: () => GraphSnapshot | undefined,
    private post: (message: AiHostMessage) => void,
    private runner = new TestRunner(),
  ) {
    this.listeners = [
      vscode.workspace.onDidChangeTextDocument((event) => {
        const root = this.graph()?.root.id;
        if (
          root &&
          event.contentChanges.length &&
          event.document.uri.toString().startsWith(root.replace(/\/$/, '') + '/')
        ) {
          this.sourceRevision++;
        }
        if (
          this.report &&
          root &&
          event.contentChanges.length &&
          event.document.uri.toString().startsWith(root.replace(/\/$/, '') + '/')
        ) {
          this.report!.stale = true;
          this.publish();
        }
      }),
      vscode.languages.onDidChangeDiagnostics(() => {
        if (this.report && !this.report.stale && this.baseline) {
          const diagnostics = this.diagnostics(this.graph());
          Object.assign(this.report, {
            diagnostics,
            ...diagnosticChanges(this.baseline.diagnostics, diagnostics),
            observedAt: new Date().toISOString(),
          });
          this.publish();
        }
      }),
    ];
  }
  get isRunning() {
    return this.running;
  }
  diagnostics(graph: GraphSnapshot | undefined): ObservedDiagnostic[] {
    if (!graph) {
      return [];
    }
    return graph.nodes
      .flatMap((node) =>
        vscode.languages.getDiagnostics(vscode.Uri.parse(node.id)).map((d) => ({
          fileId: node.id,
          path: node.path,
          line: d.range.start.line + 1,
          character: d.range.start.character,
          severity: (['error', 'warning', 'information', 'hint'] as const)[d.severity],
          message: d.message.slice(0, 2000),
          source: d.source,
        })),
      )
      .slice(0, 100);
  }
  async observe(
    before: GraphSnapshot,
    diagnostics: ObservedDiagnostic[],
    proposalId: string,
    ids: string[],
    refresh: () => Promise<void>,
  ) {
    const generation = this.generation;
    const sourceRevision = this.sourceRevision;
    let graphError: string | undefined;
    try {
      await refresh();
    } catch (error) {
      graphError = String(error);
    }
    if (
      this.disposed ||
      generation !== this.generation ||
      this.graph()?.root.id !== before.root.id
    ) {
      return;
    }
    const after = this.graph()!;
    const observed = this.diagnostics(after);
    this.baseline = { graph: before, diagnostics };
    this.report = {
      id: randomUUID(),
      rootId: before.root.id,
      proposalId,
      revision: after.revision,
      observedAt: new Date().toISOString(),
      stale: !!graphError || sourceRevision !== this.sourceRevision,
      changedFiles: before.nodes
        .filter((n) => ids.includes(n.id))
        .map((n) => ({ id: n.id, path: n.path })),
      diagnostics: observed,
      ...diagnosticChanges(diagnostics, observed),
      ...graphChanges(before, after, ids),
      graphError,
    };
    this.publish();
  }
  changed() {
    if (this.report) {
      this.report.stale = true;
      this.publish();
    }
  }
  publish() {
    if (this.disposed || !this.report || this.graph()?.root.id !== this.report.rootId) {
      return;
    }
    if (this.graph()?.revision !== this.report.revision) {
      this.report.stale = true;
    }
    this.history = [
      structuredClone(this.report),
      ...this.history.filter((r) => r.id !== this.report!.id).map((r) => ({ ...r, stale: true })),
    ].slice(0, 8);
    this.post({ type: 'aiVerification', report: structuredClone(this.report) });
    this.post({
      type: 'aiVerificationHistory',
      rootId: this.report.rootId,
      reports: structuredClone(this.history),
    });
  }
  context(id: string, rootId: string) {
    this.publish();
    if (
      !this.report ||
      this.report.id !== id ||
      this.report.rootId !== rootId ||
      this.report.stale ||
      this.running
    ) {
      throw new Error(
        'Verification is stale or still running. Apply fresh changes or omit verification.',
      );
    }
    return verificationContext(this.report);
  }
  async openDiagnostic(id: string, index: number) {
    try {
      this.context(id, this.graph()?.root.id ?? '');
      const report = this.report!;
      const diagnostic =
        Number.isInteger(index) && index >= 0 ? report.diagnostics[index] : undefined;
      if (!diagnostic || !this.graph()?.nodes.some((n) => n.id === diagnostic.fileId)) {
        throw new Error('Diagnostic no longer available.');
      }
      const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(diagnostic.fileId));
      if (this.report !== report || report.stale || this.graph()?.revision !== report.revision) {
        throw new Error('Diagnostic source changed.');
      }
      if (
        diagnostic.line < 1 ||
        diagnostic.line > document.lineCount ||
        diagnostic.character < 0 ||
        diagnostic.character > document.lineAt(diagnostic.line - 1).text.length
      ) {
        throw new Error('Diagnostic position no longer available.');
      }
      const position = new vscode.Position(diagnostic.line - 1, diagnostic.character);
      await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.Beside,
        selection: new vscode.Range(position, position),
        preview: true,
      });
    } catch (error) {
      this.post({ type: 'aiVerificationError', reportId: id, message: String(error) });
    }
  }
  async test(id: string, save: boolean) {
    const report = this.report;
    if (!report || report.id !== id || this.graph()?.root.id !== report.rootId || this.running) {
      return;
    }
    this.running = true;
    try {
      const root = vscode.Uri.parse(report.rootId);
      const choice = await this.runner.choose(root);
      if (
        !choice ||
        this.disposed ||
        this.report !== report ||
        this.graph()?.root.id !== report.rootId
      ) {
        return;
      }
      const sourceRevision = this.sourceRevision;
      if (save) {
        for (const file of report.changedFiles) {
          const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(file.id));
          if (!(await document.save())) {
            throw new Error(`Could not save ${file.path}.`);
          }
        }
      }
      if (this.disposed || this.report !== report || this.graph()?.root.id !== report.rootId) {
        return;
      }
      if (sourceRevision !== this.sourceRevision) {
        report.stale = true;
      }
      await this.runner.run(root, choice, save, (test) => {
        if (this.report === report) {
          report.test = test;
          this.publish();
        }
      });
    } catch (error) {
      this.post({ type: 'aiVerificationError', reportId: id, message: String(error) });
    } finally {
      this.running = false;
    }
  }
  stop() {
    this.runner.stop();
  }
  reset() {
    this.generation++;
    this.runner.stop();
    this.report = undefined;
    this.history = [];
    this.baseline = undefined;
  }
  dispose() {
    this.disposed = true;
    this.reset();
    this.runner.dispose();
    this.listeners.forEach((d) => d.dispose());
  }
}
