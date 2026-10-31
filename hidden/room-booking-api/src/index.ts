import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { findAvailableRooms } from "./availability/index.js";
import { createBooking, createBookingStore, deleteBooking, listBookings } from "./bookings/index.js";
import { isApiError } from "./core/index.js";
import type { Booking, Room } from "./core/index.js";
import { createRouter } from "./http/index.js";
import type { Route, RouteResult } from "./http/index.js";
import { createRoom, createRoomStore, listRooms } from "./rooms/index.js";

export interface RunningServer {
  readonly port: number;
  readonly close: () => Promise<void>;
}

const DEFAULT_PORT = 3000;
const MAX_PORT = 65535;

export function resolvePort(env: Record<string, string | undefined>): number {
  const raw = env["PORT"];
  if (raw === undefined || !/^[0-9]+$/.test(raw)) return DEFAULT_PORT;
  const port = Number(raw);
  return port <= MAX_PORT ? port : DEFAULT_PORT;
}

function respond(value: Room | Booking | Room[] | Booking[] | { error: string }, status: number, listKey?: "rooms" | "bookings"): RouteResult {
  if (isApiError(value)) return { kind: "error", error: value };
  return { kind: "ok", status, body: listKey === undefined ? value : { [listKey]: value } };
}

export function createRequestHandler(): (request: IncomingMessage, response: ServerResponse) => void {
  const roomStore = createRoomStore();
  const bookingStore = createBookingStore();
  const routes: Route[] = [
    { method: "POST", path: "/rooms", handle: ({ body }) => respond(createRoom(roomStore, body), 201) },
    { method: "GET", path: "/rooms", handle: ({ query }) => respond(listRooms(roomStore, query), 200, "rooms") },
    {
      method: "POST",
      path: "/rooms/:roomId/bookings",
      handle: ({ params, body }) =>
        respond(createBooking(bookingStore, roomStore.rooms, params["roomId"] ?? "", body), 201),
    },
    {
      method: "GET",
      path: "/rooms/:roomId/bookings",
      handle: ({ params, query }) =>
        respond(listBookings(bookingStore, roomStore.rooms, params["roomId"] ?? "", query), 200, "bookings"),
    },
    {
      method: "DELETE",
      path: "/bookings/:bookingId",
      handle: ({ params }) => {
        const error = deleteBooking(bookingStore, params["bookingId"] ?? "");
        return error === null ? { kind: "ok", status: 204 } : { kind: "error", error };
      },
    },
    {
      method: "GET",
      path: "/availability",
      handle: ({ query }) =>
        respond(findAvailableRooms(roomStore.rooms, bookingStore.bookings, query), 200, "rooms"),
    },
  ];
  return createRouter(routes);
}

export function startServer(port: number = resolvePort(process.env)): Promise<RunningServer> {
  const server = createServer(createRequestHandler());
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      const address = server.address();
      const bound = typeof address === "object" && address !== null ? address.port : port;
      resolve({
        port: bound,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((error) => (error === undefined ? done() : fail(error)));
            server.closeIdleConnections();
          }),
      });
    });
  });
}
