import { apiError } from "../errors/index.js";
import type { ApiError } from "../errors/index.js";
import { addRoom, listRooms as listStoredRooms } from "../state/index.js";
import type { Room } from "../state/index.js";

const NAME_MAX_CODE_POINTS = 40;
const CAPACITY_MIN = 1;
const CAPACITY_MAX = 100;
const POSITIVE_INTEGER_PATTERN = /^\d+$/;

function isRoomName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && [...value].length <= NAME_MAX_CODE_POINTS;
}

function isCapacity(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= CAPACITY_MIN &&
    value <= CAPACITY_MAX
  );
}

export function createRoom(body: unknown): { room: Room } | ApiError {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return apiError("invalid_room");
  }
  const name: unknown = Reflect.get(body, "name");
  const capacity: unknown = Reflect.get(body, "capacity");
  if (!isRoomName(name) || !isCapacity(capacity)) {
    return apiError("invalid_room");
  }
  const lowered = name.toLowerCase();
  if (listStoredRooms().some((room) => room.name.toLowerCase() === lowered)) {
    return apiError("room_name_taken");
  }
  return { room: addRoom(name, capacity) };
}

export function listRooms(query: URLSearchParams): { rooms: Room[] } | ApiError {
  const raw = query.get("minCapacity");
  if (raw === null) {
    return { rooms: listStoredRooms() };
  }
  if (!POSITIVE_INTEGER_PATTERN.test(raw) || Number(raw) < 1) {
    return apiError("invalid_query");
  }
  const minimum = Number(raw);
  return { rooms: listStoredRooms().filter((room) => room.capacity >= minimum) };
}
