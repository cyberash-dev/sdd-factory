import { apiError, errorResponse, jsonResponse } from "../../errors/index.js";
import type { ApiResponse } from "../../errors/index.js";
import type { ParsedBody, Store } from "../../core/index.js";

const MAX_NAME_LENGTH = 40;
const MIN_CAPACITY = 1;
const MAX_CAPACITY = 100;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/;

export function handleCreateRoom(store: Store, body: ParsedBody): ApiResponse {
  if (body.kind === "invalid") return errorResponse(apiError("invalid_json"));
  if (body.kind === "empty") return errorResponse(apiError("invalid_room"));
  const value = body.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return errorResponse(apiError("invalid_room"));
  }
  const name: unknown = Reflect.get(value, "name");
  const capacity: unknown = Reflect.get(value, "capacity");
  if (typeof name !== "string") {
    return errorResponse(apiError("invalid_room"));
  }
  const nameLength = Array.from(name).length;
  if (nameLength < 1 || nameLength > MAX_NAME_LENGTH) {
    return errorResponse(apiError("invalid_room"));
  }
  if (
    typeof capacity !== "number" ||
    !Number.isInteger(capacity) ||
    capacity < MIN_CAPACITY ||
    capacity > MAX_CAPACITY
  ) {
    return errorResponse(apiError("invalid_room"));
  }
  const lowered = name.toLowerCase();
  const taken =
    store.roomNameTaken(name) || store.listRooms(null).some((room) => room.name.toLowerCase() === lowered);
  if (taken) return errorResponse(apiError("room_name_taken"));
  return jsonResponse(201, store.addRoom(name, capacity));
}

export function handleListRooms(
  store: Store,
  query: URLSearchParams,
  body: ParsedBody,
): ApiResponse {
  const raw = query.get("minCapacity");
  if (raw !== null && !POSITIVE_INTEGER.test(raw)) {
    return errorResponse(apiError("invalid_query"));
  }
  if (body.kind === "invalid") return errorResponse(apiError("invalid_json"));
  const minCapacity = raw === null ? null : Number(raw);
  return jsonResponse(200, { rooms: store.listRooms(minCapacity) });
}
