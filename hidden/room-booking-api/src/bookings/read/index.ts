import { apiError } from "../../errors/index.js";
import type { ApiError } from "../../errors/index.js";
import { findRoom, listBookingsOfRoom, overlappingBookings, parseInstant } from "../../state/index.js";
import type { Booking } from "../../state/index.js";

export function listBookings(
  roomId: string,
  query: URLSearchParams,
): { bookings: Booking[] } | ApiError {
  const fromText = query.get("from");
  const toText = query.get("to");
  if (fromText === null && toText === null) {
    if (findRoom(roomId) === undefined) {
      return apiError("room_not_found");
    }
    return { bookings: listBookingsOfRoom(roomId) };
  }
  if (fromText === null || toText === null) {
    return apiError("invalid_query");
  }
  const from = parseInstant(fromText);
  const to = parseInstant(toText);
  if (from === undefined || to === undefined || to <= from) {
    return apiError("invalid_query");
  }
  if (findRoom(roomId) === undefined) {
    return apiError("room_not_found");
  }
  return { bookings: overlappingBookings(roomId, from, to) };
}
