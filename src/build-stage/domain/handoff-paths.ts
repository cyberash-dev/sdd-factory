import { join } from "node:path";

export type LaneRole = "test-writer" | "implementer" | "reviewer";

export function taskHandoffDir(handoffsDir: string, taskId: string): string {
  return join(handoffsDir, "tasks", taskId);
}

export function laneHandoffPath(handoffsDir: string, taskId: string, role: LaneRole, attempt: number): string {
  return join(taskHandoffDir(handoffsDir, taskId), `${role}-${attempt}`, "handoff.md");
}

export function reviewReportPath(taskId: string): string {
  return `reviews/${taskId}.md`;
}

export function taskBranch(taskId: string): string {
  return `task/${taskId}`;
}
