import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { renderTemplate } from "../../prompts.js";
import { fixerInstructionVariables, fixerMessage } from "./fixer-prompt.js";

const INPUT = {
  directory: "/runs/r1/worktrees/T-001",
  unit: "T-001",
  owner: "implementer",
  trigger: "green_typecheck",
  attempt: 1,
  cap: 2,
  scope: { allowed: ["src/greet/**"], forbidden: ["tests/**"] },
  formatOnlyPaths: [],
  failureOutput: "src/greet/index.ts(3,10): error TS2304: Cannot find name 'format'.\n```\nfenced in output\n```",
} as const;

describe("simple-fixer prompt", () => {
  // @covers factory:BEH-012
  it("carries the failing output verbatim inside a fence longer than any fence it contains", () => {
    expect(fixerMessage(INPUT)).toContain("````text\nsrc/greet/index.ts(3,10): error TS2304: Cannot find name 'format'.\n```\nfenced in output\n```\n````");
  });

  // @covers factory:BEH-012
  it("renders the instruction file with the allowed paths, forbidden paths and no unresolved placeholder", async () => {
    const template = await readFile(new URL("../../../../prompts/simple-fixer.md", import.meta.url), "utf8");

    const instruction = renderTemplate(template, fixerInstructionVariables(INPUT));

    expect([instruction.includes("- `src/greet/**`"), instruction.includes("- `tests/**`"), instruction.includes("This is run 1 of at most 2")]).toEqual([true, true, true]);
  });

  it("states the format-only rule for each listed file", () => {
    const variables = fixerInstructionVariables({ ...INPUT, trigger: "spec_yaml_invalid", formatOnlyPaths: ["spec/spec.md"] });

    expect(variables["format_only"]).toContain("`spec/spec.md`");
  });
});
