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

export function createApiRoleRunner(runtime: FactoryRuntime, pricing: Readonly<Record<string, ModelPricing>>): ApiRoleRunner {
  return {
    run(request: ApiRoleRequest): Promise<ApiRoleUsage> {
      return new Promise((resolvePromise, rejectPromise) => {
        const startedAt = Date.now();
        let inputTokens = 0;
        let outputTokens = 0;
        let inferenceCount = 0;
        const capabilities = request.taskId === undefined ? ["inference"] : ["inference", `${TASK_CAPABILITY_PREFIX}${request.taskId}`];
        const agent = createAgent({ name: request.role, capabilities, instruction: request.instruction, tools: [...request.tools], handlers: [] });
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
          resolvePromise({
            model: request.model,
            inputTokens,
            outputTokens,
            costUsd: costOf(pricing, request.model, { inputTokens, outputTokens }),
            inferenceCount,
            durationMs: Date.now() - startedAt,
            answer: outcome.answer,
          });
        };
        runtime.join(observer);
        runtime.mozaik.join(agent);
        try {
          runtime.mozaik.runLoop(agentId, request.message, {
            model: request.model,
            maxOutputTokens: request.maxOutputTokens,
            context: agent.getMemory().getContext(),
            tools: [...request.tools],
          });
        } catch (error) {
          finish({ error: error instanceof Error ? error : new Error(String(error)) });
        }
      });
    },
  };
}
