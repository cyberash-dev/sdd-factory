import { errorResponse, jsonResponse } from "../../errors/index.js";
import type { HttpRequest, HttpResponse } from "../../errors/index.js";
import { createLink, deleteLink, findLink, isValidOriginalUrl, toStats } from "../../links/index.js";
import type { LinkStore } from "../../links/index.js";

export interface LinksRouteDeps {
  readonly store: LinkStore;
  readonly port: number;
}

const COLLECTION_PATH = "/links";
const ITEM_PREFIX = "/links/";

function parseBody(body: string): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch {
    return { ok: false };
  }
}

function extractUrl(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return Object.getOwnPropertyDescriptor(value, "url")?.value;
}

function createRoute(request: HttpRequest, deps: LinksRouteDeps): HttpResponse {
  const parsed = parseBody(request.body);
  if (!parsed.ok) {
    return errorResponse("invalid_json");
  }
  const url = extractUrl(parsed.value);
  if (typeof url !== "string" || !isValidOriginalUrl(url)) {
    return errorResponse("invalid_url");
  }
  const outcome = createLink(deps.store, url);
  return jsonResponse(outcome.created ? 201 : 200, {
    code: outcome.link.code,
    url: outcome.link.url,
    shortUrl: `http://localhost:${deps.port}/${outcome.link.code}`,
  });
}

function statsRoute(code: string, store: LinkStore): HttpResponse {
  const link = findLink(store, code);
  return link === undefined ? errorResponse("not_found") : jsonResponse(200, toStats(link));
}

function deleteRoute(code: string, store: LinkStore): HttpResponse {
  return deleteLink(store, code) ? { status: 204, headers: {} } : errorResponse("not_found");
}

export function routeLinks(request: HttpRequest, deps: LinksRouteDeps): HttpResponse | undefined {
  if (request.path === COLLECTION_PATH) {
    return request.method === "POST" ? createRoute(request, deps) : undefined;
  }
  if (!request.path.startsWith(ITEM_PREFIX)) {
    return undefined;
  }
  const code = request.path.slice(ITEM_PREFIX.length);
  if (code === "" || code.includes("/")) {
    return undefined;
  }
  if (request.method === "GET") {
    return statsRoute(code, deps.store);
  }
  if (request.method === "DELETE") {
    return deleteRoute(code, deps.store);
  }
  return undefined;
}
