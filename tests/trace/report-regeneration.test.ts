import { mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createHarness, happyPath } from "./scripted-factory.js";

async function fileIdentity(path: string): Promise<string> {
  try {
    const info = await stat(path, { bigint: true });
    return `${info.ino}:${info.mtimeNs}`;
  } catch {
    return "absent";
  }
}

describe("report regeneration", () => {
  // @covers trace:BEH-008
  it("rewrites trace.md exactly once per triggering event and leaves it untouched by other events such as task.impl_done", async () => {
    const harness = await createHarness();
    const rewrittenAt: string[] = [];
    let previous = await fileIdentity(join(harness.traceDir, "trace.md"));

    await happyPath(harness, {
      afterEvent: async (event) => {
        const current = await fileIdentity(join(harness.traceDir, "trace.md"));
        if (current !== previous) {
          rewrittenAt.push(event.type);
        }
        previous = current;
      },
    });

    expect(rewrittenAt).toEqual(["workspace.ready", "spec.approved", "design.tasks.ready", "task.approved", "task.approved", "assembly.verified", "run.published"]);
  });

  // @covers trace:BEH-008
  it("shows the just-finished task row in both files right after its task.approved", async () => {
    const harness = await createHarness();
    let traceMd = "";
    let costs = "";

    await happyPath(harness, {
      afterEvent: async (event) => {
        if (event.type === "task.approved" && event.payload["taskId"] === "T-001") {
          traceMd = await readFile(join(harness.traceDir, "trace.md"), "utf8");
          costs = await readFile(join(harness.traceDir, "costs.json"), "utf8");
        }
      },
    });

    const parsed: { tasks: { taskId: string; outcome: string }[] } = JSON.parse(costs);
    const taskRow = traceMd.split("\n").find((line) => line.startsWith("| T-001 |")) ?? "";
    expect([/^\| T-001 \| Domain model \| 1 \| 1 \| \d+ \| 0\.5260 \| 1200 \| 220 \| approved \|$/.test(taskRow), parsed.tasks.map((task) => [task.taskId, task.outcome])]).toEqual([
      true,
      [
        ["T-001", "approved"],
        ["T-002", "in_progress"],
      ],
    ]);
  });

  // @covers trace:BEH-008
  it("resolves shutdown only once the report of the terminal event is on disk", async () => {
    const harness = await createHarness();
    await harness.publish("run.started", "foreman", { specPath: "spec.md", slug: "todo-cli", operator: "cyberash", mode: "autonomous" });
    harness.runtime.publisher.publish({ type: "run.failed", producer: "foreman", payload: { stage: "workspace", reason: "runtime_error", detail: "boom" } });

    await harness.slice.shutdown();

    expect([
      (await readFile(join(harness.traceDir, "trace.md"), "utf8")).includes("- outcome: failed:workspace/runtime_error"),
      (await readFile(join(harness.traceDir, "interventions.md"), "utf8")).endsWith("mid-run interventions: 0\n"),
      (await readFile(join(harness.traceDir, "trace.jsonl"), "utf8")).includes('"type":"run.failed"'),
    ]).toEqual([true, true, true]);
  });

  // @covers trace:BEH-008
  it("publishes run.failed with trace_write_failed when the report rewrite fails", async () => {
    const harness = await createHarness({
      prepare: async ({ traceDir }) => {
        await mkdir(join(traceDir, "trace.md"), { recursive: true });
      },
    });

    await harness.publish("run.started", "foreman", { specPath: "spec.md", slug: "todo-cli", operator: "cyberash", mode: "autonomous" });
    await harness.publish("workspace.ready", "foreman", { productDir: harness.productDir, slug: "todo-cli", baselineId: "todo-cli:BL-001" });

    expect([harness.engine.state.status, harness.engine.state.failure?.reason]).toEqual(["failed", "trace_write_failed"]);
  });
});
