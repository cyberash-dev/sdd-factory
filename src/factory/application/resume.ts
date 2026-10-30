import { join } from "node:path";
import { isEventType, type EventType } from "../../bus/domain/catalogue.js";
import { isProducer, type DeliveredEvent } from "../../bus/domain/envelope.js";
import type { RunState, TaskState, TaskStatus } from "../../bus/domain/run-state.js";
import { dedupeKey, reduce, type TransitionRule } from "../../bus/domain/transition.js";
import { readTextOrNull } from "../../shared/fs/text.js";

export class ResumeError extends Error {
  override readonly name = "ResumeError";
}

export interface ResumeManifest {
  readonly runId: string;
  readonly slug: string;
  readonly specPath: string;
  readonly operator: string;
  readonly startedAt: string;
  readonly status: string;
  readonly resumedFrom: string | null;
}

export interface ResumeSource {
  readonly manifest: ResumeManifest;
  readonly events: readonly DeliveredEvent<EventType>[];
  readonly chain: readonly string[];
  readonly workDir: string;
}

interface RunHistory {
  readonly chain: readonly string[];
  readonly workDir: string;
  readonly events: readonly DeliveredEvent<EventType>[];
}

export interface ReplayPlan {
  readonly state: RunState;
  readonly redo: readonly DeliveredEvent<EventType>[];
}

interface ReplayPoint {
  readonly state: RunState;
  readonly event: DeliveredEvent<EventType>;
  readonly position: number;
}

interface LaneEntry {
  readonly event: DeliveredEvent<EventType>;
  readonly position: number;
  readonly taskBefore: TaskState | undefined;
}

/* factory:DLT-007: the failure chain is what the fix between runs addresses, so the replay ends at its first event. */
const REPLAY_END_EVENTS: readonly EventType[] = ["task.failed", "spec.blocked", "design.blocked", "run.failed", "run.published"];

/* factory:BEH-009: a resumed run never re-runs the bootstrap on the existing product directory, so run.started is not redone. */
const NON_REDO_EVENTS: readonly EventType[] = ["run.started"];

const IN_FLIGHT_TASK_STATUSES: readonly TaskStatus[] = ["tests_pending", "impl_pending", "verify_pending", "review_pending"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOf(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function manifestOf(text: string, runId: string): ResumeManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ResumeError(`run ${runId}: run.json is not JSON`);
  }
  if (!isRecord(parsed)) {
    throw new ResumeError(`run ${runId}: run.json is not an object`);
  }
  const fields = ["runId", "slug", "specPath", "operator", "startedAt", "status"].map((key) => [key, stringOf(parsed, key)] as const);
  const missing = fields.filter(([, value]) => value === null).map(([key]) => key);
  if (missing.length > 0) {
    throw new ResumeError(`run ${runId}: run.json lacks ${missing.join(", ")}`);
  }
  const values = Object.fromEntries(fields.map(([key, value]) => [key, value ?? ""]));
  return { runId: values["runId"] ?? "", slug: values["slug"] ?? "", specPath: values["specPath"] ?? "", operator: values["operator"] ?? "", startedAt: values["startedAt"] ?? "", status: values["status"] ?? "", resumedFrom: stringOf(parsed, "resumedFrom") };
}

function busEventsOf(traceText: string, traceRunId: string): readonly DeliveredEvent<EventType>[] {
  const events: DeliveredEvent<EventType>[] = [];
  for (const line of traceText.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(parsed) || !isEventType(parsed["type"]) || !isProducer(parsed["producer"]) || typeof parsed["seq"] !== "number") {
      continue;
    }
    const payload = parsed["payload"];
    events.push({
      type: parsed["type"],
      runId: stringOf(parsed, "runId") ?? traceRunId,
      occurredAt: stringOf(parsed, "occurredAt") ?? "",
      producer: parsed["producer"],
      seq: parsed["seq"],
      payload: isRecord(payload) ? payload : {},
    });
  }
  return events;
}

function runDirOf(repoRoot: string, runId: string): string {
  return join(repoRoot, ".factory", "runs", runId);
}

/* factory:DLT-007: the events from the first event of the failure chain onwards are neither applied nor redone. */
function beforeFailureChain(events: readonly DeliveredEvent<EventType>[]): readonly DeliveredEvent<EventType>[] {
  const end = events.findIndex((event) => REPLAY_END_EVENTS.includes(event.type));
  return end === -1 ? events : events.slice(0, end);
}

/* factory:DLT-009: a resumed run's history is its ancestor's history cut at the ancestor's failure chain, then its own events. */
async function historyOf(repoRoot: string, manifest: ResumeManifest, runDir: string, ownEvents: readonly DeliveredEvent<EventType>[]): Promise<RunHistory> {
  if (manifest.resumedFrom === null) {
    return { chain: [manifest.runId], workDir: runDir, events: ownEvents };
  }
  const ancestor = await ancestorHistoryOf(repoRoot, manifest.resumedFrom, manifest.runId);
  return { chain: [...ancestor.chain, manifest.runId], workDir: ancestor.workDir, events: [...beforeFailureChain(ancestor.events), ...ownEvents] };
}

async function ancestorHistoryOf(repoRoot: string, ancestorId: string, descendantId: string): Promise<RunHistory> {
  const runDir = runDirOf(repoRoot, ancestorId);
  const manifestText = await readTextOrNull(join(runDir, "run.json"));
  if (manifestText === null) {
    throw new ResumeError(`ancestor run ${ancestorId} of ${descendantId} has no run.json under ${runDir}`);
  }
  const traceText = await readTextOrNull(join(runDir, "trace", "trace.jsonl"));
  if (traceText === null) {
    throw new ResumeError(`ancestor run ${ancestorId} of ${descendantId} has no trace/trace.jsonl under ${runDir}`);
  }
  return historyOf(repoRoot, manifestOf(manifestText, ancestorId), runDir, busEventsOf(traceText, ancestorId));
}

export async function readRunManifest(repoRoot: string, runId: string): Promise<ResumeManifest> {
  const runDir = runDirOf(repoRoot, runId);
  const text = await readTextOrNull(join(runDir, "run.json"));
  if (text === null) {
    throw new ResumeError(`run ${runId} has no run.json under ${runDir}`);
  }
  return manifestOf(text, runId);
}

/* factory:BEH-009: a failed run (or a dead one the operator vouches for) is the source; a published run has nothing left. */
export async function readResumeSource(repoRoot: string, runId: string, force: boolean): Promise<ResumeSource> {
  const runDir = runDirOf(repoRoot, runId);
  const manifest = await readRunManifest(repoRoot, runId);
  if (manifest.status === "published") {
    throw new ResumeError(`run ${runId} is published; nothing to resume`);
  }
  if (manifest.status === "running" && !force) {
    throw new ResumeError(`run ${runId} is still marked running; pass --force when its process is gone`);
  }
  const traceText = await readTextOrNull(join(runDir, "trace", "trace.jsonl"));
  if (traceText === null) {
    throw new ResumeError(`run ${runId} has no trace/trace.jsonl under ${runDir}`);
  }
  const history = await historyOf(repoRoot, manifest, runDir, busEventsOf(traceText, runId));
  return { manifest, ...history };
}

function taskIdOf(event: DeliveredEvent<EventType>): string | null {
  const taskId = event.payload["taskId"];
  return typeof taskId === "string" ? taskId : null;
}

function withTaskRolledBack(state: RunState, taskId: string, taskBefore: TaskState | undefined): RunState {
  const { [taskId]: _dropped, ...otherTasks } = state.tasks;
  return { ...state, tasks: taskBefore === undefined ? otherTasks : { ...otherTasks, [taskId]: taskBefore } };
}

/* factory:DLT-006: every other task still in flight before the latest event gets its lane entry redone from the state before it. */
function withInFlightLanes(latest: ReplayPoint, laneEntries: ReadonlyMap<string, LaneEntry>): ReplayPlan {
  const latestTaskId = taskIdOf(latest.event);
  let state = latest.state;
  const redo: { readonly event: DeliveredEvent<EventType>; readonly position: number }[] = [latest];
  for (const [taskId, entry] of laneEntries) {
    const task = latest.state.tasks[taskId];
    if (taskId === latestTaskId || task === undefined || !IN_FLIGHT_TASK_STATUSES.includes(task.status)) {
      continue;
    }
    state = withTaskRolledBack(state, taskId, entry.taskBefore);
    redo.push(entry);
  }
  /* factory:DLT-009: seq restarts in every run of a chain, so the place in the replayed history orders the redo events. */
  return { state, redo: redo.sort((left, right) => left.position - right.position).map((point) => point.event) };
}

/* Replays the bus events through the pure rules; the latest event whose transition produced an effect is redone with the in-flight lanes. */
export function planReplay(rules: readonly TransitionRule[], initialState: RunState, events: readonly DeliveredEvent<EventType>[]): ReplayPlan {
  let state = initialState;
  const consumed = new Set<string>();
  let latest: ReplayPoint | null = null;
  const laneEntries = new Map<string, LaneEntry>();
  for (const [position, event] of beforeFailureChain(events).entries()) {
    const outcome = reduce(rules, state, event, consumed);
    const key = dedupeKey(event);
    if (key !== null) {
      consumed.add(key);
    }
    if (outcome.kind !== "applied") {
      continue;
    }
    if (outcome.result.effects.length > 0 && !NON_REDO_EVENTS.includes(event.type)) {
      latest = { state, event, position };
      const taskId = taskIdOf(event);
      if (taskId !== null) {
        laneEntries.set(taskId, { event, position, taskBefore: state.tasks[taskId] });
      }
    }
    state = outcome.result.state;
  }
  if (latest === null) {
    throw new ResumeError("nothing to resume: no replayed event produced an effect");
  }
  return withInFlightLanes(latest, laneEntries);
}
