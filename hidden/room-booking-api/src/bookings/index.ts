import type { URLSearchParams } from "node:url";
import {
  LIMITS,
  formatId,
  idNumber,
  overlaps,
  parseTime,
  isValidText,
} from "../core/index.js";
import type { ApiError, Booking, Room } from "../core/index.js";

export interface BookingStore {
  readonly bookings: Booking[];
  nextSequence: number;
}

export function createBookingStore(): BookingStore {
  return { bookings: [], nextSequence: 1 };
}

function byStartThenId(a: Booking, b: Booking): number {
  const startA = parseTime(a.start) ?? 0;
  const startB = parseTime(b.start) ?? 0;
  return startA - startB || idNumber(a.id) - idNumber(b.id);
}

function field(body: unknown, name: string): unknown {
  if (typeof body !== "object" || body === null) return undefined;
  return Reflect.get(body, name);
}

export function createBooking(
  store: BookingStore,
  rooms: readonly Room[],
  roomId: string,
  body: unknown,
): Booking | ApiError {
  const room = rooms.find((candidate) => candidate.id === roomId);
  if (room === undefined) return { error: "room_not_found" };

  const title = field(body, "title");
  const startValue = field(body, "start");
  const endValue = field(body, "end");
  const attendees = field(body, "attendees");
  const start = parseTime(startValue);
  const end = parseTime(endValue);
  if (
    typeof title !== "string" ||
    !isValidText(title, LIMITS.bookingTitleMax) ||
    typeof startValue !== "string" ||
    typeof endValue !== "string" ||
    start === null ||
    end === null ||
    end <= start ||
    end - start > LIMITS.bookingMaxMinutes * 60000 ||
    typeof attendees !== "number" ||
    !Number.isInteger(attendees) ||
    attendees < 1
  ) {
    return { error: "invalid_booking" };
  }
  if (attendees > room.capacity) return { error: "over_capacity" };

  const conflicts = store.bookings
    .filter((existing) => existing.roomId === roomId)
    .filter((existing) => {
      const existingStart = parseTime(existing.start);
      const existingEnd = parseTime(existing.end);
      return (
        existingStart !== null &&
        existingEnd !== null &&
        overlaps(start, end, existingStart, existingEnd)
      );
    })
    .sort(byStartThenId);
  const conflict = conflicts[0];
  if (conflict !== undefined) {
    return { error: "room_busy", conflictingBookingId: conflict.id };
  }

  const booking: Booking = {
    id: formatId("booking", store.nextSequence),
    roomId,
    title,
    start: startValue,
    end: endValue,
    attendees,
  };
  store.nextSequence += 1;
  store.bookings.push(booking);
  return booking;
}

export function listBookings(
  store: BookingStore,
  rooms: readonly Room[],
  roomId: string,
  query: URLSearchParams,
): Booking[] | ApiError {
  if (!rooms.some((candidate) => candidate.id === roomId)) {
    return { error: "room_not_found" };
  }
  const inRoom = store.bookings.filter((booking) => booking.roomId === roomId);
  const hasFrom = query.has("from");
  const hasTo = query.has("to");
  if (!hasFrom && !hasTo) return inRoom.sort(byStartThenId);
  if (hasFrom !== hasTo) return { error: "invalid_query" };
  const from = parseTime(query.get("from"));
  const to = parseTime(query.get("to"));
  if (from === null || to === null || to <= from) {
    return { error: "invalid_query" };
  }
  return inRoom
    .filter((booking) => {
      const start = parseTime(booking.start);
      const end = parseTime(booking.end);
      return start !== null && end !== null && overlaps(start, end, from, to);
    })
    .sort(byStartThenId);
}

export function deleteBooking(store: BookingStore, bookingId: string): ApiError | null {
  const index = store.bookings.findIndex((booking) => booking.id === bookingId);
  if (index === -1) return { error: "booking_not_found" };
  store.bookings.splice(index, 1);
  return null;
}
