import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseFinalizeEnvelope, parseLintEnvelope, parseReadyEnvelope, SddEnvelopeError } from "../../src/shared/sdd/envelope.js";

const fixture = (name: string): Promise<string> => readFile(new URL(`../fixtures/sdd-envelopes/${name}.json`, import.meta.url), "utf8");

function codeOf(action: () => void): string {
  try {
    action();
  } catch (error) {
    return error instanceof SddEnvelopeError ? error.code : "other";
  }
  return "no error";
}

describe("agent-sdd 2.1.1 JSON envelopes", () => {
  // @covers factory:EXT-003
  it("parses a clean lint envelope", async () => {
    expect(parseLintEnvelope(await fixture("lint-ok"))).toEqual({ ok: true, errorCount: 0, warnCount: 0, diagnostics: [] });
  });

  it("parses lint diagnostics with rule, file, line and message", async () => {
    const envelope = parseLintEnvelope(await fixture("lint-diagnostics"));

    expect([envelope.ok, envelope.errorCount, envelope.diagnostics[0]?.rule, envelope.diagnostics[0]?.file, envelope.diagnostics[0]?.severity]).toEqual([false, 1, "sdd:weasel-word", "spec/factory.md", "error"]);
  });

  it("parses ready violations with kind and id", async () => {
    const envelope = parseReadyEnvelope(await fixture("ready-violations"));

    expect([envelope.ok, envelope.violations[0]?.kind, envelope.violations[0]?.id, envelope.violations.some((violation) => violation.kind === "uncovered")]).toEqual([false, "unapproved", "factory:DLT-001", true]);
  });

  it("parses a finalize refusal with its kind", async () => {
    expect(parseFinalizeEnvelope(await fixture("finalize-no-plan"))).toEqual({ ok: false, kind: "no-active-plan", flipped: [] });
  });

  it("reads the finalized record ids from a successful finalize envelope", () => {
    const envelope = parseFinalizeEnvelope(JSON.stringify({ format_version: 1, ok: true, finalized_ids: ["todo:BEH-001", "todo:CTR-001"] }));

    expect(envelope).toEqual({ ok: true, kind: null, flipped: ["todo:BEH-001", "todo:CTR-001"] });
  });

  it("rejects an envelope with an unsupported format_version", () => {
    expect(codeOf(() => parseLintEnvelope(JSON.stringify({ format_version: 2, ok: true, diagnostics: [] })))).toBe("sdd_envelope_unsupported");
  });

  it("rejects text that is not a JSON object", () => {
    expect(codeOf(() => parseReadyEnvelope("spec-lint: 0 error(s)"))).toBe("sdd_envelope_malformed");
  });
});
