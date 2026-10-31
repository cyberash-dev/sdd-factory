import { resolve } from "node:path";
import { createRedactor as createEnvRedactor, redactDeep } from "../shared/redaction.js";
import type { Slice, SliceContext } from "../shared/slice.js";
import { createCloudMirror, type CloudMirror } from "./adapters/mozaik/cloud-mirror.js";
import { createTracerParticipants } from "./adapters/mozaik/participants.js";
import { earlierRunReader } from "./adapters/outbound/run-chain.js";
import { productTextReader, TraceFiles } from "./adapters/outbound/trace-files.js";
import { Tracer } from "./application/tracer.js";
import { createRedactor, secretValuesOf, type Environment } from "./domain/redaction.js";

export { activeIntervals, overlaps, type ActiveInterval } from "./domain/intervals.js";
export { TRACE_FILE_NAMES } from "./adapters/outbound/trace-files.js";
export { earlierTraceDirs } from "./adapters/outbound/run-chain.js";
export { CHAIN_DIR } from "./domain/trace-md.js";

export interface CloudTransportOptions {
  readonly fetch?: typeof fetch;
}

export interface TraceSliceOptions {
  readonly env?: Environment;
  readonly cloud?: CloudTransportOptions;
}

export interface TraceSlice extends Slice {
  idle(): Promise<void>;
  shutdown(): Promise<void>;
  copyTraceTo(destinationDir: string): Promise<void>;
}

const DEFAULT_CLOUD_ENDPOINT = "https://api.app.jigjoy.ai";

export type TraceSliceFactory = (context: SliceContext) => TraceSlice;

export class TraceError extends Error {
  override readonly name = "TraceError";
}

/* One run per process: the publish step reaches the live tracer of a run by its trace directory. */
const tracersByDir = new Map<string, Tracer>();

function createTracer(context: SliceContext, secrets: readonly string[]): Tracer {
  return new Tracer({
    runId: context.runId,
    slug: context.slug,
    operator: context.operator,
    pricing: context.config.pricing,
    store: new TraceFiles(context.paths.traceDir, createRedactor(secrets)),
    readProductText: productTextReader(context.paths.productDir),
    readEarlierRuns: earlierRunReader(context.paths.runDir),
    now: context.now,
    publish: (pending) => {
      context.runtime.publisher.publish(pending);
    },
    log: context.log,
  });
}

/* trace:BEH-010: the mirror exists only when MOZAIK_API_KEY is set; secrets never leave the process. */
function createMirror(context: SliceContext, tracer: Tracer, env: Environment, transport: CloudTransportOptions): CloudMirror | null {
  const projectKey = env["MOZAIK_API_KEY"];
  if (projectKey === undefined || projectKey.length === 0) {
    return null;
  }
  const redact = createEnvRedactor(env);
  return createCloudMirror({
    projectKey,
    endpoint: env["MOZAIK_CLOUD_ENDPOINT"] ?? DEFAULT_CLOUD_ENDPOINT,
    appUrl: env["MOZAIK_CLOUD_APP_URL"] ?? null,
    fetch: transport.fetch ?? null,
    participants: () => context.runtime.state.getParticipants(),
    redact: (payload) => redactDeep(payload, redact),
    onSessionUrl: (url) => {
      tracer.recordCloudSession(url);
      context.log(`mozaik cloud session: ${url}`);
    },
    onDropped: (count, reason) => tracer.recordCloudDrop(count, reason),
  });
}

async function withTimeout(action: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const expiry = new Promise<void>((resolveExpiry) => {
    timer = setTimeout(resolveExpiry, timeoutMs);
  });
  try {
    await Promise.race([action, expiry]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

export function createTraceSlice(options: TraceSliceOptions = {}): TraceSliceFactory {
  const env = options.env ?? process.env;
  const secrets = secretValuesOf(env);
  return (context) => {
    const tracer = createTracer(context, secrets);
    tracersByDir.set(resolve(context.paths.traceDir), tracer);
    const mirror = createMirror(context, tracer, env, options.cloud ?? {});
    const participants = [...createTracerParticipants(tracer, context.runtime), ...(mirror === null ? [] : [mirror.participant])];
    return {
      name: "trace",
      rules: [],
      effects: {},
      participants: () => participants,
      idle: () => tracer.idle(),
      shutdown: async () => {
        if (mirror !== null) {
          await withTimeout(mirror.end(), context.config.timeouts.shutdownMs);
        }
        await tracer.idle();
      },
      copyTraceTo: (destinationDir) => tracer.copyTo(destinationDir),
    };
  };
}

export async function copyTraceTo(traceDir: string, destinationDir: string): Promise<void> {
  const tracer = tracersByDir.get(resolve(traceDir));
  if (tracer === undefined) {
    throw new TraceError(`no tracer joined for ${traceDir}`);
  }
  await tracer.copyTo(destinationDir);
}
