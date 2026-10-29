import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFactoryRuntime } from "../../src/bus/adapters/mozaik/runtime.js";
import { DEFAULT_CONFIG } from "../../src/shared/config.js";
import type { ApiRoleRunner } from "../../src/shared/llm/api-role-runner.js";
import { createCliRoleRunner } from "../../src/shared/llm/cli-role-runner.js";
import { createPromptLibrary } from "../../src/shared/prompts.js";
import type { SliceContext } from "../../src/shared/slice.js";
import { invokeRole } from "../../src/spec-stage/application/role-invocation.js";

async function contextWith(apiRoles: ApiRoleRunner, handoffRerun: number): Promise<SliceContext> {
  const root = await mkdtemp(join(tmpdir(), "rerun-"));
  const runtime = createFactoryRuntime("todo-cli-20261029-120000");
  return {
    config: { ...DEFAULT_CONFIG, caps: { ...DEFAULT_CONFIG.caps, handoffRerun } },
    runId: "todo-cli-20261029-120000",
    slug: "todo-cli",
    operator: "cyberash",
    push: false,
    paths: { repoRoot: root, runDir: join(root, "run"), productDir: join(root, "run", "product"), worktreesDir: join(root, "run", "worktrees"), handoffsDir: join(root, "run", "handoffs"), traceDir: join(root, "run", "trace"), specSourcePath: join(root, "spec.md"), outputDir: join(root, "hidden", "todo-cli") },
    runtime,
    apiRoles,
    cliRoles: createCliRoleRunner(),
    prompts: createPromptLibrary(join(root, "prompts")),
    log: () => undefined,
    now: () => new Date(),
  };
}

function silentRole(): { readonly runner: ApiRoleRunner; readonly invocations: () => number } {
  let count = 0;
  return {
    runner: {
      async run() {
        count += 1;
        return { model: "m", inputTokens: 1, outputTokens: 1, costUsd: null, inferenceCount: 1, durationMs: 1, answer: "" };
      },
    },
    invocations: () => count,
  };
}

describe("handoff re-run cap", () => {
  // @covers bus:CST-003
  // @covers bus:BEH-003
  it("invokes a role that never writes its handoff exactly twice with caps.handoffRerun = 1 and reports it unparseable", async () => {
    const role = silentRole();
    const context = await contextWith(role.runner, 1);

    const outcome = await invokeRole(context, {
      role: "spec-analyst",
      instruction: "draft",
      message: "draft the spec",
      model: "m",
      tools: [],
      maxOutputTokens: 100,
      handoffPath: join(context.paths.handoffsDir, "spec-analyst", "handoff.md"),
      verify: async () => ({ kind: "ok", value: null }),
    });

    expect([role.invocations(), outcome.kind, outcome.kind === "unparseable" ? outcome.reruns : null, outcome.kind === "unparseable" ? outcome.error : null]).toEqual([2, "unparseable", 1, "missing_file"]);
  });

  it("invokes the role once when the cap is zero", async () => {
    const role = silentRole();
    const context = await contextWith(role.runner, 0);

    await invokeRole(context, { role: "spec-critic", instruction: "i", message: "m", model: "m", tools: [], maxOutputTokens: 10, handoffPath: join(context.paths.handoffsDir, "spec-critic", "handoff.md"), verify: async () => ({ kind: "ok", value: null }) });

    expect(role.invocations()).toBe(1);
  });
});
