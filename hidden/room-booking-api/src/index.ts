import { createServer as createHttpServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { findAvailableRooms } from "./availability/index.js";
import { listBookings } from "./booking-list/index.js";
import { createBooking, deleteBooking } from "./bookings/index.js";
import { errorBody, failure, isSuccess, statusForCode } from "./errors/index.js";
import type { HandlerResult } from "./errors/index.js";
import { createRoom, listRooms } from "./rooms/index.js";
import { createStore } from "./store/index.js";
import type { Store } from "./store/index.js";

export interface StartedServer {
  readonly port: number;
  readonly server: Server;
  close(): Promise<void>;
}

const DEFAULT_PORT = 3000;

interface RouteContext {
  readonly store: Store;
  readonly params: readonly string[];
  readonly query: URLSearchParams;
  readonly body: unknown;
}

interface Route {
  readonly pattern: readonly string[];
  readonly method: string;
  readonly readsBody: boolean;
  readonly handle: (context: RouteContext) => HandlerResult;
}

const PARAMETER = ":";

const ROUTES: readonly Route[] = [
  {
    pattern: ["rooms"],
    method: "POST",
    readsBody: true,
    handle: ({ store, body }) => createRoom(store.rooms, body),
  },
  {
    pattern: ["rooms"],
    method: "GET",
    readsBody: false,
    handle: ({ store, query }) => listRooms(store.rooms, query),
  },
  {
    pattern: ["rooms", ":roomId", "bookings"],
    method: "POST",
    readsBody: true,
    handle: ({ store, params, body }) => createBooking(store, params[0] ?? "", body),
  },
  {
    pattern: ["rooms", ":roomId", "bookings"],
    method: "GET",
    readsBody: false,
    handle: ({ store, params, query }) => listBookings(store, params[0] ?? "", query),
  },
  {
    pattern: ["bookings", ":bookingId"],
    method: "DELETE",
    readsBody: false,
    handle: ({ store, params }) => deleteBooking(store, params[0] ?? ""),
  },
  {
    pattern: ["availability"],
    method: "GET",
    readsBody: false,
    handle: ({ store, query }) => findAvailableRooms(store, query),
  },
];

function matchPattern(pattern: readonly string[], segments: readonly string[]): string[] | undefined {
  if (pattern.length !== segments.length) {
    return undefined;
  }
  const params: string[] = [];
  for (let index = 0; index < pattern.length; index += 1) {
    const expected = pattern[index] ?? "";
    const actual = segments[index] ?? "";
    if (expected.startsWith(PARAMETER)) {
      params.push(actual);
    } else if (expected !== actual) {
      return undefined;
    }
  }
  return params;
}

function readText(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function parseObject(text: string): { readonly value: unknown } | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return undefined;
    }
    return { value };
  } catch {
    return undefined;
  }
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function writeResult(response: ServerResponse, result: HandlerResult): void {
  if (!isSuccess(result)) {
    writeJson(response, statusForCode(result.code), errorBody(result));
    return;
  }
  if (result.status === 204) {
    response.writeHead(204);
    response.end();
    return;
  }
  writeJson(response, result.status, result.body);
}

async function dispatch(store: Store, request: IncomingMessage): Promise<HandlerResult> {
  const url = request.url ?? "/";
  const queryStart = url.indexOf("?");
  const pathname = queryStart < 0 ? url : url.slice(0, queryStart);
  const query = new URLSearchParams(queryStart < 0 ? "" : url.slice(queryStart + 1));
  const segments = pathname.split("/").slice(1);
  const method = request.method ?? "";

  let pathMatched = false;
  for (const route of ROUTES) {
    const params = matchPattern(route.pattern, segments);
    if (params === undefined) {
      continue;
    }
    pathMatched = true;
    if (route.method !== method) {
      continue;
    }
    let body: unknown;
    if (route.readsBody) {
      const parsed = parseObject(await readText(request));
      if (parsed === undefined) {
        return failure("invalid_json");
      }
      body = parsed.value;
    }
    return route.handle({ store, params, query, body });
  }
  return failure(pathMatched ? "method_not_allowed" : "not_found");
}

export function resolvePort(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_PORT;
  }
  return Number.parseInt(raw, 10);
}

export function createServer(): Server {
  const store = createStore();
  return createHttpServer((request, response) => {
    dispatch(store, request).then(
      (result) => writeResult(response, result),
      () => {
        response.writeHead(500);
        response.end();
      },
    );
  });
}

export function startServer(port?: number): Promise<StartedServer> {
  const server = createServer();
  const requested = port ?? resolvePort(process.env.PORT);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(requested, () => {
      server.off("error", reject);
      const address = server.address();
      const effective = typeof address === "object" && address !== null ? address.port : requested;
      resolve({
        port: effective,
        server,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((error) => (error === undefined ? done() : fail(error)));
            server.closeAllConnections();
          }),
      });
    });
  });
}
