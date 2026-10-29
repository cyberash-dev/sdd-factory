import type { CliToolUse } from "../../shared/llm/cli-role-runner.js";
import { isUnderSource } from "./write-set.js";

const TOKEN = /"([^"]*)"|'([^']*)'|(\S+)/g;

function tokensOf(value: string): readonly string[] {
  return [...value.matchAll(TOKEN)].map((match) => match[1] ?? match[2] ?? match[3] ?? "");
}

function stringValuesOf(input: Readonly<Record<string, unknown>>): readonly string[] {
  return Object.values(input).filter((value): value is string => typeof value === "string");
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
    for (const value of stringValuesOf(toolUse.input)) {
      for (const token of tokensOf(value)) {
        const path = relativeToWorktree(token, worktree);
        if (isUnderSource(path) && !allowedPaths.includes(path)) {
          violations.add(`${toolUse.name}:${path}`);
        }
      }
    }
  }
  return [...violations];
}
