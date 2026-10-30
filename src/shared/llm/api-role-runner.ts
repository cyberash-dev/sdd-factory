import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createAgent, type SemanticEvent, type Tool } from "@mozaik-ai/core";
import type { FactoryRuntime } from "../../bus/adapters/mozaik/runtime.js";
import { createRuntimeObserver } from "../../bus/adapters/mozaik/runtime.js";
import type { Producer } from "../../bus/domain/envelope.js";
import type { ModelPricing } from "../config.js";
import { costOf } from "./pricing.js";

export interface ApiRoleRequest {
  readonly role: Producer;
  readonly instruction: string;
  readonly message: string;
  readonly model: string;
  readonly tools: readonly Tool[];
  readonly timeoutMs: number;
  readonly maxOutputTokens: number;
  readonly taskId?: string;
  readonly toolTracePath?: string;
}

const TRACE_HEAD_CHARS = 400;

function head(text: string): string {
  return text.length <= TRACE_HEAD_CHARS ? text : `${text.slice(0, TRACE_HEAD_CHARS)}…`;
}

async function appendTraceLine(path: string, line: Record<string, unknown>): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(line)}\n`, "utf8");
  } catch {
    return;
  }
}

function isFileExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

/* build-stage:DLT-004: re-runs share one trace path, so the run number is the first free answer-run<N>.md beside it. */
async function keepAnswer(toolTracePath: string, answer: string): Promise<void> {
  const dir = dirname(toolTracePath);
  try {
    await mkdir(dir, { recursive: true });
    for (let runNumber = 1; ; runNumber += 1) {
      try {
        await writeFile(join(dir, `answer-run${runNumber}.md`), answer, { encoding: "utf8", flag: "wx" });
        return;
      } catch (error) {
        if (!isFileExists(error)) {
          throw error;
        }
      }
    }
  } catch {
    return;
  }
}

/* Every tool call of the role lands as one JSON line next to its handoff, for post-mortems without the provider's transcript. */
function tracedTools(tools: readonly Tool[], path: string): Tool[] {
  return tools.map((tool) => ({
    ...tool,
    invoke: async (args: unknown): Promise<unknown> => {
      const startedAt = Date.now();
      let result: unknown;
      try {
        result = await tool.invoke(args);
      } catch (error) {
        await appendTraceLine(path, { at: new Date(startedAt).toISOString(), tool: tool.name, args: head(JSON.stringify(args)), result: `THROWN: ${error instanceof Error ? error.message : String(error)}`, durationMs: Date.now() - startedAt });
        throw error;
      }
      await appendTraceLine(path, { at: new Date(startedAt).toISOString(), tool: tool.name, args: head(JSON.stringify(args)), result: head(typeof result === "string" ? result : JSON.stringify(result)), durationMs: Date.now() - startedAt });
      return result;
    },
  }));
}

export const TASK_CAPABILITY_PREFIX = "task:";

export function taskIdOfCapabilities(capabilities: readonly string[] | undefined): string | null {
  const capability = (capabilities ?? []).find((item) => item.startsWith(TASK_CAPABILITY_PREFIX));
  return capability === undefined ? null : capability.slice(TASK_CAPABILITY_PREFIX.length);
}

export interface ApiRoleUsage {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number | null;
  readonly inferenceCount: number;
  readonly durationMs: number;
  readonly answer: string;
}

export interface ApiRoleRunner {
  run(request: ApiRoleRequest): Promise<ApiRoleUsage>;
}

/* factory:BEH-011: a role that exhausted its budget is re-run like a missing handoff, with this note appended to its message. */
export function roleTimeoutNote(timeoutMs: number): string {
  return `\n\nYour previous run exceeded ${Math.round(timeoutMs / 60000)} minutes without a handoff; continue from the files on disk and write the handoff first.`;
}

export function isRoleTimeout(error: unknown): error is ApiRoleTimeoutError {
  return error instanceof ApiRoleTimeoutError;
}

export class ApiRoleTimeoutError extends Error {
  override readonly name = "ApiRoleTimeoutError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tokenUsageOf(payload: unknown): { readonly input: number; readonly output: number } | null {
  if (!isRecord(payload) || !isRecord(payload["tokenUsage"])) {
    return null;
  }
  const usage = payload["tokenUsage"];
  const input = usage["inputTokens"];
  const output = usage["outputTokens"];
  return typeof input === "number" && typeof output === "number" ? { input, output } : null;
}

function answerTextOf(payload: unknown): string {
  if (!isRecord(payload) || !isRecord(payload["answer"])) {
    return "";
  }
  const content = payload["answer"]["content"];
  return isRecord(content) && typeof content["text"] === "string" ? content["text"] : "";
}

export function createApiRoleRunner(runtime: FactoryRuntime, pricing: Readonly<Record<string, ModelPricing>>, effortByRole: Readonly<Record<string, string>> = {}): ApiRoleRunner {
  return {
    run(request: ApiRoleRequest): Promise<ApiRoleUsage> {
      return new Promise((resolvePromise, rejectPromise) => {
        const startedAt = Date.now();
        let inputTokens = 0;
        let outputTokens = 0;
        let inferenceCount = 0;
        const capabilities = request.taskId === undefined ? ["inference"] : ["inference", `${TASK_CAPABILITY_PREFIX}${request.taskId}`];
        const tools = request.toolTracePath === undefined ? [...request.tools] : tracedTools(request.tools, request.toolTracePath);
        const agent = createAgent({ name: request.role, capabilities, instruction: request.instruction, tools, handlers: [] });
        const agentId = agent.getId();
        const observer = createRuntimeObserver(`${request.role}-observer`, (event: SemanticEvent) => {
          if (event.producerId !== agentId) {
            return;
          }
          if (event.type === "inference.completed") {
            inferenceCount += 1;
            const usage = tokenUsageOf(event.payload);
            if (usage !== null) {
              inputTokens += usage.input;
              outputTokens += usage.output;
            }
          }
          if (event.type === "model.answer") {
            finish({ answer: answerTextOf(event.payload) });
          }
        });
        let finished = false;
        const timer = setTimeout(() => {
          finish({ error: new ApiRoleTimeoutError(`${request.role} exceeded ${request.timeoutMs} ms`) });
        }, request.timeoutMs);
        const finish = (outcome: { readonly answer: string } | { readonly error: Error }): void => {
          if (finished) {
            return;
          }
          finished = true;
          clearTimeout(timer);
          /* The loop still publishes under the agent's id after model.answer; leaving inside the delivery breaks that publication. */
          setImmediate(() => {
            runtime.leave(observer);
            runtime.mozaik.leave(agent);
          });
          if ("error" in outcome) {
            rejectPromise(outcome.error);
            return;
          }
          const usage: ApiRoleUsage = {
            model: request.model,
            inputTokens,
            outputTokens,
            costUsd: costOf(pricing, request.model, { inputTokens, outputTokens }),
            inferenceCount,
            durationMs: Date.now() - startedAt,
            answer: outcome.answer,
          };
          if (request.toolTracePath === undefined) {
            resolvePromise(usage);
            return;
          }
          void keepAnswer(request.toolTracePath, outcome.answer).then(() => resolvePromise(usage));
        };
        runtime.join(observer);
        runtime.mozaik.join(agent);
        try {
          const reasoningEffort = effortByRole[request.role];
          runtime.mozaik.runLoop(agentId, request.message, {
            model: request.model,
            maxOutputTokens: request.maxOutputTokens,
            context: agent.getMemory().getContext(),
            tools,
            ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
          });
        } catch (error) {
          finish({ error: error instanceof Error ? error : new Error(String(error)) });
        }
      });
    },
  };
}
