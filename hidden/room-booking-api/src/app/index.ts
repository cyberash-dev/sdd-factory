import type { Server } from "node:http";
import { createStore } from "../core/index.js";
import type { Store } from "../core/index.js";
import { createRoomRoutes } from "../rooms/index.js";
import { createBookingCreateRoutes } from "../booking-create/index.js";
import { createBookingReadRoutes } from "../booking-read/index.js";
import { createHttpServer } from "../http/index.js";

export function buildServer(store: Store = createStore()): Server {
  return createHttpServer([
    ...createRoomRoutes(store),
    ...createBookingCreateRoutes(store),
    ...createBookingReadRoutes(store),
  ]);
}

export function startServer(
  port: number,
): Promise<{ readonly port: number; readonly close: () => Promise<void> }> {
  const server = buildServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      const address = server.address();
      const bound = typeof address === "object" && address !== null ? address.port : port;
      resolve({
        port: bound,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
