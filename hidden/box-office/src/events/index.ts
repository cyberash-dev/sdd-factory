import { ApiError, isInteger, isPlainObject, parseTime, toIsoString } from "../core/index.js";
import type { ApiResponse, HttpRequest } from "../core/index.js";
import type { Event, Store } from "../store/index.js";

const MAX_TEXT_LENGTH = 100;
const MAX_TIERS = 5;
const MAX_QUANTITY = 10000;
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 10;

function requireOrganizer(req: HttpRequest, store: Store): string {
  if (req.caller === null) {
    throw new ApiError("E_UNAUTHENTICATED", "missing or invalid token");
  }
  const account = store.findAccountById(req.caller.id);
  if (account === undefined) {
    throw new ApiError("E_UNAUTHENTICATED", "missing or invalid token");
  }
  if (account.role !== "organizer") {
    throw new ApiError("E_FORBIDDEN", "caller is not an organizer");
  }
  return account.id;
}

function requireOwnedEvent(req: HttpRequest, store: Store): Event {
  const organizerId = requireOrganizer(req, store);
  const event = store.getEvent(req.params["id"] ?? "");
  if (event === undefined) {
    throw new ApiError("E_NOT_FOUND", "no such event");
  }
  if (event.organizerId !== organizerId) {
    throw new ApiError("E_FORBIDDEN", "caller did not create the event");
  }
  return event;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > MAX_TEXT_LENGTH) {
    throw new ApiError("E_INVALID_INPUT", `${field} must be 1-${MAX_TEXT_LENGTH} characters`);
  }
  return value;
}

function parseTier(raw: unknown): { name: string; priceCents: number; quantity: number } {
  if (!isPlainObject(raw)) {
    throw new ApiError("E_INVALID_INPUT", "tier must be an object");
  }
  const name = raw["name"];
  const priceCents = raw["priceCents"];
  const quantity = raw["quantity"];
  if (typeof name !== "string") {
    throw new ApiError("E_INVALID_INPUT", "tier name must be a string");
  }
  if (!isInteger(priceCents) || priceCents < 0) {
    throw new ApiError("E_INVALID_INPUT", "priceCents must be an integer of at least 0");
  }
  if (!isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    throw new ApiError("E_INVALID_INPUT", `quantity must be an integer in 1-${MAX_QUANTITY}`);
  }
  return { name, priceCents, quantity };
}

export function createEvent(req: HttpRequest, store: Store): ApiResponse {
  const organizerId = requireOrganizer(req, store);
  const body = req.body;
  if (!isPlainObject(body)) {
    throw new ApiError("E_INVALID_INPUT", "body must be a JSON object");
  }
  const title = text(body["title"], "title");
  const venue = text(body["venue"], "venue");
  const startsAtMs = parseTime(body["startsAt"]);
  if (startsAtMs === undefined || startsAtMs <= Date.now()) {
    throw new ApiError("E_INVALID_INPUT", "startsAt must be a time in the future");
  }
  const rawTiers = body["tiers"];
  if (!Array.isArray(rawTiers) || rawTiers.length < 1 || rawTiers.length > MAX_TIERS) {
    throw new ApiError("E_INVALID_INPUT", `tiers must hold 1-${MAX_TIERS} entries`);
  }
  const tiers = rawTiers.map(parseTier);
  if (new Set(tiers.map((t) => t.name)).size !== tiers.length) {
    throw new ApiError("E_INVALID_INPUT", "tier names must be unique");
  }
  const event = store.createEvent({
    title,
    venue,
    startsAt: toIsoString(startsAtMs),
    organizerId,
    tiers,
  });
  return { status: 201, body: event };
}

function queryTime(query: URLSearchParams, key: string): number | undefined {
  const raw = query.get(key);
  if (raw === null) {
    return undefined;
  }
  const ms = parseTime(raw);
  if (ms === undefined) {
    throw new ApiError("E_INVALID_QUERY", `${key} is not readable as a time`);
  }
  return ms;
}

function queryInteger(query: URLSearchParams, key: string, fallback: number, max: number): number {
  const raw = query.get(key);
  if (raw === null) {
    return fallback;
  }
  const value = /^-?\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new ApiError("E_INVALID_QUERY", `${key} is out of range`);
  }
  return value;
}

export function listEvents(req: HttpRequest, store: Store): ApiResponse {
  const fromMs = queryTime(req.query, "from");
  const toMs = queryTime(req.query, "to");
  const page = queryInteger(req.query, "page", 1, Number.POSITIVE_INFINITY);
  const pageSize = queryInteger(req.query, "pageSize", DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const q = req.query.get("q");
  const filter: { fromMs?: number; toMs?: number; q?: string; page: number; pageSize: number } = {
    page,
    pageSize,
  };
  if (fromMs !== undefined) filter.fromMs = fromMs;
  if (toMs !== undefined) filter.toMs = toMs;
  if (q !== null && q !== "") filter.q = q;
  return { status: 200, body: store.listEvents(filter) };
}

export function getEvent(req: HttpRequest, store: Store): ApiResponse {
  const event = store.getEvent(req.params["id"] ?? "");
  if (event === undefined) {
    throw new ApiError("E_NOT_FOUND", "no such event");
  }
  return { status: 200, body: event };
}

export function cancelEvent(req: HttpRequest, store: Store): ApiResponse {
  const event = requireOwnedEvent(req, store);
  if (event.status === "cancelled") {
    throw new ApiError("E_EVENT_CANCELLED", "event is already cancelled");
  }
  return { status: 200, body: store.cancelEvent(event.id) };
}

export function getEventReport(req: HttpRequest, store: Store): ApiResponse {
  const event = requireOwnedEvent(req, store);
  return { status: 200, body: store.getReport(event.id) };
}
