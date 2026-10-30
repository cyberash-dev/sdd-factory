import YAML from "yaml";
import { greeterDesign } from "./design.js";
import { aLaneHarness, type LaneHarness } from "./harness.js";
import { GREEN_IMPL, laneState, provisionLane, RED_TEST, type ProvisionedLane } from "./lanes.js";
import { aProductRepo, git, writeProductFile } from "./product.js";
import { invokeTool, type ScriptedApiRoles } from "./runners.js";
import type { RunState } from "../../../src/bus/domain/run-state.js";
import type { FactoryConfig } from "../../../src/shared/config.js";
import type { ApiRoleRequest } from "../../../src/shared/llm/api-role-runner.js";

export interface VerifiedLane {
  readonly harness: LaneHarness;
  readonly lane: ProvisionedLane;
  readonly implSha: string;
  readonly testsSha: string;
  readonly state: RunState;
}

export async function verifiedLane(apiRoles: ScriptedApiRoles, config: Partial<FactoryConfig> = {}): Promise<VerifiedLane> {
  const harness = await aLaneHarness({ productDir: await aProductRepo(), design: greeterDesign(), apiRoles, config });
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

export async function writeReview(request: ApiRoleRequest, frontmatter: Readonly<Record<string, unknown>>, attempt = 1): Promise<void> {
  const text = `---\n${YAML.stringify(frontmatter)}---\n## Scope checked\n\n## Spec conformance\n\n## Findings\n\n## Verdict rationale\n`;
  await invokeTool(request, "write_file", { path: "reviews/T-001.md", content: text });
  await invokeTool(request, "write_file", { path: `.handoff/reviewer-${attempt}.md`, content: text });
}
