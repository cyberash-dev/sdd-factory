import { spawn, type ChildProcess } from "node:child_process";

export interface CliRoleRequest {
  readonly binary: string;
  readonly cwd: string;
  readonly prompt: string;
  readonly addDirs: readonly string[];
  readonly model: string | null;
  readonly timeoutMs: number;
  readonly env: Readonly<Record<string, string>>;
}

export interface CliToolUse {
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
}

export interface CliResult {
  readonly isError: boolean;
  readonly costUsd: number | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly durationMs: number;
  readonly resultText: string;
  readonly dominantModel: string | null;
}

export interface CliRoleOutcome {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly result: CliResult | null;
  readonly toolUses: readonly CliToolUse[];
  readonly stderrTail: string;
  readonly durationMs: number;
}

export interface CliRoleRunner {
  run(request: CliRoleRequest): Promise<CliRoleOutcome>;
}

type LaneSignal = "SIGINT" | "SIGTERM";

const liveLanes = new Set<ChildProcess>();
/* Each runner remembers the generation it was created in: a later signalLanes terminates it, a runner created afterwards (the next run) starts fresh. */
let signalGeneration = 0;
let lastSignal: LaneSignal = "SIGTERM";

/* factory:BEH-010: a lane subprocess receives the signal that ends the factory process; no subprocess starts after it. */
export function signalLanes(signal: LaneSignal): void {
  signalGeneration += 1;
  lastSignal = signal;
  for (const lane of liveLanes) {
    lane.kill(signal);
  }
}

/* A timeout kills the subprocess with SIGTERM too, but that outcome stays an ordinary lane failure. */
export function isTerminatedOutcome(outcome: CliRoleOutcome): boolean {
  return outcome.signal !== null && !outcome.timedOut;
}

function terminatedOutcome(signal: LaneSignal): CliRoleOutcome {
  return { exitCode: null, signal, timedOut: false, result: null, toolUses: [], stderrTail: "", durationMs: 0 };
}

export function claudeArgv(request: CliRoleRequest): string[] {
  /* build-stage:DLT-002: --safe-mode keeps the operator's CLAUDE.md, skills, hooks and MCP servers out of the lane. */
  const argv = ["--print", "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions", "--safe-mode"];
  for (const dir of request.addDirs) {
    argv.push("--add-dir", dir);
  }
  if (request.model !== null) {
    argv.push("--model", request.model);
  }
  return argv;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/* build-stage:DLT-001: Claude Code lists every model it used; the one with the most output tokens names the inference. */
function dominantModelOf(modelUsage: unknown): string | null {
  if (!isRecord(modelUsage)) {
    return null;
  }
  let best: { readonly model: string; readonly outputTokens: number } | null = null;
  for (const [model, usage] of Object.entries(modelUsage)) {
    const outputTokens = isRecord(usage) ? numberOr(usage["outputTokens"] ?? usage["output_tokens"], 0) : 0;
    if (best === null || outputTokens > best.outputTokens) {
      best = { model, outputTokens };
    }
  }
  return best?.model ?? null;
}

export function parseStreamJsonLine(line: string): { readonly kind: "tool_use"; readonly toolUse: CliToolUse } | { readonly kind: "result"; readonly result: CliResult } | { readonly kind: "other" } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { kind: "other" };
  }
  if (!isRecord(parsed)) {
    return { kind: "other" };
  }
  if (parsed["type"] === "result") {
    const usage = isRecord(parsed["usage"]) ? parsed["usage"] : {};
    return {
      kind: "result",
      result: {
        isError: parsed["is_error"] === true,
        costUsd: typeof parsed["total_cost_usd"] === "number" ? parsed["total_cost_usd"] : null,
        inputTokens: numberOr(usage["input_tokens"], 0),
        outputTokens: numberOr(usage["output_tokens"], 0),
        durationMs: numberOr(parsed["duration_ms"], 0),
        resultText: typeof parsed["result"] === "string" ? parsed["result"] : "",
        dominantModel: dominantModelOf(parsed["modelUsage"]),
      },
    };
  }
  if (parsed["type"] === "assistant" && isRecord(parsed["message"]) && Array.isArray(parsed["message"]["content"])) {
    const toolUse = parsed["message"]["content"].find((item: unknown) => isRecord(item) && item["type"] === "tool_use");
    if (isRecord(toolUse) && typeof toolUse["name"] === "string") {
      return { kind: "tool_use", toolUse: { name: toolUse["name"], input: isRecord(toolUse["input"]) ? toolUse["input"] : {} } };
    }
  }
  return { kind: "other" };
}

export function createCliRoleRunner(): CliRoleRunner {
  const createdInGeneration = signalGeneration;
  return {
    run(request: CliRoleRequest): Promise<CliRoleOutcome> {
      if (signalGeneration !== createdInGeneration) {
        return Promise.resolve(terminatedOutcome(lastSignal));
      }
      return new Promise((resolvePromise, rejectPromise) => {
        const startedAt = Date.now();
        const toolUses: CliToolUse[] = [];
        let result: CliResult | null = null;
        let stderr = "";
        let buffer = "";
        let timedOut = false;
        const child = spawn(request.binary, claudeArgv(request), { cwd: request.cwd, env: { ...request.env }, stdio: ["pipe", "pipe", "pipe"] });
        liveLanes.add(child);
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, request.timeoutMs);
        const consume = (chunk: string): void => {
          buffer += chunk;
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const message = parseStreamJsonLine(line);
            if (message.kind === "tool_use") {
              toolUses.push(message.toolUse);
            } else if (message.kind === "result") {
              result = message.result;
            }
          }
        };
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", consume);
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => {
          stderr = (stderr + chunk).slice(-4000);
        });
        child.on("error", (error) => {
          clearTimeout(timer);
          liveLanes.delete(child);
          rejectPromise(error);
        });
        child.on("close", (exitCode, signal) => {
          clearTimeout(timer);
          liveLanes.delete(child);
          if (buffer.length > 0) {
            consume("\n");
          }
          resolvePromise({ exitCode, signal, timedOut, result, toolUses, stderrTail: stderr, durationMs: Date.now() - startedAt });
        });
        child.stdin.end(request.prompt);
      });
    },
  };
}

const ENV_ALLOWLIST = ["PATH", "HOME", "LANG", "LC_ALL", "TERM", "NODE_OPTIONS", "TMPDIR", "SHELL", "USER", "XDG_CONFIG_HOME"];

export function laneEnvironment(source: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    const value = source[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}
