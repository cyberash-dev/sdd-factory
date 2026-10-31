import { FunctionCallItem, InputTokenDetails, ModelMessageItem, OutputTokenDetails, TokenUsage, type InferenceOutput, type InferenceRunner, type SemanticEvent, type Tool } from "@mozaik-ai/core";
import { describe, expect, it } from "vitest";
import { createFactoryRuntime } from "../../src/bus/adapters/mozaik/runtime.js";
import { createApiRoleRunner, type ApiRoleRequest } from "../../src/shared/llm/api-role-runner.js";

const RUN_ID = "todo-cli-20261031-120000";

type InferenceStep = InferenceOutput | Error;

interface CountedRunner {
  readonly runner: InferenceRunner;
  readonly callCount: () => number;
}

function usage(input: number, output: number): TokenUsage {
  return new TokenUsage(input, output, input + output, new InputTokenDetails(0), new OutputTokenDetails(0));
}

function message(text: string): InferenceOutput {
  return { items: [ModelMessageItem.rehydrate({ text })], tokenUsage: usage(10, 2), rowResponse: null };
}

function emptyOutput(): InferenceOutput {
  return { items: [], tokenUsage: usage(10, 0), rowResponse: null };
}

/* Past the script the last step repeats, so "every call" cases stay bounded by the runner under test, not by the script. */
function scriptedRunner(steps: readonly InferenceStep[]): CountedRunner {
  let calls = 0;
  return {
    runner: {
      async run(): Promise<InferenceOutput> {
        const step = steps[Math.min(calls, steps.length - 1)];
        calls += 1;
        if (step === undefined) {
          throw new Error("empty script");
        }
        if (step instanceof Error) {
          throw step;
        }
        return step;
      },
      async *stream(): AsyncGenerator<SemanticEvent> {
        yield* [];
      },
    },
    callCount: () => calls,
  };
}

function writeFileTool(paths: string[]): Tool {
  return {
    type: "function",
    name: "write_file",
    description: "record",
    strict: false,
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
    invoke: async (args: { path: string }) => {
      paths.push(args.path);
      return "written";
    },
  };
}

function reviewerRequest(tools: readonly Tool[] = []): ApiRoleRequest {
  return { role: "reviewer", instruction: "You are the reviewer.", message: "Review the task.", model: "m", tools, timeoutMs: 5000, maxOutputTokens: 100 };
}

const noDelay = async (): Promise<void> => undefined;

describe("factory inference runner under an API role", () => {
  // @covers factory:DLT-013
  // @covers factory:BEH-011
  it("resolves with the message of the retry after a provider error on the first inference", async () => {
    const inner = scriptedRunner([new Error("provider_error:503"), message("handoff written")]);
    const runtime = createFactoryRuntime(RUN_ID, { inferenceRunner: inner.runner, inferenceRetryDelay: noDelay });

    const result = await createApiRoleRunner(runtime, {}).run(reviewerRequest());

    expect([result.answer, inner.callCount()]).toEqual(["handoff written", 2]);
  });

  // @covers factory:DLT-013
  it("waits 5 s before the first and 15 s before the second retry of a throwing inference", async () => {
    const inner = scriptedRunner([new Error("provider_error:503")]);
    const delays: number[] = [];
    const runtime = createFactoryRuntime(RUN_ID, {
      inferenceRunner: inner.runner,
      inferenceRetryDelay: async (ms: number): Promise<void> => {
        delays.push(ms);
      },
    });

    await createApiRoleRunner(runtime, {}).run(reviewerRequest());

    expect(delays).toEqual([5000, 15000]);
  });

  // @covers factory:DLT-013
  // @covers factory:BEH-011
  it("answers that the model returned neither a tool call nor a message after two empty inferences", async () => {
    const inner = scriptedRunner([emptyOutput()]);
    const runtime = createFactoryRuntime(RUN_ID, { inferenceRunner: inner.runner, inferenceRetryDelay: noDelay });

    const result = await createApiRoleRunner(runtime, {}).run(reviewerRequest());

    expect([result.answer, inner.callCount()]).toEqual(["the model returned neither a tool call nor a message", 2]);
  });

  // @covers factory:DLT-013
  // @covers factory:BEH-011
  it("emits no unhandled rejection when every inference is empty", async () => {
    const inner = scriptedRunner([emptyOutput()]);
    const runtime = createFactoryRuntime(RUN_ID, { inferenceRunner: inner.runner, inferenceRetryDelay: noDelay });
    const rejections: unknown[] = [];
    const recordRejection = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on("unhandledRejection", recordRejection);

    await createApiRoleRunner(runtime, {}).run(reviewerRequest());
    await new Promise((resolve) => setImmediate(resolve));
    process.off("unhandledRejection", recordRejection);

    expect(rejections).toEqual([]);
  });

  // @covers factory:DLT-013
  // @covers factory:BEH-011
  it("answers with the provider error after three throwing inferences", async () => {
    const inner = scriptedRunner([new Error("provider_error:503")]);
    const runtime = createFactoryRuntime(RUN_ID, { inferenceRunner: inner.runner, inferenceRetryDelay: noDelay });

    const result = await createApiRoleRunner(runtime, {}).run(reviewerRequest());

    expect([result.answer, inner.callCount()]).toEqual(["inference failed: provider_error:503", 3]);
  });

  // @covers factory:DLT-013
  it("answers with the error of Mozaik's default runner when the model is not in the factory registry", async () => {
    const runtime = createFactoryRuntime(RUN_ID, { inferenceRetryDelay: noDelay });

    const result = await createApiRoleRunner(runtime, {}).run({ ...reviewerRequest(), model: "unknown-model" });

    expect(result.answer).toBe("inference failed: Unsupported model: unknown-model");
  });

  // @covers factory:DLT-013
  it("calls a successful inference exactly once", async () => {
    const inner = scriptedRunner([message("all good")]);
    const runtime = createFactoryRuntime(RUN_ID, { inferenceRunner: inner.runner, inferenceRetryDelay: noDelay });

    await createApiRoleRunner(runtime, {}).run(reviewerRequest());

    expect(inner.callCount()).toBe(1);
  });

  // @covers factory:DLT-013
  it("passes a tool call through to the loop without retrying the inference", async () => {
    const inner = scriptedRunner([
      { items: [FunctionCallItem.rehydrate({ callId: "c1", name: "write_file", args: JSON.stringify({ path: "review.yaml" }) })], tokenUsage: usage(10, 2), rowResponse: null },
      message("handoff written"),
    ]);
    const runtime = createFactoryRuntime(RUN_ID, { inferenceRunner: inner.runner, inferenceRetryDelay: noDelay });
    const writtenPaths: string[] = [];

    await createApiRoleRunner(runtime, {}).run(reviewerRequest([writeFileTool(writtenPaths)]));

    expect([writtenPaths, inner.callCount()]).toEqual([["review.yaml"], 2]);
  });
});
