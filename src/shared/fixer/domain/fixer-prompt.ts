import type { PromptVariables } from "../../prompts.js";
import type { PathScope } from "./fix-scope.js";
import type { FixOwner, FixTrigger } from "./fix-triggers.js";

export interface FixerPromptInput {
  readonly directory: string;
  readonly unit: string;
  readonly owner: FixOwner;
  readonly trigger: FixTrigger;
  readonly attempt: number;
  readonly cap: number;
  readonly scope: PathScope;
  readonly formatOnlyPaths: readonly string[];
  readonly failureOutput: string;
}

const NONE = "none";

function pathList(paths: readonly string[]): string {
  return paths.length === 0 ? NONE : paths.map((path) => `- \`${path}\``).join("\n");
}

function longestBacktickRun(text: string): number {
  return Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
}

function verbatim(text: string): string {
  const fence = "`".repeat(Math.max(3, longestBacktickRun(text) + 1));
  return `${fence}text\n${text.trimEnd()}\n${fence}`;
}

function formatOnlyRule(paths: readonly string[]): string {
  if (paths.length === 0) {
    return "";
  }
  return `Format only: in ${paths.map((path) => `\`${path}\``).join(", ")} every record that parsed before your run must parse to identical data after it, and every record id present before must still be present. Records that do not parse now may be repaired.`;
}

export function fixerInstructionVariables(input: FixerPromptInput): PromptVariables {
  return {
    unit: input.unit,
    owner: input.owner,
    trigger: input.trigger,
    directory: input.directory,
    attempt: String(input.attempt),
    cap: String(input.cap),
    allowed_paths: pathList(input.scope.allowed),
    forbidden_paths: pathList(input.scope.forbidden),
    format_only: formatOnlyRule(input.formatOnlyPaths),
  };
}

export function fixerMessage(input: FixerPromptInput): string {
  return [
    `The check for unit \`${input.unit}\` failed with trigger \`${input.trigger}\`. Its output, verbatim:`,
    verbatim(input.failureOutput),
    `Allowed paths (relative to \`${input.directory}\`):`,
    pathList(input.scope.allowed),
    "Forbidden paths:",
    pathList(input.scope.forbidden),
    "Fix the smallest thing that makes the command pass. Change no behaviour, no assertion and no spec content, add no dependency, touch no file outside the allowed paths, write no handoff, and finish with a short plain-text summary of what you changed.",
  ].join("\n\n");
}
