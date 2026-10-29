import type { RunState } from "../../domain/run-state.js";

export interface StateStore {
  write(state: RunState): Promise<void>;
}
