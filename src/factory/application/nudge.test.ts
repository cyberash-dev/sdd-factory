import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recordNudge } from "./nudge.js";

async function repoWithRun(runId: string, manifest: string): Promise<string> {
  const repoRoot = await mkdtemp(join(tmpdir(), "nudge-"));
  await mkdir(join(repoRoot, ".factory", "runs", runId), { recursive: true });
  await writeFile(join(repoRoot, ".factory", "runs", runId, "run.json"), manifest, "utf8");
  return repoRoot;
}

describe("factory nudge", () => {
  // @covers factory:BEH-008
  it("records the note and actor as a nudge file inside the run directory", async () => {
    const repoRoot = await repoWithRun("todo-cli-20261029-120000", "{}");

    const path = await recordNudge(repoRoot, "todo-cli-20261029-120000", "retry the planner", "cyberash", new Date("2026-10-29T12:05:00.000Z"));

    const written: unknown = JSON.parse(await readFile(path, "utf8"));
    expect([written, await readdir(join(repoRoot, ".factory", "runs", "todo-cli-20261029-120000", "nudges"))]).toEqual([
      { note: "retry the planner", actor: "cyberash", at: "2026-10-29T12:05:00.000Z" },
      ["2026-10-29T12-05-00-000Z.json"],
    ]);
  });

  it("rejects an unknown run id", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "nudge-"));

    await expect(recordNudge(repoRoot, "nope-20261029-120000", "x", "o", new Date())).rejects.toThrow("unknown run nope-20261029-120000");
  });

  it("rejects a run whose manifest is not JSON", async () => {
    const repoRoot = await repoWithRun("todo-cli-20261029-120000", "{not json");

    await expect(recordNudge(repoRoot, "todo-cli-20261029-120000", "x", "o", new Date())).rejects.toThrow("run_manifest_invalid");
  });
});
