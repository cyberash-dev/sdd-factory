import { apiError, errorResponse, jsonResponse } from "../../errors/index.js";
import type { ApiResponse } from "../../errors/index.js";
import { parseTime } from "../../core/index.js";
import type { ParsedBody, Store } from "../../core/index.js";

const NUMBER_PATTERN = /^(-?[0-9]+)(?:\.([0-9]+))?$/;

export function handleAvailability(
  store: Store,
  query: URLSearchParams,
  body: ParsedBody,
): ApiResponse {
  const invalidQuery = errorResponse(apiError("invalid_query"));
  const start = query.get("start");
  const end = query.get("end");
  const attendeesText = query.get("attendees");
  if (start === null || end === null || attendeesText === null) return invalidQuery;
  const startMs = parseTime(start);
  const endMs = parseTime(end);
  if (startMs === null || endMs === null || endMs <= startMs) return invalidQuery;
  const match = NUMBER_PATTERN.exec(attendeesText);
  if (match === null) return invalidQuery;
  const fraction = match[2];
  if (fraction !== undefined && /[1-9]/.test(fraction)) return invalidQuery;
  const attendees = Number(match[1]);
  if (body.kind === "invalid") return errorResponse(apiError("invalid_json"));
  return jsonResponse(200, { rooms: store.availableRooms({ startMs, endMs }, attendees) });
}
