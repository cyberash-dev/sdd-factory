import type { TransitionRule } from "../../../bus/domain/transition.js";
import type { RuleDeps } from "./support.js";
import { taskApprovedRule } from "./task-approved.js";
import { taskFailedRule } from "./task-failed.js";
import { taskFindingRule } from "./task-finding.js";
import { taskImplDoneRule } from "./task-impl-done.js";
import { taskReadyRule } from "./task-ready.js";
import { taskReviewedRule } from "./task-reviewed.js";
import { taskReworkRule } from "./task-rework.js";
import { taskTestsRedRule } from "./task-tests-red.js";
import { taskTestsRejectedRule } from "./task-tests-rejected.js";
import { taskTestsWrittenRule } from "./task-tests-written.js";
import { taskVerifiedRule } from "./task-verified.js";

export type { RuleDeps, ReworkFinding } from "./support.js";

export function buildStageRules(deps: RuleDeps): readonly TransitionRule[] {
  return [
    taskReadyRule(),
    taskTestsWrittenRule(deps),
    taskTestsRedRule(),
    taskTestsRejectedRule(deps),
    taskImplDoneRule(deps),
    taskVerifiedRule(deps),
    taskFindingRule(deps),
    taskReviewedRule(deps),
    taskReworkRule(deps),
    taskApprovedRule(),
    taskFailedRule(),
  ];
}
