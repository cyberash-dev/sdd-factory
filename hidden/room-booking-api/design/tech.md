# Technical design: room-booking-api

## 1. Overview

`roomy` is a single-process TypeScript HTTP API built on `node:http` with no runtime dependency, serving six routes over an in-memory state of rooms and bookings. A client creates rooms and bookings, lists and filters both, deletes bookings and asks which rooms are free for a half-open interval. Every response with a body is JSON; every failure is a stable snake_case code in a JSON envelope. The process binds the port named by `PORT` (default `3000`) and loses its state when it stops.

## 2. Module map

### M-01 core
- responsibility: Holds the domain types, the error taxonomy with its status mapping, the accepted-time parser, the half-open overlap predicate, the text-length rule, the identifier format and the ordering keys shared by every other module.
- covers: [room-booking-api:CTR-007, room-booking-api:CTR-008, room-booking-api:CTR-009, room-booking-api:CTR-010, room-booking-api:INV-001, room-booking-api:INV-003, room-booking-api:POL-001]
- owns: src/core/**
- entry: src/core/index.ts
- depends_on: []
- public interface:
  ```ts
  export type ErrorCode =
    | "invalid_json"
    | "invalid_query"
    | "invalid_room"
    | "invalid_booking"
    | "not_found"
    | "method_not_allowed"
    | "room_not_found"
    | "booking_not_found"
    | "room_name_taken"
    | "room_busy"
    | "over_capacity";

  export interface ApiError {
    readonly error: ErrorCode;
    readonly conflictingBookingId?: string;
  }

  export interface Room {
    readonly id: string;
    readonly name: string;
    readonly capacity: number;
  }

  export interface Booking {
    readonly id: string;
    readonly roomId: string;
    readonly title: string;
    readonly start: string;
    readonly end: string;
    readonly attendees: number;
  }

  export const LIMITS: {
    readonly roomNameMax: number;
    readonly bookingTitleMax: number;
    readonly capacityMin: number;
    readonly capacityMax: number;
    readonly bookingMaxMinutes: number;
  };

  export function statusOf(code: ErrorCode): number;
  export function isApiError(value: unknown): value is ApiError;
  export function parseTime(value: unknown): number | null;
  export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean;
  export function formatId(kind: "room" | "booking", sequence: number): string;
  export function idNumber(id: string): number;
  export function isValidText(value: unknown, maxLength: number): boolean;
  ```
- notes: `LIMITS` is `{ roomNameMax: 40, bookingTitleMax: 80, capacityMin: 1, capacityMax: 100, bookingMaxMinutes: 480 }`. `statusOf` maps `invalid_json`, `invalid_query`, `invalid_room`, `invalid_booking` to 400, `not_found`, `room_not_found`, `booking_not_found` to 404, `method_not_allowed` to 405, `room_name_taken`, `room_busy` to 409 and `over_capacity` to 422 (DD-02). `parseTime` accepts only a string of the shape `YYYY-MM-DDTHH:MM:00Z` whose calendar fields are valid and returns epoch milliseconds, otherwise `null`; the accepted string is its own canonical form and is what the stores keep (DD-06). `overlaps` is the half-open predicate `aStart < bEnd && bStart < aEnd`. `formatId` returns `r<n>` or `b<n>`; `idNumber` returns `n` from an `r<n>` or `b<n>` string (DD-04). `isValidText` accepts a string that is not empty after `trim()`, whose code-point count is at most `maxLength` (DD-09). No state, no IO.

### M-02 http
- responsibility: Turns a `node:http` request into a `RouteContext`, dispatches it against the injected route table and writes the JSON envelope, including the 404 `not_found`, 405 `method_not_allowed` and 400 `invalid_json` answers.
- covers: [room-booking-api:BEH-021, room-booking-api:BEH-022, room-booking-api:BEH-023, room-booking-api:BEH-024, room-booking-api:POL-002]
- owns: src/http/**
- entry: src/http/index.ts
- depends_on: [M-01]
- public interface:
  ```ts
  import type { IncomingMessage, ServerResponse } from "node:http";
  import type { ApiError } from "../core/index.js";

  export interface RouteContext {
    readonly params: Readonly<Record<string, string>>;
    readonly query: URLSearchParams;
    readonly body: unknown;
  }

  export type RouteResult =
    | { readonly kind: "ok"; readonly status: number; readonly body?: unknown }
    | { readonly kind: "error"; readonly error: ApiError };

  export interface Route {
    readonly method: "GET" | "POST" | "DELETE";
    readonly path: string;
    readonly handle: (context: RouteContext) => RouteResult;
  }

  export function createRouter(
    routes: readonly Route[],
  ): (request: IncomingMessage, response: ServerResponse) => void;
  ```
- notes: `path` is a pattern whose literal segments must match exactly and whose `:name` segments are captured into `params`. The router parses the request line first: for a `POST` it reads the whole body as UTF-8 and runs `JSON.parse`, answering 400 `invalid_json` when the body is empty or not JSON; other methods ignore the body. It then matches the path on segment count and literal segments: no route with that path answers 404 `not_found`, a matching path without a matching method answers 405 `method_not_allowed`. A successful `RouteResult` of `kind: "ok"` sets `status` and, when `body` is present, writes `JSON.stringify(body)` with `Content-Type: application/json`; `status` 204 writes no body and no content type. A result of `kind: "error"` writes `statusOf(error.error)` and the `ApiError` object as the body. The router adds no catch-all status: no error code exists for an internal fault (DD-13). The route table is injected so that this module imports nothing but `M-01` (DD-08).

### M-03 rooms
- responsibility: Owns the room collection: validates a room body, keeps names unique case-insensitively, assigns `r<n>` identifiers and answers the room list with its optional `minCapacity` filter and id order.
- covers: [room-booking-api:CTR-001, room-booking-api:CTR-002, room-booking-api:BEH-001, room-booking-api:BEH-002, room-booking-api:BEH-003, room-booking-api:BEH-004, room-booking-api:BEH-005, room-booking-api:BEH-006, room-booking-api:BEH-007, room-booking-api:INV-005]
- owns: src/rooms/**
- entry: src/rooms/index.ts
- depends_on: [M-01]
- public interface:
  ```ts
  import type { URLSearchParams } from "node:url";
  import type { ApiError, Room } from "../core/index.js";

  export interface RoomStore {
    readonly rooms: Room[];
    nextSequence: number;
  }

  export function createRoomStore(): RoomStore;
  export function createRoom(store: RoomStore, body: unknown): Room | ApiError;
  export function listRooms(store: RoomStore, query: URLSearchParams): Room[] | ApiError;
  ```
- notes: `createRoom` reads `name` and `capacity` from the body object and returns `{ error: "invalid_room" }` when either fails `isValidText(name, LIMITS.roomNameMax)` or `Number.isInteger(capacity) && capacity >= LIMITS.capacityMin && capacity <= LIMITS.capacityMax`; it answers `{ error: "room_name_taken" }` when another room's name is equal after `toLowerCase()` on both sides, and otherwise appends `{ id: formatId("room", ++store.nextSequence), name, capacity }` and returns it, storing the name exactly as sent (DD-05). `listRooms` rejects a present `minCapacity` that is not `/^[0-9]+$/` with a value of at least 1 with `{ error: "invalid_query" }` and otherwise returns the matching rooms sorted by `idNumber(id)` ascending (DD-04). Unknown body properties and unknown query parameters are ignored.

### M-04 bookings
- responsibility: Owns the booking collection: validates a booking body and its time interval, enforces room existence, capacity and the no-overlap invariant, assigns `b<n>` identifiers, and answers the room booking list and the booking deletion.
- covers: [room-booking-api:CTR-003, room-booking-api:CTR-004, room-booking-api:CTR-005, room-booking-api:BEH-008, room-booking-api:BEH-009, room-booking-api:BEH-010, room-booking-api:BEH-011, room-booking-api:BEH-012, room-booking-api:BEH-013, room-booking-api:BEH-014, room-booking-api:BEH-015, room-booking-api:BEH-016, room-booking-api:BEH-017, room-booking-api:BEH-018, room-booking-api:INV-002]
- owns: src/bookings/**
- entry: src/bookings/index.ts
- depends_on: [M-01]
- public interface:
  ```ts
  import type { URLSearchParams } from "node:url";
  import type { ApiError, Booking, Room } from "../core/index.js";

  export interface BookingStore {
    readonly bookings: Booking[];
    nextSequence: number;
  }

  export function createBookingStore(): BookingStore;
  export function createBooking(
    store: BookingStore,
    rooms: readonly Room[],
    roomId: string,
    body: unknown,
  ): Booking | ApiError;
  export function listBookings(
    store: BookingStore,
    rooms: readonly Room[],
    roomId: string,
    query: URLSearchParams,
  ): Booking[] | ApiError;
  export function deleteBooking(store: BookingStore, bookingId: string): ApiError | null;
  ```
- notes: `createBooking` evaluates in the order of DD-07: the room must exist in `rooms` (`{ error: "room_not_found" }`), then the body must carry a valid `title`, two accepted times whose difference is positive and at most `LIMITS.bookingMaxMinutes` minutes and an integer `attendees` of at least 1 (`{ error: "invalid_booking" }`), then `attendees` must not exceed the room capacity (`{ error: "over_capacity" }`), then no booking of that room may overlap the interval, the earliest-starting one, ties broken by `idNumber`, naming the conflict (`{ error: "room_busy", conflictingBookingId }`) (DD-11). `listBookings` answers `{ error: "room_not_found" }` for an unknown room, `{ error: "invalid_query" }` when exactly one of `from` and `to` is present or a present pair is unparseable or not increasing, and otherwise the room's bookings overlapping `[from, to)` sorted by `parseTime(start)` then `idNumber(id)`. `deleteBooking` removes the booking and returns `null`, or returns `{ error: "booking_not_found" }` when no booking carries the id.

### M-05 availability
- responsibility: Computes the free rooms for an interval and an attendee count from a room list and a booking list, with its own query validation and ordering.
- covers: [room-booking-api:CTR-006, room-booking-api:BEH-019, room-booking-api:BEH-020]
- owns: src/availability/**
- entry: src/availability/index.ts
- depends_on: [M-01]
- public interface:
  ```ts
  import type { URLSearchParams } from "node:url";
  import type { ApiError, Booking, Room } from "../core/index.js";

  export function findAvailableRooms(
    rooms: readonly Room[],
    bookings: readonly Booking[],
    query: URLSearchParams,
  ): Room[] | ApiError;
  ```
- notes: `start`, `end` and `attendees` are all required; a missing parameter, a `parseTime` result of `null`, an `attendees` value outside `/^[0-9]+$/` or below 1, and an `end` not after `start` all yield `{ error: "invalid_query" }` (DD-14). The result keeps every room whose capacity is at least `attendees` and for which no booking of that room overlaps `[start, end)`, ordered by capacity ascending then `idNumber(id)` ascending. The module holds no state.

### M-06 root
- responsibility: The composition root: reads the port, builds the stores, assembles the six-route table from the domain modules, creates the router and owns the process entry.
- covers: [room-booking-api:CTR-011, room-booking-api:INV-004, room-booking-api:CON-001, room-booking-api:CON-002, room-booking-api:CON-003]
- owns: src/index.ts, src/main.ts, tsconfig.build.json, package.json
- entry: src/index.ts
- depends_on: [M-01, M-02, M-03, M-04, M-05]
- public interface:
  ```ts
  import type { IncomingMessage, ServerResponse } from "node:http";
  import type { Route } from "./http/index.js";

  export interface RunningServer {
    readonly port: number;
    readonly close: () => Promise<void>;
  }

  export function resolvePort(env: Record<string, string | undefined>): number;
  export function createRequestHandler(): (request: IncomingMessage, response: ServerResponse) => void;
  export function startServer(port?: number): Promise<RunningServer>;
  ```
- notes: `createRequestHandler` builds one `RoomStore` and one `BookingStore` per call and one route table for `POST /rooms`, `GET /rooms`, `POST /rooms/:roomId/bookings`, `GET /rooms/:roomId/bookings`, `DELETE /bookings/:bookingId` and `GET /availability`; each adapter calls the owning module with `store.rooms` as the room list, converts a `Room`, `Booking`, `Room[]` or `Booking[]` value into `{ kind: "ok", status, body }` (201 for the two creations, 200 for the three lists, 204 with no body for the deletion) and an `ApiError` into `{ kind: "error" }` using `isApiError`. `resolvePort` returns the `PORT` value when it is `/^[0-9]+$/` and at most 65535, otherwise 3000 (DD-10). `startServer` binds `port` (0 selects an ephemeral port) on all interfaces, resolves with the bound port and a `close` that stops accepting connections and resolves; `src/main.ts` is the runnable entry and calls `startServer()`. The stores are plain in-memory arrays, so state never leaves the process (DD-03). This module performs no outbound network call and imports only Node builtins and the other five modules.

## 3. Data shapes

```ts
// covers: room-booking-api:CTR-007
export interface Room {
  readonly id: string;
  readonly name: string;
  readonly capacity: number;
}

// covers: room-booking-api:CTR-008
export interface Booking {
  readonly id: string;
  readonly roomId: string;
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly attendees: number;
}

// covers: room-booking-api:CTR-010, room-booking-api:INV-003, room-booking-api:POL-001
export type ErrorCode =
  | "invalid_json"
  | "invalid_query"
  | "invalid_room"
  | "invalid_booking"
  | "not_found"
  | "method_not_allowed"
  | "room_not_found"
  | "booking_not_found"
  | "room_name_taken"
  | "room_busy"
  | "over_capacity";

export interface ApiError {
  readonly error: ErrorCode;
  readonly conflictingBookingId?: string;
}

// covers: room-booking-api:BEH-022, room-booking-api:BEH-023
export type RouteResult =
  | { readonly kind: "ok"; readonly status: number; readonly body?: unknown }
  | { readonly kind: "error"; readonly error: ApiError };

export interface RouteContext {
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly body: unknown;
}

export interface Route {
  readonly method: "GET" | "POST" | "DELETE";
  readonly path: string;
  readonly handle: (context: RouteContext) => RouteResult;
}

// covers: room-booking-api:INV-001, room-booking-api:INV-005
export interface RoomStore {
  readonly rooms: Room[];
  nextSequence: number;
}

// covers: room-booking-api:INV-001, room-booking-api:INV-002
export interface BookingStore {
  readonly bookings: Booking[];
  nextSequence: number;
}

// covers: room-booking-api:CTR-011
export interface RunningServer {
  readonly port: number;
  readonly close: () => Promise<void>;
}
```

`Room`, `Booking`, `ErrorCode`, `ApiError` live in `M-01` and are imported from `src/core/index.js`; `RouteResult`, `RouteContext`, `Route` live in `M-02` and are imported from `src/http/index.js`; `RoomStore` lives in `M-03`, `BookingStore` in `M-04` and `RunningServer` in `M-06`. No module redeclares a shape another module exports.

## 4. Error mapping

| error code | raising module | status | response body |
| --- | --- | --- | --- |
| `invalid_json` | M-02 http | 400 | `{"error":"invalid_json"}` |
| `invalid_query` | M-03 rooms, M-04 bookings, M-05 availability | 400 | `{"error":"invalid_query"}` |
| `invalid_room` | M-03 rooms | 400 | `{"error":"invalid_room"}` |
| `invalid_booking` | M-04 bookings | 400 | `{"error":"invalid_booking"}` |
| `not_found` | M-02 http | 404 | `{"error":"not_found"}` |
| `room_not_found` | M-04 bookings | 404 | `{"error":"room_not_found"}` |
| `booking_not_found` | M-04 bookings | 404 | `{"error":"booking_not_found"}` |
| `method_not_allowed` | M-02 http | 405 | `{"error":"method_not_allowed"}` |
| `room_name_taken` | M-03 rooms | 409 | `{"error":"room_name_taken"}` |
| `room_busy` | M-04 bookings | 409 | `{"error":"room_busy","conflictingBookingId":"<booking id>"}` |
| `over_capacity` | M-04 bookings | 422 | `{"error":"over_capacity"}` |

Success statuses: `POST /rooms` and `POST /rooms/:roomId/bookings` answer 201 with the created object, `GET /rooms`, `GET /rooms/:roomId/bookings` and `GET /availability` answer 200 with `{ "rooms": [...] }` or `{ "bookings": [...] }`, and `DELETE /bookings/:bookingId` answers 204 with no body. Every body-carrying response sets `Content-Type: application/json`; `conflictingBookingId` appears on `room_busy` only (DD-02, DD-11).

## 5. Process and IO boundaries

- Boundary: HTTP/1.1 over TCP, `node:http`, no TLS, no authentication, no path prefix.
- Listener: `server.listen(port)` with the host argument omitted, so Node binds all interfaces; `port` of 0 selects an ephemeral port, which `startServer` reports in `RunningServer.port`.
- Port source: the environment variable `PORT`; `resolvePort` returns it when it matches `/^[0-9]+$/` and is at most 65535, and returns 3000 when it is unset or does not match. An explicit `startServer(port)` argument wins over the environment.
- Routes: `POST /rooms`, `GET /rooms`, `POST /rooms/:roomId/bookings`, `GET /rooms/:roomId/bookings`, `DELETE /bookings/:bookingId`, `GET /availability`. The path is split on `/`; one empty leading segment is dropped and no trailing empty segment is trimmed, so `/rooms/` matches no route and answers 404 `not_found` (DD-12). Query strings are parsed with `URLSearchParams`; unknown parameters are ignored.
- Request body: read to end as UTF-8 on `POST` and parsed with `JSON.parse`; an empty or unparseable body answers 400 `invalid_json`; the request `Content-Type` header is not inspected. `GET` and `DELETE` carry no body.
- Response: JSON via `JSON.stringify`, header `content-type: application/json` exactly, no charset parameter; 204 sends no body and no content type.
- Concurrency: one event loop, every handler is synchronous, so each request observes and mutates the state atomically; reads are strongly consistent.
- Files: the product reads and writes no file; the only file inputs are the TypeScript sources and `tsconfig.build.json` at build time.
- Standard streams: `src/main.ts` writes nothing to stdout or stderr; a failed listen rejects and the process exits with code 1. There is no stdin use and no signal handling beyond Node's default.
- Build and start: `npm run build` runs `tsc -p tsconfig.build.json` into `dist/`, `npm start` runs `node dist/main.js`, `npm test` runs `vitest run` (DD-10).
- Outbound network: none; every response is computed from the in-memory state (CON-001).

## 6. TD-TOOLING

```yaml
TD-TOOLING:
  node: "22"
  test_cmd: "npx vitest run"
  typecheck_cmd: "npx tsc --noEmit"
  dependencies: []
  dev_dependencies: ["typescript@7.0.2", "vitest@5.0.5", "@types/node@26.6.6", "agent-sdd@2.1.1"]
  tsconfig: { module: NodeNext, moduleResolution: NodeNext, target: ES2022, strict: true, noEmit: true, types: ["node"] }
```

`agent-sdd@2.1.1` is the factory command line interface already pinned in the bootstrap `package.json`; it stays pinned so the bootstrap manifest is not narrowed. No product runtime dependency is added (CON-002).

## 7. Design decisions

### DD-01 HTTP served by node:http
- evidence: [room-booking-api:CON-002, room-booking-api:CTR-011]
- decision: The server is built on `node:http` with `createServer` and a plain request listener; no framework, router package or validation library is installed.
- alternatives_rejected: an HTTP framework (adds a runtime dependency CON-002 forbids); a hand-written TCP/HTTP layer (reimplements Node builtins).
- consequence: Routing, body reading and JSON writing are product code in `M-02` and `M-06`; the runtime dependency list stays empty.

### DD-02 Error code to HTTP status mapping
- evidence: [room-booking-api:CTR-010, room-booking-api:POL-001, room-booking-api:INV-003]
- decision: `statusOf` in `M-01` is the single mapping: the four 400 codes, the three 404 codes, 405 for `method_not_allowed`, 409 for `room_name_taken` and `room_busy`, and 422 for `over_capacity`. `ApiError` carries `error` and, only for `room_busy`, `conflictingBookingId`; serialising it produces the whole response body.
- alternatives_rejected: a status field on each error object (two places to keep consistent); a per-route status table (the same code would map differently per route).
- consequence: every writer of an error constructs an `ApiError` and the boundary derives the status; no code outside the CTR-010 taxonomy exists, and no 500 is produced.

### DD-03 In-memory state as arrays with sequence counters
- evidence: [room-booking-api:INV-004, room-booking-api:INV-001]
- decision: `RoomStore` and `BookingStore` are objects holding a mutable array and a monotonic `nextSequence`; a fresh pair is created per `createRequestHandler` call and never persisted.
- alternatives_rejected: a process-wide module-level store (leaks state between tests and between handler instances); file persistence (out of scope and CON-001).
- consequence: a restart starts empty, each test gets isolated state, and identifiers continue from the counter without scanning the array.

### DD-04 Identifier format and ordering
- evidence: [room-booking-api:INV-001, room-booking-api:BEH-005, room-booking-api:BEH-013, room-booking-api:ASM-004]
- decision: `formatId("room", n)` yields `r<n>` and `formatId("booking", n)` yields `b<n>` from the store counter; `idNumber` parses the digits and every order by id compares `idNumber` numerically.
- alternatives_rejected: lexicographic comparison (puts `r10` before `r9`); zero padding (changes the documented identifier shape).
- consequence: creation order and id order coincide past the ninth record, and ties on a shared start break by creation order.

### DD-05 Room name comparison
- evidence: [room-booking-api:INV-005, room-booking-api:BEH-004, room-booking-api:ASM-001]
- decision: a name is stored exactly as sent; two names are duplicates when `a.toLowerCase() === b.toLowerCase()`.
- alternatives_rejected: storing the lower-cased name (GET /rooms would echo a name the client never sent); `localeCompare` with a locale (locale-dependent duplicates).
- consequence: `GET /rooms` echoes the client spelling and only case-differing names collide.

### DD-06 Time validation and the stored representation
- evidence: [room-booking-api:CTR-009, room-booking-api:ASM-008, room-booking-api:BEH-010]
- decision: `parseTime` accepts a string matching `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/` whose calendar fields are real, verified by comparing `new Date(value).toISOString()` with the input; it returns epoch milliseconds or `null`. The booking stores the accepted string unchanged, and query times pass through the same function, so the whole-minute rule holds on every route.
- alternatives_rejected: `Date.parse` alone (accepts `+02:00` offsets, fractional seconds and impossible dates); a date library (runtime dependency); re-serialising through `toISOString` (would accept non-canonical input).
- consequence: a non-UTC offset, a seconds part other than `00`, a fractional second or an impossible date is rejected at the boundary as `invalid_booking` or `invalid_query`, and stored and emitted times are identical.

### DD-07 Error precedence inside a booking creation
- evidence: [room-booking-api:BEH-009, room-booking-api:BEH-010, room-booking-api:BEH-011, room-booking-api:BEH-012, room-booking-api:ASM-002]
- decision: the router parses the body first (`invalid_json`), then the route matches (`not_found`, `method_not_allowed`), then the room is looked up (`room_not_found`), then the body is validated (`invalid_booking`), then capacity is checked (`over_capacity`), then the conflict is looked up (`room_busy`).
- alternatives_rejected: validating the body before the room lookup (a request with an unknown room and a bad title would answer `invalid_booking`, contradicting ASM-002's evaluation order).
- consequence: a request breaking several rules reports exactly one code in this order on every body-accepting route.

### DD-08 Route table injected into the router
- evidence: [room-booking-api:CTR-001, room-booking-api:BEH-022]
- decision: `M-02` owns request parsing, matching and response writing but receives `Route[]` from `M-06`; the six adapters that call the domain modules live in the composition root.
- alternatives_rejected: letting the router import the domain modules (that edge would make the longest dependency chain `root -> http -> bookings -> core`, four modules, and the planner cannot cut the four modules back after merging along `depends_on`); one module holding the router and the stores (it would cover more than sixteen spec records).
- consequence: `M-02`, `M-03`, `M-04`, `M-05` are four parallel lanes at one level below the root, and `M-06` is the only module with edges to all others.

### DD-09 Text limits, emptiness and unknown members
- evidence: [room-booking-api:ASM-003, room-booking-api:ASM-006, room-booking-api:ASM-007, room-booking-api:BEH-002, room-booking-api:BEH-010]
- decision: length is counted in Unicode code points (`[...value].length`); a value that is empty after `trim()` is invalid; unknown body properties and unknown query parameters are ignored.
- alternatives_rejected: `String.prototype.length` (counts UTF-16 units, rejecting 40 emoji); rejecting unknown members (turns a field typo into a different error code).
- consequence: a 40-code-point name and an 80-code-point title are accepted, a whitespace-only value is rejected, and extra members are discarded.

### DD-10 Build, start and port resolution
- evidence: [room-booking-api:CON-003, room-booking-api:CTR-011]
- decision: the product keeps `tsconfig.json` for type-checking `src` and `tests` and a separate `tsconfig.build.json` with `outDir: "dist"`, `rootDir: "src"`, `noEmit: false` and `include: ["src"]`, owned by `M-06`; the root task adds `"start": "node dist/main.js"` to `package.json`; `src/main.ts` calls `startServer()` and writes nothing.
- alternatives_rejected: running TypeScript directly with a loader (CON-003 names a compile step); auto-starting from `src/index.ts` on import (tests import the module and would bind a port).
- consequence: `npm run build` emits `dist/index.js` and `dist/main.js`, `npm start` serves the routes, `PORT` reaches the listener through `resolvePort`, and importing `src/index.ts` never binds a socket.

### DD-11 Conflict selection and the conflicting booking id
- evidence: [room-booking-api:BEH-012, room-booking-api:ASM-005, room-booking-api:POL-001]
- decision: among the room's bookings that overlap the requested interval, `M-04` selects the smallest `parseTime(start)` and breaks ties with the smallest `idNumber`, and names it in `conflictingBookingId`.
- alternatives_rejected: the first stored match (dependent on insertion order and on deletions); omitting the field (POL-001 makes it mandatory for `room_busy`).
- consequence: `room_busy` is deterministic for a given state and its body carries exactly one extra field.

### DD-12 Route matching
- evidence: [room-booking-api:BEH-022, room-booking-api:BEH-023, room-booking-api:BEH-024]
- decision: the router splits the path on `/`, drops one leading empty segment, keeps every other segment and compares segment count and literal segments; `:name` segments capture. A path with no route of that shape answers 404 `not_found`, a path with a route of another method answers 405 `method_not_allowed`.
- alternatives_rejected: a regular-expression table per route (harder to keep disjoint); trimming trailing slashes (an undocumented alias).
- consequence: `GET /rooms/r1` and `GET /bookings` answer 404, `DELETE /rooms` and `PUT /rooms/r1/bookings` answer 405, `/rooms/` answers 404, and the no-method-match answer is never 404.

### DD-13 No internal-failure status
- evidence: [room-booking-api:POL-002, room-booking-api:INV-003, room-booking-api:CTR-010]
- decision: the router and the domain modules validate every input before use and the router installs no catch-all that would answer a status outside the taxonomy; a defect therefore surfaces as an unhandled rejection instead of an invented code.
- alternatives_rejected: answering 500 with a synthetic code (violates CTR-010, which forbids any other status on a documented route); answering 400 for an internal fault (reports a client error for a server defect).
- consequence: POL-002 is met by validation at the boundary; the contract tests never observe an undocumented code.

### DD-14 Availability computation
- evidence: [room-booking-api:BEH-019, room-booking-api:BEH-020, room-booking-api:ASM-004]
- decision: `M-05` receives the room array and the booking array, keeps rooms with `capacity >= attendees` and no overlapping booking, and sorts by capacity ascending then `idNumber` ascending.
- alternatives_rejected: computing availability inside `M-04` (would need the room list and the whole booking list and extend the coverage of one module); sorting by id only (BEH-019 names capacity first).
- consequence: the module is stateless and pure, and availability reflects deletions immediately because it reads the current arrays.

## 8. Traceability

| spec id | module |
| --- | --- |
| room-booking-api:CTR-001 | M-03 |
| room-booking-api:CTR-002 | M-03 |
| room-booking-api:CTR-003 | M-04 |
| room-booking-api:CTR-004 | M-04 |
| room-booking-api:CTR-005 | M-04 |
| room-booking-api:CTR-006 | M-05 |
| room-booking-api:CTR-007 | M-01 |
| room-booking-api:CTR-008 | M-01 |
| room-booking-api:CTR-009 | M-01 |
| room-booking-api:CTR-010 | M-01 |
| room-booking-api:CTR-011 | M-06 |
| room-booking-api:BEH-001 | M-03 |
| room-booking-api:BEH-002 | M-03 |
| room-booking-api:BEH-003 | M-03 |
| room-booking-api:BEH-004 | M-03 |
| room-booking-api:BEH-005 | M-03 |
| room-booking-api:BEH-006 | M-03 |
| room-booking-api:BEH-007 | M-03 |
| room-booking-api:BEH-008 | M-04 |
| room-booking-api:BEH-009 | M-04 |
| room-booking-api:BEH-010 | M-04 |
| room-booking-api:BEH-011 | M-04 |
| room-booking-api:BEH-012 | M-04 |
| room-booking-api:BEH-013 | M-04 |
| room-booking-api:BEH-014 | M-04 |
| room-booking-api:BEH-015 | M-04 |
| room-booking-api:BEH-016 | M-04 |
| room-booking-api:BEH-017 | M-04 |
| room-booking-api:BEH-018 | M-04 |
| room-booking-api:BEH-019 | M-05 |
| room-booking-api:BEH-020 | M-05 |
| room-booking-api:BEH-021 | M-02 |
| room-booking-api:BEH-022 | M-02 |
| room-booking-api:BEH-023 | M-02 |
| room-booking-api:BEH-024 | M-02 |
| room-booking-api:INV-001 | M-01 |
| room-booking-api:INV-002 | M-04 |
| room-booking-api:INV-003 | M-01 |
| room-booking-api:INV-004 | M-06 |
| room-booking-api:INV-005 | M-03 |
| room-booking-api:POL-001 | M-01 |
| room-booking-api:POL-002 | M-02 |
| room-booking-api:CON-001 | M-06 |
| room-booking-api:CON-002 | M-06 |
| room-booking-api:CON-003 | M-06 |

## 9. Revisions

none
