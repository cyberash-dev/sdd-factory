import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse, Server } from "node:http";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { apiError, isApiError } from "./errors/index.js";
import type { ApiError } from "./errors/index.js";
import { matchRoute } from "./routing/index.js";
import type { RouteMatch } from "./routing/index.js";
import { createRoom, listRooms } from "./rooms/index.js";
import { findAvailableRooms } from "./availability/index.js";
import { listBookings } from "./bookings/read/index.js";
import { createBooking, deleteBooking } from "./bookings/write/index.js";

const DEFAULT_PORT = 3000;

interface Reply {
  status: number;
  body?: unknown;
}

function writeReply(response: ServerResponse, reply: Reply): void {
  if (reply.body === undefined) {
    response.writeHead(reply.status);
    response.end();
    return;
  }
  const payload = JSON.stringify(reply.body);
  response.writeHead(reply.status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function errorReply(error: ApiError): Reply {
  return { status: error.status, body: error.body };
}

function parseBody(raw: string): { value: unknown } | ApiError {
  try {
    return { value: JSON.parse(raw) };
  } catch {
    return apiError("invalid_json");
  }
}

function dispatch(route: RouteMatch, query: URLSearchParams, body: unknown): Reply {
  switch (route.name) {
    case "rooms": {
      if (route.method === "POST") {
        const result = createRoom(body);
        return isApiError(result) ? errorReply(result) : { status: 201, body: result.room };
      }
      const result = listRooms(query);
      return isApiError(result) ? errorReply(result) : { status: 200, body: result };
    }
    case "roomBookings": {
      const roomId = route.params["roomId"] ?? "";
      if (route.method === "POST") {
        const result = createBooking(roomId, body);
        return isApiError(result) ? errorReply(result) : { status: 201, body: result.booking };
      }
      const result = listBookings(roomId, query);
      return isApiError(result) ? errorReply(result) : { status: 200, body: result };
    }
    case "booking": {
      const result = deleteBooking(route.params["bookingId"] ?? "");
      return isApiError(result) ? errorReply(result) : { status: 204 };
    }
    case "availability": {
      const result = findAvailableRooms(query);
      return isApiError(result) ? errorReply(result) : { status: 200, body: result };
    }
  }
}

function handle(method: string, target: string, raw: string): Reply {
  const route = matchRoute(method, target);
  if (isApiError(route)) return errorReply(route);
  let body: unknown = undefined;
  if (raw !== "" || route.method === "POST") {
    const parsed = parseBody(raw);
    if (isApiError(parsed)) return errorReply(parsed);
    body = parsed.value;
  }
  const queryStart = target.indexOf("?");
  const query = new URLSearchParams(queryStart === -1 ? "" : target.slice(queryStart + 1));
  return dispatch(route, query, body);
}

export function createHandler(): (request: IncomingMessage, response: ServerResponse) => void {
  return (request, response) => {
    const chunks: Buffer[] = [];
    const fail = (): void => {
      if (!response.headersSent) writeReply(response, { status: 500, body: { error: "internal" } });
      else response.destroy();
    };
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("error", () => response.destroy());
    request.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        writeReply(response, handle(request.method ?? "", request.url ?? "/", raw));
      } catch {
        fail();
      }
    });
  };
}

export function startServer(): Promise<Server> {
  const portText = process.env["PORT"];
  const port = portText === undefined || portText === "" ? DEFAULT_PORT : Number(portText);
  const server = createServer(createHandler());
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

const entry = process.argv[1];
if (entry !== undefined && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  void startServer();
}
