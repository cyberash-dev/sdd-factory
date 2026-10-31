import type { URLSearchParams } from "node:url";
import { LIMITS, formatId, idNumber, isValidText } from "../core/index.js";
import type { ApiError, Room } from "../core/index.js";

export interface RoomStore {
  readonly rooms: Room[];
  nextSequence: number;
}

export function createRoomStore(): RoomStore {
  return { rooms: [], nextSequence: 0 };
}

function isValidCapacity(capacity: unknown): capacity is number {
  return (
    typeof capacity === "number" &&
    Number.isInteger(capacity) &&
    capacity >= LIMITS.capacityMin &&
    capacity <= LIMITS.capacityMax
  );
}

export function createRoom(store: RoomStore, body: unknown): Room | ApiError {
  if (typeof body !== "object" || body === null) return { error: "invalid_room" };
  const name: unknown = Reflect.get(body, "name");
  const capacity: unknown = Reflect.get(body, "capacity");
  if (typeof name !== "string" || !isValidText(name, LIMITS.roomNameMax) || !isValidCapacity(capacity)) {
    return { error: "invalid_room" };
  }
  const folded = name.toLowerCase();
  if (store.rooms.some((room) => room.name.toLowerCase() === folded)) {
    return { error: "room_name_taken" };
  }
  const room: Room = { id: formatId("room", ++store.nextSequence), name, capacity };
  store.rooms.push(room);
  return room;
}

export function listRooms(store: RoomStore, query: URLSearchParams): Room[] | ApiError {
  const raw = query.get("minCapacity");
  let minCapacity = 0;
  if (raw !== null) {
    if (!/^[0-9]+$/.test(raw) || Number(raw) < 1) return { error: "invalid_query" };
    minCapacity = Number(raw);
  }
  return store.rooms
    .filter((room) => room.capacity >= minCapacity)
    .sort((a, b) => idNumber(a.id) - idNumber(b.id));
}
