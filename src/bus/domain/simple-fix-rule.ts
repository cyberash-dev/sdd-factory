import { withSimpleFix } from "./run-state.js";
import type { TransitionRule } from "./transition.js";

/* bus:DLT-005: fix.attempted only advances the monotonic counter; the stage that invoked the fixer acts on the outcome. */
export const SIMPLE_FIX_RULE: TransitionRule = {
  name: "fix.attempted recorded",
  eventType: "fix.attempted",
  apply: ({ state, event }) => ({
    state: withSimpleFix(state, String(event.payload["owner"]), String(event.payload["unit"])),
    emits: [],
    effects: [],
  }),
};
