import { fail, ok } from "../errors/index.js";
import type { Result } from "../errors/index.js";
import { addBooking, compareIds, findRoom, overlaps, removeBooking } from "../domain/index.js";
import type { Booking, BookingFields, Store } from "../domain/index.js";

const MAX_TITLE_LENGTH = 80;
const MAX_DURATION_MS = 8 * 60 * 60 * 1000;

const TIME_FORM = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):00Z$/;

function parseTime(value: string): string | undefined {
  const m = TIME_FORM.exec(value);
  if (m === null) return undefined;
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, day ?? 0, hour ?? 0, minute ?? 0));
  const valid =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === (month ?? 0) - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute;
  return valid ? value : undefined;
}

function parseFields(body: Record<string, unknown>): BookingFields | undefined {
  const { title, start, end, attendees } = body;
  if (typeof title !== "string" || typeof start !== "string" || typeof end !== "string") {
    return undefined;
  }
  if (typeof attendees !== "number" || !Number.isInteger(attendees) || attendees < 1) {
    return undefined;
  }
  const trimmed = title.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TITLE_LENGTH) return undefined;
  const parsedStart = parseTime(start);
  const parsedEnd = parseTime(end);
  if (parsedStart === undefined || parsedEnd === undefined) return undefined;
  const duration = Date.parse(parsedEnd) - Date.parse(parsedStart);
  if (duration <= 0 || duration > MAX_DURATION_MS) return undefined;
  return { title: trimmed, start: parsedStart, end: parsedEnd, attendees };
}

export function createBooking(
  store: Store,
  roomId: string,
  body: Record<string, unknown>,
): Result<Booking> {
  const room = findRoom(store, roomId);
  if (room === undefined) return fail({ code: "room_not_found" });
  const fields = parseFields(body);
  if (fields === undefined) return fail({ code: "invalid_booking" });
  if (fields.attendees > room.capacity) return fail({ code: "over_capacity" });
  const conflicts = store.bookings
    .filter((b) => b.roomId === roomId && overlaps(fields.start, fields.end, b.start, b.end))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : compareIds(a.id, b.id)));
  const first = conflicts[0];
  if (first !== undefined) {
    return fail({ code: "room_busy", conflictingBookingId: first.id });
  }
  return ok(addBooking(store, roomId, fields));
}

export function deleteBooking(store: Store, bookingId: string): Result<null> {
  if (!removeBooking(store, bookingId)) return fail({ code: "booking_not_found" });
  return ok(null);
}
