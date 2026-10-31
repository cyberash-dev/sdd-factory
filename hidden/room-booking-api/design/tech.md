# Technical design: room-booking-api

## 1. Overview

`roomy` is a single-process HTTP API in TypeScript that manages Rooms and their Bookings for one organisation, with all state held in the in-memory Store and lost when the process stops. It exposes exactly six endpoints: create and list Rooms, create and list the Bookings of a Room, delete a Booking, and list the rooms that are Availability for an Interval. Every response is JSON carrying exactly the documented members; every failure is a stable snake_case Error code from a single table. The server is built on the HTTP server bundled with the Node runtime, takes its listen port from `PORT` (default `3000`), and is started with `npm start` after `npm run build`.

## 2. Module map

### M-01 domain core
- responsibility: define the shared response and routing types, the Error code table, the whole-minute UTC Time parser, and the in-memory Store with id assignment, Overlap, Availability and listing-order queries.
- covers: [room-booking-api:BEH-011, room-booking-api:BEH-012, room-booking-api:INV-001, room-booking-api:INV-002, room-booking-api:INV-003, room-booking-api:INV-005, room-booking-api:INV-006, room-booking-api:INV-007, room-booking-api:POL-001]
- owns: src/core/**
- entry: src/core/index.ts
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

  export interface ErrorBody {
    readonly error: ErrorCode;
    readonly conflictingBookingId?: string;
  }

  export interface Store {
    addRoom(input: { name: string; capacity: number }): Room;
    rooms(): readonly Room[];
    findRoom(roomId: string): Room | undefined;
    roomNameTaken(name: string): boolean;
    addBooking(input: {
      roomId: string;
      title: string;
      start: string;
      end: string;
      startMs: number;
      endMs: number;
      attendees: number;
    }): Booking;
    findBooking(bookingId: string): Booking | undefined;
    removeBooking(bookingId: string): boolean;
    bookingsOf(roomId: string): readonly Booking[];
    bookingsOverlapping(roomId: string, fromMs: number, toMs: number): readonly Booking[];
    earliestConflict(roomId: string, startMs: number, endMs: number): Booking | undefined;
    availableRooms(startMs: number, endMs: number, attendees: number): readonly Room[];
    instantOf(booking: Booking): { startMs: number; endMs: number };
  }

  export function createStore(): Store;

  export function parseTime(value: unknown): number | undefined;

  export function formatError(
    code: ErrorCode,
    conflict?: Booking,
  ): { status: number; body: ErrorBody };

  export interface HandlerRequest {
    readonly params: Readonly<Record<string, string>>;
    readonly query: URLSearchParams;
    readonly body: unknown;
  }

  export interface HandlerResponse {
    readonly status: number;
    readonly body?: unknown;
  }

  export interface Route {
    readonly method: "GET" | "POST" | "DELETE";
    readonly path: string;
    readonly expectsJsonBody: boolean;
    readonly handle: (request: HandlerRequest) => HandlerResponse;
  }
  ```
- notes: raises no HTTP error itself; `formatError` holds the only copy of the code→status→body table (POL-001). The Store keeps rooms and bookings in creation-ordered arrays and two monotonic counters, so listing order is id creation order (ASM-005) and no id is ever reused (INV-001, INV-002, INV-006). `parseTime` returns whole-minute epoch milliseconds or `undefined`; a Booking keeps the submitted `start`/`end` text and its millisecond instants, exposed only through `instantOf`.

### M-02 room endpoints
- responsibility: serve `POST /rooms` and `GET /rooms`, including every room-body and query rule and room-name uniqueness.
- covers: [room-booking-api:BEH-001, room-booking-api:BEH-002, room-booking-api:BEH-003, room-booking-api:BEH-004, room-booking-api:BEH-005, room-booking-api:BEH-006, room-booking-api:BEH-007, room-booking-api:CTR-001, room-booking-api:CTR-002, room-booking-api:SCN-001]
- owns: src/rooms/**
- entry: src/rooms/index.ts
- depends_on: [M-01]
- public interface:
  ```ts
  import type {
    HandlerRequest,
    HandlerResponse,
    Route,
    Store,
  } from "../core/index.js";

  export function createRoomRoutes(store: Store): readonly Route[];
  ```
- notes: raises `invalid_room` (400), `room_name_taken` (409) and, for `GET /rooms?minCapacity=`, `invalid_query` (400). Validation order for `POST /rooms`: the body must be a JSON object other than an array (`invalid_room`), then name, then capacity, then the case-insensitive name check.

### M-03 booking creation endpoint
- responsibility: serve `POST /rooms/:roomId/bookings` with every booking-body, capacity and Conflict rule in the documented precedence.
- covers: [room-booking-api:BEH-008, room-booking-api:BEH-009, room-booking-api:BEH-010, room-booking-api:BEH-013, room-booking-api:BEH-014, room-booking-api:BEH-015, room-booking-api:BEH-016, room-booking-api:BEH-017, room-booking-api:BEH-028, room-booking-api:CTR-003, room-booking-api:SCN-002, room-booking-api:SCN-004]
- owns: src/booking-create/**
- entry: src/booking-create/index.ts
- depends_on: [M-01]
- public interface:
  ```ts
  import type {
    HandlerRequest,
    HandlerResponse,
    Route,
    Store,
  } from "../core/index.js";

  export function createBookingCreateRoutes(store: Store): readonly Route[];
  ```
- notes: raises `room_not_found` (404), `invalid_booking` (400), `over_capacity` (422) and `room_busy` (409) with `conflictingBookingId`. Check order after the router's `invalid_json`: room existence, body validity (title, both times, end after start, at most 8 hours, attendees an integer at least 1), then capacity, then Conflict (BEH-028).

### M-04 booking reads, deletion and availability
- responsibility: serve `GET /rooms/:roomId/bookings`, `DELETE /bookings/:bookingId` and `GET /availability`, including the interval-overlap filter and every listing order.
- covers: [room-booking-api:BEH-018, room-booking-api:BEH-019, room-booking-api:BEH-020, room-booking-api:BEH-021, room-booking-api:BEH-022, room-booking-api:BEH-023, room-booking-api:BEH-024, room-booking-api:CTR-004, room-booking-api:CTR-005, room-booking-api:CTR-006, room-booking-api:SCN-003]
- owns: src/booking-read/**
- entry: src/booking-read/index.ts
- depends_on: [M-01]
- public interface:
  ```ts
  import type {
    HandlerRequest,
    HandlerResponse,
    Route,
    Store,
  } from "../core/index.js";

  export function createBookingReadRoutes(store: Store): readonly Route[];
  ```
- notes: raises `invalid_query` (400), `room_not_found` (404) and `booking_not_found` (404). On `GET /rooms/:roomId/bookings` the query is validated before the room lookup (BEH-028). `GET /availability` validates all three parameters before answering.

### M-05 HTTP server and routing
- responsibility: own the socket, read and parse request bodies, match requests to Routes, and write JSON responses, `not_found` and `method_not_allowed`.
- covers: [room-booking-api:BEH-025, room-booking-api:BEH-026, room-booking-api:BEH-027, room-booking-api:CTR-007, room-booking-api:INV-004, room-booking-api:POL-002]
- owns: src/http/**
- entry: src/http/index.ts
- depends_on: [M-01]
- public interface:
  ```ts
  import type { Route } from "../core/index.js";
  import type { Server } from "node:http";

  export function createHttpServer(routes: readonly Route[]): Server;
  ```
- notes: raises `invalid_json` (400), `not_found` (404) and `method_not_allowed` (405). It never inspects the request's `Content-Type`, always answers `Content-Type: application/json` when a body is written, and answers a 204 with no header and no body. A Route marked `expectsJsonBody` receives `JSON.parse` of the body text; a parse failure or a body above 1048576 bytes answers `invalid_json` before the handler runs. The router adds no Error code of its own: the handlers are total over `unknown` bodies and query strings, so no request can reach a missing branch.

### M-06 composition root
- responsibility: wire the Store, the three route groups and the HTTP server, parse `PORT`, and own the process entry and the emitting build configuration.
- covers: [room-booking-api:CN-001, room-booking-api:CN-002, room-booking-api:CN-003]
- owns: src/app/**, src/index.ts, tsconfig.build.json
- entry: src/app/index.ts
- depends_on: [M-01, M-02, M-03, M-04, M-05]
- public interface:
  ```ts
  import type { Store } from "../core/index.js";
  import type { Server } from "node:http";

  export function buildServer(store?: Store): Server;

  export function startServer(
    port: number,
  ): Promise<{ readonly port: number; readonly close: () => Promise<void> }>;
  ```
- notes: `buildServer` creates one Store, concatenates the route tables of M-02, M-03 and M-04 and passes them to `createHttpServer`; it does not listen. `startServer` calls `buildServer()` and resolves with the port the runtime actually bound, so port `0` yields an ephemeral port (CN-003). `src/index.ts` reads `process.env.PORT`, defaulting to `3000`, calls `startServer`, writes a listen failure to stderr and exits with code 1. This task also adds the `build` script (`tsc -p tsconfig.build.json`, emitting to `dist`) and the `start` script (`node dist/index.js`) to `package.json`; it declares no dependency (CN-001) and makes no outbound request.

## 3. Data shapes

```ts
// room-booking-api:CTR-001, room-booking-api:CTR-002, room-booking-api:CTR-006, room-booking-api:INV-005
export interface Room {
  readonly id: string;        // "r<N>", N the creation ordinal (INV-001)
  readonly name: string;      // stored verbatim (ASM-006)
  readonly capacity: number;  // integer 1..100
}
```

```ts
// room-booking-api:CTR-003, room-booking-api:CTR-004, room-booking-api:INV-002, room-booking-api:INV-005
export interface Booking {
  readonly id: string;        // "b<N>", N the process-wide creation ordinal (INV-002)
  readonly roomId: string;
  readonly title: string;     // stored verbatim (ASM-006)
  readonly start: string;     // the submitted Time text, echoed as submitted (CTR-003)
  readonly end: string;       // the submitted Time text, echoed as submitted (CTR-003)
  readonly attendees: number;
}
```

```ts
// room-booking-api:POL-001, room-booking-api:CTR-007, room-booking-api:INV-005
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

export interface ErrorBody {
  readonly error: ErrorCode;
  readonly conflictingBookingId?: string; // present only on room_busy
}
```

```ts
// room-booking-api:BEH-019, room-booking-api:BEH-023, room-booking-api:INV-003, room-booking-api:INV-007
export interface Store {
  addRoom(input: { name: string; capacity: number }): Room;
  rooms(): readonly Room[];
  findRoom(roomId: string): Room | undefined;
  roomNameTaken(name: string): boolean;
  addBooking(input: {
    roomId: string;
    title: string;
    start: string;
    end: string;
    startMs: number;
    endMs: number;
    attendees: number;
  }): Booking;
  findBooking(bookingId: string): Booking | undefined;
  removeBooking(bookingId: string): boolean;
  bookingsOf(roomId: string): readonly Booking[];
  bookingsOverlapping(roomId: string, fromMs: number, toMs: number): readonly Booking[];
  earliestConflict(roomId: string, startMs: number, endMs: number): Booking | undefined;
  availableRooms(startMs: number, endMs: number, attendees: number): readonly Room[];
  instantOf(booking: Booking): { startMs: number; endMs: number };
}
```

```ts
// room-booking-api:CTR-001, room-booking-api:CTR-003, room-booking-api:CTR-007, room-booking-api:CTR-006
export interface HandlerRequest {
  readonly params: Readonly<Record<string, string>>; // ":roomId", ":bookingId"
  readonly query: URLSearchParams;                   // raw query, first value wins
  readonly body: unknown;                            // undefined when the Route expects no body
}

export interface HandlerResponse {
  readonly status: number;
  readonly body?: unknown;                           // omitted on 204
}

export interface Route {
  readonly method: "GET" | "POST" | "DELETE";
  readonly path: string;                             // "/rooms/:roomId/bookings"
  readonly expectsJsonBody: boolean;
  readonly handle: (request: HandlerRequest) => HandlerResponse;
}
```

## 4. Error mapping

Every code below is listed by at least one approved Contract; no other code exists. The status and the body shape are fixed by the Contracts; `formatError` in M-01 is the single implementation.

| Error code | Raising module | Status | Body |
|---|---|---|---|
| invalid_json | M-05 (body read and parse) | 400 | `{"error":"invalid_json"}` |
| invalid_room | M-02 (`POST /rooms`) | 400 | `{"error":"invalid_room"}` |
| room_name_taken | M-02 (`POST /rooms`) | 409 | `{"error":"room_name_taken"}` |
| invalid_query | M-02 (`GET /rooms`), M-04 (`GET /rooms/:roomId/bookings`, `GET /availability`) | 400 | `{"error":"invalid_query"}` |
| room_not_found | M-03 (`POST /rooms/:roomId/bookings`), M-04 (`GET /rooms/:roomId/bookings`) | 404 | `{"error":"room_not_found"}` |
| invalid_booking | M-03 (`POST /rooms/:roomId/bookings`) | 400 | `{"error":"invalid_booking"}` |
| over_capacity | M-03 (`POST /rooms/:roomId/bookings`) | 422 | `{"error":"over_capacity"}` |
| room_busy | M-03 (`POST /rooms/:roomId/bookings`) | 409 | `{"error":"room_busy","conflictingBookingId":"b<N>"}` |
| booking_not_found | M-04 (`DELETE /bookings/:bookingId`) | 404 | `{"error":"booking_not_found"}` |
| not_found | M-05 (no Route path matches) | 404 | `{"error":"not_found"}` |
| method_not_allowed | M-05 (a Route path matches, the method does not) | 405 | `{"error":"method_not_allowed"}` |

Request handling produces no process exit code: every failure is one of the rows above. The process exits with code 1 only when the listen call fails (DD-13).

## 5. Process and IO boundaries

Command: `npm run build` then `npm start`; the process takes no arguments, reads no stdin and consumes exactly one environment variable.

| Boundary | Contract |
|---|---|
| env `PORT` | unset or empty string means `3000`; otherwise a decimal integer in 0..65535; `0` binds an ephemeral port (CN-002, CN-003) |
| listen host | not set by the product: the runtime default of all interfaces |
| stdout | nothing is written on a successful start |
| stderr | the failure text, followed by exit code 1, when the listen call fails (DD-13) |
| exit code | 1 on a listen failure; the process runs until it is signalled |
| request encoding | UTF-8; bodies are read as text and parsed with `JSON.parse` |
| body size | a body above 1048576 bytes answers 400 `invalid_json` (DD-09) |
| response headers | `Content-Type: application/json` on every response with a body; a 204 carries no header and no body (INV-004) |
| files | none read or written while running; rooms and bookings live in memory only (INV-006); `tsconfig.build.json` writes `dist/` at build time |
| outbound network | none (CN-001) |

| Method | Path | Module | Success status | Success body |
|---|---|---|---|---|
| POST | `/rooms` | M-02 | 201 | `{"id","name","capacity"}` |
| GET | `/rooms` | M-02 | 200 | `{"rooms":[Room,...]}` |
| POST | `/rooms/:roomId/bookings` | M-03 | 201 | `{"id","roomId","title","start","end","attendees"}` |
| GET | `/rooms/:roomId/bookings` | M-04 | 200 | `{"bookings":[Booking,...]}` |
| DELETE | `/bookings/:bookingId` | M-04 | 204 | none |
| GET | `/availability` | M-04 | 200 | `{"rooms":[Room,...]}` |

Any other path answers 404 `not_found`; a listed path with another method answers 405 `method_not_allowed` (ASM-001). Paths are matched segment by segment with no trailing-slash normalisation, so `GET /rooms/` and `DELETE /rooms/r1` answer `not_found` (DD-07).

## 6. TD-TOOLING

```yaml
TD-TOOLING:
  node: "22"
  test_cmd: "npx vitest run"
  typecheck_cmd: "npx tsc --noEmit"
  dependencies: []
  dev_dependencies: ["typescript@5.6.3", "vitest@2.1.8", "@types/node@22.9.0"]
  tsconfig: { module: NodeNext, moduleResolution: NodeNext, target: ES2022, strict: true, noEmit: true }
```

## 7. Design decisions

**DD-01 Node built-in HTTP server with a hand-written router**
- evidence: [room-booking-api:CN-001, room-booking-api:CN-003, room-booking-api:POL-002]
- decision: the surface is served by `node:http`; M-05 matches requests against the Route table and writes the response itself, and no runtime dependency is declared.
- alternatives_rejected: an HTTP framework or router package, which would add a third-party runtime dependency that CN-001 forbids; reading raw sockets, which duplicates framing the runtime already provides.
- consequence: body reading, JSON parsing, content type and routing all live in M-05 and are testable through `createHttpServer`.

**DD-02 In-memory Store with monotonic counters and creation-ordered arrays**
- evidence: [room-booking-api:INV-001, room-booking-api:INV-002, room-booking-api:INV-006, room-booking-api:INV-007]
- decision: `createStore` returns a closure over two arrays and two counters; a new Room gets `r<roomsCreated+1>` and a new Booking `b<bookingsCreated+1>`; a rejected request increments nothing; deletion splices the array and frees no id.
- alternatives_rejected: any file, database or external store (INV-006 forbids persistence); a `Map` keyed by id plus separate order arrays (redundant because insertion order already is id order under ASM-005).
- consequence: listings already iterate in creation order, so an order by id needs no comparison (ASM-005), and a restart starts again from `r1` and `b1`.

**DD-03 Strict whole-minute UTC time parsing, submitted text echoed**
- evidence: [room-booking-api:BEH-011, room-booking-api:BEH-012, room-booking-api:CTR-003, room-booking-api:ASM-004, room-booking-api:ASM-009]
- decision: `parseTime` accepts a string matching `^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?Z$`, rejects a non-zero seconds or fractional part, validates the calendar fields by rebuilding the instant with `Date.UTC` and comparing the components, and returns whole-minute epoch milliseconds; anything else returns `undefined`. A Booking stores the submitted `start`/`end` text unchanged and keeps the millisecond instants beside it.
- alternatives_rejected: `Date.parse` or `new Date(text)`, which accept offsets and out-of-range fields and silently normalise; a regex without a calendar round-trip, which accepts `2026-02-30T09:00:00Z`.
- consequence: `2026-11-02T09:30Z`, `2026-11-02T09:30:00Z` and `2026-11-02T09:30:00.000Z` are one instant and all accepted, an offset time is rejected (ASM-009), and responses echo the client's own text (CTR-003).

**DD-04 Half-open Overlap predicate, earliest-starting Conflict**
- evidence: [room-booking-api:INV-003, room-booking-api:BEH-016, room-booking-api:BEH-017, room-booking-api:BEH-019, room-booking-api:SCN-004]
- decision: two intervals overlap exactly when `startMs < otherEndMs && otherStartMs < endMs`. `earliestConflict` scans the room's bookings, keeps those that overlap, and returns the one with the smallest `startMs`, ties broken by creation order. The `from`/`to` filter of `GET /rooms/:roomId/bookings` uses the same predicate against `[from, to)`.
- alternatives_rejected: closed-interval comparison, which reports adjacency as a Conflict and contradicts BEH-017; a sweep over a sorted index, which the store size does not warrant.
- consequence: a booking starting at 10:00 after one ending at 10:00 is accepted, and one starting at 09:59 is rejected with `room_busy`.

**DD-05 Case-insensitive room-name uniqueness by lowercasing**
- evidence: [room-booking-api:BEH-004, room-booking-api:SCN-001]
- decision: `roomNameTaken` compares the submitted name against every stored name after `toLowerCase()` on both sides.
- alternatives_rejected: locale-aware collation with `toLocaleLowerCase`, whose result depends on the host locale and is not stated by a record; storing a normalised name, which would break the verbatim echo (ASM-006).
- consequence: `Aurora`, `aurora` and `AURORA` collide while the stored name stays as submitted.

**DD-06 Length counted in Unicode code points, no trimming**
- evidence: [room-booking-api:BEH-002, room-booking-api:BEH-010, room-booking-api:ASM-006]
- decision: a name or title is valid when it is a string whose `[...value].length` is above zero and at most 40 or 80 respectively; the value is stored and echoed without trimming.
- alternatives_rejected: `.length`, which counts UTF-16 units and makes an emoji cost two characters; trimming before measuring, which a record does not state and which would change the echoed value.
- consequence: a single space is a valid name and title; 40 and 80 code points are accepted and one more is rejected.

**DD-07 Router matches exact segments, 405 only for a matched path**
- evidence: [room-booking-api:BEH-026, room-booking-api:BEH-027, room-booking-api:CTR-007, room-booking-api:ASM-001]
- decision: a Route path is split on `/` and matched segment by segment, a `:name` segment capturing any single non-empty segment; the method must equal the Route method; a path matching some Route pattern under another method answers `method_not_allowed`, a path matching none answers `not_found`.
- alternatives_rejected: a regular-expression router built from the paths (harder to keep 404 and 405 apart); normalising a trailing slash, which would contradict BEH-026's `GET /rooms/` case.
- consequence: `DELETE /rooms/r1`, `GET /bookings` and `GET /rooms/` answer `not_found`, while `PUT /rooms` and `POST /availability` answer `method_not_allowed`.

**DD-08 Query reading: first value, absent distinct from empty**
- evidence: [room-booking-api:BEH-007, room-booking-api:BEH-020, room-booking-api:BEH-024]
- decision: handlers read a parameter with `URLSearchParams.get`; `null` means absent, an empty string is present and fails validation, and a repeated parameter contributes its first value.
- alternatives_rejected: collecting all values and rejecting a repeat, which no record asks for (BEH-007 puts repeats out of scope); treating an empty value as absent, which would make `minCapacity=` a missing filter.
- consequence: `minCapacity=`, `minCapacity=0` and a missing `attendees` each fail with the endpoint's own code.

**DD-09 Request bodies capped at 1 MiB and requiring JSON text**
- evidence: [room-booking-api:POL-002, room-booking-api:BEH-025]
- decision: M-05 accumulates the body and answers 400 `invalid_json` as soon as more than 1048576 bytes arrive, destroying the request stream; an empty body and a body that `JSON.parse` rejects both answer `invalid_json`; a JSON value that is not an object is passed to the handler, which answers `invalid_room` or `invalid_booking`.
- alternatives_rejected: unbounded buffering, which lets one request exhaust memory and hang the process (POL-002); a dedicated body-too-large code, which POL-001 does not list; inspecting the request `Content-Type`, which no record states.
- consequence: no request can hold the process, and every rejection of a body carries a documented code.

**DD-10 Response content type set unconditionally**
- evidence: [room-booking-api:INV-004, room-booking-api:CTR-007]
- decision: M-05 writes `Content-Type: application/json` on every response that has a body and writes no header and no body on 204.
- alternatives_rejected: content negotiation on the request's `Accept`, which no record states; rejecting a request whose `Content-Type` is not JSON, which no code covers.
- consequence: a 400 is never served as text, and `DELETE /bookings/b1` answers with an empty body.

**DD-11 One error table, no free text, no additional code**
- evidence: [room-booking-api:POL-001, room-booking-api:CTR-007, room-booking-api:INV-005]
- decision: `formatError` maps each of the eleven codes to its status and body and adds `conflictingBookingId` only for `room_busy`; handlers return a code and never a message; the body carries exactly the documented members.
- alternatives_rejected: a `message` member beside `error` (POL-001 makes it non-contractual and INV-005 forbids extra members); per-module status constants, which would let one code drift between endpoints (ASM-010).
- consequence: `invalid_json`, `invalid_query` and `room_not_found` have one definition wherever they are emitted.

**DD-12 Two build configurations: shared type-check and an emitting build**
- evidence: [room-booking-api:CN-003, room-booking-api:CN-002]
- decision: the foreman's `tsconfig.json` type-checks `src` and `tests` with `noEmit`; `tsconfig.build.json`, owned by M-06, extends it with `outDir: "dist"` and includes `src` only; `npm run build` runs `tsc -p tsconfig.build.json` and `npm start` runs `node dist/index.js`.
- alternatives_rejected: emitting from the shared `tsconfig.json`, which TD-TOOLING forbids because it breaks the verifier on the test files; running the TypeScript sources directly at start, which needs an extra runtime loader (a third-party dependency).
- consequence: `npm run build` compiles cleanly, `npm test` type-checks `src` and `tests` together, and `npm start` serves the compiled output.

**DD-13 Listen host, `PORT` parsing and the listen-failure exit code**
- evidence: [room-booking-api:CN-002, room-booking-api:CN-003]
- decision: `src/index.ts` reads `process.env.PORT`; an unset or empty value means `3000`; a value that is a decimal integer in 0..65535 is passed to `listen` with the host omitted, so the runtime binds all interfaces and port `0` picks an ephemeral port; a rejection of the listen call writes the error to stderr and exits with code 1.
- alternatives_rejected: falling back to a hard-coded port on a malformed `PORT`, which would hide a misconfiguration; binding `127.0.0.1` explicitly, which no record states; exiting 0 on a listen failure, which reports success for a dead server.
- consequence: `PORT=0` serves a test on a free port (CN-003) and an occupied port fails loudly.

**DD-14 Availability filter and ordering**
- evidence: [room-booking-api:BEH-023, room-booking-api:CTR-006, room-booking-api:BEH-006, room-booking-api:ASM-005]
- decision: `availableRooms` keeps the rooms whose capacity is at least `attendees` and for which `earliestConflict` is `undefined`, copying the creation-ordered room array first and sorting by capacity ascending with a stable sort, so equal capacities keep creation order.
- alternatives_rejected: sorting by id text, which would put `r10` before `r2` (ASM-005); filtering bookings per room outside the store, which would duplicate the Overlap predicate.
- consequence: `GET /availability` returns r2 before r3 when both are free and r2 has the smaller capacity, and `GET /rooms?minCapacity=` inherits the same creation order from the store.

## 8. Traceability

| Spec id | Module |
|---|---|
| room-booking-api:BEH-001 | M-02 |
| room-booking-api:BEH-002 | M-02 |
| room-booking-api:BEH-003 | M-02 |
| room-booking-api:BEH-004 | M-02 |
| room-booking-api:BEH-005 | M-02 |
| room-booking-api:BEH-006 | M-02 |
| room-booking-api:BEH-007 | M-02 |
| room-booking-api:BEH-008 | M-03 |
| room-booking-api:BEH-009 | M-03 |
| room-booking-api:BEH-010 | M-03 |
| room-booking-api:BEH-011 | M-01 |
| room-booking-api:BEH-012 | M-01 |
| room-booking-api:BEH-013 | M-03 |
| room-booking-api:BEH-014 | M-03 |
| room-booking-api:BEH-015 | M-03 |
| room-booking-api:BEH-016 | M-03 |
| room-booking-api:BEH-017 | M-03 |
| room-booking-api:BEH-018 | M-04 |
| room-booking-api:BEH-019 | M-04 |
| room-booking-api:BEH-020 | M-04 |
| room-booking-api:BEH-021 | M-04 |
| room-booking-api:BEH-022 | M-04 |
| room-booking-api:BEH-023 | M-04 |
| room-booking-api:BEH-024 | M-04 |
| room-booking-api:BEH-025 | M-05 |
| room-booking-api:BEH-026 | M-05 |
| room-booking-api:BEH-027 | M-05 |
| room-booking-api:BEH-028 | M-03 |
| room-booking-api:SCN-001 | M-02 |
| room-booking-api:SCN-002 | M-03 |
| room-booking-api:SCN-003 | M-04 |
| room-booking-api:SCN-004 | M-03 |
| room-booking-api:CTR-001 | M-02 |
| room-booking-api:CTR-002 | M-02 |
| room-booking-api:CTR-003 | M-03 |
| room-booking-api:CTR-004 | M-04 |
| room-booking-api:CTR-005 | M-04 |
| room-booking-api:CTR-006 | M-04 |
| room-booking-api:CTR-007 | M-05 |
| room-booking-api:INV-001 | M-01 |
| room-booking-api:INV-002 | M-01 |
| room-booking-api:INV-003 | M-01 |
| room-booking-api:INV-004 | M-05 |
| room-booking-api:INV-005 | M-01 |
| room-booking-api:INV-006 | M-01 |
| room-booking-api:INV-007 | M-01 |
| room-booking-api:POL-001 | M-01 |
| room-booking-api:POL-002 | M-05 |
| room-booking-api:CN-001 | M-06 |
| room-booking-api:CN-002 | M-06 |
| room-booking-api:CN-003 | M-06 |

## 9. Revisions

none
