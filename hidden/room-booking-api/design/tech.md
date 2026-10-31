# Technical design: room-booking-api

## 1. Overview

`roomy` is an in-memory HTTP API, served by one Node.js process, that manages meeting rooms and their bookings and is reached only over HTTP; there is no other interface, no persistence and no authentication. A request enters at a single Node `http` server, is routed to one of five declared endpoints, is validated at that boundary, and is answered with a JSON body carrying either an entity, a list or a stable snake_case error code. All state lives in a monotonic in-memory store that a new process starts empty. The process listens on the port named by `PORT` (default `3000`) and starts with `npm start` after `npm run build`. Every response except the `204` of `DELETE /bookings/:bookingId` carries `Content-Type: application/json`.

## 2. Module map

### M-01 errors
- responsibility: Own the closed set of error codes, the code-to-status mapping and the JSON response value object.
- covers: [room-booking-api:INV-004, room-booking-api:INV-005, room-booking-api:POL-001]
- owns: src/errors/**
- entry: src/errors/index.ts
- depends_on: []
- public interface:
  ```ts
  export type ErrorCode =
    | "invalid_json"
    | "invalid_room"
    | "room_name_taken"
    | "invalid_query"
    | "room_not_found"
    | "invalid_booking"
    | "over_capacity"
    | "room_busy"
    | "booking_not_found"
    | "not_found"
    | "method_not_allowed";

  export interface ApiError {
    readonly code: ErrorCode;
    readonly status: number;
    readonly conflictingBookingId?: string;
  }

  export interface ApiResponse {
    readonly status: number;
    readonly body?: unknown;
  }

  export function apiError(code: ErrorCode, conflictingBookingId?: string): ApiError;

  export function errorBody(error: ApiError): {
    error: ErrorCode;
    conflictingBookingId?: string;
  };

  export function errorResponse(error: ApiError): ApiResponse;

  export function jsonResponse(status: number, body: unknown): ApiResponse;

  export const JSON_CONTENT_TYPE = "application/json";
  ```
- notes: Code-to-status pairs: invalid_json 400, invalid_room 400, room_name_taken 409, invalid_query 400, room_not_found 404, invalid_booking 400, over_capacity 422, room_busy 409, booking_not_found 404, not_found 404, method_not_allowed 405. `errorBody` emits `conflictingBookingId` only for `room_busy`. `JSON_CONTENT_TYPE` is the single literal every response header uses.

### M-02 core
- responsibility: Hold the entity shapes, the monotonic in-memory store and the shared time, overlap, ordering and JSON-body primitives.
- covers: [room-booking-api:INV-001, room-booking-api:INV-002, room-booking-api:INV-003, room-booking-api:INV-006, room-booking-api:INV-007, room-booking-api:INV-008, room-booking-api:SCN-003]
- owns: src/core/**
- entry: src/core/index.ts
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

  export interface Interval {
    readonly startMs: number;
    readonly endMs: number;
  }

  export interface NewBooking {
    readonly roomId: string;
    readonly title: string;
    readonly start: string;
    readonly end: string;
    readonly startMs: number;
    readonly endMs: number;
    readonly attendees: number;
  }

  export interface Store {
    listRooms(minCapacity: number | null): Room[];
    findRoom(roomId: string): Room | null;
    roomNameTaken(name: string): boolean;
    addRoom(name: string, capacity: number): Room;
    listBookings(roomId: string, window: Interval | null): Booking[];
    addBooking(input: NewBooking): Booking;
    findBooking(bookingId: string): Booking | null;
    deleteBooking(bookingId: string): Booking | null;
    earliestConflict(roomId: string, interval: Interval): Booking | null;
    availableRooms(window: Interval, attendees: number): Room[];
  }

  export function createStore(): Store;

  export function parseTime(value: string): number | null;

  export function intervalsOverlap(a: Interval, b: Interval): boolean;

  export type ParsedBody =
    | { readonly kind: "empty" }
    | { readonly kind: "invalid" }
    | { readonly kind: "value"; readonly value: unknown };

  export function parseJsonBody(raw: string): ParsedBody;
  ```
- notes: `createStore` keeps two counters: the number of rooms created (room ids `r<N+1>`) and the highest booking id handed out (booking ids `b<N+1>`, global across rooms); neither counter decreases when an entity is deleted, so no id is ever reused. `listRooms` orders by the integer suffix of the id, ascending, and keeps rooms whose capacity is at least `minCapacity` when one is given. `listBookings` orders by `start` ascending then by the integer suffix of the id, keeps only bookings overlapping the half-open `window` when one is given, and keeps every booking of the room otherwise. `addBooking` stores the `start` and `end` strings exactly as given and never re-derives them, so a returned time is the spelling the requester sent. `earliestConflict` returns the overlapping booking of that room with the smallest `start` and, on equal `start`, the smallest integer id suffix. `availableRooms` keeps rooms whose capacity is at least `attendees` and which have no booking overlapping `window`, ordered by capacity ascending then id suffix. `parseTime` accepts only a whole-minute UTC string with an upper-case `Z` suffix in the forms `YYYY-MM-DDTHH:MMZ`, `YYYY-MM-DDTHH:MM:00Z` and `YYYY-MM-DDTHH:MM:00.000Z`, rejects any other spellings and non-calendar dates, and returns epoch milliseconds. `intervalsOverlap` implements the half-open rule `a.startMs < b.endMs && b.startMs < a.endMs`. `parseJsonBody` returns `empty` only for a zero-length body, `invalid` when `JSON.parse` throws, and `value` otherwise.

### M-03 routes/rooms
- responsibility: Serve `POST /rooms` and `GET /rooms`.
- covers: [room-booking-api:BEH-001, room-booking-api:BEH-002, room-booking-api:BEH-003, room-booking-api:BEH-004, room-booking-api:BEH-005, room-booking-api:BEH-006, room-booking-api:CTR-001, room-booking-api:CTR-002]
- owns: src/routes/rooms/**
- entry: src/routes/rooms/index.ts
- depends_on: [M-01, M-02]
- public interface:
  ```ts
  import type { ApiResponse } from "../../errors/index.js";
  import type { ParsedBody, Store } from "../../core/index.js";

  export function handleCreateRoom(store: Store, body: ParsedBody): ApiResponse;

  export function handleListRooms(
    store: Store,
    query: URLSearchParams,
    body: ParsedBody,
  ): ApiResponse;
  ```
- notes: `handleCreateRoom` answers in this fixed order (its contract's `code_precedence` with the body-level prerequisite first): `invalid_json` when the body is `invalid`; `invalid_room` when the body is `empty`, is not a non-null non-array object, carries a `name` that is not a string of length 1..40, or a `capacity` that is not an integer in 1..100 (the store is untouched); `room_name_taken` when `store.roomNameTaken(name)` reports a name equal under `toLowerCase`, otherwise `201` with the created room. `handleListRooms` validates the query first: a `minCapacity` present and not matching `/^[1-9][0-9]*$/` is `invalid_query`; then an `invalid` body is `invalid_json`; otherwise `200` with `{ rooms: store.listRooms(minCapacity) }`. `query.get` returns the first occurrence of a repeated parameter. Response bodies carry only the fields of `Room` or the `rooms` array.

### M-04 routes/booking-create
- responsibility: Serve `POST /rooms/:roomId/bookings`.
- covers: [room-booking-api:BEH-007, room-booking-api:BEH-008, room-booking-api:BEH-009, room-booking-api:BEH-010, room-booking-api:BEH-011, room-booking-api:BEH-012, room-booking-api:CTR-003, room-booking-api:SCN-002]
- owns: src/routes/booking-create/**
- entry: src/routes/booking-create/index.ts
- depends_on: [M-01, M-02]
- public interface:
  ```ts
  import type { ApiResponse } from "../../errors/index.js";
  import type { ParsedBody, Store } from "../../core/index.js";

  export function handleCreateBooking(
    store: Store,
    roomId: string,
    body: ParsedBody,
  ): ApiResponse;
  ```
- notes: Resolution order is fixed: `room_not_found` (404) when `store.findRoom(roomId)` is null, before the body is looked at; then `invalid_json` (400) when the body is `invalid`; then `invalid_booking` (400) when the body is `empty`, is not a non-null non-array object, carries a `title` that is not a string of length 1..80, a `start` or `end` that `parseTime` rejects, an `end` not after `start`, a duration above 28 800 000 ms, or an `attendees` that is not an integer of at least 1; then `over_capacity` (422) when `attendees` exceeds `room.capacity`; then `room_busy` (409) with `conflictingBookingId` set to the id of `store.earliestConflict(...)`; otherwise `201` with `store.addBooking(...)`. No step before a successful `addBooking` writes to the store.

### M-05 routes/booking-query
- responsibility: Serve `GET /rooms/:roomId/bookings` and `DELETE /bookings/:bookingId`.
- covers: [room-booking-api:BEH-013, room-booking-api:BEH-014, room-booking-api:BEH-015, room-booking-api:BEH-016, room-booking-api:BEH-017, room-booking-api:CTR-004, room-booking-api:CTR-005, room-booking-api:SCN-001]
- owns: src/routes/booking-query/**
- entry: src/routes/booking-query/index.ts
- depends_on: [M-01, M-02]
- public interface:
  ```ts
  import type { ApiResponse } from "../../errors/index.js";
  import type { ParsedBody, Store } from "../../core/index.js";

  export function handleListBookings(
    store: Store,
    roomId: string,
    query: URLSearchParams,
    body: ParsedBody,
  ): ApiResponse;

  export function handleDeleteBooking(
    store: Store,
    bookingId: string,
    body: ParsedBody,
  ): ApiResponse;
  ```
- notes: `handleListBookings` validates the window first: `from` and `to` must be both absent or both present, each must parse through `parseTime`, and `to` must be after `from`, otherwise `invalid_query` (400) even for an unknown room; then an unknown room is `room_not_found` (404); then an `invalid` body is `invalid_json` (400); otherwise `200` with `{ bookings: store.listBookings(roomId, window) }` where `window` is null when no window was given. `handleDeleteBooking` answers `booking_not_found` (404) when `store.findBooking(bookingId)` is null, then `invalid_json` (400) when the body is `invalid`, otherwise removes the booking with `store.deleteBooking` and answers `204` with no body.

### M-06 routes/availability
- responsibility: Serve `GET /availability`.
- covers: [room-booking-api:BEH-018, room-booking-api:BEH-019, room-booking-api:CTR-006]
- owns: src/routes/availability/**
- entry: src/routes/availability/index.ts
- depends_on: [M-01, M-02]
- public interface:
  ```ts
  import type { ApiResponse } from "../../errors/index.js";
  import type { ParsedBody, Store } from "../../core/index.js";

  export function handleAvailability(
    store: Store,
    query: URLSearchParams,
    body: ParsedBody,
  ): ApiResponse;
  ```
- notes: `invalid_query` (400) when `start`, `end` or `attendees` is missing, when `start` or `end` fails `parseTime`, when `end` is not after `start`, or when `attendees` does not match `/^-?[0-9]+(\.[0-9]+)?$/` or does not denote an integer; then `invalid_json` (400) for an `invalid` body; otherwise `200` with `{ rooms: store.availableRooms(window, attendees) }`. No request to this route produces a response without a body.

### M-07 server
- responsibility: Compose the process: parse the request target, read the raw body, route by path and method, call the route module and serialise its `ApiResponse`.
- covers: [room-booking-api:BEH-020, room-booking-api:BEH-021, room-booking-api:CTR-007, room-booking-api:POL-002, room-booking-api:CON-001, room-booking-api:CON-002, room-booking-api:NFR-001, room-booking-api:IB-001, room-booking-api:LOC-001]
- owns: src/server/**, src/index.ts, tsconfig.build.json
- entry: src/server/index.ts
- depends_on: [M-01, M-02, M-03, M-04, M-05, M-06]
- public interface:
  ```ts
  import type { Server } from "node:http";
  import type { ApiResponse } from "../errors/index.js";
  import type { Store } from "../core/index.js";

  export interface RunningServer {
    readonly port: number;
    readonly url: string;
    close(): Promise<void>;
  }

  export function createServer(store: Store): Server;

  export function startServer(port: number): Promise<RunningServer>;
  ```
- notes: `createServer` matches the path against exactly `/rooms`, `/availability`, `/rooms/<roomId>/bookings` and `/bookings/<bookingId>` on segments split at `/` with no percent-decoding and no trailing-slash tolerance; any other path is undeclared. Resolution is: when the path is undeclared, `invalid_json` (400) if the body is `invalid`, otherwise `not_found` (404); when the path is declared but its method is not one of the endpoint's declared methods, `invalid_json` (400) when the body is `invalid` otherwise `method_not_allowed` (405); otherwise the matching route function. Every `ApiResponse` is written with `JSON_CONTENT_TYPE` and the body serialised by `JSON.stringify`, except a response whose `body` is `undefined` (the `204`), which is sent with the status alone, no `Content-Type` and no body. Route functions do not throw for a documented failure, and the handler wraps the routing call in a `try`/`catch` so that an unexpected exception still produces a response from the closed code set: the catch answers `not_found` with status `404` and no connection is left without a response. `src/index.ts` is the process entry, is not imported by tests, reads `PORT`, and calls `startServer`. The module also owns `tsconfig.build.json` (`rootDir` `src`, `outDir` `dist`, `noEmit` false) and sets the `start` script of `package.json` to `node dist/index.js`.

## 3. Data shapes

Room object, exactly three keys; the store and every response body share it.
```ts
export interface Room {
  readonly id: string;
  readonly name: string;
  readonly capacity: number;
}
```
covers: room-booking-api:INV-007, room-booking-api:CTR-001, room-booking-api:CTR-002, room-booking-api:CTR-006

Booking object, exactly six keys; `start` and `end` are the UTC strings the requester supplied.
```ts
export interface Booking {
  readonly id: string;
  readonly roomId: string;
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly attendees: number;
}
```
covers: room-booking-api:INV-007, room-booking-api:INV-008, room-booking-api:CTR-003, room-booking-api:CTR-004

List bodies, each carrying exactly one array key.
```ts
export interface RoomListBody {
  readonly rooms: Room[];
}

export interface BookingListBody {
  readonly bookings: Booking[];
}
```
covers: room-booking-api:INV-007, room-booking-api:CTR-002, room-booking-api:CTR-004, room-booking-api:CTR-006

Error body, `conflictingBookingId` present only for `room_busy`; `ErrorCode` is the union exported by M-01.
```ts
import type { ErrorCode } from "../errors/index.js";

export interface ErrorBody {
  readonly error: ErrorCode;
  readonly conflictingBookingId?: string;
}
```
covers: room-booking-api:INV-004, room-booking-api:POL-001

Half-open interval in epoch milliseconds, the only representation used for comparisons.
```ts
export interface Interval {
  readonly startMs: number;
  readonly endMs: number;
}
```
covers: room-booking-api:INV-003, room-booking-api:BEH-011, room-booking-api:BEH-014, room-booking-api:BEH-018

Result of parsing a request body once, at the server boundary, and handing it to a route.
```ts
export type ParsedBody =
  | { readonly kind: "empty" }
  | { readonly kind: "invalid" }
  | { readonly kind: "value"; readonly value: unknown };
```
covers: room-booking-api:CTR-001, room-booking-api:CTR-003, room-booking-api:CTR-007, room-booking-api:BEH-009

Resolved response value object returned by every route function; this is the `ApiResponse` type exported by M-01, imported by every consumer.
```ts
export interface ApiResponse {
  readonly status: number;
  readonly body?: unknown;
}
```
covers: room-booking-api:INV-005, room-booking-api:INV-007

Addition draft used to create a booking, carrying both the requester's strings and the parsed milliseconds.
```ts
export interface NewBooking {
  readonly roomId: string;
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly attendees: number;
}
```
covers: room-booking-api:INV-002, room-booking-api:INV-008, room-booking-api:BEH-007

## 4. Error mapping

| error code | raising module(s) | HTTP status | body shape |
|---|---|---|---|
| invalid_json | M-03, M-04, M-05, M-06, M-07 | 400 | `{"error":"invalid_json"}` |
| invalid_room | M-03 | 400 | `{"error":"invalid_room"}` |
| room_name_taken | M-03 | 409 | `{"error":"room_name_taken"}` |
| invalid_query | M-03, M-05, M-06 | 400 | `{"error":"invalid_query"}` |
| room_not_found | M-04, M-05 | 404 | `{"error":"room_not_found"}` |
| invalid_booking | M-04 | 400 | `{"error":"invalid_booking"}` |
| over_capacity | M-04 | 422 | `{"error":"over_capacity"}` |
| room_busy | M-04 | 409 | `{"error":"room_busy","conflictingBookingId":"<booking id>"}` |
| booking_not_found | M-05 | 404 | `{"error":"booking_not_found"}` |
| not_found | M-07 | 404 | `{"error":"not_found"}` |
| method_not_allowed | M-07 | 405 | `{"error":"method_not_allowed"}` |

Every one of these bodies is produced by `errorBody` in M-01, carries `Content-Type: application/json`, and holds no other key. No other status is returned: `201` for a created room, `201` for a created booking, `200` for every list, `204` with no body for a deleted booking. The eleven codes above are the closed set of `INV-004`; an error is never reported as free text. No code maps to a process exit; the only non-zero exit is the start-up failure described in section 5.

## 5. Process and IO boundaries

- **Process entry.** `src/index.ts`, built to `dist/index.js`, started by `npm start` (`node dist/index.js`) after `npm run build`. No command-line argument is read; argv beyond the script path is ignored.
- **Environment.** One variable is read: `PORT`. Unset means `3000`. `PORT=0` means an ephemeral port chosen by the operating system, reported by `startServer`. A `PORT` value that is not a decimal string denoting an integer in `0..65535` makes the process exit with status `1` before listening. No other environment variable is read.
- **Listen address.** `createServer(store).listen(port)` with no host argument, so the socket binds on the default interface set of the runtime; the port is the only configurable part of the address.
- **Request reading.** The request target is split at `?`; the path is split at `/` into segments; the query is parsed with `new URLSearchParams(search)`; the raw body is the UTF-8 decoding of every request chunk, and a zero-length body is `empty`, every other body goes through `parseJsonBody`. No request header is read other than the request line's method and target.
- **Response writing.** Status from `ApiResponse.status`; when `body` is defined, the body is `JSON.stringify(body)` and the header `Content-Type: application/json` is set together with a `Content-Length` in UTF-8 bytes; when `body` is `undefined` (the `204`) no `Content-Type` and no body are written.
- **Files.** The process reads no file and writes no file at runtime; state exists only in process memory and is lost when the process stops. The build writes `dist/` through `tsconfig.build.json`.
- **stdout / stderr.** The process writes nothing to stdout and nothing to stderr on a successful start; a start-up failure (invalid `PORT` or a listen error such as an occupied port) writes nothing and exits `1`.
- **Exit.** The process exits when it is signalled or when the listening socket closes; the only self-initiated exit is the start-up failure with status `1`.
- **Concurrency.** One actor per process, requests handled on the event loop with no interleaving inside a handler, strong read consistency from the shared store.

## 6. TD-TOOLING

```yaml
TD-TOOLING:
  node: "22"
  test_cmd: "npx vitest run"
  typecheck_cmd: "npx tsc --noEmit"
  dependencies: []
  dev_dependencies: ["typescript@7.0.2", "vitest@5.0.5", "@types/node@26.6.6"]
  tsconfig:
    module: "NodeNext"
    moduleResolution: "NodeNext"
    target: "ES2022"
    strict: true
    noEmit: true
```

## 7. Design decisions

### DD-01 HTTP server from the Node.js standard library
- evidence: [room-booking-api:CON-002, room-booking-api:CON-001, room-booking-api:IB-001, room-booking-api:ASM-002]
- decision: The server is `node:http` `createServer`, with no runtime dependency in `package.json`; routing, body reading and JSON serialisation are written in the product.
- alternatives_rejected: a web framework such as Express or Fastify (would declare a runtime dependency CON-002 forbids); a raw TCP line protocol (IB-001 requires an HTTP server on `PORT`).
- consequence: M-07 owns routing and serialisation by hand; every route module returns a plain `ApiResponse` the server serialises.

### DD-02 Error code to HTTP status table
- evidence: [room-booking-api:POL-001, room-booking-api:INV-004, room-booking-api:CTR-003, room-booking-api:CTR-001]
- decision: The status of each code is fixed once in M-01: `invalid_json` 400, `invalid_room` 400, `room_name_taken` 409, `invalid_query` 400, `room_not_found` 404, `invalid_booking` 400, `over_capacity` 422, `room_busy` 409, `booking_not_found` 404, `not_found` 404, `method_not_allowed` 405.
- alternatives_rejected: deriving the status at each call site (drift between endpoints); mapping every 4xx to 400 (contradicts the statuses the contracts state).
- consequence: `apiError` is the only place that pairs a code with a status, and the error mapping table of section 4 is exhaustive.

### DD-03 Time parsing accepts whole-minute UTC spellings only
- evidence: [room-booking-api:INV-008, room-booking-api:BEH-008, room-booking-api:BEH-014, room-booking-api:A-002, room-booking-api:A-003]
- decision: A time is accepted as `YYYY-MM-DDTHH:MMZ`, `YYYY-MM-DDTHH:MM:00Z` or `YYYY-MM-DDTHH:MM:00.000Z`, upper-case `Z` only, calendar-valid, and nothing else: a numeric offset, a lower-case `z`, a non-zero seconds field or a non-zero fraction is unparseable. An accepted string is stored and returned exactly as given.
- alternatives_rejected: `Date.parse` on any ISO-8601 input (would accept `+01:00` offsets and second precision, which BEH-008 rejects); normalising every time to the `09:30:00Z` form on return (would contradict A-002, which is in force).
- consequence: `parseTime` is a hand-written matcher with a round-trip calendar check; the echo of the requester's spelling is the store's responsibility, not the serialiser's.

### DD-04 Precedence of simultaneous failures per endpoint
- evidence: [room-booking-api:CTR-001, room-booking-api:CTR-002, room-booking-api:CTR-003, room-booking-api:CTR-004, room-booking-api:CTR-005, room-booking-api:CTR-006, room-booking-api:CTR-007, room-booking-api:BEH-009, room-booking-api:BEH-020]
- decision: Each route function tests in the order its contract's `code_precedence` names: `POST /rooms` invalid_room then room_name_taken, with invalid_json as the body-level prerequisite; `GET /rooms` invalid_query then invalid_json; `POST /rooms/:roomId/bookings` room_not_found, invalid_json, invalid_booking, over_capacity, room_busy; `GET /rooms/:roomId/bookings` invalid_query, room_not_found, invalid_json; `DELETE /bookings/:bookingId` booking_not_found then invalid_json; `GET /availability` invalid_query then invalid_json; unmatched path or method invalid_json, not_found, method_not_allowed.
- alternatives_rejected: one global order applied to every endpoint (contradicts CTR-003, where an unknown room precedes an invalid body, and CTR-004, where an invalid window precedes an unknown room).
- consequence: body validity is a value (`ParsedBody`) handed to the route so each route decides where in its own order the body test belongs; the server tests it only where no route matches.

### DD-05 In-memory store with monotonic id counters
- evidence: [room-booking-api:INV-001, room-booking-api:INV-002, room-booking-api:INV-006, room-booking-api:SCN-003, room-booking-api:A-001]
- decision: The store keeps `Room[]` and `Booking[]` in insertion order plus two counters: a room counter and a booking high-water mark. Ids are `r<counter>` and `b<highWater>`; a deletion removes the record and leaves both counters untouched; a new process builds a fresh store, so ids restart at `r1` and `b1`.
- alternatives_rejected: a `Map` with ids derived from the map size (would reuse a deleted booking id, contradicting A-001); persistence to a file (INV-006 forbids it).
- consequence: the monotonic guarantee lives in one place, and `createStore()` per process satisfies SCN-003.

### DD-06 Ordering by the numeric id suffix
- evidence: [room-booking-api:BEH-005, room-booking-api:BEH-013, room-booking-api:BEH-018, room-booking-api:A-005]
- decision: Two orders are defined in M-02: rooms by the integer in the id suffix ascending; bookings by `start` ascending then by the integer id suffix ascending. Availability sorts by capacity ascending then id suffix ascending.
- alternatives_rejected: lexicographic id comparison (would place `r10` before `r2`, contradicting A-005); ordering by insertion time only (breaks the `start` ordering of BEH-013).
- consequence: the comparison helper is internal to M-02 and every list response inherits the same rule.

### DD-07 Booking endpoints split into two route modules
- evidence: [room-booking-api:CTR-003, room-booking-api:CTR-004, room-booking-api:CTR-005, room-booking-api:BEH-007, room-booking-api:BEH-013]
- decision: `POST /rooms/:roomId/bookings` lives in M-04, `GET /rooms/:roomId/bookings` and `DELETE /bookings/:bookingId` live in M-05. The split keeps each module within the ID and test bounds of one task: M-04 carries the six creation behaviours with their eleven body boundary classes each, M-05 carries the five list and delete behaviours.
- alternatives_rejected: one booking module covering thirteen behaviours, three contracts and two scenarios (its boundary classes exceed the test budget of a single task); one module per endpoint (a delete endpoint alone would carry three IDs and no shared logic).
- consequence: both modules depend on M-01 and M-02 only, so they are two parallel lanes.

### DD-08 Literal path matching without decoding
- evidence: [room-booking-api:CTR-007, room-booking-api:BEH-020, room-booking-api:BEH-021]
- decision: The path is matched on the segments produced by splitting at `/`: `/rooms`, `/availability`, `/rooms/<segment>/bookings`, `/bookings/<segment>`. A segment is used verbatim as a room or booking id, with no percent-decoding, and a trailing slash produces a final empty segment, which matches no declared path and is therefore `not_found`.
- alternatives_rejected: decoding each segment before lookup (a decision no record states, and it would make two spellings name one id); treating a trailing slash as equal to the bare path (would make `/rooms/` a second path the records do not declare).
- consequence: a room id is the raw segment text; the two route-error codes of CTR-007 are decided in M-07 before any route function is called.

### DD-09 Route functions return a resolved response value
- evidence: [room-booking-api:INV-005, room-booking-api:INV-007, room-booking-api:POL-002, room-booking-api:LOC-001]
- decision: Every route function returns `ApiResponse` (`{ status, body? }`) and never throws for a documented failure; it builds error responses with `errorResponse` and success responses with `jsonResponse`. The server only writes the value and never appends or reshapes a body.
- alternatives_rejected: route functions returning an error code the server maps (two places decide precedence and status); throwing exceptions caught by the server (precedence would be the catch order, not the contract order).
- consequence: the response shape of INV-007 and the header rule of INV-005 have exactly one implementation site, and a route function is a pure function of store, path parameters, query and parsed body, which is directly testable.

### DD-10 Query parameter parsing: first occurrence, integer spellings, ignored extras
- evidence: [room-booking-api:BEH-006, room-booking-api:BEH-014, room-booking-api:BEH-018, room-booking-api:BEH-019, room-booking-api:A-006, room-booking-api:A-008]
- decision: A documented parameter is read with `URLSearchParams.get`, so the first occurrence of a repeated parameter decides. Undocumented parameters are ignored. `minCapacity` must match `/^[1-9][0-9]*$/`; `attendees` of availability must match `/^-?[0-9]+(\.[0-9]+)?$/` and denote an integer, so `2.0` and `-1` and `0` are accepted while `1.5` and `abc` are not. Body fields an endpoint does not document are ignored.
- alternatives_rejected: rejecting a repeated or undocumented parameter (A-006 states such a value never causes an error); `Number.parseInt` on the raw value (would accept `10abc` and `1.5`).
- consequence: parameter validation is a regex test plus an integer check in each route module, with no shared parser to keep the modules independent.

### DD-11 String length measured in UTF-16 code units, case-insensitive comparison by simple lower-casing
- evidence: [room-booking-api:BEH-002, room-booking-api:BEH-003, room-booking-api:BEH-008, room-booking-api:A-004]
- decision: A name is valid when it is a string with `length` of 1..40 and a title when it is a string with `length` of 1..80, where `length` is the JavaScript string length. A name collides when `name.toLowerCase()` equals `existing.toLowerCase()`. No value is trimmed, so a name of spaces is accepted and stored as written.
- alternatives_rejected: full Unicode case folding or normalisation (would collide names that differ in code points, which A-004 does not require); trimming before the length check (A-004 states spaces are a non-empty name).
- consequence: room-name uniqueness is one `toLowerCase` comparison inside `store.roomNameTaken`.

### DD-12 Start-up port handling
- evidence: [room-booking-api:IB-001, room-booking-api:A-007, room-booking-api:NFR-001]
- decision: `src/index.ts` reads `process.env.PORT`: absent uses `3000`, a decimal string denoting an integer in `0..65535` is used as given, `0` asks for an ephemeral port, and any other value makes the process exit with status `1` without listening. A listen error exits `1` as well.
- alternatives_rejected: falling back to `3000` on a malformed value (A-007 states the process exits non-zero); letting Node throw an unhandled rejection (a non-deterministic exit path).
- consequence: tests never depend on the default port; they call `startServer(0)` and read `RunningServer.port`.

## 8. Traceability

| spec ID | module |
|---|---|
| room-booking-api:BEH-001 | M-03 |
| room-booking-api:BEH-002 | M-03 |
| room-booking-api:BEH-003 | M-03 |
| room-booking-api:BEH-004 | M-03 |
| room-booking-api:BEH-005 | M-03 |
| room-booking-api:BEH-006 | M-03 |
| room-booking-api:BEH-007 | M-04 |
| room-booking-api:BEH-008 | M-04 |
| room-booking-api:BEH-009 | M-04 |
| room-booking-api:BEH-010 | M-04 |
| room-booking-api:BEH-011 | M-04 |
| room-booking-api:BEH-012 | M-04 |
| room-booking-api:BEH-013 | M-05 |
| room-booking-api:BEH-014 | M-05 |
| room-booking-api:BEH-015 | M-05 |
| room-booking-api:BEH-016 | M-05 |
| room-booking-api:BEH-017 | M-05 |
| room-booking-api:BEH-018 | M-06 |
| room-booking-api:BEH-019 | M-06 |
| room-booking-api:BEH-020 | M-07 |
| room-booking-api:BEH-021 | M-07 |
| room-booking-api:CTR-001 | M-03 |
| room-booking-api:CTR-002 | M-03 |
| room-booking-api:CTR-003 | M-04 |
| room-booking-api:CTR-004 | M-05 |
| room-booking-api:CTR-005 | M-05 |
| room-booking-api:CTR-006 | M-06 |
| room-booking-api:CTR-007 | M-07 |
| room-booking-api:SCN-001 | M-05 |
| room-booking-api:SCN-002 | M-04 |
| room-booking-api:SCN-003 | M-02 |
| room-booking-api:INV-001 | M-02 |
| room-booking-api:INV-002 | M-02 |
| room-booking-api:INV-003 | M-02 |
| room-booking-api:INV-004 | M-01 |
| room-booking-api:INV-005 | M-01 |
| room-booking-api:INV-006 | M-02 |
| room-booking-api:INV-007 | M-02 |
| room-booking-api:INV-008 | M-02 |
| room-booking-api:NFR-001 | M-07 |
| room-booking-api:LOC-001 | M-07 |
| room-booking-api:POL-001 | M-01 |
| room-booking-api:POL-002 | M-07 |
| room-booking-api:CON-001 | M-07 |
| room-booking-api:CON-002 | M-07 |
| room-booking-api:IB-001 | M-07 |

## 9. Revisions

none
