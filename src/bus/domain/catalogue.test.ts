import { describe, expect, it } from "vitest";
import { EVENT_CATALOGUE, EVENT_TYPES, validateEvent, type EventType } from "./catalogue.js";
import { BusError, type EventPayload, type FactoryEvent } from "./envelope.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";

const COST = { attempt: 1, handoffPath: "handoffs/tasks/T-001/implementer-1/handoff.md", costUsd: 0.12, inputTokens: 10, outputTokens: 5, durationMs: 100 };

const VALID_PAYLOADS: Readonly<Record<EventType, EventPayload>> = {
  "run.started": { specPath: "spec.md", slug: "todo-cli", operator: "cyberash", mode: "autonomous" },
  "workspace.ready": { productDir: "/tmp/run/product", slug: "todo-cli", baselineId: "todo-cli:BL-001" },
  "run.failed": { stage: "build", reason: "cap_exhausted", detail: "T-001 implementer attempts" },
  "run.published": { commitSha: SHA, outputDir: "hidden/todo-cli/", pushed: true },
  "human.intervention": { kind: "launch", note: "pre-authorized", actor: "cyberash" },
  "spec.drafted": { attempt: 1, lintExit: 0, recordCounts: { behaviors: 3 } },
  "spec.reviewed": { round: 1, decision: "rework", findingsPath: "spec/review/ga.md" },
  "spec.rework": { round: 1, findingsPath: "spec/review/ga.md" },
  "spec.approved": { approver: "cyberash", mode: "pre-authorized-at-launch", approvedIds: 12 },
  "spec.blocked": { reason: "lint_cap", detail: "5 cycles" },
  "design.tech.ready": { path: "design/tech.md" },
  "design.verification.ready": { path: "design/verification.md" },
  "design.tasks.ready": { path: "design/tasks.json", taskCount: 3 },
  "design.rework": { target: "planner", reason: "overlapping writes", attempt: 1, originTaskId: "T-001" },
  "design.blocked": { reason: "planner_cap" },
  "task.ready": { taskId: "T-001", worktree: "/tmp/run/worktrees/T-001", baseSha: SHA, covers: ["todo-cli:BEH-001"], writes: ["src/cli/**", "tests/cli/**"] },
  "task.tests_written": { taskId: "T-001", ...COST },
  "task.tests_red": { taskId: "T-001", testsSha: SHA, testFiles: ["tests/cli/add.test.ts"] },
  "task.tests_rejected": { taskId: "T-001", reason: "vacuous", detail: "add.test.ts passes at base" },
  "task.impl_done": { taskId: "T-001", ...COST },
  "task.verified": { taskId: "T-001", result: "green", evidencePath: "verifier-green-1.json", testsUnchanged: true, writeSetOk: true },
  "task.finding": { taskId: "T-001", type: "TASK-OVERFLOW", specIds: ["todo-cli:BEH-001"], detail: "missing_dependency: yargs" },
  "task.reviewed": { taskId: "T-001", decision: "approve", target: "none", reportPath: "reviews/T-001.md" },
  "task.rework": { taskId: "T-001", target: "implementer", attempt: 2, reason: "red", findingPath: null },
  "task.approved": { taskId: "T-001", implSha: SHA },
  "task.failed": { taskId: "T-001", reason: "cap_exhausted", detail: "3 implementer attempts" },
  "assembly.started": { taskOrder: ["T-001", "T-002"] },
  "assembly.verified": { result: "green", step: "sdd_ready", evidencePath: "assembly/report.md", failingCovers: [] },
  "assembly.triaged": { taskId: null, target: "planner", reason: "config_invalid" },
  "assembly.rework": { round: 1, taskId: "T-001", target: "implementer" },
  "fix.attempted": {
    stage: "build",
    taskId: "T-001",
    unit: "T-001",
    owner: "test-writer",
    trigger: "red_suite_error",
    attempt: 1,
    outcome: "fixed",
    filesChanged: ["src/greet.ts"],
    answerPath: "handoffs/T-001/simple-fixer/answer-run1.md",
    costUsd: 0.04,
    inputTokens: 900,
    outputTokens: 80,
    durationMs: 4000,
  },
};

function eventOf(type: string, payload: EventPayload, overrides: Partial<FactoryEvent> = {}): FactoryEvent {
  return { type, runId: "todo-cli-20261029-120000", occurredAt: "2026-10-29T12:00:00.000Z", producer: "foreman", payload, ...overrides };
}

function codeOf(action: () => void): string {
  try {
    action();
  } catch (error) {
    if (error instanceof BusError) {
      return error.field === null ? error.code : `${error.code}:${error.field}`;
    }
    throw error;
  }
  return "no error";
}

describe("event catalogue validation", () => {
  // @covers bus:CTR-002
  // @covers bus:CTR-003
  // @covers bus:CTR-004
  // @covers bus:CTR-005
  // @covers bus:CTR-006
  it.each(EVENT_TYPES)("accepts a complete %s payload", (type) => {
    const event = eventOf(type, VALID_PAYLOADS[type]);

    expect(codeOf(() => validateEvent(event))).toBe("no error");
  });

  // @covers bus:BEH-005
  it.each(
    EVENT_TYPES.flatMap((type) => Object.keys(EVENT_CATALOGUE[type]).map((field) => [type, field] as const)),
  )("rejects %s without %s naming the field", (type, field) => {
    const { [field]: _removed, ...payload } = VALID_PAYLOADS[type];

    expect(codeOf(() => validateEvent(eventOf(type, payload)))).toBe(`envelope_invalid:payload.${field}`);
  });

  // @covers bus:DLT-004
  // @covers bus:CTR-002
  it("accepts run.failed with the terminated reason carrying the signal name", () => {
    const event = eventOf("run.failed", { stage: "spec", reason: "terminated", detail: "SIGTERM" });

    expect(codeOf(() => validateEvent(event))).toBe("no error");
  });

  // @covers bus:DLT-006
  // @covers bus:CTR-004
  it("accepts a design-stage design.rework with a null originTaskId", () => {
    const event = eventOf("design.rework", { ...VALID_PAYLOADS["design.rework"], originTaskId: null });

    expect(codeOf(() => validateEvent(event))).toBe("no error");
  });

  // @covers bus:DLT-006
  it("rejects design.rework with an originTaskId outside the task id grammar", () => {
    const event = eventOf("design.rework", { ...VALID_PAYLOADS["design.rework"], originTaskId: "task-1" });

    expect(codeOf(() => validateEvent(event))).toBe("envelope_invalid:payload.originTaskId");
  });

  // @covers bus:DLT-007
  // @covers bus:CTR-002
  it("accepts run.failed with the stalled reason", () => {
    const event = eventOf("run.failed", { stage: "build", reason: "stalled", detail: "T-003 review_pending last=task.rework" });

    expect(codeOf(() => validateEvent(event))).toBe("no error");
  });

  it("rejects an unknown event type before looking at the payload", () => {
    const event = eventOf("task.exploded", { taskId: "T-001" });

    expect(codeOf(() => validateEvent(event))).toBe("unknown_event_type:type");
  });

  it.each([
    ["spec.reviewed", { ...VALID_PAYLOADS["spec.reviewed"], decision: "maybe" }, "payload.decision"],
    ["run.failed", { ...VALID_PAYLOADS["run.failed"], reason: "toolchain_install_failed" }, "payload.reason"],
    ["run.failed", { ...VALID_PAYLOADS["run.failed"], reason: "stopped" }, "payload.reason"],
    ["run.failed", { ...VALID_PAYLOADS["run.failed"], stage: "bootstrap" }, "payload.stage"],
    ["task.finding", { ...VALID_PAYLOADS["task.finding"], type: "BUG" }, "payload.type"],
    ["assembly.verified", { ...VALID_PAYLOADS["assembly.verified"], step: "lint" }, "payload.step"],
    ["task.rework", { ...VALID_PAYLOADS["task.rework"], target: "foreman" }, "payload.target"],
    ["human.intervention", { ...VALID_PAYLOADS["human.intervention"], kind: "shout" }, "payload.kind"],
  ] as const)("rejects %s with an enum value outside its set", (type, payload, field) => {
    expect(codeOf(() => validateEvent(eventOf(type, payload)))).toBe(`envelope_invalid:${field}`);
  });

  // @covers bus:CTR-009
  it("accepts fix.attempted from the simple-fixer for a spec unit with a null taskId and a null cost", () => {
    const payload = { ...VALID_PAYLOADS["fix.attempted"], stage: "spec", taskId: null, unit: "spec", owner: "spec-analyst", trigger: "spec_yaml_invalid", costUsd: null };

    expect(codeOf(() => validateEvent(eventOf("fix.attempted", payload, { producer: "simple-fixer" })))).toBe("no error");
  });

  // @covers bus:CTR-009
  it.each([
    [{ ...VALID_PAYLOADS["fix.attempted"], trigger: "green_assertion_failed" }, "payload.trigger"],
    [{ ...VALID_PAYLOADS["fix.attempted"], outcome: "partial" }, "payload.outcome"],
    [{ ...VALID_PAYLOADS["fix.attempted"], owner: "reviewer" }, "payload.owner"],
    [{ ...VALID_PAYLOADS["fix.attempted"], stage: "publish" }, "payload.stage"],
    [{ ...VALID_PAYLOADS["fix.attempted"], attempt: 0 }, "payload.attempt"],
    [{ ...VALID_PAYLOADS["fix.attempted"], taskId: "task-1" }, "payload.taskId"],
  ] as const)("rejects fix.attempted with %o naming %s", (payload, field) => {
    expect(codeOf(() => validateEvent(eventOf("fix.attempted", payload, { producer: "simple-fixer" })))).toBe(`envelope_invalid:${field}`);
  });

  it("rejects spec.drafted with a non-zero lintExit", () => {
    const payload = { ...VALID_PAYLOADS["spec.drafted"], lintExit: 1 };

    expect(codeOf(() => validateEvent(eventOf("spec.drafted", payload)))).toBe("envelope_invalid:payload.lintExit");
  });

  it("rejects design.tasks.ready with taskCount 0", () => {
    const payload = { ...VALID_PAYLOADS["design.tasks.ready"], taskCount: 0 };

    expect(codeOf(() => validateEvent(eventOf("design.tasks.ready", payload)))).toBe("envelope_invalid:payload.taskCount");
  });

  it("rejects run.started with a slug outside the partition grammar", () => {
    const payload = { ...VALID_PAYLOADS["run.started"], slug: "Todo_CLI" };

    expect(codeOf(() => validateEvent(eventOf("run.started", payload)))).toBe("envelope_invalid:payload.slug");
  });
});

describe("event envelope", () => {
  // @covers bus:CTR-001
  it("rejects a runId outside the run id grammar", () => {
    const event = eventOf("run.started", VALID_PAYLOADS["run.started"], { runId: "todo-cli" });

    expect(codeOf(() => validateEvent(event))).toBe("envelope_invalid:runId");
  });

  it("rejects a producer outside the participant names", () => {
    const event = { ...eventOf("run.started", VALID_PAYLOADS["run.started"]), producer: "operator" };

    expect(codeOf(() => validateEvent(event as unknown as FactoryEvent))).toBe("envelope_invalid:producer");
  });

  it("rejects an occurredAt that is not a timestamp", () => {
    const event = eventOf("run.started", VALID_PAYLOADS["run.started"], { occurredAt: "yesterday" });

    expect(codeOf(() => validateEvent(event))).toBe("envelope_invalid:occurredAt");
  });

  it("preserves unknown extra payload fields", () => {
    const event = eventOf("design.blocked", { reason: "planner_cap", extra: "kept" });

    validateEvent(event);

    expect(event.payload["extra"]).toBe("kept");
  });
});
