import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { formatError } from "../core/index.js";
import type { ErrorCode, Route } from "../core/index.js";

const MAX_BODY_BYTES = 1048576;

function matchPath(pattern: string, path: string): Record<string, string> | undefined {
  const patternParts = pattern.split("/");
  const pathParts = path.split("/");
  if (patternParts.length !== pathParts.length) return undefined;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const expected = patternParts[i];
    const actual = pathParts[i];
    if (expected === undefined || actual === undefined) return undefined;
    if (expected.startsWith(":")) {
      if (actual === "") return undefined;
      try {
        params[expected.slice(1)] = decodeURIComponent(actual);
      } catch {
        return undefined;
      }
    } else if (expected !== actual) {
      return undefined;
    }
  }
  return params;
}

function readBody(request: IncomingMessage): Promise<{ text: string; tooLarge: boolean }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
      } else if (!tooLarge) {
        chunks.push(chunk);
      }
    });
    request.on("end", () => resolve({ text: Buffer.concat(chunks).toString("utf8"), tooLarge }));
    request.on("error", () => resolve({ text: "", tooLarge: true }));
  });
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function writeError(response: ServerResponse, code: ErrorCode): void {
  const { status, body } = formatError(code);
  writeJson(response, status, body);
}

export function createHttpServer(routes: readonly Route[]): Server {
  return createServer((request, response) => {
    void (async () => {
      let url: URL;
      try {
        url = new URL(request.url ?? "/", "http://localhost");
      } catch {
        writeError(response, "not_found");
        return;
      }
      const method = request.method ?? "";
      let pathMatched = false;
      let selected: { route: Route; params: Record<string, string> } | undefined;
      for (const route of routes) {
        const params = matchPath(route.path, url.pathname);
        if (params === undefined) continue;
        pathMatched = true;
        if (route.method === method && selected === undefined) selected = { route, params };
      }
      const body = await readBody(request);
      if (selected === undefined) {
        writeError(response, pathMatched ? "method_not_allowed" : "not_found");
        return;
      }
      let parsed: unknown;
      if (selected.route.expectsJsonBody) {
        if (body.tooLarge) {
          writeError(response, "invalid_json");
          return;
        }
        try {
          parsed = JSON.parse(body.text);
        } catch {
          writeError(response, "invalid_json");
          return;
        }
      }
      const result = selected.route.handle({
        params: selected.params,
        query: url.searchParams,
        body: parsed,
      });
      if (result.status === 204) {
        response.writeHead(204);
        response.end();
        return;
      }
      writeJson(response, result.status, result.body);
    })();
  });
}
