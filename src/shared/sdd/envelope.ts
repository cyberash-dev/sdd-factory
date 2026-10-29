export class SddEnvelopeError extends Error {
  override readonly name = "SddEnvelopeError";

  constructor(
    readonly code: "sdd_envelope_unsupported" | "sdd_envelope_malformed",
    detail: string,
  ) {
    super(`${code}: ${detail}`);
  }
}

export interface LintDiagnostic {
  readonly severity: "error" | "warn";
  readonly rule: string;
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

export interface LintEnvelope {
  readonly ok: boolean;
  readonly errorCount: number;
  readonly warnCount: number;
  readonly diagnostics: readonly LintDiagnostic[];
}

export interface ReadyViolation {
  readonly kind: string;
  readonly id: string | null;
  readonly partition: string | null;
  readonly file: string | null;
  readonly line: number | null;
  readonly remediation: string;
}

export interface ReadyEnvelope {
  readonly ok: boolean;
  readonly violations: readonly ReadyViolation[];
}

export interface FinalizeEnvelope {
  readonly ok: boolean;
  readonly kind: string | null;
  readonly flipped: readonly string[];
}

const SUPPORTED_FORMAT_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new SddEnvelopeError("sdd_envelope_malformed", error instanceof Error ? error.message : String(error));
  }
  if (!isRecord(parsed)) {
    throw new SddEnvelopeError("sdd_envelope_malformed", "envelope is not an object");
  }
  return parsed;
}

function assertFormatVersion(envelope: Record<string, unknown>): void {
  const version = envelope["format_version"];
  if (version !== SUPPORTED_FORMAT_VERSION) {
    throw new SddEnvelopeError("sdd_envelope_unsupported", `format_version ${String(version)}`);
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

export function parseLintEnvelope(text: string): LintEnvelope {
  const envelope = parseJson(text);
  assertFormatVersion(envelope);
  const diagnostics = Array.isArray(envelope["diagnostics"]) ? envelope["diagnostics"] : null;
  if (diagnostics === null || typeof envelope["ok"] !== "boolean") {
    throw new SddEnvelopeError("sdd_envelope_malformed", "lint envelope lacks ok or diagnostics");
  }
  return {
    ok: envelope["ok"],
    errorCount: typeof envelope["error_count"] === "number" ? envelope["error_count"] : 0,
    warnCount: typeof envelope["warn_count"] === "number" ? envelope["warn_count"] : 0,
    diagnostics: diagnostics.map((item): LintDiagnostic => {
      if (!isRecord(item)) {
        throw new SddEnvelopeError("sdd_envelope_malformed", "diagnostic is not an object");
      }
      return {
        severity: item["severity"] === "warn" ? "warn" : "error",
        rule: stringOrNull(item["rule"]) ?? "unknown",
        file: stringOrNull(item["file"]) ?? "",
        line: numberOrNull(item["line"]) ?? 0,
        message: stringOrNull(item["message"]) ?? "",
      };
    }),
  };
}

export function parseReadyEnvelope(text: string): ReadyEnvelope {
  const envelope = parseJson(text);
  const violations = Array.isArray(envelope["violations"]) ? envelope["violations"] : null;
  if (violations === null || typeof envelope["ok"] !== "boolean") {
    throw new SddEnvelopeError("sdd_envelope_malformed", "ready envelope lacks ok or violations");
  }
  return {
    ok: envelope["ok"],
    violations: violations.map((item): ReadyViolation => {
      if (!isRecord(item) || typeof item["kind"] !== "string") {
        throw new SddEnvelopeError("sdd_envelope_malformed", "violation lacks kind");
      }
      return {
        kind: item["kind"],
        id: stringOrNull(item["id"]),
        partition: stringOrNull(item["partition"]),
        file: stringOrNull(item["file"]),
        line: numberOrNull(item["line"]),
        remediation: stringOrNull(item["remediation"]) ?? "",
      };
    }),
  };
}

export function parseFinalizeEnvelope(text: string): FinalizeEnvelope {
  const envelope = parseJson(text);
  assertFormatVersion(envelope);
  if (typeof envelope["ok"] !== "boolean") {
    throw new SddEnvelopeError("sdd_envelope_malformed", "finalize envelope lacks ok");
  }
  const ids = Array.isArray(envelope["finalized_ids"]) ? envelope["finalized_ids"] : Array.isArray(envelope["flipped"]) ? envelope["flipped"] : [];
  return { ok: envelope["ok"], kind: stringOrNull(envelope["kind"]), flipped: ids.filter((item): item is string => typeof item === "string") };
}
