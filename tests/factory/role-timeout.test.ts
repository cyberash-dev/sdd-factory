import { describe, expect, it } from "vitest";
import { runArchitectEffect } from "../../src/design-stage/application/architect-effect.js";
import { ApiRoleTimeoutError } from "../../src/shared/llm/api-role-runner.js";
import { ARCHITECT_HANDOFF_LINES, handoffPathIn, handoffText, harness, readVia, stateIn, techMdText, writeVia, type RoleScript } from "../design-stage/harness.js";

const timingOut: RoleScript = async () => {
  throw new ApiRoleTimeoutError("architect exceeded 1200000 ms");
};

const completing: RoleScript = async (request) => {
  await readVia(request, "spec/spec.md");
  await writeVia(request, "design/tech.md", techMdText());
  await writeVia(request, handoffPathIn(request), handoffText("architect", 1, ARCHITECT_HANDOFF_LINES));
};

describe("API role time budget", () => {
  // @covers factory:BEH-011
  it("turns a role that exhausted its budget into one re-run with the timeout note, never into run.failed", async () => {
    const h = await harness({ scripts: { architect: [timingOut, completing] } });

    await runArchitectEffect({ kind: "design.architect", attempt: 1 }, h.context(stateIn("designing")), h.slice);

    expect([h.roleCalls.length, h.roleCalls[1]?.message.includes("minutes without a handoff; continue from the files on disk and write the handoff first"), h.published.map((event) => event.type)]).toEqual([2, true, ["design.tech.ready"]]);
  });

  // @covers factory:BEH-011
  it("blocks the stage with <role>_timeout after the re-run cap instead of a runtime error", async () => {
    const h = await harness({ scripts: { architect: [timingOut, timingOut] } });

    await runArchitectEffect({ kind: "design.architect", attempt: 1 }, h.context(stateIn("designing")), h.slice);

    expect(h.published.map((event) => [event.type, event.payload["reason"]])).toEqual([["design.blocked", "architect_timeout"]]);
  });
});
