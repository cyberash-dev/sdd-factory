import { formatError, parseTime } from "../core/index.js";
import type {
  Booking,
  ErrorCode,
  HandlerRequest,
  HandlerResponse,
  Route,
  Store,
} from "../core/index.js";

const INTEGER_PATTERN = /^-?\d+$/;

function fail(code: ErrorCode): HandlerResponse {
  return formatError(code);
}

function idNumber(booking: Booking): number {
  return Number(booking.id.slice(1));
}

export function createBookingReadRoutes(store: Store): readonly Route[] {
  const listBookings = (request: HandlerRequest): HandlerResponse => {
    const from = request.query.get("from");
    const to = request.query.get("to");
    if ((from === null) !== (to === null)) return fail("invalid_query");
    let window: { fromMs: number; toMs: number } | undefined;
    if (from !== null && to !== null) {
      const fromMs = parseTime(from);
      const toMs = parseTime(to);
      if (fromMs === undefined || toMs === undefined || toMs <= fromMs) {
        return fail("invalid_query");
      }
      window = { fromMs, toMs };
    }
    const roomId = request.params["roomId"] ?? "";
    if (store.findRoom(roomId) === undefined) return fail("room_not_found");
    const found =
      window === undefined
        ? store.bookingsOf(roomId)
        : store.bookingsOverlapping(roomId, window.fromMs, window.toMs);
    const bookings = [...found].sort(
      (a, b) =>
        store.instantOf(a).startMs - store.instantOf(b).startMs || idNumber(a) - idNumber(b),
    );
    return {
      status: 200,
      body: {
        bookings: bookings.map((booking) => ({
          id: booking.id,
          roomId: booking.roomId,
          title: booking.title,
          start: booking.start,
          end: booking.end,
          attendees: booking.attendees,
        })),
      },
    };
  };

  const deleteBooking = (request: HandlerRequest): HandlerResponse => {
    const bookingId = request.params["bookingId"] ?? "";
    if (!store.removeBooking(bookingId)) return fail("booking_not_found");
    return { status: 204 };
  };

  const availability = (request: HandlerRequest): HandlerResponse => {
    const start = request.query.get("start");
    const end = request.query.get("end");
    const attendees = request.query.get("attendees");
    if (start === null || end === null || attendees === null) return fail("invalid_query");
    const startMs = parseTime(start);
    const endMs = parseTime(end);
    if (startMs === undefined || endMs === undefined || endMs <= startMs) {
      return fail("invalid_query");
    }
    if (!INTEGER_PATTERN.test(attendees)) return fail("invalid_query");
    const rooms = [...store.availableRooms(startMs, endMs, Number(attendees))].sort(
      (a, b) => a.capacity - b.capacity || Number(a.id.slice(1)) - Number(b.id.slice(1)),
    );
    return {
      status: 200,
      body: {
        rooms: rooms.map((room) => ({ id: room.id, name: room.name, capacity: room.capacity })),
      },
    };
  };

  return [
    { method: "GET", path: "/rooms/:roomId/bookings", expectsJsonBody: false, handle: listBookings },
    { method: "DELETE", path: "/bookings/:bookingId", expectsJsonBody: false, handle: deleteBooking },
    { method: "GET", path: "/availability", expectsJsonBody: false, handle: availability },
  ];
}
