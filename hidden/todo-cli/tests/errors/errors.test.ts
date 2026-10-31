import { describe, expect, it } from "vitest";
import { exitCodeFor, isCliError, makeError } from "../../src/errors/index.js";
import type { ErrorCode } from "../../src/errors/index.js";

describe("error code vocabulary", () => {
  // @covers todo-cli:POL-001
  it.each([
    ["E_USAGE_MISSING_ARGUMENT", undefined, "usage: missing argument"],
    ["E_USAGE_EMPTY_TEXT", undefined, "usage: empty text"],
    ["E_USAGE_UNKNOWN_OPTION", "--bogus", "usage: unknown argument --bogus"],
    ["E_USAGE_INVALID_ID", "abc", "usage: invalid id abc"],
    ["E_NO_TASK", "9", "error: no task #9"],
    ["E_CANNOT_READ", "/tmp/v/s.json", "error: cannot read /tmp/v/s.json"],
  ] as [ErrorCode, string | undefined, string][])(
    "maps %s to exactly one stderr line with its contractual prefix",
    (code, subject, line) => {
      const err = makeError(code, subject);
      expect(err).toEqual({ code, line });
      expect(err.line.includes("\n")).toBe(false);
    },
  );

  // @covers todo-cli:INV-005
  it.each([
    ["E_USAGE_MISSING_ARGUMENT", 2],
    ["E_USAGE_EMPTY_TEXT", 2],
    ["E_USAGE_UNKNOWN_OPTION", 2],
    ["E_USAGE_INVALID_ID", 2],
    ["E_NO_TASK", 1],
    ["E_CANNOT_READ", 1],
  ] as [ErrorCode, number][])("exits %s with %i and never another code", (code, exit) => {
    expect(exitCodeFor(makeError(code, "x"))).toBe(exit);
  });

  it("recognises a CliError and rejects other values", () => {
    expect(isCliError(makeError("E_NO_TASK", "1"))).toBe(true);
    expect(isCliError({ command: "list", all: false })).toBe(false);
    expect(isCliError(null)).toBe(false);
    expect(isCliError("usage: missing argument")).toBe(false);
  });
});
