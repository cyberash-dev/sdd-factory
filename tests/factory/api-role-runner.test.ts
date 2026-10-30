import { FunctionCallItem, InputTokenDetails, ModelMessageItem, OutputTokenDetails, TokenUsage, type InferenceInput, type InferenceOutput, type InferenceRunner, type SemanticEvent, type Tool } from "@mozaik-ai/core";
import { describe, expect, it } from "vitest";
import { createFactoryRuntime, createRuntimeObserver } from "../../src/bus/adapters/mozaik/runtime.js";
import { ApiRoleTimeoutError, createApiRoleRunner } from "../../src/shared/llm/api-role-runner.js";

const RUN_ID = "todo-cli-20261029-120000";

function usage(input: number, output: number): TokenUsage {
  return new TokenUsage(input, output, input + output, new InputTokenDetails(0), new OutputTokenDetails(0));
}

function scriptedRunner(steps: readonly InferenceOutput[]): InferenceRunner {
  let index = 0;
  return {
    async run(): Promise<InferenceOutput> {
      const step = steps[index];
      index += 1;
      if (step === undefined) {
        throw new Error("provider_error:429");
      }
      return step;
    },
    async *stream(): AsyncGenerator<SemanticEvent> {
      yield* [];
    },
  };
}

function echoTool(calls: string[]): Tool {
  return {
    type: "function",
    name: "write_file",
    description: "record",
    strict: false,
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
    invoke: async (args: { path: string }) => {
      calls.push(args.path);
      return "written";
    },
  };
}

describe("API role runner on the Mozaik loop", () => {
  // @covers factory:EXT-001
  it("runs the tool call, sums token usage over inferences and resolves with the final answer", async () => {
    const runtime = createFactoryRuntime(RUN_ID, {
      inferenceRunner: scriptedRunner([
        { items: [FunctionCallItem.rehydrate({ callId: "c1", name: "write_file", args: JSON.stringify({ path: "spec/spec.md" }) })], tokenUsage: usage(100, 20), rowResponse: null },
        { items: [ModelMessageItem.rehydrate({ text: "handoff written" })], tokenUsage: usage(50, 10), rowResponse: null },
      ]),
    });
    const calls: string[] = [];

    const result = await createApiRoleRunner(runtime, { m: { inputPerMillion: 10, outputPerMillion: 100 } }).run({
      role: "spec-analyst",
      instruction: "You are the analyst.",
      message: "Draft the spec.",
      model: "m",
      tools: [echoTool(calls)],
      timeoutMs: 5000,
      maxOutputTokens: 1000,
    });

    expect([calls, result.inputTokens, result.outputTokens, result.inferenceCount, result.costUsd, result.answer]).toEqual([["spec/spec.md"], 150, 30, 2, 0.0045, "handoff written"]);
  });

  // @covers factory:EXT-001
  it("keeps the agent joined while the loop is still publishing its final answer", async () => {
    const runtime = createFactoryRuntime(RUN_ID, { inferenceRunner: scriptedRunner([{ items: [ModelMessageItem.rehydrate({ text: "ok" })], tokenUsage: usage(1, 1), rowResponse: null }]) });
    const joinedAtAnswer: boolean[] = [];
    const pending = createApiRoleRunner(runtime, {}).run({ role: "planner", instruction: "p", message: "m", model: "m", tools: [], timeoutMs: 5000, maxOutputTokens: 100 });
    runtime.join(createRuntimeObserver("late-probe", (event) => (event.type === "model.answer" ? joinedAtAnswer.push(runtime.state.getParticipant(event.producerId) !== undefined) : undefined)));

    await pending;

    expect(joinedAtAnswer).toEqual([true]);
  });

  // @covers factory:ASM-005
  it("passes the configured reasoning effort of the role to the loop and none for an unconfigured role", async () => {
    const efforts: Array<string | undefined> = [];
    const runner: InferenceRunner = {
      async run(input: InferenceInput): Promise<InferenceOutput> {
        efforts.push(input.reasoningEffort);
        return { items: [ModelMessageItem.rehydrate({ text: "ok" })], tokenUsage: usage(1, 1), rowResponse: null };
      },
      async *stream(): AsyncGenerator<SemanticEvent> {
        yield* [];
      },
    };
    const runtime = createFactoryRuntime(RUN_ID, { inferenceRunner: runner });
    const apiRoles = createApiRoleRunner(runtime, {}, { planner: "high" });

    await apiRoles.run({ role: "planner", instruction: "p", message: "m", model: "m", tools: [], timeoutMs: 5000, maxOutputTokens: 100 });
    await apiRoles.run({ role: "triage", instruction: "t", message: "m", model: "m", tools: [], timeoutMs: 5000, maxOutputTokens: 100 });

    expect(efforts).toEqual(["high", undefined]);
  });

  it("records cost null when the provider returns no usage", async () => {
    const runtime = createFactoryRuntime(RUN_ID, {
      inferenceRunner: scriptedRunner([{ items: [ModelMessageItem.rehydrate({ text: "ok" })], tokenUsage: undefined, rowResponse: null }]),
    });

    const result = await createApiRoleRunner(runtime, {}).run({ role: "spec-critic", instruction: "critic", message: "review", model: "m", tools: [], timeoutMs: 5000, maxOutputTokens: 100 });

    expect([result.inputTokens, result.costUsd, result.answer]).toEqual([0, null, "ok"]);
  });

  it("rejects with a timeout error when the loop never answers", async () => {
    const runtime = createFactoryRuntime(RUN_ID, { inferenceRunner: { run: () => new Promise(() => undefined), stream: async function* () { yield* []; } } });

    await expect(createApiRoleRunner(runtime, {}).run({ role: "planner", instruction: "p", message: "m", model: "m", tools: [], timeoutMs: 50, maxOutputTokens: 100 })).rejects.toBeInstanceOf(ApiRoleTimeoutError);
  });

  it("leaves the agent and its observer once the answer arrived and the loop finished publishing", async () => {
    const runtime = createFactoryRuntime(RUN_ID, { inferenceRunner: scriptedRunner([{ items: [ModelMessageItem.rehydrate({ text: "ok" })], tokenUsage: undefined, rowResponse: null }]) });
    const before = runtime.state.getParticipants().length;

    await createApiRoleRunner(runtime, {}).run({ role: "architect", instruction: "a", message: "m", model: "m", tools: [], timeoutMs: 5000, maxOutputTokens: 100 });
    await new Promise((resolve) => setImmediate(resolve));

    expect(runtime.state.getParticipants().length).toBe(before);
  });
});

export type { InferenceInput };
