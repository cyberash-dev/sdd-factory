import { fail, ok } from "../errors/index.js";
import type { Result } from "../errors/index.js";
import type { Store } from "../domain/index.js";
import { createRoom, listRooms } from "../rooms/index.js";
import { createBooking, deleteBooking } from "../booking-writes/index.js";
import { listAvailability, listBookings } from "../booking-reads/index.js";

export interface Outcome {
  readonly status: number;
  readonly body: unknown;
}

type Handler = (store: Store, params: string[], query: URLSearchParams, body: unknown) => Result<unknown>;

interface Route {
  readonly method: string;
  readonly pattern: RegExp;
  readonly success: number;
  readonly readsBody: boolean;
  readonly handler: Handler;
}

function asObject(body: unknown): Record<string, unknown> | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
  return Object.fromEntries(Object.entries(body));
}

function withObject(run: (store: Store, params: string[], body: Record<string, unknown>) => Result<unknown>): Handler {
  return (store, params, _query, body) => {
    const object = asObject(body);
    return object === undefined ? fail({ code: "invalid_json" }) : run(store, params, object);
  };
}

export const ROUTES: readonly Route[] = [
  {
    method: "GET",
    pattern: /^\/rooms$/,
    success: 200,
    readsBody: false,
    handler: (store, _params, query) => listRooms(store, query),
  },
  {
    method: "POST",
    pattern: /^\/rooms$/,
    success: 201,
    readsBody: true,
    handler: withObject((store, _params, body) => createRoom(store, body)),
  },
  {
    method: "GET",
    pattern: /^\/rooms\/([^/]+)\/bookings$/,
    success: 200,
    readsBody: false,
    handler: (store, params, query) => listBookings(store, params[0] ?? "", query),
  },
  {
    method: "POST",
    pattern: /^\/rooms\/([^/]+)\/bookings$/,
    success: 201,
    readsBody: true,
    handler: withObject((store, params, body) => createBooking(store, params[0] ?? "", body)),
  },
  {
    method: "DELETE",
    pattern: /^\/bookings\/([^/]+)$/,
    success: 204,
    readsBody: false,
    handler: (store, params) => deleteBooking(store, params[0] ?? ""),
  },
  {
    method: "GET",
    pattern: /^\/availability$/,
    success: 200,
    readsBody: false,
    handler: (store, _params, query) => listAvailability(store, query),
  },
];

export interface Match {
  readonly route: Route;
  readonly params: string[];
}

export function matchRoute(method: string, path: string): Result<Match> {
  const candidates = ROUTES.map((route) => ({ route, found: route.pattern.exec(path) })).filter(
    (c) => c.found !== null,
  );
  if (candidates.length === 0) return fail({ code: "not_found" });
  const hit = candidates.find((c) => c.route.method === method);
  if (hit === undefined || hit.found === null) return fail({ code: "method_not_allowed" });
  return ok({ route: hit.route, params: hit.found.slice(1) });
}
