import { failure, success } from "../errors/index.js";
import type { HandlerResult } from "../errors/index.js";
import { idNumber } from "../store/index.js";
import type { Store } from "../store/index.js";
import { intervalOf, overlaps, parseUtcMinute } from "../time/index.js";

const DECIMAL_INTEGER = /^\d+$/;

function singleParameter(query: URLSearchParams, name: string): string | undefined {
  const values = query.getAll(name);
  return values.length === 1 ? values[0] : undefined;
}

export function findAvailableRooms(store: Store, query: URLSearchParams): HandlerResult {
  const startMs = parseUtcMinute(singleParameter(query, "start"));
  const endMs = parseUtcMinute(singleParameter(query, "end"));
  const attendeesText = singleParameter(query, "attendees");
  if (startMs === undefined || endMs === undefined || endMs <= startMs) {
    return failure("invalid_query");
  }
  if (attendeesText === undefined || !DECIMAL_INTEGER.test(attendeesText)) {
    return failure("invalid_query");
  }
  const attendees = Number.parseInt(attendeesText, 10);
  if (!Number.isSafeInteger(attendees) || attendees < 1) {
    return failure("invalid_query");
  }

  const requested = intervalOf(startMs, endMs);
  const rooms = store.rooms
    .list()
    .filter((room) => room.capacity >= attendees)
    .filter((room) =>
      store.bookings.listByRoom(room.id).every((booking) => {
        const bookedStart = parseUtcMinute(booking.start);
        const bookedEnd = parseUtcMinute(booking.end);
        if (bookedStart === undefined || bookedEnd === undefined) {
          return true;
        }
        return !overlaps(requested, intervalOf(bookedStart, bookedEnd));
      }),
    )
    .sort((a, b) => a.capacity - b.capacity || idNumber(a.id) - idNumber(b.id));

  return success(200, { rooms });
}
