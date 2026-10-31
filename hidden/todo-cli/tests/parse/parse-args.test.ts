import { describe, expect, it } from "vitest";
import { parseArgs } from "../../src/parse/index.js";

function expectUsage(argv: string[]): void {
  const result = parseArgs(argv);
  expect(result).toMatchObject({ code: "E_USAGE", exitCode: 2 });
  const message = (result as { message: string }).message;
  expect(message.startsWith("usage:")).toBe(true);
  expect(message).not.toContain("\n");
}

describe("parseArgs blank text for add", () => {
  // @covers todo-cli:BEH-002
  it.each([
    ["empty string", [""]],
    ["spaces only", ["   "]],
    ["space tab space", [" \t "]],
  ])("rejects %s as E_USAGE with exit code 2", (_name, text) => {
    expectUsage(["add", ...text]);
  });

  it("returns an add command for a single-character text", () => {
    expect(parseArgs(["add", "y"])).toEqual({ kind: "add", text: "y" });
  });

  it("returns an add command for a typical text", () => {
    expect(parseArgs(["add", "x"])).toEqual({ kind: "add", text: "x" });
  });
});

describe("parseArgs unknown command or flag", () => {
  // @covers todo-cli:BEH-013
  it.each([
    ["unknown word", ["frobnicate"]],
    ["unknown flag on list", ["list", "--verbose"]],
    ["empty command line", []],
  ])("rejects %s as E_USAGE with exit code 2", (_name, argv) => {
    expectUsage(argv);
  });

  it.each([
    ["unknown flag on done", ["done", "1", "--force"]],
    ["unknown flag on add", ["add", "x", "--urgent"]],
    ["unknown flag on rm", ["rm", "1", "--force"]],
  ])("rejects %s as E_USAGE", (_name, argv) => {
    expectUsage(argv);
  });

  it("returns a list command with all false for list", () => {
    expect(parseArgs(["list"])).toEqual({ kind: "list", all: false });
  });

  it("returns a list command with all true for list --all", () => {
    expect(parseArgs(["list", "--all"])).toEqual({ kind: "list", all: true });
  });

  it("returns a help command for --help", () => {
    expect(parseArgs(["--help"])).toEqual({ kind: "help" });
  });
});

describe("parseArgs missing or extra arguments", () => {
  // @covers todo-cli:BEH-014
  it.each([
    ["add without text", ["add"]],
    ["done without id", ["done"]],
    ["rm without id", ["rm"]],
    ["add with two arguments", ["add", "a", "b"]],
  ])("rejects %s as E_USAGE with exit code 2", (_name, argv) => {
    expectUsage(argv);
  });

  it.each([
    ["done with two ids", ["done", "1", "2"]],
    ["rm with two ids", ["rm", "1", "2"]],
  ])("rejects %s as E_USAGE", (_name, argv) => {
    expectUsage(argv);
  });

  it("returns a done command when the id is present", () => {
    expect(parseArgs(["done", "1"])).toEqual({ kind: "done", id: 1 });
  });

  it("returns an rm command when the id is present", () => {
    expect(parseArgs(["rm", "7"])).toEqual({ kind: "rm", id: 7 });
  });
});

describe("parseArgs invalid task id", () => {
  // @covers todo-cli:BEH-015
  it.each([
    ["zero", ["done", "0"]],
    ["negative", ["rm", "-1"]],
    ["non-numeric", ["done", "abc"]],
    ["fractional", ["done", "1.5"]],
  ])("rejects %s id as E_USAGE with exit code 2, never E_NO_TASK", (_name, argv) => {
    expectUsage(argv);
  });
});

describe("parseArgs boundary validation policy", () => {
  // @covers todo-cli:POL-002
  it.each([
    ["missing argument", ["add"]],
    ["invalid id", ["done", "abc"]],
    ["unknown command", ["frobnicate"]],
  ])("returns a single-line usage CliError for %s instead of throwing", (_name, argv) => {
    const result = parseArgs(argv);
    expect(result).toMatchObject({ code: "E_USAGE", exitCode: 2 });
    const message = (result as { message: string }).message;
    expect(message).toMatch(/^usage: [^\n]*$/);
  });

  it("returns a parsed command, not an error, for a valid done", () => {
    expect(parseArgs(["done", "1"])).toEqual({ kind: "done", id: 1 });
  });
});
