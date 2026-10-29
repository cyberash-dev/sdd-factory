import type { Tool } from "@mozaik-ai/core";
import { writeFileTool, type ToolTrace } from "../../shared/llm/tools.js";

function pathArgument(args: unknown): string | null {
  return typeof args === "object" && args !== null && "path" in args && typeof args.path === "string" ? args.path.replace(/^\.\//, "") : null;
}

/* The reviewer modifies nothing but its report and handoff (build-stage:BEH-012). */
export function restrictedWriteFileTool(root: string, allowedPrefixes: readonly string[], trace: ToolTrace): Tool {
  const base = writeFileTool(root, trace);
  return {
    ...base,
    description: `${base.description} Only paths under ${allowedPrefixes.join(" or ")} are accepted.`,
    invoke: async (args: unknown): Promise<unknown> => {
      const path = pathArgument(args);
      if (path === null || !allowedPrefixes.some((prefix) => path.startsWith(prefix))) {
        return `ERROR: write refused: ${path ?? "(no path)"} is outside ${allowedPrefixes.join(", ")}`;
      }
      return base.invoke(args);
    },
  };
}
