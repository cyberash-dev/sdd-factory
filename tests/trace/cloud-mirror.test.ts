import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createHarness, happyPath } from "./scripted-factory.js";

interface CapturedRequest {
  readonly url: string;
  readonly authorization: string;
  readonly envelopes: readonly Record<string, unknown>[];
}

interface CapturingTransport {
  readonly requests: CapturedRequest[];
  readonly fetch: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function capturingFetch(status: number): CapturingTransport {
  const requests: CapturedRequest[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const body = typeof init?.body === "string" ? init.body : "";
    const envelopes = body
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line): Record<string, unknown> => {
        const parsed: unknown = JSON.parse(line);
        return isRecord(parsed) ? parsed : {};
      });
    requests.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization") ?? "", envelopes });
    return new Response(JSON.stringify({ accepted: envelopes.length }), { status, headers: { "content-type": "application/json" } });
  };
  return { requests, fetch: fetchImpl };
}

function mirroredTypes(transport: CapturingTransport): Set<string> {
  const types = transport.requests.flatMap((request) => request.envelopes.map((envelope) => (isRecord(envelope["event"]) ? String(envelope["event"]["type"]) : "")));
  return new Set(types);
}

function rosterNames(harness: Awaited<ReturnType<typeof createHarness>>): string[] {
  return harness.runtime.state.getParticipants().map((participant) => participant.getManifest().name);
}

describe("Mozaik Cloud mirror", () => {
  // @covers trace:BEH-010
  // @covers trace:EXT-001
  it("joins the exporter before run.started, mirrors every bus and inference event to the endpoint, redacts secrets and links the session in trace.md", async () => {
    const transport = capturingFetch(202);
    const harness = await createHarness({ env: { MOZAIK_API_KEY: "pk-test-1234567890", NUDGE_SECRET_KEY: "sk-secret-1234567890" }, cloud: { fetch: transport.fetch } });
    const rosterBeforeRun = rosterNames(harness);

    await happyPath(harness, { nudges: [{ kind: "mid_run_nudge", actor: "cyberash", note: "rotate sk-secret-1234567890 later" }] });
    await harness.slice.shutdown();

    const types = mirroredTypes(transport);
    const bodies = transport.requests.flatMap((request) => request.envelopes).map((envelope) => JSON.stringify(envelope)).join("\n");
    const traceMd = await readFile(join(harness.traceDir, "trace.md"), "utf8");
    expect([
      rosterBeforeRun.includes("mozaik-cloud-exporter"),
      harness.published.every((event) => types.has(event.type)),
      types.has("inference.completed"),
      transport.requests.every((request) => request.url === "https://api.app.jigjoy.ai/v1/events" && request.authorization === "Bearer pk-test-1234567890"),
      bodies.includes("sk-secret-1234567890"),
      bodies.includes("rotate [REDACTED] later"),
      /^- cloud: https:\/\/app\.jigjoy\.ai\/\?s=.+$/m.test(traceMd),
    ]).toEqual([true, true, true, true, false, true, true]);
  });

  it("keeps the run alive when the endpoint rejects every batch and records a warning per dropped batch", async () => {
    const transport = capturingFetch(401);
    const harness = await createHarness({ env: { MOZAIK_API_KEY: "pk-test-1234567890" }, cloud: { fetch: transport.fetch } });

    await happyPath(harness);
    await harness.slice.shutdown();

    const traceMd = await readFile(join(harness.traceDir, "trace.md"), "utf8");
    expect([harness.published.at(-1)?.type, transport.requests.length > 0, /^- warning: cloud export dropped [0-9]+ event\(s\): ingest rejected batch: 401/m.test(traceMd)]).toEqual(["run.published", true, true]);
  });

  it("stays offline without MOZAIK_API_KEY: no exporter participant, no request, cloud none in the header", async () => {
    const transport = capturingFetch(202);
    const harness = await createHarness({ env: { PATH: "/usr/bin" }, cloud: { fetch: transport.fetch } });
    const roster = rosterNames(harness);

    await happyPath(harness);
    await harness.slice.shutdown();

    const traceMd = await readFile(join(harness.traceDir, "trace.md"), "utf8");
    expect([roster.includes("mozaik-cloud-exporter"), transport.requests.length, traceMd.includes("\n- cloud: none\n")]).toEqual([false, 0, true]);
  });
});
