import { formatError } from "../core/index.js";
import type {
  ErrorCode,
  HandlerRequest,
  HandlerResponse,
  Route,
  Store,
} from "../core/index.js";

const MAX_NAME_LENGTH = 40;
const MIN_CAPACITY = 1;
const MAX_CAPACITY = 100;
const POSITIVE_INTEGER = /^\d+$/;

function failure(code: ErrorCode): HandlerResponse {
  const { status, body } = formatError(code);
  return { status, body };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createRoomRoutes(store: Store): readonly Route[] {
  const create = (request: HandlerRequest): HandlerResponse => {
    const body = request.body;
    if (!isRecord(body)) return failure("invalid_room");
    const name = body["name"];
    if (typeof name !== "string" || name.length === 0 || Array.from(name).length > MAX_NAME_LENGTH) {
      return failure("invalid_room");
    }
    const capacity = body["capacity"];
    if (
      typeof capacity !== "number" ||
      !Number.isInteger(capacity) ||
      capacity < MIN_CAPACITY ||
      capacity > MAX_CAPACITY
    ) {
      return failure("invalid_room");
    }
    const lowered = name.toLowerCase();
    if (store.rooms().some((room) => room.name.toLowerCase() === lowered)) {
      return failure("room_name_taken");
    }
    const room = store.addRoom({ name, capacity });
    return { status: 201, body: { id: room.id, name: room.name, capacity: room.capacity } };
  };

  const list = (request: HandlerRequest): HandlerResponse => {
    const raw = request.query.get("minCapacity");
    let minCapacity = 0;
    if (raw !== null) {
      if (!POSITIVE_INTEGER.test(raw)) return failure("invalid_query");
      minCapacity = Number(raw);
      if (minCapacity < 1) return failure("invalid_query");
    }
    const rooms = store
      .rooms()
      .filter((room) => room.capacity >= minCapacity)
      .map((room) => ({ id: room.id, name: room.name, capacity: room.capacity }));
    return { status: 200, body: { rooms } };
  };

  return [
    { method: "POST", path: "/rooms", expectsJsonBody: true, handle: create },
    { method: "GET", path: "/rooms", expectsJsonBody: false, handle: list },
  ];
}
