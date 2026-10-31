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

/* build-stage:DLT-016: the arbitration report, not a failing command, says what is wrong, and the fix is an assertion change. */
const ARBITRATION_RULE =
  "Trigger `arbitration_tests`: the first user message carries a reviewer's arbitration report instead of a failing command's output. Forbidden actions 1 and 2 do not apply to the assertions and fixtures that report names: change exactly those so that they agree with the records the report cites, and leave every other test byte-identical.";

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
    trigger_rule: input.trigger === "arbitration_tests" ? ARBITRATION_RULE : "",
  };
}

function arbitrationMessage(input: FixerPromptInput): string {
  return [
    `An arbitration of unit \`${input.unit}\` ruled that frozen tests contradict the records (trigger \`${input.trigger}\`). The arbitration report, verbatim:`,
    verbatim(input.failureOutput),
    `Allowed paths (relative to \`${input.directory}\`):`,
    pathList(input.scope.allowed),
    "Forbidden paths:",
    pathList(input.scope.forbidden),
    "Change only the assertions and fixtures the report names so that they agree with the records it cites. Leave every other test byte-identical, change no source file, add no dependency, touch no file outside the allowed paths, write no handoff, and finish with a short plain-text summary of what you changed.",
  ].join("\n\n");
}

export function fixerMessage(input: FixerPromptInput): string {
  if (input.trigger === "arbitration_tests") {
    return arbitrationMessage(input);
  }
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
