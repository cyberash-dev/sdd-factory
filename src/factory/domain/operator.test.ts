import { describe, expect, it } from "vitest";
import { resolveOperator } from "./operator.js";

describe("operator identity", () => {
  // @covers factory:POL-001
  it.each(["claude", "Codex", "bot:ci", "pipeline-driver", "sdd-cli"])("refuses the agent identity %s", (identity) => {
    expect(() => resolveOperator(identity, undefined)).toThrow(`operator "${identity}" is an agent identity`);
  });

  it("prefers the flag over the environment variable", () => {
    expect(resolveOperator("alice", "bob")).toBe("alice");
  });

  it("falls back to FACTORY_OPERATOR", () => {
    expect(resolveOperator(null, "bob")).toBe("bob");
  });

  it("requires an explicit identity", () => {
    expect(() => resolveOperator(null, undefined)).toThrow("operator identity is required");
  });
});
