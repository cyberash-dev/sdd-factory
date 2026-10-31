import { apiError, roomBusyError } from "../../errors/index.js";
import type { ApiError } from "../../errors/index.js";
import {
  addBooking,
  findRoom,
  overlappingBookings,
  parseInstant,
  removeBooking,
} from "../../state/index.js";
import type { Booking } from "../../state/index.js";

const MAX_TITLE_LENGTH = 80;
const MAX_DURATION_MS = 8 * 60 * 60 * 1000;

interface ValidBooking {
  title: string;
  start: string;
  end: string;
  startMs: number;
  endMs: number;
  attendees: number;
}

function validate(body: unknown): ValidBooking | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }
  const title: unknown = Reflect.get(body, "title");
  const start: unknown = Reflect.get(body, "start");
  const end: unknown = Reflect.get(body, "end");
  const attendees: unknown = Reflect.get(body, "attendees");
  if (typeof title !== "string" || title.length === 0 || Array.from(title).length > MAX_TITLE_LENGTH) {
    return undefined;
  }
  if (typeof start !== "string" || typeof end !== "string") {
    return undefined;
  }
  if (typeof attendees !== "number" || !Number.isInteger(attendees) || attendees < 1) {
    return undefined;
  }
  const startMs = parseInstant(start);
  const endMs = parseInstant(end);
  if (startMs === undefined || endMs === undefined) {
    return undefined;
  }
  if (endMs <= startMs || endMs - startMs > MAX_DURATION_MS) {
    return undefined;
  }
  return { title, start, end, startMs, endMs, attendees };
}

export function createBooking(roomId: string, body: unknown): { booking: Booking } | ApiError {
  const room = findRoom(roomId);
  if (room === undefined) {
    return apiError("room_not_found");
  }
  const valid = validate(body);
  if (valid === undefined) {
    return apiError("invalid_booking");
  }
  if (valid.attendees > room.capacity) {
    return apiError("over_capacity");
  }
  const [earliest] = overlappingBookings(roomId, valid.startMs, valid.endMs);
  if (earliest !== undefined) {
    return roomBusyError(earliest.id);
  }
  return { booking: addBooking(roomId, valid.title, valid.start, valid.end, valid.attendees) };
}

export function deleteBooking(bookingId: string): { deleted: true } | ApiError {
  if (!removeBooking(bookingId)) {
    return apiError("booking_not_found");
  }
  return { deleted: true };
}
