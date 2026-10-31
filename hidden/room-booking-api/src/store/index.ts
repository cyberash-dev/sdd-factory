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

export type NewBooking = Omit<Booking, "id">;

export interface RoomStore {
  create(name: string, capacity: number): Room;
  get(roomId: string): Room | undefined;
  list(): readonly Room[];
  findByNameIgnoringCase(name: string): Room | undefined;
}

export interface BookingStore {
  create(input: NewBooking): Booking;
  get(bookingId: string): Booking | undefined;
  listByRoom(roomId: string): readonly Booking[];
  remove(bookingId: string): boolean;
}

export interface Store {
  readonly rooms: RoomStore;
  readonly bookings: BookingStore;
}

export function createStore(): Store {
  const rooms: Room[] = [];
  const bookings: Booking[] = [];
  let roomCounter = 0;
  let bookingCounter = 0;

  const roomStore: RoomStore = {
    create(name, capacity) {
      roomCounter += 1;
      const room: Room = { id: `r${roomCounter}`, name, capacity };
      rooms.push(room);
      return room;
    },
    get(roomId) {
      return rooms.find((room) => room.id === roomId);
    },
    list() {
      return [...rooms];
    },
    findByNameIgnoringCase(name) {
      const wanted = name.toLowerCase();
      return rooms.find((room) => room.name.toLowerCase() === wanted);
    },
  };

  const bookingStore: BookingStore = {
    create(input) {
      bookingCounter += 1;
      const booking: Booking = { id: `b${bookingCounter}`, ...input };
      bookings.push(booking);
      return booking;
    },
    get(bookingId) {
      return bookings.find((booking) => booking.id === bookingId);
    },
    listByRoom(roomId) {
      return bookings.filter((booking) => booking.roomId === roomId);
    },
    remove(bookingId) {
      const index = bookings.findIndex((booking) => booking.id === bookingId);
      if (index < 0) {
        return false;
      }
      bookings.splice(index, 1);
      return true;
    },
  };

  return { rooms: roomStore, bookings: bookingStore };
}

export function idNumber(id: string): number {
  return Number.parseInt(id.slice(1), 10);
}
