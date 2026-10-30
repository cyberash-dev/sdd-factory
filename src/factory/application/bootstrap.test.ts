import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CommandRunner } from "../ports/outbound/command-runner.js";
import { bootstrapProduct } from "./bootstrap.js";

const VERSIONS = { typescript: "7.0.2", vitest: "5.0.5", typesNode: "26.6.6", agentSdd: "2.1.1" };

function fakeRunner(options: { readonly npmExit?: number; readonly tokenExit?: number } = {}): { runner: CommandRunner; calls: string[] } {
  const calls: string[] = [];
  const runner: CommandRunner = {
    async run(command, args, runOptions) {
      calls.push([command, ...args].join(" "));
      if (command === "npm") {
        return { exitCode: options.npmExit ?? 0, stdout: "", stderr: options.npmExit === undefined ? "" : "npm ERR! network unreachable" };
      }
      if (command === "npx" && !existsSync(join(runOptions.cwd, "spec", "spec.md"))) {
        return { exitCode: 2, stdout: JSON.stringify({ format_version: 1, ok: false, reason: "config-invalid", detail: `ENOENT: no such file or directory, open '${join(runOptions.cwd, "spec", "spec.md")}'` }), stderr: "" };
      }
      if (command === "npx" && options.tokenExit !== undefined) {
        return { exitCode: options.tokenExit, stdout: JSON.stringify({ format_version: 1, ok: false, reason: "config-invalid", detail: "bad config" }), stderr: "" };
      }
      if (command === "npx") {
        return { exitCode: 0, stdout: JSON.stringify({ token: "ab".repeat(32), commit_sha: "cd".repeat(20) }), stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  };
  return { runner, calls };
}

async function tempProductDir(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "product-")), "product");
}

describe("product bootstrap", () => {
  // @covers factory:BEH-002
  it("writes the scaffold, commits, computes the token and returns the baseline id", async () => {
    const productDir = await tempProductDir();
    const { runner, calls } = fakeRunner();

    const outcome = await bootstrapProduct({ productDir, slug: "todo-cli", date: "2026-10-29", versions: VERSIONS, runner, installTimeoutMs: 1000 });

    const spec = await readFile(join(productDir, "spec", "spec.md"), "utf8");
    expect([outcome, (await readdir(productDir)).sort(), spec.includes(`freshness_token: ${"ab".repeat(32)}`), calls]).toEqual([
      { baselineId: "todo-cli:BL-001", commitSha: "cd".repeat(20), freshnessToken: "ab".repeat(32) },
      [".gitignore", ".sdd", "package.json", "spec", "src", "tests", "tsconfig.build.json", "tsconfig.json", "vitest.config.ts"],
      true,
      [
        "git init -q -b integration",
        "git config user.email factory@sdd-factory.local",
        "git config user.name sdd-factory",
        "npm install --no-audit --no-fund",
        "git add -A",
        "git commit -q -m scaffold product",
        "npx sdd token --format=json",
        "git add -A",
        "git commit -q -m spec skeleton",
      ],
    ]);
  });

  it("reports a failed dependency install as toolchain_install_failed", async () => {
    const { runner } = fakeRunner({ npmExit: 1 });

    await expect(bootstrapProduct({ productDir: await tempProductDir(), slug: "todo-cli", date: "2026-10-29", versions: VERSIONS, runner, installTimeoutMs: 1000 })).rejects.toThrow("toolchain_install_failed: npm ERR! network unreachable");
  });

  it("reports a failed token computation as sdd_token_failed with the diagnostics sdd prints to stdout", async () => {
    const { runner } = fakeRunner({ tokenExit: 2 });

    await expect(bootstrapProduct({ productDir: await tempProductDir(), slug: "todo-cli", date: "2026-10-29", versions: VERSIONS, runner, installTimeoutMs: 1000 })).rejects.toThrow("sdd_token_failed: config-invalid: bad config");
  });

  it("asks sdd for the token only once spec/spec.md exists and leaves no placeholder behind", async () => {
    const productDir = await tempProductDir();
    const { runner } = fakeRunner();

    const outcome = await bootstrapProduct({ productDir, slug: "todo-cli", date: "2026-10-29", versions: VERSIONS, runner, installTimeoutMs: 1000 });

    const spec = await readFile(join(productDir, "spec", "spec.md"), "utf8");
    expect([outcome.freshnessToken, spec.includes("0".repeat(64)), spec.includes(`baseline_commit_sha: ${"cd".repeat(20)}`)]).toEqual(["ab".repeat(32), false, true]);
  });
});
