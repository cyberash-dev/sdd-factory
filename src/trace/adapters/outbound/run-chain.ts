import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { integerOf, isRecord, numberOrNull, stringOf } from "../../domain/guards.js";
import type { EarlierRun, RunOutcome } from "../../domain/report.js";
import type { EarlierRunReader } from "../../ports/outbound/trace-store.js";
import { TRACE_FILE_NAMES } from "./trace-files.js";

const MANIFEST_FILE = "run.json";
const TRACE_DIR = "trace";

type JsonObject = Readonly<Record<string, unknown>>;

type JsonRead = { readonly kind: "read"; readonly value: JsonObject } | { readonly kind: "unreadable"; readonly reason: string };

export interface EarlierTraceDir {
  readonly runId: string;
  readonly traceDir: string;
}

interface ChainLink {
  readonly runId: string;
  readonly runDir: string;
  readonly manifest: JsonRead;
}

/* Reporting never ends a run: a file that cannot be read becomes a reason, not an exception. */
function jsonObjectAt(path: string): JsonRead {
  if (!existsSync(path)) {
    return { kind: "unreadable", reason: `${path} is missing` };
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isRecord(parsed) ? { kind: "read", value: parsed } : { kind: "unreadable", reason: `${path} is not a JSON object` };
  } catch (error) {
    return { kind: "unreadable", reason: error instanceof SyntaxError ? `${path} is not JSON` : `${path} is unreadable: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function resumedFromOf(manifest: JsonRead): string | null {
  return manifest.kind === "read" ? stringOf(manifest.value["resumedFrom"]) : null;
}

/* Until the factory has written this run's run.json (on run.started) there is no chain; an unreadable run.json ends the walk. */
function earlierLinksOf(runDir: string): readonly ChainLink[] {
  const runsRoot = dirname(runDir);
  const links: ChainLink[] = [];
  let ancestorId = resumedFromOf(jsonObjectAt(join(runDir, MANIFEST_FILE)));
  while (ancestorId !== null) {
    const ancestorDir = join(runsRoot, ancestorId);
    const manifest = jsonObjectAt(join(ancestorDir, MANIFEST_FILE));
    links.unshift({ runId: ancestorId, runDir: ancestorDir, manifest });
    ancestorId = resumedFromOf(manifest);
  }
  return links;
}

function outcomeOf(manifest: JsonObject): RunOutcome {
  switch (manifest["status"]) {
    case "published":
      return { kind: "published" };
    case "failed":
      return { kind: "failed", stage: stringOf(manifest["stage"]) ?? "", reason: stringOf(manifest["reason"]) ?? "" };
    default:
      return { kind: "in_progress" };
  }
}

function earlierRunOf(link: ChainLink): EarlierRun {
  if (link.manifest.kind === "unreadable") {
    return { kind: "unavailable", runId: link.runId, reason: link.manifest.reason };
  }
  const costsPath = join(link.runDir, TRACE_DIR, TRACE_FILE_NAMES.costs);
  const costs = jsonObjectAt(costsPath);
  if (costs.kind === "unreadable") {
    return { kind: "unavailable", runId: link.runId, reason: costs.reason };
  }
  const totals = costs.value["totals"];
  if (!isRecord(totals)) {
    return { kind: "unavailable", runId: link.runId, reason: `${costsPath} has no totals` };
  }
  const manifest = link.manifest.value;
  return {
    kind: "available",
    runId: link.runId,
    outcome: outcomeOf(manifest),
    startedAt: stringOf(manifest["startedAt"]) ?? "",
    finishedAt: stringOf(manifest["endedAt"]),
    durationMs: integerOf(totals["durationMs"]),
    costUsd: numberOrNull(totals["costUsd"]) ?? 0,
    inputTokens: integerOf(totals["inputTokens"]),
    outputTokens: integerOf(totals["outputTokens"]),
  };
}

export function earlierRunReader(runDir: string): EarlierRunReader {
  return () => earlierLinksOf(runDir).map(earlierRunOf);
}

export function earlierTraceDirs(runDir: string): readonly EarlierTraceDir[] {
  return earlierLinksOf(runDir).map((link) => ({ runId: link.runId, traceDir: join(link.runDir, TRACE_DIR) }));
}
