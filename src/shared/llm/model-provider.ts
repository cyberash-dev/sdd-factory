import { OpenAIChatCompletions, OpenAIResponses, supportedModels, type InferenceRunnerConfig } from "@mozaik-ai/core";

type GenerativeModel = NonNullable<InferenceRunnerConfig["supportedModels"]>[number];

export const PROVIDER_KEY_VARIABLES: Readonly<Record<string, string>> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

interface DerivedModel {
  readonly sibling: string;
  readonly efforts?: readonly string[];
}

/* factory:ASM-005: ids missing from the Mozaik bundle take the specification of their closest listed sibling. */
const OPENAI_SIBLINGS: Readonly<Record<string, DerivedModel>> = {
  "gpt-6.1-terra": { sibling: "gpt-6.1-sol" },
};

/* factory:EXT-006: OpenRouter ids keep the vendor prefix; GLM-5.3 exposes only low, high and max effort. */
const OPENROUTER_SIBLINGS: Readonly<Record<string, DerivedModel>> = {
  "deepseek/deepseek-v4.1-flash-1017": { sibling: "deepseek-flash" },
  "z-ai/glm-5.3-flash": { sibling: "deepseek-flash", efforts: ["max", "high", "low"] },
  /* OpenRouter routes the :nitro variant to the highest-throughput provider (provider.sort throughput). */
  "z-ai/glm-5.3-flash:nitro": { sibling: "deepseek-flash", efforts: ["max", "high", "low"] },
  "anthropic/claude-opus-5.5": { sibling: "claude-opus-5-5" },
  "openai/gpt-6.1-terra": { sibling: "gpt-6.1-sol" },
  "openai/gpt-6-luna": { sibling: "gpt-6-luna" },
};

function bundledSpecification(name: string, siblingName: string): GenerativeModel["specification"] {
  const sibling = supportedModels.find((model) => model.specification.name === siblingName);
  if (sibling === undefined) {
    throw new Error(`model registry: sibling ${siblingName} of ${name} is missing from the Mozaik bundle`);
  }
  return sibling.specification;
}

function derivedModels(entries: Readonly<Record<string, DerivedModel>>, provider: string | null, endpoint: () => GenerativeModel["endpoint"]): GenerativeModel[] {
  return Object.entries(entries).map(([name, derived]) => {
    const base = bundledSpecification(name, derived.sibling);
    return {
      endpoint: endpoint(),
      specification: {
        ...base,
        name,
        provider: provider ?? base.provider,
        supportedReasoningEfforts: [...(derived.efforts ?? base.supportedReasoningEfforts)],
      },
    };
  });
}

export const FACTORY_MODELS: readonly GenerativeModel[] = [
  ...supportedModels,
  ...derivedModels(OPENAI_SIBLINGS, null, () => new OpenAIResponses()),
  ...derivedModels(OPENROUTER_SIBLINGS, "openrouter", () => new OpenAIChatCompletions(undefined, { baseURL: OPENROUTER_BASE_URL, apiKey: process.env["OPENROUTER_API_KEY"] ?? "" })),
];

export function providerOf(modelId: string): string | null {
  const model = FACTORY_MODELS.find((candidate) => candidate.specification.name === modelId);
  return model === undefined ? null : model.specification.provider;
}
