import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { Tool } from "@mozaik-ai/core";

const execFileAsync = promisify(execFile);

export class ToolScopeError extends Error {
  override readonly name = "ToolScopeError";
}

function resolveInside(root: string, candidate: string): string {
  const absolute = resolve(root, candidate);
  const rel = relative(root, absolute);
  if (rel.startsWith("..") || rel.startsWith(sep)) {
    throw new ToolScopeError(`path ${candidate} is outside ${root}`);
  }
  return absolute;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function argumentString(args: unknown, key: string): string {
  if (!isRecord(args)) {
    throw new ToolScopeError(`missing argument ${key}`);
  }
  const value = args[key];
  if (typeof value !== "string") {
    throw new ToolScopeError(`argument ${key} must be a string`);
  }
  return value;
}

function describeExecFailure(error: unknown): string {
  if (isRecord(error) && "code" in error) {
    const stdout = typeof error["stdout"] === "string" ? error["stdout"] : "";
    const stderr = typeof error["stderr"] === "string" ? error["stderr"] : "";
    return `exit ${String(error["code"])}\n${stdout}${stderr}`;
  }
  return `ERROR: ${error instanceof Error ? error.message : String(error)}`;
}

export interface ToolTraceEntry {
  readonly tool: string;
  readonly path: string | null;
  readonly argv: readonly string[] | null;
}

export type ToolTrace = (entry: ToolTraceEntry) => void;

export function readFileTool(root: string, trace: ToolTrace): Tool {
  return {
    type: "function",
    name: "read_file",
    description: "Read a UTF-8 text file inside the product directory. Argument: path (relative to the product root).",
    strict: false,
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
    invoke: async (args: unknown) => {
      const path = argumentString(args, "path");
      trace({ tool: "read_file", path, argv: null });
      try {
        return await readFile(resolveInside(root, path), "utf8");
      } catch (error) {
        return `ERROR: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  };
}

export function writeFileTool(root: string, trace: ToolTrace): Tool {
  return {
    type: "function",
    name: "write_file",
    description: "Write a UTF-8 text file inside the product directory, creating parent directories. Arguments: path, content.",
    strict: false,
    parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"], additionalProperties: false },
    invoke: async (args: unknown) => {
      const path = argumentString(args, "path");
      const content = argumentString(args, "content");
      trace({ tool: "write_file", path, argv: null });
      try {
        const absolute = resolveInside(root, path);
        await mkdir(dirname(absolute), { recursive: true });
        await writeFile(absolute, content, "utf8");
        return `written ${path} (${content.length} chars)`;
      } catch (error) {
        return `ERROR: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  };
}

export function listDirTool(root: string, trace: ToolTrace): Tool {
  return {
    type: "function",
    name: "list_dir",
    description: "List entries of a directory inside the product directory. Argument: path (relative; '.' for the root).",
    strict: false,
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
    invoke: async (args: unknown) => {
      const path = argumentString(args, "path");
      trace({ tool: "list_dir", path, argv: null });
      try {
        const entries = await readdir(resolveInside(root, path), { withFileTypes: true });
        return entries.map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name)).join("\n");
      } catch (error) {
        return `ERROR: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  };
}

const SDD_ALLOWED = [/^lint --format=json$/, /^record list( --partition \S+)?( --format=json)?$/, /^record get \S+( --format=json)?$/, /^record set \S+ --from-file \S+$/, /^record add --after \S+ --from-file \S+$/];

export function runSddTool(root: string, trace: ToolTrace): Tool {
  return {
    type: "function",
    name: "run_sdd",
    description: "Run the sdd CLI in the product directory. Argument: argv, one of: 'lint --format=json', 'record list [--partition p]', 'record get <id>', 'record set <id> --from-file <path>', 'record add --after <id> --from-file <path>'. Returns exit code and output.",
    strict: false,
    parameters: { type: "object", properties: { argv: { type: "string" } }, required: ["argv"], additionalProperties: false },
    invoke: async (args: unknown) => {
      const argv = argumentString(args, "argv").trim();
      if (!SDD_ALLOWED.some((pattern) => pattern.test(argv))) {
        return `ERROR: argv not allowed: ${argv}`;
      }
      const parts = argv.split(/\s+/);
      trace({ tool: "run_sdd", path: null, argv: parts });
      try {
        const { stdout, stderr } = await execFileAsync("npx", ["sdd", ...parts], { cwd: root, maxBuffer: 8 * 1024 * 1024 });
        return `exit 0\n${stdout}${stderr}`;
      } catch (error) {
        return describeExecFailure(error);
      }
    },
  };
}
