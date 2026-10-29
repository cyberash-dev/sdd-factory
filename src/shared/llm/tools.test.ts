import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listDirTool, readFileTool, runSddTool, writeFileTool, type ToolTraceEntry } from "./tools.js";

async function sandbox(): Promise<{ root: string; trace: ToolTraceEntry[] }> {
  const root = await mkdtemp(join(tmpdir(), "tools-"));
  await writeFile(join(root, "spec.md"), "# spec\n", "utf8");
  return { root, trace: [] };
}

describe("product directory tools", () => {
  it("reads a file inside the root and records the access", async () => {
    const { root, trace } = await sandbox();

    const text = await readFileTool(root, (entry) => trace.push(entry)).invoke({ path: "spec.md" });

    expect([text, trace]).toEqual(["# spec\n", [{ tool: "read_file", path: "spec.md", argv: null }]]);
  });

  it("refuses to read outside the root", async () => {
    const { root, trace } = await sandbox();

    const text: string = await readFileTool(root, (entry) => trace.push(entry)).invoke({ path: "../../etc/passwd" });

    expect(text.startsWith("ERROR: path ../../etc/passwd is outside")).toBe(true);
  });

  it("writes a file creating parent directories", async () => {
    const { root, trace } = await sandbox();

    await writeFileTool(root, (entry) => trace.push(entry)).invoke({ path: "design/tech.md", content: "# tech\n" });

    expect(await readFile(join(root, "design", "tech.md"), "utf8")).toBe("# tech\n");
  });

  it("lists directory entries marking directories with a slash", async () => {
    const { root, trace } = await sandbox();
    await writeFileTool(root, (entry) => trace.push(entry)).invoke({ path: "design/tech.md", content: "x" });

    const listing: string = await listDirTool(root, (entry) => trace.push(entry)).invoke({ path: "." });

    expect(listing.split("\n").sort()).toEqual(["design/", "spec.md"]);
  });

  it("reports a missing argument as a scope error", async () => {
    const { root, trace } = await sandbox();

    await expect(readFileTool(root, (entry) => trace.push(entry)).invoke({})).rejects.toThrow("argument path must be a string");
  });

  it("refuses sdd argv outside the allow-list without running anything", async () => {
    const { root, trace } = await sandbox();

    const output: string = await runSddTool(root, (entry) => trace.push(entry)).invoke({ argv: "approve --id x --approver claude" });

    expect([output, trace]).toEqual(["ERROR: argv not allowed: approve --id x --approver claude", []]);
  });
});
