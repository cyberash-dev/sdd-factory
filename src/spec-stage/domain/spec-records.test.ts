import { describe, expect, it } from "vitest";
import { parseSpecRecords, specIntegrityProblems } from "./spec-records.js";

function record(id: string, type: string, body: string): string {
  return `\`\`\`yaml\n---\nid: ${id}\ntype: ${type}\nlifecycle: {status: proposed}\n${body}\n---\n\`\`\`\n`;
}

const SURFACE = record("todo-cli:SUR-001", "Surface", "members: [todo-cli:CTR-001, todo-cli:CTR-002]");
const CONTRACTS = record("todo-cli:CTR-001", "Contract", "title: add") + record("todo-cli:CTR-002", "Contract", "title: list");

function openQuestion(n: number): string {
  return record(`todo-cli:OQ-00${n}`, "Open-Q", "question: q\nblocking: no\ndefault_if_unresolved: a");
}

function assumption(n: number, source: string): string {
  return record(`todo-cli:ASM-00${n}`, "ASSUMPTION", `assumption: a\nsource_open_q: ${source}`);
}

describe("product spec records", () => {
  it("parses every yaml fence into id, type and fields", () => {
    const records = parseSpecRecords(SURFACE + CONTRACTS);

    expect(records.map((item) => [item.id, item.type])).toEqual([
      ["todo-cli:SUR-001", "Surface"],
      ["todo-cli:CTR-001", "Contract"],
      ["todo-cli:CTR-002", "Contract"],
    ]);
  });

  // @covers spec-stage:INV-001
  it("accepts a spec with zero open questions", () => {
    expect(specIntegrityProblems(SURFACE + CONTRACTS)).toEqual([]);
  });

  // @covers spec-stage:INV-001
  it("accepts three open questions each decided by exactly one assumption", () => {
    const spec = SURFACE + CONTRACTS + openQuestion(1) + openQuestion(2) + openQuestion(3) + assumption(1, "todo-cli:OQ-001") + assumption(2, "todo-cli:OQ-002") + assumption(3, "todo-cli:OQ-003");

    expect(specIntegrityProblems(spec)).toEqual([]);
  });

  // @covers spec-stage:INV-001
  it("reports an open question that no assumption decides", () => {
    const spec = SURFACE + CONTRACTS + openQuestion(1) + openQuestion(2) + assumption(1, "todo-cli:OQ-001");

    expect(specIntegrityProblems(spec)).toEqual(["todo-cli:OQ-002 is referenced by 0 ASSUMPTION records, expected 1"]);
  });

  it("reports a blocking open question", () => {
    const spec = SURFACE + CONTRACTS + record("todo-cli:OQ-001", "Open-Q", "question: q\nblocking: yes\ndefault_if_unresolved: a") + assumption(1, "todo-cli:OQ-001");

    expect(specIntegrityProblems(spec)).toEqual(["todo-cli:OQ-001 is blocking"]);
  });

  it("reports an assumption pointing at an unknown open question", () => {
    const spec = SURFACE + CONTRACTS + assumption(1, "todo-cli:OQ-009");

    expect(specIntegrityProblems(spec)).toEqual(["ASSUMPTION source_open_q todo-cli:OQ-009 names no Open-Q"]);
  });

  // @covers spec-stage:CTR-001
  it("reports a contract outside the surface members", () => {
    const spec = record("todo-cli:SUR-001", "Surface", "members: [todo-cli:CTR-001]") + CONTRACTS;

    expect(specIntegrityProblems(spec)).toEqual(["todo-cli:CTR-002 is not a member of todo-cli:SUR-001"]);
  });

  // @covers spec-stage:CTR-001
  it("requires exactly one surface", () => {
    expect(specIntegrityProblems(CONTRACTS)).toEqual(["expected exactly one Surface, found 0"]);
  });
});
