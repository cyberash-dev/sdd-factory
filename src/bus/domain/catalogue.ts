import { BusError, isProducer, RUN_ID_PATTERN, type EventPayload, type FactoryEvent } from "./envelope.js";

type FieldKind = "string" | "integer" | "number" | "boolean" | "string[]" | "object" | "number|null" | "string|null";

export interface FieldSpec {
  readonly kind: FieldKind;
  readonly values?: readonly string[];
  readonly literal?: string;
  readonly pattern?: RegExp;
  readonly min?: number;
}

const string = (extra: Omit<FieldSpec, "kind"> = {}): FieldSpec => ({ kind: "string", ...extra });
const integer = (extra: Omit<FieldSpec, "kind"> = {}): FieldSpec => ({ kind: "integer", ...extra });
const boolean = (): FieldSpec => ({ kind: "boolean" });
const strings = (): FieldSpec => ({ kind: "string[]" });
const object = (): FieldSpec => ({ kind: "object" });
const numberOrNull = (): FieldSpec => ({ kind: "number|null" });
const stringOrNull = (extra: Omit<FieldSpec, "kind"> = {}): FieldSpec => ({ kind: "string|null", ...extra });

const SHA = /^[0-9a-f]{40}$/;
const TASK_ID = /^T-[0-9]{3}$/;
const SLUG = /^[a-z][a-z0-9-]*$/;

export const RUN_STAGES = ["workspace", "spec", "design", "build", "assembly", "publish"] as const;
export const RUN_FAILED_REASONS = [
  "lint_cap",
  "critic_cap",
  "analyst_blocked",
  "design_blocked",
  "cap_exhausted",
  "unparseable_handoff",
  "tooling_broken",
  "runtime_error",
  "publish_failed",
  "trace_write_failed",
  "terminated",
  "stalled",
] as const;
export const INTERVENTION_KINDS = ["launch", "fix_between_runs", "mid_run_nudge"] as const;
export const FINDING_TYPES = ["TEST-CONTRACT-CONFLICT", "TASK-OVERFLOW", "VD-INFEASIBLE", "TOOLING-BROKEN"] as const;
export const REVIEW_DECISIONS = ["approve", "request_changes", "advisory_only"] as const;
export const REVIEW_TARGETS = ["implementer", "test-writer", "architect", "contract", "none"] as const;
export const REWORK_TARGETS = ["implementer", "test-writer", "planner", "architect", "critic"] as const;
export const TESTS_REJECTED_REASONS = ["vacuous", "suite_error", "missing_covers", "orphan_covers", "outside_write_set"] as const;
export const TASK_FAILED_REASONS = ["cap_exhausted", "unparseable_handoff", "blocked"] as const;
export const ASSEMBLY_STEPS = ["install", "typecheck", "test", "sdd_ready"] as const;
export const ASSEMBLY_TARGETS = ["implementer", "test-writer", "planner"] as const;
export const FIX_STAGES = ["spec", "design", "build", "assembly"] as const;
export const FIX_OWNERS = ["spec-analyst", "architect", "verification-designer", "planner", "test-writer", "implementer", "assembler"] as const;
export const FIX_TRIGGERS = [
  "spec_yaml_invalid",
  "design_file_invalid",
  "red_suite_error",
  "green_typecheck",
  "green_load_failure",
  "assembly_install",
  "assembly_typecheck",
  "assembly_load_failure",
] as const;
export const FIX_OUTCOMES = ["fixed", "unfixed", "discarded"] as const;

const costFields = {
  attempt: integer({ min: 1 }),
  handoffPath: string(),
  costUsd: numberOrNull(),
  inputTokens: integer({ min: 0 }),
  outputTokens: integer({ min: 0 }),
  durationMs: integer({ min: 0 }),
} as const;

export const EVENT_CATALOGUE = {
  "run.started": { specPath: string(), slug: string({ pattern: SLUG }), operator: string(), mode: string({ literal: "autonomous" }) },
  "workspace.ready": { productDir: string(), slug: string({ pattern: SLUG }), baselineId: string() },
  "run.failed": { stage: string({ values: RUN_STAGES }), reason: string({ values: RUN_FAILED_REASONS }), detail: string() },
  "run.published": { commitSha: string({ pattern: SHA }), outputDir: string(), pushed: boolean() },
  "human.intervention": { kind: string({ values: INTERVENTION_KINDS }), note: string(), actor: string() },
  "spec.drafted": { attempt: integer({ min: 1 }), lintExit: integer({ literal: "0" }), recordCounts: object() },
  "spec.reviewed": { round: integer({ min: 1 }), decision: string({ values: ["accept", "rework"] }), findingsPath: string() },
  "spec.rework": { round: integer({ min: 1 }), findingsPath: string() },
  "spec.approved": { approver: string(), mode: string({ literal: "pre-authorized-at-launch" }), approvedIds: integer({ min: 0 }) },
  "spec.blocked": { reason: string({ values: ["lint_cap", "critic_cap", "analyst_blocked"] }), detail: string() },
  "design.tech.ready": { path: string() },
  "design.verification.ready": { path: string() },
  "design.tasks.ready": { path: string(), taskCount: integer({ min: 1 }) },
  "design.rework": { target: string({ values: ["planner", "architect"] }), reason: string(), attempt: integer({ min: 1 }), originTaskId: stringOrNull({ pattern: TASK_ID }) },
  "design.blocked": { reason: string() },
  "task.ready": { taskId: string({ pattern: TASK_ID }), worktree: string(), baseSha: string({ pattern: SHA }), covers: strings(), writes: strings() },
  "task.tests_written": { taskId: string({ pattern: TASK_ID }), ...costFields },
  "task.tests_red": { taskId: string({ pattern: TASK_ID }), testsSha: string({ pattern: SHA }), testFiles: strings() },
  "task.tests_rejected": { taskId: string({ pattern: TASK_ID }), reason: string({ values: TESTS_REJECTED_REASONS }), detail: string() },
  "task.impl_done": { taskId: string({ pattern: TASK_ID }), ...costFields },
  "task.verified": { taskId: string({ pattern: TASK_ID }), result: string({ values: ["green", "red"] }), evidencePath: string(), testsUnchanged: boolean(), writeSetOk: boolean() },
  "task.finding": { taskId: string({ pattern: TASK_ID }), type: string({ values: FINDING_TYPES }), specIds: strings(), detail: string() },
  "task.reviewed": { taskId: string({ pattern: TASK_ID }), decision: string({ values: REVIEW_DECISIONS }), target: string({ values: REVIEW_TARGETS }), reportPath: string() },
  "task.rework": { taskId: string({ pattern: TASK_ID }), target: string({ values: REWORK_TARGETS }), attempt: integer({ min: 1 }), reason: string(), findingPath: stringOrNull() },
  "task.approved": { taskId: string({ pattern: TASK_ID }), implSha: string({ pattern: SHA }) },
  "task.failed": { taskId: string({ pattern: TASK_ID }), reason: string({ values: TASK_FAILED_REASONS }), detail: string() },
  "assembly.started": { taskOrder: strings() },
  "assembly.verified": { result: string({ values: ["green", "red"] }), step: string({ values: ASSEMBLY_STEPS }), evidencePath: string(), failingCovers: strings() },
  "assembly.triaged": { taskId: stringOrNull(), target: string({ values: ASSEMBLY_TARGETS }), reason: string() },
  "assembly.rework": { round: integer({ min: 1 }), taskId: string({ pattern: TASK_ID }), target: string({ values: ASSEMBLY_TARGETS }) },
  "fix.attempted": {
    stage: string({ values: FIX_STAGES }),
    taskId: stringOrNull({ pattern: TASK_ID }),
    unit: string(),
    owner: string({ values: FIX_OWNERS }),
    trigger: string({ values: FIX_TRIGGERS }),
    attempt: integer({ min: 1 }),
    outcome: string({ values: FIX_OUTCOMES }),
    filesChanged: strings(),
    answerPath: string(),
    costUsd: numberOrNull(),
    inputTokens: integer({ min: 0 }),
    outputTokens: integer({ min: 0 }),
    durationMs: integer({ min: 0 }),
  },
} as const satisfies Record<string, Record<string, FieldSpec>>;

export type EventType = keyof typeof EVENT_CATALOGUE;

export const EVENT_TYPES = Object.keys(EVENT_CATALOGUE) as readonly EventType[];

export const TERMINAL_EVENT_TYPES: readonly EventType[] = ["run.published", "run.failed"];

export function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && Object.hasOwn(EVENT_CATALOGUE, value);
}

function describeKindFailure(kind: FieldKind, value: unknown): string | null {
  switch (kind) {
    case "string":
      return typeof value === "string" ? null : "expected string";
    case "integer":
      return Number.isInteger(value) ? null : "expected integer";
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : "expected number";
    case "boolean":
      return typeof value === "boolean" ? null : "expected boolean";
    case "string[]":
      return Array.isArray(value) && value.every((item) => typeof item === "string") ? null : "expected string[]";
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value) ? null : "expected object";
    case "number|null":
      return value === null || (typeof value === "number" && Number.isFinite(value)) ? null : "expected number or null";
    case "string|null":
      return value === null || typeof value === "string" ? null : "expected string or null";
  }
}

function validateField(field: string, spec: FieldSpec, value: unknown): void {
  const kindFailure = describeKindFailure(spec.kind, value);
  if (kindFailure !== null) {
    throw new BusError("envelope_invalid", field, kindFailure);
  }
  if (spec.values !== undefined && (typeof value !== "string" || !spec.values.includes(value))) {
    throw new BusError("envelope_invalid", field, `expected one of ${spec.values.join(" | ")}`);
  }
  if (spec.literal !== undefined && String(value) !== spec.literal) {
    throw new BusError("envelope_invalid", field, `expected literal ${spec.literal}`);
  }
  if (spec.pattern !== undefined && typeof value === "string" && !spec.pattern.test(value)) {
    throw new BusError("envelope_invalid", field, `expected to match ${spec.pattern.source}`);
  }
  if (spec.min !== undefined && typeof value === "number" && value < spec.min) {
    throw new BusError("envelope_invalid", field, `expected >= ${spec.min}`);
  }
}

export function validatePayload(type: EventType, payload: EventPayload): void {
  const fields: Record<string, FieldSpec> = EVENT_CATALOGUE[type];
  for (const [field, spec] of Object.entries(fields)) {
    if (!Object.hasOwn(payload, field)) {
      throw new BusError("envelope_invalid", `payload.${field}`, "missing required field");
    }
    validateField(`payload.${field}`, spec, payload[field]);
  }
}

export function validateEvent(event: FactoryEvent): asserts event is FactoryEvent<EventType> {
  if (!isEventType(event.type)) {
    throw new BusError("unknown_event_type", "type", String(event.type));
  }
  if (typeof event.runId !== "string" || !RUN_ID_PATTERN.test(event.runId)) {
    throw new BusError("envelope_invalid", "runId", `expected to match ${RUN_ID_PATTERN.source}`);
  }
  if (typeof event.occurredAt !== "string" || Number.isNaN(Date.parse(event.occurredAt))) {
    throw new BusError("envelope_invalid", "occurredAt", "expected ISO-8601 timestamp");
  }
  if (!isProducer(event.producer)) {
    throw new BusError("envelope_invalid", "producer", `expected one of the participant names`);
  }
  if (typeof event.payload !== "object" || event.payload === null || Array.isArray(event.payload)) {
    throw new BusError("envelope_invalid", "payload", "expected object");
  }
  validatePayload(event.type, event.payload);
}
