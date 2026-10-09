import type { SyncState } from './shared/model';
export interface UpdateBatch { revision: number; full: boolean; invalidateConfig: boolean; ids: Set<string> }
export class UpdateScheduler<T> {
  private revision = 0;
  private pending?: UpdateBatch;
  private running?: Promise<void>;
  private abort?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  autoUpdate = true;
  constructor(private job: (batch: UpdateBatch, signal: AbortSignal) => Promise<T>,
    private publish: (value: T) => void, private status: (state: SyncState, error?: unknown) => void,
    private delay = 750) {}
  mark(ids: Iterable<string> = [], full = false, invalidateConfig = false) {
    if (this.disposed) { return; }
    this.revision++;
    this.pending = { revision: this.revision, full: full || !!this.pending?.full,
      invalidateConfig: invalidateConfig || !!this.pending?.invalidateConfig,
      ids: new Set([...(this.pending?.ids ?? []), ...ids]) };
    this.status('out-of-date');
    this.schedule();
  }
  private schedule() {
    clearTimeout(this.timer);
    if (this.autoUpdate && this.pending && !this.disposed) {
      this.timer = setTimeout(() => { void this.drain(); }, this.delay);
    }
  }
  async refresh(invalidateConfig = true) {
    this.mark([], true, invalidateConfig);
    clearTimeout(this.timer);
    await this.drain(true);
  }
  setAutoUpdate(enabled: boolean) {
    this.autoUpdate = enabled;
    clearTimeout(this.timer);
    if (enabled) { this.schedule(); }
    this.status(this.pending ? 'out-of-date' : this.running ? 'updating' : 'up-to-date');
  }
  cancel() {
    this.autoUpdate = false;
    clearTimeout(this.timer);
    this.abort?.abort();
    if (!this.pending) { this.mark([], true); }
    this.status('out-of-date');
  }
  private async drain(manual = false, followups = 1): Promise<void> {
    if (this.running) {
      if (manual) { await this.running; return this.drain(true, followups); }
      return;
    }
    if (!this.pending || this.disposed || (!manual && !this.autoUpdate)) { return; }
    const batch = this.pending;
    this.pending = undefined;
    const abort = new AbortController();
    this.abort = abort;
    this.status('updating');
    let failed = false;
    this.running = (async () => {
      try {
        const value = await this.job(batch, abort.signal);
        if (!this.disposed && !abort.signal.aborted && batch.revision === this.revision) {
          this.publish(value);
          this.status('up-to-date');
        }
      } catch (error) {
        failed = true;
        if (!this.disposed) {
          this.pending = { revision: this.revision, full: true, invalidateConfig: true,
            ids: new Set([...(this.pending?.ids ?? []), ...batch.ids]) };
          this.status(abort.signal.aborted ? 'out-of-date' : 'error', abort.signal.aborted ? undefined : error);
          // Retry only after another edit, re-enabling Auto Update, or Refresh.
          clearTimeout(this.timer);
          return;
        }
      }
    })();
    await this.running;
    this.running = undefined;
    this.abort = undefined;
    if (this.pending && !abort.signal.aborted && !failed) {
      // One immediate reconciliation is enough for a manual Refresh. Further
      // events return to the debounce queue instead of recursively scanning forever.
      if (manual && followups > 0) { clearTimeout(this.timer); await this.drain(true, followups - 1); }
      else if (this.autoUpdate) { this.schedule(); }
    }
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.abort?.abort();
    this.pending = undefined;
  }
}
