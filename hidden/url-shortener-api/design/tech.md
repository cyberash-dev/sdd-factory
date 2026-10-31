# Technical design: url-shortener-api

## 1. Overview

`shortly` is a single-process TypeScript HTTP API on Node.js >= 22 that turns absolute http/https URLs into
6-character alphanumeric codes and redirects requests for those codes. All state, the Links with their hit counters
and creation timestamps, lives in process memory and disappears when the process stops. The server listens on the port
named by `PORT` (default `3000`), answers JSON with stable snake_case error codes on every error, and answers `404`
with `not_found` for anything that is not one of its five routes. It is built with `tsc` and started with `npm start`.

## 2. Module map

### M-01 errors-http
- responsibility: own the closed set of error codes and the HTTP response primitives (JSON bodies, the single-field error body, content-type header) every route uses.
- covers: [url-shortener-api:POL-001, url-shortener-api:INV-003, url-shortener-api:INV-004]
- owns: src/errors/**
- entry: src/errors/index.ts
- depends_on: []
- public interface:
  ```ts
  export type ErrorCode = "invalid_url" | "invalid_json" | "not_found" | "invalid_port";

  export interface HttpRequest {
    readonly method: string;
    readonly path: string;
    readonly body: string;
  }

  export interface HttpResponse {
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
  }

  export const ERROR_STATUS: Readonly<Record<ErrorCode, number>>;

  export function jsonResponse(status: number, payload: unknown): HttpResponse;
  export function errorResponse(code: ErrorCode): HttpResponse;
  export function exitStatus(code: ErrorCode): number;
  ```
- notes: no HTTP server, no routing, no domain types. `jsonResponse` sets `content-type: application/json`; `errorResponse` yields `{"error":"<code>"}`; `exitStatus` maps `invalid_port` to process exit status 1.

### M-02 links-store
- responsibility: hold the in-memory set of Links, issue unique random codes, detect duplicate original URLs by exact string equality, count redirects and report Link statistics.
- covers: [url-shortener-api:INV-001, url-shortener-api:INV-002, url-shortener-api:CON-002]
- owns: src/links/**
- entry: src/links/index.ts
- depends_on: []
- public interface:
  ```ts
  export interface Link {
    readonly code: string;
    readonly url: string;
    readonly hits: number;
    readonly createdAt: Date;
  }

  export interface LinkStats {
    readonly code: string;
    readonly url: string;
    readonly hits: number;
    readonly createdAt: string;
  }

  export interface CreateLinkOutcome {
    readonly created: boolean;
    readonly link: Link;
  }

  export interface LinkStore {
    readonly byCode: Map<string, Link>;
    readonly byUrl: Map<string, string>;
  }

  export function openStore(): LinkStore;
  export function isValidOriginalUrl(value: unknown): boolean;
  export function createCode(): string;
  export function createLink(store: LinkStore, url: string): CreateLinkOutcome;
  export function findLink(store: LinkStore, code: string): Link | undefined;
  export function recordHit(store: LinkStore, code: string): Link | undefined;
  export function deleteLink(store: LinkStore, code: string): boolean;
  export function toStats(link: Link): LinkStats;
  ```
- notes: the store is plain memory, no file and no database; deletion removes both the code and the URL index entry so a deleted URL is a new URL on resubmission; code lookup is exact and case-sensitive; `toStats` renders `createdAt` with `Date#toISOString`.

### M-03 links-routes
- responsibility: serve `POST /links`, `GET /links/:code` and `DELETE /links/:code`, decoding the request body and mapping store outcomes to the coded HTTP responses.
- covers: [url-shortener-api:CTR-001, url-shortener-api:CTR-003, url-shortener-api:CTR-004, url-shortener-api:BEH-001, url-shortener-api:BEH-002, url-shortener-api:BEH-003, url-shortener-api:BEH-004, url-shortener-api:BEH-007, url-shortener-api:BEH-008, url-shortener-api:BEH-009, url-shortener-api:BEH-010, url-shortener-api:SCN-001, url-shortener-api:SCN-002, url-shortener-api:POL-002]
- owns: src/routes/links/**
- entry: src/routes/links/index.ts
- depends_on: [M-01, M-02]
- public interface:
  ```ts
  import type { HttpRequest, HttpResponse } from "../errors/index.js";
  import type { LinkStore } from "../links/index.js";

  export interface LinksRouteDeps {
    readonly store: LinkStore;
    readonly port: number;
  }

  export function routeLinks(request: HttpRequest, deps: LinksRouteDeps): HttpResponse | undefined;
  ```
- notes: returns `undefined` when the method/path pair is not one of its three members, which leaves dispatch to the composition root. Raises `invalid_json` for a body that does not parse or does not hold a `url` key of string type, `invalid_url` for a missing, non-string, relative or non-http/https `url`, `not_found` for an unknown code. `shortUrl` is `http://localhost:<deps.port>/<code>`. All parse and validation failures leave the store unchanged.

### M-04 redirect-route
- responsibility: serve `GET /:code`, answering `302` with the original URL in `Location` and counting one hit, or `404 not_found`.
- covers: [url-shortener-api:CTR-002, url-shortener-api:BEH-005, url-shortener-api:BEH-006, url-shortener-api:CON-003]
- owns: src/routes/redirect/**
- entry: src/routes/redirect/index.ts
- depends_on: [M-01, M-02]
- public interface:
  ```ts
  import type { HttpRequest, HttpResponse } from "../errors/index.js";
  import type { LinkStore } from "../links/index.js";

  export interface RedirectRouteDeps {
    readonly store: LinkStore;
  }

  export function routeRedirect(request: HttpRequest, deps: RedirectRouteDeps): HttpResponse | undefined;
  ```
- notes: handles only `GET` on a single non-empty path segment; returns `undefined` otherwise. The `302` response carries no body and no content-type; it never issues an outbound request and never inspects the original URL beyond storing it at creation.

### M-05 composition-root
- responsibility: read `PORT`, build the Node HTTP server, dispatch a request to the link routes, the redirect route or the `404` fallback, and start the listener.
- covers: [url-shortener-api:CTR-005, url-shortener-api:CTR-006, url-shortener-api:BEH-011, url-shortener-api:BEH-012, url-shortener-api:BEH-013, url-shortener-api:BEH-014, url-shortener-api:BEH-015, url-shortener-api:CON-001, url-shortener-api:NFR-001, url-shortener-api:GA-001, url-shortener-api:ED-001]
- owns: src/index.ts, src/config/**, src/server/**, tsconfig.build.json
- entry: src/index.ts
- depends_on: [M-01, M-02, M-03, M-04]
- public interface:
  ```ts
  import type { ErrorCode, HttpRequest, HttpResponse } from "./errors/index.js";
  import type { LinkStore } from "./links/index.js";

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

  export function resolvePort(env: Readonly<Record<string, string | undefined>>): PortResolution;
  export function createHandler(store: LinkStore, port: number): (request: HttpRequest) => HttpResponse;
  export function startServer(options: ServerOptions, store?: LinkStore): Promise<ServerHandle>;
  export function main(): Promise<void>;
  ```
- notes: `resolvePort` returns `invalid_port` for a value that is not an integer in 1..65535 and `3000` when `PORT` is absent or empty; `main` writes `invalid_port` to stderr and exits with status 1 before binding a port. `createHandler` builds the `HttpRequest` body from the raw request stream and answers the `404 not_found` fallback for every unmatched method/path pair. `startServer` accepts a programmatic `port` including `0` so a test can use an OS-assigned ephemeral port. The task also adds the `"start": "node build/index.js"` script to the foreman-scaffolded `package.json` and owns the emitting `tsconfig.build.json`.

## 3. Data shapes

```ts
// src/errors/index.ts — covers: url-shortener-api:POL-001, url-shortener-api:INV-003
export type ErrorCode = "invalid_url" | "invalid_json" | "not_found" | "invalid_port";
```

```ts
// src/errors/index.ts — covers: url-shortener-api:INV-003, url-shortener-api:INV-004
export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

// covers: url-shortener-api:CTR-005, url-shortener-api:BEH-011
export interface HttpRequest {
  readonly method: string;
  readonly path: string;
  readonly body: string;
}
```

```ts
// src/links/index.ts — covers: url-shortener-api:INV-001, url-shortener-api:INV-002
export interface Link {
  readonly code: string;
  readonly url: string;
  readonly hits: number;
  readonly createdAt: Date;
}

// covers: url-shortener-api:CTR-003, url-shortener-api:BEH-007
export interface LinkStats {
  readonly code: string;
  readonly url: string;
  readonly hits: number;
  readonly createdAt: string;
}
```

```ts
// src/links/index.ts — covers: url-shortener-api:CTR-001, url-shortener-api:BEH-002
export interface CreateLinkOutcome {
  readonly created: boolean;
  readonly link: Link;
}
```

```ts
// src/index.ts — covers: url-shortener-api:CTR-006, url-shortener-api:BEH-015
export type PortResolution =
  | { readonly ok: true; readonly port: number }
  | { readonly ok: false; readonly error: "invalid_port" };
```

## 4. Error mapping

| error code | raising module | exit code / HTTP status | stderr / body shape |
| --- | --- | --- | --- |
| `invalid_json` | M-03 links-routes | 400 | body `{"error":"invalid_json"}` |
| `invalid_url` | M-03 links-routes | 400 | body `{"error":"invalid_url"}` |
| `not_found` (unknown code on `GET /links/:code`, `DELETE /links/:code`) | M-03 links-routes | 404 | body `{"error":"not_found"}` |
| `not_found` (unknown code on `GET /:code`) | M-04 redirect-route | 404 | body `{"error":"not_found"}` |
| `not_found` (unmatched method or path) | M-05 composition-root | 404 | body `{"error":"not_found"}` |
| `invalid_port` | M-05 composition-root | exit status 1 | stderr `invalid_port` |

Every body above is JSON with exactly one `error` field (POL-001, INV-003). No error code outside this table exists.

## 5. Process and IO boundaries

- Process entry: `node build/index.js` through `npm start` after `npm run build`; the build output directory is `build/`, produced by `tsc -p tsconfig.build.json` (GA-001, CON-001).
- argv: none; extra argv is ignored. stdin: unused. stdout: nothing. stderr: the single line `invalid_port` on startup misconfiguration.
- Environment: `PORT` (ED-001), read once at startup. Absent or empty means `3000`; a value that is not an integer in 1..65535 means startup fails with `invalid_port` and exit status 1 (BEH-014, BEH-015). Programmatic `startServer({ port: 0 })` binds an OS-assigned ephemeral port and reports the chosen port on `ServerHandle.port` (BEH-013).
- Listen host: `127.0.0.1` unless `ServerOptions.host` is given (DD-07).
- Routes and methods: `POST /links` (JSON body, 201/200/400), `GET /:code` (302/404), `GET /links/:code` (200/404), `DELETE /links/:code` (204/404); every other method/path pair answers `404 not_found` (CTR-005, BEH-012).
- Path matching: the request path is split on `/`; a leading `/` is required, empty segments other than the leading one make the request unmatched, and a trailing slash makes it unmatched. Code segments are compared byte-for-byte (case-sensitive).
- Request body: read as UTF-8 text with no size cap defined by the spec; `POST /links` parses it with `JSON.parse`. Any parse failure, including an empty body, is `invalid_json` (BEH-004). No other route reads the body.
- Response encoding: JSON bodies are UTF-8 with `content-type: application/json` (INV-004). The `302` carries only `location` set to the stored original URL, no body. The `204` carries no body and no content-type. `shortUrl` is always `http://localhost:<configured port>/<code>` regardless of the request Host header (BEH-001, BEH-013).
- Concurrency: one Node event loop; store operations are synchronous, so a request observes the store either before or after another request, never inside one (BEH-005, BEH-009).
- No outbound network call is made while serving any request (CON-003).

## 6. TD-TOOLING

```yaml
TD-TOOLING:
  node: "22"
  test_cmd: "npx vitest run"
  typecheck_cmd: "npx tsc --noEmit"
  dependencies: []
  dev_dependencies: ["typescript@7.0.2", "vitest@5.0.5", "@types/node@26.6.6"]
  tsconfig: { module: NodeNext, moduleResolution: NodeNext, target: ES2022, strict: true, noEmit: true }
```

## 7. Design decisions

DD-01 platform and HTTP stack
- evidence: [url-shortener-api:CON-001, url-shortener-api:NFR-001, url-shortener-api:GA-001]
- decision: implement the server on the Node.js built-in `node:http` module with no runtime dependency, TypeScript in strict ES-module mode, and a separate emitting `tsconfig.build.json` for `npm run build`.
- alternatives_rejected: an HTTP framework such as express (adds a runtime dependency the spec does not name); a hand-written socket server (reimplements HTTP parsing and keep-alive).
- consequence: routing, body reading and status/header writing are ours and live in M-03, M-04 and M-05; `npm start` runs the compiled output from `build/`.

DD-02 in-memory store
- evidence: [url-shortener-api:INV-001, url-shortener-api:CON-002, url-shortener-api:BEH-009]
- decision: keep two `Map`s per store instance, code to `Link` and original URL to code; no file, database or external datastore is opened anywhere.
- alternatives_rejected: an on-disk store (violates INV-001 and CON-002); caching layers (adds state that could outlive the process).
- consequence: a restart yields an empty state; tests can open several independent stores in one process.

DD-03 code generation
- evidence: [url-shortener-api:INV-002, url-shortener-api:ASM-002, url-shortener-api:BEH-001]
- decision: draw 6 characters uniformly from `[a-zA-Z0-9]` with `crypto.randomInt` and retry while the code exists in the store.
- alternatives_rejected: a base-62 counter (predictable codes, rejected by OQ-002's default); a hash of the URL (collisions unhandled, code shape not guaranteed).
- consequence: codes are unguessable and independent of creation order; a collision costs one extra draw.

DD-04 duplicate detection by exact string
- evidence: [url-shortener-api:BEH-002, url-shortener-api:ASM-003]
- decision: the URL index key is the submitted URL string exactly as decoded from JSON; no normalization of case, trailing slash or default port.
- alternatives_rejected: normalized comparison (merges cosmetically different URLs and can merge distinct ones); ignoring duplicates (violates BEH-002).
- consequence: `https://example.com` and `https://example.com/` are two Links with two codes.

DD-05 deleted URLs are forgotten
- evidence: [url-shortener-api:BEH-009, url-shortener-api:ASM-004]
- decision: `DELETE /links/:code` removes both map entries, so resubmitting the same URL answers `201` with a newly issued code.
- alternatives_rejected: keeping a tombstone URL index (contradicts forgetting the Link and would answer `200` with an unreachable code).
- consequence: deletion is durable for that code; a later resubmission is indistinguishable from a first submission.

DD-06 unmatched method and path share the 404 fallback
- evidence: [url-shortener-api:BEH-011, url-shortener-api:BEH-012, url-shortener-api:ASM-005, url-shortener-api:CTR-005]
- decision: no `405` and no `Allow` header exist; any method/path pair no route module claims is answered `404` with `not_found` by the composition root.
- alternatives_rejected: `405` for known paths with unsupported methods (introduces a status and code the spec does not define).
- consequence: the fallback is the single last branch of dispatch and never masks a claimed route.

DD-07 listen host and port validation
- evidence: [url-shortener-api:BEH-013, url-shortener-api:BEH-014, url-shortener-api:ED-001]
- decision: `PORT` is read once; empty means `3000`; a non-integer or an integer outside 1..65535 is `invalid_port`; the listener binds `127.0.0.1` unless a caller passes another host, and a programmatic `port: 0` is accepted to request an OS-assigned ephemeral port.
- alternatives_rejected: binding `0.0.0.0` (exposes the service beyond the local machine for no spec benefit); silently defaulting on a bad `PORT` (rejected by OQ-006's default); refusing `0` (would force tests onto fixed ports with race-prone free-port probing).
- consequence: startup misconfiguration is visible immediately, and tests can start servers in-process on ephemeral ports.

DD-08 shortUrl is literal localhost with the configured port
- evidence: [url-shortener-api:BEH-001, url-shortener-api:BEH-013, url-shortener-api:ASM-001]
- decision: build `shortUrl` from the constant host `localhost` and the port the process was configured with; the request Host header is never consulted.
- alternatives_rejected: reflecting the Host header (rejected by OQ-001's default; makes responses caller-dependent).
- consequence: `shortUrl` is identical for every caller; two servers on different ports produce different values.

DD-09 one response encoder for JSON and errors
- evidence: [url-shortener-api:POL-001, url-shortener-api:INV-003, url-shortener-api:INV-004, url-shortener-api:CTR-005]
- decision: M-01 owns `jsonResponse` and `errorResponse`; every JSON response is produced by them, `errorResponse` always emits exactly `{"error":"<code>"}`, and the `302`/`204` responses are built inline without those helpers.
- alternatives_rejected: per-route ad hoc response objects (drift in content-type and error body shape); a shared helper that also handles redirects (would need to special-case the no-body rule at every call site anyway).
- consequence: the error taxonomy and the JSON content type have one enforcement point.

DD-10 case-sensitive code lookup
- evidence: [url-shortener-api:ASM-007, url-shortener-api:INV-002]
- decision: the code index is keyed by the exact issued string, so `AbC123` and `abc123` are different codes.
- alternatives_rejected: case folding (shrinks the code space and lets a code redirect under a string that was never issued).
- consequence: `GET /Abc123` answers `404` unless that exact code was issued.

DD-11 startup failure path
- evidence: [url-shortener-api:BEH-015, url-shortener-api:CTR-006, url-shortener-api:ASM-006]
- decision: `main` validates `PORT` before creating a listener, writes `invalid_port` to stderr and sets the process exit status to 1 through the `exitStatus` map of M-01.
- alternatives_rejected: throwing an uncaught error (adds a Node stack trace to stderr and an uncontrolled status); binding first and closing later (may expose a listener for a misconfiguration).
- consequence: a misconfigured start leaves no listening socket and no lingering process.

## 8. Traceability

| spec id | module |
| --- | --- |
| url-shortener-api:CTR-001 | M-03 |
| url-shortener-api:CTR-002 | M-04 |
| url-shortener-api:CTR-003 | M-03 |
| url-shortener-api:CTR-004 | M-03 |
| url-shortener-api:CTR-005 | M-05 |
| url-shortener-api:CTR-006 | M-05 |
| url-shortener-api:BEH-001 | M-03 |
| url-shortener-api:BEH-002 | M-03 |
| url-shortener-api:BEH-003 | M-03 |
| url-shortener-api:BEH-004 | M-03 |
| url-shortener-api:BEH-005 | M-04 |
| url-shortener-api:BEH-006 | M-04 |
| url-shortener-api:BEH-007 | M-03 |
| url-shortener-api:BEH-008 | M-03 |
| url-shortener-api:BEH-009 | M-03 |
| url-shortener-api:BEH-010 | M-03 |
| url-shortener-api:BEH-011 | M-05 |
| url-shortener-api:BEH-012 | M-05 |
| url-shortener-api:BEH-013 | M-05 |
| url-shortener-api:BEH-014 | M-05 |
| url-shortener-api:BEH-015 | M-05 |
| url-shortener-api:SCN-001 | M-03 |
| url-shortener-api:SCN-002 | M-03 |
| url-shortener-api:INV-001 | M-02 |
| url-shortener-api:INV-002 | M-02 |
| url-shortener-api:INV-003 | M-01 |
| url-shortener-api:INV-004 | M-01 |
| url-shortener-api:NFR-001 | M-05 |
| url-shortener-api:POL-001 | M-01 |
| url-shortener-api:POL-002 | M-03 |
| url-shortener-api:CON-001 | M-05 |
| url-shortener-api:CON-002 | M-02 |
| url-shortener-api:CON-003 | M-04 |
| url-shortener-api:ED-001 | M-05 |
| url-shortener-api:GA-001 | M-05 |

## 9. Revisions

none
