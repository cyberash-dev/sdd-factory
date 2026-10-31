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

export interface Interval {
  readonly startMs: number;
  readonly endMs: number;
}

export interface NewBooking {
  readonly roomId: string;
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly attendees: number;
}

export interface Store {
  listRooms(minCapacity: number | null): Room[];
  findRoom(roomId: string): Room | null;
  roomNameTaken(name: string): boolean;
  addRoom(name: string, capacity: number): Room;
  listBookings(roomId: string, window: Interval | null): Booking[];
  addBooking(input: NewBooking): Booking;
  findBooking(bookingId: string): Booking | null;
  deleteBooking(bookingId: string): Booking | null;
  earliestConflict(roomId: string, interval: Interval): Booking | null;
  availableRooms(window: Interval, attendees: number): Room[];
}

interface StoredBooking {
  readonly booking: Booking;
  readonly interval: Interval;
}

function idSuffix(id: string): number {
  return Number(id.slice(1));
}

export function createStore(): Store {
  const rooms: Room[] = [];
  const bookings: StoredBooking[] = [];
  let roomCount = 0;
  let lastBookingNumber = 0;

  const byStartThenId = (a: StoredBooking, b: StoredBooking): number =>
    a.interval.startMs - b.interval.startMs || idSuffix(a.booking.id) - idSuffix(b.booking.id);

  const overlapping = (roomId: string, window: Interval | null): StoredBooking[] =>
    bookings
      .filter((s) => s.booking.roomId === roomId && (window === null || intervalsOverlap(s.interval, window)))
      .sort(byStartThenId);

  return {
    listRooms(minCapacity) {
      return rooms
        .filter((r) => minCapacity === null || r.capacity >= minCapacity)
        .sort((a, b) => idSuffix(a.id) - idSuffix(b.id));
    },
    findRoom(roomId) {
      return rooms.find((r) => r.id === roomId) ?? null;
    },
    roomNameTaken(name) {
      return rooms.some((r) => r.name === name);
    },
    addRoom(name, capacity) {
      roomCount += 1;
      const room: Room = { id: `r${roomCount}`, name, capacity };
      rooms.push(room);
      return room;
    },
    listBookings(roomId, window) {
      return overlapping(roomId, window).map((s) => s.booking);
    },
    addBooking(input) {
      lastBookingNumber += 1;
      const booking: Booking = {
        id: `b${lastBookingNumber}`,
        roomId: input.roomId,
        title: input.title,
        start: input.start,
        end: input.end,
        attendees: input.attendees,
      };
      bookings.push({ booking, interval: { startMs: input.startMs, endMs: input.endMs } });
      return booking;
    },
    findBooking(bookingId) {
      return bookings.find((s) => s.booking.id === bookingId)?.booking ?? null;
    },
    deleteBooking(bookingId) {
      const index = bookings.findIndex((s) => s.booking.id === bookingId);
      if (index < 0) return null;
      const removed = bookings.splice(index, 1)[0];
      return removed === undefined ? null : removed.booking;
    },
    earliestConflict(roomId, interval) {
      return overlapping(roomId, interval)[0]?.booking ?? null;
    },
    availableRooms(window, attendees) {
      return rooms
        .filter((r) => r.capacity >= attendees && overlapping(r.id, window).length === 0)
        .sort((a, b) => a.capacity - b.capacity || idSuffix(a.id) - idSuffix(b.id));
    },
  };
}

const TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::00(?:\.000)?)?Z$/;

export function parseTime(value: string): number | null {
  const match = TIME_PATTERN.exec(value);
  if (match === null) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  if (year === undefined || month === undefined || day === undefined || hour === undefined || minute === undefined) {
    return null;
  }
  if (month < 1 || month > 12 || hour > 23 || minute > 59) return null;
  const ms = Date.UTC(year, month - 1, day, hour, minute);
  const date = new Date(ms);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return ms;
}

export function intervalsOverlap(a: Interval, b: Interval): boolean {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

export type ParsedBody =
  | { readonly kind: "empty" }
  | { readonly kind: "invalid" }
  | { readonly kind: "value"; readonly value: unknown };

export function parseJsonBody(raw: string): ParsedBody {
  if (raw.length === 0) return { kind: "empty" };
  try {
    return { kind: "value", value: JSON.parse(raw) };
  } catch {
    return { kind: "invalid" };
  }
}
