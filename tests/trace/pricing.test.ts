import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { TokenCounts } from "../../src/shared/llm/pricing.js";
import { createHarness, type Harness } from "./scripted-factory.js";

interface CostsFile {
  readonly entries: { participant: string; taskId: string | null; stage: string; costUsd: number | null; inputTokens: number; outputTokens: number; model: string | null; durationMs: number }[];
  readonly totals: { costUsd: number; unknownCostEntries: number };
}

async function oneInference(harness: Harness, model: string, usage: TokenCounts | null): Promise<{ readonly costs: CostsFile; readonly traceMd: string; readonly status: string }> {
  await harness.publish("run.started", "foreman", { specPath: "spec.md", slug: "todo-cli", operator: "cyberash", mode: "autonomous" });
  await harness.publish("workspace.ready", "foreman", { productDir: harness.productDir, slug: "todo-cli", baselineId: "todo-cli:BL-001" });
  await harness.infer("spec-analyst", model, usage);
  await harness.publish("spec.blocked", "spec-analyst", { reason: "analyst_blocked", detail: "stop" });
  const costs: CostsFile = JSON.parse(await readFile(join(harness.traceDir, "costs.json"), "utf8"));
  const traceMd = await readFile(join(harness.traceDir, "trace.md"), "utf8");
  return { costs, traceMd, status: harness.engine.state.status };
}

describe("API role pricing", () => {
  // @covers trace:BEH-004
  it("prices 1000 input and 200 output tokens at 3 and 15 per MTok as 0.006 with the duration taken from inference.started", async () => {
    const harness = await createHarness({ pricing: { m: { inputPerMillion: 3, outputPerMillion: 15 } } });

    const { costs } = await oneInference(harness, "m", { inputTokens: 1000, outputTokens: 200 });

    const lines: { type: string; occurredAt: string }[] = (await readFile(join(harness.traceDir, "trace.jsonl"), "utf8"))
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line): { type: string; occurredAt: string } => JSON.parse(line));
    const startedAt = lines.find((line) => line.type === "inference.started")?.occurredAt ?? "";
    const completedAt = lines.find((line) => line.type === "inference.completed")?.occurredAt ?? "";
    const entry = costs.entries[0];
    expect([costs.entries.length, entry, costs.totals.costUsd, costs.totals.unknownCostEntries]).toEqual([
      1,
      { participant: "spec-analyst", taskId: null, stage: "spec", costUsd: 0.006, inputTokens: 1000, outputTokens: 200, model: "m", durationMs: Date.parse(completedAt) - Date.parse(startedAt) },
      0.006,
      0,
    ]);
  });

  // @covers trace:BEH-004
  it("records cost null with the tokens and a warning line when the model has no price entry, and the run continues", async () => {
    const harness = await createHarness({ pricing: { m: { inputPerMillion: 3, outputPerMillion: 15 } } });

    const { costs, traceMd, status } = await oneInference(harness, "unpriced-model", { inputTokens: 1000, outputTokens: 200 });

    expect([costs.entries[0]?.costUsd, costs.entries[0]?.inputTokens, costs.entries[0]?.outputTokens, costs.totals.costUsd, costs.totals.unknownCostEntries, traceMd.includes("- warning: no price for model unpriced-model"), status]).toEqual([
      null,
      1000,
      200,
      0,
      1,
      true,
      "spec_drafting",
    ]);
  });

  // @covers trace:BEH-004
  it("records cost null with zero tokens and a no token usage warning when the provider reports no usage", async () => {
    const harness = await createHarness({ pricing: { m: { inputPerMillion: 3, outputPerMillion: 15 } } });

    const { costs, traceMd } = await oneInference(harness, "m", null);

    expect([costs.entries[0]?.costUsd, costs.entries[0]?.inputTokens, costs.entries[0]?.outputTokens, costs.entries[0]?.model, traceMd.includes("- warning: no token usage for model m")]).toEqual([null, 0, 0, "m", true]);
  });
});
