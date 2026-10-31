# Technical design: room-booking-api

## 1. Overview

roomy is a single-process HTTP API that listens on one TCP port taken from the `PORT` environment variable (default 3000) and is started with `npm start` after `npm run build`. It creates and lists rooms, creates, lists and deletes bookings, filters rooms by capacity, lists the bookings of one room inside a `from`/`to` window, and lists the rooms free for a requested interval. All state lives in process memory and is lost when the process stops. Every response is JSON with `Content-Type: application/json` except the bodiless 204, every unsuccessful response carries a stable snake_case `error` code, and the product has no runtime dependency and opens no outbound connection.

## 2. Module map

### M-01 errors
- responsibility: Defines the stable error codes, their HTTP statuses and the JSON error body that every other module returns.
- covers: [room-booking-api:POL-001]
- owns: src/errors/**
- entry: src/errors/index.ts
- depends_on: []
- public interface:
  ```ts
  export type ErrorCode =
    | "invalid_json"
    | "not_found"
    | "method_not_allowed"
    | "invalid_room"
    | "room_name_taken"
    | "invalid_query"
    | "room_not_found"
    | "invalid_booking"
    | "over_capacity"
    | "room_busy"
    | "booking_not_found";

  export interface ApiError {
    readonly code: ErrorCode;
    readonly conflictingBookingId?: string;
  }

  export type Result<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: ApiError };

  export function ok<T>(value: T): Result<T>;
  export function fail(error: ApiError): Result<never>;
  export function statusFor(code: ErrorCode): number;
  export function errorBody(error: ApiError): Record<string, string>;
  ```
- notes: no state; `statusFor` maps invalid_json/invalid_room/invalid_query/invalid_booking to 400, not_found/room_not_found/booking_not_found to 404, method_not_allowed to 405, room_name_taken/room_busy to 409, over_capacity to 422; `errorBody` emits `error` first and `conflictingBookingId` second when present (POL-001). This module never raises an error itself; it is the single home of the code vocabulary and of the `Result` contract every handler returns (DD-02).

### M-02 domain
- responsibility: Holds the rooms and bookings of the running process, assigns their ids and enforces id order, capacity and non-overlap, together with the strict time form and the half-open overlap predicate every handler uses.
- covers: [room-booking-api:INV-001, room-booking-api:INV-002, room-booking-api:INV-003, room-booking-api:INV-004]
- owns: src/domain/**
- entry: src/domain/index.ts
- depends_on: []
- public interface:
  ```ts
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

  export interface BookingFields {
    readonly title: string;
    readonly start: string;
    readonly end: string;
    readonly attendees: number;
  }

  export interface Store {
    readonly rooms: Room[];
    readonly bookings: Booking[];
    roomSeq: number;
    bookingSeq: number;
  }

  export function createStore(): Store;
  export function addRoom(store: Store, name: string, capacity: number): Room;
  export function addBooking(store: Store, roomId: string, fields: BookingFields): Booking;
  export function removeBooking(store: Store, bookingId: string): boolean;
  export function findRoom(store: Store, roomId: string): Room | undefined;
  export function parseTime(value: string): string | undefined;
  export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean;
  export function compareIds(a: string, b: string): number;
  ```
- notes: holds in-memory state only, created by `main` and never at module level (DD-09); `roomSeq` and `bookingSeq` only increase, so `addRoom` returns `r<n>` and `addBooking` returns `b<n>` in creation order across all rooms and a removed id is never reused (INV-001, INV-002). `rooms` is never removed from the array, so it stays in creation order. `addRoom` appends without a uniqueness check and `addBooking` appends without a conflict or capacity check: those decisions belong to the handlers, which read `store.rooms` and `store.bookings` and call `overlaps` (INV-003, INV-004 are enforced by M-03/M-04 through these exports). `parseTime` returns the value unchanged when it matches the strict UTC minute form and `undefined` otherwise (DD-03); `overlaps` is the half-open predicate `aStart < bEnd && bStart < aEnd`, so touching intervals do not overlap.

### M-03 rooms
- responsibility: Serves `POST /rooms` and `GET /rooms`, validating the room body, the case-insensitive name uniqueness and the `minCapacity` filter.
- covers: [room-booking-api:BEH-001, room-booking-api:BEH-002, room-booking-api:BEH-003, room-booking-api:BEH-004, room-booking-api:BEH-005, room-booking-api:CTR-002, room-booking-api:CTR-003]
- owns: src/rooms/**
- entry: src/rooms/index.ts
- depends_on: [M-01, M-02]
- public interface:
  ```ts
  import type { Result } from "../errors/index.js";
  import type { Room, Store } from "../domain/index.js";

  export function createRoom(store: Store, body: Record<string, unknown>): Result<Room>;
  export function listRooms(store: Store, query: URLSearchParams): Result<{ rooms: Room[] }>;
  ```
- notes: raises invalid_room (400) and room_name_taken (409) from `createRoom` and invalid_query (400) from `listRooms`. `createRoom` trims `name`, rejects an empty or whitespace-only name, a name longer than 40 UTF-16 code units, a non-string name, and a capacity that is not an integer in 1..100 (ASM-001, ASM-002); it compares the trimmed name with every stored name using `toLowerCase()` and answers room_name_taken before appending (BEH-003). Unknown body fields are ignored (ASM-003). `listRooms` returns every room in creation order and keeps only rooms with `capacity >= minCapacity` when `minCapacity` is present and a positive decimal integer, otherwise invalid_query; an unknown query parameter is ignored (DD-06).

### M-04 booking-writes
- responsibility: Serves `POST /rooms/:roomId/bookings` and `DELETE /bookings/:bookingId`, validating the booking body, the room existence, the capacity and the room conflict.
- covers: [room-booking-api:BEH-006, room-booking-api:BEH-007, room-booking-api:BEH-008, room-booking-api:BEH-009, room-booking-api:BEH-010, room-booking-api:BEH-011, room-booking-api:BEH-015, room-booking-api:BEH-016, room-booking-api:SCN-001, room-booking-api:SCN-002, room-booking-api:CTR-004, room-booking-api:CTR-006]
- owns: src/booking-writes/**
- entry: src/booking-writes/index.ts
- depends_on: [M-01, M-02]
- public interface:
  ```ts
  import type { Result } from "../errors/index.js";
  import type { Booking, Store } from "../domain/index.js";

  export function createBooking(
    store: Store,
    roomId: string,
    body: Record<string, unknown>,
  ): Result<Booking>;
  export function deleteBooking(store: Store, bookingId: string): Result<null>;
  ```
- notes: raises room_not_found (404), invalid_booking (400), over_capacity (422), room_busy (409) with `conflictingBookingId`, and booking_not_found (404). `createBooking` checks the room first, then the fields (trimmed non-empty title of at most 80 UTF-16 code units, both times in the strict form, `end` strictly after `start`, duration at most 8 hours inclusive, attendees an integer of at least 1), then the capacity, then the conflict (DD-05, DD-15); it appends through `addBooking` only when all checks pass, so a rejected request changes no state. `deleteBooking` removes a known booking and answers `{ ok: true, value: null }` (204), or booking_not_found.

### M-05 booking-reads
- responsibility: Serves `GET /rooms/:roomId/bookings` and `GET /availability`, ordering the results and validating the window and availability parameters.
- covers: [room-booking-api:BEH-012, room-booking-api:BEH-013, room-booking-api:BEH-014, room-booking-api:BEH-017, room-booking-api:BEH-018, room-booking-api:CTR-005, room-booking-api:CTR-007]
- owns: src/booking-reads/**
- entry: src/booking-reads/index.ts
- depends_on: [M-01, M-02]
- public interface:
  ```ts
  import type { Result } from "../errors/index.js";
  import type { Booking, Room, Store } from "../domain/index.js";

  export function listBookings(
    store: Store,
    roomId: string,
    query: URLSearchParams,
  ): Result<{ bookings: Booking[] }>;
  export function listAvailability(
    store: Store,
    query: URLSearchParams,
  ): Result<{ rooms: Room[] }>;
  ```
- notes: raises room_not_found (404) and invalid_query (400). `listBookings` checks the room, then the window: `from` and `to` are both present or both absent, both in the strict time form, `to` strictly after `from`; the result holds the room's bookings overlapping `[from, to)` (or all of them without a window) sorted by `start` then by `compareIds`. `listAvailability` requires all of `start`, `end` and `attendees`, validates them, and returns every room whose capacity is at least `attendees` and which has no booking overlapping `[start, end)`, sorted by capacity ascending then by `compareIds`. Both return the contractual envelopes `{ bookings: [...] }` and `{ rooms: [...] }`.

### M-06 http
- responsibility: Is the composition root: reads `PORT`, parses the request target and body, dispatches to the route handlers, maps every `Result` to a response, and starts the server.
- covers: [room-booking-api:CTR-001, room-booking-api:BEH-019, room-booking-api:BEH-020, room-booking-api:BEH-021, room-booking-api:BEH-022, room-booking-api:INV-005, room-booking-api:SCN-003, room-booking-api:POL-002, room-booking-api:NFR-001, room-booking-api:CON-001, room-booking-api:CON-002, room-booking-api:CON-003, room-booking-api:CON-004, room-booking-api:CON-005, room-booking-api:CON-006]
- owns: src/index.ts, src/http/**
- entry: src/index.ts
- depends_on: [M-01, M-02, M-03, M-04, M-05]
- public interface:
  ```ts
  import type { Server } from "node:http";
  import type { Store } from "./domain/index.js";

  export function resolvePort(env: NodeJS.ProcessEnv): number;
  export function createServer(store: Store): Server;
  export function startServer(store: Store, port: number): Promise<Server>;
  export function main(env: NodeJS.ProcessEnv): Promise<Server>;
  ```
- notes: raises not_found (404) for an undeclared path, method_not_allowed (405) for an undeclared method on a declared path and invalid_json (400) for an unreadable or non-object body (BEH-019, BEH-020, BEH-021). `main` creates the single `Store`, resolves the port and listens; the module listens only when it is the process entry, so importing it for tests binds nothing (DD-10). Also owns `tsconfig.build.json` and the `build`, `start` and `test` entries of `package.json` (CON-001, CON-003, NFR-001, DD-14). All state is in the `Store` created by `main`, so a restarted process exposes no earlier room or booking and the first new room is `r1` (INV-005, SCN-003, CON-004).

## 3. Data shapes

```ts
// M-02 — covers: room-booking-api:INV-001, room-booking-api:CTR-002, room-booking-api:CTR-003
export interface Room {
  readonly id: string;
  readonly name: string;
  readonly capacity: number;
}

// M-02 — covers: room-booking-api:INV-002, room-booking-api:CTR-004, room-booking-api:CTR-005
export interface Booking {
  readonly id: string;
  readonly roomId: string;
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly attendees: number;
}

// M-02 — covers: room-booking-api:CTR-004
export interface BookingFields {
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly attendees: number;
}

// M-02 — covers: room-booking-api:INV-005
export interface Store {
  readonly rooms: Room[];
  readonly bookings: Booking[];
  roomSeq: number;
  bookingSeq: number;
}

// M-01 — covers: room-booking-api:POL-001
export type ErrorCode =
  | "invalid_json"
  | "not_found"
  | "method_not_allowed"
  | "invalid_room"
  | "room_name_taken"
  | "invalid_query"
  | "room_not_found"
  | "invalid_booking"
  | "over_capacity"
  | "room_busy"
  | "booking_not_found";

// M-01 — covers: room-booking-api:POL-001, room-booking-api:CTR-004
export interface ApiError {
  readonly code: ErrorCode;
  readonly conflictingBookingId?: string;
}

// M-01 — covers: room-booking-api:POL-002
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ApiError };

// M-05 — covers: room-booking-api:CTR-003, room-booking-api:CTR-007
export type RoomList = { rooms: Room[] };

// M-05 — covers: room-booking-api:CTR-005
export type BookingList = { bookings: Booking[] };
```

The JSON wire forms are these types unchanged: a room is `{"id","name","capacity"}`, a booking is `{"id","roomId","title","start","end","attendees"}`, a room list is `{"rooms":[...]}`, a booking list is `{"bookings":[...]}`, an error body is `{"error":"<code>"}` plus `"conflictingBookingId":"<id>"` for `room_busy` (CTR-002, CTR-003, CTR-004, CTR-005, CTR-006, CTR-007, POL-001).

## 4. Error mapping

| Error code | Raising module | HTTP status | Body shape |
|---|---|---|---|
| `invalid_json` | M-06 http | 400 | `{"error":"invalid_json"}` |
| `not_found` | M-06 http | 404 | `{"error":"not_found"}` |
| `method_not_allowed` | M-06 http | 405 | `{"error":"method_not_allowed"}` |
| `invalid_room` | M-03 rooms | 400 | `{"error":"invalid_room"}` |
| `room_name_taken` | M-03 rooms | 409 | `{"error":"room_name_taken"}` |
| `invalid_query` (`minCapacity`) | M-03 rooms | 400 | `{"error":"invalid_query"}` |
| `invalid_query` (`from`/`to`, `start`/`end`/`attendees`) | M-05 booking-reads | 400 | `{"error":"invalid_query"}` |
| `room_not_found` (`POST /rooms/:roomId/bookings`) | M-04 booking-writes | 404 | `{"error":"room_not_found"}` |
| `invalid_booking` | M-04 booking-writes | 400 | `{"error":"invalid_booking"}` |
| `over_capacity` | M-04 booking-writes | 422 | `{"error":"over_capacity"}` |
| `room_busy` | M-04 booking-writes | 409 | `{"error":"room_busy","conflictingBookingId":"b1"}` |
| `booking_not_found` | M-04 booking-writes | 404 | `{"error":"booking_not_found"}` |
| `room_not_found` (`GET /rooms/:roomId/bookings`) | M-05 booking-reads | 404 | `{"error":"room_not_found"}` |

Every row carries `Content-Type: application/json` (BEH-022); no row is a redirect and none carries plain text (POL-001). The taxonomy of the seven Contracts contains no other code. No taxonomy declares a 5xx status: the defensive catch of DD-02 answers 500 with an empty body and no code, and no documented input class reaches it (POL-002). The success statuses are 200 for every GET, 201 for both POST routes and 204 with no body for `DELETE /bookings/:bookingId` (CTR-002, CTR-003, CTR-004, CTR-005, CTR-006, CTR-007).

## 5. Process and IO boundaries

- Commands. `npm run build` runs `tsc -p tsconfig.build.json` and emits `dist/`; `npm test` runs `vitest run`; `npm start` runs `node dist/index.js`. The process takes no argv argument; `main(process.env)` reads only `PORT` (CTR-001, CON-003).
- Environment. `PORT` is optional, an integer in 1..65535, default `3000`; any other value resolves to 3000 (CTR-001, CON-006, DD-07). No other variable is read.
- Listen. `server.listen(port)` with no host argument, so the server accepts IPv4 and IPv6 clients on every interface, plain HTTP/1.1, no TLS. Tests pass port `0` and read the bound port from `server.address()` (CTR-001).
- Request target. Parsed with `new URL(req.url ?? "/", "http://localhost")`; `pathname` selects the route and `searchParams` carries `minCapacity`, `from`, `to`, `start`, `end` and `attendees`. Percent-decoding is the URL parser's.
- Routes. `POST /rooms` and `GET /rooms` (M-03); `POST /rooms/:roomId/bookings` and `GET /rooms/:roomId/bookings` (M-04, M-05); `DELETE /bookings/:bookingId` (M-04); `GET /availability` (M-05). Path matching is exact: a trailing slash, an extra segment or an undeclared path is `not_found`, and an undeclared method on a declared path is `method_not_allowed` (DD-08).
- Request body. Read as UTF-8 bytes and parsed with `JSON.parse` on the two POST routes only. An empty body, an unparsable body and valid JSON that is not an object answer `invalid_json` before any field validation; no request header is required and the request `Content-Type` is not inspected (ASM-010, BEH-019, DD-16).
- Response. `Content-Type: application/json` and a UTF-8 `JSON.stringify` body for every status except 204; 204 is written with `res.writeHead(204)` and `res.end()`, carrying neither body nor content type (BEH-022, DD-13).
- stdout/stderr. A served request writes nothing to stdout or stderr. A failure to bind the port writes one line to stderr and exits with code 1; SIGINT and SIGTERM end the process with the default signal status (CTR-001).
- Files. The process reads no file and writes no file at runtime; `dist/` exists only because the build wrote it (INV-005, CON-004).
- State. One `Store` per process, created in `main` and passed to the handlers; no module holds module-level mutable state (DD-09).

## 6. TD-TOOLING

```yaml
TD-TOOLING:
  node: "22"
  test_cmd: "npx vitest run"
  typecheck_cmd: "npx tsc --noEmit"
  dependencies: []
  dev_dependencies: ["typescript@5.6.3", "vitest@2.1.9", "@types/node@22.10.2"]
  tsconfig: { module: "NodeNext", moduleResolution: "NodeNext", target: "ES2022", strict: true, noEmit: true }
```

## 7. Design decisions

### DD-01 Plain `node:http` server, no runtime dependency
- evidence: [room-booking-api:CON-005, room-booking-api:CON-001, room-booking-api:CON-004]
- decision: the API is built on `node:http`, `node:url` and `node:net` only; `package.json` declares no runtime dependency and every import is either a relative module or a `node:` builtin.
- alternatives_rejected: express or fastify (CON-005 forbids a runtime dependency); a hand-written TCP parser (the builtin HTTP parser already delivers method, target, headers and body).
- consequence: routing, body reading, JSON serialisation and content types are written in M-06; nothing else in the product touches the socket.

### DD-02 Handlers return `Result<T>` and never throw
- evidence: [room-booking-api:POL-002, room-booking-api:POL-001, room-booking-api:CTR-004]
- decision: every handler module exports functions that return `Result<T>` (`{ok:true,value}` or `{ok:false,error}`); M-06 turns a `Result` into the status and body of the error table and never lets a documented input class reach an exception.
- alternatives_rejected: throwing typed errors and mapping them in a catch block (a missed catch becomes a 5xx); returning `T | ApiError` (indistinguishable when a value is itself an object with a `code` field).
- consequence: M-06 wraps each request in a try/catch whose only action is to write the throw to stderr and answer 500 with an empty body; that branch is unreachable for every documented input class.

### DD-03 Strict UTC minute form, compared as strings
- evidence: [room-booking-api:ASM-005, room-booking-api:ASM-006, room-booking-api:BEH-008, room-booking-api:BEH-011]
- decision: `parseTime` accepts a value only when it matches `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/` and `new Date(value)` round-trips to the same string, and returns the value unchanged; accepted times are compared with `<` as strings, which is chronological because the form is fixed width; `overlaps(aStart, aEnd, bStart, bEnd)` is `aStart < bEnd && bStart < aEnd`.
- alternatives_rejected: `Date.parse` alone (it accepts offsets and millisecond parts that ASM-005 rejects, and silently rolls impossible dates over); storing `Date` objects (the echoed booking body must repeat the accepted spelling).
- consequence: no timezone conversion happens anywhere and no `Date` object is stored; a query time follows the same form as a booking time (ASM-006).

### DD-04 Trimming, length in UTF-16 code units, case-insensitive names
- evidence: [room-booking-api:ASM-001, room-booking-api:ASM-002, room-booking-api:BEH-003]
- decision: `name` and `title` are trimmed before validation, the trimmed value is stored and echoed, a whitespace-only value is invalid, and the 40 and 80 bounds count `String.length`; name uniqueness compares trimmed values with `toLowerCase()`.
- alternatives_rejected: storing the untrimmed value (a name of spaces would be storable); counting Unicode code points (ASM-002 fixes UTF-16 code units).
- consequence: `" Aurora "` creates the room named `Aurora`, and `AURORA` then answers room_name_taken.

### DD-05 Fixed error precedence
- evidence: [room-booking-api:ASM-004, room-booking-api:POL-002]
- decision: the checks run in this order on every request: undeclared path (404 not_found), undeclared method (405 method_not_allowed), unknown room or booking (404), body parse (400 invalid_json), query parse (400 invalid_query), field validation (400 invalid_room or invalid_booking), capacity (422 over_capacity), name duplicate or interval conflict (409).
- alternatives_rejected: body validation before resource existence (ASM-004 rejects it).
- consequence: `POST /rooms/r99/bookings` with a bad title answers 404 room_not_found and a malformed body on an unknown room path answers 404 before 400.

### DD-06 Decimal-integer query parsing
- evidence: [room-booking-api:BEH-005, room-booking-api:BEH-018, room-booking-api:ASM-007, room-booking-api:CTR-003]
- decision: an integer query value must match `/^\d+$/` and then be at least 1 where the contract says positive (`minCapacity`, `attendees`); `""`, `" 4"`, `"+4"`, `"4.0"`, `"1e2"` and `"ten"` are invalid_query; a query parameter the contract does not declare is ignored, and an absent optional parameter means "no filter".
- alternatives_rejected: `Number(value)` (it accepts `1e2`, `0x10`, whitespace and the empty string); `parseInt` (it truncates `2.5` to 2).
- consequence: `minCapacity=41` answers 200 with an empty list while `minCapacity=0` answers 400 invalid_query.

### DD-07 PORT resolution and listen address
- evidence: [room-booking-api:CTR-001, room-booking-api:CON-006]
- decision: `resolvePort(env)` returns 3000 when `PORT` is absent, and otherwise the parsed value only when it matches `/^\d+$/` and lies in 1..65535, falling back to 3000 for anything else; the server listens with `server.listen(port)` and no host argument.
- alternatives_rejected: binding `127.0.0.1` only (a client resolving `localhost` to `::1` would be refused); exiting on an unparsable `PORT` (the contract fixes only the default, so the process keeps serving on it).
- consequence: tests reach the server through either `127.0.0.1` or `localhost`, and an ephemeral port `0` is accepted.

### DD-08 Declared route table with exact path matching
- evidence: [room-booking-api:ASM-009, room-booking-api:BEH-020, room-booking-api:BEH-021]
- decision: the router holds exactly four path patterns with their method sets — `/rooms` (POST, GET), `/rooms/:roomId/bookings` (POST, GET), `/bookings/:bookingId` (DELETE), `/availability` (GET); the query string is stripped before matching and segments are matched exactly, so a trailing slash, an empty segment or an extra segment is an undeclared path.
- alternatives_rejected: prefix matching (ASM-009 rejects it, since `GET /rooms/r1` must be 404); a router library (DD-01).
- consequence: `GET /bookings/b1` and `DELETE /rooms` answer 405, `GET /rooms/r1`, `GET /booking`, `DELETE /rooms/r1` and `/rooms/` answer 404.

### DD-09 One store per process, monotonic counters, no persistence
- evidence: [room-booking-api:INV-005, room-booking-api:INV-002, room-booking-api:CON-004, room-booking-api:SCN-003]
- decision: `main` calls `createStore()` once and passes the store to the handler closure; `roomSeq` and `bookingSeq` are counters that only increase, so deleting a booking leaves its id unused forever; nothing is written to disk and nothing is read at start.
- alternatives_rejected: a module-level singleton (two servers in one test process would share state and SCN-003 could not be observed); deriving the next id from the array length (a delete would reuse an id).
- consequence: after a restart the first room is `r1` and no earlier booking is reachable, while a booking created after a delete receives a fresh id.

### DD-10 No listen on import
- evidence: [room-booking-api:CTR-001, room-booking-api:NFR-001, room-booking-api:SCN-003]
- decision: `src/index.ts` exports `resolvePort`, `createServer`, `startServer` and `main`, and calls `main(process.env)` only when its own module file is the process entry (`process.argv[1]` resolves to `fileURLToPath(import.meta.url)`); `startServer(store, port)` resolves once the server emits `listening`.
- alternatives_rejected: listening on import (a test that imports the module would take port 3000 and two servers could not coexist in one process); a separate `serve.ts` entry (the composition root's entry must be the file tests import).
- consequence: tests start the server with `startServer(createStore(), 0)`, read the port from `server.address()` and close it afterwards.

### DD-11 Ordering rules
- evidence: [room-booking-api:BEH-004, room-booking-api:BEH-012, room-booking-api:BEH-017, room-booking-api:ASM-008]
- decision: rooms are listed in array order, which is creation order and therefore numeric id order because rooms are never removed; bookings are sorted by `start` as a string and then by `compareIds`, which compares the numeric suffix after the leading letter; availability is sorted by capacity ascending and then by `compareIds`.
- alternatives_rejected: lexicographic id order (ASM-008 rejects it, since `r10` must follow `r9`); sorting by creation time for bookings (BEH-012 fixes start order).
- consequence: `b10` follows `b9` and equal starts are broken by ascending booking number.

### DD-12 Conflict selection
- evidence: [room-booking-api:BEH-010, room-booking-api:ASM-011]
- decision: `conflictingBookingId` is the room's overlapping booking with the earliest `start` string and, among equal starts, the lowest `compareIds` order.
- alternatives_rejected: any overlapping booking (ASM-011 rejects a non-reproducible answer); the lowest id alone (the earliest start wins first).
- consequence: the same request always names the same conflicting booking.

### DD-13 Response writing
- evidence: [room-booking-api:BEH-022, room-booking-api:POL-001]
- decision: every response except 204 is written as `res.writeHead(status, { "Content-Type": "application/json" })` followed by `JSON.stringify(body)`; 204 is written as `res.writeHead(204)` and `res.end()` with no header and no body; an error body puts `error` first and `conflictingBookingId` second.
- alternatives_rejected: a charset parameter in the content type (BEH-022 names the value `application/json`); an empty 204 with a content type (BEH-022 forbids it).
- consequence: a client can parse every body as JSON and the 204 response has neither body nor content type.

### DD-14 Build, start and test commands
- evidence: [room-booking-api:CON-001, room-booking-api:CON-003, room-booking-api:NFR-001, room-booking-api:CTR-001]
- decision: `package.json` declares `"type": "module"`, `"build": "tsc -p tsconfig.build.json"`, `"test": "vitest run"` and `"start": "node dist/index.js"`; `tsconfig.build.json` extends `tsconfig.json` with `outDir: "dist"`, `rootDir: "src"`, `noEmit: false` and `include: ["src"]`, while `tsconfig.json` keeps `noEmit: true` over `src` and `tests`.
- alternatives_rejected: emitting from `tsconfig.json` (the typecheck would then also compile tests into `dist`); `tsx` or `ts-node` at start (CON-005 keeps the dependency list empty and CON-003 fixes `tsc` as the build).
- consequence: the compiled process entry is `dist/index.js` and the typecheck covers the tests as well.

### DD-15 Booking field limits
- evidence: [room-booking-api:BEH-008, room-booking-api:ASM-012, room-booking-api:CTR-004]
- decision: `end` must be strictly after `start`, the difference in milliseconds must be at most `8 * 60 * 60 * 1000`, `attendees` must be an integer of at least 1, and `title` must be non-empty after trimming with at most 80 UTF-16 code units; all four checks answer invalid_booking.
- alternatives_rejected: an exclusive 8-hour bound (ASM-012 fixes the inclusive one); comparing durations on formatted strings (a millisecond difference is the direct measure).
- consequence: 09:00 to 17:00 is accepted and 09:00 to 17:01 answers invalid_booking.

### DD-16 `invalid_json` only where a body is declared
- evidence: [room-booking-api:BEH-019, room-booking-api:ASM-010, room-booking-api:ASM-004, room-booking-api:CTR-003]
- decision: the body is read and parsed on `POST /rooms` and `POST /rooms/:roomId/bookings` only; the GET and DELETE routes never read a body, so the `invalid_json` row their taxonomy lists is not emitted on them; on a POST route an empty, unparsable or non-object body answers invalid_json before any field check.
- alternatives_rejected: parsing a body on every route (a GET body is not part of any contract); answering invalid_room or invalid_booking for a non-object body (ASM-010 fixes invalid_json).
- consequence: `[1,2,3]` on `POST /rooms` answers 400 invalid_json, and a stray body on `GET /rooms` is ignored.

## 8. Traceability

| Spec ID | Module |
|---|---|
| room-booking-api:BEH-001 | M-03 |
| room-booking-api:BEH-002 | M-03 |
| room-booking-api:BEH-003 | M-03 |
| room-booking-api:BEH-004 | M-03 |
| room-booking-api:BEH-005 | M-03 |
| room-booking-api:BEH-006 | M-04 |
| room-booking-api:BEH-007 | M-04 |
| room-booking-api:BEH-008 | M-04 |
| room-booking-api:BEH-009 | M-04 |
| room-booking-api:BEH-010 | M-04 |
| room-booking-api:BEH-011 | M-04 |
| room-booking-api:BEH-012 | M-05 |
| room-booking-api:BEH-013 | M-05 |
| room-booking-api:BEH-014 | M-05 |
| room-booking-api:BEH-015 | M-04 |
| room-booking-api:BEH-016 | M-04 |
| room-booking-api:BEH-017 | M-05 |
| room-booking-api:BEH-018 | M-05 |
| room-booking-api:BEH-019 | M-06 |
| room-booking-api:BEH-020 | M-06 |
| room-booking-api:BEH-021 | M-06 |
| room-booking-api:BEH-022 | M-06 |
| room-booking-api:SCN-001 | M-04 |
| room-booking-api:SCN-002 | M-04 |
| room-booking-api:SCN-003 | M-06 |
| room-booking-api:CTR-001 | M-06 |
| room-booking-api:CTR-002 | M-03 |
| room-booking-api:CTR-003 | M-03 |
| room-booking-api:CTR-004 | M-04 |
| room-booking-api:CTR-005 | M-05 |
| room-booking-api:CTR-006 | M-04 |
| room-booking-api:CTR-007 | M-05 |
| room-booking-api:INV-001 | M-02 |
| room-booking-api:INV-002 | M-02 |
| room-booking-api:INV-003 | M-02 |
| room-booking-api:INV-004 | M-02 |
| room-booking-api:INV-005 | M-06 |
| room-booking-api:NFR-001 | M-06 |
| room-booking-api:POL-001 | M-01 |
| room-booking-api:POL-002 | M-06 |
| room-booking-api:CON-001 | M-06 |
| room-booking-api:CON-002 | M-06 |
| room-booking-api:CON-003 | M-06 |
| room-booking-api:CON-004 | M-06 |
| room-booking-api:CON-005 | M-06 |
| room-booking-api:CON-006 | M-06 |

## 9. Revisions

none
