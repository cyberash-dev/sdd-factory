import { realpathSync } from "node:fs";
import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import { createStore } from "./domain/index.js";
import type { Store } from "./domain/index.js";
import { createServer as createHttpServer, startServer as startHttpServer } from "./http/server.js";

const DEFAULT_PORT = 3000;
const MAX_PORT = 65535;

export function resolvePort(env: NodeJS.ProcessEnv): number {
  const raw = env["PORT"];
  if (raw === undefined || !/^\d+$/.test(raw)) return DEFAULT_PORT;
  const port = Number(raw);
  return port >= 1 && port <= MAX_PORT ? port : DEFAULT_PORT;
}

export function createServer(store: Store): Server {
  return createHttpServer(store);
}

export function startServer(store: Store, port: number): Promise<Server> {
  return startHttpServer(store, port);
}

export function main(env: NodeJS.ProcessEnv): Promise<Server> {
  return startServer(createStore(), resolvePort(env));
}

function isProcessEntry(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isProcessEntry()) {
  await main(process.env);
}
