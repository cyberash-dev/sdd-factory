import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { DeliveredEvent } from "../../domain/envelope.js";
import { createFactoryRuntime, createReactor } from "./runtime.js";

const RUN_ID = "todo-cli-20261029-120000";

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
