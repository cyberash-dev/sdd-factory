import { join } from "node:path";
import type { TechTooling } from "../../shared/design-files/tech-md.js";
import { readTextOrNull, writeTextAtomic } from "../../shared/fs/text.js";
import type { CommandResult, CommandRunner } from "../ports/outbound/command-runner.js";

export interface ToolingInstallRequest {
  readonly commands: CommandRunner;
  readonly productDir: string;
  readonly tooling: TechTooling;
  readonly timeoutMs: number;
  readonly log: (line: string) => void;
}

export type ToolingInstallOutcome = { readonly ok: true; readonly committed: boolean } | { readonly ok: false; readonly detail: string };

const TOOLING_FILES: readonly string[] = ["package.json", "package-lock.json", "tsconfig.json"];
const TAIL_CHARS = 2000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function outputTail(result: CommandResult): string {
  return `${result.stdout}${result.stderr}`.slice(-TAIL_CHARS);
}

async function npmInstall(request: ToolingInstallRequest, flags: readonly string[], packages: readonly string[]): Promise<CommandResult> {
  request.log(`design-stage: npm install ${flags.join(" ")} ${packages.join(" ")}`);
  return request.commands.run({ file: "npm", args: ["install", "--no-audit", "--no-fund", ...flags, ...packages], cwd: request.productDir, timeoutMs: request.timeoutMs });
}

async function overwriteCompilerOptions(productDir: string, compilerOptions: Readonly<Record<string, unknown>>): Promise<void> {
  const path = join(productDir, "tsconfig.json");
  const current: unknown = JSON.parse((await readTextOrNull(path)) ?? "{}");
  const base = isRecord(current) ? current : {};
  await writeTextAtomic(path, `${JSON.stringify({ ...base, compilerOptions }, null, 2)}\n`);
}

async function git(request: ToolingInstallRequest, args: readonly string[]): Promise<CommandResult> {
  const result = await request.commands.run({ file: "git", args, cwd: request.productDir, timeoutMs: request.timeoutMs });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} exited ${result.exitCode}: ${outputTail(result)}`);
  }
  return result;
}

async function commitToolingFiles(request: ToolingInstallRequest): Promise<void> {
  const branch = (await git(request, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
  if (branch !== "integration") {
    throw new Error(`tooling commit requires branch integration, product repo is on ${branch}`);
  }
  const present: string[] = [];
  for (const file of TOOLING_FILES) {
    if ((await readTextOrNull(join(request.productDir, file))) !== null) {
      present.push(file);
    }
  }
  await git(request, ["add", "--", ...present]);
  await git(request, ["commit", "-m", "design: tooling"]);
}

/* design-stage:BEH-003: exact installs, tsconfig compilerOptions overwrite, one commit on integration; nothing when there is nothing to do. */
export async function installTooling(request: ToolingInstallRequest): Promise<ToolingInstallOutcome> {
  const { tooling } = request;
  const steps: (() => Promise<CommandResult>)[] = [];
  if (tooling.dependencies.length > 0) {
    steps.push(() => npmInstall(request, ["--save-exact"], tooling.dependencies));
  }
  if (tooling.devDependencies.length > 0) {
    steps.push(() => npmInstall(request, ["--save-dev", "--save-exact"], tooling.devDependencies));
  }
  for (const step of steps) {
    const result = await step();
    if (result.exitCode !== 0) {
      return { ok: false, detail: `npm install exited ${result.exitCode}: ${outputTail(result)}` };
    }
  }
  if (tooling.tsconfig !== null) {
    await overwriteCompilerOptions(request.productDir, tooling.tsconfig);
  }
  if (steps.length === 0 && tooling.tsconfig === null) {
    return { ok: true, committed: false };
  }
  await commitToolingFiles(request);
  return { ok: true, committed: true };
}
