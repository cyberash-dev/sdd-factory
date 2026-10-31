export type ErrorCode = "invalid_url" | "invalid_json" | "not_found" | "invalid_port";

export interface HttpRequest {
  readonly method: string;
  readonly path: string;
  readonly body: string;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

export const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = {
  invalid_url: 400,
  invalid_json: 400,
  not_found: 404,
  invalid_port: 0,
};

const JSON_HEADERS: Readonly<Record<string, string>> = { "content-type": "application/json" };

export function jsonResponse(status: number, payload: unknown): HttpResponse {
  return { status, headers: JSON_HEADERS, body: JSON.stringify(payload) };
}

export function errorResponse(code: ErrorCode): HttpResponse {
  return jsonResponse(ERROR_STATUS[code], { error: code });
}

export function exitStatus(code: ErrorCode): number {
  return code === "invalid_port" ? 1 : 0;
}
