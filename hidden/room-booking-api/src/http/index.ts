import type { IncomingMessage, ServerResponse } from "node:http";
import { statusOf } from "../core/index.js";
import type { ApiError } from "../core/index.js";

export interface RouteContext {
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly body: unknown;
}

export type RouteResult =
  | { readonly kind: "ok"; readonly status: number; readonly body?: unknown }
  | { readonly kind: "error"; readonly error: ApiError };

export interface Route {
  readonly method: "GET" | "POST" | "DELETE";
  readonly path: string;
  readonly handle: (context: RouteContext) => RouteResult;
}

function splitPath(path: string): string[] {
  return path.split("/").filter((segment) => segment !== "");
}

function matchPath(pattern: string, path: string): Record<string, string> | undefined {
  const expected = splitPath(pattern);
  const actual = splitPath(path);
  if (expected.length !== actual.length) return undefined;
  const params: Record<string, string> = {};
  for (let i = 0; i < expected.length; i++) {
    const want = expected[i] ?? "";
    const got = actual[i] ?? "";
    if (want.startsWith(":")) {
      let decoded: string;
      try {
        decoded = decodeURIComponent(got);
      } catch {
        return undefined;
      }
      params[want.slice(1)] = decoded;
    } else if (want !== got) {
      return undefined;
    }
  }
  return params;
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function writeError(response: ServerResponse, error: ApiError): void {
  writeJson(response, statusOf(error.error), error);
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", () => resolve(""));
  });
}

function parseBody(text: string): { readonly valid: true; readonly value: unknown } | { readonly valid: false } {
  try {
    return { valid: true, value: JSON.parse(text) };
  } catch {
    return { valid: false };
  }
}

function dispatch(route: Route, params: Record<string, string>, query: URLSearchParams, body: unknown, response: ServerResponse): void {
  const result = route.handle({ params, query, body });
  if (result.kind === "error") {
    writeError(response, result.error);
  } else if (result.status === 204 || result.body === undefined) {
    response.writeHead(result.status);
    response.end();
  } else {
    writeJson(response, result.status, result.body);
  }
}

export function createRouter(routes: readonly Route[]): (request: IncomingMessage, response: ServerResponse) => void {
  return (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const method = request.method ?? "GET";
    let pathMatched = false;
    let selected: { route: Route; params: Record<string, string> } | undefined;
    for (const route of routes) {
      const params = matchPath(route.path, url.pathname);
      if (params === undefined) continue;
      pathMatched = true;
      if (route.method === method) {
        selected = { route, params };
        break;
      }
    }
    if (selected === undefined) {
      request.resume();
      writeError(response, { error: pathMatched ? "method_not_allowed" : "not_found" });
      return;
    }
    const { route, params } = selected;
    if (method !== "POST") {
      request.resume();
      dispatch(route, params, url.searchParams, undefined, response);
      return;
    }
    void readBody(request).then((text) => {
      const parsed = parseBody(text);
      if (!parsed.valid) {
        writeError(response, { error: "invalid_json" });
        return;
      }
      dispatch(route, params, url.searchParams, parsed.value, response);
    });
  };
}
