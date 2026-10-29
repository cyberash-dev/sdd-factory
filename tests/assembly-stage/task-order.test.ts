import { describe, expect, it } from "vitest";
import { startEffect } from "../../src/assembly-stage/application/start.js";
import { allTasksApproved, TaskGraphCycleError, topologicalTaskOrder } from "../../src/assembly-stage/domain/task-order.js";
import { collectingContext, runState, sliceContext, taskState } from "./support.js";

describe("assembly barrier", () => {
  // @covers assembly-stage:BEH-001
  it("reports every task approved only when the last task is approved", () => {
    const allApproved = runState({ status: "building", tasks: { "T-001": taskState({}), "T-002": taskState({}), "T-003": taskState({}) } });
    const onePending = runState({ status: "building", tasks: { "T-001": taskState({}), "T-002": taskState({ status: "review_pending" }), "T-003": taskState({}) } });
    const oneFailed = runState({ status: "building", tasks: { "T-001": taskState({}), "T-002": taskState({}), "T-003": taskState({ status: "failed" }) } });

    expect([allTasksApproved(allApproved), allTasksApproved(onePending), allTasksApproved(oneFailed)]).toEqual([true, false, false]);
  });

  // @covers assembly-stage:BEH-001
  it("orders tasks so that every task follows all of its dependsOn", () => {
    const tasks = { "T-001": taskState({ dependsOn: ["T-003"] }), "T-002": taskState({ dependsOn: ["T-001"] }), "T-003": taskState({}), "T-004": taskState({}) };

    expect(topologicalTaskOrder(tasks)).toEqual(["T-003", "T-001", "T-002", "T-004"]);
  });

  it("rejects a dependsOn cycle", () => {
    const tasks = { "T-001": taskState({ dependsOn: ["T-002"] }), "T-002": taskState({ dependsOn: ["T-001"] }) };

    expect(() => topologicalTaskOrder(tasks)).toThrow(TaskGraphCycleError);
  });

  // @covers assembly-stage:BEH-001
  it("publishes assembly.started with the topological order once every task is approved", async () => {
    const state = runState({ status: "building", tasks: { "T-002": taskState({ dependsOn: ["T-001"] }), "T-001": taskState({}), "T-003": taskState({ dependsOn: ["T-002"] }) } });
    const context = collectingContext(state);

    await startEffect()({ kind: "assembly.start" }, context, sliceContext({ root: "/tmp/unused" }));

    expect(context.published).toEqual([{ type: "assembly.started", producer: "assembler", payload: { taskOrder: ["T-001", "T-002", "T-003"] } }]);
  });

  // @covers assembly-stage:BEH-001
  it("publishes nothing while a task is still pending", async () => {
    const state = runState({ status: "building", tasks: { "T-001": taskState({}), "T-002": taskState({ status: "impl_pending" }) } });
    const context = collectingContext(state);

    await startEffect()({ kind: "assembly.start" }, context, sliceContext({ root: "/tmp/unused" }));

    expect(context.published).toEqual([]);
  });
});
