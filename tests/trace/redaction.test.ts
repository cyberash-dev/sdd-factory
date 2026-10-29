import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createHarness, failingPath, happyPath } from "./scripted-factory.js";

async function filesOf(directory: string): Promise<Record<string, string>> {
  const names = await readdir(directory);
  const entries = await Promise.all(names.map(async (name) => [name, await readFile(join(directory, name), "utf8")] as const));
  return Object.fromEntries(entries);
}

describe("secret redaction in trace files", () => {
  // @covers trace:BEH-006
  it("replaces an environment secret found in an event payload by [REDACTED] in trace.jsonl and keeps a 7-character value untouched", async () => {
    const harness = await createHarness({ env: { FAKE_API_KEY: "sk-test-1234567890", SHORT_KEY: "abc1234", HOME: "/Users/someone" } });

    await failingPath(harness, { failureDetail: "lint failed with key sk-test-1234567890 and abc1234" });

    const files = await filesOf(harness.traceDir);
    const blockedLine = (files["trace.jsonl"] ?? "").split("\n").find((line) => line.includes('"type":"spec.blocked"')) ?? "";
    const blocked: { payload: { detail: string } } = JSON.parse(blockedLine);
    expect([blocked.payload.detail, Object.values(files).some((text) => text.includes("sk-test-1234567890")), Object.keys(files).sort()]).toEqual([
      "lint failed with key [REDACTED] and abc1234",
      false,
      ["costs.json", "interventions.md", "trace.jsonl", "trace.md"],
    ]);
  });

  // @covers trace:INV-003
  it("leaves no occurrence of secrets of length 8, 40 and 200 in the run directory trace or in the published copy", async () => {
    const secret8 = "s8abcdef";
    const secret40 = "s40-".padEnd(40, "q");
    const secret200 = "s200-".padEnd(200, "z");
    const harness = await createHarness({ env: { DB_PASSWORD: secret8, GITHUB_TOKEN: secret40, CLIENT_SECRET: secret200 } });

    await happyPath(harness, {
      titles: { "T-001": `Model with ${secret40}`, "T-002": "CLI entry" },
      nudges: [
        { kind: "mid_run_nudge", actor: "cyberash", note: `${secret8} at line start` },
        { kind: "mid_run_nudge", actor: "cyberash", note: `see /tmp/${secret200}/notes.md` },
      ],
    });

    const runFiles = await filesOf(harness.traceDir);
    const publishedFiles = await filesOf(harness.publishedTraceDir);
    const everyText = [...Object.values(runFiles), ...Object.values(publishedFiles)];
    const found = [secret8, secret40, secret200].filter((secret) => everyText.some((text) => text.includes(secret)));
    expect([
      found,
      Object.keys(publishedFiles).length,
      runFiles["trace.md"]?.includes("| T-001 | Model with [REDACTED] |"),
      publishedFiles["costs.json"]?.includes('"title": "Model with [REDACTED]"'),
      runFiles["interventions.md"]?.includes('note="[REDACTED] at line start"'),
      runFiles["trace.jsonl"]?.includes('"note":"see /tmp/[REDACTED]/notes.md"'),
    ]).toEqual([[], 4, true, true, true, true]);
  });
});
