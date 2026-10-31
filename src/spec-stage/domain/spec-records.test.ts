import { describe, expect, it } from "vitest";
import { parseSpecRecords, repairSurfaceMembers, specIntegrityProblems, specIntegrityWarnings, yamlInvalidDiagnostics } from "./spec-records.js";

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

  it.each([
    ["OpenQuestion", "Open-Q"],
    ["open-q", "Open-Q"],
    ["Assumption", "ASSUMPTION"],
    ["ExternalDependency", "ExternalDependency"],
    ["Implementation binding", "ImplementationBinding"],
    ["Widget", "Widget"],
  ])("normalises the record type %s to %s as sdd does", (written, canonical) => {
    const records = parseSpecRecords(record("todo-cli:X-001", written, "question: q"));

    expect(records.map((item) => item.type)).toEqual([canonical]);
  });

  // @covers spec-stage:INV-001
  // @covers spec-stage:DLT-003
  it("recognises an open question written as OpenQuestion when pairing it with its assumption", () => {
    const spec = SURFACE + CONTRACTS + record("todo-cli:OQ-001", "OpenQuestion", "question: q\nblocking: no\ndefault_if_unresolved: a") + record("todo-cli:ASM-001", "Assumption", "assumption: a\nsource_open_q: todo-cli:OQ-001");

    expect(specIntegrityProblems(spec)).toEqual([]);
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

  // @covers spec-stage:DLT-003
  it("warns about an assumption pointing at an unknown open question without blocking approval", () => {
    const spec = SURFACE + CONTRACTS + assumption(1, "todo-cli:OQ-009");

    expect([specIntegrityProblems(spec), specIntegrityWarnings(spec)]).toEqual([[], ["ASSUMPTION source_open_q todo-cli:OQ-009 names no Open-Q"]]);
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

describe("surface membership repair", () => {
  // @covers spec-stage:DLT-004
  it("appends the contracts missing from a flow-style members list in record order without touching the rest", () => {
    const spec = SURFACE + CONTRACTS + record("todo-cli:CTR-003", "Contract", "title: done");

    const repaired = repairSurfaceMembers(spec);

    expect([repaired?.added, repaired?.text.includes("members:\n  - todo-cli:CTR-001\n  - todo-cli:CTR-002\n  - todo-cli:CTR-003\n"), repaired?.text.includes("title: done")]).toEqual([["todo-cli:CTR-003"], true, true]);
  });

  // @covers spec-stage:DLT-004
  it("appends to a block-style members list keeping the existing order and no duplicates", () => {
    const surface = record("todo-cli:SUR-001", "Surface", "members:\n  - todo-cli:CTR-002\n  - todo-cli:CTR-001\nversion: \"0.1.0\"");
    const spec = surface + CONTRACTS + record("todo-cli:CTR-003", "Contract", "title: done");

    const repaired = repairSurfaceMembers(spec);

    expect([repaired?.added, repaired?.text.includes("members:\n  - todo-cli:CTR-002\n  - todo-cli:CTR-001\n  - todo-cli:CTR-003\nversion: \"0.1.0\""), specIntegrityProblems(repaired?.text ?? "")]).toEqual([["todo-cli:CTR-003"], true, []]);
  });

  // @covers spec-stage:DLT-008
  it("appends a record whose surface_ref names the surface when it carries the four boundary fields", () => {
    const behavior = record("todo-cli:BEH-001", "Behavior", "title: add\nsurface_ref: todo-cli:SUR-001\npolicy_refs: {not_applicable: local cli}\napplicability: {invariant_to_all_axes: true}\nconcurrency_model: {not_applicable: single process}\ndata_scope: {not_applicable: no persistent state}");

    const repaired = repairSurfaceMembers(SURFACE + CONTRACTS + behavior);

    expect([repaired?.added, repaired?.detached, repaired?.text.includes("members:\n  - todo-cli:CTR-001\n  - todo-cli:CTR-002\n  - todo-cli:BEH-001\n")]).toEqual([["todo-cli:BEH-001"], [], true]);
  });

  // @covers spec-stage:DLT-008
  it.each([
    ["no boundary fields", ""],
    ["three of the four boundary fields", "\npolicy_refs: {not_applicable: local cli}\napplicability: {invariant_to_all_axes: true}\nconcurrency_model: {not_applicable: single process}"],
  ])("removes the surface_ref line of a record with %s and leaves it out of members", (_fields, boundaryFields) => {
    const binding = (surfaceRef: string): string => record("todo-cli:IB-001", "ImplementationBinding", `binding: dist/cli.js\n${surfaceRef}boundary_classes: [cli entry]\nnotes: CLI entry${boundaryFields}`);
    const spec = SURFACE + CONTRACTS + binding("surface_ref: todo-cli:SUR-001\n");

    const repaired = repairSurfaceMembers(spec);

    expect(repaired).toEqual({ surfaceId: "todo-cli:SUR-001", added: [], detached: ["todo-cli:IB-001"], text: SURFACE + CONTRACTS + binding("") });
  });

  // @covers spec-stage:DLT-004
  it("reports nothing to add when every contract is already a member", () => {
    expect(repairSurfaceMembers(SURFACE + CONTRACTS)).toEqual({ surfaceId: "todo-cli:SUR-001", added: [], detached: [], text: SURFACE + CONTRACTS });
  });

  // @covers spec-stage:DLT-004
  it.each([
    ["zero", CONTRACTS],
    ["two", SURFACE + SURFACE.replace("SUR-001", "SUR-002") + CONTRACTS],
  ])("declines to repair a spec with %s surfaces", (_count, spec) => {
    expect(repairSurfaceMembers(spec)).toBeNull();
  });
});

describe("yaml validity of record fences", () => {
  // @covers spec-stage:DLT-005
  // @covers spec-stage:CTR-001
  it("names the record whose plain value starts with a backtick and the one whose value holds a colon-space", () => {
    const spec = SURFACE + record("todo-cli:CTR-001", "Contract", "title: `todo add` stores") + record("todo-cli:OQ-001", "Open-Q", "question: exit 2: usage error?");

    const diagnostics = yamlInvalidDiagnostics(spec, "spec/spec.md");

    expect([diagnostics.length, diagnostics[0]?.startsWith("yaml_invalid todo-cli:CTR-001 (spec/spec.md"), diagnostics[0]?.includes("line"), diagnostics[1]?.startsWith("yaml_invalid todo-cli:OQ-001 (spec/spec.md")]).toEqual([2, true, true, true]);
  });

  // @covers spec-stage:DLT-005
  it("reports nothing when every fence parses", () => {
    expect(yamlInvalidDiagnostics(SURFACE + CONTRACTS, "spec/spec.md")).toEqual([]);
  });

  // @covers spec-stage:DLT-005
  it("names a fence without an id by its line in the file", () => {
    const spec = SURFACE + "```yaml\n---\ntitle: `x`\n---\n```\n";

    expect(yamlInvalidDiagnostics(spec, "spec/spec.md").map((line) => line.split(", record at line")[0])).toEqual(["yaml_invalid fence at line 11 (spec/spec.md"]);
  });
});
