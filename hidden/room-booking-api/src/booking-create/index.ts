import { formatError, parseTime } from "../core/index.js";
import type {
  HandlerRequest,
  HandlerResponse,
  Route,
  Store,
} from "../core/index.js";

const MAX_TITLE_LENGTH = 80;
const MAX_DURATION_MS = 8 * 60 * 60 * 1000;

function countCodePoints(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

function fail(code: "room_not_found" | "invalid_booking" | "over_capacity"): HandlerResponse {
  return formatError(code);
}

function createBooking(store: Store, request: HandlerRequest): HandlerResponse {
  const room = store.findRoom(request.params["roomId"] ?? "");
  if (room === undefined) return fail("room_not_found");

  const body = request.body;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail("invalid_booking");
  }
  const title: unknown = Reflect.get(body, "title");
  const start: unknown = Reflect.get(body, "start");
  const end: unknown = Reflect.get(body, "end");
  const attendees: unknown = Reflect.get(body, "attendees");

  if (typeof title !== "string" || title.length === 0 || countCodePoints(title) > MAX_TITLE_LENGTH) {
    return fail("invalid_booking");
  }
  if (typeof start !== "string" || typeof end !== "string") return fail("invalid_booking");
  const startMs = parseTime(start);
  const endMs = parseTime(end);
  if (startMs === undefined || endMs === undefined) return fail("invalid_booking");
  if (endMs <= startMs || endMs - startMs > MAX_DURATION_MS) return fail("invalid_booking");
  if (typeof attendees !== "number" || !Number.isInteger(attendees) || attendees < 1) {
    return fail("invalid_booking");
  }

  if (attendees > room.capacity) return fail("over_capacity");

  const conflict = store.earliestConflict(room.id, startMs, endMs);
  if (conflict !== undefined) return formatError("room_busy", conflict);

  const booking = store.addBooking({
    roomId: room.id,
    title,
    start,
    end,
    startMs,
    endMs,
    attendees,
  });
  return { status: 201, body: booking };
}

export function createBookingCreateRoutes(store: Store): readonly Route[] {
  return [
    {
      method: "POST",
      path: "/rooms/:roomId/bookings",
      expectsJsonBody: true,
      handle: (request) => createBooking(store, request),
    },
  ];
}
