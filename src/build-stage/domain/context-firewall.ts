import type { CliToolUse } from "../../shared/llm/cli-role-runner.js";
import { shellPathCandidates } from "./shell-paths.js";
import { isUnderSource } from "./write-set.js";

const PATH_FIELDS = ["file_path", "notebook_path", "path", "directory", "glob"];

function pathFieldsOf(toolName: string): readonly string[] {
  return toolName === "Glob" ? [...PATH_FIELDS, "pattern"] : PATH_FIELDS;
}

function pathCandidatesOf(toolUse: CliToolUse): readonly string[] {
  if (toolUse.name === "Bash") {
    const command = toolUse.input["command"];
    return typeof command === "string" ? shellPathCandidates(command) : [];
  }
  return pathFieldsOf(toolUse.name)
    .map((field) => toolUse.input[field])
    .filter((value): value is string => typeof value === "string");
}

function relativeToWorktree(token: string, worktree: string): string {
  const prefix = `${worktree}/`;
  const stripped = token.startsWith(prefix) ? token.slice(prefix.length) : token;
  return stripped.replace(/^\.\//, "").replace(/\/+$/, "");
}

/* INV-003: a test-writer tool call touching src/ outside the stubs named in its first message. */
export function firewallViolations(toolUses: readonly CliToolUse[], worktree: string, allowedPaths: readonly string[]): readonly string[] {
  const violations = new Set<string>();
  for (const toolUse of toolUses) {
    for (const candidate of pathCandidatesOf(toolUse)) {
      const path = relativeToWorktree(candidate, worktree);
      if (isUnderSource(path) && !allowedPaths.includes(path)) {
        violations.add(`${toolUse.name}:${path}`);
      }
    }
  }
  return [...violations];
}
