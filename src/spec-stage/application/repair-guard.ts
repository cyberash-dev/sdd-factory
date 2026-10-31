import { writeFile } from "node:fs/promises";

export interface GuardedRepair {
  readonly name: string;
  readonly specPath: string;
  readonly original: string;
  readonly repaired: string;
  readonly lintErrors: () => Promise<number>;
  readonly log: (line: string) => void;
}

/* spec-stage:DLT-009: a mechanical repair never leaves the spec with more lint errors than it found; returns the text left on disk. */
export async function applyRepairUnlessLintRegresses(repair: GuardedRepair): Promise<string> {
  if (repair.repaired === repair.original) {
    return repair.original;
  }
  const errorsBefore = await repair.lintErrors();
  await writeFile(repair.specPath, repair.repaired, "utf8");
  const errorsAfter = await repair.lintErrors();
  if (errorsAfter <= errorsBefore) {
    return repair.repaired;
  }
  await writeFile(repair.specPath, repair.original, "utf8");
  repair.log(`spec.approve: ${repair.name} reverted: lint errors ${errorsBefore} -> ${errorsAfter}`);
  return repair.original;
}
