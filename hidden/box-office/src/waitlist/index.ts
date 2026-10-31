import { ApiError, isInteger, isPlainObject } from "../core/index.js";
import type { ApiResponse, HttpRequest } from "../core/index.js";
import type { Store } from "../store/index.js";

const MIN_QUANTITY = 1;
const MAX_QUANTITY = 6;

export function joinWaitlist(req: HttpRequest, store: Store): ApiResponse {
  const body = req.body;
  if (!isPlainObject(body)) {
    throw new ApiError("E_INVALID_INPUT", "body must be a JSON object");
  }
  const { tierId, quantity } = body;
  if (typeof tierId !== "string" || tierId === "") {
    throw new ApiError("E_INVALID_INPUT", "tierId is required");
  }
  if (!isInteger(quantity) || quantity < MIN_QUANTITY || quantity > MAX_QUANTITY) {
    throw new ApiError("E_INVALID_INPUT", `quantity must be an integer in ${MIN_QUANTITY}-${MAX_QUANTITY}`);
  }
  const event = store.getEvent(req.params["id"] ?? "");
  if (event === undefined) {
    throw new ApiError("E_NOT_FOUND", "no event carries the id");
  }
  if (!event.tiers.some((tier) => tier.id === tierId)) {
    throw new ApiError("E_INVALID_TIER", "tier does not belong to the event");
  }
  if (req.caller === null) {
    throw new ApiError("E_UNAUTHENTICATED", "a valid token is required");
  }
  if (store.availableTickets(event.id, tierId) >= quantity) {
    throw new ApiError("E_TICKETS_AVAILABLE", "the tier has enough tickets available");
  }
  if (store.findWaitlistEntry(req.caller.id, tierId) !== undefined) {
    throw new ApiError("E_ALREADY_WAITING", "the caller already waits for that tier");
  }
  const entry = store.joinWaitlist({ eventId: event.id, tierId, customerId: req.caller.id, quantity });
  return { status: 201, body: entry };
}

export function listMyWaitlist(req: HttpRequest, store: Store): ApiResponse {
  if (req.caller === null) {
    throw new ApiError("E_UNAUTHENTICATED", "a valid token is required");
  }
  return { status: 200, body: store.listWaitlistByCustomer(req.caller.id) };
}
