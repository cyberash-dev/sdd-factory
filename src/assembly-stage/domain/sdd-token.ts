import { SddEnvelopeError } from "../../shared/sdd/envelope.js";

export type TokenEnvelope = { readonly ok: true; readonly token: string; readonly commitSha: string } | { readonly ok: false; readonly reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseTokenEnvelope(text: string): TokenEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new SddEnvelopeError("sdd_envelope_malformed", error instanceof Error ? error.message : String(error));
  }
  if (!isRecord(parsed) || typeof parsed["ok"] !== "boolean") {
    throw new SddEnvelopeError("sdd_envelope_malformed", "token envelope lacks ok");
  }
  if (!parsed["ok"]) {
    return { ok: false, reason: typeof parsed["reason"] === "string" ? parsed["reason"] : "unknown" };
  }
  const token = parsed["token"];
  const commitSha = parsed["commit_sha"];
  if (typeof token !== "string" || typeof commitSha !== "string") {
    throw new SddEnvelopeError("sdd_envelope_malformed", "token envelope lacks token or commit_sha");
  }
  return { ok: true, token, commitSha };
}
