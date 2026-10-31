export type ErrorCode =
  | "E_MALFORMED_JSON"
  | "E_INVALID_INPUT"
  | "E_INVALID_QUERY"
  | "E_INVALID_TIER"
  | "E_UNAUTHENTICATED"
  | "E_FORBIDDEN"
  | "E_NOT_FOUND"
  | "E_EMAIL_TAKEN"
  | "E_EVENT_CANCELLED"
  | "E_EVENT_NOT_ON_SALE"
  | "E_TICKETS_UNAVAILABLE"
  | "E_TICKETS_AVAILABLE"
  | "E_ALREADY_WAITING"
  | "E_CODE_TAKEN"
  | "E_ORDER_STATE"
  | "E_TICKET_LIMIT"
  | "E_DISCOUNT_UNUSABLE";

const STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  E_MALFORMED_JSON: 400,
  E_INVALID_INPUT: 400,
  E_INVALID_QUERY: 400,
  E_INVALID_TIER: 400,
  E_UNAUTHENTICATED: 401,
  E_FORBIDDEN: 403,
  E_NOT_FOUND: 404,
  E_EMAIL_TAKEN: 409,
  E_EVENT_CANCELLED: 409,
  E_EVENT_NOT_ON_SALE: 409,
  E_TICKETS_UNAVAILABLE: 409,
  E_TICKETS_AVAILABLE: 409,
  E_ALREADY_WAITING: 409,
  E_CODE_TAKEN: 409,
  E_ORDER_STATE: 409,
  E_TICKET_LIMIT: 422,
  E_DISCOUNT_UNUSABLE: 422,
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "ApiError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
  }
}

export interface Caller {
  readonly id: string;
}

export interface HttpRequest {
  readonly method: string;
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly body: unknown;
  readonly caller: Caller | null;
}

export interface ApiResponse {
  readonly status: number;
  readonly body: unknown;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

export function parseTime(value: unknown): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

export function toIsoString(ms: number): string {
  return new Date(ms).toISOString();
}
