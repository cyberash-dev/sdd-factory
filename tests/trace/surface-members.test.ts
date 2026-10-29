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

describe("trace-files surface after the member delta", () => {
  // @covers trace:DLT-001
  it("lists the nine tracer behaviours next to its four file contracts at version 0.2.0", async () => {
    const surface = await surfaceRecord("trace.md", "trace:SUR-001");

    const behaviours = surface.members.filter((member) => member.includes(":BEH-")).sort();
    const contracts = surface.members.filter((member) => member.includes(":CTR-")).sort();
    expect([surface.version, behaviours.length, contracts]).toEqual(["0.2.0", 9, ["trace:CTR-001", "trace:CTR-002", "trace:CTR-003", "trace:CTR-004"]]);
  });
});
