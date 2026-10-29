import { execFile } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createHarness, failingPath, happyPath, SLUG } from "./scripted-factory.js";

const run = promisify(execFile);

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function lastLineType(path: string): Promise<string> {
  const lines = (await readFile(path, "utf8")).split("\n").filter((line) => line.length > 0);
  const last: { type?: string } = JSON.parse(lines.at(-1) ?? "{}");
  return last.type ?? "";
}

describe("published trace copy", () => {
  // @covers trace:BEH-007
  it("copies the four trace files with outcome published before run.published, whose line then lands only in the run directory", async () => {
    const harness = await createHarness();

    await happyPath(harness);

    const published = (await readdir(harness.publishedTraceDir)).sort();
    const publishedMd = await readFile(join(harness.publishedTraceDir, "trace.md"), "utf8");
    const publishedInterventions = await readFile(join(harness.publishedTraceDir, "interventions.md"), "utf8");
    expect([
      published,
      publishedMd.includes("- outcome: published"),
      publishedMd.includes("- finishedAt: 2026-"),
      await lastLineType(join(harness.publishedTraceDir, "trace.jsonl")),
      await lastLineType(join(harness.traceDir, "trace.jsonl")),
      publishedInterventions.endsWith("mid-run interventions: 0\n"),
      (await readFile(join(harness.traceDir, "trace.md"), "utf8")).includes("- outcome: published"),
    ]).toEqual([["costs.json", "interventions.md", "trace.jsonl", "trace.md"], true, true, "assembly.verified", "run.published", true, true]);
  });

  // @covers trace:BEH-007
  it("copies the same four files through the slice method copyTraceTo", async () => {
    const harness = await createHarness();
    const destination = join(harness.root, "elsewhere", "trace");

    await happyPath(harness);
    await harness.slice.copyTraceTo(destination);

    expect([(await readdir(destination)).sort(), (await readFile(join(destination, "trace.md"), "utf8")).includes("- outcome: published")]).toEqual([
      ["costs.json", "interventions.md", "trace.jsonl", "trace.md"],
      true,
    ]);
  });

  // @covers trace:BEH-007
  it("copies nothing when the run fails", async () => {
    const harness = await createHarness();

    await failingPath(harness);

    expect([await exists(harness.publishedTraceDir), (await readFile(join(harness.traceDir, "trace.md"), "utf8")).includes("- outcome: failed:spec/lint_cap")]).toEqual([false, true]);
  });

  // @covers trace:CST-001
  it("writes UTF-8 text files that a publish commit lists under hidden/<slug>/trace/", async () => {
    const harness = await createHarness();
    const decoder = new TextDecoder("utf-8", { fatal: true });

    await happyPath(harness);

    const names = await readdir(harness.publishedTraceDir);
    const decoded = await Promise.all(names.map(async (name) => decoder.decode(await readFile(join(harness.publishedTraceDir, name))).length > 0));
    await run("git", ["init", "-q"], { cwd: harness.root });
    await run("git", ["add", "hidden"], { cwd: harness.root });
    await run("git", ["-c", "user.name=factory", "-c", "user.email=factory@example.com", "commit", "-q", "-m", `factory: ${SLUG} run`], { cwd: harness.root });
    const { stdout } = await run("git", ["ls-tree", "-r", "--name-only", "HEAD"], { cwd: harness.root });
    expect([decoded, stdout.trim().split("\n").sort()]).toEqual([
      [true, true, true, true],
      [`hidden/${SLUG}/trace/costs.json`, `hidden/${SLUG}/trace/interventions.md`, `hidden/${SLUG}/trace/trace.jsonl`, `hidden/${SLUG}/trace/trace.md`],
    ]);
  });
});
