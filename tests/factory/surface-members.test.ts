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

describe("factory-cli surface after the member and provider-key deltas", () => {
  // @covers factory:DLT-001
  it("lists the three boundary behaviours next to its contracts", async () => {
    const surface = await surfaceRecord("factory.md", "factory:SUR-001");

    expect(surface.members.sort()).toEqual(["factory:BEH-001", "factory:BEH-005", "factory:BEH-006", "factory:CTR-001", "factory:CTR-002"]);
  });

  // @covers factory:DLT-002
  it("carries version 0.3.0 after the OPENAI_API_KEY identifier joined the argv contract", async () => {
    const surface = await surfaceRecord("factory.md", "factory:SUR-001");

    expect(surface.version).toBe("0.3.0");
  });
});
