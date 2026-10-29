import { describe, expect, it } from "vitest";
import { parseInterfaceExports, parseTechMd, TechMdParseError, UnpinnedDependencyError } from "./tech-md.js";

function techMd(options: { readonly moduleTail?: string; readonly devDependencies?: string; readonly tooling?: string } = {}): string {
  const tooling =
    options.tooling ??
    [
      "```yaml",
      "TD-TOOLING:",
      '  node: "22"',
      '  test_cmd: "npx vitest run"',
      '  typecheck_cmd: "npx tsc --noEmit"',
      '  dependencies: ["yaml@2.9.1"]',
      `  dev_dependencies: ${options.devDependencies ?? '["typescript@7.0.2", "vitest@5.0.5"]'}`,
      "  tsconfig: { module: NodeNext, strict: true }",
      "```",
    ].join("\n");
  return [
    "# Technical design: todo-cli",
    "## 1. Overview",
    "A CLI.",
    "## 2. Module map",
    "### M-01 cli",
    "- responsibility: parse argv into a command",
    "- covers: [todo-cli:CTR-001, todo-cli:BEH-002]",
    "- owns: src/cli/**          (disjoint across modules)",
    "- entry: src/cli/index.ts   (public interface)",
    "- depends_on: [M-02]",
    "- public interface:",
    "  ```ts",
    "  export function parseArgs(argv: readonly string[]): ParsedCommand | CliError;",
    "  export interface ParsedCommand {",
    "    readonly name: string;",
    "  }",
    "  ```",
    "- notes: raises E_USAGE",
    "### M-02 store",
    "- responsibility: persist todos",
    "- covers: [todo-cli:CTR-002]",
    options.moduleTail ?? "- owns: [src/store/**, src/shared/paths.ts]\n- entry: src/store/index.ts",
    "- depends_on: []",
    "- public interface:",
    "  ```ts",
    "  export class Store {",
    "    load(): Todo[];",
    "  }",
    "  export const DEFAULT_PATH = 'todo.json';",
    "  export type Todo = { id: number };",
    "  ```",
    "- notes: none",
    "## 3. Data shapes",
    "none",
    "## 6. TD-TOOLING",
    tooling,
    "## 7. Design decisions",
    "### DD-01 exit codes",
    "- evidence: [todo-cli:POL-001]",
    "## 8. Traceability",
    "| spec id | module |",
    "|---|---|",
    "| todo-cli:CTR-001 | M-01 |",
    "| todo-cli:BEH-002 | M-01 |",
    "| todo-cli:CTR-002 | M-02 |",
    "## 9. Revisions",
    "none",
  ].join("\n");
}

describe("parseTechMd", () => {
  // @covers design-stage:CTR-001
  it("extracts module ids, covers, owns globs, entry and depends_on from the module map", () => {
    const design = parseTechMd(techMd());

    expect(design.modules.map((module) => [module.id, module.name, module.covers, module.owns, module.entry, module.dependsOn])).toEqual([
      ["M-01", "cli", ["todo-cli:CTR-001", "todo-cli:BEH-002"], ["src/cli/**"], "src/cli/index.ts", ["M-02"]],
      ["M-02", "store", ["todo-cli:CTR-002"], ["src/store/**", "src/shared/paths.ts"], "src/store/index.ts", []],
    ]);
  });

  it("keeps the interface fence verbatim and parses exported names with kind and signature", () => {
    const design = parseTechMd(techMd());

    expect(design.modules.map((module) => module.exports)).toEqual([
      [
        { name: "parseArgs", kind: "function", signature: "export function parseArgs(argv: readonly string[]): ParsedCommand | CliError;" },
        { name: "ParsedCommand", kind: "interface", signature: "export interface ParsedCommand {" },
      ],
      [
        { name: "Store", kind: "class", signature: "export class Store {" },
        { name: "DEFAULT_PATH", kind: "const", signature: "export const DEFAULT_PATH = 'todo.json';" },
        { name: "Todo", kind: "type", signature: "export type Todo = { id: number };" },
      ],
    ]);
  });

  it("dedents the interface source by the fence indentation", () => {
    const design = parseTechMd(techMd());

    expect(design.modules[0]?.interfaceSource).toBe("export function parseArgs(argv: readonly string[]): ParsedCommand | CliError;\nexport interface ParsedCommand {\n  readonly name: string;\n}");
  });

  // @covers design-stage:CTR-001
  it("extracts the TD-TOOLING block with pinned dependency strings and the tsconfig object", () => {
    const design = parseTechMd(techMd());

    expect(design.tooling).toEqual({
      node: "22",
      testCmd: "npx vitest run",
      typecheckCmd: "npx tsc --noEmit",
      dependencies: ["yaml@2.9.1"],
      devDependencies: ["typescript@7.0.2", "vitest@5.0.5"],
      tsconfig: { module: "NodeNext", strict: true },
    });
  });

  it("accepts {name, version} dependency objects and reports a missing tsconfig as null", () => {
    const tooling = ["```yaml", 'node: "22"', 'test_cmd: "npx vitest run"', 'typecheck_cmd: "npx tsc --noEmit"', "dependencies: []", "dev_dependencies:", "  - name: '@types/node'", "    version: 26.6.6", "```"].join("\n");

    const design = parseTechMd(techMd({ tooling }));

    expect([design.tooling.devDependencies, design.tooling.tsconfig]).toEqual([["@types/node@26.6.6"], null]);
  });

  it("reads the traceability table as spec id to module id rows", () => {
    const design = parseTechMd(techMd());

    expect(design.traceability).toEqual([
      { specId: "todo-cli:CTR-001", moduleId: "M-01" },
      { specId: "todo-cli:BEH-002", moduleId: "M-01" },
      { specId: "todo-cli:CTR-002", moduleId: "M-02" },
    ]);
  });

  // @covers design-stage:CTR-001
  it("rejects a module without an owns path naming the module", () => {
    const markdown = techMd({ moduleTail: "- entry: src/store/index.ts" });

    expect(() => parseTechMd(markdown)).toThrow(new TechMdParseError("module M-02 has no owns path"));
  });

  it("rejects a module without an entry path naming the module", () => {
    const markdown = techMd({ moduleTail: "- owns: src/store/**" });

    expect(() => parseTechMd(markdown)).toThrow(new TechMdParseError("module M-02 has no entry path"));
  });

  // @covers design-stage:CTR-001
  it("rejects an unpinned dependency with UnpinnedDependencyError naming the entry", () => {
    const markdown = techMd({ devDependencies: '["typescript@^7.0.0", "vitest@5.0.5"]' });

    expect(() => parseTechMd(markdown)).toThrow(new UnpinnedDependencyError("typescript@^7.0.0"));
  });

  it("rejects a dependency without any version as unpinned", () => {
    const markdown = techMd({ devDependencies: '["vitest"]' });

    expect(() => parseTechMd(markdown)).toThrow(UnpinnedDependencyError);
  });

  it("rejects a file without the TD-TOOLING section instead of defaulting the tooling", () => {
    const markdown = techMd().replace("## 6. TD-TOOLING", "## 6. Something else");

    expect(() => parseTechMd(markdown)).toThrow(new TechMdParseError("missing section: ## TD-TOOLING"));
  });

  it("rejects a TD-TOOLING section whose yaml lacks test_cmd", () => {
    const tooling = ["```yaml", 'node: "22"', 'typecheck_cmd: "npx tsc --noEmit"', "dependencies: []", "dev_dependencies: []", "```"].join("\n");

    expect(() => parseTechMd(techMd({ tooling }))).toThrow(new TechMdParseError("TD-TOOLING key missing: test_cmd"));
  });

  it("rejects a file without the module map section", () => {
    const markdown = techMd().replace("## 2. Module map", "## 2. Components");

    expect(() => parseTechMd(markdown)).toThrow(new TechMdParseError("missing section: ## Module map"));
  });

  it("rejects a file whose traceability table has no rows", () => {
    const markdown = techMd().replace(/\| todo-cli:[^\n]*\n/g, "");

    expect(() => parseTechMd(markdown)).toThrow(new TechMdParseError("traceability table has no rows"));
  });
});

describe("parseInterfaceExports", () => {
  it("joins a multi-line function signature up to the terminating semicolon", () => {
    const exports = parseInterfaceExports("export function run(\n  argv: readonly string[],\n): number;\nexport const X = 1;");

    expect(exports.map((item) => item.signature)).toEqual(["export function run( argv: readonly string[], ): number;", "export const X = 1;"]);
  });
});
