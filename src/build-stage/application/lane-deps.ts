import { createGitWorkingTree, type SimpleFixDeps } from "../../shared/fixer/index.js";
import { CommandFailedError, type CommandRunner } from "../ports/outbound/command-runner.js";
import type { DesignCache } from "./design-cache.js";
import type { Git } from "./git.js";
import { LaneRegistry } from "./lane-registry.js";

export interface LaneDeps {
  readonly commands: CommandRunner;
  readonly git: Git;
  readonly design: DesignCache;
  readonly lanes: LaneRegistry;
  readonly delay: (ms: number) => Promise<void>;
}

export function fixerDeps(deps: LaneDeps): SimpleFixDeps {
  return { tree: createGitWorkingTree(deps.commands), delay: deps.delay };
}

export async function recordText(deps: LaneDeps, productDir: string, id: string): Promise<string> {
  const result = await deps.commands.run("npx", ["sdd", "record", "get", id], { cwd: productDir });
  if (result.exitCode !== 0) {
    throw new Error(`sdd record get ${id} exited ${result.exitCode}: ${result.stderr.trim()}`);
  }
  return result.stdout.trimEnd();
}

export function errorText(error: unknown): string {
  if (error instanceof CommandFailedError) {
    return `${error.message}\n${error.result.stderr.trim()}`.trim();
  }
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
