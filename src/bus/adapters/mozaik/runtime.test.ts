import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { DeliveredEvent } from "../../domain/envelope.js";
import { fixerLaneUnit } from "./roster.js";
import { createFactoryRuntime, createReactor, createRuntimeObserver } from "./runtime.js";

const RUN_ID = "todo-cli-20261029-120000";

const FIX_ATTEMPTED = {
  stage: "design",
  taskId: null,
  unit: "design",
  owner: "architect",
  trigger: "design_file_invalid",
  attempt: 1,
  outcome: "fixed",
  filesChanged: ["design/tech.md"],
  answerPath: "handoffs/design/simple-fixer/answer-run1.md",
  costUsd: 0.01,
  inputTokens: 10,
  outputTokens: 5,
  durationMs: 100,
};

function codeOf(action: () => void): string {
  try {
    action();
  } catch (error) {
    return error instanceof Error ? error.message.split(":")[0] ?? error.message : String(error);
  }
  return "no error";
}

describe("Mozaik runtime adapter", () => {
  // @covers bus:BEH-001
  // @covers bus:EXT-001
  it("delivers a published event exactly once to the handler registered for its type", () => {
    const runtime = createFactoryRuntime(RUN_ID);
    const seen: string[] = [];
    runtime.join(createReactor("tracer", { "design.blocked": (event) => seen.push(`tracer ${event.type}`), "design.rework": (event) => seen.push(`tracer ${event.type}`) }));
    runtime.join(createReactor("foreman", { "design.blocked": (event) => seen.push(`foreman ${event.type}`) }));

    runtime.publisher.publish({ type: "design.blocked", producer: "planner", payload: { reason: "planner_cap" } });

    expect(seen.sort()).toEqual(["foreman design.blocked", "tracer design.blocked"]);
  });

  it("runs both handlers of one participant when both match the event", () => {
    const runtime = createFactoryRuntime(RUN_ID);
    const seen: string[] = [];
    const reactor = createReactor("tracer", { "design.blocked": () => seen.push("first") });
    reactor.setHandlers([...reactor.getHandlers(), ...createReactor("tracer", { "design.blocked": () => seen.push("second") }).getHandlers()]);
    runtime.join(reactor);

    runtime.publisher.publish({ type: "design.blocked", producer: "planner", payload: { reason: "planner_cap" } });

    expect(seen).toEqual(["first", "second"]);
  });

  it("invokes no handler while no event is published", async () => {
    const runtime = createFactoryRuntime(RUN_ID);
    const seen: string[] = [];
    runtime.join(createReactor("foreman", { "design.blocked": () => seen.push("x") }));

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(seen).toEqual([]);
  });

  // @covers bus:BEH-007
  it("sends each event from the joined participant named by its producer", () => {
    const runtime = createFactoryRuntime(RUN_ID);
    const senders: string[] = [];
    runtime.join(createRuntimeObserver("probe", (event) => (event.type === "design.blocked" ? senders.push(event.producerId) : undefined)));

    runtime.publisher.publish({ type: "design.blocked", producer: "planner", payload: { reason: "planner_cap" } });

    const planner = runtime.state.getParticipants().find((participant) => participant.getManifest().name === "planner");
    expect([senders, planner?.getManifest().role]).toEqual([[planner?.getId()], "agent"]);
  });

  it("lists one participant per non-lane producer plus one per running lane", () => {
    const runtime = createFactoryRuntime(RUN_ID);

    runtime.joinLane("test-writer", "T-002");

    expect(runtime.state.getParticipants().map((participant) => participant.getManifest().name).sort()).toEqual([
      "architect",
      "assembler",
      "foreman",
      "planner",
      "reviewer",
      "spec-analyst",
      "spec-critic",
      "test-writer",
      "tracer",
      "triage",
      "verification-designer",
    ]);
  });

  it("sends lane events from the per-task lane participant and rejects the producer once the lane left", () => {
    const runtime = createFactoryRuntime(RUN_ID);
    const senders: string[] = [];
    runtime.join(createRuntimeObserver("probe", (event) => (event.type === "task.failed" ? senders.push(event.producerId) : undefined)));
    const lane = runtime.joinLane("implementer", "T-001");
    const payload = { taskId: "T-001", reason: "blocked", detail: "implementer: no entry point" };

    runtime.publisher.publish({ type: "task.failed", producer: "implementer", payload });
    const capabilities = runtime.state.getParticipant(lane.id)?.getManifest().capabilities;
    runtime.leaveLane(lane);
    const code = codeOf(() => runtime.publisher.publish({ type: "task.failed", producer: "implementer", payload }));

    expect([senders, capabilities, runtime.state.getParticipant(lane.id), code]).toEqual([[lane.id], ["lane", "task:T-001"], undefined, "producer_not_joined"]);
  });

  // @covers bus:DLT-005
  // @covers bus:BEH-007
  it("sends fix.attempted from the simple-fixer participant joined for its unit with capabilities lane and unit", () => {
    const runtime = createFactoryRuntime(RUN_ID);
    const senders: string[] = [];
    runtime.join(createRuntimeObserver("probe", (event) => (event.type === "fix.attempted" ? senders.push(event.producerId) : undefined)));
    const fixer = runtime.joinLane("simple-fixer", fixerLaneUnit("architect", "design"));

    runtime.publisher.publish({ type: "fix.attempted", producer: "simple-fixer", payload: FIX_ATTEMPTED });

    expect([senders, runtime.state.getParticipant(fixer.id)?.getManifest().capabilities]).toEqual([[fixer.id], ["lane", "unit:design"]]);
  });

  // @covers bus:DLT-005
  it("rejects fix.attempted with producer_not_joined after the fixer participant of its unit left", () => {
    const runtime = createFactoryRuntime(RUN_ID);
    const senders: string[] = [];
    runtime.join(createRuntimeObserver("probe", (event) => (event.type === "fix.attempted" ? senders.push(event.producerId) : undefined)));
    const fixer = runtime.joinLane("simple-fixer", fixerLaneUnit("architect", "design"));
    runtime.leaveLane(fixer);

    const code = codeOf(() => runtime.publisher.publish({ type: "fix.attempted", producer: "simple-fixer", payload: FIX_ATTEMPTED }));

    expect([code, senders, runtime.state.getParticipant(fixer.id)]).toEqual(["producer_not_joined", [], undefined]);
  });

  it("rejects fix.attempted when only a fixer for another unit is joined", () => {
    const runtime = createFactoryRuntime(RUN_ID);
    runtime.joinLane("simple-fixer", fixerLaneUnit("architect", "spec"));

    const code = codeOf(() => runtime.publisher.publish({ type: "fix.attempted", producer: "simple-fixer", payload: FIX_ATTEMPTED }));

    expect(code).toBe("producer_not_joined");
  });

  // @covers bus:DLT-006
  // @covers bus:BEH-007
  it("sends fix.attempted of two owners on one unit from each owner's own fixer participant", () => {
    const runtime = createFactoryRuntime(RUN_ID);
    const senders: string[] = [];
    runtime.join(createRuntimeObserver("probe", (event) => (event.type === "fix.attempted" ? senders.push(event.producerId) : undefined)));
    const architectFixer = runtime.joinLane("simple-fixer", fixerLaneUnit("architect", "design"));
    const designerFixer = runtime.joinLane("simple-fixer", fixerLaneUnit("verification-designer", "design"));

    runtime.publisher.publish({ type: "fix.attempted", producer: "simple-fixer", payload: FIX_ATTEMPTED });
    runtime.publisher.publish({ type: "fix.attempted", producer: "simple-fixer", payload: { ...FIX_ATTEMPTED, owner: "verification-designer" } });

    expect(senders).toEqual([architectFixer.id, designerFixer.id]);
  });

  // @covers bus:DLT-006
  it("keeps the other owner's fixer joined after one fixer on the same unit left", () => {
    const runtime = createFactoryRuntime(RUN_ID);
    const architectFixer = runtime.joinLane("simple-fixer", fixerLaneUnit("architect", "design"));
    const designerFixer = runtime.joinLane("simple-fixer", fixerLaneUnit("verification-designer", "design"));
    runtime.leaveLane(architectFixer);

    const codes = [
      codeOf(() => runtime.publisher.publish({ type: "fix.attempted", producer: "simple-fixer", payload: FIX_ATTEMPTED })),
      codeOf(() => runtime.publisher.publish({ type: "fix.attempted", producer: "simple-fixer", payload: { ...FIX_ATTEMPTED, owner: "verification-designer" } })),
    ];

    expect([codes, runtime.state.getParticipant(designerFixer.id)?.getManifest().capabilities]).toEqual([["producer_not_joined", "no error"], ["lane", "unit:design"]]);
  });

  // @covers bus:BEH-005
  it("rejects an unknown event type at publication and delivers nothing", () => {
    const runtime = createFactoryRuntime(RUN_ID);
    const seen: string[] = [];
    runtime.join(createReactor("foreman", { "design.blocked": () => seen.push("x") }));

    const code = codeOf(() => runtime.publisher.publish({ type: "design.exploded" as "design.blocked", producer: "planner", payload: {} }));

    expect([code, seen]).toEqual(["unknown_event_type", []]);
  });

  it("rejects a payload missing a required field naming the field", () => {
    const runtime = createFactoryRuntime(RUN_ID);

    const message = codeOf(() => runtime.publisher.publish({ type: "design.tasks.ready", producer: "planner", payload: { path: "design/tasks.json" } }));

    expect(message).toBe("envelope_invalid");
  });

  // @covers bus:CTR-001
  it("stamps runId, producer, non-decreasing occurredAt and contiguous seq on delivered events", () => {
    const runtime = createFactoryRuntime(RUN_ID);
    const delivered: DeliveredEvent[] = [];
    runtime.join(createReactor("tracer", { "design.tech.ready": (event) => delivered.push(event), "design.verification.ready": (event) => delivered.push(event) }));

    runtime.publisher.publish({ type: "design.tech.ready", producer: "architect", payload: { path: "design/tech.md" } });
    runtime.publisher.publish({ type: "design.verification.ready", producer: "verification-designer", payload: { path: "design/verification.md" } });

    const [first, second] = delivered;
    expect([first?.runId, first?.producer, first?.seq, second?.seq, (second?.occurredAt ?? "") >= (first?.occurredAt ?? "")]).toEqual([RUN_ID, "architect", 1, 2, true]);
  });

  // @covers bus:CTR-002
  it("rejects a second terminal event for the run as terminal_event_duplicate", () => {
    const runtime = createFactoryRuntime(RUN_ID);
    runtime.publisher.publish({ type: "run.failed", producer: "foreman", payload: { stage: "build", reason: "cap_exhausted", detail: "x" } });

    const code = codeOf(() => runtime.publisher.publish({ type: "run.published", producer: "assembler", payload: { commitSha: "0123456789abcdef0123456789abcdef01234567", outputDir: "hidden/todo-cli/", pushed: false } }));

    expect(code).toBe("terminal_event_duplicate");
  });

  // @covers bus:CST-001
  it("pins @mozaik-ai/core to exactly 4.1.0 in package.json and the lockfile", async () => {
    const manifest: { dependencies: Record<string, string> } = JSON.parse(await readFile(new URL("../../../../package.json", import.meta.url), "utf8"));
    const lock: { packages: Record<string, { version: string }> } = JSON.parse(await readFile(new URL("../../../../package-lock.json", import.meta.url), "utf8"));

    expect([manifest.dependencies["@mozaik-ai/core"], lock.packages["node_modules/@mozaik-ai/core"]?.version]).toEqual(["4.1.0", "4.1.0"]);
  });
});
