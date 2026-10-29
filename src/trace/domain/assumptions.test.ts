import { describe, expect, it } from "vitest";
import { assumptionsOf } from "./assumptions.js";

describe("assumptionsOf", () => {
  it("lists id and collapsed assumption text of every ASSUMPTION block and skips other record types", () => {
    const markdown = [
      "# Spec",
      "```yaml",
      "id: todo-cli:BEH-001",
      "type: Behavior",
      "title: adds a task",
      "```",
      "```yaml",
      "id: todo-cli:ASM-001",
      "type: ASSUMPTION",
      "assumption: |",
      "  Tasks are stored",
      "  in a JSON file.",
      "```",
      "```yml",
      "id: todo-cli:ASM-002",
      "type: ASSUMPTION",
      "assumption: One list per user.",
      "```",
    ].join("\n");

    expect(assumptionsOf(markdown)).toEqual([
      { id: "todo-cli:ASM-001", text: "Tasks are stored in a JSON file." },
      { id: "todo-cli:ASM-002", text: "One list per user." },
    ]);
  });

  it("skips a block that is not valid YAML", () => {
    const markdown = "```yaml\nid: [unclosed\ntype: ASSUMPTION\n```\n```yaml\nid: x:ASM-001\ntype: ASSUMPTION\nassumption: ok\n```";

    expect(assumptionsOf(markdown)).toEqual([{ id: "x:ASM-001", text: "ok" }]);
  });

  it("returns an empty list for text without yaml fences", () => {
    expect(assumptionsOf("# nothing here")).toEqual([]);
  });
});
