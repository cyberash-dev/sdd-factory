# Verification design: room-booking-api

## 1. Scope

Every approved record of template Behavior, Contract, Invariant, Scenario, NFR or Policy gets exactly one block, in spec order.

| template | blocks | ids |
| --- | --- | --- |
| Behavior | 27 | BEH-001 .. BEH-027 |
| Contract | 7 | CTR-001, CTR-002, CTR-003, CTR-004, CTR-005, CTR-006, CTR-008 |
| Invariant | 8 | INV-001 .. INV-008 |
| Scenario | 3 | SCN-001, SCN-002, SCN-003 |
| NFR | 2 | NFR-001, NFR-002 |
| Policy | 2 | POL-001, POL-002 |
| **total** | **49** | |

Skipped, with the reason:

- `room-booking-api` (Partition): not normative for the product boundary.
- `room-booking-api:BL-001` (BrownfieldBaseline): a discovery artefact, it states no behaviour.
- `room-booking-api:SUR-001` (Surface): names the boundary and its members; its members carry the obligations.
- `room-booking-api:CON-001`, `CON-002`, `CON-003` (Constraint): outside the block templates this stage derives verification blocks for.
- `room-booking-api:OQ-001` .. `OQ-010` (Open-Q): questions, not obligations; the answers in force reach the blocks through the ASSUMPTION records they are referenced by.
- `room-booking-api:ASM-001` .. `ASM-010` (ASSUMPTION): the assumption in force is already reflected in the Behaviour and Contract records that cite it, so a separate block would duplicate one.

Reading convention for the blocks: where an expected value writes an id such as `r2` or `b1` inside a response body, it denotes the room or booking object carrying that id, not a bare string in the body. A shorthand such as `[r2, r3]` denotes the `rooms` array holding those two room objects in that order. A time written only as `HH:MM:SSZ` inside an interval or an input denotes that time on `2026-11-02`; a time written as a full timestamp is used verbatim as the request string.

## 2. Error oracle

Every code below is taken from the `error_taxonomy` of the named Contract; POL-001 fixes the set and forbids any other form of error reporting. The error body is always a JSON object and the code sits in the `error` field.

| error code | observable signal | source record |
| --- | --- | --- |
| `invalid_json` | HTTP 400, body `{"error":"invalid_json"}`, on any route and method when a supplied body is not valid JSON | CTR-001, CTR-002, CTR-003, CTR-004, CTR-005, CTR-006, POL-001 |
| `not_found` | HTTP 404, body `{"error":"not_found"}`, when the path matches no route | CTR-001, CTR-002, CTR-003, CTR-004, CTR-005, CTR-006, CTR-008, POL-001 |
| `method_not_allowed` | HTTP 405, body `{"error":"method_not_allowed"}`, when the path is known and the method is not supported there | CTR-001, CTR-002, CTR-003, CTR-004, CTR-005, CTR-006, CTR-008, POL-001 |
| `invalid_room` | HTTP 400, body `{"error":"invalid_room"}`, when name or capacity is outside the shape or the body is valid JSON that is not an object | CTR-001, POL-001 |
| `room_name_taken` | HTTP 409, body `{"error":"room_name_taken"}`, when the name equals another room name case-insensitively | CTR-001, POL-001 |
| `invalid_query` | HTTP 400, body `{"error":"invalid_query"}`, when a query parameter is missing, malformed or out of order | CTR-002, CTR-004, CTR-006, POL-001 |
| `room_not_found` | HTTP 404, body `{"error":"room_not_found"}`, when no room carries the roomId | CTR-003, CTR-004, POL-001 |
| `invalid_booking` | HTTP 400, body `{"error":"invalid_booking"}`, when a booking body field is outside the shape, a time is not whole-minute or end is not after start, the duration exceeds 8 hours, or the body is valid JSON that is not an object | CTR-003, POL-001 |
| `over_capacity` | HTTP 422, body `{"error":"over_capacity"}`, when attendees exceeds the room capacity | CTR-003, POL-001 |
| `room_busy` | HTTP 409, body `{"error":"room_busy","conflictingBookingId":"<id of the earliest-starting conflicting booking>"}`, when the interval overlaps an existing booking of the room | CTR-003, POL-001 |
| `booking_not_found` | HTTP 404, body `{"error":"booking_not_found"}`, when no booking carries the bookingId | CTR-005, POL-001 |

An invariant whose negative case is a property violation of a successful response rather than a rejected request (a reused id, a wrong response header, a lexicographic order, an extra object field) has no error code: such a block carries no negative oracle entry and states the violated property in its assertion summary instead. Every other block names the code of each failure class.

## 3. Blocks

### room-booking-api:BEH-001

```yaml
id: room-booking-api:BEH-001
template: Behavior
obligation: "a valid create body yields 201 with a room object carrying the next rN id"
input_classes:
  - name: empty_store
    input: "POST /rooms on a freshly started process, body {\"name\":\"Aurora\",\"capacity\":8}"
    expected: "status 201, Content-Type application/json, body {\"id\":\"r1\",\"name\":\"Aurora\",\"capacity\":8}"
  - name: typical_second_room
    input: "POST /rooms, body {\"name\":\"Birch\",\"capacity\":4}, after r1 exists"
    expected: "status 201, body {\"id\":\"r2\",\"name\":\"Birch\",\"capacity\":4}"
  - name: boundary_capacity_one
    input: "POST /rooms, body {\"name\":\"Nook\",\"capacity\":1}"
    expected: "status 201, body {\"id\":\"r3\",\"name\":\"Nook\",\"capacity\":1}"
  - name: invalid_absent_capacity
    input: "POST /rooms, body {\"name\":\"Aurora\"}"
    expected: "error code invalid_room; status 400"
  - name: invalid_repeated_body
    input: "POST /rooms, body {\"name\":\"Aurora\",\"capacity\":8}, sent again after r1 exists"
    expected: "error code room_name_taken; status 409"
negative_oracle:
  - input_class: invalid_absent_capacity
    must_fail_with: "invalid_room"
    must_not: "a 201 response carrying a room object"
  - input_class: invalid_repeated_body
    must_fail_with: "room_name_taken"
    must_not: "a second room object in the GET /rooms response"
assertion_summary:
  - "the create response has status 201 and the header Content-Type application/json"
  - "the response body keys are exactly id, name and capacity, and the first room of a fresh process carries id r1"
  - "GET /rooms after the create returns a rooms array holding the created room object"
  - "after invalid_absent_capacity the rooms array is byte-identical to the array read before the request"
feasibility: feasible
```

### room-booking-api:BEH-002

```yaml
id: room-booking-api:BEH-002
template: Behavior
obligation: "each out-of-shape name or capacity yields 400 invalid_room and leaves state unchanged"
input_classes:
  - name: typical_valid
    input: "POST /rooms, body {\"name\":\"Aurora\",\"capacity\":8}"
    expected: "status 201, body {\"id\":\"r1\",\"name\":\"Aurora\",\"capacity\":8}"
  - name: boundary_name_40
    input: "POST /rooms, body carrying name equal to the letter A repeated 40 times and capacity 1"
    expected: "status 201 with a room object echoing that 40-character name and capacity 1"
  - name: boundary_capacity_100
    input: "POST /rooms, body {\"name\":\"Hall\",\"capacity\":100}"
    expected: "status 201 with capacity 100 in the body"
  - name: invalid_empty_name
    input: "POST /rooms, body {\"name\":\"\",\"capacity\":8}"
    expected: "error code invalid_room; status 400"
  - name: invalid_name_41
    input: "POST /rooms, body carrying name equal to the letter A repeated 41 times and capacity 8"
    expected: "error code invalid_room; status 400"
  - name: invalid_capacity_0
    input: "POST /rooms, body {\"name\":\"Zero\",\"capacity\":0}"
    expected: "error code invalid_room; status 400"
  - name: invalid_capacity_101
    input: "POST /rooms, body {\"name\":\"Wide\",\"capacity\":101}"
    expected: "error code invalid_room; status 400"
  - name: invalid_absent_name
    input: "POST /rooms, body {\"capacity\":8}"
    expected: "error code invalid_room; status 400"
  - name: invalid_non_object_body
    input: "POST /rooms, body [] which is valid JSON but not an object"
    expected: "error code invalid_room; status 400"
negative_oracle:
  - input_class: invalid_empty_name
    must_fail_with: "invalid_room"
    must_not: "a 201 response carrying a room object"
  - input_class: invalid_name_41
    must_fail_with: "invalid_room"
    must_not: "a 201 response carrying a room object"
  - input_class: invalid_capacity_0
    must_fail_with: "invalid_room"
    must_not: "a room with capacity 0 in the GET /rooms response"
  - input_class: invalid_capacity_101
    must_fail_with: "invalid_room"
    must_not: "a room with capacity 101 in the GET /rooms response"
  - input_class: invalid_absent_name
    must_fail_with: "invalid_room"
    must_not: "a 201 response carrying a room object"
  - input_class: invalid_non_object_body
    must_fail_with: "invalid_room"
    must_not: "a 201 response carrying a room object"
assertion_summary:
  - "each invalid class answers status 400 with a body whose error field is exactly invalid_room"
  - "the rooms array read after each invalid class equals the array read before it"
  - "the boundary and typical classes answer status 201 with the submitted name and capacity echoed unchanged"
feasibility: feasible
```

### room-booking-api:BEH-003

```yaml
id: room-booking-api:BEH-003
template: Behavior
obligation: "a case-insensitive repeat of an existing name yields 409 room_name_taken"
input_classes:
  - name: typical_duplicate_same_case
    input: "a room named Aurora exists; POST /rooms, body {\"name\":\"Aurora\",\"capacity\":4}"
    expected: "error code room_name_taken; status 409"
  - name: boundary_duplicate_different_case
    input: "a room named Aurora exists; POST /rooms, body {\"name\":\"aurora\",\"capacity\":4}"
    expected: "error code room_name_taken; status 409"
  - name: boundary_distinct_name
    input: "a room named Aurora exists; POST /rooms, body {\"name\":\"Aurora 2\",\"capacity\":4}"
    expected: "status 201 with a room object carrying the next id and name Aurora 2"
  - name: boundary_after_rejected_name
    input: "POST /rooms body {\"name\":\"\",\"capacity\":4} then POST /rooms body {\"name\":\"Aurora 3\",\"capacity\":4}"
    expected: "status 400 invalid_room then status 201, the rejected name occupies no slot"
  - name: empty_name
    input: "POST /rooms, body {\"name\":\"\",\"capacity\":4}, after a room named Aurora exists"
    expected: "error code invalid_room; status 400"
negative_oracle:
  - input_class: typical_duplicate_same_case
    must_fail_with: "room_name_taken"
    must_not: "a 201 response carrying a room object"
  - input_class: boundary_duplicate_different_case
    must_fail_with: "room_name_taken"
    must_not: "a room count greater than one in the GET /rooms response"
  - input_class: empty_name
    must_fail_with: "invalid_room"
    must_not: "a 409 response whose error field is room_name_taken"
assertion_summary:
  - "both duplicate classes answer status 409 with the error field exactly room_name_taken"
  - "after each duplicate class the rooms array holds the single room named Aurora"
  - "the distinct-name class answers status 201 and the rooms array then holds two rooms"
feasibility: feasible
```

### room-booking-api:BEH-004

```yaml
id: room-booking-api:BEH-004
template: Behavior
obligation: "rooms are returned in id order with exactly the room fields"
input_classes:
  - name: empty_store
    input: "GET /rooms on a freshly started process"
    expected: "status 200, body {\"rooms\":[]}"
  - name: typical_one_room
    input: "room r1 with capacity 3 exists; GET /rooms"
    expected: "status 200, body {\"rooms\":[{\"id\":\"r1\",\"name\":\"Aurora\",\"capacity\":3}]}"
  - name: boundary_ten_rooms
    input: "ten rooms created in id order r1 .. r10; GET /rooms"
    expected: "status 200, the rooms array lists r1, r2, r3, r4, r5, r6, r7, r8, r9, r10 in that order"
  - name: invalid_min_capacity_zero
    input: "GET /rooms?minCapacity=0"
    expected: "error code invalid_query; status 400"
negative_oracle:
  - input_class: invalid_min_capacity_zero
    must_fail_with: "invalid_query"
    must_not: "a 200 response carrying a rooms array"
assertion_summary:
  - "the empty store answers status 200 with the rooms array present and empty, never 404"
  - "the ids of the ten-room response appear in numeric creation order, so r2 precedes r10"
  - "every room object in every response carries exactly the keys id, name and capacity"
feasibility: feasible
```

### room-booking-api:BEH-005

```yaml
id: room-booking-api:BEH-005
template: Behavior
obligation: "only rooms whose capacity is at least minCapacity are returned, in id order"
input_classes:
  - name: typical_exact_bound
    input: "rooms r1 capacity 3, r2 capacity 8, r3 capacity 8; GET /rooms?minCapacity=8"
    expected: "status 200, body {\"rooms\":[r2, r3]} in that order"
  - name: boundary_above_all
    input: "rooms r1 capacity 3, r2 capacity 8, r3 capacity 8; GET /rooms?minCapacity=9"
    expected: "status 200, body {\"rooms\":[]}"
  - name: boundary_smallest_capacity
    input: "rooms r1 capacity 3, r2 capacity 8, r3 capacity 8; GET /rooms?minCapacity=3"
    expected: "status 200, body {\"rooms\":[r1, r2, r3]} in that order"
  - name: absent_query
    input: "rooms r1 capacity 3, r2 capacity 8, r3 capacity 8; GET /rooms with no query string"
    expected: "status 200, body {\"rooms\":[r1, r2, r3]} in that order"
  - name: invalid_zero_bound
    input: "GET /rooms?minCapacity=0"
    expected: "error code invalid_query; status 400"
negative_oracle:
  - input_class: invalid_zero_bound
    must_fail_with: "invalid_query"
    must_not: "a 200 response carrying a rooms array"
assertion_summary:
  - "no room whose capacity is below the bound appears in the filtered response"
  - "the boundary_above_all response carries an empty rooms array, never 400"
  - "the absent_query response carries all three rooms"
feasibility: feasible
```

### room-booking-api:BEH-006

```yaml
id: room-booking-api:BEH-006
template: Behavior
obligation: "a non-positive-integer minCapacity yields 400 invalid_query"
input_classes:
  - name: typical_one
    input: "at least one room exists; GET /rooms?minCapacity=1"
    expected: "status 200, every room of capacity at least 1 in id order"
  - name: boundary_100
    input: "GET /rooms?minCapacity=100"
    expected: "status 200, a rooms array holding every room of capacity 100 and no 400"
  - name: invalid_zero
    input: "GET /rooms?minCapacity=0"
    expected: "error code invalid_query; status 400"
  - name: invalid_negative
    input: "GET /rooms?minCapacity=-1"
    expected: "error code invalid_query; status 400"
  - name: invalid_decimal
    input: "GET /rooms?minCapacity=4.5"
    expected: "error code invalid_query; status 400"
  - name: invalid_text
    input: "GET /rooms?minCapacity=abc"
    expected: "error code invalid_query; status 400"
  - name: invalid_empty_value
    input: "GET /rooms?minCapacity="
    expected: "error code invalid_query; status 400"
negative_oracle:
  - input_class: invalid_zero
    must_fail_with: "invalid_query"
    must_not: "a 200 response carrying a rooms array"
  - input_class: invalid_negative
    must_fail_with: "invalid_query"
    must_not: "a 200 response carrying a rooms array"
  - input_class: invalid_decimal
    must_fail_with: "invalid_query"
    must_not: "a 200 response carrying a rooms array"
  - input_class: invalid_text
    must_fail_with: "invalid_query"
    must_not: "a 200 response carrying a rooms array"
  - input_class: invalid_empty_value
    must_fail_with: "invalid_query"
    must_not: "a 200 response carrying a rooms array"
assertion_summary:
  - "each invalid class answers status 400 with the error field exactly invalid_query"
  - "the two accepted bounds answer status 200 with a rooms array"
  - "the process answers the next request after each invalid class"
feasibility: feasible
```

### room-booking-api:BEH-007

```yaml
id: room-booking-api:BEH-007
template: Behavior
obligation: "a valid booking body yields 201 with a booking object carrying the next bN id"
input_classes:
  - name: typical_first_booking
    input: "room r1 capacity 8 with no booking; POST /rooms/r1/bookings, body {\"title\":\"Standup\",\"start\":\"2026-11-02T09:30:00Z\",\"end\":\"2026-11-02T10:00:00Z\",\"attendees\":5}"
    expected: "status 201, body {\"id\":\"b1\",\"roomId\":\"r1\",\"title\":\"Standup\",\"start\":\"2026-11-02T09:30:00Z\",\"end\":\"2026-11-02T10:00:00Z\",\"attendees\":5}"
  - name: boundary_exact_capacity
    input: "room r1 capacity 8; body title Full, start 2026-11-02T11:00:00Z, end 2026-11-02T12:00:00Z, attendees 8"
    expected: "status 201 with a booking object carrying attendees 8 and the next bN id"
  - name: boundary_one_minute
    input: "room r1 capacity 8; body title Short, start 2026-11-02T13:00:00Z, end 2026-11-02T13:01:00Z, attendees 1"
    expected: "status 201 with a booking object carrying that start and end string"
  - name: invalid_unknown_room
    input: "POST /rooms/r99/bookings, body title Standup, start 2026-11-02T09:00:00Z, end 2026-11-02T09:30:00Z, attendees 5"
    expected: "error code room_not_found; status 404"
  - name: invalid_over_capacity
    input: "room r1 capacity 8; body title Standup, start 2026-11-02T09:00:00Z, end 2026-11-02T09:30:00Z, attendees 9"
    expected: "error code over_capacity; status 422"
  - name: invalid_absent_attendees
    input: "room r1 capacity 8; body {\"title\":\"Standup\",\"start\":\"2026-11-02T09:00:00Z\",\"end\":\"2026-11-02T09:30:00Z\"}"
    expected: "error code invalid_booking; status 400"
negative_oracle:
  - input_class: invalid_unknown_room
    must_fail_with: "room_not_found"
    must_not: "a 201 response carrying a booking object"
  - input_class: invalid_over_capacity
    must_fail_with: "over_capacity"
    must_not: "a 201 response carrying a booking object"
  - input_class: invalid_absent_attendees
    must_fail_with: "invalid_booking"
    must_not: "a 201 response carrying a booking object"
assertion_summary:
  - "the create response has status 201 and the body keys are exactly id, roomId, title, start, end and attendees"
  - "the roomId of the created booking equals r1, the room the path named"
  - "GET /rooms/r1/bookings returns the created booking, and GET /rooms/r2/bookings stays empty"
  - "the booking ids of successive creates on one room are b1, b2, b3 in creation order"
feasibility: feasible
```

### room-booking-api:BEH-008

```yaml
id: room-booking-api:BEH-008
template: Behavior
obligation: "invalid_json wins over room_not_found for a malformed body, and room_not_found precedes endpoint field validation for valid JSON"
input_classes:
  - name: typical_existing_room
    input: "room r1 capacity 8; POST /rooms/r1/bookings, body title Standup, start 2026-11-02T09:00:00Z, end 2026-11-02T09:30:00Z, attendees 5"
    expected: "status 201 with a booking object carrying roomId r1"
  - name: boundary_never_existing_id
    input: "POST /rooms/r99/bookings, body title Standup, start 2026-11-02T09:00:00Z, end 2026-11-02T09:30:00Z, attendees 5"
    expected: "error code room_not_found; status 404"
  - name: boundary_non_room_id
    input: "POST /rooms/roomA/bookings, body title Standup, start 2026-11-02T09:00:00Z, end 2026-11-02T09:30:00Z, attendees 5"
    expected: "error code room_not_found; status 404"
  - name: invalid_malformed_body
    input: "POST /rooms/r99/bookings, body {\"title\":\"Standup\","
    expected: "error code invalid_json; status 400"
  - name: invalid_empty_title
    input: "POST /rooms/r99/bookings, body {\"title\":\"\",\"start\":\"2026-11-02T09:00:00Z\",\"end\":\"2026-11-02T09:30:00Z\",\"attendees\":5}"
    expected: "error code room_not_found; status 404"
negative_oracle:
  - input_class: boundary_never_existing_id
    must_fail_with: "room_not_found"
    must_not: "a 201 response carrying a booking object"
  - input_class: boundary_non_room_id
    must_fail_with: "room_not_found"
    must_not: "a 400 response whose error field is invalid_booking"
  - input_class: invalid_malformed_body
    must_fail_with: "invalid_json"
    must_not: "a 404 response whose error field is room_not_found"
  - input_class: invalid_empty_title
    must_fail_with: "room_not_found"
    must_not: "a 400 response whose error field is invalid_booking"
assertion_summary:
  - "the malformed body on the absent room answers status 400 with the error field invalid_json"
  - "the valid JSON body with an empty title on the unknown room answers status 404 with the error field room_not_found"
  - "the booking list of the room r1 is unchanged by every class of this block that targets r99"
  - "the existing-room class answers status 201 and its booking appears in GET /rooms/r1/bookings"
feasibility: feasible
```

### room-booking-api:BEH-009

```yaml
id: room-booking-api:BEH-009
template: Behavior
obligation: "each invalid title, time or duration yields 400 invalid_booking and leaves state unchanged"
input_classes:
  - name: typical_valid
    input: "room r1 capacity 8; body title Standup, start 2026-11-02T09:30:00Z, end 2026-11-02T10:00:00Z, attendees 5"
    expected: "status 201 with a booking object"
  - name: boundary_8_hours
    input: "room r1 capacity 8; body title Long, start 2026-11-02T08:00:00Z, end 2026-11-02T16:00:00Z, attendees 2"
    expected: "status 201 with a booking object"
  - name: boundary_title_80
    input: "room r1 capacity 8; body whose title is the letter T repeated 80 times, start 2026-11-02T08:00:00Z, end 2026-11-02T09:00:00Z, attendees 2"
    expected: "status 201 with the 80-character title echoed unchanged"
  - name: invalid_empty_title
    input: "room r1 capacity 8; body title empty, start 2026-11-02T09:00:00Z, end 2026-11-02T09:30:00Z, attendees 2"
    expected: "error code invalid_booking; status 400"
  - name: invalid_title_81
    input: "room r1 capacity 8; body whose title is the letter T repeated 81 times, start 2026-11-02T09:00:00Z, end 2026-11-02T09:30:00Z, attendees 2"
    expected: "error code invalid_booking; status 400"
  - name: invalid_absent_title
    input: "room r1 capacity 8; body without a title field, start 2026-11-02T09:00:00Z, end 2026-11-02T09:30:00Z, attendees 2"
    expected: "error code invalid_booking; status 400"
  - name: invalid_non_whole_minute
    input: "room r1 capacity 8; body title Standup, start 2026-11-02T09:00:30Z, end 2026-11-02T09:30:00Z, attendees 2"
    expected: "error code invalid_booking; status 400"
  - name: invalid_equal_bounds
    input: "room r1 capacity 8; body title Standup, start 2026-11-02T09:00:00Z, end 2026-11-02T09:00:00Z, attendees 2"
    expected: "error code invalid_booking; status 400"
  - name: invalid_end_before_start
    input: "room r1 capacity 8; body title Standup, start 2026-11-02T10:00:00Z, end 2026-11-02T09:00:00Z, attendees 2"
    expected: "error code invalid_booking; status 400"
  - name: invalid_duration_8h1m
    input: "room r1 capacity 8; body title Long, start 2026-11-02T08:00:00Z, end 2026-11-02T16:01:00Z, attendees 2"
    expected: "error code invalid_booking; status 400"
  - name: invalid_attendees_zero
    input: "room r1 capacity 8; body title Standup, start 2026-11-02T09:00:00Z, end 2026-11-02T09:30:00Z, attendees 0"
    expected: "error code invalid_booking; status 400"
negative_oracle:
  - input_class: invalid_empty_title
    must_fail_with: "invalid_booking"
    must_not: "a 201 response carrying a booking object"
  - input_class: invalid_title_81
    must_fail_with: "invalid_booking"
    must_not: "a 201 response carrying a booking object"
  - input_class: invalid_non_whole_minute
    must_fail_with: "invalid_booking"
    must_not: "a booking in GET /rooms/r1/bookings whose start is not on a whole minute"
  - input_class: invalid_equal_bounds
    must_fail_with: "invalid_booking"
    must_not: "a 201 response carrying a booking object"
  - input_class: invalid_end_before_start
    must_fail_with: "invalid_booking"
    must_not: "a 201 response carrying a booking object"
  - input_class: invalid_duration_8h1m
    must_fail_with: "invalid_booking"
    must_not: "a booking in GET /rooms/r1/bookings spanning more than 8 hours"
  - input_class: invalid_attendees_zero
    must_fail_with: "invalid_booking"
    must_not: "a 422 response whose error field is over_capacity"
assertion_summary:
  - "each invalid class answers status 400 with the error field exactly invalid_booking"
  - "GET /rooms/r1/bookings is empty after each invalid class run alone"
  - "the 8-hour and 80-character classes answer status 201 and echo title, start and end unchanged"
feasibility: feasible
```

### room-booking-api:BEH-010

```yaml
id: room-booking-api:BEH-010
template: Behavior
obligation: "attendees greater than the room capacity yields 422 over_capacity"
input_classes:
  - name: typical_equal_capacity
    input: "room r1 capacity 8; body title Full, start 2026-11-02T09:00:00Z, end 2026-11-02T09:30:00Z, attendees 8"
    expected: "status 201 with a booking object carrying attendees 8"
  - name: empty_room_schedule
    input: "room r3 capacity 5 with no booking; body title Full, start 2026-11-02T09:00:00Z, end 2026-11-02T09:30:00Z, attendees 5"
    expected: "status 201 with a booking object carrying attendees 5"
  - name: boundary_capacity_plus_one
    input: "room r1 capacity 8; body title Over, start 2026-11-02T09:00:00Z, end 2026-11-02T09:30:00Z, attendees 9"
    expected: "error code over_capacity; status 422"
  - name: boundary_smallest_room
    input: "room r2 capacity 1; body title Over, start 2026-11-02T09:00:00Z, end 2026-11-02T09:30:00Z, attendees 2"
    expected: "error code over_capacity; status 422"
negative_oracle:
  - input_class: boundary_capacity_plus_one
    must_fail_with: "over_capacity"
    must_not: "a 201 response carrying a booking object"
  - input_class: boundary_smallest_room
    must_fail_with: "over_capacity"
    must_not: "a booking in GET /rooms/r2/bookings"
assertion_summary:
  - "both over-capacity classes answer status 422 with the error field exactly over_capacity"
  - "the equal-capacity classes answer status 201, so the comparison is strict"
  - "the booking list of the room is unchanged after each over-capacity class"
feasibility: feasible
```

### room-booking-api:BEH-011

```yaml
id: room-booking-api:BEH-011
template: Behavior
obligation: "an interval overlapping reachable existing bookings yields 409 room_busy naming the earliest-starting conflicting booking id"
input_classes:
  - name: typical_partial_overlap
    input: "room r1 with b1 over 2026-11-02T09:00:00Z to 09:15:00Z, b2 over 09:15:00Z to 09:30:00Z, b3 over 09:30:00Z to 10:00:00Z; new interval 09:10:00Z to 09:20:00Z"
    expected: "status 409, body {\"error\":\"room_busy\",\"conflictingBookingId\":\"b1\"}"
  - name: boundary_overlapping_two
    input: "same room state; new interval 09:10:00Z to 09:40:00Z"
    expected: "status 409, body {\"error\":\"room_busy\",\"conflictingBookingId\":\"b1\"}"
  - name: boundary_touching_end
    input: "same room state; new interval 10:00:00Z to 11:30:00Z"
    expected: "status 201 with a booking object"
  - name: boundary_reaches_back
    input: "same room state; new interval 09:15:00Z to 09:30:00Z"
    expected: "status 409, body {\"error\":\"room_busy\",\"conflictingBookingId\":\"b2\"}"
  - name: empty_other_room
    input: "room r2 with no booking; new interval 09:10:00Z to 09:20:00Z"
    expected: "status 201 with a booking object whose roomId is r2"
negative_oracle:
  - input_class: typical_partial_overlap
    must_fail_with: "room_busy"
    must_not: "a 201 response carrying a booking object"
  - input_class: boundary_overlapping_two
    must_fail_with: "room_busy"
    must_not: "a conflictingBookingId other than b1"
  - input_class: boundary_reaches_back
    must_fail_with: "room_busy"
    must_not: "a conflictingBookingId of b1 or b3"
assertion_summary:
  - "every room_busy body carries both the error field and the conflictingBookingId field"
  - "the touching interval answers status 201 and appears in GET /rooms/r1/bookings"
  - "after each rejected class the room holds exactly b1, b2 and b3, and GET /rooms/r1/bookings lists them in start order"
  - "the request on the empty room answers status 201 and adds no booking to r1"
feasibility: feasible
```

### room-booking-api:BEH-012

```yaml
id: room-booking-api:BEH-012
template: Behavior
obligation: "intervals that touch at an endpoint do not overlap"
input_classes:
  - name: typical_start_at_previous_end
    input: "room r1 with b1 over 2026-11-02T09:00:00Z to 10:00:00Z; new interval 10:00:00Z to 10:30:00Z"
    expected: "status 201 with a booking object, and GET /rooms/r1/bookings lists both bookings"
  - name: empty_schedule
    input: "room r1 with no booking; a new booking over 11:00:00Z to 12:00:00Z"
    expected: "status 201 with a booking object, no existing booking can touch it"
  - name: boundary_ends_at_next_start
    input: "room r1 with b1 over 09:00:00Z to 10:00:00Z; new interval 08:30:00Z to 09:00:00Z"
    expected: "status 201 with a booking object"
  - name: boundary_chain
    input: "room r1 with bookings over 09:00:00Z to 10:00:00Z and 10:00:00Z to 10:30:00Z; new interval 10:30:00Z to 11:00:00Z"
    expected: "status 201 with a booking object"
  - name: invalid_one_minute_overlap
    input: "room r1 with b1 over 09:00:00Z to 10:00:00Z; new interval 09:59:00Z to 10:30:00Z"
    expected: "error code room_busy; status 409"
negative_oracle:
  - input_class: invalid_one_minute_overlap
    must_fail_with: "room_busy"
    must_not: "a 201 response carrying a booking object"
assertion_summary:
  - "each touching class answers status 201 and never 409"
  - "after the chain class GET /rooms/r1/bookings lists three bookings in start order"
  - "the one-minute overlap answers status 409 naming b1 in conflictingBookingId"
feasibility: feasible
```

### room-booking-api:BEH-013

```yaml
id: room-booking-api:BEH-013
template: Behavior
obligation: "bookings are returned by start then id with exactly the booking fields"
input_classes:
  - name: typical_start_order
    input: "room r1 with b1 over 2026-11-02T11:00:00Z to 12:00:00Z, b2 over 09:00:00Z to 10:00:00Z, b3 over 13:00:00Z to 14:00:00Z, created in the order b1, b2, b3; GET /rooms/r1/bookings"
    expected: "status 200, body {\"bookings\":[b2, b1, b3]} in that order"
  - name: empty_list
    input: "room r2 with no booking; GET /rooms/r2/bookings"
    expected: "status 200, body {\"bookings\":[]}"
  - name: boundary_adjacent
    input: "a room with bookings over 09:00:00Z to 10:00:00Z and 10:00:00Z to 11:00:00Z; GET its booking list"
    expected: "status 200, the 09:00 booking precedes the 10:00 booking"
  - name: boundary_short_spelling
    input: "a booking created with start 2026-11-02T09:30Z and end 2026-11-02T10:00:00Z; GET the booking list"
    expected: "status 200, that booking carries start 2026-11-02T09:30Z and end 2026-11-02T10:00:00Z character for character"
  - name: invalid_unknown_room
    input: "GET /rooms/r99/bookings with no query"
    expected: "error code room_not_found; status 404"
negative_oracle:
  - input_class: invalid_unknown_room
    must_fail_with: "room_not_found"
    must_not: "a 200 response carrying an empty bookings array"
assertion_summary:
  - "the response orders bookings by start and never by creation order"
  - "every booking object carries exactly the keys id, roomId, title, start, end and attendees"
  - "the start and end strings of each booking equal the strings its creating request sent"
  - "a room without bookings answers status 200 with an empty bookings array, never 404"
feasibility: feasible
```

### room-booking-api:BEH-014

```yaml
id: room-booking-api:BEH-014
template: Behavior
obligation: "only bookings overlapping the half-open window [from, to) are returned"
input_classes:
  - name: typical_window
    input: "room r1 with b1 over 2026-11-02T09:00:00Z to 10:00:00Z and b2 over 10:00:00Z to 11:00:00Z; GET /rooms/r1/bookings?from=2026-11-02T09:30:00Z&to=2026-11-02T10:00:00Z"
    expected: "status 200, body {\"bookings\":[b1]}"
  - name: boundary_starts_at_booking_start
    input: "same rooms; GET /rooms/r1/bookings?from=2026-11-02T10:00:00Z&to=2026-11-02T11:00:00Z"
    expected: "status 200, body {\"bookings\":[b2]}"
  - name: boundary_ends_at_booking_start
    input: "same rooms; GET /rooms/r1/bookings?from=2026-11-02T09:00:00Z&to=2026-11-02T10:00:00Z"
    expected: "status 200, body {\"bookings\":[b1]} and not b2"
  - name: boundary_short_spelling
    input: "same rooms; GET /rooms/r1/bookings?from=2026-11-02T09:30Z&to=2026-11-02T10:00:00Z"
    expected: "status 200, body {\"bookings\":[b1]}"
  - name: absent_query
    input: "same rooms; GET /rooms/r1/bookings with no query string"
    expected: "status 200, body {\"bookings\":[b1, b2]}"
  - name: invalid_only_from
    input: "GET /rooms/r1/bookings?from=2026-11-02T09:30:00Z"
    expected: "error code invalid_query; status 400"
  - name: invalid_inverted
    input: "GET /rooms/r1/bookings?from=2026-11-02T09:00:00Z&to=2026-11-02T09:00:00Z"
    expected: "error code invalid_query; status 400"
negative_oracle:
  - input_class: invalid_only_from
    must_fail_with: "invalid_query"
    must_not: "a 200 response carrying a bookings array"
  - input_class: invalid_inverted
    must_fail_with: "invalid_query"
    must_not: "a 200 response carrying an empty bookings array"
assertion_summary:
  - "a booking that starts exactly at to never appears in the filtered response"
  - "a booking that ends exactly at from never appears in the filtered response"
  - "the filtered response keeps the start-then-id order of the unfiltered response"
feasibility: feasible
```

### room-booking-api:BEH-015

```yaml
id: room-booking-api:BEH-015
template: Behavior
obligation: "an incomplete or invalid from/to pair yields 400 invalid_query"
input_classes:
  - name: typical_valid_pair
    input: "room r1 with bookings; GET /rooms/r1/bookings?from=2026-11-02T09:00:00Z&to=2026-11-02T10:00:00Z"
    expected: "status 200 with a bookings array"
  - name: absent_query
    input: "GET /rooms/r1/bookings with no query string"
    expected: "status 200 with every booking of the room"
  - name: invalid_only_from
    input: "GET /rooms/r1/bookings?from=2026-11-02T09:00:00Z"
    expected: "error code invalid_query; status 400"
  - name: invalid_only_to
    input: "GET /rooms/r1/bookings?to=2026-11-02T10:00:00Z"
    expected: "error code invalid_query; status 400"
  - name: invalid_unparseable
    input: "GET /rooms/r1/bookings?from=yesterday&to=tomorrow"
    expected: "error code invalid_query; status 400"
  - name: invalid_non_whole_minute
    input: "GET /rooms/r1/bookings?from=2026-11-02T09:00:30Z&to=2026-11-02T10:00:00Z"
    expected: "error code invalid_query; status 400"
  - name: invalid_inverted
    input: "GET /rooms/r1/bookings?from=2026-11-02T10:00:00Z&to=2026-11-02T09:00:00Z"
    expected: "error code invalid_query; status 400"
negative_oracle:
  - input_class: invalid_only_from
    must_fail_with: "invalid_query"
    must_not: "a 200 response carrying a bookings array"
  - input_class: invalid_only_to
    must_fail_with: "invalid_query"
    must_not: "a 200 response carrying a bookings array"
  - input_class: invalid_unparseable
    must_fail_with: "invalid_query"
    must_not: "a 200 response carrying the full booking list"
  - input_class: invalid_non_whole_minute
    must_fail_with: "invalid_query"
    must_not: "a 200 response carrying a bookings array"
  - input_class: invalid_inverted
    must_fail_with: "invalid_query"
    must_not: "a 200 response carrying an empty bookings array"
assertion_summary:
  - "each invalid class answers status 400 with the error field exactly invalid_query"
  - "the accepted pair answers status 200 with the bookings overlapping the window"
  - "the absent query answers status 200 with every booking of the room"
feasibility: feasible
```

### room-booking-api:BEH-016

```yaml
id: room-booking-api:BEH-016
template: Behavior
obligation: "an unknown roomId on the list endpoint yields 404 room_not_found"
input_classes:
  - name: typical_existing_room
    input: "room r1 with one booking; GET /rooms/r1/bookings with no query"
    expected: "status 200 with that booking in the bookings array"
  - name: empty_room_bookings
    input: "room r2 with no booking; GET /rooms/r2/bookings with no query"
    expected: "status 200, body {\"bookings\":[]}"
  - name: boundary_unknown_room
    input: "GET /rooms/r99/bookings with no query"
    expected: "error code room_not_found; status 404"
  - name: boundary_unknown_room_invalid_query
    input: "GET /rooms/r99/bookings?from=2026-11-02T09:00:00Z"
    expected: "error code invalid_query; status 400"
negative_oracle:
  - input_class: boundary_unknown_room
    must_fail_with: "room_not_found"
    must_not: "a 200 response carrying an empty bookings array"
  - input_class: boundary_unknown_room_invalid_query
    must_fail_with: "invalid_query"
    must_not: "a 404 response whose error field is room_not_found"
assertion_summary:
  - "the unknown room without a query answers status 404 with the error field room_not_found"
  - "the unknown room with a half query answers status 400 with the error field invalid_query, so the query rule precedes the unknown-room rule"
  - "the existing empty room answers status 200 with an empty bookings array"
feasibility: feasible
```

### room-booking-api:BEH-017

```yaml
id: room-booking-api:BEH-017
template: Behavior
obligation: "a known booking id yields 204 and the interval becomes bookable again"
input_classes:
  - name: typical_delete
    input: "room r1 with b1 over 2026-11-02T09:00:00Z to 10:00:00Z; DELETE /bookings/b1"
    expected: "status 204, empty body, no Content-Type header"
  - name: boundary_second_delete
    input: "the same DELETE /bookings/b1 sent again"
    expected: "error code booking_not_found; status 404"
  - name: boundary_rebooking_exact
    input: "after the delete, POST /rooms/r1/bookings with start 2026-11-02T09:00:00Z and end 10:00:00Z"
    expected: "status 201 with a booking object"
  - name: boundary_rebooking_shifted
    input: "after the delete, POST /rooms/r1/bookings over 09:30:00Z to 10:30:00Z"
    expected: "status 201 with a booking object"
  - name: empty_list_after
    input: "GET /rooms/r1/bookings after the delete and before any new booking"
    expected: "status 200, body {\"bookings\":[]}"
negative_oracle:
  - input_class: boundary_second_delete
    must_fail_with: "booking_not_found"
    must_not: "a 204 response"
assertion_summary:
  - "the delete answers status 204 with an empty body and no Content-Type header"
  - "the booking list of the room is empty after the delete"
  - "each rebooking class answers status 201, never 409"
feasibility: feasible
```

### room-booking-api:BEH-018

```yaml
id: room-booking-api:BEH-018
template: Behavior
obligation: "an unknown booking id yields 404 booking_not_found"
input_classes:
  - name: typical_existing_id
    input: "booking b1 exists; DELETE /bookings/b1"
    expected: "status 204 with an empty body"
  - name: boundary_never_existing
    input: "DELETE /bookings/b99 with no body"
    expected: "error code booking_not_found; status 404"
  - name: boundary_already_deleted
    input: "DELETE /bookings/b1 twice in a row on a booking that existed once"
    expected: "status 204 for the first request and error code booking_not_found with status 404 for the second"
  - name: absent_body
    input: "DELETE /bookings/b99 with no request body at all"
    expected: "error code booking_not_found; status 404"
  - name: invalid_malformed_body
    input: "DELETE /bookings/b99, body {\"bookingId\":"
    expected: "error code invalid_json; status 400"
negative_oracle:
  - input_class: boundary_never_existing
    must_fail_with: "booking_not_found"
    must_not: "a 204 response"
  - input_class: boundary_already_deleted
    must_fail_with: "booking_not_found"
    must_not: "a 204 response on the second request"
  - input_class: absent_body
    must_fail_with: "booking_not_found"
    must_not: "a 400 response whose error field is invalid_json"
  - input_class: invalid_malformed_body
    must_fail_with: "invalid_json"
    must_not: "a 404 response whose error field is booking_not_found"
assertion_summary:
  - "an unknown and an already deleted booking id both answer status 404 with the error field booking_not_found"
  - "an absent body never turns the lookup into an error of its own"
  - "no booking id is answered with 204 more than once"
feasibility: feasible
```

### room-booking-api:BEH-019

```yaml
id: room-booking-api:BEH-019
template: Behavior
obligation: "free rooms with sufficient capacity are returned ordered by capacity then id"
input_classes:
  - name: typical_by_capacity
    input: "room r1 capacity 4 booked 2026-11-02T09:00:00Z to 10:00:00Z, room r2 capacity 8 free, room r3 capacity 4 free, room r4 capacity 8 booked 09:30:00Z to 09:40:00Z; GET /availability?start=2026-11-02T09:00:00Z&end=2026-11-02T10:00:00Z&attendees=4"
    expected: "status 200, body {\"rooms\":[r3, r2]} in that order"
  - name: empty_result
    input: "same rooms; the same query with attendees=9"
    expected: "status 200, body {\"rooms\":[]}"
  - name: boundary_capacity_exactly_attendees
    input: "same rooms; the same query with attendees=8"
    expected: "status 200, body {\"rooms\":[r2]} and not r4"
  - name: boundary_touching_window
    input: "r2 additionally booked 10:00:00Z to 11:00:00Z; the query with attendees=4 over 09:00:00Z to 10:00:00Z"
    expected: "status 200, body {\"rooms\":[r3, r2]}, because the r2 booking only touches the window end"
  - name: boundary_equal_capacities
    input: "an additional free room r5 capacity 4 created before the query; the query with attendees=4"
    expected: "status 200, body {\"rooms\":[r3, r5, r2]} in that order"
  - name: invalid_inverted_bounds
    input: "GET /availability?start=2026-11-02T10:00:00Z&end=2026-11-02T09:00:00Z&attendees=4"
    expected: "error code invalid_query; status 400"
negative_oracle:
  - input_class: invalid_inverted_bounds
    must_fail_with: "invalid_query"
    must_not: "a 200 response carrying every room"
assertion_summary:
  - "no room with a booking overlapping the window appears in the response"
  - "the order is ascending capacity, and among equal capacities ascending id"
  - "a capacity equal to attendees satisfies the capacity test"
  - "an attendee count no room seats answers status 200 with an empty rooms array, never 400"
feasibility: feasible
```

### room-booking-api:BEH-020

```yaml
id: room-booking-api:BEH-020
template: Behavior
obligation: "each missing or invalid availability parameter yields 400 invalid_query"
input_classes:
  - name: typical_valid
    input: "one free room and one room booked over the window; GET /availability?start=2026-11-02T09:00:00Z&end=2026-11-02T10:00:00Z&attendees=2"
    expected: "status 200 with only the free room in the rooms array"
  - name: boundary_attendees_zero
    input: "same rooms; GET /availability?start=2026-11-02T09:00:00Z&end=2026-11-02T10:00:00Z&attendees=0"
    expected: "status 200 with the free room only, the booked room still excluded"
  - name: invalid_missing_start
    input: "GET /availability?end=2026-11-02T10:00:00Z&attendees=2"
    expected: "error code invalid_query; status 400"
  - name: invalid_missing_end
    input: "GET /availability?start=2026-11-02T09:00:00Z&attendees=2"
    expected: "error code invalid_query; status 400"
  - name: invalid_missing_attendees
    input: "GET /availability?start=2026-11-02T09:00:00Z&end=2026-11-02T10:00:00Z"
    expected: "error code invalid_query; status 400"
  - name: invalid_empty_value
    input: "GET /availability?start=2026-11-02T09:00:00Z&end=2026-11-02T10:00:00Z&attendees="
    expected: "error code invalid_query; status 400"
  - name: invalid_non_integer
    input: "GET /availability?start=2026-11-02T09:00:00Z&end=2026-11-02T10:00:00Z&attendees=two"
    expected: "error code invalid_query; status 400"
  - name: invalid_inverted_bounds
    input: "GET /availability?start=2026-11-02T10:00:00Z&end=2026-11-02T09:00:00Z&attendees=2"
    expected: "error code invalid_query; status 400"
  - name: invalid_non_whole_minute
    input: "GET /availability?start=2026-11-02T09:00:30Z&end=2026-11-02T10:00:00Z&attendees=2"
    expected: "error code invalid_query; status 400"
negative_oracle:
  - input_class: invalid_missing_start
    must_fail_with: "invalid_query"
    must_not: "a 200 response carrying a rooms array"
  - input_class: invalid_missing_end
    must_fail_with: "invalid_query"
    must_not: "a 200 response carrying a rooms array"
  - input_class: invalid_missing_attendees
    must_fail_with: "invalid_query"
    must_not: "a 200 response carrying a rooms array"
  - input_class: invalid_empty_value
    must_fail_with: "invalid_query"
    must_not: "a 200 response carrying a rooms array"
  - input_class: invalid_non_integer
    must_fail_with: "invalid_query"
    must_not: "a 200 response carrying a rooms array"
  - input_class: invalid_inverted_bounds
    must_fail_with: "invalid_query"
    must_not: "a 200 response carrying every room"
  - input_class: invalid_non_whole_minute
    must_fail_with: "invalid_query"
    must_not: "a 200 response carrying a rooms array"
assertion_summary:
  - "each invalid class answers status 400 with the error field exactly invalid_query"
  - "the attendees=0 class answers status 200 and still excludes the room with the overlapping booking"
  - "a valid query after any invalid class is still answered, so the process keeps serving"
feasibility: feasible
```

### room-booking-api:BEH-021

```yaml
id: room-booking-api:BEH-021
template: Behavior
obligation: "an unparseable or empty body yields 400 invalid_json before any endpoint rule"
input_classes:
  - name: typical_valid_body
    input: "POST /rooms, body {\"name\":\"Aurora\",\"capacity\":8}"
    expected: "status 201 with a room object"
  - name: empty_body
    input: "POST /rooms with an empty request body"
    expected: "error code invalid_json; status 400"
  - name: invalid_empty_body_booking
    input: "room r1 exists; POST /rooms/r1/bookings with an empty request body"
    expected: "error code invalid_json; status 400"
  - name: invalid_truncated
    input: "POST /rooms, body {\"name\":\"Aurora\","
    expected: "error code invalid_json; status 400"
  - name: invalid_trailing_garbage
    input: "POST /rooms, body {\"name\":\"Aurora\",\"capacity\":8}x"
    expected: "error code invalid_json; status 400"
  - name: boundary_valid_json_null
    input: "POST /rooms, body null"
    expected: "error code invalid_room; status 400"
negative_oracle:
  - input_class: empty_body
    must_fail_with: "invalid_json"
    must_not: "a 201 response carrying a room object"
  - input_class: invalid_truncated
    must_fail_with: "invalid_json"
    must_not: "a 201 response carrying a room object"
  - input_class: invalid_trailing_garbage
    must_fail_with: "invalid_json"
    must_not: "a 201 response carrying a room object"
  - input_class: boundary_valid_json_null
    must_fail_with: "invalid_room"
    must_not: "a 400 response whose error field is invalid_json"
assertion_summary:
  - "every unparseable or empty body answers status 400 with the error field exactly invalid_json"
  - "the body null answers status 400 with the error field invalid_room, because null parses as JSON"
  - "GET /rooms shows no room added by any rejected class"
  - "the process answers the next request after each rejected class"
feasibility: feasible
```

### room-booking-api:BEH-022

```yaml
id: room-booking-api:BEH-022
template: Behavior
obligation: "an unmatched path yields 404 not_found"
input_classes:
  - name: typical_known_path
    input: "GET /rooms with no query"
    expected: "status 200 with a rooms array"
  - name: boundary_root
    input: "GET /"
    expected: "error code not_found; status 404"
  - name: boundary_nested_unmatched
    input: "GET /rooms/r1"
    expected: "error code not_found; status 404"
  - name: boundary_unmatched_method
    input: "PUT /nope carrying the body {\"name\":"
    expected: "error code not_found; status 404"
  - name: boundary_route_unknown_room
    input: "GET /rooms/r99/bookings with no query"
    expected: "error code room_not_found; status 404"
negative_oracle:
  - input_class: boundary_root
    must_fail_with: "not_found"
    must_not: "a 200 response or a 405 response"
  - input_class: boundary_nested_unmatched
    must_fail_with: "not_found"
    must_not: "a 200 response carrying a room object"
  - input_class: boundary_unmatched_method
    must_fail_with: "not_found"
    must_not: "a 405 response whose error field is method_not_allowed"
  - input_class: boundary_route_unknown_room
    must_fail_with: "room_not_found"
    must_not: "a 404 response whose error field is not_found"
assertion_summary:
  - "each unmatched path answers status 404 with the error field exactly not_found"
  - "no unmatched path is answered with 500 or 405"
  - "a path that matches a route pattern answers its endpoint error, never not_found"
feasibility: feasible
```

### room-booking-api:BEH-023

```yaml
id: room-booking-api:BEH-023
template: Behavior
obligation: "an unsupported method on a known path yields 405 method_not_allowed"
input_classes:
  - name: typical_supported
    input: "POST /rooms, body {\"name\":\"Aurora\",\"capacity\":8}"
    expected: "status 201 with a room object"
  - name: boundary_collection
    input: "DELETE /rooms with no body"
    expected: "error code method_not_allowed; status 405"
  - name: boundary_item
    input: "GET /bookings/b1 with no body"
    expected: "error code method_not_allowed; status 405"
  - name: boundary_availability
    input: "POST /availability with no body"
    expected: "error code method_not_allowed; status 405"
  - name: boundary_wrong_method_with_malformed_body
    input: "DELETE /rooms carrying the body {\"name\":"
    expected: "error code method_not_allowed; status 405"
negative_oracle:
  - input_class: boundary_collection
    must_fail_with: "method_not_allowed"
    must_not: "a 404 response whose error field is not_found"
  - input_class: boundary_item
    must_fail_with: "method_not_allowed"
    must_not: "a 404 response whose error field is not_found"
  - input_class: boundary_availability
    must_fail_with: "method_not_allowed"
    must_not: "a 200 response carrying a rooms array"
  - input_class: boundary_wrong_method_with_malformed_body
    must_fail_with: "method_not_allowed"
    must_not: "a 400 response whose error field is invalid_json"
assertion_summary:
  - "each unsupported method answers status 405 with the error field exactly method_not_allowed"
  - "no supported method is ever answered with 405"
  - "a wrong method carrying a malformed body answers 405, so the method rule precedes body parsing"
feasibility: feasible
```

### room-booking-api:BEH-024

```yaml
id: room-booking-api:BEH-024
template: Behavior
obligation: "unknown body fields are accepted and dropped"
input_classes:
  - name: typical_extra_room_field
    input: "POST /rooms, body {\"name\":\"Aurora\",\"capacity\":8,\"colour\":\"blue\"}"
    expected: "status 201, body {\"id\":\"r1\",\"name\":\"Aurora\",\"capacity\":8}"
  - name: boundary_extra_booking_field
    input: "room r1 capacity 8; POST /rooms/r1/bookings, body title Standup, start 2026-11-02T09:00:00Z, end 2026-11-02T09:30:00Z, attendees 2, note hello"
    expected: "status 201 with exactly the keys id, roomId, title, start, end and attendees"
  - name: invalid_extra_with_invalid_field
    input: "POST /rooms, body {\"name\":\"Aurora\",\"capacity\":0,\"colour\":\"blue\"}"
    expected: "error code invalid_room; status 400"
  - name: invalid_missing_name_with_extra
    input: "POST /rooms, body {\"capacity\":8,\"colour\":\"blue\"}"
    expected: "error code invalid_room; status 400"
  - name: empty_body_of_extra_field
    input: "POST /rooms, body {\"colour\":\"blue\"}"
    expected: "error code invalid_room; status 400"
negative_oracle:
  - input_class: invalid_extra_with_invalid_field
    must_fail_with: "invalid_room"
    must_not: "a 201 response carrying a room object"
  - input_class: invalid_missing_name_with_extra
    must_fail_with: "invalid_room"
    must_not: "a 201 response carrying a room object"
  - input_class: empty_body_of_extra_field
    must_fail_with: "invalid_room"
    must_not: "a 201 response carrying a room object"
assertion_summary:
  - "the extra field never appears in a response body"
  - "the extra field never rescues a body whose named field is invalid"
  - "a body carrying only unnamed fields is rejected with status 400 and the error field invalid_room"
feasibility: feasible
```

### room-booking-api:BEH-025

```yaml
id: room-booking-api:BEH-025
template: Behavior
obligation: "request Content-Type is ignored, an absent body is accepted everywhere, and a present malformed body yields 400 invalid_json on every supported route"
input_classes:
  - name: typical_no_content_type
    input: "POST /rooms, body {\"name\":\"Aurora\",\"capacity\":8}, with no Content-Type header"
    expected: "status 201 with a room object"
  - name: boundary_text_plain
    input: "POST /rooms with Content-Type text/plain and body {\"name\":\"Aurora\",\"capacity\":8}"
    expected: "status 201 with a room object"
  - name: absent_body_get
    input: "GET /rooms with no request body"
    expected: "status 200 with a rooms array"
  - name: absent_body_delete
    input: "DELETE /bookings/b99 with no request body and no booking b99"
    expected: "error code booking_not_found; status 404"
  - name: boundary_valid_json_body_get
    input: "GET /rooms carrying the body {\"hello\":1}"
    expected: "status 200 with a rooms array"
  - name: invalid_malformed_body_get
    input: "GET /rooms carrying the body {\"hello\":"
    expected: "error code invalid_json; status 400"
  - name: invalid_malformed_body_delete
    input: "DELETE /bookings/b1 carrying the body {\"x\":"
    expected: "error code invalid_json; status 400"
  - name: invalid_malformed_no_content_type
    input: "POST /rooms with Content-Type text/plain and body {\"name\":"
    expected: "error code invalid_json; status 400"
negative_oracle:
  - input_class: absent_body_delete
    must_fail_with: "booking_not_found"
    must_not: "a 400 response whose error field is invalid_json"
  - input_class: invalid_malformed_body_get
    must_fail_with: "invalid_json"
    must_not: "a 200 response carrying a rooms array"
  - input_class: invalid_malformed_body_delete
    must_fail_with: "invalid_json"
    must_not: "a 404 response whose error field is booking_not_found"
  - input_class: invalid_malformed_no_content_type
    must_fail_with: "invalid_json"
    must_not: "a 201 response carrying a room object"
assertion_summary:
  - "no request is rejected for its Content-Type header"
  - "a request without a body is answered with the documented status of its route"
  - "a present body that is not valid JSON answers status 400 with the error field exactly invalid_json"
  - "a present body that is valid JSON on a route without a documented body leaves the response unchanged"
feasibility: feasible
```

### room-booking-api:BEH-026

```yaml
id: room-booking-api:BEH-026
template: Behavior
obligation: "a whole-minute spelling is accepted and the start and end strings of the stored booking equal the input strings"
input_classes:
  - name: typical_short_form
    input: "room r1 capacity 8; POST /rooms/r1/bookings, body title Standup, start 2026-11-02T09:30Z, end 2026-11-02T10:00:00Z, attendees 2"
    expected: "status 201 with start 2026-11-02T09:30Z and end 2026-11-02T10:00:00Z, and GET /rooms/r1/bookings reports the same two strings"
  - name: boundary_zero_fraction
    input: "body title Standup, start 2026-11-02T09:31:00.000Z, end 2026-11-02T10:00:00Z"
    expected: "status 201 with start 2026-11-02T09:31:00.000Z echoed character for character"
  - name: boundary_canonical
    input: "body title Standup, start 2026-11-02T11:00:00Z, end 2026-11-02T12:00:00Z"
    expected: "status 201 with both strings echoed unchanged"
  - name: invalid_non_zero_seconds
    input: "body title Standup, start 2026-11-02T09:30:30Z, end 2026-11-02T10:00:00Z"
    expected: "error code invalid_booking; status 400"
  - name: invalid_absent_start
    input: "body without a start field, end 2026-11-02T10:00:00Z, attendees 2"
    expected: "error code invalid_booking; status 400"
negative_oracle:
  - input_class: invalid_non_zero_seconds
    must_fail_with: "invalid_booking"
    must_not: "a 201 response carrying a booking object"
  - input_class: invalid_absent_start
    must_fail_with: "invalid_booking"
    must_not: "a 201 response carrying a booking object"
assertion_summary:
  - "the start and end of the created booking are character-for-character equal to the strings the request sent"
  - "the booking read back from GET /rooms/r1/bookings carries the same two strings"
  - "a time with non-zero seconds answers status 400 with the error field invalid_booking"
feasibility: feasible
```

### room-booking-api:BEH-027

```yaml
id: room-booking-api:BEH-027
template: Behavior
obligation: "a JSON number with a zero fraction is accepted when an integer is required"
input_classes:
  - name: typical_capacity_8_0
    input: "POST /rooms, body {\"name\":\"Aurora\",\"capacity\":8.0}"
    expected: "status 201, body {\"id\":\"r1\",\"name\":\"Aurora\",\"capacity\":8}"
  - name: boundary_attendees_5_0
    input: "room r1 capacity 8; POST /rooms/r1/bookings, body title Standup, start 2026-11-02T09:00:00Z, end 2026-11-02T09:30:00Z, attendees 5.0"
    expected: "status 201 with attendees 5 in the body"
  - name: invalid_capacity_8_5
    input: "POST /rooms, body {\"name\":\"Aurora\",\"capacity\":8.5}"
    expected: "error code invalid_room; status 400"
  - name: invalid_capacity_string
    input: "POST /rooms, body {\"name\":\"Aurora\",\"capacity\":\"8\"}"
    expected: "error code invalid_room; status 400"
  - name: empty_absent_capacity
    input: "POST /rooms, body {\"name\":\"Aurora\"}"
    expected: "error code invalid_room; status 400"
negative_oracle:
  - input_class: invalid_capacity_8_5
    must_fail_with: "invalid_room"
    must_not: "a 201 response carrying a room object"
  - input_class: invalid_capacity_string
    must_fail_with: "invalid_room"
    must_not: "a 201 response carrying a room object"
  - input_class: empty_absent_capacity
    must_fail_with: "invalid_room"
    must_not: "a 201 response carrying a room object"
assertion_summary:
  - "capacity 8.0 answers status 201 and the response body carries the number 8 without a fraction"
  - "attendees 5.0 answers status 201 and the response body carries the number 5 without a fraction"
  - "a number with a non-zero fraction and a numeric string both answer status 400 with the error field invalid_room"
feasibility: feasible
```

### room-booking-api:CTR-001

```yaml
id: room-booking-api:CTR-001
template: Contract
obligation: "the create-room endpoint answers with exactly one of the documented statuses and bodies"
input_classes:
  - name: typical_valid
    input: "POST /rooms, body {\"name\":\"Aurora\",\"capacity\":8}"
    expected: "status 201, body {\"id\":\"r1\",\"name\":\"Aurora\",\"capacity\":8}"
  - name: boundary_name_40_capacity_1
    input: "POST /rooms, body carrying name equal to the letter A repeated 40 times and capacity 1"
    expected: "status 201 with that name and capacity 1"
  - name: boundary_capacity_100
    input: "POST /rooms, body {\"name\":\"Hall\",\"capacity\":100}"
    expected: "status 201 with capacity 100"
  - name: empty_body
    input: "POST /rooms with an empty request body"
    expected: "error code invalid_json; status 400"
  - name: invalid_name_41
    input: "POST /rooms, body carrying name equal to the letter A repeated 41 times and capacity 8"
    expected: "error code invalid_room; status 400"
  - name: invalid_capacity_0
    input: "POST /rooms, body {\"name\":\"Zero\",\"capacity\":0}"
    expected: "error code invalid_room; status 400"
  - name: invalid_capacity_101
    input: "POST /rooms, body {\"name\":\"Wide\",\"capacity\":101}"
    expected: "error code invalid_room; status 400"
  - name: invalid_non_object_body
    input: "POST /rooms, body [] which is valid JSON but not an object"
    expected: "error code invalid_room; status 400"
  - name: invalid_duplicate_name
    input: "a room named Aurora exists; POST /rooms, body {\"name\":\"aurora\",\"capacity\":4}"
    expected: "error code room_name_taken; status 409"
  - name: invalid_wrong_method
    input: "DELETE /rooms with no body"
    expected: "error code method_not_allowed; status 405"
  - name: invalid_unknown_path
    input: "POST /room, body {\"name\":\"Aurora\",\"capacity\":8}"
    expected: "error code not_found; status 404"
negative_oracle:
  - input_class: empty_body
    must_fail_with: "invalid_json"
    must_not: "a 201 response carrying a room object"
  - input_class: invalid_name_41
    must_fail_with: "invalid_room"
    must_not: "a 201 response carrying a room object"
  - input_class: invalid_capacity_0
    must_fail_with: "invalid_room"
    must_not: "a 201 response carrying a room object"
  - input_class: invalid_capacity_101
    must_fail_with: "invalid_room"
    must_not: "a 201 response carrying a room object"
  - input_class: invalid_non_object_body
    must_fail_with: "invalid_room"
    must_not: "a 201 response carrying a room object"
  - input_class: invalid_duplicate_name
    must_fail_with: "room_name_taken"
    must_not: "a 201 response carrying a room object"
  - input_class: invalid_wrong_method
    must_fail_with: "method_not_allowed"
    must_not: "a 404 response whose error field is not_found"
  - input_class: invalid_unknown_path
    must_fail_with: "not_found"
    must_not: "a 405 response whose error field is method_not_allowed"
assertion_summary:
  - "every response status of this block is one of 201, 400, 404, 405 and 409"
  - "every error body is a JSON object whose error field holds the documented snake_case code"
  - "the 201 bodies carry exactly the keys id, name and capacity"
  - "the room ids of successive creates are r1, r2, r3 in creation order and are never reused"
feasibility: feasible
```

### room-booking-api:CTR-002

```yaml
id: room-booking-api:CTR-002
template: Contract
obligation: "the list-rooms endpoint answers with exactly one of the documented statuses and bodies"
input_classes:
  - name: typical_no_query
    input: "room r1 capacity 3 and room r2 capacity 8 exist; GET /rooms with no query and no body"
    expected: "status 200, body {\"rooms\":[r1, r2]}"
  - name: empty_store
    input: "GET /rooms on a freshly started process"
    expected: "status 200, body {\"rooms\":[]}"
  - name: boundary_valid_bound
    input: "room r1 capacity 3 and room r2 capacity 8 exist; GET /rooms?minCapacity=8"
    expected: "status 200, body {\"rooms\":[r2]}"
  - name: invalid_bound_zero
    input: "GET /rooms?minCapacity=0"
    expected: "error code invalid_query; status 400"
  - name: absent_body
    input: "GET /rooms with no request body at all"
    expected: "status 200 with a rooms array"
  - name: boundary_valid_json_body
    input: "GET /rooms carrying the body {\"hello\":1}"
    expected: "status 200 with a rooms array, the body ignored"
  - name: invalid_malformed_body
    input: "GET /rooms carrying the body {\"hello\":"
    expected: "error code invalid_json; status 400"
  - name: invalid_wrong_method
    input: "PATCH /rooms with no body"
    expected: "error code method_not_allowed; status 405"
  - name: invalid_unknown_path
    input: "GET /room with no query"
    expected: "error code not_found; status 404"
negative_oracle:
  - input_class: invalid_bound_zero
    must_fail_with: "invalid_query"
    must_not: "a 200 response carrying a rooms array"
  - input_class: invalid_malformed_body
    must_fail_with: "invalid_json"
    must_not: "a 200 response carrying a rooms array"
  - input_class: invalid_wrong_method
    must_fail_with: "method_not_allowed"
    must_not: "a 200 response carrying a rooms array"
  - input_class: invalid_unknown_path
    must_fail_with: "not_found"
    must_not: "a 200 response carrying a rooms array"
assertion_summary:
  - "the success body is a JSON object with the single key rooms"
  - "every response status of this block is one of 200, 400, 404 and 405"
  - "a supplied valid JSON body never changes the response, and a supplied malformed body never answers 200"
  - "the bound filters the result and the unfiltered response carries every room in id order"
feasibility: feasible
```

### room-booking-api:CTR-003

```yaml
id: room-booking-api:CTR-003
template: Contract
obligation: "the create-booking endpoint answers with exactly one of the documented statuses and bodies, and a created booking echoes start and end as given"
input_classes:
  - name: typical_canonical
    input: "room r1 capacity 8; POST /rooms/r1/bookings, body title Standup, start 2026-11-02T09:30:00Z, end 2026-11-02T10:00:00Z, attendees 5"
    expected: "status 201, body {\"id\":\"b1\",\"roomId\":\"r1\",\"title\":\"Standup\",\"start\":\"2026-11-02T09:30:00Z\",\"end\":\"2026-11-02T10:00:00Z\",\"attendees\":5}"
  - name: boundary_short_spelling
    input: "same room; body title Standup, start 2026-11-02T11:00Z, end 2026-11-02T12:00:00Z, attendees 2"
    expected: "status 201 with start reported as 2026-11-02T11:00Z"
  - name: boundary_zero_fraction
    input: "same room; body title Standup, start 2026-11-02T13:00:00.000Z, end 2026-11-02T13:30:00Z, attendees 2"
    expected: "status 201 with start reported as 2026-11-02T13:00:00.000Z"
  - name: boundary_8_hours
    input: "same room; body title Long, start 2026-11-02T08:00:00Z, end 2026-11-02T16:00:00Z, attendees 2"
    expected: "status 201 with a booking object"
  - name: empty_body
    input: "room r1 exists; POST /rooms/r1/bookings with an empty request body"
    expected: "error code invalid_json; status 400"
  - name: invalid_attendees_zero
    input: "room r1 capacity 8; body with attendees 0 and a valid title, start and end"
    expected: "error code invalid_booking; status 400"
  - name: invalid_attendees_2_5
    input: "room r1 capacity 8; body with attendees 2.5 and a valid title, start and end"
    expected: "error code invalid_booking; status 400"
  - name: invalid_attendees_absent
    input: "room r1 capacity 8; body without an attendees field and a valid title, start and end"
    expected: "error code invalid_booking; status 400"
  - name: invalid_attendees_string
    input: "room r1 capacity 8; body with attendees written as the string 5 and a valid title, start and end"
    expected: "error code invalid_booking; status 400"
  - name: invalid_over_capacity
    input: "room r1 capacity 8; body title Over, start 2026-11-02T09:00:00Z, end 2026-11-02T09:30:00Z, attendees 9"
    expected: "error code over_capacity; status 422"
  - name: invalid_overlap
    input: "room r1 with a booking over 2026-11-02T09:00:00Z to 10:00:00Z; body title Over, start 09:30:00Z, end 11:00:00Z, attendees 2"
    expected: "status 409, body {\"error\":\"room_busy\",\"conflictingBookingId\":\"b1\"}"
  - name: invalid_unknown_room
    input: "POST /rooms/r99/bookings, body title Standup, start 2026-11-02T09:00:00Z, end 2026-11-02T09:30:00Z, attendees 2"
    expected: "error code room_not_found; status 404"
  - name: invalid_wrong_method
    input: "PUT /rooms/r1/bookings with no body"
    expected: "error code method_not_allowed; status 405"
  - name: invalid_unknown_path
    input: "POST /bookings, body title Standup, start 2026-11-02T09:00:00Z, end 2026-11-02T09:30:00Z, attendees 2"
    expected: "error code not_found; status 404"
negative_oracle:
  - input_class: empty_body
    must_fail_with: "invalid_json"
    must_not: "a 201 response carrying a booking object"
  - input_class: invalid_attendees_zero
    must_fail_with: "invalid_booking"
    must_not: "a 422 response whose error field is over_capacity"
  - input_class: invalid_attendees_2_5
    must_fail_with: "invalid_booking"
    must_not: "a 201 response carrying a booking object"
  - input_class: invalid_attendees_absent
    must_fail_with: "invalid_booking"
    must_not: "a 201 response carrying a booking object"
  - input_class: invalid_attendees_string
    must_fail_with: "invalid_booking"
    must_not: "a 201 response carrying a booking object"
  - input_class: invalid_over_capacity
    must_fail_with: "over_capacity"
    must_not: "a 201 response carrying a booking object"
  - input_class: invalid_overlap
    must_fail_with: "room_busy"
    must_not: "a room_busy body without a conflictingBookingId field"
  - input_class: invalid_unknown_room
    must_fail_with: "room_not_found"
    must_not: "a 404 response whose error field is not_found"
  - input_class: invalid_wrong_method
    must_fail_with: "method_not_allowed"
    must_not: "a 404 response whose error field is not_found"
  - input_class: invalid_unknown_path
    must_fail_with: "not_found"
    must_not: "a 405 response whose error field is method_not_allowed"
assertion_summary:
  - "every response status of this block is one of 201, 400, 404, 405, 409 and 422"
  - "every booking object carries exactly id, roomId, title, start, end and attendees"
  - "start and end of every created booking are character-for-character equal to the strings the request sent"
  - "every room_busy body carries both error and conflictingBookingId"
  - "booking ids are b1, b2, b3 in creation order across rooms and are never reused"
feasibility: feasible
```

### room-booking-api:CTR-004

```yaml
id: room-booking-api:CTR-004
template: Contract
obligation: "the list-bookings endpoint answers with exactly one of the documented statuses and bodies"
input_classes:
  - name: typical_window
    input: "room r1 with bookings over 2026-11-02T09:00:00Z to 10:00:00Z and 10:00:00Z to 11:00:00Z; GET /rooms/r1/bookings?from=2026-11-02T09:30:00Z&to=2026-11-02T10:00:00Z"
    expected: "status 200 with only the 09:00 booking in the bookings array"
  - name: typical_no_query
    input: "same room; GET /rooms/r1/bookings with no query"
    expected: "status 200 with both bookings in start order"
  - name: empty_room_bookings
    input: "room r2 with no booking; GET /rooms/r2/bookings"
    expected: "status 200, body {\"bookings\":[]}"
  - name: boundary_short_spelling_window
    input: "same room; GET /rooms/r1/bookings?from=2026-11-02T09:30Z&to=2026-11-02T10:00:00Z"
    expected: "status 200 with only the 09:00 booking"
  - name: invalid_half_window
    input: "GET /rooms/r1/bookings?from=2026-11-02T09:30:00Z"
    expected: "error code invalid_query; status 400"
  - name: invalid_unknown_room
    input: "GET /rooms/r99/bookings with no query"
    expected: "error code room_not_found; status 404"
  - name: absent_body
    input: "GET /rooms/r1/bookings with no request body"
    expected: "status 200 with a bookings array"
  - name: boundary_valid_json_body
    input: "GET /rooms/r1/bookings carrying the body {\"hello\":1}"
    expected: "status 200 with the same booking list the same request without a body returns"
  - name: invalid_malformed_body
    input: "GET /rooms/r1/bookings carrying the body {\"hello\":"
    expected: "error code invalid_json; status 400"
  - name: invalid_wrong_method
    input: "DELETE /rooms/r1/bookings with no body"
    expected: "error code method_not_allowed; status 405"
negative_oracle:
  - input_class: invalid_half_window
    must_fail_with: "invalid_query"
    must_not: "a 200 response carrying a bookings array"
  - input_class: invalid_unknown_room
    must_fail_with: "room_not_found"
    must_not: "a 200 response carrying an empty bookings array"
  - input_class: invalid_malformed_body
    must_fail_with: "invalid_json"
    must_not: "a 200 response carrying a bookings array"
  - input_class: invalid_wrong_method
    must_fail_with: "method_not_allowed"
    must_not: "a 200 response carrying a bookings array"
assertion_summary:
  - "the success body is a JSON object with the single key bookings"
  - "every response status of this block is one of 200, 400, 404 and 405"
  - "the window filters by overlap and keeps the start-then-id order"
  - "a malformed body never answers 200 and is reported before the room lookup"
feasibility: feasible
```

### room-booking-api:CTR-005

```yaml
id: room-booking-api:CTR-005
template: Contract
obligation: "the delete-booking endpoint answers with exactly one of the documented statuses"
input_classes:
  - name: typical_existing_id
    input: "booking b1 exists; DELETE /bookings/b1 with no body"
    expected: "status 204, empty body, no Content-Type header"
  - name: invalid_unknown_id
    input: "DELETE /bookings/b99 with no body"
    expected: "error code booking_not_found; status 404"
  - name: invalid_repeated_delete
    input: "DELETE /bookings/b1 twice in a row on a booking that existed once"
    expected: "status 204 then error code booking_not_found; status 404"
  - name: invalid_malformed_body
    input: "DELETE /bookings/b99, body {\"x\":"
    expected: "error code invalid_json; status 400"
  - name: boundary_valid_json_body
    input: "booking b2 exists; DELETE /bookings/b2 carrying the body {\"hello\":1}"
    expected: "status 204 with an empty body"
  - name: invalid_wrong_method
    input: "GET /bookings/b1 with no body"
    expected: "error code method_not_allowed; status 405"
  - name: invalid_unknown_path
    input: "DELETE /bookings with no body"
    expected: "error code not_found; status 404"
negative_oracle:
  - input_class: invalid_unknown_id
    must_fail_with: "booking_not_found"
    must_not: "a 204 response"
  - input_class: invalid_repeated_delete
    must_fail_with: "booking_not_found"
    must_not: "a 204 response on the second request"
  - input_class: invalid_malformed_body
    must_fail_with: "invalid_json"
    must_not: "a 404 response whose error field is booking_not_found"
  - input_class: invalid_wrong_method
    must_fail_with: "method_not_allowed"
    must_not: "a 404 response whose error field is not_found"
  - input_class: invalid_unknown_path
    must_fail_with: "not_found"
    must_not: "a 405 response whose error field is method_not_allowed"
assertion_summary:
  - "every response status of this block is one of 204, 400, 404 and 405"
  - "the 204 response carries an empty body and no Content-Type header"
  - "every error body carries an error field with the documented code"
feasibility: feasible
```

### room-booking-api:CTR-006

```yaml
id: room-booking-api:CTR-006
template: Contract
obligation: "the availability endpoint answers with exactly one of the documented statuses and bodies"
input_classes:
  - name: typical_valid
    input: "free room r2 capacity 8 and free room r3 capacity 4; GET /availability?start=2026-11-02T09:00:00Z&end=2026-11-02T10:00:00Z&attendees=4"
    expected: "status 200, body {\"rooms\":[r3, r2]}"
  - name: invalid_missing_start
    input: "GET /availability?end=2026-11-02T10:00:00Z&attendees=4"
    expected: "error code invalid_query; status 400"
  - name: invalid_inverted_bounds
    input: "GET /availability?start=2026-11-02T10:00:00Z&end=2026-11-02T09:00:00Z&attendees=4"
    expected: "error code invalid_query; status 400"
  - name: invalid_non_integer_attendees
    input: "GET /availability?start=2026-11-02T09:00:00Z&end=2026-11-02T10:00:00Z&attendees=four"
    expected: "error code invalid_query; status 400"
  - name: absent_body
    input: "GET /availability with a valid query and no request body"
    expected: "status 200 with a rooms array"
  - name: boundary_valid_json_body
    input: "GET /availability with a valid query carrying the body {\"hello\":1}"
    expected: "status 200 with the same rooms array the same request without a body returns"
  - name: invalid_malformed_body
    input: "GET /availability?start=2026-11-02T09:00:00Z&end=2026-11-02T10:00:00Z&attendees=4 carrying the body {\"hello\":"
    expected: "error code invalid_json; status 400"
  - name: invalid_wrong_method
    input: "POST /availability with no body"
    expected: "error code method_not_allowed; status 405"
negative_oracle:
  - input_class: invalid_missing_start
    must_fail_with: "invalid_query"
    must_not: "a 200 response carrying a rooms array"
  - input_class: invalid_inverted_bounds
    must_fail_with: "invalid_query"
    must_not: "a 200 response carrying every room"
  - input_class: invalid_non_integer_attendees
    must_fail_with: "invalid_query"
    must_not: "a 200 response carrying a rooms array"
  - input_class: invalid_malformed_body
    must_fail_with: "invalid_json"
    must_not: "a 400 response whose error field is invalid_query"
  - input_class: invalid_wrong_method
    must_fail_with: "method_not_allowed"
    must_not: "a 200 response carrying a rooms array"
assertion_summary:
  - "the success body is a JSON object with the single key rooms"
  - "every response status of this block is one of 200, 400 and 405"
  - "no room with a booking overlapping the window appears in any 200 response"
  - "a malformed body is reported as invalid_json before the query validation"
feasibility: feasible
```

### room-booking-api:CTR-008

```yaml
id: room-booking-api:CTR-008
template: Contract
obligation: "unmatched paths and unsupported methods produce the documented routing errors"
input_classes:
  - name: typical_unmatched_path
    input: "GET /nope with no body"
    expected: "error code not_found; status 404"
  - name: boundary_unmatched_nested
    input: "GET /rooms/r1 with no body"
    expected: "error code not_found; status 404"
  - name: boundary_unsupported_method_collection
    input: "DELETE /rooms with no body"
    expected: "error code method_not_allowed; status 405"
  - name: boundary_unsupported_method_booking_path
    input: "PUT /rooms/r1/bookings with no body"
    expected: "error code method_not_allowed; status 405"
  - name: boundary_unsupported_method_item
    input: "GET /bookings/b1 with no body"
    expected: "error code method_not_allowed; status 405"
  - name: boundary_unsupported_method_availability
    input: "POST /availability with no body"
    expected: "error code method_not_allowed; status 405"
  - name: invalid_route_before_body
    input: "PUT /nope carrying the body {\"x\":"
    expected: "error code not_found; status 404"
  - name: invalid_method_before_body
    input: "DELETE /rooms carrying the body {\"x\":"
    expected: "error code method_not_allowed; status 405"
negative_oracle:
  - input_class: typical_unmatched_path
    must_fail_with: "not_found"
    must_not: "a 405 response whose error field is method_not_allowed"
  - input_class: boundary_unmatched_nested
    must_fail_with: "not_found"
    must_not: "a 405 response whose error field is method_not_allowed"
  - input_class: boundary_unsupported_method_collection
    must_fail_with: "method_not_allowed"
    must_not: "a 404 response whose error field is not_found"
  - input_class: boundary_unsupported_method_booking_path
    must_fail_with: "method_not_allowed"
    must_not: "a 404 response whose error field is not_found"
  - input_class: boundary_unsupported_method_item
    must_fail_with: "method_not_allowed"
    must_not: "a 404 response whose error field is not_found"
  - input_class: boundary_unsupported_method_availability
    must_fail_with: "method_not_allowed"
    must_not: "a 404 response whose error field is not_found"
  - input_class: invalid_route_before_body
    must_fail_with: "not_found"
    must_not: "a 400 response whose error field is invalid_json"
  - input_class: invalid_method_before_body
    must_fail_with: "method_not_allowed"
    must_not: "a 400 response whose error field is invalid_json"
assertion_summary:
  - "an unmatched path answers status 404 and a known path with an unsupported method answers status 405"
  - "both errors use the same JSON envelope with the code in the error field"
  - "routing is decided before body parsing, so a malformed body never overrides a routing error"
feasibility: feasible
```

### room-booking-api:INV-001

```yaml
id: room-booking-api:INV-001
template: Invariant
obligation: "ids form a gap-free creation-ordered sequence per kind"
input_classes:
  - name: typical_first_ids
    input: "create two rooms and one booking on each through the API"
    expected: "the rooms carry r1 and r2, and the bookings carry b1 and b2, in creation order"
  - name: boundary_many_rooms
    input: "create eleven rooms in one session; GET /rooms"
    expected: "the rooms array carries r1 through r11, each id used once"
  - name: boundary_after_delete
    input: "create three bookings b1, b2, b3, delete b1, then create a booking on a room that is free"
    expected: "the new booking carries b4, never b1"
  - name: empty_start
    input: "GET /rooms on a freshly started process, then create one room"
    expected: "the list is empty and the first created room carries r1"
negative_oracle: []
assertion_summary:
  - "no id value appears twice among all created rooms and all created bookings of a session"
  - "the nth created room carries r<n> and the nth created booking carries b<n>, across rooms"
  - "a booking id is never reused after its booking is deleted"
  - "room ids and booking ids are counted independently of each other"
feasibility: feasible
```

### room-booking-api:INV-002

```yaml
id: room-booking-api:INV-002
template: Invariant
obligation: "touching intervals never count as overlapping"
input_classes:
  - name: typical_adjacent
    input: "room r1 with a booking over 2026-11-02T09:00:00Z to 10:00:00Z; a new booking over 10:00:00Z to 10:30:00Z"
    expected: "status 201, and both bookings appear in GET /rooms/r1/bookings"
  - name: empty_schedule
    input: "room r1 with no booking; a new booking over 2026-11-02T09:00:00Z to 10:00:00Z"
    expected: "status 201 with a booking object"
  - name: boundary_one_minute_overlap
    input: "room r1 with a booking over 09:00:00Z to 10:00:00Z; a new booking over 09:59:00Z to 10:30:00Z"
    expected: "error code room_busy; status 409"
  - name: boundary_query_window_ends_at_start
    input: "room r1 with a booking over 09:00:00Z to 10:00:00Z; GET /rooms/r1/bookings?from=2026-11-02T08:00:00Z&to=2026-11-02T09:00:00Z"
    expected: "status 200, body {\"bookings\":[]}"
  - name: boundary_availability_touching
    input: "room r1 with a booking over 09:00:00Z to 10:00:00Z; GET /availability?start=2026-11-02T10:00:00Z&end=2026-11-02T10:30:00Z&attendees=1"
    expected: "status 200 with r1 in the rooms array"
negative_oracle:
  - input_class: boundary_one_minute_overlap
    must_fail_with: "room_busy"
    must_not: "a 201 response carrying a booking object"
assertion_summary:
  - "no interval that only shares an endpoint with an existing booking is ever rejected as busy"
  - "a window whose end equals a booking start excludes that booking from the list and from availability"
  - "every class that touches answers status 200 or 201, never 409"
feasibility: feasible
```

### room-booking-api:INV-003

```yaml
id: room-booking-api:INV-003
template: Invariant
obligation: "every error body carries one of the fixed codes"
input_classes:
  - name: typical_validation_error
    input: "POST /rooms, body {\"name\":\"\",\"capacity\":8}"
    expected: "status 400, body {\"error\":\"invalid_room\"}"
  - name: typical_routing_error
    input: "GET /nope with no body"
    expected: "status 404, body {\"error\":\"not_found\"}"
  - name: typical_conflict_error
    input: "a room named Aurora exists; POST /rooms, body {\"name\":\"AURORA\",\"capacity\":4}"
    expected: "status 409, body {\"error\":\"room_name_taken\"}"
  - name: boundary_room_busy
    input: "room r1 with b1 over 09:00:00Z to 10:00:00Z; a new booking over 09:30:00Z to 10:30:00Z"
    expected: "status 409, body {\"error\":\"room_busy\",\"conflictingBookingId\":\"b1\"}"
  - name: empty_success_response
    input: "GET /rooms on a freshly started process"
    expected: "status 200, body {\"rooms\":[]} with no error field"
  - name: invalid_repeated_run
    input: "the same invalid POST /rooms body sent twice within one session"
    expected: "the same error code in both responses"
negative_oracle:
  - input_class: typical_validation_error
    must_fail_with: "invalid_room"
    must_not: "an error body whose error field is a prose sentence"
  - input_class: typical_routing_error
    must_fail_with: "not_found"
    must_not: "an error body whose error field is a prose sentence"
  - input_class: typical_conflict_error
    must_fail_with: "room_name_taken"
    must_not: "an error body whose error field is a prose sentence"
  - input_class: boundary_room_busy
    must_fail_with: "room_busy"
    must_not: "a room_busy body without a conflictingBookingId field"
assertion_summary:
  - "every non-2xx body is a JSON object whose error field is exactly one of the eleven documented codes"
  - "no error body carries a free-text message as its error field"
  - "conflictingBookingId appears in room_busy bodies only"
  - "the same invalid input yields the same code on every repetition"
feasibility: feasible
```

### room-booking-api:INV-004

```yaml
id: room-booking-api:INV-004
template: Invariant
obligation: "Content-Type is application/json on every response except the 204"
input_classes:
  - name: typical_success_response
    input: "POST /rooms, body {\"name\":\"Aurora\",\"capacity\":8}"
    expected: "status 201 with the header Content-Type application/json"
  - name: typical_error_response
    input: "GET /nope with no body"
    expected: "status 404 with the header Content-Type application/json"
  - name: boundary_bodiless_204
    input: "booking b1 exists; DELETE /bookings/b1"
    expected: "status 204, empty body, no Content-Type header"
negative_oracle: []
assertion_summary:
  - "every response that carries a body carries Content-Type application/json"
  - "the 204 response carries an empty body and never carries a Content-Type header"
  - "no response carries a content type other than application/json"
feasibility: feasible
```

### room-booking-api:INV-005

```yaml
id: room-booking-api:INV-005
template: Invariant
obligation: "a restarted process starts with an empty store"
input_classes:
  - name: empty_fresh_process
    input: "start the process and immediately send GET /rooms"
    expected: "status 200, body {\"rooms\":[]}"
  - name: restart_with_rooms
    input: "start the process, create room r1, stop the process, start it again, GET /rooms"
    expected: "status 200, body {\"rooms\":[]}"
  - name: restart_with_bookings
    input: "create room r1 and a booking b1 on it, stop the process, start it again, GET /rooms and GET /rooms/r1/bookings"
    expected: "status 200 with an empty rooms array, and status 404 room_not_found for the booking list of r1"
  - name: boundary_reassigned_first_id
    input: "after a restart with rooms and bookings present before it, POST /rooms with name Aurora and capacity 8"
    expected: "status 201 with id r1"
negative_oracle: []
assertion_summary:
  - "no room and no booking created before a restart is readable after it"
  - "a restarted process assigns r1 to its first room and b1 to its first booking"
  - "the process is reachable and answers requests after every restart"
feasibility: feasible
```

### room-booking-api:INV-006

```yaml
id: room-booking-api:INV-006
template: Invariant
obligation: "the first matching rule in the fixed order decides the response"
input_classes:
  - name: typical_route_before_method
    input: "PUT /nope carrying the body {\"x\":"
    expected: "error code not_found; status 404"
  - name: typical_method_before_body
    input: "DELETE /rooms carrying the body {\"x\":"
    expected: "error code method_not_allowed; status 405"
  - name: boundary_body_before_endpoint_rules
    input: "GET /availability?start=2026-11-02T09:00:00Z&end=2026-11-02T10:00:00Z&attendees=two carrying the body {\"x\":"
    expected: "error code invalid_json; status 400"
  - name: boundary_absent_body_accepted
    input: "GET /rooms with no body, and DELETE /bookings/b99 with no body"
    expected: "status 200 for the first and error code booking_not_found with status 404 for the second"
  - name: boundary_two_endpoint_rules_room
    input: "a room named Aurora exists; POST /rooms, body carrying the letter A repeated 41 times and capacity 8 where the name repeats Aurora only in a shorter form"
    expected: "error code invalid_room; status 400"
  - name: boundary_two_endpoint_rules_booking
    input: "POST /rooms/r99/bookings, body {\"title\":\"\",\"start\":\"2026-11-02T09:00:00Z\",\"end\":\"2026-11-02T09:30:00Z\",\"attendees\":5}"
    expected: "error code room_not_found; status 404"
  - name: invalid_attendees_zero_code
    input: "room r1 capacity 8; POST /rooms/r1/bookings, body title Standup, start 2026-11-02T09:00:00Z, end 2026-11-02T09:30:00Z, attendees 0"
    expected: "error code invalid_booking; status 400"
negative_oracle:
  - input_class: typical_route_before_method
    must_fail_with: "not_found"
    must_not: "a 405 response whose error field is method_not_allowed"
  - input_class: typical_method_before_body
    must_fail_with: "method_not_allowed"
    must_not: "a 400 response whose error field is invalid_json"
  - input_class: boundary_body_before_endpoint_rules
    must_fail_with: "invalid_json"
    must_not: "a 400 response whose error field is invalid_query"
  - input_class: boundary_absent_body_accepted
    must_fail_with: "booking_not_found"
    must_not: "a 400 response whose error field is invalid_json"
  - input_class: boundary_two_endpoint_rules_room
    must_fail_with: "invalid_room"
    must_not: "a 409 response whose error field is room_name_taken"
  - input_class: boundary_two_endpoint_rules_booking
    must_fail_with: "room_not_found"
    must_not: "a 400 response whose error field is invalid_booking"
  - input_class: invalid_attendees_zero_code
    must_fail_with: "invalid_booking"
    must_not: "a 422 response whose error field is over_capacity"
assertion_summary:
  - "a request breaking several rules answers exactly one status and exactly one code"
  - "the response never concatenates two codes and never answers with the lower-priority code"
  - "an absent body is never reported as an error"
  - "the response of every class is the same on repetition of the same request"
feasibility: feasible
```

### room-booking-api:INV-007

```yaml
id: room-booking-api:INV-007
template: Invariant
obligation: "id ordering is numeric, not lexicographic"
input_classes:
  - name: boundary_eleven_rooms
    input: "create r1 through r11 in creation order; GET /rooms"
    expected: "status 200 with r1, r2, ..., r9, r10, r11 in that order"
  - name: typical_two_digit_ids
    input: "create ten rooms in creation order; GET /rooms"
    expected: "status 200 with r2 before r3 before r10, and r9 immediately before r10"
  - name: boundary_eleven_bookings
    input: "create eleven non-overlapping bookings across two rooms; read the booking list of each room"
    expected: "status 200 with the booking ids numbered in creation order and each list in start order"
  - name: empty_store
    input: "GET /rooms on a freshly started process"
    expected: "status 200, body {\"rooms\":[]}"
negative_oracle: []
assertion_summary:
  - "an id with a larger number never precedes an id with a smaller number in a response ordered by id"
  - "r10 appears after r2 and b10 appears after b2"
  - "the order in the response always equals the creation order of the entities"
feasibility: feasible
```

### room-booking-api:INV-008

```yaml
id: room-booking-api:INV-008
template: Invariant
obligation: "room and booking key sets equal the documented sets"
input_classes:
  - name: typical_room_create_response
    input: "POST /rooms, body {\"name\":\"Aurora\",\"capacity\":8}"
    expected: "status 201 with a body whose keys are exactly id, name and capacity"
  - name: typical_room_in_list
    input: "two rooms exist; GET /rooms"
    expected: "status 200 with every room object carrying exactly id, name and capacity"
  - name: boundary_room_in_availability
    input: "GET /availability?start=2026-11-02T09:00:00Z&end=2026-11-02T10:00:00Z&attendees=1"
    expected: "status 200 with every room object carrying exactly id, name and capacity"
  - name: typical_booking_in_create_response
    input: "room r1 capacity 8; a valid create booking request"
    expected: "status 201 with a body whose keys are exactly id, roomId, title, start, end and attendees"
  - name: boundary_booking_in_list
    input: "room r1 with two bookings; GET /rooms/r1/bookings"
    expected: "status 200 with every booking object carrying exactly those six keys"
  - name: invalid_extra_field_in_request
    input: "POST /rooms, body {\"name\":\"Aurora\",\"capacity\":8,\"colour\":\"blue\"}"
    expected: "status 201 with a body whose keys are exactly id, name and capacity, no colour key"
negative_oracle: []
assertion_summary:
  - "no room object ever carries a field outside id, name and capacity"
  - "no booking object ever carries a field outside id, roomId, title, start, end and attendees"
  - "no documented field is ever absent from a room or booking object"
feasibility: feasible
```

### room-booking-api:SCN-001

```yaml
id: room-booking-api:SCN-001
template: Scenario
obligation: "the intervals and ids follow the sequence of booking a room, deleting the booking and booking the freed interval"
input_classes:
  - name: typical_sequence
    input: "fresh process: POST /rooms name Aurora capacity 8, then book [2026-11-02T09:00:00Z, 10:00:00Z) attendees 5, then book [09:30:00Z, 10:30:00Z) attendees 5, then DELETE /bookings/b1, then GET /rooms/r1/bookings, then book [09:30:00Z, 10:30:00Z) attendees 5"
    expected: "201 with r1, 201 with b1, 409 room_busy naming b1, 204 with no body, 200 with {\"bookings\":[]}, 201 with b2"
  - name: boundary_rejected_create_retried
    input: "repeat the rejected create with the same body directly after the 409, before the delete"
    expected: "409 room_busy again, with conflictingBookingId b1"
  - name: boundary_freed_interval_reused
    input: "after the delete, book exactly [09:00:00Z, 10:00:00Z) on r1"
    expected: "status 201 with a booking object"
  - name: invalid_retry_before_delete
    input: "book [09:30:00Z, 10:30:00Z) again after the 409 but before the delete"
    expected: "error code room_busy; status 409"
negative_oracle:
  - input_class: invalid_retry_before_delete
    must_fail_with: "room_busy"
    must_not: "a 201 response carrying a booking object"
assertion_summary:
  - "the first booking carries id b1 and the booking created after the delete carries b2, never b1 again"
  - "the booking list is empty between the delete and the next create"
  - "the rebooking of the freed interval answers 201, never 409"
  - "the 204 response of the delete carries an empty body"
observable_sequence:
  - "POST /rooms name Aurora capacity 8 -> status 201 with room id r1"
  - "POST /rooms/r1/bookings title Standup, [2026-11-02T09:00:00Z, 10:00:00Z), attendees 5 -> status 201 with booking id b1"
  - "POST /rooms/r1/bookings title Review, [09:30:00Z, 10:30:00Z), attendees 5 -> status 409 with room_busy and conflictingBookingId b1"
  - "DELETE /bookings/b1 -> status 204 with an empty body"
  - "GET /rooms/r1/bookings -> status 200 with body {\"bookings\":[]}"
  - "POST /rooms/r1/bookings title Review, [09:30:00Z, 10:30:00Z), attendees 5 -> status 201 with booking id b2"
feasibility: feasible
```

### room-booking-api:SCN-002

```yaml
id: room-booking-api:SCN-002
template: Scenario
obligation: "booking ids increase by one per created booking across rooms and are never reused"
input_classes:
  - name: typical_creation_order
    input: "rooms r1 and r2 with no bookings: book r1, then r2, then r1 again"
    expected: "the bookings carry ids b1, b2 and b3 in that order"
  - name: boundary_id_after_delete
    input: "delete the first booking, then create one booking on either room"
    expected: "the new booking carries b4"
  - name: empty_start
    input: "rooms r1 and r2 exist with no booking at all; create the first booking on r2"
    expected: "status 201 with booking id b1, although r2 is not the first room"
  - name: invalid_rejected_booking_consumes_no_id
    input: "room r1 capacity 8; a create request with attendees 9, then a valid create request"
    expected: "status 422 over_capacity for the first, and the next created booking carries the next unused id"
negative_oracle:
  - input_class: invalid_rejected_booking_consumes_no_id
    must_fail_with: "over_capacity"
    must_not: "a 201 response carrying a booking object"
assertion_summary:
  - "the id of each created booking equals b followed by the number of bookings created before it plus one"
  - "the counter is shared across rooms, never reset per room and never reset by a delete"
  - "a booking id is never handed out twice in one session"
observable_sequence:
  - "POST /rooms/r1/bookings with a valid body -> status 201 with id b1"
  - "POST /rooms/r2/bookings with a valid body -> status 201 with id b2"
  - "POST /rooms/r1/bookings with a valid body -> status 201 with id b3"
  - "DELETE /bookings/b1 -> status 204"
  - "POST /rooms/r2/bookings with a valid body -> status 201 with id b4"
feasibility: feasible
```

### room-booking-api:SCN-003

```yaml
id: room-booking-api:SCN-003
template: Scenario
obligation: "the conflictingBookingId is the id of the earliest-starting conflicting booking"
input_classes:
  - name: typical_earliest_start_named
    input: "room r1 with b1 over [2026-11-02T10:00:00Z, 11:00:00Z), b2 over [09:00:00Z, 09:30:00Z) and b3 over [09:30:00Z, 10:00:00Z), created in the order b1, b2, b3; a new booking over [09:15:00Z, 10:30:00Z)"
    expected: "status 409, body {\"error\":\"room_busy\",\"conflictingBookingId\":\"b2\"}"
  - name: boundary_single_conflict
    input: "room r1 with only b1 over [09:00:00Z, 10:00:00Z); a new booking over [09:15:00Z, 09:45:00Z)"
    expected: "status 409, body {\"error\":\"room_busy\",\"conflictingBookingId\":\"b1\"}"
  - name: boundary_tie_lowest_id
    input: "room r1 with a booking carrying the lower id and a booking carrying the higher id, both starting at 09:00:00Z on two different days so the ids stay distinct; a new interval overlapping both"
    expected: "status 409 naming the conflicting booking with the lower id"
negative_oracle:
  - input_class: typical_earliest_start_named
    must_fail_with: "room_busy"
    must_not: "a 201 response carrying a booking object"
assertion_summary:
  - "the named conflictingBookingId is the earliest-starting conflicting booking, which is not always the lowest id"
  - "the booking list of r1 is unchanged after the rejected request and reads b2, b3, b1 in start order"
  - "the conflict is detected, so the request is never answered with 201"
observable_sequence:
  - "POST /rooms/r1/bookings over [10:00:00Z, 11:00:00Z) -> status 201 with id b1"
  - "POST /rooms/r1/bookings over [09:00:00Z, 09:30:00Z) -> status 201 with id b2"
  - "POST /rooms/r1/bookings over [09:30:00Z, 10:00:00Z) -> status 201 with id b3"
  - "POST /rooms/r1/bookings over [09:15:00Z, 10:30:00Z) -> status 409 with room_busy and conflictingBookingId b2"
  - "GET /rooms/r1/bookings -> status 200 listing b2, b3, b1 in that order"
feasibility: feasible
```

### room-booking-api:NFR-001

```yaml
id: room-booking-api:NFR-001
template: NFR
obligation: "the command npm run build exits 0"
input_classes:
  - name: typical_clean_checkout
    input: "the command npm run build started in a clean checkout with no environment variable set"
    expected: "exit code 0"
  - name: empty_environment
    input: "the command npm run build started with an empty environment except the executable search path"
    expected: "exit code 0"
  - name: boundary_second_run
    input: "the command npm run build started twice in a row with no source change between the runs"
    expected: "exit code 0 on both runs"
negative_oracle: []
assertion_summary:
  - "the exit code of the build command is 0"
  - "the build log carries no line reporting a compilation failure"
  - "the second run exits 0 as well, so the build is repeatable in place"
feasibility: feasible
```

### room-booking-api:NFR-002

```yaml
id: room-booking-api:NFR-002
template: NFR
obligation: "npm test exits 0 with a non-empty test count"
input_classes:
  - name: typical_full_suite
    input: "the command npm test over the whole suite"
    expected: "exit code 0 and a report stating a non-zero number of executed tests"
  - name: boundary_ephemeral_port
    input: "npm test run with the server started on an ephemeral port"
    expected: "exit code 0"
  - name: empty_report
    input: "npm test in a checkout where no test file matches the suite pattern"
    expected: "a report stating zero executed tests, which violates the obligation"
negative_oracle: []
assertion_summary:
  - "the exit code of the test command is 0"
  - "the report states a count of executed tests greater than zero"
feasibility: infeasible_candidate
infeasibility_reason: "the predicate reports the exit code and the executed-test count of the very run that would assert it, so no deterministic test inside the suite can observe them"
```

### room-booking-api:POL-001

```yaml
id: room-booking-api:POL-001
template: Policy
obligation: "every error body uses one of the fixed codes"
input_classes:
  - name: typical_validation_error
    input: "POST /rooms, body {\"name\":\"Aurora\",\"capacity\":0}"
    expected: "status 400, body {\"error\":\"invalid_room\"}"
  - name: typical_routing_error
    input: "GET /nope with no body"
    expected: "status 404, body {\"error\":\"not_found\"}"
  - name: typical_conflict_error
    input: "a room named Aurora exists; POST /rooms, body {\"name\":\"aurora\",\"capacity\":4}"
    expected: "status 409, body {\"error\":\"room_name_taken\"}"
  - name: empty_body_error
    input: "POST /rooms with an empty request body"
    expected: "status 400, body {\"error\":\"invalid_json\"}"
  - name: boundary_room_busy_envelope
    input: "room r1 with b1 over [2026-11-02T09:00:00Z, 10:00:00Z); a new booking over [09:30:00Z, 10:30:00Z)"
    expected: "status 409, body {\"error\":\"room_busy\",\"conflictingBookingId\":\"b1\"}"
  - name: invalid_repeated_run
    input: "the same invalid booking body sent twice within one session"
    expected: "the same code in both responses"
negative_oracle:
  - input_class: typical_validation_error
    must_fail_with: "invalid_room"
    must_not: "an error body whose error field is a human-readable sentence"
  - input_class: typical_routing_error
    must_fail_with: "not_found"
    must_not: "an error body whose error field is a human-readable sentence"
  - input_class: typical_conflict_error
    must_fail_with: "room_name_taken"
    must_not: "an error body whose error field is a human-readable sentence"
  - input_class: empty_body_error
    must_fail_with: "invalid_json"
    must_not: "an error body whose error field is a human-readable sentence"
  - input_class: boundary_room_busy_envelope
    must_fail_with: "room_busy"
    must_not: "a room_busy body without a conflictingBookingId field"
assertion_summary:
  - "every error body across validation, routing and conflict classes is a JSON object whose error field holds exactly one documented snake_case code"
  - "no error body carries a prose message in the error field"
  - "conflictingBookingId appears in room_busy bodies and in no other error body"
  - "the same input class yields the same code on every repetition"
feasibility: feasible
```

### room-booking-api:POL-002

```yaml
id: room-booking-api:POL-002
template: Policy
obligation: "the process keeps serving after every invalid request class"
input_classes:
  - name: typical_malformed_then_valid
    input: "POST /rooms with the body {\"name\": then POST /rooms with body {\"name\":\"Aurora\",\"capacity\":8}"
    expected: "status 400 invalid_json then status 201 with a room object"
  - name: empty_body_then_valid
    input: "POST /rooms with an empty body then GET /rooms"
    expected: "status 400 invalid_json then status 200 with a rooms array"
  - name: boundary_wrong_type_then_valid
    input: "GET /rooms?minCapacity=abc then GET /rooms?minCapacity=8"
    expected: "status 400 invalid_query then status 200 with a rooms array"
  - name: boundary_missing_field_then_valid
    input: "POST /rooms with body {\"name\":\"Aurora\"} then GET /rooms"
    expected: "status 400 invalid_room then status 200 with a rooms array"
  - name: boundary_unknown_route_then_valid
    input: "GET /nope then GET /rooms"
    expected: "status 404 not_found then status 200 with a rooms array"
negative_oracle:
  - input_class: typical_malformed_then_valid
    must_fail_with: "invalid_json"
    must_not: "an unanswered or refused next request"
  - input_class: empty_body_then_valid
    must_fail_with: "invalid_json"
    must_not: "an unanswered or refused next request"
  - input_class: boundary_wrong_type_then_valid
    must_fail_with: "invalid_query"
    must_not: "an unanswered or refused next request"
  - input_class: boundary_missing_field_then_valid
    must_fail_with: "invalid_room"
    must_not: "an unanswered or refused next request"
  - input_class: boundary_unknown_route_then_valid
    must_fail_with: "not_found"
    must_not: "an unanswered or refused next request"
assertion_summary:
  - "each invalid class answers a documented status and body, never a dropped connection"
  - "the request sent directly after each invalid class is answered with its documented success status"
  - "the invalid request never leaves a partial room or booking that the next list would show"
feasibility: feasible
```

## 4. Infeasible candidates

| id | reason | what would make it feasible |
| --- | --- | --- |
| room-booking-api:NFR-002 | the predicate reports the exit code and the executed-test count of the run that would assert it, so the observation is self-referential and no deterministic test inside the suite can make it | an observation point outside the run under test, such as the recorded exit code and test count of the suite reported by the integrating stage, read as data by a separate check |
