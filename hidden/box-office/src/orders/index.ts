import { ApiError, isInteger, isPlainObject, parseTime } from "../core/index.js";
import type { ApiResponse, HttpRequest } from "../core/index.js";
import type { Account, Order, Store } from "../store/index.js";

const MAX_TICKETS_PER_EVENT = 6;
const REFUND_WINDOW_MS = 24 * 3_600_000;

function authenticate(req: HttpRequest, store: Store): Account {
  if (req.caller === null) {
    throw new ApiError("E_UNAUTHENTICATED", "authentication required");
  }
  const account = store.findAccountById(req.caller.id);
  if (account === undefined) {
    throw new ApiError("E_UNAUTHENTICATED", "authentication required");
  }
  return account;
}

function authenticateCustomer(req: HttpRequest, store: Store): Account {
  const account = authenticate(req, store);
  if (account.role !== "customer") {
    throw new ApiError("E_FORBIDDEN", "customer role required");
  }
  return account;
}

function ownOrder(req: HttpRequest, store: Store, customer: Account): Order {
  const order = store.getOrder(req.params["id"] ?? "");
  if (order === undefined || order.customerId !== customer.id) {
    throw new ApiError("E_NOT_FOUND", "order not found");
  }
  return order;
}

interface CheckoutInput {
  eventId: string;
  items: { tierId: string; quantity: number }[];
  discountCode: string | null;
}

function parseCheckout(body: unknown): CheckoutInput {
  if (!isPlainObject(body)) {
    throw new ApiError("E_INVALID_INPUT", "body must be a JSON object");
  }
  const { eventId, items, discountCode } = body;
  if (typeof eventId !== "string" || eventId === "") {
    throw new ApiError("E_INVALID_INPUT", "eventId is required");
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError("E_INVALID_INPUT", "items must be a non-empty array");
  }
  const parsed: { tierId: string; quantity: number }[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!isPlainObject(item) || typeof item["tierId"] !== "string") {
      throw new ApiError("E_INVALID_INPUT", "each item needs a tierId");
    }
    const quantity = item["quantity"];
    if (!isInteger(quantity) || quantity < 1) {
      throw new ApiError("E_INVALID_INPUT", "quantity must be an integer of at least 1");
    }
    if (seen.has(item["tierId"])) {
      throw new ApiError("E_INVALID_INPUT", "tierId must not repeat");
    }
    seen.add(item["tierId"]);
    parsed.push({ tierId: item["tierId"], quantity });
  }
  if (discountCode !== undefined && discountCode !== null && typeof discountCode !== "string") {
    throw new ApiError("E_INVALID_INPUT", "discountCode must be a string");
  }
  return { eventId, items: parsed, discountCode: discountCode ?? null };
}

export function createOrder(req: HttpRequest, store: Store): ApiResponse {
  const customer = authenticateCustomer(req, store);
  const input = parseCheckout(req.body);

  const event = store.getEvent(input.eventId);
  if (event === undefined) {
    throw new ApiError("E_NOT_FOUND", "event not found");
  }
  const tiers = input.items.map((item) => event.tiers.find((t) => t.id === item.tierId));
  if (tiers.some((t) => t === undefined)) {
    throw new ApiError("E_INVALID_TIER", "tier does not belong to the event");
  }
  const startsAtMs = parseTime(event.startsAt);
  if (event.status !== "on_sale" || startsAtMs === undefined || startsAtMs <= Date.now()) {
    throw new ApiError("E_EVENT_NOT_ON_SALE", "event is not on sale");
  }
  for (const item of input.items) {
    if (item.quantity > store.availableTickets(event.id, item.tierId)) {
      throw new ApiError("E_TICKETS_UNAVAILABLE", "not enough tickets available");
    }
  }
  const requested = input.items.reduce((n, i) => n + i.quantity, 0);
  if (store.ticketsHeldOrPaid(customer.id, event.id) + requested > MAX_TICKETS_PER_EVENT) {
    throw new ApiError("E_TICKET_LIMIT", "ticket limit per event exceeded");
  }
  if (input.discountCode !== null) {
    const code = store.findDiscountCode(event.id, input.discountCode);
    const expiresAtMs = code === undefined ? null : parseTime(code.expiresAt);
    if (
      code === undefined ||
      (expiresAtMs !== null && expiresAtMs !== undefined && expiresAtMs <= Date.now()) ||
      (code.maxUses !== null && code.uses >= code.maxUses)
    ) {
      throw new ApiError("E_DISCOUNT_UNUSABLE", "discount code is unusable");
    }
  }

  const order = store.holdOrder({
    eventId: event.id,
    customerId: customer.id,
    items: input.items,
    discountCode: input.discountCode,
  });
  return { status: 201, body: order };
}

export function payOrder(req: HttpRequest, store: Store): ApiResponse {
  const customer = authenticateCustomer(req, store);
  const order = ownOrder(req, store, customer);
  if (order.status !== "held") {
    throw new ApiError("E_ORDER_STATE", "only a held order can be paid");
  }
  return { status: 200, body: store.markPaid(order.id) };
}

export function cancelOrder(req: HttpRequest, store: Store): ApiResponse {
  const customer = authenticateCustomer(req, store);
  const order = ownOrder(req, store, customer);
  if (order.status === "held") {
    return { status: 200, body: store.releaseOrder(order.id, "cancelled") };
  }
  if (order.status === "paid") {
    const event = store.getEvent(order.eventId);
    const startsAtMs = event === undefined ? undefined : parseTime(event.startsAt);
    if (startsAtMs === undefined || startsAtMs - Date.now() <= REFUND_WINDOW_MS) {
      throw new ApiError("E_ORDER_STATE", "paid order is inside the refund window");
    }
    return { status: 200, body: store.releaseOrder(order.id, "refunded") };
  }
  throw new ApiError("E_ORDER_STATE", `an order in status ${order.status} cannot be cancelled`);
}

export function getOrder(req: HttpRequest, store: Store): ApiResponse {
  const account = authenticate(req, store);
  const order = store.getOrder(req.params["id"] ?? "");
  if (order === undefined) {
    throw new ApiError("E_NOT_FOUND", "order not found");
  }
  const organizerId = store.getEvent(order.eventId)?.organizerId;
  if (order.customerId !== account.id && organizerId !== account.id) {
    throw new ApiError("E_NOT_FOUND", "order not found");
  }
  return { status: 200, body: order };
}

export function listMyOrders(req: HttpRequest, store: Store): ApiResponse {
  const customer = authenticateCustomer(req, store);
  const orders = store
    .listOrdersByCustomer(customer.id)
    .map((order, index) => ({ order, index, at: parseTime(order.createdAt) ?? 0 }))
    .sort((a, b) => b.at - a.at || b.index - a.index)
    .map((entry) => entry.order);
  return { status: 200, body: orders };
}
