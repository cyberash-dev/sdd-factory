import { relative, resolve, sep } from "node:path";
import type { Tool } from "@mozaik-ai/core";
import { editFileTool, listDirTool, readFileTool, writeFileTool, type ToolTrace } from "../../shared/llm/tools.js";
import { isRecord } from "../domain/guards.js";
import type { CommandRunner } from "../ports/command-runner.js";
import { lintProductSpec } from "../application/spec-lint.js";

export interface PathScope {
  readonly base: string;
  readonly allowed: readonly string[];
}

function isInside(prefix: string, candidate: string): boolean {
  const rel = relative(prefix, candidate);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep));
}

function scopedTool(inner: Tool, scope: PathScope, verb: string): Tool {
  return {
    ...inner,
    invoke: async (args: unknown): Promise<unknown> => {
      if (!isRecord(args) || typeof args["path"] !== "string") {
        return "ERROR: argument path must be a string";
      }
      const path = args["path"];
      const absolute = resolve(scope.base, path);
      if (!scope.allowed.some((prefix) => isInside(prefix, absolute))) {
        return `ERROR: path ${path} is outside what this role is allowed to ${verb}`;
      }
      return inner.invoke({ ...args, path: absolute });
    },
  };
}

const SDD_ALLOWED = [/^lint --format=json$/, /^record list( --partition \S+)?( --format=json)?$/, /^record get \S+( --format=json)?$/, /^record set \S+ --from-file \S+$/, /^record add --after \S+ --from-file \S+$/];

export function sddTool(commands: CommandRunner, productDir: string, lintCap: number, trace: ToolTrace): { readonly tool: Tool; readonly lintRuns: () => number } {
  let lintRuns = 0;
  const tool: Tool = {
    type: "function",
    name: "run_sdd",
    description: "Run the sdd CLI in the product directory. Argument: argv, one of: 'lint --format=json', 'record list [--partition p]', 'record get <id>', 'record set <id> --from-file <path>', 'record add --after <id> --from-file <path>'. Returns exit code and output.",
    strict: false,
    parameters: { type: "object", properties: { argv: { type: "string" } }, required: ["argv"], additionalProperties: false },
    invoke: async (args: unknown): Promise<string> => {
      const argv = isRecord(args) && typeof args["argv"] === "string" ? args["argv"].trim() : "";
      if (!SDD_ALLOWED.some((pattern) => pattern.test(argv))) {
        return `ERROR: argv not allowed: ${argv}`;
      }
      const parts = argv.split(/\s+/);
      if (parts[0] === "lint") {
        if (lintRuns >= lintCap) {
          return `ERROR: lint cap of ${lintCap} runs reached; write the handoff with status blocked and blocked_reason "lint_cap <rule ids>"`;
        }
        lintRuns += 1;
      }
      trace({ tool: "run_sdd", path: null, argv: parts });
      const result = parts[0] === "lint" ? await lintProductSpec(commands, productDir) : await commands.run(parts, productDir);
      return `exit ${result.exitCode}\n${result.stdout}${result.stderr}`;
    },
  };
  return { tool, lintRuns: () => lintRuns };
}

export interface RoleToolOptions {
  readonly repoRoot: string;
  readonly productDir: string;
  readonly reads: readonly string[];
  readonly writes: readonly string[];
  readonly lists: readonly string[];
  readonly trace: ToolTrace;
}

export function fileTools(options: RoleToolOptions): readonly Tool[] {
  const base = options.productDir;
  return [
    scopedTool(readFileTool(options.repoRoot, options.trace), { base, allowed: options.reads }, "read"),
    scopedTool(writeFileTool(options.repoRoot, options.trace), { base, allowed: options.writes }, "write"),
    scopedTool(editFileTool(options.repoRoot, options.trace), { base, allowed: options.writes }, "write"),
    scopedTool(listDirTool(options.repoRoot, options.trace), { base, allowed: options.lists }, "list"),
  ];
}
