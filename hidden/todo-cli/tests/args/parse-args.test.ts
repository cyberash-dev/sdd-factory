import { describe, expect, it } from "vitest";
import { parseArgs } from "../../src/args/index.js";
import { exitCodeFor } from "../../src/errors/index.js";
import type { CliError } from "../../src/errors/index.js";

describe("argument parsing", () => {
  it.each([
    [["list"], { command: "list", all: false }],
    [["list", "--all"], { command: "list", all: true }],
    [["add", "milk"], { command: "add", text: "milk" }],
    [["done", "1"], { command: "done", idToken: "1" }],
    [["rm", "5"], { command: "rm", idToken: "5" }],
  ])("parses valid argv %j into a command", (argv, expected) => {
    expect(parseArgs(argv)).toEqual(expected);
  });

  // @covers todo-cli:BEH-012
  it.each(["frobnicate", "lis", "l"])(
    "answers the unknown command %s with a usage error of exit 2",
    (word) => {
      const r = parseArgs([word]);
      expect(r).toMatchObject({ line: expect.stringMatching(/^usage: /) });
      expect(exitCodeFor(r as CliError)).toBe(2);
    },
  );

  // @covers todo-cli:BEH-013
  it.each([[[]], [["add"]], [["done"]], [["rm"]]] as string[][][])(
    "answers the missing argument in %j with E_USAGE_MISSING_ARGUMENT",
    (argv) => {
      expect(parseArgs(argv)).toEqual({
        code: "E_USAGE_MISSING_ARGUMENT",
        line: "usage: missing argument",
      });
    },
  );

  it("answers an empty add text with E_USAGE_EMPTY_TEXT", () => {
    expect(parseArgs(["add", ""])).toEqual({
      code: "E_USAGE_EMPTY_TEXT",
      line: "usage: empty text",
    });
  });

  // @covers todo-cli:BEH-014
  it.each([
    [["done", "0"], "0"],
    [["done", "-1"], "-1"],
    [["done", "abc"], "abc"],
    [["rm", "1.5"], "1.5"],
    [["rm", "-1"], "-1"],
  ] as [string[], string][])("answers the invalid id in %j with E_USAGE_INVALID_ID", (argv, token) => {
    expect(parseArgs(argv)).toEqual({
      code: "E_USAGE_INVALID_ID",
      line: `usage: invalid id ${token}`,
    });
  });

  // @covers todo-cli:BEH-015
  it.each([
    [["list", "--bogus"], "--bogus"],
    [["list", "--help"], "--help"],
    [["add", "--all", "milk"], "--all"],
  ] as [string[], string][])("answers the option in %j with E_USAGE_UNKNOWN_OPTION", (argv, opt) => {
    expect(parseArgs(argv)).toEqual({
      code: "E_USAGE_UNKNOWN_OPTION",
      line: `usage: unknown argument ${opt}`,
    });
  });

  // @covers todo-cli:BEH-021
  it("reports an invalid id as a usage error and a valid id as a parsed command", () => {
    expect(parseArgs(["done", "abc"])).toEqual({
      code: "E_USAGE_INVALID_ID",
      line: "usage: invalid id abc",
    });
    expect(parseArgs(["done", "1"])).toEqual({ command: "done", idToken: "1" });
  });

  // @covers todo-cli:POL-002
  it.each([[[]], [["done", "abc"]], [["rm", "-1"]], [["list", "--bogus"]]] as string[][][])(
    "returns a single-line usage error for %j instead of throwing",
    (argv) => {
      const r = parseArgs(argv) as CliError;
      expect(r.line).toMatch(/^usage: [^\n]+$/);
      expect(r.line).not.toMatch(/\bat\b.*:\d+/);
      expect(exitCodeFor(r)).toBe(2);
    },
  );
});
