import { describe, expect, it } from "vitest";
import { createRunManifest, exitCodeOf } from "./run-manifest.js";

describe("run manifest", () => {
  // @covers factory:CTR-003
  // @covers factory:DLT-004
  it("starts running at the workspace stage with empty counters", () => {
    const manifest = createRunManifest({ runId: "todo-cli-20261029-120000", slug: "todo-cli", specPath: "specs/todo.md", operator: "cyberash", startedAt: "2026-10-29T12:00:00.000Z" });

    expect(manifest).toEqual({
      schemaVersion: 1,
      runId: "todo-cli-20261029-120000",
      slug: "todo-cli",
      specPath: "specs/todo.md",
      operator: "cyberash",
      mode: "autonomous",
      status: "running",
      stage: "workspace",
      startedAt: "2026-10-29T12:00:00.000Z",
      endedAt: null,
      reason: null,
      commitSha: null,
      outputDir: null,
      pushed: null,
      counters: { tasks: 0, tasksApproved: 0, tasksFailed: 0, reworks: 0 },
      resumedFrom: null,
    });
  });

  // @covers factory:INV-002
  it.each([
    ["published", 0],
    ["failed", 1],
    ["running", 1],
  ] as const)("maps manifest status %s to exit code %i", (status, code) => {
    expect(exitCodeOf(status)).toBe(code);
  });
});
