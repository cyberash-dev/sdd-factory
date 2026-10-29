import type { RunStage } from "../../bus/domain/run-state.js";

export type ManifestStatus = "running" | "published" | "failed";

export interface RunCounters {
  readonly tasks: number;
  readonly tasksApproved: number;
  readonly tasksFailed: number;
  readonly reworks: number;
}

export interface RunManifest {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly slug: string;
  readonly specPath: string;
  readonly operator: string;
  readonly mode: "autonomous";
  readonly status: ManifestStatus;
  readonly stage: RunStage;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly reason: string | null;
  readonly commitSha: string | null;
  readonly outputDir: string | null;
  readonly pushed: boolean | null;
  readonly counters: RunCounters;
}

export function createRunManifest(input: {
  readonly runId: string;
  readonly slug: string;
  readonly specPath: string;
  readonly operator: string;
  readonly startedAt: string;
}): RunManifest {
  return {
    schemaVersion: 1,
    runId: input.runId,
    slug: input.slug,
    specPath: input.specPath,
    operator: input.operator,
    mode: "autonomous",
    status: "running",
    stage: "workspace",
    startedAt: input.startedAt,
    endedAt: null,
    reason: null,
    commitSha: null,
    outputDir: null,
    pushed: null,
    counters: { tasks: 0, tasksApproved: 0, tasksFailed: 0, reworks: 0 },
  };
}

export function exitCodeOf(status: ManifestStatus): 0 | 1 {
  return status === "published" ? 0 : 1;
}
