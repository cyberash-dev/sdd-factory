import { describe, expect, it } from "vitest";
import { FACTORY_MODELS, providerOf } from "./model-provider.js";

describe("factory model registry", () => {
  // @covers factory:ASM-005
  it("registers gpt-6.1-terra on the OpenAI provider with the gpt-6.1-sol specification", () => {
    const terra = FACTORY_MODELS.find((model) => model.specification.name === "gpt-6.1-terra");

    expect([providerOf("gpt-6.1-terra"), terra?.specification.provider, terra?.specification.maxOutputTokens, terra?.specification.supportsFunctionCalling]).toEqual(["openai", "openai", 128000, true]);
  });

  it("keeps every bundled Mozaik model and answers null for an unknown id", () => {
    expect([providerOf("claude-opus-5-5"), providerOf("gpt-6-luna"), providerOf("deepseek-flash"), providerOf("gpt-99")]).toEqual(["anthropic", "openai", "deepseek", null]);
  });
});
