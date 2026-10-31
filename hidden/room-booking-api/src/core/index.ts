export type ErrorCode =
  | "invalid_json"
  | "invalid_query"
  | "invalid_room"
  | "invalid_booking"
  | "not_found"
  | "method_not_allowed"
  | "room_not_found"
  | "booking_not_found"
  | "room_name_taken"
  | "room_busy"
  | "over_capacity";

export interface ApiError {
  readonly error: ErrorCode;
  readonly conflictingBookingId?: string;
}

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

export const LIMITS: {
  readonly roomNameMax: number;
  readonly bookingTitleMax: number;
  readonly capacityMin: number;
  readonly capacityMax: number;
  readonly bookingMaxMinutes: number;
} = {
  roomNameMax: 40,
  bookingTitleMax: 80,
  capacityMin: 1,
  capacityMax: 100,
  bookingMaxMinutes: 480,
};

const STATUS: Readonly<Record<ErrorCode, number>> = {
  invalid_json: 400,
  invalid_query: 400,
  invalid_room: 400,
  invalid_booking: 400,
  not_found: 404,
  room_not_found: 404,
  booking_not_found: 404,
  method_not_allowed: 405,
  room_name_taken: 409,
  room_busy: 409,
  over_capacity: 422,
};

export function statusOf(code: ErrorCode): number {
  return STATUS[code];
}

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(STATUS, value);
}

export function isApiError(value: unknown): value is ApiError {
  if (typeof value !== "object" || value === null) return false;
  const error: unknown = Reflect.get(value, "error");
  if (!isErrorCode(error)) return false;
  const conflicting: unknown = Reflect.get(value, "conflictingBookingId");
  if (error === "room_busy") return typeof conflicting === "string";
  return conflicting === undefined;
}

const TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):00Z$/;

export function parseTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = TIME_PATTERN.exec(value);
  if (match === null) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  if (hour > 23 || minute > 59) return null;
  const epoch = Date.UTC(year, month - 1, day, hour, minute);
  const date = new Date(epoch);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return epoch;
}

export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function formatId(kind: "room" | "booking", sequence: number): string {
  return (kind === "room" ? "r" : "b") + String(sequence);
}

export function idNumber(id: string): number {
  return Number(id.slice(1));
}

export function isValidText(value: unknown, maxLength: number): boolean {
  return typeof value === "string" && value.trim() !== "" && [...value].length <= maxLength;
}
