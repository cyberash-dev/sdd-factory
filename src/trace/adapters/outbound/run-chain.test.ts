import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { earlierRunReader } from "./run-chain.js";

async function writeJson(path: string, value: Readonly<Record<string, unknown>>): Promise<void> {
  await writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
}

async function writeRunDir(runsRoot: string, runId: string, resumedFrom: string | null): Promise<string> {
  const runDir = join(runsRoot, runId);
  await mkdir(join(runDir, "trace"), { recursive: true });
  await writeJson(join(runDir, "run.json"), { runId, status: "failed", stage: "build", reason: "cap_exhausted", startedAt: "2026-10-31T02:16:26.406Z", endedAt: "2026-10-31T02:59:56.334Z", resumedFrom });
  return runDir;
}

describe("earlier runs of a resume chain", () => {
  // @covers trace:DLT-005
  it("reads no earlier runs while the run's own run.json is not written yet", async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), "run-chain-"));
    await mkdir(join(runsRoot, "room-booking-api-20261031-030005"));

    const earlier = earlierRunReader(join(runsRoot, "room-booking-api-20261031-030005"))();

    expect(earlier).toEqual([]);
  });

  // @covers trace:DLT-005
  it("reports an earlier run whose run.json is missing as unavailable and follows the chain no further", async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), "run-chain-"));
    const runDir = await writeRunDir(runsRoot, "room-booking-api-20261031-030005", "room-booking-api-20261031-021626");

    const earlier = earlierRunReader(runDir)();

    expect(earlier).toEqual([{ kind: "unavailable", runId: "room-booking-api-20261031-021626", reason: `${join(runsRoot, "room-booking-api-20261031-021626", "run.json")} is missing` }]);
  });

  // @covers trace:DLT-005
  it.each([
    { file: "run.json", content: "{not json\n", problem: "is not JSON" },
    { file: "trace/costs.json", content: "{not json\n", problem: "is not JSON" },
    { file: "trace/costs.json", content: '{"schemaVersion":1}\n', problem: "has no totals" },
  ])("reports an earlier run whose $file $problem as unavailable", async ({ file, content, problem }) => {
    const runsRoot = await mkdtemp(join(tmpdir(), "run-chain-"));
    const runDir = await writeRunDir(runsRoot, "room-booking-api-20261031-030005", "room-booking-api-20261031-021626");
    const earlierDir = await writeRunDir(runsRoot, "room-booking-api-20261031-021626", null);
    await writeJson(join(earlierDir, "trace", "costs.json"), { totals: { durationMs: 2609901, costUsd: 3.272092, inputTokens: 4533402, outputTokens: 568579, unknownCostEntries: 0 } });
    await writeFile(join(earlierDir, file), content, "utf8");

    const earlier = earlierRunReader(runDir)();

    expect(earlier).toEqual([{ kind: "unavailable", runId: "room-booking-api-20261031-021626", reason: `${join(earlierDir, file)} ${problem}` }]);
  });

  // @covers trace:DLT-005
  it("follows the chain past an earlier run whose costs.json is missing to the run it resumed", async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), "run-chain-"));
    const runDir = await writeRunDir(runsRoot, "room-booking-api-20261031-030005", "room-booking-api-20261031-021626");
    await writeRunDir(runsRoot, "room-booking-api-20261031-021626", "room-booking-api-20261031-010000");
    const firstDir = await writeRunDir(runsRoot, "room-booking-api-20261031-010000", null);
    await writeJson(join(firstDir, "trace", "costs.json"), { totals: { durationMs: 1800000, costUsd: 1.5, inputTokens: 1000, outputTokens: 100, unknownCostEntries: 0 } });

    const earlier = earlierRunReader(runDir)();

    expect(earlier.map((run) => [run.kind, run.runId])).toEqual([
      ["available", "room-booking-api-20261031-010000"],
      ["unavailable", "room-booking-api-20261031-021626"],
    ]);
  });
});
