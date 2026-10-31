import { apiError } from "../errors/index.js";
import type { ApiError } from "../errors/index.js";
import { listRooms, overlappingBookings, parseInstant } from "../state/index.js";
import type { Room } from "../state/index.js";

const INTEGER_PATTERN = /^-?\d+$/;

export function findAvailableRooms(query: URLSearchParams): { rooms: Room[] } | ApiError {
  const startText = query.get("start");
  const endText = query.get("end");
  const attendeesText = query.get("attendees");
  if (startText === null || endText === null || attendeesText === null) {
    return apiError("invalid_query");
  }
  const start = parseInstant(startText);
  const end = parseInstant(endText);
  if (start === undefined || end === undefined || end <= start) {
    return apiError("invalid_query");
  }
  if (!INTEGER_PATTERN.test(attendeesText)) {
    return apiError("invalid_query");
  }
  const attendees = Number(attendeesText);
  const rooms = listRooms()
    .filter((room) => room.capacity >= attendees)
    .filter((room) => overlappingBookings(room.id, start, end).length === 0)
    .sort((a, b) => a.capacity - b.capacity || Number(a.id.slice(1)) - Number(b.id.slice(1)));
  return { rooms };
}
