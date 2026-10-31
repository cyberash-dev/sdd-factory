import { ModelMessageItem, type InferenceInput, type InferenceOutput, type InferenceRunner, type SemanticEvent } from "@mozaik-ai/core";

export type InferenceRetryDelay = (ms: number) => Promise<void>;

const INFERENCE_ERROR_RETRY_DELAYS_MS: readonly number[] = [5000, 15000];

const EMPTY_INFERENCE_ANSWER = "the model returned neither a tool call nor a message";

function holdsToolCallOrMessage(output: InferenceOutput): boolean {
  return output.items.some((item) => item.type === "function_call" || (item.type === "message" && item.role === "assistant"));
}

function answerOutput(text: string): InferenceOutput {
  return { items: [ModelMessageItem.rehydrate({ text })], tokenUsage: undefined, rowResponse: null };
}

/* factory:DLT-013: Mozaik's runLoop drops its loop promise, so an inference that throws or yields nothing actionable must end the loop as an answer. */
export function createResilientInferenceRunner(inner: InferenceRunner, retryDelay: InferenceRetryDelay): InferenceRunner {
  return {
    async run(input: InferenceInput): Promise<InferenceOutput> {
      let errorRetries = 0;
      let isEmptyRetried = false;
      for (;;) {
        let output: InferenceOutput;
        try {
          output = await inner.run(input);
        } catch (error) {
          const delayMs = INFERENCE_ERROR_RETRY_DELAYS_MS[errorRetries];
          if (delayMs === undefined) {
            return answerOutput(`inference failed: ${error instanceof Error ? error.message : String(error)}`);
          }
          errorRetries += 1;
          await retryDelay(delayMs);
          continue;
        }
        if (holdsToolCallOrMessage(output)) {
          return output;
        }
        if (isEmptyRetried) {
          return answerOutput(EMPTY_INFERENCE_ANSWER);
        }
        isEmptyRetried = true;
      }
    },
    stream(input: InferenceInput): AsyncGenerator<SemanticEvent> {
      return inner.stream(input);
    },
  };
}
