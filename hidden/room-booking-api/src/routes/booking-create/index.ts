import { apiError, errorResponse, jsonResponse } from "../../errors/index.js";
import type { ApiResponse } from "../../errors/index.js";
import { parseTime } from "../../core/index.js";
import type { NewBooking, ParsedBody, Store } from "../../core/index.js";

const MAX_DURATION_MS = 28_800_000;
const MAX_TITLE_LENGTH = 80;

type Fields = Pick<NewBooking, "title" | "start" | "end" | "startMs" | "endMs" | "attendees">;

function validateFields(value: unknown): Fields | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  if (!("title" in value) || !("start" in value) || !("end" in value) || !("attendees" in value)) return null;
  const { title, start, end, attendees } = value;
  if (typeof title !== "string" || title.length < 1 || title.length > MAX_TITLE_LENGTH) return null;
  if (typeof start !== "string" || typeof end !== "string") return null;
  const startMs = parseTime(start);
  const endMs = parseTime(end);
  if (startMs === null || endMs === null) return null;
  if (endMs <= startMs || endMs - startMs > MAX_DURATION_MS) return null;
  if (typeof attendees !== "number" || !Number.isInteger(attendees) || attendees < 1) return null;
  return { title, start, end, startMs, endMs, attendees };
}

export function handleCreateBooking(
  store: Store,
  roomId: string,
  body: ParsedBody,
): ApiResponse {
  const room = store.findRoom(roomId);
  if (room === null) return errorResponse(apiError("room_not_found"));
  if (body.kind === "invalid" || body.kind === "empty") return errorResponse(apiError("invalid_json"));
  const fields = validateFields(body.value);
  if (fields === null) return errorResponse(apiError("invalid_booking"));
  if (fields.attendees > room.capacity) return errorResponse(apiError("over_capacity"));
  const conflict = store.earliestConflict(room.id, { startMs: fields.startMs, endMs: fields.endMs });
  if (conflict !== null) return errorResponse(apiError("room_busy", conflict.id));
  return jsonResponse(201, store.addBooking({ roomId: room.id, ...fields }));
}
