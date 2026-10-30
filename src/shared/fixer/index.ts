export { createGitWorkingTree, WorkingTreeError } from "./adapters/outbound/git-working-tree.js";
export { runSimpleFix, type FixCheck, type FormatOnlyFile, type SimpleFixDeps, type SimpleFixRequest, type SimpleFixResult, type SimpleFixRun } from "./application/run-simple-fix.js";
export { ANY_PATH, changedFilesOutside, fixScopeOf, type FixScopeInput, type PathScope } from "./domain/fix-scope.js";
export { isOwnerOf, TRIGGER_TABLE, type AssemblyTrigger, type FixOutcome, type FixOwner, type FixStage, type FixTrigger, type GreenTrigger } from "./domain/fix-triggers.js";
export { formatOnlyViolations, type FormatOnlyViolation } from "./domain/format-only.js";
export type { CommandResult, CommandRunner } from "./ports/outbound/command-runner.js";
export type { FileChange, TreeChanges, TreeSnapshot, WorkingTree } from "./ports/outbound/working-tree.js";
