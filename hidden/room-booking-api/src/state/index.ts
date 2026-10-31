export interface Room {
  id: string;
  name: string;
  capacity: number;
}

export interface Booking {
  id: string;
  roomId: string;
  title: string;
  start: string;
  end: string;
  attendees: number;
}

const INSTANT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::00(?:\.000)?)?Z$/;

const rooms: Room[] = [];
const bookings: Booking[] = [];
let roomCounter = 0;
let bookingCounter = 0;

export function parseInstant(text: string): number | undefined {
  const match = INSTANT_PATTERN.exec(text);
  if (match === null) {
    return undefined;
  }
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59) {
    return undefined;
  }
  const value = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  if (new Date(value).getUTCDate() !== day) {
    return undefined;
  }
  return value;
}

function idNumber(id: string): number {
  return Number(id.slice(1));
}

function instantOf(text: string): number {
  return parseInstant(text) ?? Number.NaN;
}

function byStartThenId(a: Booking, b: Booking): number {
  return instantOf(a.start) - instantOf(b.start) || idNumber(a.id) - idNumber(b.id);
}

function copyRoom(room: Room): Room {
  return { id: room.id, name: room.name, capacity: room.capacity };
}

function copyBooking(booking: Booking): Booking {
  return {
    id: booking.id,
    roomId: booking.roomId,
    title: booking.title,
    start: booking.start,
    end: booking.end,
    attendees: booking.attendees,
  };
}

export function listRooms(): Room[] {
  return rooms.map(copyRoom);
}

export function findRoom(roomId: string): Room | undefined {
  const room = rooms.find((candidate) => candidate.id === roomId);
  return room === undefined ? undefined : copyRoom(room);
}

export function addRoom(name: string, capacity: number): Room {
  roomCounter += 1;
  const room: Room = { id: `r${roomCounter}`, name, capacity };
  rooms.push(room);
  return copyRoom(room);
}

export function addBooking(
  roomId: string,
  title: string,
  start: string,
  end: string,
  attendees: number,
): Booking {
  bookingCounter += 1;
  const booking: Booking = { id: `b${bookingCounter}`, roomId, title, start, end, attendees };
  bookings.push(booking);
  return copyBooking(booking);
}

export function findBooking(bookingId: string): Booking | undefined {
  const booking = bookings.find((candidate) => candidate.id === bookingId);
  return booking === undefined ? undefined : copyBooking(booking);
}

export function listBookingsOfRoom(roomId: string): Booking[] {
  return bookings
    .filter((booking) => booking.roomId === roomId)
    .sort(byStartThenId)
    .map(copyBooking);
}

export function removeBooking(bookingId: string): boolean {
  const index = bookings.findIndex((candidate) => candidate.id === bookingId);
  if (index === -1) {
    return false;
  }
  bookings.splice(index, 1);
  return true;
}

export function overlappingBookings(roomId: string, from: number, to: number): Booking[] {
  return bookings
    .filter(
      (booking) =>
        booking.roomId === roomId && instantOf(booking.start) < to && from < instantOf(booking.end),
    )
    .sort(byStartThenId)
    .map(copyBooking);
}
