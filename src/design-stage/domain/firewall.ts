import { relative, resolve } from "node:path";
import type { ToolTrace, ToolTraceEntry } from "../../shared/llm/tools.js";

export interface Firewall {
  readonly trace: ToolTrace;
  readonly entries: readonly ToolTraceEntry[];
  violations(): readonly string[];
}

const READING_TOOLS = new Set(["read_file", "list_dir"]);

export function productRelative(productDir: string, path: string): string {
  return relative(productDir, resolve(productDir, path)).split("\\").join("/");
}

function isUnder(path: string, prefix: string): boolean {
  const rel = relative(prefix, path);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
}

/* Records every tool access; a read attempt on a forbidden absolute prefix is a context-firewall violation (design-stage:BEH-001). */
export function createFirewall(productDir: string, forbiddenReads: readonly string[]): Firewall {
  const entries: ToolTraceEntry[] = [];
  return {
    trace: (entry) => {
      entries.push(entry);
    },
    entries,
    violations: () =>
      entries
        .filter((entry) => READING_TOOLS.has(entry.tool) && entry.path !== null)
        .map((entry) => resolve(productDir, entry.path ?? ""))
        .filter((absolute) => forbiddenReads.some((prefix) => isUnder(absolute, prefix)))
        .map((absolute) => productRelative(productDir, absolute)),
  };
}
