import { describe, expect, it } from "vitest";
import { isPlaceholderModule, modulesOfTask, stubForExport, stubSource } from "../../src/build-stage/domain/stubs.js";
import { aModule, aTaskSpec } from "./support/design.js";

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

  it("selects the modules referenced by designRefs or sharing a covered id", () => {
    const modules = [aModule(), aModule({ id: "M-02", covers: ["greeter:BEH-002"] }), aModule({ id: "M-03", covers: ["greeter:BEH-001"] })];

    expect(modulesOfTask(modules, aTaskSpec({ designRefs: ["M-02"] })).map((module) => module.id)).toEqual(["M-01", "M-02", "M-03"]);
  });
});
