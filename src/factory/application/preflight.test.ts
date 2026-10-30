import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../shared/config.js";
import { preflight, PreflightError } from "./preflight.js";

const PRESENT = new Set(["specs/todo-cli.md", "/usr/bin/claude", "/usr/bin/git"]);

function input(overrides: Partial<Parameters<typeof preflight>[0]> = {}): Parameters<typeof preflight>[0] {
  return {
    specPath: "specs/todo-cli.md",
    operatorFlag: "cyberash",
    env: { PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk-test" },
    models: DEFAULT_CONFIG.models,
    nodeMajor: 26,
    fileExists: async (path) => PRESENT.has(path),
    ...overrides,
  };
}

async function failure(overrides: Partial<Parameters<typeof preflight>[0]>): Promise<string> {
  try {
    await preflight(input(overrides));
  } catch (error) {
    if (error instanceof PreflightError) {
      return `${error.exitCode} ${error.message}`;
    }
    throw error;
  }
  return "no error";
}

describe("preflight", () => {
  // @covers factory:BEH-001
  it("resolves the slug and operator when every precondition holds", async () => {
    expect(await preflight(input())).toEqual({ slug: "todo-cli", operator: "cyberash" });
  });

  it.each([
    ["missing spec", { specPath: "specs/missing.md" }, "2 spec file not readable: specs/missing.md"],
    ["blocklisted operator", { operatorFlag: "claude" }, '2 operator "claude" is an agent identity and cannot pre-authorise approvals'],
    ["no operator", { operatorFlag: null, env: { PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk" } }, "2 operator identity is required: pass --operator <identity> or set FACTORY_OPERATOR"],
    ["old node", { nodeMajor: 20 }, "3 node >= 22 required, running 20"],
    ["no api key", { env: { PATH: "/usr/bin" } }, "3 ANTHROPIC_API_KEY is not set"],
    ["no openai key for an openai reviewer model", { models: { ...DEFAULT_CONFIG.models, reviewer: "gpt-6.1-sol" } }, "3 OPENAI_API_KEY is not set"],
    ["unknown model id", { models: { ...DEFAULT_CONFIG.models, critic: "gpt-99" } }, "2 unknown model gpt-99: not in the Mozaik supported model list"],
    ["no openai key for the registered gpt-6.1-terra", { models: { ...DEFAULT_CONFIG.models, critic: "gpt-6.1-terra" } }, "3 OPENAI_API_KEY is not set"],
    ["no openrouter key for an OpenRouter model", { models: { ...DEFAULT_CONFIG.models, default: "deepseek/deepseek-v4.1-flash-1017" } }, "3 OPENROUTER_API_KEY is not set"],
    ["provider without a key mapping", { models: { ...DEFAULT_CONFIG.models, triage: "gemini-3.5-flash" } }, "2 model gemini-3.5-flash routes to provider google, which has no API key mapping"],
    ["claude missing", { env: { PATH: "/opt/none", ANTHROPIC_API_KEY: "sk" } }, "3 claude not found on PATH"],
  ])("fails %s with the documented exit code", async (_label, overrides, expected) => {
    expect(await failure(overrides)).toBe(expected);
  });

  // @covers factory:DLT-002
  it("requires the key of every provider in use and accepts a mixed model set once both keys are present", async () => {
    const mixed = { ...DEFAULT_CONFIG.models, reviewer: "gpt-6.1-sol" };

    expect(await preflight(input({ models: mixed, env: { PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk-test", OPENAI_API_KEY: "sk-openai" } }))).toEqual({ slug: "todo-cli", operator: "cyberash" });
  });

  // @covers factory:DLT-003
  // @covers factory:EXT-006
  it("needs only OPENROUTER_API_KEY when every role routes through OpenRouter", async () => {
    const openRouterOnly = { ...DEFAULT_CONFIG.models, default: "deepseek/deepseek-v4.1-flash-1017", critic: "z-ai/glm-5.3-flash", triage: "deepseek/deepseek-v4.1-flash-1017", reviewer: "z-ai/glm-5.3-flash" };

    expect(await preflight(input({ models: openRouterOnly, env: { PATH: "/usr/bin", OPENROUTER_API_KEY: "sk-or-test" } }))).toEqual({ slug: "todo-cli", operator: "cyberash" });
  });

  it("takes the operator from FACTORY_OPERATOR when the flag is absent", async () => {
    expect(await preflight(input({ operatorFlag: null, env: { PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk", FACTORY_OPERATOR: "alice" } }))).toEqual({ slug: "todo-cli", operator: "alice" });
  });
});
