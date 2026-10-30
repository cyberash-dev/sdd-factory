import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EventType } from "../../bus/domain/catalogue.js";
import type { DeliveredEvent, Producer } from "../../bus/domain/envelope.js";
import { createRunState } from "../../bus/domain/run-state.js";
import type { TransitionRule } from "../../bus/domain/transition.js";
import { planReplay, readResumeSource, ResumeError } from "./resume.js";

const RULES: readonly TransitionRule[] = [
  { name: "started", eventType: "run.started", apply: ({ state }) => ({ state: { ...state, status: "workspace" }, emits: [], effects: [{ kind: "factory.bootstrap" }] }) },
  { name: "intervention", eventType: "human.intervention", apply: ({ state }) => ({ state, emits: [], effects: [] }) },
  { name: "workspace", eventType: "workspace.ready", apply: ({ state }) => ({ state: { ...state, status: "spec_drafting" }, emits: [], effects: [{ kind: "spec.draft" }] }) },
  { name: "drafted", eventType: "spec.drafted", apply: ({ state }) => ({ state: { ...state, status: "spec_review" }, emits: [], effects: [{ kind: "spec.review" }] }) },
  { name: "failed", eventType: "run.failed", apply: ({ state }) => ({ state: { ...state, status: "failed" }, emits: [], effects: [{ kind: "factory.finalize" }] }) },
];

function delivered(seq: number, type: EventType, producer: Producer, payload: Record<string, unknown> = {}): DeliveredEvent<EventType> {
  return { type, runId: "todo-cli-20261030-160028", occurredAt: `2026-10-30T16:0${seq}:00.000Z`, producer, seq, payload };
}

function initial(): ReturnType<typeof createRunState> {
  return createRunState({ runId: "todo-cli-20261030-160028", slug: "todo-cli", operator: "cyberash", startedAt: "2026-10-30T16:00:00.000Z" });
}

async function runDirWith(manifest: Record<string, unknown>, traceLines: readonly string[] | null): Promise<{ repoRoot: string; runId: string }> {
  const repoRoot = await mkdtemp(join(tmpdir(), "resume-"));
  const runId = "todo-cli-20261030-160028";
  const runDir = join(repoRoot, ".factory", "runs", runId);
  await mkdir(join(runDir, "trace"), { recursive: true });
  await writeFile(join(runDir, "run.json"), JSON.stringify({ runId, slug: "todo-cli", specPath: "specs/todo-cli.md", operator: "cyberash", startedAt: "2026-10-30T16:00:00.000Z", ...manifest }));
  if (traceLines !== null) {
    await writeFile(join(runDir, "trace", "trace.jsonl"), `${traceLines.join("\n")}\n`);
  }
  return { repoRoot, runId };
}

describe("resume replay plan", () => {
  // @covers factory:BEH-009
  it("seeds the state before the last effectful event and names that event as the redo", () => {
    const events = [delivered(1, "run.started", "foreman"), delivered(2, "human.intervention", "foreman", { kind: "launch" }), delivered(3, "workspace.ready", "foreman"), delivered(4, "spec.drafted", "spec-analyst"), delivered(5, "run.failed", "foreman")];

    const plan = planReplay(RULES, initial(), events);

    expect([plan.state.status, plan.redo.type, plan.redo.seq, plan.redo.producer]).toEqual(["spec_drafting", "spec.drafted", 4, "spec-analyst"]);
  });

  // @covers factory:BEH-009
  it("stops replaying at the terminal event so a later event after run.failed is never the redo", () => {
    const events = [delivered(1, "run.started", "foreman"), delivered(2, "workspace.ready", "foreman"), delivered(3, "run.failed", "foreman"), delivered(4, "spec.drafted", "spec-analyst")];

    const plan = planReplay(RULES, initial(), events);

    expect([plan.state.status, plan.redo.type]).toEqual(["workspace", "workspace.ready"]);
  });

  // @covers factory:BEH-009
  it("rejects a trace in which no event produced an effect", () => {
    const events = [delivered(1, "human.intervention", "foreman", { kind: "launch" }), delivered(2, "run.failed", "foreman")];

    expect(() => planReplay(RULES, initial(), events)).toThrow(new ResumeError("nothing to resume: no replayed event produced an effect"));
  });
});

describe("resume source", () => {
  // @covers factory:BEH-009
  it("reads the failed run's manifest and its bus events, skipping runtime records", async () => {
    const { repoRoot, runId } = await runDirWith({ status: "failed" }, [
      JSON.stringify({ type: "run.started", runId: "todo-cli-20261030-160028", occurredAt: "2026-10-30T16:00:01.000Z", producer: "foreman", seq: 1, payload: { slug: "todo-cli" } }),
      JSON.stringify({ type: "inference.started", runId: "todo-cli-20261030-160028", occurredAt: "2026-10-30T16:00:02.000Z", producer: "runtime", seq: 2, payload: {} }),
      JSON.stringify({ type: "workspace.ready", runId: "todo-cli-20261030-160028", occurredAt: "2026-10-30T16:00:03.000Z", producer: "foreman", seq: 3, payload: {} }),
    ]);

    const source = await readResumeSource(repoRoot, runId, false);

    expect([source.manifest.specPath, source.events.map((event) => [event.type, event.seq])]).toEqual(["specs/todo-cli.md", [["run.started", 1], ["workspace.ready", 3]]]);
  });

  // @covers factory:BEH-009
  it("refuses a run still marked running unless --force vouches that its process is gone", async () => {
    const { repoRoot, runId } = await runDirWith({ status: "running" }, []);

    await expect(readResumeSource(repoRoot, runId, false)).rejects.toThrow(new ResumeError(`run ${runId} is still marked running; pass --force when its process is gone`));
    await expect(readResumeSource(repoRoot, runId, true)).resolves.toMatchObject({ events: [] });
  });

  // @covers factory:BEH-009
  it.each([
    ["published", "is published; nothing to resume"],
    ["failed", "has no trace/trace.jsonl under"],
  ])("rejects a %s run as %s", async (status, fragment) => {
    const { repoRoot, runId } = await runDirWith({ status }, status === "failed" ? null : []);

    await expect(readResumeSource(repoRoot, runId, false)).rejects.toThrow(fragment);
  });

  // @covers factory:BEH-009
  it("rejects a run id that has no run directory", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "resume-"));

    await expect(readResumeSource(repoRoot, "todo-cli-20261030-000000", false)).rejects.toThrow("has no run.json under");
  });
});
