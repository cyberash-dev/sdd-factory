import { readFile } from "node:fs/promises";
import YAML from "yaml";
import { describe, expect, it } from "vitest";

async function surfaceRecord(file: string, id: string): Promise<{ version: string; members: string[] }> {
  const text = await readFile(new URL(`../../spec/${file}`, import.meta.url), "utf8");
  const blocks = [...text.matchAll(/```yaml\n---\n([\s\S]*?)\n---\n```/g)].map((match) => YAML.parse(match[1] ?? ""));
  const surface = blocks.find((block) => typeof block === "object" && block !== null && "id" in block && block.id === id);
  if (typeof surface !== "object" || surface === null || !("members" in surface) || !Array.isArray(surface.members)) {
    throw new Error(`surface ${id} not found in ${file}`);
  }
  return { version: String("version" in surface ? surface.version : ""), members: surface.members.filter((member: unknown): member is string => typeof member === "string") };
}

describe("trace-files surface after the member and cloud deltas", () => {
  // @covers trace:DLT-001
  it("lists the nine tracer behaviours next to its four file contracts", async () => {
    const surface = await surfaceRecord("trace.md", "trace:SUR-001");

    const original = ["trace:BEH-001", "trace:BEH-002", "trace:BEH-003", "trace:BEH-004", "trace:BEH-005", "trace:BEH-006", "trace:BEH-007", "trace:BEH-008", "trace:BEH-009"];
    const contracts = surface.members.filter((member) => member.includes(":CTR-")).sort();
    expect([original.every((id) => surface.members.includes(id)), contracts]).toEqual([true, ["trace:CTR-001", "trace:CTR-002", "trace:CTR-003", "trace:CTR-004"]]);
  });

  // @covers trace:DLT-002
  it("carries the cloud mirror behaviour as a member past version 0.2.0", async () => {
    const surface = await surfaceRecord("trace.md", "trace:SUR-001");

    const [major, minor] = surface.version.split(".").map(Number);
    expect([major, (minor ?? 0) >= 3, surface.members.includes("trace:BEH-010")]).toEqual([0, true, true]);
  });

  // @covers trace:DLT-003
  // @covers trace:DLT-004
  // @covers trace:DLT-005
  it("carries version 0.5.0 after a resumed run's report took in every run of its chain", async () => {
    const surface = await surfaceRecord("trace.md", "trace:SUR-001");

    expect(surface.version).toBe("0.5.0");
  });
});
