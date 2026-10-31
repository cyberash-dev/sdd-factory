import { describe, expect, it } from "vitest";
import {
  exitCodeFor,
  noExpenseError,
  renderDiagnostic,
  unreadableStoreError,
  usageError,
} from "../../src/diagnostics/index.js";

describe("diagnostics stable codes and exit status", () => {
  // @covers expense-ledger-cli:POL-001
  it("maps each stable code to exactly one documented exit status", () => {
    expect(exitCodeFor("E_SUCCESS")).toBe(0);
    expect(exitCodeFor("E_USAGE")).toBe(2);
    expect(exitCodeFor("E_NO_EXPENSE")).toBe(1);
    expect(exitCodeFor("E_UNREADABLE_STORE")).toBe(1);
  });

  it("returns the same exit status on every call for the same code", () => {
    expect(exitCodeFor("E_USAGE")).toBe(2);
    expect(exitCodeFor("E_USAGE")).toBe(2);
    expect(exitCodeFor("E_NO_EXPENSE")).toBe(1);
    expect(exitCodeFor("E_NO_EXPENSE")).toBe(1);
  });

  it("builds a usage error carrying E_USAGE and its detail", () => {
    expect(usageError("no command given")).toEqual({ code: "E_USAGE", detail: "no command given" });
  });

  it("builds an unknown expense id error carrying E_NO_EXPENSE", () => {
    const err = noExpenseError(7);
    expect(err.code).toBe("E_NO_EXPENSE");
    expect(exitCodeFor(err.code)).toBe(1);
  });

  it("builds an unreadable ledger file error carrying E_UNREADABLE_STORE", () => {
    const err = unreadableStoreError("/tmp/l.json");
    expect(err.code).toBe("E_UNREADABLE_STORE");
    expect(exitCodeFor(err.code)).toBe(1);
  });

  it("tells a usage error apart from an unknown expense id by prefix and exit status", () => {
    const usage = usageError("unknown command frobnicate");
    const missing = noExpenseError(7);
    expect(renderDiagnostic(usage).startsWith("usage:")).toBe(true);
    expect(renderDiagnostic(missing).startsWith("error:")).toBe(true);
    expect(exitCodeFor(usage.code)).toBe(2);
    expect(exitCodeFor(missing.code)).toBe(1);
  });
});

describe("diagnostic rendering", () => {
  // @covers expense-ledger-cli:INV-007
  it("renders a usage error as one line beginning with usage: and exit status 2", () => {
    const err = usageError("no command given");
    const text = renderDiagnostic(err);
    expect(text).toBe("usage: no command given");
    expect(text).not.toContain("\n");
    expect(exitCodeFor(err.code)).toBe(2);
  });

  it("renders an unknown expense id as exactly error: no expense #7 with exit status 1", () => {
    const err = noExpenseError(7);
    const text = renderDiagnostic(err);
    expect(text).toBe("error: no expense #7");
    expect(text).not.toContain("\n");
    expect(exitCodeFor(err.code)).toBe(1);
  });

  it("renders an unreadable ledger file as one error: line naming the path", () => {
    const err = unreadableStoreError("/tmp/l.json");
    const text = renderDiagnostic(err);
    expect(text).toBe("error: cannot read /tmp/l.json");
    expect(text).not.toContain("\n");
    expect(exitCodeFor(err.code)).toBe(1);
  });

  it.each([
    ["usage", "add needs an amount"],
    ["usage", "unknown command frobnicate"],
    ["no-expense", 1],
    ["no-expense", 42],
    ["unreadable", "/var/data/ledger.json"],
  ] as const)("renders every %s failure as a single line with a stable prefix (%#)", (kind, arg) => {
    const err =
      kind === "usage"
        ? usageError(String(arg))
        : kind === "no-expense"
          ? noExpenseError(Number(arg))
          : unreadableStoreError(String(arg));
    const prefix = kind === "usage" ? "usage:" : "error:";
    const text = renderDiagnostic(err);
    expect(text.startsWith(prefix)).toBe(true);
    expect(text.split("\n")).toHaveLength(1);
    expect(exitCodeFor(err.code)).toBe(kind === "usage" ? 2 : 1);
  });

  // @covers expense-ledger-cli:CTR-008
  it("keeps the fixed message forms and the prefix-to-exit-status pairing", () => {
    expect(renderDiagnostic(noExpenseError(7))).toBe("error: no expense #7");
    expect(renderDiagnostic(unreadableStoreError("/tmp/l.json"))).toBe("error: cannot read /tmp/l.json");
    expect(renderDiagnostic(usageError("no command given"))).toBe("usage: no command given");
    expect(exitCodeFor("E_USAGE")).toBe(2);
    expect(exitCodeFor("E_NO_EXPENSE")).toBe(1);
    expect(exitCodeFor("E_UNREADABLE_STORE")).toBe(1);
  });

  it("interpolates the unknown expense id into the message", () => {
    expect(renderDiagnostic(noExpenseError(1))).toBe("error: no expense #1");
    expect(renderDiagnostic(noExpenseError(123))).toBe("error: no expense #123");
  });

  it("interpolates the ledger path into the unreadable message", () => {
    expect(renderDiagnostic(unreadableStoreError("ledger.json"))).toBe("error: cannot read ledger.json");
  });
});
