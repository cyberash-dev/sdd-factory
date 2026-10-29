import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { greeterDesign } from "./support/design.js";
import { aLaneHarness, type LaneHarness } from "./support/harness.js";
import { GREEN_IMPL, laneState, provisionLane, RED_TEST, runLaneEffect, type ProvisionedLane } from "./support/lanes.js";
import { aProductRepo, git, writeProductFile } from "./support/product.js";
import { invokeTool, reviewFrontmatter, scriptedApiRoles, type ScriptedApiRoles } from "./support/runners.js";
import type { ApiRoleRequest } from "../../src/shared/llm/api-role-runner.js";
import type { RunState } from "../../src/bus/domain/run-state.js";

interface VerifiedLane {
  readonly harness: LaneHarness;
  readonly lane: ProvisionedLane;
  readonly implSha: string;
  readonly testsSha: string;
  readonly state: RunState;
}

async function verifiedLane(apiRoles: ScriptedApiRoles): Promise<VerifiedLane> {
  const harness = await aLaneHarness({ productDir: await aProductRepo(), design: greeterDesign(), apiRoles });
  const lane = await provisionLane(harness);
  await writeProductFile(lane.worktree, "tests/greet.test.ts", RED_TEST);
  await git(lane.worktree, ["add", "-A"]);
  await git(lane.worktree, ["commit", "-q", "-m", "tests T-001"]);
  const testsSha = await git(lane.worktree, ["rev-parse", "HEAD"]);
  await writeProductFile(lane.worktree, "src/greet.ts", GREEN_IMPL);
  await git(lane.worktree, ["add", "-A"]);
  await git(lane.worktree, ["commit", "-q", "-m", "impl T-001 attempt 1"]);
  const implSha = await git(lane.worktree, ["rev-parse", "HEAD"]);
  await writeProductFile(harness.context.paths.handoffsDir, "tasks/T-001/verifier-green-1.json", `{"verdict":"pass","testsUnchanged":true,"writeSetOk":true,"implSha":"${implSha}"}\n`);
  return { harness, lane, implSha, testsSha, state: laneState(lane, { status: "review_pending", attempts: { implementer: 1, testWriter: 1 }, testsSha, implSha }) };
}

async function writeReview(request: ApiRoleRequest, frontmatter: Readonly<Record<string, unknown>>, attempt = 1): Promise<void> {
  const text = `---\n${YAML.stringify(frontmatter)}---\n## Scope checked\n\n## Spec conformance\n\n## Findings\n\n## Verdict rationale\n`;
  await invokeTool(request, "write_file", { path: "reviews/T-001.md", content: text });
  await invokeTool(request, "write_file", { path: `.handoff/reviewer-${attempt}.md`, content: text });
}

describe("reviewer invocation", () => {
  // @covers build-stage:BEH-012
  it("provides the diff, records, evidence, frozen tests and interface, then publishes the decision from the report with cost fields", async () => {
    const apiRoles = scriptedApiRoles(async (request) => {
      await writeReview(request, reviewFrontmatter({ impl_sha: (request.message.match(/Reviewed commit: ([0-9a-f]{40})/) ?? [])[1] ?? null }));
    });
    const { harness, lane, implSha, state } = await verifiedLane(apiRoles);

    const published = await runLaneEffect(harness, "build.reviewer", { taskId: "T-001", mode: "review", attempt: 1 }, state);

    const request = apiRoles.requests[0];
    expect([
      request?.role,
      request?.model,
      request?.tools.map((tool) => tool.name),
      ["mode review", `Reviewed commit: ${implSha}`, "+  return `Hello, ${name}!`;", "- `tests/greet.test.ts`", '"verdict":"pass"', "export function greet(name: string): string;", "### greeter:BEH-001"].map((item) => (request?.message ?? "").includes(item)),
      (await readFile(join(lane.worktree, "reviews/T-001.md"), "utf8")).startsWith("---\nrole: reviewer"),
      (await readdir(join(harness.context.paths.handoffsDir, "tasks", "T-001", "reviewer-1"))).sort(),
      published,
    ]).toEqual([
      "reviewer",
      "claude-sonnet-5-5",
      ["read_file", "list_dir", "write_file"],
      [true, true, true, true, true, true, true],
      true,
      ["reviewer-1.md"],
      [{ type: "task.reviewed", producer: "reviewer", payload: { taskId: "T-001", decision: "approve", target: "none", reportPath: "reviews/T-001.md", specIds: [], costUsd: 0.02, inputTokens: 800, outputTokens: 150, durationMs: 2500, model: "claude-sonnet-5-5" } }],
    ]);
  });

  it("refuses reviewer writes outside reviews/ and .handoff/ so the worktree diff stays unchanged", async () => {
    let refusal = "";
    const apiRoles = scriptedApiRoles(async (request) => {
      refusal = await invokeTool(request, "write_file", { path: "src/greet.ts", content: "tampered" });
      await writeReview(request, reviewFrontmatter({ impl_sha: (request.message.match(/Reviewed commit: ([0-9a-f]{40})/) ?? [])[1] ?? null }));
    });
    const { harness, lane, state } = await verifiedLane(apiRoles);

    await runLaneEffect(harness, "build.reviewer", { taskId: "T-001", mode: "review", attempt: 1 }, state);

    expect([refusal, await git(lane.worktree, ["status", "--porcelain"])]).toEqual(["ERROR: write refused: src/greet.ts is outside reviews/, .handoff/", "?? reviews/"]);
  });

  it.each([
    ["request_changes with target", { decision: "request_changes", target: "implementer", findings: [{ id: "RV-001", severity: "blocking", target: "implementer", spec_ids: ["greeter:BEH-001"], evidence: "greeter:BEH-001.then: x; src/greet.ts:2: y" }] }, ["request_changes", "implementer", ["greeter:BEH-001"]]],
    ["advisory_only", { decision: "advisory_only", target: "none", findings: [{ id: "RV-001", severity: "advisory", target: "implementer", spec_ids: [], evidence: "style" }] }, ["advisory_only", "none", []]],
  ])("publishes %s from the report frontmatter", async (_label, frontmatter, expected) => {
    const apiRoles = scriptedApiRoles(async (request) => {
      await writeReview(request, reviewFrontmatter({ ...frontmatter, impl_sha: (request.message.match(/Reviewed commit: ([0-9a-f]{40})/) ?? [])[1] ?? null }));
    });
    const { harness, state } = await verifiedLane(apiRoles);

    const published = await runLaneEffect(harness, "build.reviewer", { taskId: "T-001", mode: "review", attempt: 1 }, state);

    expect(published.map((event) => [event.payload["decision"], event.payload["target"], event.payload["specIds"]])).toEqual([expected]);
  });

  // @covers build-stage:BEH-013
  it("treats request_changes with target none as a malformed handoff: one re-run, then task.failed", async () => {
    const apiRoles = scriptedApiRoles(async (request) => {
      await writeReview(request, reviewFrontmatter({ decision: "request_changes", target: "none", findings: [{ id: "RV-001", severity: "blocking", target: "implementer", spec_ids: [], evidence: "x" }], impl_sha: (request.message.match(/Reviewed commit: ([0-9a-f]{40})/) ?? [])[1] ?? null }));
    });
    const { harness, state } = await verifiedLane(apiRoles);

    const published = await runLaneEffect(harness, "build.reviewer", { taskId: "T-001", mode: "review", attempt: 1 }, state);

    expect([apiRoles.requests.length, apiRoles.requests[1]?.message.includes("Previous handoff rejected"), published]).toEqual([
      2,
      true,
      [{ type: "task.failed", producer: "foreman", payload: { taskId: "T-001", reason: "unparseable_handoff", detail: "reviewer: report: postcondition_violated:target none iff decision is not request_changes" } }],
    ]);
  });

  it("fails the task when the report is missing although the handoff exists", async () => {
    const apiRoles = scriptedApiRoles(async (request) => {
      await invokeTool(request, "write_file", { path: ".handoff/reviewer-1.md", content: `---\n${YAML.stringify(reviewFrontmatter())}---\n` });
    });
    const { harness, state } = await verifiedLane(apiRoles);

    const published = await runLaneEffect(harness, "build.reviewer", { taskId: "T-001", mode: "review", attempt: 1 }, state);

    expect(published.map((event) => [event.type, event.payload["detail"]])).toEqual([["task.failed", "reviewer: report: missing_file"]]);
  });

  // @covers build-stage:BEH-008
  it("runs arbitration with the finding, the frozen tests and impl_sha null, working on the uncommitted implementation", async () => {
    const apiRoles = scriptedApiRoles(async (request) => {
      await writeReview(request, reviewFrontmatter({ mode: "arbitration", decision: "request_changes", target: "test-writer", findings: [{ id: "RV-001", severity: "blocking", target: "test-writer", spec_ids: ["greeter:BEH-001"], evidence: "record says Hello; test expects Hi" }] }));
    });
    const harness = await aLaneHarness({ productDir: await aProductRepo(), design: greeterDesign(), apiRoles });
    const lane = await provisionLane(harness);
    await writeProductFile(lane.worktree, "tests/greet.test.ts", RED_TEST);
    await git(lane.worktree, ["add", "-A"]);
    await git(lane.worktree, ["commit", "-q", "-m", "tests T-001"]);
    const testsSha = await git(lane.worktree, ["rev-parse", "HEAD"]);
    await writeProductFile(lane.worktree, "src/greet.ts", "export function greet(name: string): string {\n  return `Hi ${name}`;\n}\n");

    const published = await runLaneEffect(harness, "build.reviewer", { taskId: "T-001", mode: "arbitration", attempt: 1, finding: { type: "TEST-CONTRACT-CONFLICT", specIds: ["greeter:BEH-001"], detail: "test line 6 contradicts then" } }, laneState(lane, { status: "review_pending", attempts: { implementer: 1, testWriter: 1 }, testsSha, implSha: null }));

    const message = apiRoles.requests[0]?.message ?? "";
    expect([["mode arbitration", "null (arbitration mode)", "type: TEST-CONTRACT-CONFLICT", "test line 6 contradicts then", "+  return `Hi ${name}`;"].map((item) => message.includes(item)), published.map((event) => [event.payload["decision"], event.payload["target"], event.payload["specIds"]])]).toEqual([
      [true, true, true, true, true],
      [["request_changes", "test-writer", ["greeter:BEH-001"]]],
    ]);
  });
});
