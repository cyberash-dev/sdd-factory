import { failure, success } from "../errors/index.js";
import type { HandlerResult } from "../errors/index.js";
import { idNumber } from "../store/index.js";
import type { Booking, NewBooking, Store } from "../store/index.js";
import { intervalOf, lengthMs, overlaps, parseUtcMinute } from "../time/index.js";

const TITLE_MAX_CODE_POINTS = 80;
const DURATION_MAX_MS = 8 * 3600 * 1000;

interface ValidBooking {
  readonly fields: Omit<NewBooking, "roomId">;
  readonly startMs: number;
  readonly endMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateFields(body: unknown): ValidBooking | undefined {
  if (!isRecord(body)) {
    return undefined;
  }
  const { title, start, end, attendees } = body;
  if (typeof title !== "string" || title.trim() === "") {
    return undefined;
  }
  if ([...title].length > TITLE_MAX_CODE_POINTS) {
    return undefined;
  }
  const startMs = parseUtcMinute(start);
  const endMs = parseUtcMinute(end);
  if (typeof start !== "string" || typeof end !== "string") {
    return undefined;
  }
  if (startMs === undefined || endMs === undefined || endMs <= startMs) {
    return undefined;
  }
  if (lengthMs(intervalOf(startMs, endMs)) > DURATION_MAX_MS) {
    return undefined;
  }
  if (typeof attendees !== "number" || !Number.isInteger(attendees) || attendees < 1) {
    return undefined;
  }
  return { fields: { title, start, end, attendees }, startMs, endMs };
}

function earliestConflict(existing: readonly Booking[], startMs: number, endMs: number): Booking | undefined {
  const wanted = intervalOf(startMs, endMs);
  let earliest: { booking: Booking; startMs: number } | undefined;
  for (const booking of existing) {
    const bookingStartMs = parseUtcMinute(booking.start);
    const bookingEndMs = parseUtcMinute(booking.end);
    if (bookingStartMs === undefined || bookingEndMs === undefined) {
      continue;
    }
    if (!overlaps(wanted, intervalOf(bookingStartMs, bookingEndMs))) {
      continue;
    }
    const earlier =
      earliest === undefined ||
      bookingStartMs < earliest.startMs ||
      (bookingStartMs === earliest.startMs && idNumber(booking.id) < idNumber(earliest.booking.id));
    if (earlier) {
      earliest = { booking, startMs: bookingStartMs };
    }
  }
  return earliest?.booking;
}

export function createBooking(store: Store, roomId: string, body: unknown): HandlerResult {
  const valid = validateFields(body);
  if (valid === undefined) {
    return failure("invalid_booking");
  }
  const room = store.rooms.get(roomId);
  if (room === undefined) {
    return failure("room_not_found");
  }
  if (valid.fields.attendees > room.capacity) {
    return failure("over_capacity");
  }
  const conflict = earliestConflict(store.bookings.listByRoom(roomId), valid.startMs, valid.endMs);
  if (conflict !== undefined) {
    return failure("room_busy", conflict.id);
  }
  return success(201, store.bookings.create({ roomId, ...valid.fields }));
}

export function deleteBooking(store: Store, bookingId: string): HandlerResult {
  if (!store.bookings.remove(bookingId)) {
    return failure("booking_not_found");
  }
  return success(204, undefined);
}
