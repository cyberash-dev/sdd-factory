import { supportedModels } from "@mozaik-ai/core";

export const PROVIDER_KEY_VARIABLES: Readonly<Record<string, string>> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

export function providerOf(modelId: string): string | null {
  const model = supportedModels.find((candidate) => candidate.specification.name === modelId);
  return model === undefined ? null : model.specification.provider;
}
