import { describe, expect, it } from "vitest";
import { firewallViolations } from "../../src/build-stage/domain/context-firewall.js";

const WORKTREE = "/run/worktrees/T-001";
const STUBS = ["src/greet.ts"];

describe("test-writer context firewall", () => {
  // @covers build-stage:INV-003
  it("reports zero violations for a transcript that reads only tests, spec and the named stub", () => {
    const toolUses = [
      { name: "Read", input: { file_path: `${WORKTREE}/spec/spec.md` } },
      { name: "Read", input: { file_path: `${WORKTREE}/src/greet.ts` } },
      { name: "Glob", input: { pattern: "tests/**/*.test.ts" } },
      { name: "Bash", input: { command: "npx vitest run" } },
    ];

    expect(firewallViolations(toolUses, WORKTREE, STUBS)).toEqual([]);
  });

  it.each([
    ["an absolute Read under src/", { name: "Read", input: { file_path: `${WORKTREE}/src/index.ts` } }, "Read:src/index.ts"],
    ["a relative Read under src/", { name: "Read", input: { file_path: "src/index.ts" } }, "Read:src/index.ts"],
    ["a Grep rooted at src/", { name: "Grep", input: { pattern: "greet", path: "src" } }, "Grep:src"],
    ["a Glob pattern under src/", { name: "Glob", input: { pattern: "src/**/*.ts" } }, "Glob:src/**/*.ts"],
    ["a Bash cat of a source file", { name: "Bash", input: { command: "cat ./src/cli/main.ts | head" } }, "Bash:src/cli/main.ts"],
    ["a Write under src/", { name: "Write", input: { file_path: "src/greet.ts", content: "x" } }, null],
  ])("reports %s", (_label, toolUse, violation) => {
    const violations = firewallViolations([toolUse], WORKTREE, STUBS);

    expect(violations).toEqual(violation === null ? [] : [violation]);
  });

  it("lists each distinct violation once", () => {
    const toolUses = [
      { name: "Read", input: { file_path: "src/a.ts" } },
      { name: "Read", input: { file_path: "src/a.ts" } },
      { name: "Bash", input: { command: "grep -r x src/" } },
    ];

    expect(firewallViolations(toolUses, WORKTREE, STUBS)).toEqual(["Read:src/a.ts", "Bash:src"]);
  });
});
