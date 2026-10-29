import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RunState } from "../../domain/run-state.js";
import type { StateStore } from "../../ports/outbound/state-store.js";

export class AtomicJsonStore implements StateStore {
  private counter = 0;

  constructor(private readonly path: string) {}

  async write(state: RunState): Promise<void> {
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true });
    this.counter += 1;
    const temporary = join(directory, `.${process.pid}.${this.counter}.state.tmp`);
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(temporary, this.path);
  }
}
