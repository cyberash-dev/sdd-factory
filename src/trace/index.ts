import { resolve } from "node:path";
import type { Slice, SliceContext } from "../shared/slice.js";
import { createTracerParticipants } from "./adapters/mozaik/participants.js";
import { productTextReader, TraceFiles } from "./adapters/outbound/trace-files.js";
import { Tracer } from "./application/tracer.js";
import { createRedactor, secretValuesOf, type Environment } from "./domain/redaction.js";

export { activeIntervals, overlaps, type ActiveInterval } from "./domain/intervals.js";
export { TRACE_FILE_NAMES } from "./adapters/outbound/trace-files.js";

export interface TraceSliceOptions {
  readonly env?: Environment;
}

export interface TraceSlice extends Slice {
  shutdown(): Promise<void>;
  copyTraceTo(destinationDir: string): Promise<void>;
}

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
    now: context.now,
    publish: (pending) => {
      context.runtime.publisher.publish(pending);
    },
    log: context.log,
  });
}

export function createTraceSlice(options: TraceSliceOptions = {}): TraceSliceFactory {
  const secrets = secretValuesOf(options.env ?? process.env);
  return (context) => {
    const tracer = createTracer(context, secrets);
    tracersByDir.set(resolve(context.paths.traceDir), tracer);
    const participants = createTracerParticipants(tracer, context.runtime);
    return {
      name: "trace",
      rules: [],
      effects: {},
      participants: () => participants,
      shutdown: () => tracer.idle(),
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
