import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  addExpense,
  readLedger,
  removeExpense,
  resolveLedgerPath,
  writeLedger,
} from "../../src/store/index.js";
import type { Expense, Ledger } from "../../src/store/index.js";

function withDir(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-store-"));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const coffee = { amountCents: 1250, category: "coffee", date: "2026-01-01" };
const travel = { amountCents: 500, category: "travel", date: "2026-01-02" };

function exp(id: number): Expense {
  return { id, amountCents: 100, category: "food", date: "2026-01-01" };
}

describe("ledger path resolution", () => {
  // @covers expense-ledger-cli:CTR-007
  it("resolves the ledger path to LEDGER_FILE when the variable is set", () => {
    expect(resolveLedgerPath({ LEDGER_FILE: "/tmp/x/store.json" })).toBe("/tmp/x/store.json");
  });

  it("resolves the ledger path to ./ledger.json in the working directory when LEDGER_FILE is unset", () => {
    const p = resolveLedgerPath({});
    expect(path.resolve(p)).toBe(path.join(process.cwd(), "ledger.json"));
  });

  // @covers expense-ledger-cli:EXT-001
  it("takes the ledger path from the injected environment object and never from process.env", () => {
    const saved = process.env.LEDGER_FILE;
    process.env.LEDGER_FILE = "/tmp/from-process-env.json";
    try {
      expect(resolveLedgerPath({ LEDGER_FILE: "/tmp/injected.json" })).toBe("/tmp/injected.json");
      expect(path.resolve(resolveLedgerPath({}))).toBe(path.join(process.cwd(), "ledger.json"));
    } finally {
      if (saved === undefined) delete process.env.LEDGER_FILE;
      else process.env.LEDGER_FILE = saved;
    }
  });
});

describe("ledger document storage", () => {
  it("writes the ledger document with integer cents, next_id and expenses as exact bytes", () => {
    withDir((dir) => {
      const p = path.join(dir, "store.json");
      const ledger: Ledger = { nextId: 2, expenses: [{ id: 1, ...coffee }] };
      expect(writeLedger(p, ledger)).toEqual({ ok: true });
      const expected =
        '{\n  "next_id": 2,\n  "expenses": [\n    {\n      "id": 1,\n      "amount_cents": 1250,\n      "category": "coffee",\n      "date": "2026-01-01"\n    }\n  ]\n}\n';
      expect(fs.readFileSync(p, "utf8")).toBe(expected);
    });
  });

  it("stores the note only when the expense has one", () => {
    withDir((dir) => {
      const p = path.join(dir, "store.json");
      writeLedger(p, {
        nextId: 3,
        expenses: [
          { id: 1, ...coffee, note: "with milk" },
          { id: 2, ...travel },
        ],
      });
      const doc = JSON.parse(fs.readFileSync(p, "utf8"));
      expect(doc.expenses[0].note).toBe("with milk");
      expect("note" in doc.expenses[1]).toBe(false);
    });
  });

  it("reads back the ledger it wrote", () => {
    withDir((dir) => {
      const p = path.join(dir, "store.json");
      const ledger: Ledger = { nextId: 3, expenses: [{ id: 1, ...coffee, note: "n" }, { id: 2, ...travel }] };
      writeLedger(p, ledger);
      expect(readLedger(p)).toEqual({ ok: true, ledger, exists: true });
    });
  });

  it("reports a write into a missing directory as a failure carrying the path", () => {
    withDir((dir) => {
      const p = path.join(dir, "missing", "ledger.json");
      expect(writeLedger(p, { nextId: 1, expenses: [] })).toEqual({ ok: false, path: p });
    });
  });

  it("reads a bare array file of an older version with next_id one above the highest id", () => {
    withDir((dir) => {
      const p = path.join(dir, "old.json");
      fs.writeFileSync(
        p,
        JSON.stringify([
          { id: 1, amount_cents: 100, category: "food", date: "2026-01-01" },
          { id: 4, amount_cents: 200, category: "food", date: "2026-01-02", note: "x" },
        ]),
        "utf8",
      );
      expect(readLedger(p)).toEqual({
        ok: true,
        exists: true,
        ledger: {
          nextId: 5,
          expenses: [
            { id: 1, amountCents: 100, category: "food", date: "2026-01-01" },
            { id: 4, amountCents: 200, category: "food", date: "2026-01-02", note: "x" },
          ],
        },
      });
    });
  });

  it("reads an empty bare array file with next_id 1", () => {
    withDir((dir) => {
      const p = path.join(dir, "old.json");
      fs.writeFileSync(p, "[]", "utf8");
      expect(readLedger(p)).toEqual({ ok: true, exists: true, ledger: { nextId: 1, expenses: [] } });
    });
  });
});

describe("absent ledger file", () => {
  it("reads an absent ledger file as the empty ledger and never creates it", () => {
    withDir((dir) => {
      const p = path.join(dir, "ledger.json");
      expect(readLedger(p)).toEqual({ ok: true, exists: false, ledger: { nextId: 1, expenses: [] } });
      expect(fs.existsSync(p)).toBe(false);
      expect(fs.readdirSync(dir)).toEqual([]);
    });
  });

  // @covers expense-ledger-cli:BEH-018
  it("creates the ledger file on the first write in an existing directory", () => {
    withDir((dir) => {
      const sub = path.join(dir, "sub");
      fs.mkdirSync(sub);
      const p = path.join(sub, "ledger.json");
      const read = readLedger(p);
      expect(read).toEqual({ ok: true, exists: false, ledger: { nextId: 1, expenses: [] } });
      if (!read.ok) return;
      const { ledger } = addExpense(read.ledger, travel);
      expect(writeLedger(p, ledger)).toEqual({ ok: true });
      expect(fs.existsSync(p)).toBe(true);
      const doc = JSON.parse(fs.readFileSync(p, "utf8"));
      expect(doc.expenses).toEqual([{ id: 1, amount_cents: 500, category: "travel", date: "2026-01-02" }]);
      expect(fs.readdirSync(dir)).toEqual(["sub"]);
    });
  });
});

describe("unreadable ledger file", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["truncated JSON text", '[{"id":1,'],
    ["zero bytes", ""],
    ["object without the ledger fields", '{"expenses":[]}'],
    ["JSON null", "null"],
    ["expense with a string amount", '[{"id":1,"amount":"12.50","category":"food","date":"2026-01-01"}]'],
    ["fractional amount_cents", '[{"id":1,"amount_cents":12.5,"category":"food","date":"2026-01-01"}]'],
    ["invalid category", '[{"id":1,"amount_cents":100,"category":"Food","date":"2026-01-01"}]'],
    ["impossible calendar date", '[{"id":1,"amount_cents":100,"category":"food","date":"2026-02-30"}]'],
    ["duplicate ids", '[{"id":1,"amount_cents":100,"category":"a","date":"2026-01-01"},{"id":1,"amount_cents":100,"category":"a","date":"2026-01-01"}]'],
    ["ledger object with mistyped next_id", '{"next_id":"2","expenses":[]}'],
  ];

  // @covers expense-ledger-cli:BEH-017
  it.each(cases)("reports %s as unreadable with the path and leaves the bytes unchanged", (_name, bytes) => {
    withDir((dir) => {
      const p = path.join(dir, "ledger.json");
      fs.writeFileSync(p, bytes, "utf8");
      expect(readLedger(p)).toEqual({ ok: false, path: p });
      expect(fs.readFileSync(p, "utf8")).toBe(bytes);
    });
  });

  it("reports a well-formed ledger object as readable", () => {
    withDir((dir) => {
      const p = path.join(dir, "ledger.json");
      fs.writeFileSync(
        p,
        '{"next_id":2,"expenses":[{"id":1,"amount_cents":100,"category":"food","date":"2026-01-01"}]}',
        "utf8",
      );
      expect(readLedger(p)).toEqual({
        ok: true,
        exists: true,
        ledger: { nextId: 2, expenses: [{ id: 1, amountCents: 100, category: "food", date: "2026-01-01" }] },
      });
    });
  });
});

describe("expense id allocation", () => {
  // @covers expense-ledger-cli:INV-001
  it("gives the first expense of an empty ledger the id 1", () => {
    const r = addExpense({ nextId: 1, expenses: [] }, coffee);
    expect(r.id).toBe(1);
    expect(r.ledger).toEqual({ nextId: 2, expenses: [{ id: 1, ...coffee }] });
  });

  it("numbers three successive adds 1, 2 and 3", () => {
    const a = addExpense({ nextId: 1, expenses: [] }, coffee);
    const b = addExpense(a.ledger, coffee);
    const c = addExpense(b.ledger, coffee);
    expect([a.id, b.id, c.id]).toEqual([1, 2, 3]);
    expect(c.ledger.expenses.map((e) => e.id)).toEqual([1, 2, 3]);
  });

  it("does not reuse the id of the removed highest expense", () => {
    const removed = removeExpense({ nextId: 3, expenses: [exp(1), exp(2)] }, 2);
    expect(removed).toEqual({ nextId: 3, expenses: [exp(1)] });
    if (removed === null) return;
    const r = addExpense(removed, travel);
    expect(r.id).toBe(3);
    expect(r.ledger.expenses.map((e) => e.id)).toEqual([1, 3]);
  });

  it("assigns an id above every earlier id after removing a middle expense", () => {
    const removed = removeExpense({ nextId: 4, expenses: [exp(1), exp(2), exp(3)] }, 2);
    expect(removed).not.toBeNull();
    if (removed === null) return;
    expect(addExpense(removed, travel).id).toBe(4);
  });

  it("keeps the high-water mark across a write and a read of the ledger file", () => {
    withDir((dir) => {
      const p = path.join(dir, "ledger.json");
      writeLedger(p, { nextId: 3, expenses: [exp(1), exp(2)] });
      const first = readLedger(p);
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const removed = removeExpense(first.ledger, 2);
      expect(removed).not.toBeNull();
      if (removed === null) return;
      writeLedger(p, removed);
      const second = readLedger(p);
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(addExpense(second.ledger, travel).id).toBe(3);
    });
  });

  it("allocates above the highest stored id when the file's next_id is not above it", () => {
    withDir((dir) => {
      const p = path.join(dir, "ledger.json");
      fs.writeFileSync(
        p,
        '{"next_id":1,"expenses":[{"id":5,"amount_cents":100,"category":"food","date":"2026-01-01"}]}',
        "utf8",
      );
      const r = readLedger(p);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(addExpense(r.ledger, travel).id).toBe(6);
    });
  });

  it("returns null when removing an id that is not in the ledger", () => {
    expect(removeExpense({ nextId: 3, expenses: [exp(1), exp(2)] }, 7)).toBeNull();
    expect(removeExpense({ nextId: 3, expenses: [exp(1)] }, 2)).toBeNull();
  });
});
