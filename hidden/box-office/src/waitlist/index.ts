import { ApiError, isInteger, isPlainObject } from "../core/index.js";
import type { ApiResponse, HttpRequest } from "../core/index.js";
import type { Store } from "../store/index.js";

const MAX_QUANTITY = 6;

export function joinWaitlist(req: HttpRequest, store: Store): ApiResponse {
  const body = req.body;
  if (!isPlainObject(body)) {
    throw new ApiError("E_INVALID_INPUT", "body must be a JSON object");
  }
  const { tierId, quantity } = body;
  if (typeof tierId !== "string" || tierId.length === 0) {
    throw new ApiError("E_INVALID_INPUT", "tierId is required");
  }
  if (!isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    throw new ApiError("E_INVALID_INPUT", `quantity must be an integer in 1-${MAX_QUANTITY}`);
  }
  const event = store.getEvent(req.params["id"] ?? "");
  if (event === undefined) {
    throw new ApiError("E_NOT_FOUND", "no such event");
  }
  const tier = event.tiers.find((t) => t.id === tierId);
  if (tier === undefined) {
    throw new ApiError("E_INVALID_TIER", "tierId is not a tier of the event");
  }
  const customerId = req.caller?.id;
  if (customerId === undefined) {
    throw new ApiError("E_UNAUTHENTICATED", "a valid token is required");
  }
  if (tier.available >= quantity) {
    throw new ApiError("E_TICKETS_AVAILABLE", "the tier has enough tickets available");
  }
  if (store.findWaitlistEntry(customerId, tier.id) !== undefined) {
    throw new ApiError("E_ALREADY_WAITING", "the caller already waits for this tier");
  }
  const entry = store.joinWaitlist({ eventId: event.id, tierId: tier.id, customerId, quantity });
  return { status: 201, body: entry };
}

export function listMyWaitlist(req: HttpRequest, store: Store): ApiResponse {
  const customerId = req.caller?.id;
  if (customerId === undefined) {
    throw new ApiError("E_UNAUTHENTICATED", "a valid token is required");
  }
  const entries = store
    .listWaitlistByCustomer(customerId)
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => (a.entry.tierId < b.entry.tierId ? -1 : a.entry.tierId > b.entry.tierId ? 1 : a.entry.position - b.entry.position || a.index - b.index))
    .map((item) => item.entry);
  return { status: 200, body: entries };
}
