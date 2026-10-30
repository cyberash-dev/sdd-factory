import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CommandRunner } from "../ports/outbound/command-runner.js";
import { runOrThrow } from "../ports/outbound/command-runner.js";
import {
  assumptionsSkeleton,
  productGitignore,
  productPackageJson,
  productSddConfig,
  productSpecSkeleton,
  productTsconfig,
  productTsconfigBuild,
  productVitestConfig,
  type ToolchainVersions,
} from "./product-scaffold.js";

export interface BootstrapInput {
  readonly productDir: string;
  readonly slug: string;
  readonly date: string;
  readonly versions: ToolchainVersions;
  readonly runner: CommandRunner;
  readonly installTimeoutMs: number;
}

export interface BootstrapOutcome {
  readonly baselineId: string;
  readonly commitSha: string;
  readonly freshnessToken: string;
}

export class BootstrapError extends Error {
  override readonly name = "BootstrapError";

  constructor(
    readonly reason: "toolchain_install_failed" | "sdd_token_failed" | "git_failed",
    detail: string,
  ) {
    super(`${reason}: ${detail}`);
  }
}

async function writeFiles(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolute = join(root, relativePath);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content, "utf8");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseToken(stdout: string): { readonly token: string; readonly commitSha: string } {
  const parsed: unknown = JSON.parse(stdout);
  if (!isRecord(parsed)) {
    throw new BootstrapError("sdd_token_failed", "token output is not an object");
  }
  const token = parsed["token"];
  const commitSha = parsed["commit_sha"];
  if (typeof token !== "string" || typeof commitSha !== "string") {
    throw new BootstrapError("sdd_token_failed", "token output lacks token or commit_sha");
  }
  return { token, commitSha };
}

const PENDING_TOKEN = "0".repeat(64);
const PENDING_SHA = "0".repeat(40);

/* sdd prints its diagnostics as JSON on stdout and leaves stderr empty. */
function commandDiagnostics(result: { readonly stdout: string; readonly stderr: string }): string {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    parsed = null;
  }
  if (isRecord(parsed) && typeof parsed["reason"] === "string") {
    return typeof parsed["detail"] === "string" ? `${parsed["reason"]}: ${parsed["detail"]}` : parsed["reason"];
  }
  const text = result.stderr.trim().length > 0 ? result.stderr : result.stdout;
  return text.trim().split("\n").slice(-3).join(" | ");
}

async function git(runner: CommandRunner, cwd: string, args: readonly string[]): Promise<string> {
  try {
    return (await runOrThrow(runner, "git", args, { cwd })).stdout.trim();
  } catch (error) {
    throw new BootstrapError("git_failed", error instanceof Error ? error.message : String(error));
  }
}

export async function bootstrapProduct(input: BootstrapInput): Promise<BootstrapOutcome> {
  const { productDir, slug, runner } = input;
  await mkdir(productDir, { recursive: true });
  await writeFiles(productDir, {
    "package.json": productPackageJson(slug, input.versions),
    "tsconfig.json": productTsconfig(),
    "tsconfig.build.json": productTsconfigBuild(),
    "vitest.config.ts": productVitestConfig(),
    ".gitignore": productGitignore(),
    ".sdd/config.json": productSddConfig(slug),
    "src/index.ts": "export {};\n",
    "tests/.gitkeep": "",
    "spec/assumptions.md": assumptionsSkeleton(slug),
  });
  await git(runner, productDir, ["init", "-q", "-b", "integration"]);
  await git(runner, productDir, ["config", "user.email", "factory@sdd-factory.local"]);
  await git(runner, productDir, ["config", "user.name", "sdd-factory"]);
  const install = await runner.run("npm", ["install", "--no-audit", "--no-fund"], { cwd: productDir, timeoutMs: input.installTimeoutMs });
  if (install.exitCode !== 0) {
    throw new BootstrapError("toolchain_install_failed", commandDiagnostics(install));
  }
  await git(runner, productDir, ["add", "-A"]);
  await git(runner, productDir, ["commit", "-q", "-m", "scaffold product"]);
  /* sdd token reads the configured spec file, so a skeleton with placeholder values exists before the call. */
  await writeFiles(productDir, { "spec/spec.md": productSpecSkeleton({ slug, freshnessToken: PENDING_TOKEN, commitSha: PENDING_SHA, date: input.date }) });
  const token = await runner.run("npx", ["sdd", "token", "--format=json"], { cwd: productDir });
  if (token.exitCode !== 0) {
    throw new BootstrapError("sdd_token_failed", commandDiagnostics(token));
  }
  const { token: freshnessToken, commitSha } = parseToken(token.stdout);
  await writeFiles(productDir, { "spec/spec.md": productSpecSkeleton({ slug, freshnessToken, commitSha, date: input.date }) });
  await git(runner, productDir, ["add", "-A"]);
  await git(runner, productDir, ["commit", "-q", "-m", "spec skeleton"]);
  return { baselineId: `${slug}:BL-001`, commitSha, freshnessToken };
}
