import YAML from "yaml";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ApiRoleRequest, ApiRoleRunner, ApiRoleUsage } from "../../../src/shared/llm/api-role-runner.js";
import type { CliRoleOutcome, CliRoleRequest, CliRoleRunner } from "../../../src/shared/llm/cli-role-runner.js";
import { createExecFileCommandRunner } from "../../../src/build-stage/adapters/outbound/exec-file-command-runner.js";
import type { CommandOptions, CommandResult, CommandRunner } from "../../../src/build-stage/ports/outbound/command-runner.js";

export interface RecordedCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

export interface RoutingCommandRunner extends CommandRunner {
  readonly calls: RecordedCommand[];
}

export interface RoutingOptions {
  readonly records?: Readonly<Record<string, string>>;
  readonly npmCi?: CommandResult;
}

export function routingCommandRunner(options: RoutingOptions = {}): RoutingCommandRunner {
  const real = createExecFileCommandRunner();
  const calls: RecordedCommand[] = [];
  return {
    calls,
    async run(command: string, args: readonly string[], runOptions: CommandOptions): Promise<CommandResult> {
      calls.push({ command, args, cwd: runOptions.cwd });
      if (command === "npx" && args[0] === "sdd" && args[1] === "record" && args[2] === "get") {
        const id = args[3] ?? "";
        return { exitCode: 0, stdout: options.records?.[id] ?? `id: ${id}\ntype: Behavior\ntitle: canned record ${id}\n`, stderr: "" };
      }
      if (command === "npm") {
        return options.npmCi ?? { exitCode: 0, stdout: "", stderr: "" };
      }
      return real.run(command, args, runOptions);
    },
  };
}

export function cliOutcome(overrides: Partial<CliRoleOutcome> = {}): CliRoleOutcome {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    result: { isError: false, costUsd: 0.05, inputTokens: 1000, outputTokens: 200, durationMs: 1500, resultText: "done", dominantModel: null },
    toolUses: [],
    stderrTail: "",
    durationMs: 1600,
    ...overrides,
  };
}

export type CliScript = (request: CliRoleRequest, invocation: number) => Promise<Partial<CliRoleOutcome> | void> | Partial<CliRoleOutcome> | void;

export interface ScriptedCliRoles extends CliRoleRunner {
  readonly requests: CliRoleRequest[];
}

export function scriptedCliRoles(script: CliScript): ScriptedCliRoles {
  const requests: CliRoleRequest[] = [];
  return {
    requests,
    async run(request: CliRoleRequest): Promise<CliRoleOutcome> {
      requests.push(request);
      const overrides = await script(request, requests.length);
      return cliOutcome(overrides ?? {});
    },
  };
}

export async function writeHandoff(path: string, frontmatter: Readonly<Record<string, unknown>>, body = "handoff body\n"): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `---\n${YAML.stringify(frontmatter)}---\n${body}`, "utf8");
}

export function usage(overrides: Partial<ApiRoleUsage> = {}): ApiRoleUsage {
  return { model: "claude-sonnet-5-5", inputTokens: 800, outputTokens: 150, costUsd: 0.02, inferenceCount: 3, durationMs: 2500, answer: "done", ...overrides };
}

export type ApiScript = (request: ApiRoleRequest, invocation: number) => Promise<void>;

export interface ScriptedApiRoles extends ApiRoleRunner {
  readonly requests: ApiRoleRequest[];
}

export function scriptedApiRoles(script: ApiScript): ScriptedApiRoles {
  const requests: ApiRoleRequest[] = [];
  return {
    requests,
    async run(request: ApiRoleRequest): Promise<ApiRoleUsage> {
      requests.push(request);
      await script(request, requests.length);
      return usage({ model: request.model });
    },
  };
}

export async function invokeTool(request: ApiRoleRequest, name: string, args: Readonly<Record<string, unknown>>): Promise<string> {
  const tool = request.tools.find((candidate) => candidate.name === name);
  if (tool === undefined) {
    throw new Error(`tool ${name} not offered`);
  }
  return String(await tool.invoke(args));
}

export function reviewFrontmatter(overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return { role: "reviewer", attempt: 1, task_id: "T-001", impl_sha: null, mode: "review", decision: "approve", target: "none", findings: [], ...overrides };
}
