import type { GraphViewState } from './shared/model';
import { readView } from './shared/view';
export interface StateStorage { get<T>(key: string): T | undefined; update(key: string, value: unknown): Thenable<void> | Promise<void> }
export class ViewStore {
  private latest = new Map<string, GraphViewState>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private writes = Promise.resolve();
  constructor(private storage?: StateStorage, private report: (error: unknown) => void = () => {}) {}
  get(root: string) { return this.latest.get(root) ?? readView(this.storage?.get(`codemap.view.${root}`)); }
  save(root: string, state: unknown) {
    this.latest.set(root, readView(state));
    clearTimeout(this.timers.get(root));
    this.timers.set(root, setTimeout(() => { this.timers.delete(root); void this.persist(root); }, 300));
  }
  private persist(root: string) {
    const value = this.latest.get(root);
    this.writes = this.writes.then(async () => { await this.storage?.update(`codemap.view.${root}`, value); }).catch(this.report);
    return this.writes;
  }
  async flush() {
    for (const [root, timer] of this.timers) { clearTimeout(timer); void this.persist(root); }
    this.timers.clear();
    await this.writes;
  }
}
