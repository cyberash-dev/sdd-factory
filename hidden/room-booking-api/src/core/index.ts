export type ErrorCode =
  | "invalid_json"
  | "invalid_room"
  | "room_name_taken"
  | "invalid_query"
  | "room_not_found"
  | "invalid_booking"
  | "over_capacity"
  | "room_busy"
  | "booking_not_found"
  | "not_found"
  | "method_not_allowed";

export interface Room {
  readonly id: string;
  readonly name: string;
  readonly capacity: number;
}

export interface Booking {
  readonly id: string;
  readonly roomId: string;
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly attendees: number;
}

export interface ErrorBody {
  readonly error: ErrorCode;
  readonly conflictingBookingId?: string;
}

export interface Store {
  addRoom(input: { name: string; capacity: number }): Room;
  rooms(): readonly Room[];
  findRoom(roomId: string): Room | undefined;
  roomNameTaken(name: string): boolean;
  addBooking(input: {
    roomId: string;
    title: string;
    start: string;
    end: string;
    startMs: number;
    endMs: number;
    attendees: number;
  }): Booking;
  findBooking(bookingId: string): Booking | undefined;
  removeBooking(bookingId: string): boolean;
  bookingsOf(roomId: string): readonly Booking[];
  bookingsOverlapping(roomId: string, fromMs: number, toMs: number): readonly Booking[];
  earliestConflict(roomId: string, startMs: number, endMs: number): Booking | undefined;
  availableRooms(startMs: number, endMs: number, attendees: number): readonly Room[];
  instantOf(booking: Booking): { startMs: number; endMs: number };
}

export function createStore(): Store {
  const roomList: Room[] = [];
  const bookingList: Booking[] = [];
  const instants = new Map<string, { startMs: number; endMs: number }>();
  let roomCounter = 0;
  let bookingCounter = 0;

  const instantOf = (booking: Booking): { startMs: number; endMs: number } => {
    const found = instants.get(booking.id);
    return found === undefined
      ? { startMs: Date.parse(booking.start), endMs: Date.parse(booking.end) }
      : { ...found };
  };

  const bookingsOf = (roomId: string): readonly Booking[] =>
    bookingList
      .filter((booking) => booking.roomId === roomId)
      .sort((a, b) => instantOf(a).startMs - instantOf(b).startMs);

  const bookingsOverlapping = (roomId: string, fromMs: number, toMs: number): readonly Booking[] =>
    bookingsOf(roomId).filter((booking) => {
      const { startMs, endMs } = instantOf(booking);
      return startMs < toMs && fromMs < endMs;
    });

  return {
    addRoom(input) {
      roomCounter += 1;
      const room: Room = { id: `r${roomCounter}`, name: input.name, capacity: input.capacity };
      roomList.push(room);
      return room;
    },
    rooms: () => [...roomList],
    findRoom: (roomId) => roomList.find((room) => room.id === roomId),
    roomNameTaken: (name) => roomList.some((room) => room.name === name),
    addBooking(input) {
      bookingCounter += 1;
      const booking: Booking = {
        id: `b${bookingCounter}`,
        roomId: input.roomId,
        title: input.title,
        start: input.start,
        end: input.end,
        attendees: input.attendees,
      };
      bookingList.push(booking);
      instants.set(booking.id, { startMs: input.startMs, endMs: input.endMs });
      return booking;
    },
    findBooking: (bookingId) => bookingList.find((booking) => booking.id === bookingId),
    removeBooking(bookingId) {
      const index = bookingList.findIndex((booking) => booking.id === bookingId);
      if (index < 0) return false;
      bookingList.splice(index, 1);
      instants.delete(bookingId);
      return true;
    },
    bookingsOf,
    bookingsOverlapping,
    earliestConflict: (roomId, startMs, endMs) => bookingsOverlapping(roomId, startMs, endMs)[0],
    availableRooms: (startMs, endMs, attendees) =>
      roomList
        .filter(
          (room) =>
            room.capacity >= attendees && bookingsOverlapping(room.id, startMs, endMs).length === 0,
        )
        .sort((a, b) => a.capacity - b.capacity),
    instantOf,
  };
}

const TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?Z$/;

export function parseTime(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = TIME_PATTERN.exec(value);
  if (match === null) return undefined;
  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number);
  if (year === undefined || month === undefined || day === undefined) return undefined;
  if (hour === undefined || minute === undefined) return undefined;
  if (Number(match[6] ?? "0") !== 0 || Number(match[7] ?? "0") !== 0) return undefined;
  const ms = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(ms);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute
  ) {
    return undefined;
  }
  return ms;
}

const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = {
  invalid_json: 400,
  invalid_room: 400,
  room_name_taken: 409,
  invalid_query: 400,
  room_not_found: 404,
  invalid_booking: 400,
  over_capacity: 422,
  room_busy: 409,
  booking_not_found: 404,
  not_found: 404,
  method_not_allowed: 405,
};

export function formatError(
  code: ErrorCode,
  conflict?: Booking,
): { status: number; body: ErrorBody } {
  const status = ERROR_STATUS[code];
  if (code === "room_busy" && conflict !== undefined) {
    return { status, body: { error: code, conflictingBookingId: conflict.id } };
  }
  return { status, body: { error: code } };
}

export interface HandlerRequest {
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly body: unknown;
}

export interface HandlerResponse {
  readonly status: number;
  readonly body?: unknown;
}

export interface Route {
  readonly method: "GET" | "POST" | "DELETE";
  readonly path: string;
  readonly expectsJsonBody: boolean;
  readonly handle: (request: HandlerRequest) => HandlerResponse;
}
