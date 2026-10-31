# Technical design: room-booking-api

## 1. Overview

`roomy` is a self-contained HTTP API in TypeScript, served by a process that binds the port named by the environment variable `PORT` (3000 when unset) and holds every room and booking in its own memory. Four documented paths (`/rooms`, `/rooms/:roomId/bookings`, `/bookings/:bookingId`, `/availability`) are answered from that in-memory state in a fixed check order: unknown path, unsupported method, body syntax, endpoint rules. Every error is a JSON object carrying one stable snake_case code, and every response carries `Content-Type: application/json` except the bodiless `204`. No outbound network call and no runtime dependency is used: the whole surface is built on `node:http` and the standard library. The process is started with `npm start` after `npm run build`.

## 2. Module map

### M-01 errors
- responsibility: Owns the closed set of error codes, the HTTP status each code maps to, and the JSON error envelope every rejected request is answered with.
- covers: [room-booking-api:POL-001, room-booking-api:INV-003, room-booking-api:INV-004]
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

  export interface ErrorBody {
    error: ErrorCode;
    conflictingBookingId?: string;
  }

  export interface ApiError {
    status: number;
    body: ErrorBody;
  }

  export function apiError(code: ErrorCode): ApiError;
  export function roomBusyError(conflictingBookingId: string): ApiError;
  export function statusFor(code: ErrorCode): number;
  export function isApiError(value: unknown): value is ApiError;
  ```
- notes: Raises `invalid_json`, `not_found`, `method_not_allowed`, `invalid_room`, `room_name_taken`, `invalid_query`, `room_not_found`, `invalid_booking`, `over_capacity`, `room_busy`, `booking_not_found`. `statusFor` is the single status table: 400 `invalid_json`/`invalid_room`/`invalid_query`/`invalid_booking`, 404 `not_found`/`room_not_found`/`booking_not_found`, 405 `method_not_allowed`, 409 `room_name_taken`/`room_busy`, 422 `over_capacity`. `conflictingBookingId` appears only in a `room_busy` body. Holds no state.

### M-02 state
- responsibility: Holds the in-memory rooms and bookings, assigns the `rN`/`bN` id sequences, parses the accepted time spellings into instants, and answers the state queries (listing, lookup, removal, overlap) the endpoint modules read.
- covers: [room-booking-api:INV-001, room-booking-api:INV-002, room-booking-api:INV-005, room-booking-api:INV-007, room-booking-api:INV-008]
- owns: src/state/**
- entry: src/state/index.ts
- depends_on: []
- public interface:
  ```ts
  export interface Room {
    id: string;
    name: string;
    capacity: number;
  }

  export interface Booking {
    id: string;
    roomId: string;
    title: string;
    start: string;
    end: string;
    attendees: number;
  }

  export function parseInstant(text: string): number | undefined;
  export function listRooms(): Room[];
  export function findRoom(roomId: string): Room | undefined;
  export function addRoom(name: string, capacity: number): Room;
  export function addBooking(
    roomId: string,
    title: string,
    start: string,
    end: string,
    attendees: number,
  ): Booking;
  export function findBooking(bookingId: string): Booking | undefined;
  export function listBookingsOfRoom(roomId: string): Booking[];
  export function removeBooking(bookingId: string): boolean;
  export function overlappingBookings(roomId: string, from: number, to: number): Booking[];
  ```
- notes: Raises no error code: every query returns a value or `undefined`, and the endpoint modules turn that into a code. State is two module-level arrays plus two monotonic counters (`rN` for rooms, `bN` for bookings across all rooms); ids are never reused after a removal. `listRooms` and `listBookingsOfRoom` return response-shaped objects holding exactly the documented field sets; `listBookingsOfRoom` returns bookings in start order then id order, and `overlappingBookings` returns the bookings of one room whose half-open interval overlaps `[from, to)` with `from`/`to` in epoch milliseconds, in start order then id order. `parseInstant` accepts exactly the spellings of DD-04 and returns epoch milliseconds, or `undefined` for any other string.

### M-03 rooms
- responsibility: Serves `POST /rooms` and `GET /rooms`: validates a room body, enforces the case-insensitive name uniqueness, assigns the next room id, and filters the room list by `minCapacity`.
- covers: [room-booking-api:CTR-001, room-booking-api:CTR-002, room-booking-api:BEH-001, room-booking-api:BEH-002, room-booking-api:BEH-003, room-booking-api:BEH-004, room-booking-api:BEH-005, room-booking-api:BEH-006, room-booking-api:BEH-024, room-booking-api:BEH-027]
- owns: src/rooms/**
- entry: src/rooms/index.ts
- depends_on: [M-01, M-02]
- public interface:
  ```ts
  import type { ApiError } from "../errors/index.js";
  import type { Room } from "../state/index.js";

  export function createRoom(body: unknown): { room: Room } | ApiError;
  export function listRooms(query: URLSearchParams): { rooms: Room[] } | ApiError;
  ```
- notes: `createRoom` raises `invalid_room` (name not a non-empty string of at most 40 code points, or capacity not an integer in 1..100, or the body is valid JSON that is not an object) and `room_name_taken` (name equals an existing name under lowercased comparison); `invalid_room` is decided before `room_name_taken`. `listRooms` raises `invalid_query` when `minCapacity` is present and is not a positive integer, and returns rooms in numeric id order otherwise. `query` is the parsed query string; a parameter absent from it is absent for the endpoint.

### M-04 booking-write
- responsibility: Serves `POST /rooms/:roomId/bookings` and `DELETE /bookings/:bookingId`: validates a booking body, enforces capacity and overlap, assigns the next booking id across all rooms, and removes a booking so that its interval becomes bookable again.
- covers: [room-booking-api:CTR-003, room-booking-api:CTR-005, room-booking-api:BEH-007, room-booking-api:BEH-008, room-booking-api:BEH-009, room-booking-api:BEH-010, room-booking-api:BEH-011, room-booking-api:BEH-012, room-booking-api:BEH-017, room-booking-api:BEH-018, room-booking-api:BEH-026, room-booking-api:SCN-001, room-booking-api:SCN-002, room-booking-api:SCN-003]
- owns: src/bookings/write/**
- entry: src/bookings/write/index.ts
- depends_on: [M-01, M-02]
- public interface:
  ```ts
  import type { ApiError } from "../../errors/index.js";
  import type { Booking } from "../../state/index.js";

  export function createBooking(roomId: string, body: unknown): { booking: Booking } | ApiError;
  export function deleteBooking(bookingId: string): { deleted: true } | ApiError;
  ```
- notes: `createBooking` decides `room_not_found` first, then `invalid_booking`, then `over_capacity`, then `room_busy` with `conflictingBookingId` naming the earliest-starting conflicting booking (lowest id on a start tie); the stored `start` and `end` are the request strings character for character. `deleteBooking` returns `{ deleted: true }` for a known booking and `booking_not_found` otherwise; a second delete of the same id is `booking_not_found`. Raises `room_not_found`, `invalid_booking`, `over_capacity`, `room_busy`, `booking_not_found`.

### M-05 booking-read
- responsibility: Serves `GET /rooms/:roomId/bookings`: lists the bookings of one room in start-then-id order and applies the optional `from`/`to` half-open window filter.
- covers: [room-booking-api:CTR-004, room-booking-api:BEH-013, room-booking-api:BEH-014, room-booking-api:BEH-015, room-booking-api:BEH-016]
- owns: src/bookings/read/**
- entry: src/bookings/read/index.ts
- depends_on: [M-01, M-02]
- public interface:
  ```ts
  import type { ApiError } from "../../errors/index.js";
  import type { Booking } from "../../state/index.js";

  export function listBookings(
    roomId: string,
    query: URLSearchParams,
  ): { bookings: Booking[] } | ApiError;
  ```
- notes: Decides `invalid_query` first (only one of `from`/`to` given, a time not an accepted spelling, `to` not after `from`), then `room_not_found`. Returns stored `start` and `end` strings unmodified.

### M-06 availability
- responsibility: Serves `GET /availability`: returns the rooms whose capacity is at least `attendees` and which have no booking overlapping the requested window, ordered by capacity then id.
- covers: [room-booking-api:CTR-006, room-booking-api:BEH-019, room-booking-api:BEH-020]
- owns: src/availability/**
- entry: src/availability/index.ts
- depends_on: [M-01, M-02]
- public interface:
  ```ts
  import type { ApiError } from "../errors/index.js";
  import type { Room } from "../state/index.js";

  export function findAvailableRooms(query: URLSearchParams): { rooms: Room[] } | ApiError;
  ```
- notes: Raises `invalid_query` when `start`, `end` or `attendees` is missing, when `start` or `end` is not an accepted time spelling, when `attendees` is not an integer, or when `end` is not after `start`. Any integer `attendees` value is accepted, including 0 and negative values, and such a value passes the capacity test for every room while the overlap test still excludes busy rooms.

### M-07 routing
- responsibility: Matches a request method and path against the four documented route patterns and reports either the matched route with its path parameters or the routing error the request earns.
- covers: [room-booking-api:CTR-008, room-booking-api:BEH-022, room-booking-api:BEH-023]
- owns: src/routing/**
- entry: src/routing/index.ts
- depends_on: [M-01]
- public interface:
  ```ts
  import type { ApiError } from "../errors/index.js";

  export type RouteName = "rooms" | "roomBookings" | "booking" | "availability";

  export interface RouteMatch {
    name: RouteName;
    method: "GET" | "POST" | "DELETE";
    params: Readonly<Record<string, string>>;
  }

  export function matchRoute(method: string, path: string): RouteMatch | ApiError;
  ```
- notes: Raises `not_found` when the path matches no route pattern, and `method_not_allowed` when the path matches a pattern but not with that method. `params` carries `roomId` for `roomBookings` and `bookingId` for `booking`. Method comparison uses the upper-cased request method; the path is compared without its query string.

### M-08 root
- responsibility: Wires the modules into one HTTP handler and one process: reads the request line and body, applies the fixed check order, dispatches to the endpoint modules, writes the response envelope, and starts the server on the `PORT` port.
- covers: [room-booking-api:BEH-021, room-booking-api:BEH-025, room-booking-api:INV-006, room-booking-api:POL-002, room-booking-api:CON-001, room-booking-api:CON-002, room-booking-api:CON-003, room-booking-api:NFR-001, room-booking-api:NFR-002]
- owns: src/index.ts
- entry: src/index.ts
- depends_on: [M-01, M-02, M-03, M-04, M-05, M-06, M-07]
- public interface:
  ```ts
  import type { IncomingMessage, ServerResponse, Server } from "node:http";

  export function createHandler(): (request: IncomingMessage, response: ServerResponse) => void;
  export function startServer(): Promise<Server>;
  ```
- notes: Keeps the check order route, method, body syntax, endpoint rules: `not_found` before `method_not_allowed` before `invalid_json` before any endpoint code. Ignores the request `Content-Type`, accepts an absent body (zero bytes) on every route, ignores a present body that is valid JSON where the route documents none, and answers a present body that is not valid JSON with `invalid_json`. Writes JSON bodies with `Content-Type: application/json`, writes the `204` with no body and no `Content-Type`, and never lets a request terminate or wedge the process. This task also owns `tsconfig.build.json` and the `build` and `start` scripts of `package.json` (DD-14).

## 3. Data shapes

```ts
// covers: room-booking-api:POL-001, room-booking-api:INV-003
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

// covers: room-booking-api:INV-003, room-booking-api:CTR-003
export interface ErrorBody {
  error: ErrorCode;
  conflictingBookingId?: string;
}

// covers: room-booking-api:INV-003, room-booking-api:INV-004
export interface ApiError {
  status: number;
  body: ErrorBody;
}

// covers: room-booking-api:CTR-001, room-booking-api:INV-008
export interface Room {
  id: string;
  name: string;
  capacity: number;
}

// covers: room-booking-api:CTR-003, room-booking-api:INV-008
export interface Booking {
  id: string;
  roomId: string;
  title: string;
  start: string;
  end: string;
  attendees: number;
}

// covers: room-booking-api:CTR-008
export type RouteName = "rooms" | "roomBookings" | "booking" | "availability";

// covers: room-booking-api:CTR-008
export interface RouteMatch {
  name: RouteName;
  method: "GET" | "POST" | "DELETE";
  params: Readonly<Record<string, string>>;
}
```

`Room` and `Booking` are the exact response objects: no field is added to them and none is dropped. `start` and `end` are the request strings of the creating call, never re-formatted.

## 4. Error mapping

| code | raising module | status | response body |
| --- | --- | --- | --- |
| `invalid_json` | M-08 root | 400 | `{"error":"invalid_json"}` |
| `not_found` | M-07 routing | 404 | `{"error":"not_found"}` |
| `method_not_allowed` | M-07 routing | 405 | `{"error":"method_not_allowed"}` |
| `invalid_room` | M-03 rooms | 400 | `{"error":"invalid_room"}` |
| `room_name_taken` | M-03 rooms | 409 | `{"error":"room_name_taken"}` |
| `invalid_query` | M-03 rooms (`minCapacity`), M-05 booking-read (`from`/`to`), M-06 availability (`start`/`end`/`attendees`) | 400 | `{"error":"invalid_query"}` |
| `room_not_found` | M-04 booking-write, M-05 booking-read | 404 | `{"error":"room_not_found"}` |
| `invalid_booking` | M-04 booking-write | 400 | `{"error":"invalid_booking"}` |
| `over_capacity` | M-04 booking-write | 422 | `{"error":"over_capacity"}` |
| `room_busy` | M-04 booking-write | 409 | `{"error":"room_busy","conflictingBookingId":"<booking id>"}` |
| `booking_not_found` | M-04 booking-write | 404 | `{"error":"booking_not_found"}` |

No code exists outside this table, no error body carries a field other than `error` and, for `room_busy`, `conflictingBookingId`. The process has no exit-code contract for request handling: every request, valid or invalid, is answered with a documented status and the process keeps listening; only a startup failure ends the process (DD-14).

## 5. Process and IO boundaries

- argv: the process takes no arguments; `npm start` runs `node dist/index.js`.
- env: `PORT` is read once at startup. Unset, the server binds 3000. Set to a base-10 non-negative integer, it binds that port; `PORT=0` binds an ephemeral port. A `PORT` value that is not a base-10 non-negative integer ends the process with exit code 1 and one message on stderr.
- listen: host is the default of `server.listen(port)` (all interfaces); the server accepts HTTP/1.1 requests and sends HTTP/1.1 responses.
- request body: read as UTF-8 bytes into one buffer. Zero bytes is an absent body. Any non-zero body is parsed with `JSON.parse`; a parse error yields `invalid_json`. The request `Content-Type` header is never inspected.
- response body: UTF-8 JSON, `Content-Type: application/json`, for every response carrying a body. The `204` of `DELETE /bookings/:bookingId` carries no body and no `Content-Type`.
- paths and query strings: the path is the URL path before `?`, decoded once; the query string is read through `URLSearchParams` and a parameter is read with `get`, so its first occurrence decides its value and an empty value counts as present and empty.
- stdout/stderr: request handling writes nothing to either stream; the only stderr write is the startup failure message of the `PORT` rule above.
- state: rooms and bookings live in the process memory only; a restarted process starts empty and assigns `r1` to its first room again.
- files: `package.json` scripts `build` (`tsc -p tsconfig.build.json`) and `start` (`node dist/index.js`), `tsconfig.build.json` (`include: ["src"]`, `rootDir: "src"`, `outDir: "dist"`, `noEmit: false`).

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

### DD-01 Plain node:http server, no framework
- evidence: [room-booking-api:CON-002, room-booking-api:CON-001]
- decision: The server is built on the `node:http` module and the standard library only: no router, no validation or HTTP package is added to `dependencies`.
- alternatives_rejected: An HTTP framework or schema validator, which would add a runtime dependency the package may not declare.
- consequence: Routing, body reading and JSON writing are written in the product; M-07 owns the route table and M-08 owns the request/response plumbing.

### DD-02 One error table and one envelope in the errors module
- evidence: [room-booking-api:POL-001, room-booking-api:INV-003, room-booking-api:CTR-003]
- decision: Every endpoint module returns either its success value or an `ApiError` produced by `apiError`/`roomBusyError`; the status table and the envelope live only in M-01, and M-08 serialises `error.body` as the response body.
- alternatives_rejected: Each endpoint module choosing its own status and body shape, which lets codes and statuses drift apart.
- consequence: A status is set in exactly one place and every error response has the same envelope by construction.

### DD-03 Unknown body fields are ignored and never echoed
- evidence: [room-booking-api:BEH-024]
- decision: Room and booking body validation reads only the documented fields; any other field is dropped and never appears in a response.
- alternatives_rejected: Rejecting a body carrying an unknown field, which would add a validation rule the contract does not state.
- consequence: An extra field cannot rescue an invalid body and cannot fail a valid one.

### DD-04 Accepted time spellings and verbatim echo
- evidence: [room-booking-api:BEH-026, room-booking-api:CTR-003, room-booking-api:BEH-009]
- decision: `parseInstant` accepts exactly `YYYY-MM-DDTHH:MMZ`, `YYYY-MM-DDTHH:MM:SSZ` and `YYYY-MM-DDTHH:MM:SS.sssZ` with month, day, hour and minute in range, seconds present only as `00`, and a fraction present only as `.000`; it returns epoch milliseconds for those and `undefined` for everything else, including any string ending in an explicit offset. The booking keeps the request strings, so a booking created with `2026-11-02T09:30Z` reports that string back.
- alternatives_rejected: Accepting an explicit offset and converting it to UTC, which would force a re-format of the reported string; accepting non-zero seconds and truncating them.
- consequence: Whether a time is on a whole minute is decided by the accepted spelling itself, so `...:30:30Z` is invalid_booking and `...:31:00.000Z` is stored as given.

### DD-05 An integral JSON number is an integer, a numeric string is not
- evidence: [room-booking-api:BEH-027, room-booking-api:BEH-002, room-booking-api:CTR-003]
- decision: A body field documented as an integer is accepted when it is a JSON number whose value is integral (`8.0` included) and rejected when it is a string or carries a non-zero fraction.
- alternatives_rejected: Requiring the literal absence of a fraction, which would reject `8.0`; coercing numeric strings, which would accept `"8"`.
- consequence: `capacity: 8.0` stores `8`; `capacity: "8"` and `attendees: 2.5` are invalid_room and invalid_booking.

### DD-06 Names are measured in code points and compared lowercased
- evidence: [room-booking-api:BEH-002, room-booking-api:BEH-003]
- decision: The 40-character room-name limit counts code points of the string, and name uniqueness compares both names lowercased with the runtime `toLowerCase` mapping.
- alternatives_rejected: Counting UTF-16 code units, which rejects 40-character names outside the basic plane; comparing ASCII case only.
- consequence: `Aurora` and `AURORA` collide, and a 40-code-point name is accepted.

### DD-07 In-memory store with two monotonic id counters
- evidence: [room-booking-api:INV-001, room-booking-api:INV-005, room-booking-api:SCN-002]
- decision: M-02 holds two arrays and two counters in module scope: room ids are `r` plus the next room counter value, booking ids are `b` plus the next booking counter value, and counters only increase, including across deletions.
- alternatives_rejected: A per-room booking counter, which reuses ids; a persistable store, which no record allows.
- consequence: Booking ids increase by one per created booking across all rooms, a deleted id is never handed out again, and a restarted process starts at 1 with an empty state.

### DD-08 Id ordering is numeric
- evidence: [room-booking-api:INV-007, room-booking-api:BEH-004]
- decision: Ordering by id parses the number after the `r` or `b` prefix and compares the numbers, so `r2` precedes `r10`.
- alternatives_rejected: Lexicographic comparison of the id strings.
- consequence: The creation order and the id order coincide in every response.

### DD-09 Half-open intervals and the overlap predicate
- evidence: [room-booking-api:INV-002, room-booking-api:BEH-011, room-booking-api:BEH-012]
- decision: Intervals are compared as epoch milliseconds and `[aStart, aEnd)` overlaps `[bStart, bEnd)` exactly when `aStart < bEnd && bStart < aEnd`; the same predicate serves the conflict check, the `from`/`to` filter and the availability test.
- alternatives_rejected: Closed-interval comparison, which treats touching bookings as conflicting; `<=` on the endpoints.
- consequence: A booking starting exactly at another booking's end is accepted.

### DD-10 `conflictingBookingId` is the earliest-starting conflict, lowest id on a tie
- evidence: [room-booking-api:BEH-011, room-booking-api:SCN-003]
- decision: Among the overlapping bookings of the room, the named one has the smallest start instant and, among equal starts, the smallest booking number.
- alternatives_rejected: Naming the first conflicting booking in creation order, which is not the earliest start; naming any conflict.
- consequence: `conflictingBookingId` is deterministic for the same state.

### DD-11 Body handling in the composition root
- evidence: [room-booking-api:BEH-025, room-booking-api:BEH-021, room-booking-api:INV-006]
- decision: M-08 reads the body once, treats zero bytes as absent, parses any non-zero body with `JSON.parse`, answers `invalid_json` on a parse error after the route and method checks and before any endpoint rule, and passes the parsed value as `unknown` to the endpoint module, which validates its own fields.
- alternatives_rejected: Parsing per route (repeats the rule), and skipping the parse on routes that document no body (a malformed body would then be answered `200`).
- consequence: A malformed body is `invalid_json` on every route while an absent body is never an error, and the request `Content-Type` is irrelevant.

### DD-12 Every path matching a route pattern is a known path
- evidence: [room-booking-api:CTR-008, room-booking-api:BEH-023]
- decision: The route table maps each documented path pattern to the methods it supports; a path matching a pattern with an unsupported method earns `method_not_allowed`, so `GET /bookings/b1` and `DELETE /availability` are 405 and only an unmatched path earns `not_found`.
- alternatives_rejected: Treating a path as known only for its documented methods, which would answer `not_found` to a method mismatch.
- consequence: `not_found` is reserved for paths outside the four patterns, such as `/`, `/nope` and `/rooms/r1`.

### DD-13 Query parameter reading
- evidence: [room-booking-api:CTR-002, room-booking-api:BEH-006, room-booking-api:BEH-020]
- decision: Query parameters are read through `URLSearchParams.get`, so a repeated parameter takes its first value and `?minCapacity=` counts as present with the empty value, which fails the positive-integer test; a text parameter documented as an integer must match `^[0-9]+$` for `minCapacity` and `^-?[0-9]+$` for `attendees`.
- alternatives_rejected: Reading the last value of a repeated parameter; treating an empty value as absent, which would silently drop the filter.
- consequence: `minCapacity=8.0`, `minCapacity=`, `minCapacity=0` and `minCapacity=-1` are `invalid_query`; `attendees=-2` is a valid availability query.

### DD-14 Build output, start command and port selection
- evidence: [room-booking-api:CON-003, room-booking-api:NFR-001]
- decision: `npm run build` runs `tsc -p tsconfig.build.json`, a separate emitting config over `src` with `rootDir: "src"` and `outDir: "dist"`, and `npm start` runs `node dist/index.js`. `startServer` reads `PORT`, uses 3000 when it is unset, passes any base-10 non-negative integer to `listen`, and ends the process with exit code 1 and one stderr message when the value is anything else. The type-checking `tsconfig.json` stays non-emitting so that `npx tsc --noEmit` covers `src` and `tests` together.
- alternatives_rejected: Emitting from `tsconfig.json`, which breaks the verifier over the test files; a bundler, which adds a dependency.
- consequence: `npm run build` exits 0 with `dist/` produced, `npm test` exercises the source, and the acceptance start `npm start` serves the built artefact on `PORT`.

### DD-15 Availability accepts any integer `attendees`
- evidence: [room-booking-api:BEH-020, room-booking-api:CTR-006]
- decision: `attendees` on `GET /availability` is any integer, so 0 and negative values are accepted; such a value passes the capacity test for every room and the overlap test still excludes busy rooms. Only a value that is not an integer is `invalid_query`.
- alternatives_rejected: Requiring a positive integer, which adds a validation the contract does not state.
- consequence: `attendees=9` with no room of that capacity returns `{"rooms":[]}` and never `invalid_query`.

### DD-16 Deleting a booking frees its interval and removes it from every query
- evidence: [room-booking-api:BEH-017, room-booking-api:INV-001, room-booking-api:SCN-001]
- decision: `removeBooking` splices the booking out of the store; the conflict check, the room booking list and the availability test read only the surviving bookings.
- alternatives_rejected: Marking a booking deleted and filtering it at read time, which keeps a flag no response field can show.
- consequence: A second delete of the same id is `booking_not_found`, the freed interval accepts a new booking, and the id of the removed booking is never reused.

## 8. Traceability

| spec id | module |
| --- | --- |
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
| room-booking-api:BEH-017 | M-04 |
| room-booking-api:BEH-018 | M-04 |
| room-booking-api:BEH-019 | M-06 |
| room-booking-api:BEH-020 | M-06 |
| room-booking-api:BEH-021 | M-08 |
| room-booking-api:BEH-022 | M-07 |
| room-booking-api:BEH-023 | M-07 |
| room-booking-api:BEH-024 | M-03 |
| room-booking-api:BEH-025 | M-08 |
| room-booking-api:BEH-026 | M-04 |
| room-booking-api:BEH-027 | M-03 |
| room-booking-api:SCN-001 | M-04 |
| room-booking-api:SCN-002 | M-04 |
| room-booking-api:SCN-003 | M-04 |
| room-booking-api:CTR-001 | M-03 |
| room-booking-api:CTR-002 | M-03 |
| room-booking-api:CTR-003 | M-04 |
| room-booking-api:CTR-004 | M-05 |
| room-booking-api:CTR-005 | M-04 |
| room-booking-api:CTR-006 | M-06 |
| room-booking-api:CTR-008 | M-07 |
| room-booking-api:INV-001 | M-02 |
| room-booking-api:INV-002 | M-02 |
| room-booking-api:INV-003 | M-01 |
| room-booking-api:INV-004 | M-01 |
| room-booking-api:INV-005 | M-02 |
| room-booking-api:INV-006 | M-08 |
| room-booking-api:INV-007 | M-02 |
| room-booking-api:INV-008 | M-02 |
| room-booking-api:POL-001 | M-01 |
| room-booking-api:POL-002 | M-08 |
| room-booking-api:CON-001 | M-08 |
| room-booking-api:CON-002 | M-08 |
| room-booking-api:CON-003 | M-08 |
| room-booking-api:NFR-001 | M-08 |
| room-booking-api:NFR-002 | M-08 |

## 9. Revisions

none
