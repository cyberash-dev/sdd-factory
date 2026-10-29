import { matchesGlob } from "node:path";

export const TESTS_ROOT = "tests";
export const SOURCE_ROOT = "src";

/* Paths the lane itself owns next to the product: never part of a role's write-set check. */
const LANE_OWNED_PREFIXES = ["reviews/", ".handoff/"];
const LINKED_NODE_MODULES = "node_modules";

export function isUnder(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

export function isUnderTests(path: string): boolean {
  return isUnder(TESTS_ROOT, path);
}

export function isUnderSource(path: string): boolean {
  return isUnder(SOURCE_ROOT, path);
}

export function matchesWriteSet(path: string, writes: readonly string[]): boolean {
  return writes.some((glob) => glob === path || matchesGlob(path, glob));
}

export function isLaneOwned(path: string): boolean {
  return path === LINKED_NODE_MODULES || LANE_OWNED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function roleChangedFiles(changedFiles: readonly string[]): readonly string[] {
  return changedFiles.filter((path) => !isLaneOwned(path));
}
