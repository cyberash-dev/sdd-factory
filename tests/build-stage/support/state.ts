import type { EventType } from "../../../src/bus/domain/catalogue.js";
import type { DeliveredEvent, EventPayload } from "../../../src/bus/domain/envelope.js";
import { createRunState, type RunState, type TaskState } from "../../../src/bus/domain/run-state.js";

export const RUN_ID = "greeter-20261029-120000";
export const BASE_SHA = "1111111111111111111111111111111111111111";
export const TESTS_SHA = "2222222222222222222222222222222222222222";
export const IMPL_SHA = "3333333333333333333333333333333333333333";

export function aTask(overrides: Partial<TaskState> = {}): TaskState {
  return {
    status: "ready",
    attempts: { implementer: 0, testWriter: 0 },
    handoffReruns: {},
    baseSha: null,
    testsSha: null,
    implSha: null,
    worktree: "/run/worktrees/T-001",
    covers: ["greeter:BEH-001"],
    writes: ["src/greet.ts", "tests/greet.test.ts"],
    dependsOn: [],
    lastEvent: "design.tasks.ready",
    ...overrides,
  };
}

export function buildingState(tasks: Readonly<Record<string, TaskState>>, overrides: Partial<RunState> = {}): RunState {
  const base = createRunState({ runId: RUN_ID, slug: "greeter", operator: "cyberash", startedAt: "2026-10-29T12:00:00.000Z" });
  return { ...base, status: "building", tasks, ...overrides };
}

export function delivered(type: EventType, payload: EventPayload, seq = 1): DeliveredEvent<EventType> {
  return { type, runId: RUN_ID, occurredAt: "2026-10-29T12:00:01.000Z", producer: "foreman", payload, seq };
}
