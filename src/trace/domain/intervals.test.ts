import { describe, expect, it } from "vitest";
import { activeIntervals, overlaps } from "./intervals.js";
import type { TraceRecord } from "./trace-record.js";

const RUN_ID = "todo-cli-20261029-120000";
const SHA = "0123456789abcdef0123456789abcdef01234567";

function record(seq: number, type: TraceRecord["type"], occurredAt: string, producer: string, payload: Record<string, unknown>): TraceRecord {
  return { seq, elapsedMs: 0, type, runId: RUN_ID, occurredAt, producer, payload };
}

function inferenceStarted(seq: number, occurredAt: string, participant: string): TraceRecord {
  return record(seq, "inference.started", occurredAt, "runtime", { participant, model: "m" });
}

describe("activeIntervals", () => {
  it("spans a participant from its first inference.started to the bus event it produces", () => {
    const records = [
      inferenceStarted(1, "2026-10-29T12:02:00.000Z", "architect"),
      inferenceStarted(2, "2026-10-29T12:02:01.000Z", "verification-designer"),
      inferenceStarted(3, "2026-10-29T12:03:00.000Z", "architect"),
      record(4, "design.verification.ready", "2026-10-29T12:04:00.000Z", "verification-designer", { path: "design/verification.md" }),
      record(5, "design.tech.ready", "2026-10-29T12:05:00.000Z", "architect", { path: "design/tech.md" }),
    ];

    expect(activeIntervals(records)).toEqual([
      { kind: "participant", id: "architect", startedAt: "2026-10-29T12:02:00.000Z", endedAt: "2026-10-29T12:05:00.000Z" },
      { kind: "participant", id: "verification-designer", startedAt: "2026-10-29T12:02:01.000Z", endedAt: "2026-10-29T12:04:00.000Z" },
    ]);
  });

  it("spans a task lane from task.ready to task.approved or task.failed and leaves an unfinished lane open", () => {
    const records = [
      record(1, "task.ready", "2026-10-29T12:07:00.000Z", "foreman", { taskId: "T-001", worktree: "/wt/T-001", baseSha: SHA, covers: [], writes: [] }),
      record(2, "task.ready", "2026-10-29T12:07:01.000Z", "foreman", { taskId: "T-002", worktree: "/wt/T-002", baseSha: SHA, covers: [], writes: [] }),
      record(3, "task.ready", "2026-10-29T12:07:02.000Z", "foreman", { taskId: "T-003", worktree: "/wt/T-003", baseSha: SHA, covers: [], writes: [] }),
      record(4, "task.failed", "2026-10-29T12:08:00.000Z", "foreman", { taskId: "T-002", reason: "cap_exhausted", detail: "x" }),
      record(5, "task.approved", "2026-10-29T12:09:00.000Z", "foreman", { taskId: "T-001", implSha: SHA }),
    ];

    expect(activeIntervals(records)).toEqual([
      { kind: "task", id: "T-001", startedAt: "2026-10-29T12:07:00.000Z", endedAt: "2026-10-29T12:09:00.000Z" },
      { kind: "task", id: "T-002", startedAt: "2026-10-29T12:07:01.000Z", endedAt: "2026-10-29T12:08:00.000Z" },
      { kind: "task", id: "T-003", startedAt: "2026-10-29T12:07:02.000Z", endedAt: null },
    ]);
  });

  it("keeps the first task.ready as the start when a lane restarts", () => {
    const records = [
      record(1, "task.ready", "2026-10-29T12:07:00.000Z", "foreman", { taskId: "T-001", worktree: "/wt/T-001", baseSha: SHA, covers: [], writes: [] }),
      record(2, "task.ready", "2026-10-29T12:08:00.000Z", "foreman", { taskId: "T-001", worktree: "/wt/T-001", baseSha: SHA, covers: [], writes: [] }),
      record(3, "task.approved", "2026-10-29T12:09:00.000Z", "foreman", { taskId: "T-001", implSha: SHA }),
    ];

    expect(activeIntervals(records).map((interval) => interval.startedAt)).toEqual(["2026-10-29T12:07:00.000Z"]);
  });
});

describe("overlaps", () => {
  it.each([
    ["2026-10-29T12:00:00.000Z", "2026-10-29T12:05:00.000Z", "2026-10-29T12:04:59.000Z", "2026-10-29T12:06:00.000Z", true],
    ["2026-10-29T12:00:00.000Z", "2026-10-29T12:05:00.000Z", "2026-10-29T12:05:00.000Z", "2026-10-29T12:06:00.000Z", false],
    ["2026-10-29T12:00:00.000Z", null, "2026-10-29T12:05:00.000Z", "2026-10-29T12:06:00.000Z", true],
    ["2026-10-29T12:06:00.000Z", "2026-10-29T12:07:00.000Z", "2026-10-29T12:00:00.000Z", "2026-10-29T12:05:00.000Z", false],
  ])("decides whether [%s, %s] and [%s, %s] overlap: %s", (aStart, aEnd, bStart, bEnd, expected) => {
    const left = { kind: "task" as const, id: "a", startedAt: aStart, endedAt: aEnd };
    const right = { kind: "task" as const, id: "b", startedAt: bStart, endedAt: bEnd };

    expect([overlaps(left, right), overlaps(right, left)]).toEqual([expected, expected]);
  });
});
