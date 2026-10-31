import { fail, ok } from "../errors/index.js";
import type { Result } from "../errors/index.js";
import { compareIds, findRoom, overlaps } from "../domain/index.js";
import type { Booking, Room, Store } from "../domain/index.js";

const POSITIVE_INTEGER = /^\d+$/;
const TIME_FORM = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

function parseTime(value: string): string | undefined {
  if (!TIME_FORM.test(value)) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date.toISOString() !== value.replace("Z", ".000Z")
    ? undefined
    : value;
}

interface Window {
  readonly start: string;
  readonly end: string;
}

function parseWindow(startValue: string | null, endValue: string | null): Window | undefined {
  if (startValue === null || endValue === null) return undefined;
  const start = parseTime(startValue);
  const end = parseTime(endValue);
  if (start === undefined || end === undefined || end <= start) return undefined;
  return { start, end };
}

export function listBookings(
  store: Store,
  roomId: string,
  query: URLSearchParams,
): Result<{ bookings: Booking[] }> {
  if (findRoom(store, roomId) === undefined) return fail({ code: "room_not_found" });
  const from = query.get("from");
  const to = query.get("to");
  let window: Window | undefined;
  if (from !== null || to !== null) {
    window = parseWindow(from, to);
    if (window === undefined) return fail({ code: "invalid_query" });
  }
  const bookings = store.bookings
    .filter((b) => b.roomId === roomId)
    .filter((b) => window === undefined || overlaps(b.start, b.end, window.start, window.end))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : compareIds(a.id, b.id)));
  return ok({ bookings });
}

export function listAvailability(
  store: Store,
  query: URLSearchParams,
): Result<{ rooms: Room[] }> {
  const window = parseWindow(query.get("start"), query.get("end"));
  const attendeesValue = query.get("attendees");
  if (window === undefined || attendeesValue === null || !POSITIVE_INTEGER.test(attendeesValue)) {
    return fail({ code: "invalid_query" });
  }
  const attendees = Number(attendeesValue);
  if (attendees < 1) return fail({ code: "invalid_query" });
  const rooms = store.rooms
    .filter((r) => r.capacity >= attendees)
    .filter(
      (r) =>
        !store.bookings.some(
          (b) => b.roomId === r.id && overlaps(b.start, b.end, window.start, window.end),
        ),
    )
    .sort((a, b) => a.capacity - b.capacity || compareIds(a.id, b.id));
  return ok({ rooms });
}
