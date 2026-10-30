import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { isPlaceholderModule, modulesOfTask, stubForExport, stubSource } from "../../src/build-stage/domain/stubs.js";
import { parseInterfaceExports } from "../../src/shared/design-files/tech-md.js";
import { aModule, aTaskSpec } from "./support/design.js";

function aModuleWithInterface(entry: string, interfaceSource: string): ReturnType<typeof aModule> {
  return aModule({ entry, owns: [entry], interfaceSource, exports: parseInterfaceExports(interfaceSource) });
}

function typecheckErrors(stubsByPath: ReadonlyMap<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "stubs-typecheck-"));
  for (const [path, source] of stubsByPath) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  }
  const compilerOptions = { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true, skipLibCheck: true, types: [] };
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions, include: ["src"] }));
  const tsc = join(process.cwd(), "node_modules", "typescript", "bin", "tsc");
  try {
    execFileSync(process.execPath, [tsc, "--noEmit", "-p", root], { encoding: "utf8" });
    return "";
  } catch (error: unknown) {
    return error instanceof Error && "stdout" in error ? String(error.stdout) : String(error);
  }
}

describe("stub generation from the tech.md module table", () => {
  // @covers build-stage:ASM-001
  it.each([
    ["a call signature", { name: "greet", kind: "function", signature: "greet(name: string): string" }, 'export function greet(name: string): string {\n  throw new Error("not implemented: greet");\n}'],
    ["a function keyword signature", { name: "greet", kind: "function", signature: "export function greet(name: string): Promise<string>;" }, 'export function greet(name: string): Promise<string> {\n  throw new Error("not implemented: greet");\n}'],
    ["a generic function", { name: "pick", kind: "function", signature: "pick<T>(items: T[]): T" }, 'export function pick<T>(items: T[]): T {\n  throw new Error("not implemented: pick");\n}'],
    ["a typed arrow signature", { name: "greet", kind: "function", signature: "greet: (name: string) => string" }, 'export const greet: (name: string) => string = () => {\n  throw new Error("not implemented: greet");\n};'],
    ["an unrecognised function signature", { name: "greet", kind: "function", signature: "whatever" }, 'export function greet(..._args: unknown[]): never {\n  throw new Error("not implemented: greet");\n}'],
    ["a type alias", { name: "Greeting", kind: "type", signature: "type Greeting = { text: string }" }, "export type Greeting = { text: string }"],
    ["an interface", { name: "Greeter", kind: "interface", signature: "interface Greeter { greet(name: string): string }" }, "export interface Greeter { greet(name: string): string }"],
    ["a typed const", { name: "DEFAULTS", kind: "const", signature: "const DEFAULTS: { locale: string }" }, 'export const DEFAULTS: { locale: string } = new Proxy({}, { get: (_target, key) => { throw new Error("not implemented: DEFAULTS." + String(key)); } }) as unknown as { locale: string };'],
  ] as const)("renders %s", (_label, item, expected) => {
    expect(stubForExport(item)).toBe(expected);
  });

  it("renders a class whose constructor throws and whose declared members become an interface merge", () => {
    const stub = stubForExport({ name: "Greeter", kind: "class", signature: "class Greeter {\n  constructor(locale: string);\n  greet(name: string): string;\n  static create(): Greeter;\n}" });

    expect(stub).toBe('export class Greeter {\n  constructor(..._args: unknown[]) {\n    throw new Error("not implemented: Greeter");\n  }\n}\nexport interface Greeter {\n  greet(name: string): string;\n}');
  });

  it.each([
    ["export {};\n", true],
    ["\n", true],
    ["export const x = 1;\n", false],
    ["export {};\nexport function f(): void {}\n", false],
  ])("recognises %j as placeholder: %s", (source, expected) => {
    expect(isPlaceholderModule(source)).toBe(expected);
  });

  it("renders an empty module for a module without exports", () => {
    expect(stubSource(aModule({ exports: [] }))).toBe("export {};\n");
  });

  // @covers build-stage:DLT-003
  it("starts the stub with the type import line of the interface block", () => {
    const module = aModule({
      interfaceSource: 'import type { Result } from "../errors/index.js";\n\nexport function run(argv: string[]): Result<string>;',
      exports: [{ name: "run", kind: "function", signature: "run(argv: string[]): Result<string>" }],
    });

    expect(stubSource(module)).toBe('import type { Result } from "../errors/index.js";\n\nexport function run(argv: string[]): Result<string> {\n  throw new Error("not implemented: run");\n}\n');
  });

  // @covers build-stage:DLT-003
  it("keeps value and multi-line imports verbatim and emits each import once", () => {
    const module = aModule({
      interfaceSource: 'import { parse } from "../parser/index.js";\nimport type {\n  Token,\n  Span,\n} from "../lexer/index.js";\n\nexport function first(source: string): Token;\nexport function where(token: Token): Span;',
      exports: [
        { name: "first", kind: "function", signature: "first(source: string): Token" },
        { name: "where", kind: "function", signature: "where(token: Token): Span" },
      ],
    });

    expect(stubSource(module)).toBe('import { parse } from "../parser/index.js";\nimport type {\n  Token,\n  Span,\n} from "../lexer/index.js";\n\nexport function first(source: string): Token {\n  throw new Error("not implemented: first");\n}\n\nexport function where(token: Token): Span {\n  throw new Error("not implemented: where");\n}\n');
  });

  // @covers build-stage:DLT-003
  it("renders an interface without imports with no import lines", () => {
    expect(stubSource(aModule())).toBe('export function greet(name: string): string {\n  throw new Error("not implemented: greet");\n}\n');
  });

  // @covers build-stage:BEH-001
  it("reproduces a multi-line interface of the interface block verbatim with its body and closing brace", () => {
    const module = aModuleWithInterface("src/store/index.ts", "export interface TodoTask {\n  readonly id: number;\n  readonly text: string;\n}\nexport function readTodo(path: string): TodoTask;");

    expect(stubSource(module)).toBe('export interface TodoTask {\n  readonly id: number;\n  readonly text: string;\n}\n\nexport function readTodo(path: string): TodoTask {\n  throw new Error("not implemented: readTodo");\n}\n');
  });

  // @covers build-stage:BEH-001
  it("reproduces a multi-line union type alias verbatim with its trailing semicolon", () => {
    const module = aModuleWithInterface("src/cli/index.ts", 'export type Command =\n  | {\n      readonly kind: "add";\n      readonly text: string;\n    }\n  | { readonly kind: "help" };\nexport const VERSION: string;');

    expect(stubSource(module).split("\nexport const")[0]).toBe('export type Command =\n  | {\n      readonly kind: "add";\n      readonly text: string;\n    }\n  | { readonly kind: "help" };\n');
  });

  // @covers build-stage:DLT-003
  it("writes stubs for every module of a design that typecheck together against their sibling stubs", () => {
    const modules = [
      aModuleWithInterface("src/errors/index.ts", ERRORS_INTERFACE),
      aModuleWithInterface("src/cli/index.ts", CLI_INTERFACE),
      aModuleWithInterface("src/store/index.ts", STORE_INTERFACE),
      aModuleWithInterface("src/tasks/index.ts", TASKS_INTERFACE),
      aModuleWithInterface("src/render/index.ts", RENDER_INTERFACE),
      aModuleWithInterface("src/commands/index.ts", COMMANDS_INTERFACE),
      aModuleWithInterface("src/help/index.ts", "export const USAGE_TEXT: string;"),
      aModuleWithInterface("src/index.ts", APP_INTERFACE),
      aModuleWithInterface("src/cli.ts", "export function main(argv: readonly string[]): Promise<number>;"),
    ];

    const errors = typecheckErrors(new Map(modules.map((module) => [module.entry, stubSource(module)])));

    expect(errors).toBe("");
  }, 60_000);

  it("selects the modules referenced by designRefs or sharing a covered id", () => {
    const modules = [aModule(), aModule({ id: "M-02", covers: ["greeter:BEH-002"] }), aModule({ id: "M-03", covers: ["greeter:BEH-001"] })];

    expect(modulesOfTask(modules, aTaskSpec({ designRefs: ["M-02"] })).map((module) => module.id)).toEqual(["M-01", "M-02", "M-03"]);
  });
});

const ERRORS_INTERFACE = `export const USAGE_LINE: string;
export type TodoErrorCode = "E_USAGE" | "E_NO_TASK" | "E_STORAGE";
export type TodoError =
  | { readonly code: "E_USAGE" }
  | { readonly code: "E_NO_TASK"; readonly taskId: number }
  | { readonly code: "E_STORAGE"; readonly path: string };
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: TodoError };
export function exitCodeFor(code: TodoErrorCode): 0 | 1 | 2;
export function formatStderr(error: TodoError): string;`;

const CLI_INTERFACE = `import type { Result } from "../errors/index.js";
export type ParsedCommand =
  | { readonly kind: "add"; readonly text: string }
  | { readonly kind: "list"; readonly includeCompleted: boolean }
  | { readonly kind: "done"; readonly id: number }
  | { readonly kind: "rm"; readonly id: number }
  | { readonly kind: "help" };
export function parseArgv(argv: readonly string[]): Result<ParsedCommand>;`;

const STORE_INTERFACE = `import type { Result } from "../errors/index.js";
export interface TodoTask {
  readonly id: number;
  readonly text: string;
  readonly done: boolean;
  readonly createdAt: string;
}
export interface TodoDocument {
  readonly nextId: number;
  readonly tasks: readonly TodoTask[];
}
export function resolveTodoPath(
  env: Readonly<Record<string, string | undefined>>,
  cwd: string
): string;
export function readTodo(path: string): Result<TodoDocument>;
export function writeTodo(path: string, document: TodoDocument): Result<void>;`;

const TASKS_INTERFACE = `import type { Result } from "../errors/index.js";
import type { TodoDocument, TodoTask } from "../store/index.js";
export function addTask(
  document: TodoDocument,
  text: string,
  now: Date
): { readonly document: TodoDocument; readonly task: TodoTask };
export function markDone(document: TodoDocument, id: number): Result<TodoDocument>;
export function removeTask(document: TodoDocument, id: number): Result<TodoDocument>;`;

const RENDER_INTERFACE = `import type { TodoTask } from "../store/index.js";
export function renderList(
  tasks: readonly TodoTask[],
  includeCompleted: boolean
): string;`;

const COMMANDS_INTERFACE = `import type { Result } from "../errors/index.js";
import type { TodoDocument } from "../store/index.js";
export interface CommandOutcome {
  readonly document: TodoDocument;
  readonly stdout: string;
}
export function runAdd(
  document: TodoDocument,
  text: string,
  now: Date
): Result<CommandOutcome>;
export function runDone(document: TodoDocument, id: number): Result<CommandOutcome>;
export function runRm(document: TodoDocument, id: number): Result<CommandOutcome>;`;

const APP_INTERFACE = `export interface RuntimeDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
  readonly now: () => Date;
}
export interface RunOutcome {
  readonly exitCode: 0 | 1 | 2;
  readonly stdout: string;
  readonly stderr: string;
}
export function run(argv: readonly string[], deps: RuntimeDeps): Promise<RunOutcome>;`;
