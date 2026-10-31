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

export interface BookingFields {
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly attendees: number;
}

export interface Store {
  readonly rooms: Room[];
  readonly bookings: Booking[];
  roomSeq: number;
  bookingSeq: number;
}

export function createStore(): Store {
  return { rooms: [], bookings: [], roomSeq: 0, bookingSeq: 0 };
}

export function addRoom(store: Store, name: string, capacity: number): Room {
  store.roomSeq += 1;
  const room: Room = { id: `r${store.roomSeq}`, name, capacity };
  store.rooms.push(room);
  return room;
}

export function addBooking(store: Store, roomId: string, fields: BookingFields): Booking {
  store.bookingSeq += 1;
  const booking: Booking = {
    id: `b${store.bookingSeq}`,
    roomId,
    title: fields.title,
    start: fields.start,
    end: fields.end,
    attendees: fields.attendees,
  };
  store.bookings.push(booking);
  return booking;
}

export function removeBooking(store: Store, bookingId: string): boolean {
  const index = store.bookings.findIndex((b) => b.id === bookingId);
  if (index < 0) return false;
  store.bookings.splice(index, 1);
  return true;
}

export function findRoom(store: Store, roomId: string): Room | undefined {
  return store.rooms.find((r) => r.id === roomId);
}

const TIME_FORM = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})Z$/;

export function parseTime(value: string): string | undefined {
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

export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function compareIds(a: string, b: string): number {
  return Number(a.slice(1)) - Number(b.slice(1));
}
