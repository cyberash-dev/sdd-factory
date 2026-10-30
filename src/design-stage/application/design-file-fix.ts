import { join } from "node:path";
import { withSimpleFix } from "../../bus/domain/run-state.js";
import type { EffectContext } from "../../bus/ports/outbound/effect-runner.js";
import { fixScopeOf, runSimpleFix, type FixCheck, type SimpleFixDeps, type SimpleFixResult } from "../../shared/fixer/index.js";
import { readTextOrNull } from "../../shared/fs/text.js";
import type { SliceContext } from "../../shared/slice.js";
import type { StageRole } from "./stage-role.js";

export interface DesignFileRepair {
  readonly owner: StageRole;
  readonly file: string;
  readonly failureOutput: string;
  readonly blocks: (text: string) => ReadonlyMap<string, string>;
  readonly parseError: (text: string) => string | null;
}

export interface DesignFileFixer {
  repair(request: DesignFileRepair): Promise<SimpleFixResult["verdict"]>;
}

const DESIGN_UNIT = "design";

function unwired(): never {
  throw new Error("design-stage: the simple-fixer working tree was not wired into this effect");
}

export const UNWIRED_FIX_DEPS: SimpleFixDeps = { tree: { snapshot: async () => unwired(), changesSince: async () => unwired(), restore: async () => unwired() }, delay: async () => unwired() };

function parseCheck(path: string, request: DesignFileRepair): () => Promise<FixCheck> {
  return async () => {
    const text = await readTextOrNull(path);
    const error = text === null ? `${request.file} was deleted` : request.parseError(text);
    return { passed: error === null, output: error ?? "" };
  };
}

/* design-stage:DLT-005. context.state is the snapshot taken when the effect started, so the runs made inside this effect are counted here and the cap holds across the effect's own author rework. */
export function createDesignFileFixer(slice: SliceContext, deps: SimpleFixDeps, context: EffectContext): DesignFileFixer {
  let state = context.state;
  return {
    async repair(request) {
      const directory = slice.paths.productDir;
      const result = await runSimpleFix(slice, deps, { state, publish: (pendingEvent) => context.publish(pendingEvent) }, {
        trigger: "design_file_invalid",
        owner: request.owner,
        unit: DESIGN_UNIT,
        taskId: null,
        directory,
        scope: fixScopeOf({ trigger: "design_file_invalid", file: request.file }),
        formatOnly: [{ path: request.file, parse: request.blocks }],
        failureOutput: request.failureOutput,
        check: parseCheck(join(directory, request.file), request),
      });
      state = result.runs.reduce((current) => withSimpleFix(current, request.owner, DESIGN_UNIT), state);
      return result.verdict;
    },
  };
}
