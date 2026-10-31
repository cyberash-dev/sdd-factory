import { parseLintEnvelope, SddEnvelopeError, type LintDiagnostic, type LintEnvelope } from "../../shared/sdd/envelope.js";
import { YAML_FENCE } from "../../shared/sdd/spec-records.js";
import type { GateFailure, GateFindingKind } from "./gate-findings.js";

const RECORD_ID = /[a-z][a-z0-9-]*:[A-Z][A-Z0-9]*-[0-9]+/g;

const QUOTED_RECORD_ID = /"([a-z][a-z0-9-]*:[A-Z][A-Z0-9]*-[0-9]+)"/g;

const RECORD_ID_LINE = /^id:\s*(\S+)/m;

function unique(ids: readonly string[]): readonly string[] {
  return [...new Set(ids)];
}

export function textGateFailure(kind: GateFindingKind, text: string): GateFailure {
  return { kind, targetIds: unique(text.match(RECORD_ID) ?? []), text };
}

function quotedRecordIds(text: string): readonly string[] {
  return unique([...text.matchAll(QUOTED_RECORD_ID)].map((match) => match[1] ?? ""));
}

/* spec-stage:DLT-010: a probe finding targets the record it names, else the record its message quotes, as a lint diagnostic does. */
export function recordGateFailure(recordId: string | null, text: string): GateFailure {
  return { kind: "gap", targetIds: recordId === null ? quotedRecordIds(text) : [recordId], text };
}

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

function recordIdAtLine(recordText: string, line: number): string | null {
  for (const fence of recordText.matchAll(YAML_FENCE)) {
    const firstLine = lineOf(recordText, fence.index);
    const lastLine = firstLine + fence[0].split("\n").length - 1;
    if (line >= firstLine && line <= lastLine) {
      return RECORD_ID_LINE.exec(fence[1] ?? "")?.[1] ?? null;
    }
  }
  return null;
}

/* spec-stage:DLT-011: the record a diagnostic quotes, else the record whose fence holds the diagnostic line. */
function diagnosticFailure(diagnostic: LintDiagnostic, recordFiles: ReadonlyMap<string, string>): GateFailure {
  const quotedIds = quotedRecordIds(diagnostic.message);
  const recordText = recordFiles.get(diagnostic.file);
  const fenceId = quotedIds.length > 0 || recordText === undefined ? null : recordIdAtLine(recordText, diagnostic.line);
  return {
    kind: "gap",
    targetIds: fenceId === null ? quotedIds : [fenceId],
    text: `${diagnostic.rule} at ${diagnostic.file}:${diagnostic.line}: ${diagnostic.message}`,
  };
}

function lintEnvelopeOrNull(line: string): LintEnvelope | null {
  try {
    return parseLintEnvelope(line);
  } catch (error) {
    if (error instanceof SddEnvelopeError) {
      return null;
    }
    throw error;
  }
}

/* One failure per error diagnostic of the `sdd lint --format=json` envelope and one per other output line (yaml_invalid lines, plain stderr). */
export function lintGateFailures(output: string, recordFiles: ReadonlyMap<string, string>): readonly GateFailure[] {
  const failures: GateFailure[] = [];
  for (const line of output.split("\n").map((candidate) => candidate.trim())) {
    if (line === "") {
      continue;
    }
    const envelope = lintEnvelopeOrNull(line);
    if (envelope === null) {
      failures.push(textGateFailure("gap", line));
      continue;
    }
    failures.push(...envelope.diagnostics.filter((diagnostic) => diagnostic.severity === "error").map((diagnostic) => diagnosticFailure(diagnostic, recordFiles)));
  }
  return failures;
}
