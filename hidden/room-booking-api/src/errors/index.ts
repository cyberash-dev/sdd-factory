export type ErrorCode =
  | "invalid_json"
  | "not_found"
  | "method_not_allowed"
  | "invalid_room"
  | "room_name_taken"
  | "invalid_query"
  | "room_not_found"
  | "invalid_booking"
  | "over_capacity"
  | "room_busy"
  | "booking_not_found";

export interface ErrorBody {
  error: ErrorCode;
  conflictingBookingId?: string;
}

export interface ApiError {
  status: number;
  body: ErrorBody;
}

const STATUS: Readonly<Record<ErrorCode, number>> = {
  invalid_json: 400,
  invalid_room: 400,
  invalid_query: 400,
  invalid_booking: 400,
  not_found: 404,
  room_not_found: 404,
  booking_not_found: 404,
  method_not_allowed: 405,
  room_name_taken: 409,
  room_busy: 409,
  over_capacity: 422,
};

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(STATUS, value);
}

export function statusFor(code: ErrorCode): number {
  return STATUS[code];
}

export function apiError(code: ErrorCode): ApiError {
  return { status: statusFor(code), body: { error: code } };
}

export function roomBusyError(conflictingBookingId: string): ApiError {
  return {
    status: statusFor("room_busy"),
    body: { error: "room_busy", conflictingBookingId },
  };
}

export function isApiError(value: unknown): value is ApiError {
  if (typeof value !== "object" || value === null) return false;
  const status: unknown = Reflect.get(value, "status");
  const body: unknown = Reflect.get(value, "body");
  if (typeof body !== "object" || body === null) return false;
  const code: unknown = Reflect.get(body, "error");
  if (!isErrorCode(code) || status !== statusFor(code)) return false;
  const id: unknown = Reflect.get(body, "conflictingBookingId");
  return code === "room_busy" ? typeof id === "string" : id === undefined;
}
