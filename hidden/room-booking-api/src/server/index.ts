import { createServer as createHttpServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { apiError, errorResponse, JSON_CONTENT_TYPE } from "../errors/index.js";
import type { ApiResponse } from "../errors/index.js";
import { createStore, parseJsonBody } from "../core/index.js";
import type { ParsedBody, Store } from "../core/index.js";
import { handleAvailability } from "../routes/availability/index.js";
import { handleCreateBooking } from "../routes/booking-create/index.js";
import { handleDeleteBooking, handleListBookings } from "../routes/booking-query/index.js";
import { handleCreateRoom, handleListRooms } from "../routes/rooms/index.js";

export interface RunningServer {
  readonly port: number;
  readonly url: string;
  close(): Promise<void>;
}

type Handler = (store: Store, query: URLSearchParams, body: ParsedBody) => ApiResponse;

interface Resolved {
  readonly handlers: Readonly<Record<string, Handler>>;
}

function resolvePath(path: string): Resolved | null {
  if (path === "/rooms") {
    return {
      handlers: {
        GET: (store, query, body) => handleListRooms(store, query, body),
        POST: (store, _query, body) => handleCreateRoom(store, body),
      },
    };
  }
  if (path === "/availability") {
    return { handlers: { GET: (store, query, body) => handleAvailability(store, query, body) } };
  }
  const segments = path.split("/");
  const [empty, first, id, last] = segments;
  if (segments.length === 4 && empty === "" && first === "rooms" && last === "bookings" && id) {
    return {
      handlers: {
        GET: (store, query, body) => handleListBookings(store, id, query, body),
        POST: (store, _query, body) => handleCreateBooking(store, id, body),
      },
    };
  }
  if (segments.length === 3 && empty === "" && first === "bookings" && id) {
    return { handlers: { DELETE: (store, _query, body) => handleDeleteBooking(store, id, body) } };
  }
  return null;
}

function route(store: Store, method: string, target: string, body: ParsedBody): ApiResponse {
  const questionMark = target.indexOf("?");
  const path = questionMark < 0 ? target : target.slice(0, questionMark);
  const query = new URLSearchParams(questionMark < 0 ? "" : target.slice(questionMark + 1));
  const resolved = resolvePath(path);
  if (body.kind === "invalid") return errorResponse(apiError("invalid_json"));
  if (resolved === null) return errorResponse(apiError("not_found"));
  const handler = Object.hasOwn(resolved.handlers, method) ? resolved.handlers[method] : undefined;
  if (handler === undefined) return errorResponse(apiError("method_not_allowed"));
  return handler(store, query, body);
}

function write(res: ServerResponse, response: ApiResponse): void {
  if (response.body === undefined) {
    res.writeHead(response.status, { Connection: "close" });
    res.end();
    return;
  }
  res.writeHead(response.status, { "Content-Type": JSON_CONTENT_TYPE, Connection: "close" });
  res.end(JSON.stringify(response.body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(""));
  });
}

export function createServer(store: Store): Server {
  return createHttpServer((req, res) => {
    void readBody(req).then((raw) => {
      let response: ApiResponse;
      try {
        response = route(store, req.method ?? "", req.url ?? "/", parseJsonBody(raw));
      } catch {
        response = errorResponse(apiError("not_found"));
      }
      write(res, response);
    });
  });
}

export function startServer(port: number): Promise<RunningServer> {
  const server = createServer(createStore());
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const boundPort = typeof address === "object" && address !== null ? address.port : port;
      resolve({
        port: boundPort,
        url: `http://127.0.0.1:${boundPort}`,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
            server.closeAllConnections();
          }),
      });
    });
  });
}
