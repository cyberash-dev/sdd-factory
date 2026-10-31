import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { errorResponse, exitStatus } from "./errors/index.js";
import type { HttpRequest, HttpResponse } from "./errors/index.js";
import { openStore } from "./links/index.js";
import type { LinkStore } from "./links/index.js";
import { routeLinks } from "./routes/links/index.js";
import { routeRedirect } from "./routes/redirect/index.js";

export type PortResolution =
  | { readonly ok: true; readonly port: number }
  | { readonly ok: false; readonly error: "invalid_port" };

export interface ServerOptions {
  readonly port: number;
  readonly host?: string;
}

export interface ServerHandle {
  readonly port: number;
  readonly close: () => Promise<void>;
}

const DEFAULT_PORT = 3000;
const MAX_PORT = 65535;

export function resolvePort(env: Readonly<Record<string, string | undefined>>): PortResolution {
  const raw = env["PORT"];
  if (raw === undefined || raw === "") {
    return { ok: true, port: DEFAULT_PORT };
  }
  if (!/^[0-9]+$/.test(raw)) {
    return { ok: false, error: "invalid_port" };
  }
  const port = Number(raw);
  if (port < 1 || port > MAX_PORT) {
    return { ok: false, error: "invalid_port" };
  }
  return { ok: true, port };
}

export function createHandler(store: LinkStore, port: number): (request: HttpRequest) => HttpResponse {
  return (request) =>
    routeLinks(request, { store, port }) ?? routeRedirect(request, { store }) ?? errorResponse("not_found");
}

function readBody(incoming: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    incoming.on("error", reject);
  });
}

async function respond(
  handler: (request: HttpRequest) => HttpResponse,
  incoming: IncomingMessage,
  outgoing: ServerResponse,
): Promise<void> {
  const body = await readBody(incoming);
  const path = (incoming.url ?? "/").split("?")[0] ?? "/";
  const response = handler({ method: incoming.method ?? "GET", path, body });
  outgoing.writeHead(response.status, response.headers);
  outgoing.end(response.body);
}

function listen(server: Server, port: number, host: string | undefined): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      resolve(typeof address === "object" && address !== null ? address.port : port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
    server.closeAllConnections();
  });
}

export async function startServer(options: ServerOptions, store: LinkStore = openStore()): Promise<ServerHandle> {
  let handler: (request: HttpRequest) => HttpResponse = createHandler(store, options.port);
  const server = createServer((incoming, outgoing) => {
    respond(handler, incoming, outgoing).catch(() => {
      outgoing.destroy();
    });
  });
  const port = await listen(server, options.port, options.host);
  handler = createHandler(store, port);
  return { port, close: () => close(server) };
}

export async function main(): Promise<void> {
  const resolution = resolvePort(process.env);
  if (!resolution.ok) {
    process.stderr.write(`${resolution.error}\n`);
    process.exitCode = exitStatus(resolution.error);
    return;
  }
  await startServer({ port: resolution.port });
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
}

if (isEntryPoint()) {
  await main();
}
