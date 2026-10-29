import type { EventType } from "../../domain/catalogue.js";
import type { DeliveredEvent } from "../../domain/envelope.js";
import type { PendingEvent } from "../../domain/transition.js";

export interface EventPublisher {
  publish(pending: PendingEvent): DeliveredEvent<EventType>;
}
