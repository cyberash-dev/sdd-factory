import { cp } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createExecFileCommandRunner } from "../../src/assembly-stage/adapters/outbound/exec-file-command-runner.js";
import { scriptedAssembly } from "./scripted-harness.js";
import { SLUG, tempDir, vitestReport } from "./support.js";

describe("published product", () => {
  // @covers assembly-stage:INV-005
  // @covers assembly-stage:ASM-001
  // @covers assembly-stage:SCN-001
  it("npm ci && npm test in a fresh copy", async () => {
    const run = await scriptedAssembly({ vitest: (_, productDir) => vitestReport({ passing: [join(productDir, "tests/cli/parse.test.mjs")] }) });
    const copy = await tempDir("assembly-fresh-copy");
    await cp(join(run.teamDir, "hidden", SLUG), copy, { recursive: true });
    const real = createExecFileCommandRunner();

    const install = await real.run({ argv: ["npm", "ci", "--no-audit", "--no-fund"], cwd: copy, timeoutMs: 60000 });
    const test = await real.run({ argv: ["npm", "test"], cwd: copy, timeoutMs: 60000 });

    expect([install.exitCode, test.exitCode, test.stdout.includes("fail 0")]).toEqual([0, 0, true]);
  }, 60000);
});
