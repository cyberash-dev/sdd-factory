import { createCloudExporter } from "@mozaik-ai/cloud-sdk/exporter";
import { SemanticEvent, type Participant, type SituationContext, type SituationHandler } from "@mozaik-ai/core";

export interface CloudMirrorOptions {
  readonly projectKey: string;
  readonly endpoint: string;
  readonly appUrl: string | null;
  readonly fetch: typeof fetch | null;
  readonly participants: () => readonly Participant[];
  readonly redact: (payload: unknown) => unknown;
  readonly onSessionUrl: (url: string) => void;
  readonly onDropped: (count: number, reason: string) => void;
}

export interface CloudMirror {
  readonly participant: Participant;
  readonly sessionUrl: string;
  end(): Promise<void>;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* trace:BEH-010: every forwarded payload passes the redactor, and a failing handler never reaches the runtime. */
function guarded(handler: SituationHandler, options: CloudMirrorOptions): SituationHandler {
  return {
    specification: handler.specification,
    processor: {
      apply(context: SituationContext): void | Promise<void> {
        const event = new SemanticEvent(context.event.type, context.event.producerId, context.event.occurredAt, options.redact(context.event.payload));
        try {
          const result = handler.processor.apply({ event, participant: context.participant });
          return result instanceof Promise ? result.catch((error: unknown) => options.onDropped(1, describe(error))) : undefined;
        } catch (error) {
          options.onDropped(1, describe(error));
          return undefined;
        }
      },
    },
  };
}

export function createCloudMirror(options: CloudMirrorOptions): CloudMirror {
  let sessionUrl = "";
  const exporter = createCloudExporter({
    endpoint: options.endpoint,
    projectKey: options.projectKey,
    participants: options.participants,
    ...(options.appUrl === null ? {} : { appUrl: options.appUrl }),
    ...(options.fetch === null ? {} : { fetch: options.fetch }),
    onError: (error, dropped) => options.onDropped(dropped, error.message),
    onSessionUrl: (url) => {
      sessionUrl = url;
    },
  });
  exporter.participant.setHandlers(exporter.participant.getHandlers().map((handler) => guarded(handler, options)));
  options.onSessionUrl(sessionUrl);
  return { participant: exporter.participant, sessionUrl, end: () => exporter.end() };
}
