import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { createAccount, createSession, getMe } from "../accounts/index.js";
import { ApiError, isPlainObject } from "../core/index.js";
import type { ApiResponse, HttpRequest } from "../core/index.js";
import { cancelEvent, createEvent, getEvent, getEventReport, listEvents } from "../events/index.js";
import { createOrder, getOrder, listMyOrders, payOrder, cancelOrder } from "../orders/index.js";
import { createDiscountCode } from "../discounts/index.js";
import { joinWaitlist, listMyWaitlist } from "../waitlist/index.js";
import type { Role, Store } from "../store/index.js";
import { createStore } from "../store/index.js";

const DEFAULT_PORT = 3000;
const DEFAULT_HOLD_SECONDS = 600;
const MAX_PORT = 65535;
const MAX_BODY_BYTES = 1048576;

type Handler = (req: HttpRequest, store: Store) => ApiResponse;

interface Route {
  readonly method: string;
  readonly segments: readonly string[];
  readonly roles: readonly Role[] | "public";
  readonly readsBody: boolean;
  readonly handler: Handler;
}

const BOTH: readonly Role[] = ["organizer", "customer"];
const CUSTOMER: readonly Role[] = ["customer"];
const ORGANIZER: readonly Role[] = ["organizer"];

function route(
  method: string,
  path: string,
  roles: readonly Role[] | "public",
  readsBody: boolean,
  handler: Handler,
): Route {
  return { method, segments: path.split("/").filter((s) => s.length > 0), roles, readsBody, handler };
}

const ROUTES: readonly Route[] = [
  route("POST", "/users", "public", true, createAccount),
  route("POST", "/sessions", "public", true, createSession),
  route("GET", "/me", BOTH, false, getMe),
  route("GET", "/me/orders", CUSTOMER, false, listMyOrders),
  route("GET", "/me/waitlist", CUSTOMER, false, listMyWaitlist),
  route("POST", "/events", ORGANIZER, true, createEvent),
  route("GET", "/events", "public", false, listEvents),
  route("GET", "/events/:id", "public", false, getEvent),
  route("POST", "/events/:id/cancel", ORGANIZER, false, cancelEvent),
  route("POST", "/events/:id/discounts", ORGANIZER, true, createDiscountCode),
  route("POST", "/events/:id/waitlist", CUSTOMER, true, joinWaitlist),
  route("GET", "/events/:id/report", ORGANIZER, false, getEventReport),
  route("POST", "/orders", CUSTOMER, true, createOrder),
  route("POST", "/orders/:id/pay", CUSTOMER, false, payOrder),
  route("POST", "/orders/:id/cancel", CUSTOMER, false, cancelOrder),
  route("GET", "/orders/:id", BOTH, false, getOrder),
];

function matchSegments(pattern: readonly string[], actual: readonly string[]): Record<string, string> | undefined {
  if (pattern.length !== actual.length) {
    return undefined;
  }
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i += 1) {
    const expected = pattern[i] ?? "";
    const value = actual[i] ?? "";
    if (expected.startsWith(":")) {
      params[expected.slice(1)] = value;
    } else if (expected !== value) {
      return undefined;
    }
  }
  return params;
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function bearerToken(header: string | undefined): string | undefined {
  if (header === undefined || !header.startsWith("Bearer ")) {
    return undefined;
  }
  const token = header.slice("Bearer ".length);
  return token.length === 0 ? undefined : token;
}

function readBody(incoming: IncomingMessage): Promise<string | undefined> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    incoming.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
      } else {
        chunks.push(chunk);
      }
    });
    incoming.on("end", () => resolve(tooLarge ? undefined : Buffer.concat(chunks).toString("utf8")));
    incoming.on("error", () => resolve(undefined));
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": payload.length,
  });
  res.end(payload);
}

function sendError(res: ServerResponse, error: ApiError): void {
  send(res, error.status, { error: error.message });
}

function handle(
  store: Store,
  method: string,
  target: string,
  authorization: string | undefined,
  rawBody: string | undefined,
): ApiResponse {
  const queryStart = target.indexOf("?");
  const pathPart = queryStart < 0 ? target : target.slice(0, queryStart);
  const query = new URLSearchParams(target.slice(target.indexOf("?") + 1));
  const actual = pathPart.split("/").filter((s) => s.length > 0).map(safeDecode);

  const matched = ROUTES.filter((r) => matchSegments(r.segments, actual) !== undefined);
  const selected = matched.find((r) => r.method === method);
  if (selected === undefined) {
    throw new ApiError("E_NOT_FOUND", "no such route");
  }
  const params = matchSegments(selected.segments, actual) ?? {};

  let body: unknown = undefined;
  if (selected.readsBody) {
    if (rawBody === undefined) {
      throw new ApiError("E_MALFORMED_JSON", "request body is not valid JSON");
    }
    try {
      body = JSON.parse(rawBody);
    } catch {
      throw new ApiError("E_MALFORMED_JSON", "request body is not valid JSON");
    }
    if (!isPlainObject(body)) {
      throw new ApiError("E_INVALID_INPUT", "body must be a JSON object");
    }
  }

  let caller: HttpRequest["caller"] = null;
  if (selected.roles !== "public") {
    const token = bearerToken(authorization);
    const account = token === undefined ? undefined : store.resolveToken(token);
    if (account === undefined) {
      throw new ApiError("E_UNAUTHENTICATED", "a valid token is required");
    }
    if (!selected.roles.includes(account.role)) {
      throw new ApiError("E_FORBIDDEN", "the caller's role may not use this endpoint");
    }
    caller = { id: account.id };
  }

  return selected.handler({ method, path: pathPart, params, query, body, caller }, store);
}

export function createApp(store: Store): Server {
  return createServer((incoming, res) => {
    const method = incoming.method ?? "GET";
    const target = incoming.url ?? "/";
    const authorization = incoming.headers.authorization;
    const queryStart = target.indexOf("?");
    const segments = (queryStart < 0 ? target : target.slice(0, queryStart)).split("/").filter((s) => s.length > 0);
    const candidates = ROUTES.filter((r) => r.method === method && matchSegments(r.segments, segments) !== undefined);
    const needsBody = candidates.some((r) => r.readsBody);
    const bodyPromise = needsBody ? readBody(incoming) : Promise.resolve("");
    if (!needsBody) {
      incoming.resume();
    }
    void bodyPromise.then((rawBody) => {
      try {
        const result = handle(store, method, target, authorization, needsBody ? rawBody : undefined);
        send(res, result.status, result.body);
      } catch (error) {
        if (error instanceof ApiError) {
          sendError(res, error);
        } else {
          console.error(error);
          send(res, 500, { error: "internal error" });
        }
      }
    });
  });
}

function parseNonNegativeInteger(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) {
    return undefined;
  }
  return Number(value);
}

export function readConfig(env: Readonly<Record<string, string | undefined>>): {
  port: number;
  holdSeconds: number;
} {
  const port = parseNonNegativeInteger(env["PORT"]);
  const holdSeconds = parseNonNegativeInteger(env["HOLD_SECONDS"]);
  return {
    port: port === undefined || port > MAX_PORT ? DEFAULT_PORT : port,
    holdSeconds: holdSeconds === undefined ? DEFAULT_HOLD_SECONDS : holdSeconds,
  };
}

export function startServer(): Server {
  const config = readConfig(process.env);
  const store = createStore({ holdSeconds: config.holdSeconds });
  const server = createApp(store);
  process.on("uncaughtException", (error) => {
    console.error(error);
  });
  process.on("unhandledRejection", (reason) => {
    console.error(reason);
  });
  server.listen(config.port, () => {
    const address = server.address();
    if (address !== null && typeof address === "object") {
      process.stdout.write(`box-office listening on ${address.port}\n`);
    }
  });
  return server;
}
