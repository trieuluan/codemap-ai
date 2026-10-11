import * as vscode from 'vscode';
import { randomUUID, createHash } from 'node:crypto';
import type { GraphSnapshot } from '../shared/model';
import {
  appliedSourceState,
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
  private appliedSources = new Map<string, { before: string; applied: string }>();
  private observedSources = new Map<string, string | undefined>();
  private rechecking = false;
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
    return this.running || this.rechecking;
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
    sources = new Map<string, { before: string; applied: string }>(),
  ) {
    this.appliedSources = sources;
    this.observedSources.clear();
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
  async recheck(id: string, refresh: () => Promise<void>) {
    const report = this.report;
    if (
      !report ||
      report.id !== id ||
      this.isRunning ||
      !this.baseline ||
      this.graph()?.root.id !== report.rootId
    ) {
      return;
    }
    this.rechecking = true;
    report.refreshing = true;
    this.publish();
    const generation = this.generation;
    const sourceRevision = this.sourceRevision;
    try {
      await refresh();
      if (
        this.disposed ||
        this.report !== report ||
        generation !== this.generation ||
        this.graph()?.root.id !== report.rootId
      ) {
        return;
      }
      for (const file of report.changedFiles) {
        try {
          const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(file.id));
          this.observedSources.set(
            file.id,
            createHash('sha256').update(document.getText()).digest('hex'),
          );
        } catch {
          this.observedSources.set(file.id, undefined);
        }
      }
      if (
        this.disposed ||
        this.report !== report ||
        generation !== this.generation ||
        this.graph()?.root.id !== report.rootId
      ) {
        return;
      }
      const graph = this.graph()!;
      const diagnostics = this.diagnostics(graph);
      this.report = {
        ...report,
        revision: graph.revision,
        observedAt: new Date().toISOString(),
        stale: sourceRevision !== this.sourceRevision,
        refreshing: false,
        graphError: undefined,
        diagnostics,
        ...diagnosticChanges(this.baseline.diagnostics, diagnostics),
        ...graphChanges(
          this.baseline.graph,
          graph,
          report.changedFiles.map((f) => f.id),
        ),
        test: report.test ? { ...report.test, stale: true } : undefined,
      };
      this.publish();
    } catch (error) {
      if (this.disposed || this.report !== report || generation !== this.generation) {
        return;
      }
      report.stale = true;
      report.refreshing = false;
      this.publish();
      this.post({ type: 'aiVerificationError', reportId: id, message: String(error) });
    } finally {
      if (generation === this.generation && this.report?.id === id && this.report.refreshing) {
        this.report.refreshing = false;
        this.publish();
      }
      this.rechecking = false;
    }
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
    for (const file of this.report.changedFiles) {
      const baseline = this.appliedSources.get(file.id);
      if (baseline) {
        const document = vscode.workspace.textDocuments.find(
          (d) => d.uri.toString() === file.id && !d.isClosed,
        );
        const digest = document
          ? createHash('sha256').update(document.getText()).digest('hex')
          : this.observedSources.get(file.id);
        file.sourceState = appliedSourceState(baseline.before, baseline.applied, digest);
      }
    }
    if (this.report.stale && this.report.test) {
      this.report.test.stale = true;
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
      this.isRunning
    ) {
      throw new Error(
        'Verification is stale or still running. Refresh observations or omit verification.',
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
    if (!report || report.id !== id || this.graph()?.root.id !== report.rootId || this.isRunning) {
      return;
    }
    this.running = true;
    try {
      if (report.stale || this.graph()?.revision !== report.revision) {
        throw new Error('Verification is stale. Refresh observations before testing.');
      }
      const root = vscode.Uri.parse(report.rootId);
      const choice = await this.runner.choose(
        root,
        report.changedFiles.map((file) => file.path),
      );
      if (
        !choice ||
        this.disposed ||
        this.report !== report ||
        this.graph()?.root.id !== report.rootId
      ) {
        return;
      }
      if (report.stale || this.graph()?.revision !== report.revision) {
        throw new Error('Source changed while choosing a test.');
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
        this.publish();
        throw new Error('Source changed before test execution.');
      }
      if (report.stale || this.graph()?.revision !== report.revision) {
        throw new Error('Verification changed before test execution.');
      }
      await this.runner.run(
        root,
        choice,
        save,
        (test) => {
          if (this.report === report) {
            report.test = test;
            this.publish();
          }
        },
        () =>
          !this.disposed &&
          this.report === report &&
          !report.stale &&
          this.sourceRevision === sourceRevision &&
          this.graph()?.root.id === report.rootId &&
          this.graph()?.revision === report.revision,
      );
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
    this.appliedSources.clear();
    this.observedSources.clear();
  }
  dispose() {
    this.disposed = true;
    this.reset();
    this.runner.dispose();
    this.listeners.forEach((d) => d.dispose());
  }
}
