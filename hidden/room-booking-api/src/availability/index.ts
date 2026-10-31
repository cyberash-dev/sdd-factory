import type { URLSearchParams } from "node:url";
import { idNumber, overlaps, parseTime } from "../core/index.js";
import type { ApiError, Booking, Room } from "../core/index.js";

const INVALID_QUERY: ApiError = { error: "invalid_query" };

function isBookedWithin(roomId: string, bookings: readonly Booking[], start: number, end: number): boolean {
  return bookings.some((booking) => {
    if (booking.roomId !== roomId) return false;
    const bookingStart = parseTime(booking.start);
    const bookingEnd = parseTime(booking.end);
    if (bookingStart === null || bookingEnd === null) return false;
    return overlaps(bookingStart, bookingEnd, start, end);
  });
}

export function findAvailableRooms(
  rooms: readonly Room[],
  bookings: readonly Booking[],
  query: URLSearchParams,
): Room[] | ApiError {
  const startText = query.get("start");
  const endText = query.get("end");
  const attendeesText = query.get("attendees");
  if (startText === null || endText === null || attendeesText === null) return INVALID_QUERY;
  const start = parseTime(startText);
  const end = parseTime(endText);
  if (start === null || end === null || end <= start) return INVALID_QUERY;
  if (!/^[0-9]+$/.test(attendeesText)) return INVALID_QUERY;
  const attendees = Number(attendeesText);
  if (!Number.isSafeInteger(attendees) || attendees < 1) return INVALID_QUERY;

  return rooms
    .filter((room) => room.capacity >= attendees && !isBookedWithin(room.id, bookings, start, end))
    .sort((a, b) => a.capacity - b.capacity || idNumber(a.id) - idNumber(b.id));
}
