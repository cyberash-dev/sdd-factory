# Technical design: room-booking-api

## 1. Overview

`roomy` is a single-process HTTP API in TypeScript, built on Node.js 22 and the built-in `node:http` module, serving JSON over the port selected by the `PORT` environment variable (`3000` when absent, an ephemeral port when `0`). Six routes cover room creation and listing, booking creation, listing and deletion, and the availability query; every response body is JSON and every failure carries one stable snake_case code from the documented catalogue. Rooms and bookings live only in process memory, one store per server instance, and are lost when the process stops. No file, database or third-party service is touched at runtime, build time or test time.

## 2. Module map

### M-01 errors
- responsibility: define the error catalogue, the HTTP status of each code, and the success/failure result shape every handler returns.
- covers: [room-booking-api:POL-001, room-booking-api:INV-003]
- owns: src/errors/**
- entry: src/errors/index.ts
- depends_on: []
- public interface:
  ```ts
  export type ErrorCode =
    | "invalid_room"
    | "room_name_taken"
    | "invalid_query"
    | "room_not_found"
    | "invalid_booking"
    | "over_capacity"
    | "room_busy"
    | "booking_not_found"
    | "invalid_json"
    | "not_found"
    | "method_not_allowed";

  export interface ApiFailure {
    readonly ok: false;
    readonly code: ErrorCode;
    readonly conflictingBookingId?: string;
  }

  export interface ApiSuccess {
    readonly ok: true;
    readonly status: number;
    readonly body: unknown;
  }

  export type HandlerResult = ApiSuccess | ApiFailure;

  export function failure(code: ErrorCode, conflictingBookingId?: string): ApiFailure;
  export function success(status: number, body: unknown): ApiSuccess;
  export function isSuccess(result: HandlerResult): result is ApiSuccess;
  export function statusForCode(code: ErrorCode): number;
  export function errorBody(result: ApiFailure): Record<string, unknown>;
  ```
- notes: `statusForCode` is the total mapping of DD-03 (`invalid_room` 400, `room_name_taken` 409, `invalid_query` 400, `room_not_found` 404, `invalid_booking` 400, `over_capacity` 422, `room_busy` 409, `booking_not_found` 404, `invalid_json` 400, `not_found` 404, `method_not_allowed` 405). `errorBody` returns `{"error": code}` and adds `conflictingBookingId` when present. No error code outside this union is ever produced. Holds no state.

### M-02 store
- responsibility: hold all rooms and bookings in memory, assign sequential `r`/`b` identifiers, and expose ordered read and write operations.
- covers: [room-booking-api:INV-001, room-booking-api:INV-004]
- owns: src/store/**
- entry: src/store/index.ts
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

  export type NewBooking = Omit<Booking, "id">;

  export interface RoomStore {
    create(name: string, capacity: number): Room;
    get(roomId: string): Room | undefined;
    list(): readonly Room[];
    findByNameIgnoringCase(name: string): Room | undefined;
  }

  export interface BookingStore {
    create(input: NewBooking): Booking;
    get(bookingId: string): Booking | undefined;
    listByRoom(roomId: string): readonly Booking[];
    remove(bookingId: string): boolean;
  }

  export interface Store {
    readonly rooms: RoomStore;
    readonly bookings: BookingStore;
  }

  export function createStore(): Store;
  export function idNumber(id: string): number;
  ```
- notes: `idNumber` parses the decimal suffix of an `r`/`b` identifier so consumers sort numerically. `RoomStore.create` issues `r<counter>` and `BookingStore.create` issues `b<counter>` from two counters that never reset and never reuse a deleted value; each store keeps its entities in creation order, which is ascending numeric id order. `BookingStore.remove` returns `false` for an unknown id and leaves the store unchanged. `createStore()` returns a fresh empty store, so each server instance has isolated state and nothing is written outside it. Raises no error codes: validation belongs to M-04 through M-07.

### M-03 time
- responsibility: parse and format strict UTC minute-precision times, model half-open intervals, and decide overlap and duration.
- covers: [room-booking-api:INV-005, room-booking-api:INV-006]
- owns: src/time/**
- entry: src/time/index.ts
- depends_on: []
- public interface:
  ```ts
  export interface Interval {
    readonly startMs: number;
    readonly endMs: number;
  }

  export function parseUtcMinute(value: unknown): number | undefined;
  export function formatUtcMinute(epochMs: number): string;
  export function intervalOf(startMs: number, endMs: number): Interval;
  export function overlaps(a: Interval, b: Interval): boolean;
  export function lengthMs(interval: Interval): number;
  ```
- notes: `parseUtcMinute` returns epoch milliseconds only when the value is a string matching `YYYY-MM-DDTHH:mm:00Z` that denotes a real calendar instant, and `undefined` for any other input, including offsets, missing `Z`, seconds other than `00` and impossible dates. `formatUtcMinute` renders `YYYY-MM-DDTHH:mm:00Z` from epoch milliseconds. `overlaps` implements the half-open rule `a.startMs < b.endMs && b.startMs < a.endMs`. Raises no error codes; callers translate `undefined` into their own code.

### M-04 rooms
- responsibility: validate room bodies and serve `POST /rooms` and `GET /rooms`.
- covers: [room-booking-api:BEH-001, room-booking-api:BEH-002, room-booking-api:BEH-003, room-booking-api:BEH-004, room-booking-api:BEH-005, room-booking-api:CTR-001, room-booking-api:CTR-002]
- owns: src/rooms/**
- entry: src/rooms/index.ts
- depends_on: [M-01, M-02]
- public interface:
  ```ts
  import type { HandlerResult } from "../errors/index.js";
  import type { RoomStore } from "../store/index.js";

  export function createRoom(rooms: RoomStore, body: unknown): HandlerResult;
  export function listRooms(rooms: RoomStore, query: URLSearchParams): HandlerResult;
  ```
- notes: `createRoom` requires `body` to be a JSON object with a `name` string of 1 to 40 code points that is not whitespace-only (DD-11) and an integer `capacity` in `1..100`; any other value yields `failure("invalid_room")`. It then rejects a name whose lower-cased form equals an existing room name with `failure("room_name_taken")`, and otherwise stores the room exactly as submitted (no trimming) and returns `success(201, room)`. Client-supplied `id` fields are ignored. `listRooms` returns `success(200, {rooms})` in store order; a present `minCapacity` other than a decimal integer of at least 1 yields `failure("invalid_query")`; a room is kept when `capacity >= minCapacity`.

### M-05 bookings
- responsibility: validate booking bodies, enforce room existence, capacity and overlap, serve `POST /rooms/:roomId/bookings` and `DELETE /bookings/:bookingId`.
- covers: [room-booking-api:BEH-006, room-booking-api:BEH-007, room-booking-api:BEH-008, room-booking-api:BEH-009, room-booking-api:BEH-010, room-booking-api:BEH-014, room-booking-api:BEH-015, room-booking-api:SCN-001, room-booking-api:CTR-003, room-booking-api:CTR-005]
- owns: src/bookings/**
- entry: src/bookings/index.ts
- depends_on: [M-01, M-02, M-03]
- public interface:
  ```ts
  import type { HandlerResult } from "../errors/index.js";
  import type { Store } from "../store/index.js";

  export function createBooking(store: Store, roomId: string, body: unknown): HandlerResult;
  export function deleteBooking(store: Store, bookingId: string): HandlerResult;
  ```
- notes: `createBooking` validates in the fixed order of DD-05: field validity first (`invalid_booking`), then room existence (`room_not_found`), then capacity (`over_capacity`), then overlap (`room_busy`). Field validity requires a `title` string of 1 to 80 code points that is not whitespace-only, `start` and `end` accepted by `parseUtcMinute`, `end > start`, a duration of at most 8 hours (8 * 3600 * 1000 ms) and an integer `attendees >= 1`. On success it returns `success(201, booking)` with the server-assigned `b` id, the `roomId` path value and the submitted fields. `deleteBooking` removes the booking and returns `success(204, undefined)`; an unknown id returns `failure("booking_not_found")` and changes nothing. Overlap detection uses every booking of the room, half-open, and the reported conflict is the one with the earliest `start`, ties broken by ascending numeric id.

### M-06 booking-list
- responsibility: serve `GET /rooms/:roomId/bookings`, ordered by start then id, with the optional half-open `from`/`to` filter.
- covers: [room-booking-api:BEH-011, room-booking-api:BEH-012, room-booking-api:BEH-013, room-booking-api:BEH-020, room-booking-api:CTR-004]
- owns: src/booking-list/**
- entry: src/booking-list/index.ts
- depends_on: [M-01, M-02, M-03]
- public interface:
  ```ts
  import type { HandlerResult } from "../errors/index.js";
  import type { Store } from "../store/index.js";

  export function listBookings(store: Store, roomId: string, query: URLSearchParams): HandlerResult;
  ```
- notes: an unknown room yields `failure("room_not_found")`. `from` and `to` must be absent together or present together, both accepted by `parseUtcMinute`, with `to > from`; any other combination yields `failure("invalid_query")`. A booking is kept when `overlaps(bookingInterval, filterInterval)`, so a booking ending exactly at `from` or starting exactly at `to` is excluded. The result is sorted by `start` ascending then by `idNumber` ascending and returned as `success(200, {bookings})`.

### M-07 availability
- responsibility: serve `GET /availability`, returning the rooms large enough and free for the requested interval.
- covers: [room-booking-api:BEH-016, room-booking-api:BEH-017, room-booking-api:SCN-002, room-booking-api:CTR-006]
- owns: src/availability/**
- entry: src/availability/index.ts
- depends_on: [M-01, M-02, M-03]
- public interface:
  ```ts
  import type { HandlerResult } from "../errors/index.js";
  import type { Store } from "../store/index.js";

  export function findAvailableRooms(store: Store, query: URLSearchParams): HandlerResult;
  ```
- notes: `start`, `end` and `attendees` are all required; each must be present exactly once, the times accepted by `parseUtcMinute`, `end > start`, and `attendees` a decimal integer of at least 1. Any failure yields `failure("invalid_query")` and no room list. A room is kept when `capacity >= attendees` and none of its bookings overlaps `[start, end)`; the result is sorted by `capacity` ascending then `idNumber` ascending and returned as `success(200, {rooms})`. There is no maximum interval length for this query (DD-13).

### M-08 server
- responsibility: compose the store and the route handlers, parse request bodies, route paths and methods, render the JSON envelope, and start the HTTP server on the resolved port.
- covers: [room-booking-api:BEH-018, room-booking-api:BEH-019, room-booking-api:BEH-021, room-booking-api:INV-002, room-booking-api:CTR-007, room-booking-api:NFR-001, room-booking-api:POL-002, room-booking-api:CON-001, room-booking-api:CON-002, room-booking-api:CON-003, room-booking-api:CON-004, room-booking-api:CON-005, room-booking-api:EXT-001]
- owns: src/index.ts
- entry: src/index.ts
- depends_on: [M-01, M-02, M-04, M-05, M-06, M-07]
- public interface:
  ```ts
  import type { Server } from "node:http";

  export interface StartedServer {
    readonly port: number;
    readonly server: Server;
    close(): Promise<void>;
  }

  export function resolvePort(raw: string | undefined): number;
  export function createServer(): Server;
  export function startServer(port?: number): Promise<StartedServer>;
  ```
- notes: `createServer()` builds a `node:http` server with its own `createStore()` and no listening; `startServer(port)` listens on the given port, or on `resolvePort(process.env.PORT)` when `port` is `undefined`, and reports the effective port so a caller can use `0`. `resolvePort` returns `3000` for `undefined`, the numeric value for a decimal string, including `0`. The module owns the route table of DD-09, the body reading and JSON-object rule of DD-06, the envelope and content type of INV-002, the containment of unexpected exceptions of DD-12. It raises `not_found`, `method_not_allowed` and `invalid_json` itself.

## 3. Data shapes

```ts
// M-01 errors — covers: room-booking-api:POL-001, room-booking-api:INV-003
export type ErrorCode =
  | "invalid_room" | "room_name_taken" | "invalid_query" | "room_not_found"
  | "invalid_booking" | "over_capacity" | "room_busy" | "booking_not_found"
  | "invalid_json" | "not_found" | "method_not_allowed";

export interface ApiFailure { readonly ok: false; readonly code: ErrorCode; readonly conflictingBookingId?: string; }
export interface ApiSuccess { readonly ok: true; readonly status: number; readonly body: unknown; }
export type HandlerResult = ApiSuccess | ApiFailure;
```

```ts
// M-02 store — covers: room-booking-api:INV-001, room-booking-api:INV-004, room-booking-api:CTR-001, room-booking-api:CTR-003
export interface Room { readonly id: string; readonly name: string; readonly capacity: number; }
export interface Booking {
  readonly id: string; readonly roomId: string; readonly title: string;
  readonly start: string; readonly end: string; readonly attendees: number;
}
export type NewBooking = Omit<Booking, "id">;
export interface Store { readonly rooms: RoomStore; readonly bookings: BookingStore; }
```

```ts
// M-03 time — covers: room-booking-api:INV-005, room-booking-api:INV-006
export interface Interval { readonly startMs: number; readonly endMs: number; }
```

Wire shapes, rendered by M-04 through M-08 and fixed by the contracts: a room is `{"id","name","capacity"}` (CTR-001), a booking is `{"id","roomId","title","start","end","attendees"}` (CTR-003), a room list is `{"rooms":[...]}` (CTR-002, CTR-006), a booking list is `{"bookings":[...]}` (CTR-004), an error body is `{"error":"<code>"}` plus `"conflictingBookingId"` for `room_busy` (CTR-007), and a `204` response has no body (CTR-005).

## 4. Error mapping

No exit code is contractual: every failure is an HTTP response, and the process exits only when it is terminated. Body shapes are rendered by M-08, which sets `Content-Type: application/json` on every response that has a body and no content type and no body on the `204`.

| error code | raising module | HTTP status | body shape |
| --- | --- | --- | --- |
| `invalid_json` | M-08 | 400 | `{"error":"invalid_json"}` |
| `invalid_room` | M-04 | 400 | `{"error":"invalid_room"}` |
| `invalid_booking` | M-05 | 400 | `{"error":"invalid_booking"}` |
| `invalid_query` | M-04, M-06, M-07 | 400 | `{"error":"invalid_query"}` |
| `room_not_found` | M-05, M-06 | 404 | `{"error":"room_not_found"}` |
| `booking_not_found` | M-05 | 404 | `{"error":"booking_not_found"}` |
| `not_found` | M-08 | 404 | `{"error":"not_found"}` |
| `method_not_allowed` | M-08 | 405 | `{"error":"method_not_allowed"}` |
| `room_name_taken` | M-04 | 409 | `{"error":"room_name_taken"}` |
| `room_busy` | M-05 | 409 | `{"error":"room_busy","conflictingBookingId":"<id>"}` |
| `over_capacity` | M-05 | 422 | `{"error":"over_capacity"}` |

The union of these eleven codes is exactly the catalogue of `room-booking-api:CTR-007`; no other code and no other status is emitted for a client-caused failure.

## 5. Process and IO boundaries

- Process: one Node.js 22 process, an HTTP server created by `createServer()` from `src/index.ts`. TypeScript is strict and ESM (`"type": "module"`, `module`/`moduleResolution` `NodeNext`), imports carry the `.js` suffix, and the build is `npm run build` (`tsc -p tsconfig.build.json`); the suite is `npm test` (`vitest run`) and the typecheck is `npx tsc --noEmit` (CON-001, CON-002, CON-003).
- Runtime dependencies: none. Only `node:http` and Node.js global `URL`, `URLSearchParams`, `JSON`, `Date` and `String` are used; no outbound socket or process is opened (CON-004, CON-005).
- Port: `PORT` from `process.env`; absent means `3000`; `0` binds an operating-system-assigned ephemeral port. `startServer()` resolves the value through `resolvePort` and reports the effective port through `StartedServer.port` (BEH-021, EXT-001). The server listens with `server.listen(port)` and no explicit host argument.
- argv: none. The process reads no command-line argument and no standard input.
- Routes and methods: `POST /rooms`, `GET /rooms`, `POST /rooms/:roomId/bookings`, `GET /rooms/:roomId/bookings`, `DELETE /bookings/:bookingId`, `GET /availability`. Path matching splits `request.url` on `?`, splits the pathname on `/`, and compares segment counts and literal segments exactly; `:roomId` and `:bookingId` are used verbatim as the identifier without percent-decoding; a trailing slash and any other path are unknown routes (DD-09).
- Request body: read only on `POST /rooms` and `POST /rooms/:roomId/bookings`; the stream is consumed as UTF-8 with no size cap, and the value handed to a handler is the parsed JSON only when the text parses to a JSON object. An empty body, malformed JSON, trailing content or a JSON value that is not an object yields `400 invalid_json` before the handler runs (DD-06). Bodies on `GET` and `DELETE` are ignored.
- Query parameters: read from `URLSearchParams`; a repeated parameter is not a documented case and the first value is used.
- Response: status from the handler or from `statusForCode`; `Content-Type: application/json` (exactly that value) whenever a body is written; body serialised with `JSON.stringify`; `204` writes the status and no headers beyond the implicit ones. No `Allow` header is emitted on `405`.
- Standard output and error: request handling writes nothing to `stdout` or `stderr`. Only `startServer` resolves with the bound port for its caller; the process itself prints nothing.
- Exit: the process is terminated by `SIGINT` or `SIGTERM`; no signal handler is installed and no exit code is contractual. A failure to bind the port surfaces as a rejected `startServer()` promise.

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

DD-01 built-in `node:http` instead of a web framework
- evidence: [room-booking-api:CON-004, room-booking-api:CON-005, room-booking-api:ASM-008]
- decision: The HTTP layer is `node:http` `createServer` with a manual route table, and request bodies are read from the request stream. No runtime dependency is declared.
- alternatives_rejected: Express, Fastify or Koa would add a runtime dependency, a lockfile install from the network and a dependency the source does not name.
- consequence: Routing, body reading, content type and the `404`/`405` fallbacks are product code owned by M-08 and tested through the public interface.

DD-02 in-memory store with two monotonic counters
- evidence: [room-booking-api:INV-001, room-booking-api:INV-004, room-booking-api:ASM-001]
- decision: One `Store` per server instance holds arrays of rooms and bookings plus an `r` counter and a `b` counter that only increment. Creation order equals ascending numeric id, and a removed booking's id is never issued again.
- alternatives_rejected: A module-level singleton would leak state between server instances and between tests; a map keyed by id would lose creation order; recycling deleted ids would violate `INV-001`.
- consequence: `createServer()` yields a store with no rooms and no bookings, and a restart starts from `r1`/`b1` again.

DD-03 status mapping of the error catalogue
- evidence: [room-booking-api:POL-001, room-booking-api:CTR-007, room-booking-api:BEH-003, room-booking-api:BEH-009, room-booking-api:BEH-010]
- decision: `invalid_json`, `invalid_room`, `invalid_booking` and `invalid_query` map to `400`; `room_not_found`, `booking_not_found` and `not_found` to `404`; `method_not_allowed` to `405`; `room_name_taken` and `room_busy` to `409`; `over_capacity` to `422`.
- alternatives_rejected: Reporting every failure as `400` would contradict `CTR-003`, which assigns `404 room_not_found`, `409 room_busy` and `422 over_capacity` inside one contract; `422` for `invalid_booking` would blur field validity with capacity.
- consequence: One table in M-01 is the only place a status is attached to a code, and M-08 renders it uniformly.

DD-04 handlers return a result union instead of throwing
- evidence: [room-booking-api:POL-002, room-booking-api:POL-001]
- decision: Every handler returns `ApiSuccess | ApiFailure`; a rejected request is a value, never an exception, and no handler mutates the store before it has decided the outcome.
- alternatives_rejected: Throwing an `ApiError` class would let a missed `catch` turn a client mistake into a crash, which `POL-002` forbids; returning raw `http.ServerResponse` objects would tie every module to `node:http`.
- consequence: Handler modules are pure functions over a store and parsed input, and a rejected request leaves the store untouched by construction.

DD-05 validation order inside booking creation
- evidence: [room-booking-api:CTR-003, room-booking-api:BEH-006, room-booking-api:BEH-008, room-booking-api:BEH-009, room-booking-api:BEH-010]
- decision: The order is JSON object (M-08) → field validity (`invalid_booking`) → room existence (`room_not_found`) → capacity (`over_capacity`) → overlap (`room_busy`).
- alternatives_rejected: Checking the room first would answer `404` for a request whose body is already unusable and would make the error for a malformed body depend on the path; checking overlap first would report a busy room for a booking that can never be created.
- consequence: A request with several defects reports exactly one code, and the tests of `BEH-007` through `BEH-010` each see their own code by isolating one defect.

DD-06 request body parsing rule
- evidence: [room-booking-api:BEH-018, room-booking-api:INV-002]
- decision: A body is accepted only when the decoded text parses as JSON and the parsed value is a non-null, non-array object. Empty text, malformed JSON, trailing content, `null`, arrays and bare scalars all produce `400 invalid_json`. The text is read with no size limit and the `Content-Type` request header is not inspected.
- alternatives_rejected: Passing a JSON array to the field validators would produce `invalid_room`, while `BEH-018` classifies a JSON array where an object is expected with the malformed-body cases; a size limit is a number no approved record states.
- consequence: Field validators of M-04 and M-05 always receive an object, and they own only per-field rules.

DD-07 strict time parsing with a regular expression and `Date.UTC`
- evidence: [room-booking-api:INV-006, room-booking-api:ASM-006, room-booking-api:BEH-013]
- decision: A time is a UTC minute when the string matches `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$` and the components round-trip through `Date.UTC` to the same calendar fields. Parsed values are epoch milliseconds compared arithmetically; stored and echoed values are the original submitted strings.
- alternatives_rejected: `Date.parse` accepts offsets, seconds and lenient forms such as `2026-11-02T09:30Z`, all of which `INV-006` and `ASM-006` reject; `Temporal` is not part of the Node.js 22 baseline the constraint fixes.
- consequence: Second-precision input, offset input and impossible dates are rejected by every endpoint through the same function.

DD-08 ordering of room, booking and availability lists
- evidence: [room-booking-api:ASM-002, room-booking-api:BEH-004, room-booking-api:BEH-011, room-booking-api:BEH-016]
- decision: Room lists use store creation order, which is ascending numeric id order. Booking lists sort by `start` ascending, then by `idNumber(id)` ascending. Availability sorts by `capacity` ascending, then by `idNumber(id)` ascending.
- alternatives_rejected: Lexicographic string comparison would place `r10` before `r2`, contradicting `ASM-002`; ordering availability by id only would contradict `BEH-016`.
- consequence: `idNumber` is exported by M-02 and used by M-06 and M-07; no comparator is duplicated.

DD-09 routing and the two fallback codes
- evidence: [room-booking-api:BEH-019, room-booking-api:CTR-007]
- decision: The route table is a literal list of segment patterns with their allowed methods. A pathname matching no pattern answers `404 not_found`; a pathname matching a pattern with an unsupported method answers `405 method_not_allowed`; both are decided before any handler runs. Percent-encoded path segments are used verbatim and a trailing slash does not match.
- alternatives_rejected: A catch-all handler that answers `404` for a known path with a wrong method would violate `BEH-019`; method dispatch inside the handlers would spread the fallback over four modules.
- consequence: Every endpoint's `405` and every unknown path's `404` are produced in one place and are identical across routes.

DD-10 server lifecycle and port selection
- evidence: [room-booking-api:BEH-021, room-booking-api:EXT-001, room-booking-api:CON-003, room-booking-api:ASM-007]
- decision: `src/index.ts` exports `createServer()` and `startServer(port?)`; `startServer` with no argument resolves `resolvePort(process.env.PORT)` and returns the effective port, with `close()` releasing it. Importing the module never listens, so tests start a server on port `0` and read the reported port.
- alternatives_rejected: Listening as an import side effect would make the module unimportable by the suite and would bind port `3000` during tests; reading `process.env.PORT` inside `createServer` would remove the caller's control over the port.
- consequence: The suite can run several isolated servers in one process, each with its own store, and `npm start` uses the same entry through the scaffolded scripts.

DD-11 character counting and blank names
- evidence: [room-booking-api:ASM-003, room-booking-api:ASM-004, room-booking-api:BEH-002, room-booking-api:BEH-007]
- decision: The 40 and 80 character limits count Unicode code points through `[...value].length`, and a value whose code points are all whitespace is treated as empty. Names are stored untrimmed; uniqueness compares lower-cased values.
- alternatives_rejected: `String.length` counts UTF-16 units and would reject a 40-emoji name that `ASM-004` accepts; trimming would contradict the `out_of_scope` clause that excludes whitespace normalization.
- consequence: The same helper decides length and blankness for room names and booking titles.

DD-12 containment of unexpected exceptions
- evidence: [room-booking-api:POL-002, room-booking-api:INV-002]
- decision: M-08 wraps body parsing and handler dispatch in a `try`/`catch`; an exception that escapes produces a body-less `500` response and leaves the process and the store serving. No error code is invented for this path.
- alternatives_rejected: Letting the exception reach the event emitter would crash the process and violate `POL-002`; answering with a catalogue code such as `invalid_query` would report a client fault for a server fault and break `INV-003`.
- consequence: The catalogue stays closed at eleven codes; the `500` path is a containment measure, not a documented contract.

DD-13 no maximum interval length on the availability query
- evidence: [room-booking-api:CTR-006, room-booking-api:BEH-017]
- decision: `GET /availability` enforces a complete, parseable query with `end > start` and nothing else about length; the 8-hour ceiling applies only to booking creation.
- alternatives_rejected: Reusing the booking ceiling would add a rejection `CTR-006` does not list and would answer `invalid_query` for a query the contract accepts.
- consequence: A query for an interval longer than 8 hours is valid and lists every room free for that whole interval.

## 8. Traceability

| spec id | module |
| --- | --- |
| room-booking-api:BEH-001 | M-04 |
| room-booking-api:BEH-002 | M-04 |
| room-booking-api:BEH-003 | M-04 |
| room-booking-api:BEH-004 | M-04 |
| room-booking-api:BEH-005 | M-04 |
| room-booking-api:BEH-006 | M-05 |
| room-booking-api:BEH-007 | M-05 |
| room-booking-api:BEH-008 | M-05 |
| room-booking-api:BEH-009 | M-05 |
| room-booking-api:BEH-010 | M-05 |
| room-booking-api:BEH-011 | M-06 |
| room-booking-api:BEH-012 | M-06 |
| room-booking-api:BEH-013 | M-06 |
| room-booking-api:BEH-014 | M-05 |
| room-booking-api:BEH-015 | M-05 |
| room-booking-api:BEH-016 | M-07 |
| room-booking-api:BEH-017 | M-07 |
| room-booking-api:BEH-018 | M-08 |
| room-booking-api:BEH-019 | M-08 |
| room-booking-api:BEH-020 | M-06 |
| room-booking-api:BEH-021 | M-08 |
| room-booking-api:SCN-001 | M-05 |
| room-booking-api:SCN-002 | M-07 |
| room-booking-api:CTR-001 | M-04 |
| room-booking-api:CTR-002 | M-04 |
| room-booking-api:CTR-003 | M-05 |
| room-booking-api:CTR-004 | M-06 |
| room-booking-api:CTR-005 | M-05 |
| room-booking-api:CTR-006 | M-07 |
| room-booking-api:CTR-007 | M-08 |
| room-booking-api:INV-001 | M-02 |
| room-booking-api:INV-002 | M-08 |
| room-booking-api:INV-003 | M-01 |
| room-booking-api:INV-004 | M-02 |
| room-booking-api:INV-005 | M-03 |
| room-booking-api:INV-006 | M-03 |
| room-booking-api:NFR-001 | M-08 |
| room-booking-api:EXT-001 | M-08 |
| room-booking-api:POL-001 | M-01 |
| room-booking-api:POL-002 | M-08 |
| room-booking-api:CON-001 | M-08 |
| room-booking-api:CON-002 | M-08 |
| room-booking-api:CON-003 | M-08 |
| room-booking-api:CON-004 | M-08 |
| room-booking-api:CON-005 | M-08 |

## 9. Revisions

none
