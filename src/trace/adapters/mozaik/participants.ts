import type { Human, SemanticEvent } from "@mozaik-ai/core";
import { createReactor, createRuntimeObserver, type FactoryRuntime, type ReactorHandlers } from "../../../bus/adapters/mozaik/runtime.js";
import { EVENT_TYPES } from "../../../bus/domain/catalogue.js";
import { taskIdOfCapabilities } from "../../../shared/llm/api-role-runner.js";
import type { TokenCounts } from "../../../shared/llm/pricing.js";
import type { RuntimeEventInput, Tracer } from "../../application/tracer.js";
import { isRecord, stringOf } from "../../domain/guards.js";
import { isRuntimeEventType } from "../../domain/trace-record.js";

export const TRACER_NAME = "tracer";
export const TRACER_OBSERVER_NAME = "tracer-runtime";

function tokenUsageOf(payload: Readonly<Record<string, unknown>>): TokenCounts | null {
  const usage = payload["tokenUsage"];
  if (!isRecord(usage)) {
    return null;
  }
  const inputTokens = usage["inputTokens"];
  const outputTokens = usage["outputTokens"];
  return typeof inputTokens === "number" && typeof outputTokens === "number" ? { inputTokens, outputTokens } : null;
}

export function runtimeEventInputOf(event: SemanticEvent, runtime: FactoryRuntime): RuntimeEventInput | null {
  if (!isRuntimeEventType(event.type)) {
    return null;
  }
  const payload = isRecord(event.payload) ? event.payload : {};
  const manifest = event.type === "participant.joined" || event.type === "participant.left" ? null : (runtime.state.getParticipant(event.producerId)?.getManifest() ?? null);
  const participant = manifest === null ? (stringOf(payload["name"]) ?? event.producerId) : manifest.name;
  return {
    type: event.type,
    occurredAt: event.occurredAt,
    producerId: event.producerId,
    participant,
    taskId: manifest === null ? null : taskIdOfCapabilities(manifest.capabilities),
    loopId: stringOf(payload["loopId"]),
    model: stringOf(payload["model"]),
    tokenUsage: tokenUsageOf(payload),
    isLane: manifest?.capabilities?.includes("lane") ?? false,
  };
}

export function createTracerParticipants(tracer: Tracer, runtime: FactoryRuntime): readonly Human[] {
  const handlers: ReactorHandlers = Object.fromEntries(EVENT_TYPES.map((type) => [type, (event: Parameters<Tracer["recordBusEvent"]>[0]) => tracer.recordBusEvent(event)]));
  const reactor = createReactor(TRACER_NAME, handlers);
  const observer = createRuntimeObserver(TRACER_OBSERVER_NAME, (event: SemanticEvent) => {
    const input = runtimeEventInputOf(event, runtime);
    if (input !== null) {
      tracer.recordRuntimeEvent(input);
    }
  });
  return [reactor, observer];
}
