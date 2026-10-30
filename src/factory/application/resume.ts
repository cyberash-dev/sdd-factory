import { join } from "node:path";
import { isEventType, type EventType } from "../../bus/domain/catalogue.js";
import { isProducer, type DeliveredEvent } from "../../bus/domain/envelope.js";
import type { RunState } from "../../bus/domain/run-state.js";
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
}

export interface ResumeSource {
  readonly runDir: string;
  readonly manifest: ResumeManifest;
  readonly events: readonly DeliveredEvent<EventType>[];
}

export interface ReplayPlan {
  readonly state: RunState;
  readonly redo: DeliveredEvent<EventType>;
}

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
  return { runId: values["runId"] ?? "", slug: values["slug"] ?? "", specPath: values["specPath"] ?? "", operator: values["operator"] ?? "", startedAt: values["startedAt"] ?? "", status: values["status"] ?? "" };
}

function busEventsOf(traceText: string): readonly DeliveredEvent<EventType>[] {
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
      runId: stringOf(parsed, "runId") ?? "",
      occurredAt: stringOf(parsed, "occurredAt") ?? "",
      producer: parsed["producer"],
      seq: parsed["seq"],
      payload: isRecord(payload) ? payload : {},
    });
  }
  return events;
}

export async function readRunManifest(repoRoot: string, runId: string): Promise<ResumeManifest> {
  const runDir = join(repoRoot, ".factory", "runs", runId);
  const text = await readTextOrNull(join(runDir, "run.json"));
  if (text === null) {
    throw new ResumeError(`run ${runId} has no run.json under ${runDir}`);
  }
  return manifestOf(text, runId);
}

/* factory:BEH-009: a failed run (or a dead one the operator vouches for) is the source; a published run has nothing left. */
export async function readResumeSource(repoRoot: string, runId: string, force: boolean): Promise<ResumeSource> {
  const runDir = join(repoRoot, ".factory", "runs", runId);
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
  return { runDir, manifest, events: busEventsOf(traceText) };
}

/* Replays the bus events through the pure rules; the redo event is the last one whose transition produced an effect. */
export function planReplay(rules: readonly TransitionRule[], initialState: RunState, events: readonly DeliveredEvent<EventType>[]): ReplayPlan {
  let state = initialState;
  const consumed = new Set<string>();
  let plan: ReplayPlan | null = null;
  for (const event of events) {
    if (event.type === "run.failed" || event.type === "run.published") {
      break;
    }
    const outcome = reduce(rules, state, event, consumed);
    const key = dedupeKey(event);
    if (key !== null) {
      consumed.add(key);
    }
    if (outcome.kind !== "applied") {
      continue;
    }
    if (outcome.result.effects.length > 0) {
      plan = { state, redo: event };
    }
    state = outcome.result.state;
  }
  if (plan === null) {
    throw new ResumeError("nothing to resume: no replayed event produced an effect");
  }
  return plan;
}
