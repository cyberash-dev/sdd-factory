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

describe("test-writer context firewall: field-aware scan", () => {
  // @covers build-stage:INV-003
  it("ignores a heredoc body that imports from src/ while writing a test file", () => {
    const command = [
      "mkdir -p tests/listing && cat > tests/listing/listing.test.ts <<'EOF'",
      'import { mkdtempSync, writeFileSync, existsSync } from "node:fs";',
      'import { describe, expect, it } from "vitest";',
      'import { listTasks } from "../../src/listing/index.js";',
      "",
      'describe("listTasks", () => {',
      '  it("lists", () => expect(listTasks).toBeDefined());',
      "});",
      "EOF",
      "npx tsc --noEmit; npx vitest run 2>&1 | tail -40",
    ].join("\n");

    expect(firewallViolations([{ name: "Bash", input: { command } }], WORKTREE, STUBS)).toEqual([]);
  });

  // @covers build-stage:INV-003
  it("ignores a heredoc body whose prose mentions src/ while writing the handoff", () => {
    const command = [
      "cat > /run/handoffs/T-004/test-writer-2/handoff.md <<'EOF'",
      "---",
      "role: test-writer",
      "---",
      "- attempt 2: re-authored from scratch with no read under src/.",
      "EOF",
    ].join("\n");

    expect(firewallViolations([{ name: "Bash", input: { command } }], WORKTREE, STUBS)).toEqual([]);
  });

  // @covers build-stage:INV-003
  it.each([
    ["a double-quoted terminator", 'cat > tests/a.test.ts <<"END"\nno read under src/.\nEND'],
    ["a dash terminator", "cat > tests/a.test.ts <<-END\n\tno read under src/.\n\tEND"],
    ["an unquoted terminator", "cat > tests/a.test.ts << END\nno read under src/.\nEND"],
  ])("ignores a heredoc body with %s", (_label, command) => {
    expect(firewallViolations([{ name: "Bash", input: { command } }], WORKTREE, STUBS)).toEqual([]);
  });

  // @covers build-stage:INV-003
  it("reports a src/ read in the command that follows a heredoc", () => {
    const command = "cat > tests/a.test.ts <<'EOF'\nno read under src/.\nEOF\ncat src/listing/index.ts";

    expect(firewallViolations([{ name: "Bash", input: { command } }], WORKTREE, STUBS)).toEqual(["Bash:src/listing/index.ts"]);
  });

  // @covers build-stage:INV-003
  it("reports src/ paths with a trailing separator glued to them", () => {
    const toolUses = [{ name: "Bash", input: { command: "cat src/listing/index.ts; ls src" } }];

    expect(firewallViolations(toolUses, WORKTREE, STUBS)).toEqual(["Bash:src/listing/index.ts", "Bash:src"]);
  });

  // @covers build-stage:INV-003
  it("reports a src/ path piped without a space", () => {
    const toolUses = [{ name: "Bash", input: { command: "cat src/a.ts|head" } }];

    expect(firewallViolations(toolUses, WORKTREE, STUBS)).toEqual(["Bash:src/a.ts"]);
  });

  // @covers build-stage:INV-003
  it("ignores an echoed string redirected into a test file", () => {
    const toolUses = [{ name: "Bash", input: { command: "echo \"src/x.ts\" > tests/x.txt" } }];

    expect(firewallViolations(toolUses, WORKTREE, STUBS)).toEqual([]);
  });

  // @covers build-stage:INV-003
  it.each([
    ["Write content", { name: "Write", input: { file_path: "tests/a.test.ts", content: "see src/a.ts" } }],
    ["Edit strings", { name: "Edit", input: { file_path: "tests/a.test.ts", old_string: "src/a.ts", new_string: "src/b.ts" } }],
    ["a Grep regex", { name: "Grep", input: { pattern: "src/", path: "tests" } }],
  ])("ignores src/ text in %s", (_label, toolUse) => {
    expect(firewallViolations([toolUse], WORKTREE, STUBS)).toEqual([]);
  });

  // @covers build-stage:INV-003
  it.each([
    ["a Read file_path", { name: "Read", input: { file_path: "src/listing/index.ts" } }, "Read:src/listing/index.ts"],
    ["a NotebookEdit notebook_path", { name: "NotebookEdit", input: { notebook_path: "src/n.ipynb", new_source: "" } }, "NotebookEdit:src/n.ipynb"],
    ["a factory read_file path", { name: "read_file", input: { path: "src/a.ts" } }, "read_file:src/a.ts"],
    ["a factory list_dir path", { name: "list_dir", input: { path: "src" } }, "list_dir:src"],
  ])("reports %s under src/", (_label, toolUse, violation) => {
    expect(firewallViolations([toolUse], WORKTREE, STUBS)).toEqual([violation]);
  });
});
