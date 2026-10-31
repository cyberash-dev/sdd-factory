import { describe, expect, it } from "vitest";
import { parseArgv, USAGE_TEXT } from "../../src/parse/index.js";

const usageFailure = (detail: string) => ({ ok: false, error: { code: "E_USAGE", detail } });
const COMMAND_NAMES = ["add", "list", "summary", "rm", "export", "--help"];

describe("parse: add amount", () => {
  // @covers expense-ledger-cli:BEH-002
  it("accepts a positive decimal amount and rejects every other amount with E_USAGE", () => {
    expect(parseArgv(["add", "12.5", "coffee"])).toEqual({
      ok: true,
      command: { kind: "add", amountCents: 1250, category: "coffee" },
    });
    expect(parseArgv(["add", "12.50", "coffee"])).toEqual({
      ok: true,
      command: { kind: "add", amountCents: 1250, category: "coffee" },
    });
    for (const amount of ["12.505", "abc", "0", "-1", "+12", "12.", "0.00", ""]) {
      expect(parseArgv(["add", amount, "coffee"])).toEqual(usageFailure(`invalid amount "${amount}"`));
    }
  });

  it("keeps the amount at the safe-integer cent boundary", () => {
    expect(parseArgv(["add", "90071992547409.91", "coffee"])).toEqual({
      ok: true,
      command: { kind: "add", amountCents: 9007199254740991, category: "coffee" },
    });
    expect(parseArgv(["add", "90071992547409.92", "coffee"])).toEqual(
      usageFailure('invalid amount "90071992547409.92"'),
    );
  });

  it("leaves the add date undefined when --date is absent", () => {
    const result = parseArgv(["add", "12.5", "coffee"]);
    expect(result.ok && "date" in result.command ? result.command.date : "absent").toBeUndefined();
  });
});

describe("parse: add category", () => {
  // @covers expense-ledger-cli:BEH-003
  it("accepts a 1 to 20 character lowercase category and rejects every other category with E_USAGE", () => {
    for (const category of ["food-2", "a", "abcdefghij0123456789"]) {
      expect(parseArgv(["add", "12.5", category])).toEqual({
        ok: true,
        command: { kind: "add", amountCents: 1250, category },
      });
    }
    for (const category of ["Coffee", "food_2", "abcdefghij01234567890", ""]) {
      expect(parseArgv(["add", "12.5", category])).toEqual(usageFailure(`invalid category "${category}"`));
    }
  });
});

describe("parse: add date option", () => {
  // @covers expense-ledger-cli:BEH-004
  it("accepts a YYYY-MM-DD calendar day and rejects every other --date value with E_USAGE", () => {
    for (const date of ["2026-02-28", "2024-02-29"]) {
      expect(parseArgv(["add", "12.5", "coffee", "--date", date])).toEqual({
        ok: true,
        command: { kind: "add", amountCents: 1250, category: "coffee", date },
      });
    }
    for (const date of ["2026-13-01", "2026-01-00", "20260101", "2026-02-30", "2026-02-29"]) {
      expect(parseArgv(["add", "12.5", "coffee", "--date", date])).toEqual(
        usageFailure(`invalid date "${date}"`),
      );
    }
  });

  it("rejects --date without a following value", () => {
    expect(parseArgv(["add", "12.5", "coffee", "--date"])).toEqual(
      usageFailure("option --date needs a value"),
    );
  });
});

describe("parse: help", () => {
  // @covers expense-ledger-cli:BEH-015
  it("recognizes --help as the help command and keeps usage text that names every command", () => {
    expect(parseArgv(["--help"])).toEqual({ ok: true, command: { kind: "help" } });
    const text = USAGE_TEXT.join("\n");
    for (const name of COMMAND_NAMES) {
      expect(text).toContain(name);
    }
  });

  it("rejects an unknown leading option with E_USAGE", () => {
    expect(parseArgv(["--verbose"])).toEqual(usageFailure('unknown command "--verbose"'));
  });

  it("rejects --help followed by another token with E_USAGE", () => {
    expect(parseArgv(["--help", "list"])).toEqual(usageFailure("--help takes no arguments"));
  });
});

describe("parse: usage errors", () => {
  // @covers expense-ledger-cli:BEH-016
  it("reports an unknown command, unknown option, missing positional and empty argv as single-line E_USAGE", () => {
    const cases: [string[], string][] = [
      [["frobnicate"], 'unknown command "frobnicate"'],
      [[], "no command given"],
      [["list", "--verbose"], 'unknown option "--verbose"'],
      [["add", "12.5"], "missing argument <category>"],
      [["add"], "missing argument <amount>"],
      [["rm"], "missing argument <id>"],
      [["add", "12.5", "coffee", "extra"], 'unexpected argument "extra"'],
      [["add", "12.5", "coffee", "--"], 'unknown option "--"'],
      [["export"], "export needs --csv"],
      [["list", "--category"], "option --category needs a value"],
    ];
    for (const [argv, detail] of cases) {
      const result = parseArgv(argv);
      expect(result).toEqual(usageFailure(detail));
      expect(detail).not.toContain("\n");
    }
  });

  it("parses a valid list command without a usage error", () => {
    expect(parseArgv(["list"])).toEqual({ ok: true, command: { kind: "list" } });
  });

  it("parses export --csv and takes option values verbatim, last occurrence winning", () => {
    expect(parseArgv(["export", "--csv"])).toEqual({ ok: true, command: { kind: "export" } });
    expect(parseArgv(["add", "12.5", "coffee", "--note", "-x", "--note", "second"])).toEqual({
      ok: true,
      command: { kind: "add", amountCents: 1250, category: "coffee", note: "second" },
    });
  });
});

describe("parse: help contract", () => {
  // @covers expense-ledger-cli:CTR-006
  it("answers --help with a successful help command and usage lines naming add, list, summary, rm, export and --help", () => {
    const result = parseArgv(["--help"]);
    expect(result).toEqual({ ok: true, command: { kind: "help" } });
    for (const name of COMMAND_NAMES) {
      expect(USAGE_TEXT.some((line) => line.includes(name))).toBe(true);
    }
    expect(USAGE_TEXT.length).toBeGreaterThanOrEqual(COMMAND_NAMES.length - 1);
  });
});

describe("parse: boundary validation policy", () => {
  // @covers expense-ledger-cli:POL-002
  it("turns an invalid amount, category, date, month or id into a single-line E_USAGE result", () => {
    const cases: [string[], string][] = [
      [["add", "abc", "coffee"], 'invalid amount "abc"'],
      [["add", "12.5", "Coffee"], 'invalid category "Coffee"'],
      [["add", "12.5", "coffee", "--date", "2026-13-01"], 'invalid date "2026-13-01"'],
      [["summary", "--month", "2026-13"], 'invalid month "2026-13"'],
      [["rm", "one"], 'invalid id "one"'],
    ];
    for (const [argv, detail] of cases) {
      expect(parseArgv(argv)).toEqual(usageFailure(detail));
    }
  });

  it.each(["0", "-1", "1.5", "01", "9007199254740992", ""])("rejects rm id %j", (id) => {
    expect(parseArgv(["rm", id])).toEqual(usageFailure(`invalid id "${id}"`));
  });

  it("accepts rm ids in the safe-integer range", () => {
    expect(parseArgv(["rm", "1"])).toEqual({ ok: true, command: { kind: "rm", id: 1 } });
    expect(parseArgv(["rm", "9007199254740991"])).toEqual({
      ok: true,
      command: { kind: "rm", id: 9007199254740991 },
    });
  });

  it.each(["2026-00", "2026-1", "202601", "2026-13"])("rejects summary --month %j", (month) => {
    expect(parseArgv(["summary", "--month", month])).toEqual(usageFailure(`invalid month "${month}"`));
  });

  it("accepts summary --month 2026-02 and a bare summary", () => {
    expect(parseArgv(["summary", "--month", "2026-02"])).toEqual({
      ok: true,
      command: { kind: "summary", month: "2026-02" },
    });
    expect(parseArgv(["summary"])).toEqual({ ok: true, command: { kind: "summary" } });
  });
});
