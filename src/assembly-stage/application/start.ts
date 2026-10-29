import type { EffectHandler } from "../../shared/slice.js";
import { allTasksApproved, topologicalTaskOrder } from "../domain/task-order.js";

export function startEffect(): EffectHandler {
  return async (_effect, context, slice) => {
    if (!allTasksApproved(context.state)) {
      slice.log("assembly.start ignored: not every task is approved");
      return;
    }
    context.publish({ type: "assembly.started", producer: "assembler", payload: { taskOrder: topologicalTaskOrder(context.state.tasks) } });
  };
}
