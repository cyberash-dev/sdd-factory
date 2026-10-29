import { describe, expect, it } from "vitest";
import { preflight, PreflightError } from "./preflight.js";

const PRESENT = new Set(["specs/todo-cli.md", "/usr/bin/claude", "/usr/bin/git"]);

function input(overrides: Partial<Parameters<typeof preflight>[0]> = {}): Parameters<typeof preflight>[0] {
  return {
    specPath: "specs/todo-cli.md",
    operatorFlag: "cyberash",
    env: { PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk-test" },
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
    ["claude missing", { env: { PATH: "/opt/none", ANTHROPIC_API_KEY: "sk" } }, "3 claude not found on PATH"],
  ])("fails %s with the documented exit code", async (_label, overrides, expected) => {
    expect(await failure(overrides)).toBe(expected);
  });

  it("takes the operator from FACTORY_OPERATOR when the flag is absent", async () => {
    expect(await preflight(input({ operatorFlag: null, env: { PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk", FACTORY_OPERATOR: "alice" } }))).toEqual({ slug: "todo-cli", operator: "alice" });
  });
});
