import { relative, resolve, sep } from "node:path";
import type { Tool } from "@mozaik-ai/core";
import { editFileTool, listDirTool, readFileTool, writeFileTool, type ToolTrace } from "../../../shared/llm/tools.js";

export interface PathScope {
  readonly base: string;
  readonly allowed: readonly string[];
  readonly denied: readonly string[];
}

export interface RoleToolOptions {
  readonly repoRoot: string;
  readonly productDir: string;
  readonly reads: readonly string[];
  readonly writes: readonly string[];
  readonly lists: readonly string[];
  readonly deniedReads: readonly string[];
  readonly trace: ToolTrace;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isInside(prefix: string, candidate: string): boolean {
  const rel = relative(prefix, candidate);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep));
}

/* Paths resolve against productDir; a refused access is still traced so the firewall sees the attempt. */
function scopedTool(inner: Tool, scope: PathScope, verb: string, trace: ToolTrace): Tool {
  return {
    ...inner,
    invoke: async (args: unknown): Promise<unknown> => {
      if (!isRecord(args) || typeof args["path"] !== "string") {
        return "ERROR: argument path must be a string";
      }
      const absolute = resolve(scope.base, args["path"]);
      if (scope.denied.some((prefix) => isInside(prefix, absolute))) {
        trace({ tool: inner.name, path: absolute, argv: null });
        return `ERROR: path ${args["path"]} is outside what this role is allowed to ${verb}`;
      }
      if (!scope.allowed.some((prefix) => isInside(prefix, absolute))) {
        trace({ tool: inner.name, path: absolute, argv: null });
        return `ERROR: path ${args["path"]} is outside what this role is allowed to ${verb}`;
      }
      return inner.invoke({ ...args, path: absolute });
    },
  };
}

export function fileTools(options: RoleToolOptions): readonly Tool[] {
  const base = options.productDir;
  return [
    scopedTool(readFileTool(options.repoRoot, options.trace), { base, allowed: options.reads, denied: options.deniedReads }, "read", options.trace),
    scopedTool(writeFileTool(options.repoRoot, options.trace), { base, allowed: options.writes, denied: [] }, "write", options.trace),
    scopedTool(editFileTool(options.repoRoot, options.trace), { base, allowed: options.writes, denied: [] }, "write", options.trace),
    scopedTool(listDirTool(options.repoRoot, options.trace), { base, allowed: options.lists, denied: options.deniedReads }, "list", options.trace),
  ];
}
