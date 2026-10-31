# roomy — a meeting room booking HTTP API

Build a small HTTP API in TypeScript that manages meeting rooms and their bookings. State is kept in memory; it is lost when the process stops.

## Running

- The server listens on the port given by the environment variable `PORT`; default `3000`.
- Start it with `npm start` after `npm run build`.

## Data

- A room: `{ "id": "<id>", "name": "<string>", "capacity": <integer> }`. `id` is assigned by the server: `r1`, `r2`, ... in creation order.
- A booking: `{ "id": "<id>", "roomId": "<room id>", "title": "<string>", "start": "<ISO-8601 UTC>", "end": "<ISO-8601 UTC>", "attendees": <integer> }`. `id` is assigned by the server: `b1`, `b2`, ... in creation order, across all rooms.
- Times are ISO-8601 strings in UTC with a `Z` suffix and minute precision, for example `2026-11-02T09:30:00Z`. Booking intervals are half-open: a booking ending at 10:00 and another starting at 10:00 do not overlap.

## Endpoints

### `POST /rooms`

Body `{ "name": "<non-empty string, at most 40 characters>", "capacity": <integer 1..100> }`.

- Success: `201` with the room.
- Invalid name or capacity: `400` with `{ "error": "invalid_room" }`.
- A name already used by another room (case-insensitive): `409` with `{ "error": "room_name_taken" }`.

### `GET /rooms`

- `200` with `{ "rooms": [<room>, ...] }` ordered by id.
- Optional query `minCapacity=<integer>`: only rooms whose capacity is at least that value. A value that is not a positive integer responds `400` with `{ "error": "invalid_query" }`.

### `POST /rooms/:roomId/bookings`

Body `{ "title": "<non-empty string, at most 80 characters>", "start": "<time>", "end": "<time>", "attendees": <integer >= 1> }`.

- Success: `201` with the booking.
- Unknown room: `404` with `{ "error": "room_not_found" }`.
- Invalid title, unparseable time, a time not on a whole minute, `end` not after `start`, or a booking longer than 8 hours: `400` with `{ "error": "invalid_booking" }`.
- `attendees` greater than the room's capacity: `422` with `{ "error": "over_capacity" }`.
- An interval overlapping an existing booking of the same room: `409` with `{ "error": "room_busy", "conflictingBookingId": "<id>" }` naming the earliest-starting conflicting booking.

### `GET /rooms/:roomId/bookings`

- `200` with `{ "bookings": [<booking>, ...] }` ordered by `start`, then by id.
- Optional query `from=<time>&to=<time>`: only bookings that overlap the half-open interval `[from, to)`. Both must be given together and valid with `to` after `from`; otherwise `400` with `{ "error": "invalid_query" }`.
- Unknown room: `404` with `{ "error": "room_not_found" }`.

### `DELETE /bookings/:bookingId`

- Known booking: `204`; the interval becomes free for new bookings.
- Unknown booking: `404` with `{ "error": "booking_not_found" }`.

### `GET /availability`

Query `start=<time>&end=<time>&attendees=<integer>`, all required.

- `200` with `{ "rooms": [<room>, ...] }`: every room with capacity at least `attendees` that has no booking overlapping `[start, end)`, ordered by capacity ascending, then by id.
- A missing or invalid parameter, or `end` not after `start`: `400` with `{ "error": "invalid_query" }`.

## General rules

- Every error response is JSON with an `error` field holding a stable snake_case code (plus `conflictingBookingId` for `room_busy`).
- Responses carry `Content-Type: application/json` except the `204`.
- A request body that is not valid JSON responds `400` with `{ "error": "invalid_json" }`.
- Unknown routes respond `404` with `{ "error": "not_found" }`; a known route with an unsupported method responds `405` with `{ "error": "method_not_allowed" }`.

## Non-goals

- No persistence, authentication, recurring bookings, time zones other than UTC, or room updates and deletion.

## Acceptance

`npm run build` compiles, `npm test` passes. Tests may start the server on an ephemeral port.
