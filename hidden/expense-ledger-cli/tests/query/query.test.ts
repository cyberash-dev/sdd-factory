import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runList, runSummary, runExport } from "../../src/query/index.js";
import { renderDiagnostic } from "../../src/diagnostics/index.js";

interface Fx {
  id: number;
  date: string;
  cents: number;
  category: string;
  note?: string;
}

function withLedger(content: Fx[] | string | null, fn: (p: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-query-"));
  const p = path.join(dir, "ledger.json");
  try {
    if (typeof content === "string") {
      fs.writeFileSync(p, content);
    } else if (content !== null) {
      const doc = {
        next_id: content.reduce((m, e) => Math.max(m, e.id), 0) + 1,
        expenses: content.map((e) => ({
          id: e.id,
          amount_cents: e.cents,
          category: e.category,
          date: e.date,
          ...(e.note === undefined ? {} : { note: e.note }),
        })),
      };
      fs.writeFileSync(p, JSON.stringify(doc));
    }
    fn(p);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function linesOf(o: { ok: boolean; lines?: readonly string[] }): readonly string[] {
  expect(o.ok).toBe(true);
  return o.lines ?? [];
}

function expectUnreadable(o: ReturnType<typeof runList>, p: string): void {
  expect(o.ok).toBe(false);
  if (!o.ok) {
    expect(o.error.code).toBe("E_UNREADABLE_STORE");
    expect(renderDiagnostic(o.error)).toBe(`error: cannot read ${p}`);
  }
}

const MIXED: Fx[] = [
  { id: 1, date: "2026-02-01", cents: 1250, category: "food" },
  { id: 2, date: "2026-01-31", cents: 500, category: "travel", note: "taxi" },
  { id: 3, date: "2026-01-31", cents: 100, category: "food" },
];

describe("runList", () => {
  // @covers expense-ledger-cli:BEH-006
  it("prints one line per expense ordered by date then id with the note suffix", () => {
    withLedger(MIXED, (p) => {
      expect(linesOf(runList({ kind: "list" }, p))).toEqual([
        "#2 2026-01-31 5.00 travel — taxi",
        "#3 2026-01-31 1.00 food",
        "#1 2026-02-01 12.50 food",
      ]);
    });
  });

  it("omits the note separator for an expense without a note", () => {
    withLedger(
      [
        { id: 1, date: "2026-01-01", cents: 1250, category: "food" },
        { id: 2, date: "2026-01-02", cents: 500, category: "travel", note: "taxi" },
      ],
      (p) => {
        expect(linesOf(runList({ kind: "list" }, p))).toEqual([
          "#1 2026-01-01 12.50 food",
          "#2 2026-01-02 5.00 travel — taxi",
        ]);
      },
    );
  });

  // @covers expense-ledger-cli:INV-004
  it("orders by date even when dates were entered in reverse and by id within one date", () => {
    withLedger(
      [
        { id: 1, date: "2026-03-01", cents: 100, category: "food" },
        { id: 2, date: "2026-01-01", cents: 200, category: "food" },
        { id: 4, date: "2026-01-05", cents: 300, category: "food" },
        { id: 3, date: "2026-01-05", cents: 400, category: "food" },
      ],
      (p) => {
        expect(linesOf(runList({ kind: "list" }, p))).toEqual([
          "#2 2026-01-01 2.00 food",
          "#3 2026-01-05 4.00 food",
          "#4 2026-01-05 3.00 food",
          "#1 2026-03-01 1.00 food",
        ]);
      },
    );
  });

  it("prints exactly one line for a single expense", () => {
    withLedger([{ id: 1, date: "2026-01-05", cents: 100, category: "food" }], (p) => {
      expect(linesOf(runList({ kind: "list" }, p))).toEqual(["#1 2026-01-05 1.00 food"]);
    });
  });

  // @covers expense-ledger-cli:BEH-007
  it("returns only food expenses inside the range with both boundary days included", () => {
    withLedger(
      [
        { id: 1, date: "2026-01-01", cents: 100, category: "food" },
        { id: 2, date: "2026-01-31", cents: 200, category: "food" },
        { id: 3, date: "2026-02-01", cents: 300, category: "food" },
        { id: 4, date: "2026-01-15", cents: 400, category: "travel" },
      ],
      (p) => {
        expect(
          linesOf(runList({ kind: "list", category: "food", from: "2026-01-01", to: "2026-01-31" }, p)),
        ).toEqual(["#1 2026-01-01 1.00 food", "#2 2026-01-31 2.00 food"]);
      },
    );
  });

  it.each([
    ["on --from", "2026-01-01", ["#1 2026-01-01 1.00 food"]],
    ["on --to", "2026-01-31", ["#1 2026-01-31 1.00 food"]],
    ["one day before --from", "2025-12-31", []],
    ["one day after --to", "2026-02-01", []],
  ])("handles an expense %s", (_name, date, expected) => {
    withLedger([{ id: 1, date, cents: 100, category: "food" }], (p) => {
      expect(linesOf(runList({ kind: "list", from: "2026-01-01", to: "2026-01-31" }, p))).toEqual(expected);
    });
  });

  it("matches nothing for an inverted range", () => {
    withLedger([{ id: 1, date: "2026-01-01", cents: 100, category: "food" }], (p) => {
      expect(linesOf(runList({ kind: "list", from: "2026-02-01", to: "2026-01-01" }, p))).toEqual([]);
    });
  });

  it("matches nothing for an unmatched category inside a range", () => {
    withLedger([{ id: 1, date: "2026-01-10", cents: 100, category: "travel" }], (p) => {
      expect(
        linesOf(runList({ kind: "list", category: "supplies", from: "2026-01-01", to: "2026-01-31" }, p)),
      ).toEqual([]);
    });
  });

  it("applies only --from when --to is absent and only --to when --from is absent", () => {
    withLedger(MIXED, (p) => {
      expect(linesOf(runList({ kind: "list", from: "2026-02-01" }, p))).toEqual(["#1 2026-02-01 12.50 food"]);
      expect(linesOf(runList({ kind: "list", to: "2026-01-31" }, p))).toEqual([
        "#2 2026-01-31 5.00 travel — taxi",
        "#3 2026-01-31 1.00 food",
      ]);
    });
  });

  // @covers expense-ledger-cli:BEH-008
  it("writes no line for a category filter that matches nothing", () => {
    withLedger([{ id: 1, date: "2026-01-01", cents: 100, category: "travel" }], (p) => {
      expect(linesOf(runList({ kind: "list", category: "food" }, p))).toEqual([]);
    });
  });

  it("writes no line for an absent ledger file and does not create it", () => {
    withLedger(null, (p) => {
      expect(linesOf(runList({ kind: "list", category: "food" }, p))).toEqual([]);
      expect(fs.existsSync(p)).toBe(false);
    });
  });

  it("prints exactly one line when the category matches", () => {
    withLedger([{ id: 1, date: "2026-01-01", cents: 100, category: "travel" }], (p) => {
      expect(linesOf(runList({ kind: "list", category: "travel" }, p))).toEqual(["#1 2026-01-01 1.00 travel"]);
    });
  });

  // @covers expense-ledger-cli:CTR-002
  it("prints category-filtered lines in the contract layout and reports an unreadable store", () => {
    withLedger(
      [
        { id: 1, date: "2026-02-01", cents: 1250, category: "food" },
        { id: 2, date: "2026-01-31", cents: 500, category: "travel", note: "taxi" },
      ],
      (p) => {
        expect(linesOf(runList({ kind: "list", category: "food" }, p))).toEqual(["#1 2026-02-01 12.50 food"]);
      },
    );
    withLedger("{", (p) => {
      expectUnreadable(runList({ kind: "list" }, p), p);
    });
  });

  it("rejects a document that violates the schema as an unreadable store", () => {
    withLedger('{"next_id": 1}', (p) => {
      expectUnreadable(runList({ kind: "list" }, p), p);
    });
  });
});

describe("runSummary", () => {
  // @covers expense-ledger-cli:BEH-009
  it("prints category totals then the total line", () => {
    withLedger(
      [
        { id: 1, date: "2026-01-01", cents: 1000, category: "food" },
        { id: 2, date: "2026-01-02", cents: 2000, category: "food" },
        { id: 3, date: "2026-01-03", cents: 1250, category: "travel" },
      ],
      (p) => {
        expect(linesOf(runSummary({ kind: "summary" }, p))).toEqual(["food 30.00", "travel 12.50", "total 42.50"]);
      },
    );
  });

  it("orders a larger later category before a smaller earlier one", () => {
    withLedger(
      [
        { id: 1, date: "2026-01-01", cents: 1250, category: "food" },
        { id: 2, date: "2026-01-02", cents: 3000, category: "travel" },
      ],
      (p) => {
        expect(linesOf(runSummary({ kind: "summary" }, p))).toEqual(["travel 30.00", "food 12.50", "total 42.50"]);
      },
    );
  });

  // @covers expense-ledger-cli:CTR-003
  it("prints one category line and the total line, and reports an unreadable store", () => {
    withLedger([{ id: 1, date: "2026-01-01", cents: 3000, category: "food" }], (p) => {
      expect(linesOf(runSummary({ kind: "summary" }, p))).toEqual(["food 30.00", "total 30.00"]);
    });
    withLedger("]", (p) => {
      expectUnreadable(runSummary({ kind: "summary" }, p), p);
    });
  });

  // @covers expense-ledger-cli:INV-005
  it("orders categories by total descending then name ascending with the total line last", () => {
    withLedger(
      [
        { id: 1, date: "2026-01-01", cents: 1000, category: "food" },
        { id: 2, date: "2026-01-01", cents: 3000, category: "home" },
        { id: 3, date: "2026-01-01", cents: 2000, category: "travel" },
      ],
      (p) => {
        expect(linesOf(runSummary({ kind: "summary" }, p))).toEqual([
          "home 30.00",
          "travel 20.00",
          "food 10.00",
          "total 60.00",
        ]);
      },
    );
  });

  it("orders categories with equal totals alphabetically", () => {
    withLedger(
      [
        { id: 1, date: "2026-01-01", cents: 2500, category: "home" },
        { id: 2, date: "2026-01-01", cents: 2500, category: "food" },
      ],
      (p) => {
        expect(linesOf(runSummary({ kind: "summary" }, p))).toEqual(["food 25.00", "home 25.00", "total 50.00"]);
      },
    );
  });

  // @covers expense-ledger-cli:BEH-010
  it("counts only the expenses of the requested month", () => {
    withLedger(
      [
        { id: 1, date: "2026-02-10", cents: 1250, category: "food" },
        { id: 2, date: "2026-03-01", cents: 500, category: "travel" },
      ],
      (p) => {
        expect(linesOf(runSummary({ kind: "summary", month: "2026-02" }, p))).toEqual(["food 12.50", "total 12.50"]);
      },
    );
  });

  it.each([
    ["first day of the month", "2026-02-01", ["food 1.00", "total 1.00"]],
    ["last day of the month", "2026-02-28", ["food 1.00", "total 1.00"]],
    ["last day of the previous month", "2026-01-31", ["total 0.00"]],
    ["first day of the next month", "2026-03-01", ["total 0.00"]],
  ])("handles an expense on the %s", (_name, date, expected) => {
    withLedger([{ id: 1, date, cents: 100, category: "food" }], (p) => {
      expect(linesOf(runSummary({ kind: "summary", month: "2026-02" }, p))).toEqual(expected);
    });
  });

  it("prints only the total line for an absent ledger with a month filter", () => {
    withLedger(null, (p) => {
      expect(linesOf(runSummary({ kind: "summary", month: "2026-02" }, p))).toEqual(["total 0.00"]);
    });
  });

  // @covers expense-ledger-cli:BEH-011
  it("prints exactly `total 0.00` for an absent ledger file and leaves it absent", () => {
    withLedger(null, (p) => {
      expect(linesOf(runSummary({ kind: "summary" }, p))).toEqual(["total 0.00"]);
      expect(fs.existsSync(p)).toBe(false);
    });
  });

  it("prints exactly `total 0.00` for a ledger with an empty expense array", () => {
    withLedger('{"next_id":1,"expenses":[]}', (p) => {
      expect(linesOf(runSummary({ kind: "summary" }, p))).toEqual(["total 0.00"]);
    });
  });
});

describe("runExport", () => {
  // @covers expense-ledger-cli:BEH-014
  it("prints the header and one quoted row per expense ordered by id", () => {
    withLedger(
      [
        { id: 1, date: "2026-01-05", cents: 1250, category: "food", note: "lunch, with team" },
        { id: 2, date: "2026-01-03", cents: 500, category: "travel", note: 'the "big" one' },
        { id: 3, date: "2026-01-04", cents: 100, category: "food" },
      ],
      (p) => {
        expect(linesOf(runExport(p))).toEqual([
          "id,date,amount,category,note",
          '1,2026-01-05,12.50,food,"lunch, with team"',
          '2,2026-01-03,5.00,travel,"the ""big"" one"',
          "3,2026-01-04,1.00,food,",
        ]);
      },
    );
  });

  it("keeps a line break inside one double-quoted note field", () => {
    withLedger([{ id: 1, date: "2026-01-05", cents: 100, category: "food", note: "first\nsecond" }], (p) => {
      expect(linesOf(runExport(p)).join("\n")).toBe(
        'id,date,amount,category,note\n1,2026-01-05,1.00,food,"first\nsecond"',
      );
    });
  });

  it("quotes a note holding a carriage return", () => {
    withLedger([{ id: 1, date: "2026-01-05", cents: 100, category: "food", note: "a\rb" }], (p) => {
      expect(linesOf(runExport(p)).join("\n")).toBe('id,date,amount,category,note\n1,2026-01-05,1.00,food,"a\rb"');
    });
  });

  it("orders rows by id rather than date", () => {
    withLedger(
      [
        { id: 4, date: "2026-01-01", cents: 100, category: "food" },
        { id: 5, date: "2025-12-01", cents: 100, category: "food" },
      ],
      (p) => {
        expect(linesOf(runExport(p))).toEqual([
          "id,date,amount,category,note",
          "4,2026-01-01,1.00,food,",
          "5,2025-12-01,1.00,food,",
        ]);
      },
    );
  });

  // @covers expense-ledger-cli:CTR-005
  it("prints a lone header for an absent ledger and reports an unreadable store", () => {
    withLedger(null, (p) => {
      expect(linesOf(runExport(p))).toEqual(["id,date,amount,category,note"]);
      expect(fs.existsSync(p)).toBe(false);
    });
    withLedger("[", (p) => {
      expectUnreadable(runExport(p), p);
    });
  });

  it("leaves a note without comma, quote or line break unquoted", () => {
    withLedger([{ id: 1, date: "2026-01-05", cents: 100, category: "food", note: "plain note" }], (p) => {
      expect(linesOf(runExport(p))).toEqual(["id,date,amount,category,note", "1,2026-01-05,1.00,food,plain note"]);
    });
  });

  // @covers expense-ledger-cli:INV-006
  it("orders rows by strictly increasing id when ids are not in date or file order", () => {
    withLedger(
      [
        { id: 3, date: "2026-02-01", cents: 300, category: "food" },
        { id: 1, date: "2026-03-01", cents: 100, category: "food" },
        { id: 2, date: "2026-01-01", cents: 200, category: "food" },
      ],
      (p) => {
        expect(linesOf(runExport(p))).toEqual([
          "id,date,amount,category,note",
          "1,2026-03-01,1.00,food,",
          "2,2026-01-01,2.00,food,",
          "3,2026-02-01,3.00,food,",
        ]);
      },
    );
  });

  it("prints the header and one row for a single expense", () => {
    withLedger([{ id: 1, date: "2026-01-05", cents: 100, category: "food" }], (p) => {
      expect(linesOf(runExport(p))).toEqual(["id,date,amount,category,note", "1,2026-01-05,1.00,food,"]);
    });
  });
});
