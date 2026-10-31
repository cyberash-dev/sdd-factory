import { createServer as createHttpServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { errorBody, fail, ok, statusFor } from "../errors/index.js";
import type { ApiError, Result } from "../errors/index.js";
import type { Store } from "../domain/index.js";
import { matchRoute } from "./router.js";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseJson(text: string): Result<unknown> {
  try {
    return ok(JSON.parse(text));
  } catch {
    return fail({ code: "invalid_json" });
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendError(res: ServerResponse, error: ApiError): void {
  sendJson(res, statusFor(error.code), errorBody(error));
}

async function handle(store: Store, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const matched = matchRoute(req.method ?? "", url.pathname);
  if (!matched.ok) {
    await readBody(req);
    sendError(res, matched.error);
    return;
  }
  const { route, params } = matched.value;
  let body: unknown;
  if (route.readsBody) {
    const parsed = parseJson(await readBody(req));
    if (!parsed.ok) {
      sendError(res, parsed.error);
      return;
    }
    body = parsed.value;
  } else {
    await readBody(req);
  }
  const result = route.handler(store, params, url.searchParams, body);
  if (!result.ok) {
    sendError(res, result.error);
    return;
  }
  if (route.success === 204) {
    res.writeHead(204);
    res.end();
    return;
  }
  sendJson(res, route.success, result.value);
}

export function createServer(store: Store): Server {
  return createHttpServer((req, res) => {
    handle(store, req, res).catch(() => {
      req.destroy();
      res.destroy();
    });
  });
}

export function startServer(store: Store, port: number): Promise<Server> {
  const server = createServer(store);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}
