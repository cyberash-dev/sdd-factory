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

type Handler = (req: HttpRequest, store: Store) => ApiResponse;

interface Route {
  readonly method: string;
  readonly segments: readonly string[];
  readonly roles: readonly Role[] | "public";
  readonly readsBody: boolean;
  readonly handler: Handler;
}

const ANY_ROLE: readonly Role[] = ["organizer", "customer"];
const ORGANIZER: readonly Role[] = ["organizer"];
const CUSTOMER: readonly Role[] = ["customer"];

function route(
  method: string,
  path: string,
  roles: readonly Role[] | "public",
  readsBody: boolean,
  handler: Handler,
): Route {
  return { method, segments: splitPath(path), roles, readsBody, handler };
}

function splitPath(path: string): string[] {
  return path.split("/").filter((segment) => segment !== "");
}

const ROUTES: readonly Route[] = [
  route("POST", "/users", "public", true, createAccount),
  route("POST", "/sessions", "public", true, createSession),
  route("GET", "/me", ANY_ROLE, false, getMe),
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
  route("GET", "/orders/:id", ANY_ROLE, false, getOrder),
];

const MAX_BODY_BYTES = 1_048_576;
const DEFAULT_PORT = 3000;
const MAX_PORT = 65535;
const DEFAULT_HOLD_SECONDS = 600;

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function matchSegments(
  pattern: readonly string[],
  actual: readonly string[],
): Record<string, string> | undefined {
  if (pattern.length !== actual.length) {
    return undefined;
  }
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i += 1) {
    const expected = pattern[i] ?? "";
    const given = actual[i] ?? "";
    if (expected.startsWith(":")) {
      params[expected.slice(1)] = given;
    } else if (expected !== given) {
      return undefined;
    }
  }
  return params;
}

function readBody(req: IncomingMessage): Promise<string | undefined> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let oversize = false;
    req.on("data", (chunk: Buffer) => {
      if (oversize) {
        return;
      }
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        oversize = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(oversize ? undefined : Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(undefined));
  });
}

function discardBody(req: IncomingMessage): Promise<void> {
  return new Promise((resolve) => {
    req.on("end", () => resolve());
    req.on("error", () => resolve());
    req.resume();
  });
}

function parseBody(text: string | undefined): unknown {
  if (text === undefined) {
    throw new ApiError("E_MALFORMED_JSON", "the body is too large or unreadable");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError("E_MALFORMED_JSON", "the body is not valid JSON");
  }
  if (!isPlainObject(parsed)) {
    throw new ApiError("E_INVALID_INPUT", "body must be a JSON object");
  }
  return parsed;
}

function bearerToken(header: string | undefined): string | undefined {
  const prefix = "Bearer ";
  if (header === undefined || !header.startsWith(prefix)) {
    return undefined;
  }
  const token = header.slice(prefix.length);
  return token === "" ? undefined : token;
}

async function dispatch(req: IncomingMessage, store: Store): Promise<ApiResponse> {
  const target = req.url ?? "/";
  const queryStart = target.indexOf("?");
  const pathPart = queryStart < 0 ? target : target.slice(0, queryStart);
  const segments = splitPath(pathPart).map(decodeSegment);
  const method = req.method ?? "GET";

  let pathMatched = false;
  let chosen: Route | undefined;
  let params: Record<string, string> = {};
  for (const candidate of ROUTES) {
    const found = matchSegments(candidate.segments, segments);
    if (found === undefined) {
      continue;
    }
    pathMatched = true;
    if (candidate.method === method) {
      chosen = candidate;
      params = found;
      break;
    }
  }
  if (chosen === undefined) {
    await discardBody(req);
    throw new ApiError("E_NOT_FOUND", pathMatched ? "the method is not served on this path" : "no such route");
  }

  let body: unknown = null;
  let bodyError: ApiError | undefined;
  if (chosen.readsBody) {
    const text = await readBody(req);
    try {
      body = parseBody(text);
    } catch (error) {
      if (error instanceof ApiError) {
        bodyError = error;
      } else {
        throw error;
      }
    }
  } else {
    await discardBody(req);
  }
  if (bodyError !== undefined && bodyError.code === "E_MALFORMED_JSON") {
    throw bodyError;
  }

  let caller: HttpRequest["caller"] = null;
  if (chosen.roles !== "public") {
    const token = bearerToken(req.headers.authorization);
    const account = token === undefined ? undefined : store.resolveToken(token);
    if (account === undefined) {
      throw new ApiError("E_UNAUTHENTICATED", "a valid token is required");
    }
    if (!chosen.roles.includes(account.role)) {
      throw new ApiError("E_FORBIDDEN", "the caller's role is not accepted by this endpoint");
    }
    caller = { id: account.id };
  }
  if (bodyError !== undefined) {
    throw bodyError;
  }

  return chosen.handler(
    {
      method,
      path: pathPart,
      params,
      query: new URLSearchParams(queryStart < 0 ? "" : target.slice(queryStart + 1)),
      body,
      caller,
    },
    store,
  );
}

function render(res: ServerResponse, response: ApiResponse): void {
  const payload = Buffer.from(JSON.stringify(response.body), "utf8");
  res.writeHead(response.status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": payload.length,
  });
  res.end(payload);
}

function renderError(error: unknown): ApiResponse {
  if (error instanceof ApiError) {
    return { status: error.status, body: { error: error.message } };
  }
  console.error(error);
  return { status: 500, body: { error: "internal error" } };
}

export function createApp(store: Store): Server {
  return createServer((req, res) => {
    dispatch(req, store).then(
      (response) => render(res, response),
      (error: unknown) => render(res, renderError(error)),
    );
  });
}

export function readConfig(env: Readonly<Record<string, string | undefined>>): {
  port: number;
  holdSeconds: number;
} {
  const rawPort = env["PORT"];
  const port = rawPort !== undefined && /^\d+$/.test(rawPort) ? Number(rawPort) : DEFAULT_PORT;
  const rawHold = env["HOLD_SECONDS"];
  const holdSeconds =
    rawHold !== undefined && /^\d+$/.test(rawHold) ? Number(rawHold) : DEFAULT_HOLD_SECONDS;
  return { port: port > MAX_PORT ? DEFAULT_PORT : port, holdSeconds };
}

export function startServer(): Server {
  const config = readConfig(process.env);
  process.on("uncaughtException", (error) => console.error(error));
  process.on("unhandledRejection", (reason) => console.error(reason));
  const server = createApp(createStore({ holdSeconds: config.holdSeconds }));
  server.listen(config.port, () => {
    const address = server.address();
    const bound = address !== null && typeof address === "object" ? address.port : config.port;
    process.stdout.write(`box-office listening on ${bound}\n`);
  });
  return server;
}
