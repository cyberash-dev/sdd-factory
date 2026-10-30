import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
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

/* design-stage:DLT-007: symlinks resolved, so a link to a forbidden file is still seen by the firewall. */
export function canonicalPath(path: string): string {
  const tail: string[] = [];
  let existing = path;
  while (!existsSync(existing) && dirname(existing) !== existing) {
    tail.unshift(basename(existing));
    existing = dirname(existing);
  }
  return join(realpathSync(existing), ...tail);
}

/* Paths resolve against productDir; a refused access returned no content, so it is not traced (design-stage:DLT-007). */
function scopedTool(inner: Tool, scope: PathScope, verb: string): Tool {
  return {
    ...inner,
    invoke: async (args: unknown): Promise<unknown> => {
      if (!isRecord(args) || typeof args["path"] !== "string") {
        return "ERROR: argument path must be a string";
      }
      const absolute = resolve(scope.base, args["path"]);
      if (scope.denied.some((prefix) => isInside(prefix, absolute))) {
        return `ERROR: path ${args["path"]} is outside what this role is allowed to ${verb}`;
      }
      if (!scope.allowed.some((prefix) => isInside(prefix, absolute))) {
        return `ERROR: path ${args["path"]} is outside what this role is allowed to ${verb}`;
      }
      return inner.invoke({ ...args, path: absolute });
    },
  };
}

export function fileTools(options: RoleToolOptions): readonly Tool[] {
  const base = options.productDir;
  const trace: ToolTrace = (entry) => {
    options.trace({ ...entry, path: entry.path === null ? null : canonicalPath(entry.path) });
  };
  return [
    scopedTool(readFileTool(options.repoRoot, trace), { base, allowed: options.reads, denied: options.deniedReads }, "read"),
    scopedTool(writeFileTool(options.repoRoot, trace), { base, allowed: options.writes, denied: [] }, "write"),
    scopedTool(editFileTool(options.repoRoot, trace), { base, allowed: options.writes, denied: [] }, "write"),
    scopedTool(listDirTool(options.repoRoot, trace), { base, allowed: options.lists, denied: options.deniedReads }, "list"),
  ];
}
