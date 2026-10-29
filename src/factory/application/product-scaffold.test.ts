import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { assumptionsSkeleton, productPackageJson, productSddConfig, productSpecSkeleton, SDD_SECTIONS } from "./product-scaffold.js";

const BASELINE = { slug: "todo-cli", freshnessToken: "ab".repeat(32), commitSha: "cd".repeat(20), date: "2026-10-29" };

function yamlBlocks(markdown: string): unknown[] {
  return [...markdown.matchAll(/```yaml\n---\n([\s\S]*?)\n---\n```/g)].map((match) => YAML.parse(match[1] ?? ""));
}

describe("product scaffold", () => {
  // @covers factory:BEH-002
  it("writes the nineteen sdd sections in order into the spec skeleton", () => {
    const headings = [...productSpecSkeleton(BASELINE).matchAll(/^## (.+)$/gm)].map((match) => match[1]);

    expect(headings).toEqual([...SDD_SECTIONS]);
  });

  it("embeds a parseable Partition record and a baseline carrying the token and commit", () => {
    const [partition, baseline] = yamlBlocks(productSpecSkeleton(BASELINE));

    expect([partition, baseline]).toEqual([
      {
        id: "todo-cli",
        type: "Partition",
        partition_id: "todo-cli",
        owner_team: "sdd-factory",
        gate_scope: ["todo-cli"],
        dependencies_on_other_partitions: [],
        default_policy_set: ["todo-cli:POL-001", "todo-cli:POL-002"],
        id_namespace: "todo-cli",
        unmodeled_budget: { current: 0, baseline_at: "2026-10-29", baseline_value: 0, trend: "monotonic_non_increasing" },
      },
      expect.objectContaining({ id: "todo-cli:BL-001", type: "BrownfieldBaseline", freshness_token: "ab".repeat(32), baseline_commit_sha: "cd".repeat(20), mechanism: "git_tree_hash_v1" }),
    ]);
  });

  it("points the sdd config at the spec, the sandbox assumptions file and the test paths", () => {
    const config: { baseline_id: string; partitions: Record<string, { sandbox_paths: string[]; test_paths: string[] }>; lint: { spec_files: string[] } } = JSON.parse(productSddConfig("todo-cli"));

    expect([config.baseline_id, config.partitions["todo-cli"]?.sandbox_paths, config.partitions["todo-cli"]?.test_paths, config.lint.spec_files]).toEqual([
      "todo-cli:BL-001",
      ["spec/assumptions.md"],
      ["tests/**/*.test.ts", "src/**/*.test.ts"],
      ["spec/spec.md", "spec/assumptions.md"],
    ]);
  });

  it("pins the product toolchain versions exactly and requires node 22", () => {
    const manifest: { engines: { node: string }; devDependencies: Record<string, string> } = JSON.parse(productPackageJson("todo-cli", { typescript: "7.0.2", vitest: "5.0.5", typesNode: "26.6.6", agentSdd: "2.1.1" }));

    expect([manifest.engines.node, manifest.devDependencies]).toEqual([">=22", { "@types/node": "26.6.6", "agent-sdd": "2.1.1", typescript: "7.0.2", vitest: "5.0.5" }]);
  });

  it("gives the assumptions sandbox every section with none", () => {
    const text = assumptionsSkeleton("todo-cli");

    expect([text.match(/^## /gm)?.length, text.match(/^none$/gm)?.length]).toEqual([19, 19]);
  });
});
