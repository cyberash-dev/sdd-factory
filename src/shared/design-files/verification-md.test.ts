import { describe, expect, it } from "vitest";
import { filePathReferences, missingVerificationBlocks, parseVerificationMd, verificationBlockData, VerificationMdParseError } from "./verification-md.js";

function block(id: string, template: string, extra = ""): string {
  return [`### ${id}`, "```yaml", `id: ${id}`, `template: ${template}`, 'obligation: "argv --help prints usage"', "input_classes:", "  - name: typical", '    input: "todo add milk"', '    expected: "exit 0"', "negative_oracle:", "  - input_class: invalid_empty", '    must_fail_with: "E_USAGE"', '    must_not: "exit 0"', "assertion_summary:", '  - "stdout lists the todo"', extra, "```"].join("\n");
}

function verificationMd(blocks: readonly string[], infeasible = "none"): string {
  return ["# Verification design: todo-cli", "## 1. Scope", "2 blocks", "## 2. Error oracle", "| code | signal | record |", "|---|---|---|", "| E_USAGE | exit 2 | todo-cli:POL-001 |", "## 3. Blocks", ...blocks, "## 4. Infeasible candidates", infeasible].join("\n");
}

describe("parseVerificationMd", () => {
  // @covers design-stage:CTR-002
  it("parses one block per heading with id, template, feasibility and the verbatim yaml", () => {
    const design = parseVerificationMd(verificationMd([block("todo-cli:CTR-001", "Contract"), block("todo-cli:BEH-002", "Behavior", "feasibility: feasible")]));

    expect(design.blocks.map((item) => [item.id, item.template, item.feasibility, item.yamlSource.startsWith("id: todo-cli:CTR-001\n") || item.yamlSource.startsWith("id: todo-cli:BEH-002\n")])).toEqual([
      ["todo-cli:CTR-001", "Contract", "feasible", true],
      ["todo-cli:BEH-002", "Behavior", "feasible", true],
    ]);
  });

  it("lists the infeasible candidates from section 4 with their reasons", () => {
    const markdown = verificationMd([block("todo-cli:NFR-001", "NFR", "feasibility: infeasible_candidate")], "- todo-cli:NFR-001: wall clock not controllable");

    const design = parseVerificationMd(markdown);

    expect(design.infeasibleCandidates).toEqual([{ id: "todo-cli:NFR-001", reason: "wall clock not controllable" }]);
  });

  it("adds a block marked infeasible_candidate that section 4 omits", () => {
    const design = parseVerificationMd(verificationMd([block("todo-cli:NFR-001", "NFR", "feasibility: infeasible_candidate")]));

    expect([design.blocks[0]?.feasibility, design.infeasibleCandidates]).toEqual(["infeasible_candidate", [{ id: "todo-cli:NFR-001", reason: "marked infeasible_candidate in its block" }]]);
  });

  it("rejects a heading that is not followed by a yaml fence", () => {
    const markdown = verificationMd([block("todo-cli:CTR-001", "Contract"), "### todo-cli:BEH-002", "obligation: prose only"]);

    expect(() => parseVerificationMd(markdown)).toThrow(new VerificationMdParseError("block todo-cli:BEH-002 has no yaml fence"));
  });

  it("rejects a block without a template", () => {
    const markdown = verificationMd(["### todo-cli:CTR-001", "```yaml", "id: todo-cli:CTR-001", 'obligation: "x"', "```"]);

    expect(() => parseVerificationMd(markdown)).toThrow(new VerificationMdParseError("block todo-cli:CTR-001: template missing"));
  });

  it("rejects a file with no blocks at all", () => {
    expect(() => parseVerificationMd(verificationMd([]))).toThrow(VerificationMdParseError);
  });
});

describe("missingVerificationBlocks", () => {
  // @covers design-stage:CTR-002
  it("names the approved ids that have no block", () => {
    const design = parseVerificationMd(verificationMd([block("todo-cli:CTR-001", "Contract")]));

    const missing = missingVerificationBlocks(design, ["todo-cli:CTR-001", "todo-cli:BEH-002", "todo-cli:INV-001"]);

    expect(missing).toEqual(["todo-cli:BEH-002", "todo-cli:INV-001"]);
  });

  it("returns an empty list when every id has a block", () => {
    const design = parseVerificationMd(verificationMd([block("todo-cli:CTR-001", "Contract"), block("todo-cli:BEH-002", "Behavior")]));

    expect(missingVerificationBlocks(design, ["todo-cli:CTR-001", "todo-cli:BEH-002"])).toEqual([]);
  });
});

describe("filePathReferences", () => {
  // @covers design-stage:CTR-002
  it("flags a block that names a src path or a TypeScript file", () => {
    const design = parseVerificationMd(verificationMd([block("todo-cli:CTR-001", "Contract", 'notes: "see src/cli/parse.ts and store.ts"')]));

    expect(filePathReferences(design.blocks[0] ?? { id: "", template: "", feasibility: "feasible", yamlSource: "" })).toEqual(["src/cli/parse.ts", "store.ts"]);
  });

  it("does not flag a block that only names boundary observables", () => {
    const design = parseVerificationMd(verificationMd([block("todo-cli:CTR-001", "Contract")]));

    expect(filePathReferences(design.blocks[0] ?? { id: "", template: "", feasibility: "feasible", yamlSource: "" })).toEqual([]);
  });
});

describe("verificationBlockData", () => {
  // @covers design-stage:DLT-005
  it("keeps the canonical data of a block that parses while a sibling block does not", () => {
    const text = verificationMd([block("todo-cli:CTR-001", "Contract", 'notes: "unterminated'), "### todo-cli:BEH-002\n```yaml\nid: todo-cli:BEH-002\ntemplate: Behavior\n```"]);

    const data = verificationBlockData(text);

    expect([...data.entries()]).toEqual([["todo-cli:BEH-002", '{"id":"todo-cli:BEH-002","template":"Behavior"}']]);
  });
});
