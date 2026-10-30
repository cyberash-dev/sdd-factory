import { OpenAIResponses, supportedModels, type InferenceRunnerConfig } from "@mozaik-ai/core";

type GenerativeModel = NonNullable<InferenceRunnerConfig["supportedModels"]>[number];

export const PROVIDER_KEY_VARIABLES: Readonly<Record<string, string>> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

/* factory:ASM-005: ids missing from the Mozaik bundle take the specification of their closest listed sibling. */
const OPENAI_SIBLINGS: Readonly<Record<string, string>> = {
  "gpt-6.1-terra": "gpt-6.1-sol",
};

function derivedOpenAiModel(name: string, siblingName: string): GenerativeModel {
  const sibling = supportedModels.find((model) => model.specification.name === siblingName);
  if (sibling === undefined) {
    throw new Error(`model registry: sibling ${siblingName} of ${name} is missing from the Mozaik bundle`);
  }
  return { endpoint: new OpenAIResponses(), specification: { ...sibling.specification, name } };
}

export const FACTORY_MODELS: readonly GenerativeModel[] = [...supportedModels, ...Object.entries(OPENAI_SIBLINGS).map(([name, sibling]) => derivedOpenAiModel(name, sibling))];

export function providerOf(modelId: string): string | null {
  const model = FACTORY_MODELS.find((candidate) => candidate.specification.name === modelId);
  return model === undefined ? null : model.specification.provider;
}
