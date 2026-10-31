export type ErrorCode =
  | "invalid_json"
  | "invalid_room"
  | "room_name_taken"
  | "invalid_query"
  | "room_not_found"
  | "invalid_booking"
  | "over_capacity"
  | "room_busy"
  | "booking_not_found"
  | "not_found"
  | "method_not_allowed";

export interface ApiError {
  readonly code: ErrorCode;
  readonly status: number;
  readonly conflictingBookingId?: string;
}

export interface ApiResponse {
  readonly status: number;
  readonly body?: unknown;
}

const STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  invalid_json: 400,
  invalid_room: 400,
  room_name_taken: 409,
  invalid_query: 400,
  room_not_found: 404,
  invalid_booking: 400,
  over_capacity: 422,
  room_busy: 409,
  booking_not_found: 404,
  not_found: 404,
  method_not_allowed: 405,
};

export function apiError(code: ErrorCode, conflictingBookingId?: string): ApiError {
  const status = STATUS_BY_CODE[code];
  return conflictingBookingId === undefined
    ? { code, status }
    : { code, status, conflictingBookingId };
}

export function errorBody(error: ApiError): { error: ErrorCode; conflictingBookingId?: string } {
  if (error.code === "room_busy" && error.conflictingBookingId !== undefined) {
    return { error: error.code, conflictingBookingId: error.conflictingBookingId };
  }
  return { error: error.code };
}

export function errorResponse(error: ApiError): ApiResponse {
  return { status: error.status, body: errorBody(error) };
}

export function jsonResponse(status: number, body: unknown): ApiResponse {
  return body === undefined ? { status } : { status, body };
}

export const JSON_CONTENT_TYPE = "application/json";
