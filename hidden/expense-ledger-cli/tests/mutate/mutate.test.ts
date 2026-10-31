import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runAdd, runRm } from "../../src/mutate/index.js";
import { renderDiagnostic } from "../../src/diagnostics/index.js";

const NOW = new Date("2026-10-31T12:00:00Z");

function withDir(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-mutate-"));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function doc(ids: number[], nextId: number = Math.max(0, ...ids) + 1): string {
  const expenses = ids.map((id) => ({
    id,
    amount_cents: id * 100,
    category: "food",
    date: "2026-01-0" + id,
    note: "n" + id,
  }));
  return JSON.stringify({ next_id: nextId, expenses }, null, 2) + "\n";
}

function readDoc(file: string): { next_id: number; expenses: Record<string, unknown>[] } {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function failure(outcome: ReturnType<typeof runRm>): { code: string; text: string } {
  if (outcome.ok) throw new Error("expected a failed outcome");
  return { code: outcome.error.code, text: renderDiagnostic(outcome.error) };
}

describe("add on an empty ledger", () => {
  // @covers expense-ledger-cli:BEH-001
  it("add 12.5 coffee on an absent ledger file stores one expense of 1250 cents with id 1", () => {
    withDir((dir) => {
      const file = path.join(dir, "l.json");
      const out = runAdd({ kind: "add", amountCents: 1250, category: "coffee" }, file, NOW);
      expect(out).toEqual({ ok: true, lines: ["#1 12.50 coffee 2026-10-31"] });
      const stored = readDoc(file);
      expect(stored.expenses).toHaveLength(1);
      expect(stored.expenses[0]).toMatchObject({ id: 1, amount_cents: 1250, category: "coffee" });
    });
  });

  it("add into a ledger file holding an empty expense array prints #1", () => {
    withDir((dir) => {
      const file = path.join(dir, "l.json");
      fs.writeFileSync(file, "[]\n");
      const out = runAdd({ kind: "add", amountCents: 1250, category: "coffee" }, file, NOW);
      expect(out).toEqual({ ok: true, lines: ["#1 12.50 coffee 2026-10-31"] });
      expect(readDoc(file).expenses).toHaveLength(1);
    });
  });

  it("add of a whole amount with a note prints two decimals and stores 500 cents", () => {
    withDir((dir) => {
      const file = path.join(dir, "l.json");
      const out = runAdd({ kind: "add", amountCents: 500, category: "travel", note: "taxi" }, file, NOW);
      expect(out).toEqual({ ok: true, lines: ["#1 5.00 travel 2026-10-31"] });
      expect(readDoc(file).expenses[0]).toMatchObject({ amount_cents: 500, category: "travel", note: "taxi" });
    });
  });
});

describe("add on a ledger with existing expenses", () => {
  it("add 0.05 tea after ids 1 and 2 prints #3 and keeps three expenses", () => {
    withDir((dir) => {
      const file = path.join(dir, "l.json");
      fs.writeFileSync(file, doc([1, 2]));
      const out = runAdd({ kind: "add", amountCents: 5, category: "tea" }, file, NOW);
      expect(out).toEqual({ ok: true, lines: ["#3 0.05 tea 2026-10-31"] });
      const stored = readDoc(file);
      expect(stored.expenses.map((e) => e.id)).toEqual([1, 2, 3]);
      expect(stored.expenses[2]).toMatchObject({ amount_cents: 5 });
    });
  });

  // @covers expense-ledger-cli:CTR-001
  it("add 1 food after ids 1, 2 and 3 prints a four-field line with id 4 and stores integer cents", () => {
    withDir((dir) => {
      const file = path.join(dir, "l.json");
      fs.writeFileSync(file, doc([1, 2, 3]));
      const out = runAdd({ kind: "add", amountCents: 100, category: "food" }, file, NOW);
      expect(out).toEqual({ ok: true, lines: ["#4 1.00 food 2026-10-31"] });
      const added = readDoc(file).expenses[3];
      expect(added).toMatchObject({ id: 4, amount_cents: 100 });
      expect(Number.isInteger(added?.amount_cents)).toBe(true);
    });
  });

  it("add assigns an id above every id already used even when an earlier id was removed", () => {
    withDir((dir) => {
      const file = path.join(dir, "l.json");
      fs.writeFileSync(file, doc([1, 2], 5));
      const out = runAdd({ kind: "add", amountCents: 100, category: "food" }, file, NOW);
      expect(out).toEqual({ ok: true, lines: ["#5 1.00 food 2026-10-31"] });
    });
  });
});

describe("add date", () => {
  // @covers expense-ledger-cli:BEH-005
  it("add without a date prints and stores the UTC day of the clock", () => {
    withDir((dir) => {
      const file = path.join(dir, "l.json");
      const out = runAdd({ kind: "add", amountCents: 1250, category: "coffee" }, file, new Date("2026-10-31T23:59:59Z"));
      expect(out).toEqual({ ok: true, lines: ["#1 12.50 coffee 2026-10-31"] });
      expect(readDoc(file).expenses[0]).toMatchObject({ date: "2026-10-31" });
    });
  });

  it("add one second after 00:00 UTC stores the next UTC day", () => {
    withDir((dir) => {
      const file = path.join(dir, "l.json");
      const out = runAdd({ kind: "add", amountCents: 5, category: "tea" }, file, new Date("2026-11-01T00:00:01Z"));
      expect(out).toEqual({ ok: true, lines: ["#1 0.05 tea 2026-11-01"] });
      expect(readDoc(file).expenses[0]).toMatchObject({ date: "2026-11-01" });
    });
  });

  it("add with an explicit date prints and stores it verbatim regardless of the clock", () => {
    withDir((dir) => {
      const file = path.join(dir, "l.json");
      const out = runAdd({ kind: "add", amountCents: 1250, category: "coffee", date: "2026-02-28" }, file, NOW);
      expect(out).toEqual({ ok: true, lines: ["#1 12.50 coffee 2026-02-28"] });
      expect(readDoc(file).expenses[0]).toMatchObject({ date: "2026-02-28" });
    });
  });
});

describe("add with an unreadable store", () => {
  it("add against a ledger file holding not json fails with E_UNREADABLE_STORE and leaves the bytes", () => {
    withDir((dir) => {
      const file = path.join(dir, "l.json");
      fs.writeFileSync(file, "not json");
      const out = runAdd({ kind: "add", amountCents: 1250, category: "coffee" }, file, NOW);
      expect(out.ok).toBe(false);
      expect(failure(out)).toEqual({ code: "E_UNREADABLE_STORE", text: `error: cannot read ${file}` });
      expect(fs.readFileSync(file, "utf8")).toBe("not json");
    });
  });

  it("add whose write to the ledger path fails is E_UNREADABLE_STORE", () => {
    withDir((dir) => {
      const file = path.join(dir, "missing-dir", "l.json");
      const out = runAdd({ kind: "add", amountCents: 1250, category: "coffee" }, file, NOW);
      expect(failure(out)).toEqual({ code: "E_UNREADABLE_STORE", text: `error: cannot read ${file}` });
    });
  });
});

describe("rm of an existing expense", () => {
  // @covers expense-ledger-cli:BEH-012
  it("rm 1 with ids 1 and 2 prints #1 removed and leaves only the expense with id 2 intact", () => {
    withDir((dir) => {
      const file = path.join(dir, "l.json");
      fs.writeFileSync(file, doc([1, 2]));
      const out = runRm({ kind: "rm", id: 1 }, file);
      expect(out).toEqual({ ok: true, lines: ["#1 removed"] });
      expect(readDoc(file).expenses).toEqual([
        { id: 2, amount_cents: 200, category: "food", date: "2026-01-02", note: "n2" },
      ]);
    });
  });

  it.each([
    { id: 1, remaining: [2, 3] },
    { id: 3, remaining: [1, 2] },
  ])("rm $id with ids 1, 2 and 3 leaves ids $remaining", ({ id, remaining }) => {
    withDir((dir) => {
      const file = path.join(dir, "l.json");
      fs.writeFileSync(file, doc([1, 2, 3]));
      const out = runRm({ kind: "rm", id }, file);
      expect(out).toEqual({ ok: true, lines: [`#${id} removed`] });
      expect(readDoc(file).expenses.map((e) => e.id)).toEqual(remaining);
    });
  });

  // @covers expense-ledger-cli:CTR-004
  it("rm removes exactly the expense with the given id and prints #<id> removed", () => {
    withDir((dir) => {
      const file = path.join(dir, "l.json");
      fs.writeFileSync(file, doc([1, 2, 3]));
      const out = runRm({ kind: "rm", id: 2 }, file);
      expect(out).toEqual({ ok: true, lines: ["#2 removed"] });
      expect(readDoc(file).expenses.map((e) => e.id)).toEqual([1, 3]);
    });
  });
});

describe("rm of an unknown expense id", () => {
  // @covers expense-ledger-cli:BEH-013
  it("rm 7 with only id 1 fails with E_NO_EXPENSE 'error: no expense #7' and leaves the ledger bytes", () => {
    withDir((dir) => {
      const file = path.join(dir, "l.json");
      const before = doc([1]);
      fs.writeFileSync(file, before);
      const out = runRm({ kind: "rm", id: 7 }, file);
      expect(out.ok).toBe(false);
      expect(failure(out)).toEqual({ code: "E_NO_EXPENSE", text: "error: no expense #7" });
      expect(fs.readFileSync(file, "utf8")).toBe(before);
    });
  });

  it("rm 1 against an absent ledger file is E_NO_EXPENSE and does not create the file", () => {
    withDir((dir) => {
      const file = path.join(dir, "l.json");
      const out = runRm({ kind: "rm", id: 1 }, file);
      expect(failure(out)).toEqual({ code: "E_NO_EXPENSE", text: "error: no expense #1" });
      expect(fs.existsSync(file)).toBe(false);
    });
  });

  it("rm 4 above the highest id 3 is E_NO_EXPENSE", () => {
    withDir((dir) => {
      const file = path.join(dir, "l.json");
      const before = doc([1, 2, 3]);
      fs.writeFileSync(file, before);
      const out = runRm({ kind: "rm", id: 4 }, file);
      expect(failure(out)).toEqual({ code: "E_NO_EXPENSE", text: "error: no expense #4" });
      expect(fs.readFileSync(file, "utf8")).toBe(before);
    });
  });

  it("rm 2 twice reports E_NO_EXPENSE the second time", () => {
    withDir((dir) => {
      const file = path.join(dir, "l.json");
      fs.writeFileSync(file, doc([1, 2]));
      const first = runRm({ kind: "rm", id: 2 }, file);
      expect(first).toEqual({ ok: true, lines: ["#2 removed"] });
      const after = fs.readFileSync(file, "utf8");
      const second = runRm({ kind: "rm", id: 2 }, file);
      expect(failure(second)).toEqual({ code: "E_NO_EXPENSE", text: "error: no expense #2" });
      expect(fs.readFileSync(file, "utf8")).toBe(after);
    });
  });
});

describe("rm with an unreadable store", () => {
  it("rm 1 against a ledger file holding x fails with E_UNREADABLE_STORE and leaves the bytes", () => {
    withDir((dir) => {
      const file = path.join(dir, "l.json");
      fs.writeFileSync(file, "x");
      const out = runRm({ kind: "rm", id: 1 }, file);
      expect(failure(out)).toEqual({ code: "E_UNREADABLE_STORE", text: `error: cannot read ${file}` });
      expect(fs.readFileSync(file, "utf8")).toBe("x");
    });
  });
});
