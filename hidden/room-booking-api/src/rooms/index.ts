import { fail, ok } from "../errors/index.js";
import type { Result } from "../errors/index.js";
import { addRoom, compareIds } from "../domain/index.js";
import type { Room, Store } from "../domain/index.js";

export function createRoom(store: Store, body: Record<string, unknown>): Result<Room> {
  const { name, capacity } = body;
  if (typeof name !== "string") return fail({ code: "invalid_room" });
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 40) return fail({ code: "invalid_room" });
  if (typeof capacity !== "number" || !Number.isInteger(capacity) || capacity < 1 || capacity > 100) {
    return fail({ code: "invalid_room" });
  }
  const lowered = trimmed.toLowerCase();
  if (store.rooms.some((r) => r.name.toLowerCase() === lowered)) {
    return fail({ code: "room_name_taken" });
  }
  return ok(addRoom(store, trimmed, capacity));
}

export function listRooms(store: Store, query: URLSearchParams): Result<{ rooms: Room[] }> {
  const raw = query.get("minCapacity");
  let min = 0;
  if (raw !== null) {
    if (!/^[1-9][0-9]*$/.test(raw)) return fail({ code: "invalid_query" });
    min = Number(raw);
  }
  const rooms = store.rooms.filter((r) => r.capacity >= min).sort((a, b) => compareIds(a.id, b.id));
  return ok({ rooms });
}
