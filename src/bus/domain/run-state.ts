import type { Producer } from "./envelope.js";
import type { RUN_STAGES } from "./catalogue.js";

export type RunStage = (typeof RUN_STAGES)[number];

export const RUN_STATUSES = [
  "started",
  "workspace",
  "spec_drafting",
  "spec_review",
  "spec_approved",
  "designing",
  "planning",
  "building",
  "assembling",
  "publishing",
  "published",
  "failed",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export const TASK_STATUSES = [
  "ready",
  "tests_pending",
  "tests_red",
  "impl_pending",
  "verify_pending",
  "review_pending",
  "approved",
  "failed",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface TaskAttempts {
  readonly implementer: number;
  readonly testWriter: number;
  /* bus:CTR-008 (DLT-006): absent in snapshots written before factory-events 0.6.0; read through criticAttempts. */
  readonly critic?: number;
}

export interface TaskState {
  readonly status: TaskStatus;
  readonly attempts: TaskAttempts;
  readonly implementerAtRestart?: number;
  readonly handoffReruns: Readonly<Record<string, number>>;
  readonly baseSha: string | null;
  readonly testsSha: string | null;
  readonly implSha: string | null;
  readonly worktree: string;
  readonly covers: readonly string[];
  readonly writes: readonly string[];
  readonly dependsOn: readonly string[];
  readonly lastEvent: string;
}

export interface DesignProgress {
  readonly techReady: boolean;
  readonly verificationReady: boolean;
  readonly tasksPath: string | null;
}

export interface StageAttempts {
  readonly lintCycles: number;
  readonly criticRounds: number;
  readonly plannerRecuts: number;
  readonly architectRepairs: number;
  readonly assemblyRounds: number;
}

export interface CostEntry {
  readonly participant: Producer;
  readonly taskId: string | null;
  readonly stage: RunStage;
  readonly costUsd: number | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly model: string | null;
  readonly durationMs: number;
}

export interface CostLedger {
  readonly entries: readonly CostEntry[];
  readonly totalUsd: number;
}

export interface RunFailure {
  readonly stage: RunStage;
  readonly reason: string;
  readonly detail: string;
}

export interface RunState {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly slug: string;
  readonly operator: string;
  readonly status: RunStatus;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly lastSeq: number;
  readonly stageAttempts: StageAttempts;
  readonly stageHandoffReruns: Readonly<Record<string, number>>;
  readonly design: DesignProgress;
  readonly assumptionsByRecord: Readonly<Record<string, number>>;
  readonly tasks: Readonly<Record<string, TaskState>>;
  readonly costLedger: CostLedger;
  readonly failure: RunFailure | null;
  readonly simpleFixes: Readonly<Record<string, number>>;
}

export function createRunState(input: {
  readonly runId: string;
  readonly slug: string;
  readonly operator: string;
  readonly startedAt: string;
}): RunState {
  return {
    schemaVersion: 1,
    runId: input.runId,
    slug: input.slug,
    operator: input.operator,
    status: "started",
    startedAt: input.startedAt,
    updatedAt: input.startedAt,
    lastSeq: 0,
    stageAttempts: { lintCycles: 0, criticRounds: 0, plannerRecuts: 0, architectRepairs: 0, assemblyRounds: 0 },
    stageHandoffReruns: {},
    design: { techReady: false, verificationReady: false, tasksPath: null },
    assumptionsByRecord: {},
    tasks: {},
    costLedger: { entries: [], totalUsd: 0 },
    failure: null,
    simpleFixes: {},
  };
}

export function createTaskState(input: {
  readonly worktree: string;
  readonly covers: readonly string[];
  readonly writes: readonly string[];
  readonly dependsOn: readonly string[];
}): TaskState {
  return {
    status: "ready",
    attempts: { implementer: 0, testWriter: 0, critic: 0 },
    handoffReruns: {},
    baseSha: null,
    testsSha: null,
    implSha: null,
    worktree: input.worktree,
    covers: input.covers,
    writes: input.writes,
    dependsOn: input.dependsOn,
    lastEvent: "design.tasks.ready",
  };
}

const STAGE_BY_STATUS: Readonly<Record<RunStatus, RunStage>> = {
  started: "workspace",
  workspace: "workspace",
  spec_drafting: "spec",
  spec_review: "spec",
  spec_approved: "spec",
  designing: "design",
  planning: "design",
  building: "build",
  assembling: "assembly",
  publishing: "publish",
  published: "publish",
  failed: "publish",
};

export function stageOf(status: RunStatus, failure: RunFailure | null): RunStage {
  if (status === "failed" && failure !== null) {
    return failure.stage;
  }
  return STAGE_BY_STATUS[status];
}

export function isTerminalStatus(status: RunStatus): boolean {
  return status === "published" || status === "failed";
}

export function withCostEntry(ledger: CostLedger, entry: CostEntry): CostLedger {
  const entries = [...ledger.entries, entry];
  const totalUsd = entries.reduce((sum, item) => sum + (item.costUsd ?? 0), 0);
  return { entries, totalUsd: Math.round(totalUsd * 1e6) / 1e6 };
}

function simpleFixKey(owner: string, unit: string): string {
  return `${owner}:${unit}`;
}

/* factory:CST-005: the pair (owner role, unit) owns its own counter; unit is a task id, a stage name or "run". */
export function simpleFixAttempts(state: RunState, owner: string, unit: string): number {
  return state.simpleFixes[simpleFixKey(owner, unit)] ?? 0;
}

export function withSimpleFix(state: RunState, owner: string, unit: string): RunState {
  const key = simpleFixKey(owner, unit);
  return { ...state, simpleFixes: { ...state.simpleFixes, [key]: simpleFixAttempts(state, owner, unit) + 1 } };
}

export function criticAttempts(task: TaskState): number {
  return task.attempts.critic ?? 0;
}

export function withCriticAttempt(task: TaskState): TaskState {
  return { ...task, attempts: { ...task.attempts, critic: criticAttempts(task) + 1 } };
}
