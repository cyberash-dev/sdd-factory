import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { apiRoleModelIds, DEFAULT_CONFIG, laneEffortFor, laneModelFor, loadConfig, mergeConfig, reviewerModel } from "./config.js";

describe("factory config", () => {
  it("overrides caps, timeouts, lanes, models and pricing from a partial document", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, {
      caps: { implementerAttempts: 5 },
      timeouts: { verifierMs: 1000 },
      maxParallelLanes: 2,
      models: { lane: "claude-opus-5-5" },
      pricing: { "claude-sonnet-5-5": { inputPerMillion: 3, outputPerMillion: 15 } },
    });

    expect([merged.caps.implementerAttempts, merged.caps.lintCycles, merged.timeouts.verifierMs, merged.maxParallelLanes, merged.models.lane, merged.pricing["claude-sonnet-5-5"]]).toEqual([
      5,
      5,
      1000,
      2,
      "claude-opus-5-5",
      { inputPerMillion: 3, outputPerMillion: 15 },
    ]);
  });

  // @covers factory:CST-005
  // @covers design-stage:DLT-004
  it("reads the graph depth, task size and simple-fix caps with their shipped defaults", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { caps: { graphDepth: 4, simpleFixes: 1 } });

    expect([merged.caps.graphDepth, merged.caps.minCoversPerTask, merged.caps.simpleFixes, DEFAULT_CONFIG.caps.graphDepth, DEFAULT_CONFIG.caps.minCoversPerTask, DEFAULT_CONFIG.caps.simpleFixes]).toEqual([4, 3, 1, 3, 3, 2]);
  });

  // @covers factory:DLT-002
  it("reads the reviewer model and falls back to the default model while it is unset", () => {
    const withReviewer = mergeConfig(DEFAULT_CONFIG, { models: { default: "claude-opus-5-5", reviewer: "gpt-6.1-sol" } });
    const withoutReviewer = mergeConfig(DEFAULT_CONFIG, { models: { default: "claude-opus-5-5" } });

    expect([DEFAULT_CONFIG.models.reviewer, withReviewer.models.reviewer, reviewerModel(withReviewer.models), reviewerModel(withoutReviewer.models)]).toEqual([null, "gpt-6.1-sol", "gpt-6.1-sol", "claude-opus-5-5"]);
  });

  // @covers factory:ASM-005
  it("reads per-role reasoning effort and drops values outside the Mozaik effort set", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { models: { effort: { "spec-analyst": "high", planner: "turbo", triage: 5 } } });

    expect([DEFAULT_CONFIG.models.effort, merged.models.effort]).toEqual([{}, { "spec-analyst": "high" }]);
  });

  // @covers factory:DLT-010
  it("reads a Claude Code model per lane role and falls back to models.lane for a role absent from the map", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { models: { lane: "claude-haiku-4-5", lanes: { "test-writer": "claude-sonnet-5-5", implementer: 7 } } });

    expect([merged.models.lanes, laneModelFor(merged.models, "test-writer"), laneModelFor(merged.models, "implementer")]).toEqual([{ "test-writer": "claude-sonnet-5-5" }, "claude-sonnet-5-5", "claude-haiku-4-5"]);
  });

  // @covers factory:DLT-010
  it("resolves no lane model when the role is absent from the map and models.lane is null", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { models: { lanes: { "test-writer": "claude-sonnet-5-5" } } });

    expect([DEFAULT_CONFIG.models.lanes, laneModelFor(merged.models, "simple-fixer")]).toEqual([{}, null]);
  });

  // @covers factory:DLT-010
  it.each([
    [{ "test-writer": "medium" }, "medium"],
    [{ "test-writer": "none" }, null],
    [{ implementer: "high" }, null],
  ])("resolves the lane effort of test-writer from effort %j as %s", (effort, expected) => {
    const merged = mergeConfig(DEFAULT_CONFIG, { models: { effort } });

    expect(laneEffortFor(merged.models, "test-writer")).toBe(expected);
  });

  // @covers factory:DLT-010
  it("keeps lane models out of the API model ids", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { models: { default: "m-default", critic: "m-critic", triage: "m-triage", lane: "m-lane", lanes: { implementer: "m-implementer" } } });

    expect(apiRoleModelIds(merged.models)).toEqual(["m-default", "m-critic", "m-triage"]);
  });

  it("ignores values of the wrong type and keeps the defaults", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { caps: { implementerAttempts: "many" }, maxParallelLanes: -1, pricing: { m: { inputPerMillion: "x" } } });

    expect([merged.caps.implementerAttempts, merged.maxParallelLanes, merged.pricing]).toEqual([3, 4, {}]);
  });

  it("returns the defaults when the config file does not exist", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cfg-"));

    const loaded = await loadConfig(join(directory, "factory.config.json"));

    expect(loaded).toEqual(DEFAULT_CONFIG);
  });

  it("reads overrides from an existing config file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cfg-"));
    await writeFile(join(directory, "factory.config.json"), JSON.stringify({ caps: { assemblyRounds: 3 } }), "utf8");

    const loaded = await loadConfig(join(directory, "factory.config.json"));

    expect(loaded.caps.assemblyRounds).toBe(3);
  });
});
