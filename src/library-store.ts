import type { StateStorage } from './view-store';
import { readLibrary, type WorkspaceLibrary } from './shared/library';
/** Explicit library edits persist immediately; writes are ordered across roots. */
export class LibraryStore {
  private latest = new Map<string, WorkspaceLibrary>();
  private writes = Promise.resolve();
  constructor(private storage?: StateStorage) {}
  get(root: string) {
    return this.latest.get(root) ?? readLibrary(this.storage?.get(`codemap.library.${root}`));
  }
  save(root: string, value: unknown) {
    const library = readLibrary(value);
    this.latest.set(root, library);
    const write = this.writes.then(async () => {
      await this.storage?.update(`codemap.library.${root}`, library);
    });
    this.writes = write.catch(() => {});
    return write;
  }
  flush() {
    return this.writes;
  }
}
