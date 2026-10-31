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

export interface ApiError {
  readonly code: ErrorCode;
  readonly conflictingBookingId?: string;
}

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ApiError };

const STATUS: Record<ErrorCode, number> = {
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

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail(error: ApiError): Result<never> {
  return { ok: false, error };
}

export function statusFor(code: ErrorCode): number {
  return STATUS[code];
}

export function errorBody(error: ApiError): Record<string, string> {
  if (error.conflictingBookingId === undefined) {
    return { error: error.code };
  }
  return { error: error.code, conflictingBookingId: error.conflictingBookingId };
}
