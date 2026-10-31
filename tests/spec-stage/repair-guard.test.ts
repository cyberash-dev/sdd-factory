import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyRepairUnlessLintRegresses } from "../../src/spec-stage/application/repair-guard.js";

async function specOnDisk(text: string): Promise<string> {
  const specPath = join(await mkdtemp(join(tmpdir(), "repair-guard-")), "spec.md");
  await writeFile(specPath, text, "utf8");
  return specPath;
}

function lintErrorsByText(specPath: string, errorsByText: ReadonlyMap<string, number>): () => Promise<number> {
  return async () => {
    const text = await readFile(specPath, "utf8");
    const errors = errorsByText.get(text);
    if (errors === undefined) {
      throw new Error(`no lint error count for the spec text ${JSON.stringify(text)}`);
    }
    return errors;
  };
}

describe("repair guarded by the lint error count", () => {
  // @covers spec-stage:DLT-009
  it("reverts a repair that raises the lint error count and logs the counts", async () => {
    const specPath = await specOnDisk("spec before repair");
    const logged: string[] = [];

    const left = await applyRepairUnlessLintRegresses({
      name: "surface members",
      specPath,
      original: "spec before repair",
      repaired: "spec after repair",
      lintErrors: lintErrorsByText(specPath, new Map([["spec before repair", 0], ["spec after repair", 4]])),
      log: (line) => logged.push(line),
    });

    expect([left, await readFile(specPath, "utf8"), logged]).toEqual(["spec before repair", "spec before repair", ["spec.approve: surface members reverted: lint errors 0 -> 4"]]);
  });

  // @covers spec-stage:DLT-009
  it.each([
    ["keeps", 0, 0],
    ["lowers", 2, 0],
  ])("keeps a repair that %s the lint error count", async (_effect, errorsBefore, errorsAfter) => {
    const specPath = await specOnDisk("spec before repair");
    const logged: string[] = [];

    const left = await applyRepairUnlessLintRegresses({
      name: "surface members",
      specPath,
      original: "spec before repair",
      repaired: "spec after repair",
      lintErrors: lintErrorsByText(specPath, new Map([["spec before repair", errorsBefore], ["spec after repair", errorsAfter]])),
      log: (line) => logged.push(line),
    });

    expect([left, await readFile(specPath, "utf8"), logged]).toEqual(["spec after repair", "spec after repair", []]);
  });
});
