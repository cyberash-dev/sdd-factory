import { describe, expect, it } from "vitest";
import { TEST_CONFIG } from "../build-stage/support/harness.js";
import { runLaneEffect } from "../build-stage/support/lanes.js";
import { verifiedLane, writeReview } from "../build-stage/support/reviews.js";
import { reviewFrontmatter, scriptedApiRoles } from "../build-stage/support/runners.js";

describe("reviewer on a second-vendor model", () => {
  // @covers factory:EXT-005
  // @covers factory:DLT-002
  it("runs on models.reviewer when it is configured and publishes that model with the cost fields", async () => {
    const apiRoles = scriptedApiRoles(async (request) => {
      await writeReview(request, reviewFrontmatter({ impl_sha: (request.message.match(/Reviewed commit: ([0-9a-f]{40})/) ?? [])[1] ?? null }));
    });
    const { harness, state } = await verifiedLane(apiRoles, { models: { ...TEST_CONFIG.models, reviewer: "gpt-6.1-sol" } });

    const published = await runLaneEffect(harness, "build.reviewer", { taskId: "T-001", mode: "review", attempt: 1 }, state);

    expect([apiRoles.requests[0]?.model, published.map((event) => [event.payload["model"], event.payload["costUsd"]])]).toEqual(["gpt-6.1-sol", [["gpt-6.1-sol", 0.02]]]);
  });
});
