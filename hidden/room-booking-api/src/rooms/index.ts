import { failure, success } from "../errors/index.js";
import type { HandlerResult } from "../errors/index.js";
import type { RoomStore } from "../store/index.js";

const MAX_NAME_LENGTH = 40;
const MIN_CAPACITY = 1;
const MAX_CAPACITY = 100;
const DECIMAL_INTEGER = /^\d+$/;

function isValidName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.trim() !== "" &&
    [...name].length <= MAX_NAME_LENGTH
  );
}

function isValidCapacity(capacity: unknown): capacity is number {
  return (
    typeof capacity === "number" &&
    Number.isInteger(capacity) &&
    capacity >= MIN_CAPACITY &&
    capacity <= MAX_CAPACITY
  );
}

export function createRoom(rooms: RoomStore, body: unknown): HandlerResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return failure("invalid_room");
  }
  const name: unknown = Reflect.get(body, "name");
  const capacity: unknown = Reflect.get(body, "capacity");
  if (!isValidName(name) || !isValidCapacity(capacity)) {
    return failure("invalid_room");
  }
  if (rooms.findByNameIgnoringCase(name) !== undefined) {
    return failure("room_name_taken");
  }
  return success(201, rooms.create(name, capacity));
}

export function listRooms(rooms: RoomStore, query: URLSearchParams): HandlerResult {
  const raw = query.get("minCapacity");
  if (raw === null) {
    return success(200, { rooms: rooms.list() });
  }
  if (!DECIMAL_INTEGER.test(raw)) {
    return failure("invalid_query");
  }
  const minCapacity = Number.parseInt(raw, 10);
  if (minCapacity < 1) {
    return failure("invalid_query");
  }
  return success(200, { rooms: rooms.list().filter((room) => room.capacity >= minCapacity) });
}
