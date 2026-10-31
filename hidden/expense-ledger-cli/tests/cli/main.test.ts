import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type CliIo } from "../../src/index.js";

const NOW = new Date("2026-10-31T23:59:59.000Z");
const TODAY = "2026-10-31";

interface Run {
  readonly code: number;
  readonly out: string[];
  readonly err: string[];
}

function workspace(): { dir: string; ledger: string } {
  const dir = mkdtempSync(join(tmpdir(), "ledger-cli-"));
  return { dir, ledger: join(dir, "ledger.json") };
}

async function run(ledger: string, ...argv: string[]): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    stdout: (l) => out.push(l),
    stderr: (l) => err.push(l),
    env: { LEDGER_FILE: ledger },
    now: () => NOW,
  };
  const code = await main(argv, io);
  return { code, out, err };
}

function ids(ledger: string): number[] {
  const doc = JSON.parse(readFileSync(ledger, "utf8")) as { expenses: { id: number }[] };
  return doc.expenses.map((e) => e.id);
}

function seed(ledger: string, nextId: number, idList: number[]): void {
  const expenses = idList.map((id) => ({ id, amount_cents: 100 * id, category: "food", date: "2026-01-10" }));
  writeFileSync(ledger, JSON.stringify({ next_id: nextId, expenses }), "utf8");
}

describe("main: add, list, summary, export and rm sequence", () => {
  // @covers expense-ledger-cli:SCN-001
  it("runs the six commands in order and leaves only expense 2 in the ledger file", async () => {
    const { ledger } = workspace();

    expect(existsSync(ledger)).toBe(false);
    const a1 = await run(ledger, "add", "12.50", "food");
    expect(a1).toEqual({ code: 0, out: [`#1 12.50 food ${TODAY}`], err: [] });
    expect(existsSync(ledger)).toBe(true);

    const a2 = await run(ledger, "add", "5", "travel", "--note", "taxi");
    expect(a2).toEqual({ code: 0, out: [`#2 5.00 travel ${TODAY}`], err: [] });

    const l = await run(ledger, "list");
    expect(l).toEqual({
      code: 0,
      out: [`#1 ${TODAY} 12.50 food`, `#2 ${TODAY} 5.00 travel — taxi`],
      err: [],
    });

    const s = await run(ledger, "summary");
    expect(s).toEqual({ code: 0, out: ["food 12.50", "travel 5.00", "total 17.50"], err: [] });

    const e = await run(ledger, "export", "--csv");
    expect(e).toEqual({
      code: 0,
      out: ["id,date,amount,category,note", `1,${TODAY},12.50,food,`, `2,${TODAY},5.00,travel,taxi`],
      err: [],
    });

    const r = await run(ledger, "rm", "1");
    expect(r).toEqual({ code: 0, out: ["#1 removed"], err: [] });
    expect(ids(ledger)).toEqual([2]);

    const e2 = await run(ledger, "export", "--csv");
    expect(e2).toEqual({
      code: 0,
      out: ["id,date,amount,category,note", `2,${TODAY},5.00,travel,taxi`],
      err: [],
    });
  });

  it("numbers the adds 1 then 2 in a single expense ledger", async () => {
    const { ledger } = workspace();
    const a1 = await run(ledger, "add", "12.50", "food");
    const a2 = await run(ledger, "add", "5", "travel");
    expect(a1.out).toEqual([`#1 12.50 food ${TODAY}`]);
    expect(a2.out).toEqual([`#2 5.00 travel ${TODAY}`]);
    expect([a1.code, a2.code]).toEqual([0, 0]);
  });

  it("continues from a ledger holding one food expense dated 2026-01-10 with two categories", async () => {
    const { ledger } = workspace();
    writeFileSync(
      ledger,
      JSON.stringify({ next_id: 2, expenses: [{ id: 1, amount_cents: 1250, category: "food", date: "2026-01-10" }] }),
      "utf8",
    );
    const a2 = await run(ledger, "add", "12.50", "food");
    const a3 = await run(ledger, "add", "5", "travel", "--note", "taxi");
    expect(a2.out).toEqual([`#2 12.50 food ${TODAY}`]);
    expect(a3.out).toEqual([`#3 5.00 travel ${TODAY}`]);
    const s = await run(ledger, "summary");
    expect(s.out).toEqual(["food 25.00", "travel 5.00", "total 30.00"]);
    const r = await run(ledger, "rm", "2");
    expect(r).toEqual({ code: 0, out: ["#2 removed"], err: [] });
    expect(ids(ledger)).toEqual([1, 3]);
  });
});

describe("main: expense ids are never reused", () => {
  // @covers expense-ledger-cli:SCN-002
  it("gives id 3 to the add after rm 2 on a ledger holding ids 1 and 2", async () => {
    const { ledger } = workspace();
    seed(ledger, 3, [1, 2]);
    const r = await run(ledger, "rm", "2");
    expect(r).toEqual({ code: 0, out: ["#2 removed"], err: [] });
    const a = await run(ledger, "add", "5", "travel");
    expect(a).toEqual({ code: 0, out: [`#3 5.00 travel ${TODAY}`], err: [] });
    const l = await run(ledger, "list");
    expect(l.out).toEqual([`#1 2026-01-10 1.00 food`, `#3 ${TODAY} 5.00 travel`]);
    expect(ids(ledger)).toEqual([1, 3]);
  });

  it("gives an id above 3 to the add after removing the middle id 2", async () => {
    const { ledger } = workspace();
    seed(ledger, 4, [1, 2, 3]);
    await run(ledger, "rm", "2");
    const a = await run(ledger, "add", "5", "travel");
    expect(a.code).toBe(0);
    const m = /^#(\d+) 5\.00 travel 2026-10-31$/.exec(a.out[0] ?? "");
    expect(m).not.toBeNull();
    expect(Number(m?.[1])).toBeGreaterThan(3);
    const got = ids(ledger);
    expect(got).toHaveLength(3);
    expect(got.slice(0, 2)).toEqual([1, 3]);
  });

  it("gives ids 4 and 5 to two adds after rm 3 on a ledger holding ids 1, 2 and 3", async () => {
    const { ledger } = workspace();
    seed(ledger, 4, [1, 2, 3]);
    await run(ledger, "rm", "3");
    const a = await run(ledger, "add", "5", "travel");
    const b = await run(ledger, "add", "1", "food");
    expect(a.out).toEqual([`#4 5.00 travel ${TODAY}`]);
    expect(b.out).toEqual([`#5 1.00 food ${TODAY}`]);
    expect(ids(ledger)).toEqual([1, 2, 4, 5]);
  });
});

describe("main: read-only commands on an absent ledger file", () => {
  async function readOnlySequence(ledger: string): Promise<void> {
    const l = await run(ledger, "list");
    expect(l).toEqual({ code: 0, out: [], err: [] });
    const s = await run(ledger, "summary");
    expect(s).toEqual({ code: 0, out: ["total 0.00"], err: [] });
    const e = await run(ledger, "export", "--csv");
    expect(e).toEqual({ code: 0, out: ["id,date,amount,category,note"], err: [] });
    expect(existsSync(ledger)).toBe(false);
  }

  // @covers expense-ledger-cli:SCN-003
  it("exits 0 for list, summary and export and never creates the ledger file", async () => {
    const { ledger } = workspace();
    await readOnlySequence(ledger);
  });

  it("keeps LEDGER_FILE absent when it points into an existing directory", async () => {
    const { dir } = workspace();
    const sub = join(dir, "data");
    mkdirSync(sub);
    await readOnlySequence(join(sub, "ledger.json"));
  });
});

describe("main: failure outcomes", () => {
  it("prints the usage text for --help, exits 0 and does not create the ledger file", async () => {
    const { ledger } = workspace();
    const r = await run(ledger, "--help");
    expect(r.code).toBe(0);
    expect(r.err).toEqual([]);
    const text = r.out.join("\n");
    for (const word of ["add", "list", "summary", "rm", "export", "--help"]) expect(text).toContain(word);
    expect(existsSync(ledger)).toBe(false);
  });

  it("reports a usage error with exit code 2 and no stdout when no command is given", async () => {
    const { ledger } = workspace();
    const r = await run(ledger);
    expect(r).toEqual({ code: 2, out: [], err: ["usage: no command given"] });
  });

  it("reports a usage error for an unknown command", async () => {
    const { ledger } = workspace();
    const r = await run(ledger, "frobnicate");
    expect(r).toEqual({ code: 2, out: [], err: ['usage: unknown command "frobnicate"'] });
  });

  it("reports an error exit for rm of an unknown id and writes no ledger file", async () => {
    const { ledger } = workspace();
    const r = await run(ledger, "rm", "7");
    expect(r).toEqual({ code: 1, out: [], err: ["error: no expense #7"] });
    expect(existsSync(ledger)).toBe(false);
  });

  it("reports an error exit with no stdout when the ledger file is unreadable", async () => {
    const { ledger } = workspace();
    writeFileSync(ledger, "{not json", "utf8");
    const r = await run(ledger, "list");
    expect(r).toEqual({ code: 1, out: [], err: [`error: cannot read ${ledger}`] });
    expect(readFileSync(ledger, "utf8")).toBe("{not json");
  });
});
