import { describe, expect, it } from "vitest";
import {
  formatErrorLine,
  isCliError,
  noTaskError,
  storageError,
  usageError,
} from "../../src/errors/index.js";

describe("stable error reporting", () => {
  // @covers todo-cli:POL-001
  it("maps each failure class to its code, documented exit code and prefixed message", () => {
    expect(usageError("add <text>")).toEqual({
      code: "E_USAGE",
      exitCode: 2,
      message: "usage: add <text>",
    });
    expect(noTaskError(7)).toEqual({
      code: "E_NO_TASK",
      exitCode: 1,
      message: "error: no task #7",
    });
    expect(storageError("./broken.json")).toEqual({
      code: "E_STORAGE",
      exitCode: 1,
      message: "error: cannot read ./broken.json",
    });
  });

  it("renders a failure as one stderr line without a trailing newline", () => {
    expect(formatErrorLine(usageError("x"))).toBe("usage: x");
    expect(formatErrorLine(noTaskError(7))).toBe("error: no task #7");
    expect(formatErrorLine(storageError("./broken.json"))).toBe("error: cannot read ./broken.json");
  });

  it("recognises a CliError and rejects other values", () => {
    expect(isCliError(noTaskError(1))).toBe(true);
    expect(isCliError(storageError("a"))).toBe(true);
    expect(isCliError({ code: "E_OTHER", exitCode: 0, message: "boom" })).toBe(false);
    expect(isCliError(null)).toBe(false);
    expect(isCliError("error: x")).toBe(false);
  });
});
