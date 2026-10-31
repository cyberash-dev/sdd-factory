export type ErrorCode =
  | "invalid_room"
  | "room_name_taken"
  | "invalid_query"
  | "room_not_found"
  | "invalid_booking"
  | "over_capacity"
  | "room_busy"
  | "booking_not_found"
  | "invalid_json"
  | "not_found"
  | "method_not_allowed";

export interface ApiFailure {
  readonly ok: false;
  readonly code: ErrorCode;
  readonly conflictingBookingId?: string;
}

export interface ApiSuccess {
  readonly ok: true;
  readonly status: number;
  readonly body: unknown;
}

export type HandlerResult = ApiSuccess | ApiFailure;

const STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  invalid_room: 400,
  room_name_taken: 409,
  invalid_query: 400,
  room_not_found: 404,
  invalid_booking: 400,
  over_capacity: 422,
  room_busy: 409,
  booking_not_found: 404,
  invalid_json: 400,
  not_found: 404,
  method_not_allowed: 405,
};

export function failure(code: ErrorCode, conflictingBookingId?: string): ApiFailure {
  if (conflictingBookingId === undefined) {
    return { ok: false, code };
  }
  return { ok: false, code, conflictingBookingId };
}

export function success(status: number, body: unknown): ApiSuccess {
  return { ok: true, status, body };
}

export function isSuccess(result: HandlerResult): result is ApiSuccess {
  return result.ok;
}

export function statusForCode(code: ErrorCode): number {
  return STATUS_BY_CODE[code];
}

export function errorBody(result: ApiFailure): Record<string, unknown> {
  if (result.conflictingBookingId === undefined) {
    return { error: result.code };
  }
  return { error: result.code, conflictingBookingId: result.conflictingBookingId };
}
