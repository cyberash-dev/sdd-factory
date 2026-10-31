import { matchesGlob } from "node:path";
import type { AssemblyTrigger, GreenTrigger } from "./fix-triggers.js";

export interface PathScope {
  readonly allowed: readonly string[];
  readonly forbidden: readonly string[];
  /* written by a role running beside the fixer in the same directory: never the fixer's change, never reverted */
  readonly concurrent?: readonly string[];
}

export type FixScopeInput =
  | { readonly trigger: "spec_yaml_invalid" }
  | { readonly trigger: "design_file_invalid"; readonly file: string }
  | { readonly trigger: "red_suite_error" | "arbitration_tests" | GreenTrigger; readonly writes: readonly string[] }
  | { readonly trigger: AssemblyTrigger };

export const ANY_PATH = "**";
const SPEC_FILES = ["spec/spec.md", "spec/assumptions.md"];
const TESTS = "tests/**";
const SPEC = "spec/**";
/* design-stage:DLT-012: the architect and the verification-designer write in one product directory at the same time; the planner runs alone. */
const CONCURRENT_DESIGN_FILES: Readonly<Record<string, readonly string[]>> = { "design/tech.md": ["design/verification.md"], "design/verification.md": ["design/tech.md"] };

/* factory:BEH-012 trigger table, allowed-paths column; paths are relative to the fixer's directory. */
export function fixScopeOf(input: FixScopeInput): PathScope {
  switch (input.trigger) {
    case "spec_yaml_invalid":
      return { allowed: SPEC_FILES, forbidden: [] };
    case "design_file_invalid":
      return { allowed: [input.file], forbidden: [], concurrent: CONCURRENT_DESIGN_FILES[input.file] ?? [] };
    case "red_suite_error":
      return { allowed: input.writes, forbidden: [] };
    case "arbitration_tests":
      return { allowed: input.writes.filter((glob) => glob.startsWith("tests/")), forbidden: [] };
    case "green_typecheck":
    case "green_load_failure":
      return { allowed: input.writes, forbidden: [TESTS] };
    case "assembly_install":
    case "assembly_typecheck":
    case "assembly_load_failure":
      return { allowed: [ANY_PATH], forbidden: [TESTS, SPEC] };
  }
}

/* node's matchesGlob skips dotfiles under `**`; ANY_PATH must cover .npmrc and friends. */
function pathMatches(glob: string, path: string): boolean {
  return glob === ANY_PATH || glob === path || matchesGlob(path, glob);
}

export function changedFilesOutside(scope: PathScope, changed: readonly string[]): readonly string[] {
  return changed.filter((path) => !scope.allowed.some((glob) => pathMatches(glob, path)) || scope.forbidden.some((glob) => pathMatches(glob, path)));
}

export function isConcurrentPath(scope: PathScope, path: string): boolean {
  return (scope.concurrent ?? []).some((glob) => pathMatches(glob, path));
}
