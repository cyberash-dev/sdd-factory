import { failure, success } from "../errors/index.js";
import type { HandlerResult } from "../errors/index.js";
import { idNumber } from "../store/index.js";
import type { Booking, Store } from "../store/index.js";
import { intervalOf, overlaps, parseUtcMinute } from "../time/index.js";
import type { Interval } from "../time/index.js";

function bookingInterval(booking: Booking): Interval | undefined {
  const startMs = parseUtcMinute(booking.start);
  const endMs = parseUtcMinute(booking.end);
  if (startMs === undefined || endMs === undefined) {
    return undefined;
  }
  return intervalOf(startMs, endMs);
}

function compareBookings(a: Booking, b: Booking): number {
  if (a.start !== b.start) {
    return a.start < b.start ? -1 : 1;
  }
  return idNumber(a.id) - idNumber(b.id);
}

export function listBookings(store: Store, roomId: string, query: URLSearchParams): HandlerResult {
  if (store.rooms.get(roomId) === undefined) {
    return failure("room_not_found");
  }

  const hasFrom = query.has("from");
  const hasTo = query.has("to");
  if (hasFrom !== hasTo) {
    return failure("invalid_query");
  }

  let filter: Interval | undefined;
  if (hasFrom && hasTo) {
    const fromMs = parseUtcMinute(query.get("from"));
    const toMs = parseUtcMinute(query.get("to"));
    if (fromMs === undefined || toMs === undefined || toMs <= fromMs) {
      return failure("invalid_query");
    }
    filter = intervalOf(fromMs, toMs);
  }

  const bookings = store.bookings
    .listByRoom(roomId)
    .filter((booking) => {
      if (filter === undefined) {
        return true;
      }
      const interval = bookingInterval(booking);
      return interval !== undefined && overlaps(interval, filter);
    })
    .sort(compareBookings);

  return success(200, { bookings });
}
