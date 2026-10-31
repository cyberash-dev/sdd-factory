import { apiError, errorResponse, jsonResponse } from "../../errors/index.js";
import type { ApiResponse } from "../../errors/index.js";
import { parseTime } from "../../core/index.js";
import type { Interval, ParsedBody, Store } from "../../core/index.js";

type WindowResult = { readonly ok: true; readonly window: Interval | null } | { readonly ok: false };

function parseWindow(query: URLSearchParams): WindowResult {
  const from = query.get("from");
  const to = query.get("to");
  if (from === null && to === null) return { ok: true, window: null };
  if (from === null || to === null) return { ok: false };
  const startMs = parseTime(from);
  const endMs = parseTime(to);
  if (startMs === null || endMs === null || endMs <= startMs) return { ok: false };
  return { ok: true, window: { startMs, endMs } };
}

export function handleListBookings(
  store: Store,
  roomId: string,
  query: URLSearchParams,
  body: ParsedBody,
): ApiResponse {
  const parsed = parseWindow(query);
  if (!parsed.ok) return errorResponse(apiError("invalid_query"));
  if (store.findRoom(roomId) === null) return errorResponse(apiError("room_not_found"));
  if (body.kind === "invalid") return errorResponse(apiError("invalid_json"));
  return jsonResponse(200, { bookings: store.listBookings(roomId, parsed.window) });
}

export function handleDeleteBooking(
  store: Store,
  bookingId: string,
  body: ParsedBody,
): ApiResponse {
  if (store.findBooking(bookingId) === null) return errorResponse(apiError("booking_not_found"));
  if (body.kind === "invalid") return errorResponse(apiError("invalid_json"));
  store.deleteBooking(bookingId);
  return jsonResponse(204, undefined);
}
