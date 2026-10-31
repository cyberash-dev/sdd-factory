# Verification design: room-booking-api

## 1. Scope

Boundary type: `api` (surface `room-booking-api:SUR-001`). Every stimulus below is an HTTP request to a freshly started server process; every observable is the response status, the response headers, the response body or a follow-up request against the same process.

Eligible approved records and block count:

| template | count | ids |
| --- | --- | --- |
| Behavior | 21 | BEH-001 … BEH-021 |
| Contract | 7 | CTR-001 … CTR-007 |
| Invariant | 6 | INV-001 … INV-006 |
| Scenario | 2 | SCN-001, SCN-002 |
| NFR | 1 | NFR-001 |
| Policy | 2 | POL-001, POL-002 |
| **total** | **39** | |

IDs skipped and why:

- §3 Partition `room-booking-api` — partition metadata, not a requirement record.
- `BL-001` — BrownfieldBaseline.
- `SUR-001` — Surface; used only to fix the concrete form of inputs and observables, never verified as a record.
- `OQ-001` … `OQ-006` — Open-Q records, no `test_obligation`.
- `ASM-001` … `ASM-008` — ASSUMPTION records; their defaults are asserted inside the behaviour, contract and invariant blocks that carry them in their `tests` field, but they take no block of their own.
- `EXT-001` — ExternalDependency, not an eligible template; the PORT boundary it describes is verified through BEH-021 and CTR-007.
- `CON-001` … `CON-005` — Constraint, not an eligible template.

## 2. Error oracle

Every failure below is observable at the boundary as an HTTP status plus a JSON body whose `error` field holds the code, with `Content-Type application/json`, and the process keeps serving the next request (POL-002).

| error code | observable signal | source record(s) |
| --- | --- | --- |
| `invalid_room` | HTTP 400, body `error` = `invalid_room` | CTR-001, CTR-007, POL-001 |
| `invalid_json` | HTTP 400, body `error` = `invalid_json` | CTR-001, CTR-003, CTR-007, POL-001 |
| `invalid_query` | HTTP 400, body `error` = `invalid_query` | CTR-002, CTR-004, CTR-006, CTR-007, POL-001 |
| `invalid_booking` | HTTP 400, body `error` = `invalid_booking` | CTR-003, CTR-007, POL-001 |
| `not_found` | HTTP 404, body `error` = `not_found` | CTR-001, CTR-002, CTR-003, CTR-004, CTR-005, CTR-006, CTR-007, POL-001 |
| `room_not_found` | HTTP 404, body `error` = `room_not_found` | CTR-003, CTR-004, CTR-007, POL-001 |
| `booking_not_found` | HTTP 404, body `error` = `booking_not_found` | CTR-005, CTR-007, POL-001 |
| `method_not_allowed` | HTTP 405, body `error` = `method_not_allowed` | CTR-001, CTR-002, CTR-003, CTR-004, CTR-005, CTR-006, CTR-007, POL-001 |
| `room_name_taken` | HTTP 409, body `error` = `room_name_taken` | CTR-001, CTR-007, POL-001 |
| `room_busy` | HTTP 409, body `error` = `room_busy` plus `conflictingBookingId` | CTR-003, CTR-007, POL-001 |
| `over_capacity` | HTTP 422, body `error` = `over_capacity` | CTR-003, CTR-007, POL-001 |

No other failure shape exists: a success status with an `error` field, a prose-only error value, a code outside the eleven above, a 5xx, a dropped connection or a process that stops answering all contradict the catalogue of CTR-007 and POL-001. The single bodyless success is `204` from `DELETE /bookings/:bookingId` (CTR-005, CTR-007, INV-002).

## 3. Blocks

### room-booking-api:BEH-001

```yaml
id: "room-booking-api:BEH-001"
template: "Behavior"
obligation: "A valid room body returns 201 with id r1 and the submitted name and capacity, and a second valid room returns r2."
input_classes:
  - name: "typical_empty_store"
    input: "POST /rooms with body {\"name\": \"Aurora\", \"capacity\": 6} against a freshly started process with no rooms"
    expected: "201, Content-Type application/json, body {\"id\": \"r1\", \"name\": \"Aurora\", \"capacity\": 6}"
  - name: "boundary_second_room"
    input: "POST /rooms with body {\"name\": \"Borealis\", \"capacity\": 2} directly after the typical request"
    expected: "201, body {\"id\": \"r2\", \"name\": \"Borealis\", \"capacity\": 2}"
  - name: "boundary_duplicate_in_other_case"
    input: "POST /rooms with body {\"name\": \"AURORA\", \"capacity\": 3} while a room named Aurora exists"
    expected: "409 room_name_taken"
  - name: "empty_missing_capacity"
    input: "POST /rooms with body {\"name\": \"Cirrus\"}"
    expected: "400 invalid_room"
  - name: "invalid_capacity_zero"
    input: "POST /rooms with body {\"name\": \"Aurora\", \"capacity\": 0} on an empty process"
    expected: "400 invalid_room"
  - name: "invalid_malformed_json"
    input: "POST /rooms with body {\"name\": \"Aurora\", \"capacity\":"
    expected: "400 invalid_json"
negative_oracle:
  - input_class: "invalid_capacity_zero"
    must_fail_with: "invalid_room"
    must_not: "a 201 response, or a room named Aurora appearing in the GET /rooms body"
  - input_class: "invalid_malformed_json"
    must_fail_with: "invalid_json"
    must_not: "a 201 response, or any room being added to the GET /rooms body"
  - input_class: "empty_missing_capacity"
    must_fail_with: "invalid_room"
    must_not: "a 201 response whose body carries no capacity field"
assertion_summary:
  - "the first accepted response has status 201 and Content-Type application/json"
  - "the first accepted response body has id r1 and echoes the submitted name Aurora and capacity 6"
  - "the second accepted response body has id r2"
  - "each rejected request returns a JSON body whose error field holds the named code and adds no room to the GET /rooms body"
feasibility: "feasible"
```

### room-booking-api:BEH-002

```yaml
id: "room-booking-api:BEH-002"
template: "Behavior"
obligation: "Each of an empty name, a 41-character name, capacity 0, capacity 101 and capacity 1.5 responds 400 invalid_room and leaves the room count unchanged."
input_classes:
  - name: "typical_name_of_40_characters"
    input: "POST /rooms with body {\"name\": \"0123456789012345678901234567890123456789\", \"capacity\": 1} (the name is the digits 0-9 four times, exactly 40 characters)"
    expected: "201 with the same name and capacity 1"
  - name: "boundary_capacity_1"
    input: "POST /rooms with body {\"name\": \"Borealis\", \"capacity\": 1}"
    expected: "201 with capacity 1"
  - name: "boundary_capacity_100"
    input: "POST /rooms with body {\"name\": \"Cirrus\", \"capacity\": 100}"
    expected: "201 with capacity 100"
  - name: "invalid_name_of_41_characters"
    input: "POST /rooms with body {\"name\": \"01234567890123456789012345678901234567890\", \"capacity\": 1} (41 characters)"
    expected: "400 invalid_room"
  - name: "invalid_capacity_0"
    input: "POST /rooms with body {\"name\": \"Dorado\", \"capacity\": 0}"
    expected: "400 invalid_room"
  - name: "invalid_capacity_101"
    input: "POST /rooms with body {\"name\": \"Dorado\", \"capacity\": 101}"
    expected: "400 invalid_room"
  - name: "invalid_capacity_fractional"
    input: "POST /rooms with body {\"name\": \"Dorado\", \"capacity\": 1.5}"
    expected: "400 invalid_room"
  - name: "empty_name"
    input: "POST /rooms with body {\"name\": \"\", \"capacity\": 2}"
    expected: "400 invalid_room"
  - name: "invalid_whitespace_only_name"
    input: "POST /rooms with body {\"name\": \"   \", \"capacity\": 2}"
    expected: "400 invalid_room"
negative_oracle:
  - input_class: "invalid_name_of_41_characters"
    must_fail_with: "invalid_room"
    must_not: "a 201 response, or a room with a 41-character name appearing in the GET /rooms body"
  - input_class: "invalid_capacity_101"
    must_fail_with: "invalid_room"
    must_not: "a 201 response, or a room with capacity 101 appearing in the GET /rooms body"
  - input_class: "invalid_capacity_fractional"
    must_fail_with: "invalid_room"
    must_not: "a 201 response, or a room whose capacity is not an integer appearing in the GET /rooms body"
  - input_class: "invalid_whitespace_only_name"
    must_fail_with: "invalid_room"
    must_not: "a 201 response, or a room with a whitespace-only name appearing in the GET /rooms body"
assertion_summary:
  - "every listed invalid request returns status 400 and a JSON body with error invalid_room"
  - "the GET /rooms body contains exactly the rooms that existed before each rejected request, so the room count is unchanged"
  - "the 40-character name and the capacities 1 and 100 are accepted with 201"
feasibility: "feasible"
```

### room-booking-api:BEH-003

```yaml
id: "room-booking-api:BEH-003"
template: "Behavior"
obligation: "A room name differing only in case responds 409 room_name_taken and the room count stays unchanged."
input_classes:
  - name: "typical_case_different"
    input: "POST /rooms with body {\"name\": \"AURORA\", \"capacity\": 3} while a room named Aurora exists"
    expected: "409 room_name_taken"
  - name: "boundary_identical_name"
    input: "POST /rooms with body {\"name\": \"Aurora\", \"capacity\": 3} while a room named Aurora exists"
    expected: "409 room_name_taken"
  - name: "boundary_distinct_name"
    input: "POST /rooms with body {\"name\": \"Borealis\", \"capacity\": 3} while a room named Aurora exists"
    expected: "201 with id r2"
  - name: "empty_name"
    input: "POST /rooms with body {\"name\": \"\", \"capacity\": 3} while a room named Aurora exists"
    expected: "400 invalid_room"
negative_oracle:
  - input_class: "typical_case_different"
    must_fail_with: "room_name_taken"
    must_not: "a 201 response, a 400 response, or a second room appearing in the GET /rooms body"
  - input_class: "boundary_identical_name"
    must_fail_with: "room_name_taken"
    must_not: "a 400 invalid_room response used in place of the conflict code"
assertion_summary:
  - "the case-different and identical names return status 409 with error room_name_taken"
  - "the room count in the GET /rooms body is unchanged after each 409"
  - "a distinct name returns 201 and the room count grows by one"
feasibility: "feasible"
```

### room-booking-api:BEH-004

```yaml
id: "room-booking-api:BEH-004"
template: "Behavior"
obligation: "An empty store returns 200 with an empty rooms array, three rooms come back in ascending id order, and minCapacity=8 keeps rooms r2 and r3."
input_classes:
  - name: "typical_empty_store"
    input: "GET /rooms on a freshly started process"
    expected: "200, Content-Type application/json, body {\"rooms\": []}"
  - name: "boundary_single_room"
    input: "GET /rooms after one room r1 with capacity 4 was created"
    expected: "200 with a rooms array of length 1 holding r1"
  - name: "typical_three_rooms"
    input: "GET /rooms after r1 capacity 4, r2 capacity 12 and r3 capacity 8 were created in that order"
    expected: "200 with rooms [r1, r2, r3]"
  - name: "boundary_mincapacity_matching_capacity"
    input: "GET /rooms?minCapacity=8 with the same three rooms"
    expected: "200 with rooms [r2, r3]"
  - name: "boundary_mincapacity_above_all"
    input: "GET /rooms?minCapacity=13 with the same three rooms"
    expected: "200 with {\"rooms\": []}"
  - name: "invalid_mincapacity_zero"
    input: "GET /rooms?minCapacity=0 with the same three rooms"
    expected: "400 invalid_query"
  - name: "invalid_mincapacity_non_numeric"
    input: "GET /rooms?minCapacity=abc with the same three rooms"
    expected: "400 invalid_query"
negative_oracle:
  - input_class: "invalid_mincapacity_zero"
    must_fail_with: "invalid_query"
    must_not: "a 200 response, or a rooms array that ignores the filter"
  - input_class: "invalid_mincapacity_non_numeric"
    must_fail_with: "invalid_query"
    must_not: "a 500 response or a 200 response with rooms listed"
assertion_summary:
  - "the empty store response is 200 with a rooms key holding an empty array, not an absent key"
  - "the three-room response lists ids r1, r2, r3 in that order without reordering by name or capacity"
  - "minCapacity=8 keeps exactly the rooms whose capacity is at least 8, ranked by id"
  - "minCapacity=13 returns 200 with an empty rooms array"
feasibility: "feasible"
```

### room-booking-api:BEH-005

```yaml
id: "room-booking-api:BEH-005"
template: "Behavior"
obligation: "minCapacity values 0, -1, 1.5 and abc each respond 400 invalid_query while 1 responds 200."
input_classes:
  - name: "typical_one"
    input: "GET /rooms?minCapacity=1 with at least one room present"
    expected: "200 with a rooms array"
  - name: "empty_absent"
    input: "GET /rooms with no query string"
    expected: "200 with a rooms array"
  - name: "invalid_zero"
    input: "GET /rooms?minCapacity=0"
    expected: "400 invalid_query"
  - name: "invalid_negative"
    input: "GET /rooms?minCapacity=-1"
    expected: "400 invalid_query"
  - name: "invalid_fractional"
    input: "GET /rooms?minCapacity=1.5"
    expected: "400 invalid_query"
  - name: "invalid_non_numeric"
    input: "GET /rooms?minCapacity=abc"
    expected: "400 invalid_query"
negative_oracle:
  - input_class: "invalid_zero"
    must_fail_with: "invalid_query"
    must_not: "a 200 response that treats the value as absent"
  - input_class: "invalid_negative"
    must_fail_with: "invalid_query"
    must_not: "a 200 response listing every room"
  - input_class: "invalid_fractional"
    must_fail_with: "invalid_query"
    must_not: "a 200 response that rounds the value"
  - input_class: "invalid_non_numeric"
    must_fail_with: "invalid_query"
    must_not: "a 500 response, a dropped connection, or a 200 response"
assertion_summary:
  - "each invalid value returns status 400 with a JSON body whose error field is invalid_query"
  - "minCapacity=1 and an absent parameter both return 200"
feasibility: "feasible"
```

### room-booking-api:BEH-006

```yaml
id: "room-booking-api:BEH-006"
template: "Behavior"
obligation: "A valid booking body responds 201 with id b1 and echoed fields, and a booking in another room afterwards receives b2."
input_classes:
  - name: "typical_first_booking"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Standup\", \"start\": \"2026-11-02T09:30:00Z\", \"end\": \"2026-11-02T10:00:00Z\", \"attendees\": 4} on a process where room r1 exists and no booking exists"
    expected: "201, Content-Type application/json, body {\"id\": \"b1\", \"roomId\": \"r1\", \"title\": \"Standup\", \"start\": \"2026-11-02T09:30:00Z\", \"end\": \"2026-11-02T10:00:00Z\", \"attendees\": 4}"
  - name: "boundary_second_booking_in_another_room"
    input: "POST /rooms/r2/bookings with body {\"title\": \"Review\", \"start\": \"2026-11-02T09:30:00Z\", \"end\": \"2026-11-02T10:00:00Z\", \"attendees\": 2} after the typical booking and with room r2 present"
    expected: "201 with id b2 and roomId r2"
  - name: "boundary_title_of_80_characters"
    input: "POST /rooms/r1/bookings with body {\"title\": \"01234567890123456789012345678901234567890123456789012345678901234567890123456789\", \"start\": \"2026-11-02T11:00:00Z\", \"end\": \"2026-11-02T12:00:00Z\", \"attendees\": 1} (the title is the digits 0-9 eight times, exactly 80 characters)"
    expected: "201 with the same title"
  - name: "empty_title"
    input: "POST /rooms/r1/bookings with body {\"title\": \"\", \"start\": \"2026-11-02T11:00:00Z\", \"end\": \"2026-11-02T12:00:00Z\", \"attendees\": 1}"
    expected: "400 invalid_booking"
  - name: "invalid_title_of_81_characters"
    input: "POST /rooms/r1/bookings with body {\"title\": \"012345678901234567890123456789012345678901234567890123456789012345678901234567890\", \"start\": \"2026-11-02T11:00:00Z\", \"end\": \"2026-11-02T12:00:00Z\", \"attendees\": 1} (81 characters)"
    expected: "400 invalid_booking"
  - name: "invalid_unknown_room"
    input: "POST /rooms/r2/bookings with a valid booking body on a process where room r2 does not exist"
    expected: "404 room_not_found"
negative_oracle:
  - input_class: "empty_title"
    must_fail_with: "invalid_booking"
    must_not: "a 201 response, or a booking appearing in the GET /rooms/r1/bookings body"
  - input_class: "invalid_title_of_81_characters"
    must_fail_with: "invalid_booking"
    must_not: "a 201 response, or a booking with an 81-character title in the listing"
  - input_class: "invalid_unknown_room"
    must_fail_with: "room_not_found"
    must_not: "a 201 response, or any booking being created"
assertion_summary:
  - "the first accepted body has status 201 with id b1 and echoes title, start, end, attendees and roomId unchanged"
  - "the booking in the other room has id b2, so the counter did not restart per room"
  - "the rejected requests add no entry to any booking listing and a 200 status is never returned for a create"
feasibility: "feasible"
```

### room-booking-api:BEH-007

```yaml
id: "room-booking-api:BEH-007"
template: "Behavior"
obligation: "Empty title, 81-character title, unparseable start, second-precision start, zero-length interval, reversed interval and 8-hour-plus-one-minute interval each respond 400 invalid_booking, while an interval of exactly 8 hours responds 201."
input_classes:
  - name: "boundary_eight_hours"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Workshop\", \"start\": \"2026-11-02T09:00:00Z\", \"end\": \"2026-11-02T17:00:00Z\", \"attendees\": 2} where room r1 has capacity 10"
    expected: "201 with the echoed interval"
  - name: "boundary_eight_hours_plus_one_minute"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Workshop\", \"start\": \"2026-11-02T09:00:00Z\", \"end\": \"2026-11-02T17:01:00Z\", \"attendees\": 2}"
    expected: "400 invalid_booking"
  - name: "boundary_zero_length"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Workshop\", \"start\": \"2026-11-02T10:00:00Z\", \"end\": \"2026-11-02T10:00:00Z\", \"attendees\": 2}"
    expected: "400 invalid_booking"
  - name: "boundary_reversed"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Workshop\", \"start\": \"2026-11-02T10:00:00Z\", \"end\": \"2026-11-02T09:00:00Z\", \"attendees\": 2}"
    expected: "400 invalid_booking"
  - name: "boundary_second_precision"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Workshop\", \"start\": \"2026-11-02T09:00:30Z\", \"end\": \"2026-11-02T10:00:00Z\", \"attendees\": 2}"
    expected: "400 invalid_booking"
  - name: "invalid_unparseable_time"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Workshop\", \"start\": \"tomorrow\", \"end\": \"2026-11-02T10:00:00Z\", \"attendees\": 2}"
    expected: "400 invalid_booking"
  - name: "empty_title"
    input: "POST /rooms/r1/bookings with body {\"title\": \"\", \"start\": \"2026-11-02T09:00:00Z\", \"end\": \"2026-11-02T10:00:00Z\", \"attendees\": 2}"
    expected: "400 invalid_booking"
  - name: "invalid_title_of_81_characters"
    input: "POST /rooms/r1/bookings with body {\"title\": \"012345678901234567890123456789012345678901234567890123456789012345678901234567890\", \"start\": \"2026-11-02T09:00:00Z\", \"end\": \"2026-11-02T10:00:00Z\", \"attendees\": 2} (81 characters)"
    expected: "400 invalid_booking"
  - name: "invalid_whitespace_only_title"
    input: "POST /rooms/r1/bookings with body {\"title\": \"   \", \"start\": \"2026-11-02T09:00:00Z\", \"end\": \"2026-11-02T10:00:00Z\", \"attendees\": 2}"
    expected: "400 invalid_booking"
negative_oracle:
  - input_class: "boundary_eight_hours_plus_one_minute"
    must_fail_with: "invalid_booking"
    must_not: "a 201 response, or a booking appearing in the GET /rooms/r1/bookings body"
  - input_class: "boundary_zero_length"
    must_fail_with: "invalid_booking"
    must_not: "a 201 response, or a booking with equal start and end in the listing"
  - input_class: "boundary_second_precision"
    must_fail_with: "invalid_booking"
    must_not: "a 201 response, or a stored start whose seconds were silently dropped"
  - input_class: "invalid_unparseable_time"
    must_fail_with: "invalid_booking"
    must_not: "a 500 response or a 201 response"
  - input_class: "invalid_title_of_81_characters"
    must_fail_with: "invalid_booking"
    must_not: "a 201 response, or a booking whose title is longer than 80 characters in the listing"
assertion_summary:
  - "each rejected request returns status 400 with error invalid_booking"
  - "the booking count of room r1 in the GET /rooms/r1/bookings body is unchanged after every rejection"
  - "an interval of exactly 8 hours is accepted with 201"
feasibility: "feasible"
```

### room-booking-api:BEH-008

```yaml
id: "room-booking-api:BEH-008"
template: "Behavior"
obligation: "A booking on an unknown room id responds 404 room_not_found and the booking count is unchanged."
input_classes:
  - name: "typical_unknown_room"
    input: "POST /rooms/r9/bookings with body {\"title\": \"Standup\", \"start\": \"2026-11-02T09:00:00Z\", \"end\": \"2026-11-02T10:00:00Z\", \"attendees\": 1} on a process where no room r9 exists"
    expected: "404 room_not_found"
  - name: "boundary_existing_room"
    input: "POST /rooms/r1/bookings with the same body where room r1 exists with capacity 10"
    expected: "201 with id b1"
  - name: "empty_store"
    input: "POST /rooms/r1/bookings with a valid booking body on a freshly started process with no rooms"
    expected: "404 room_not_found"
negative_oracle:
  - input_class: "typical_unknown_room"
    must_fail_with: "room_not_found"
    must_not: "a 201 response, a 400 invalid_booking response, or a booking created anywhere"
  - input_class: "empty_store"
    must_fail_with: "room_not_found"
    must_not: "a 201 response or a 400 invalid_booking response"
assertion_summary:
  - "the unknown-room create returns status 404 with error room_not_found"
  - "the GET /rooms body still lists no room r9 and the listing of the existing room shows the same number of bookings as before the rejected request"
  - "the same body against an existing room returns 201"
feasibility: "feasible"
```

### room-booking-api:BEH-009

```yaml
id: "room-booking-api:BEH-009"
template: "Behavior"
obligation: "Attendees equal to the room capacity responds 201 and attendees one above capacity responds 422 over_capacity."
input_classes:
  - name: "boundary_equal_to_capacity"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Standup\", \"start\": \"2026-11-02T09:00:00Z\", \"end\": \"2026-11-02T10:00:00Z\", \"attendees\": 5} where room r1 has capacity 5"
    expected: "201 with attendees 5"
  - name: "typical_above_capacity"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Standup\", \"start\": \"2026-11-02T11:00:00Z\", \"end\": \"2026-11-02T12:00:00Z\", \"attendees\": 6} where room r1 has capacity 5"
    expected: "422 over_capacity"
  - name: "invalid_zero_attendees"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Standup\", \"start\": \"2026-11-02T11:00:00Z\", \"end\": \"2026-11-02T12:00:00Z\", \"attendees\": 0}"
    expected: "400 invalid_booking"
  - name: "empty_missing_attendees"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Standup\", \"start\": \"2026-11-02T11:00:00Z\", \"end\": \"2026-11-02T12:00:00Z\"}"
    expected: "400 invalid_booking"
negative_oracle:
  - input_class: "typical_above_capacity"
    must_fail_with: "over_capacity"
    must_not: "a 201 response, a 400 invalid_booking response in place of 422, or a booking appearing in the room listing"
  - input_class: "invalid_zero_attendees"
    must_fail_with: "invalid_booking"
    must_not: "a 422 over_capacity response or a 201 response"
assertion_summary:
  - "attendees equal to capacity returns 201 with the echoed attendee count"
  - "attendees one above capacity returns status 422 with error over_capacity and adds no booking"
  - "attendees 0 and an absent attendees field both return status 400 with error invalid_booking"
feasibility: "feasible"
```

### room-booking-api:BEH-010

```yaml
id: "room-booking-api:BEH-010"
template: "Behavior"
obligation: "An interval overlapping two bookings responds 409 with the earliest-starting conflicting id, and an interval touching a booking boundary responds 201."
input_classes:
  - name: "typical_free_interval"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Standup\", \"start\": \"2026-11-02T09:00:00Z\", \"end\": \"2026-11-02T09:30:00Z\", \"attendees\": 1} on a process where room r1 capacity 10 exists and has no bookings"
    expected: "201"
  - name: "boundary_overlap_two_bookings"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Sync\", \"start\": \"2026-11-02T09:30:00Z\", \"end\": \"2026-11-02T10:30:00Z\", \"attendees\": 1} on a fresh process where room r1 holds booking b1 09:00Z-10:00Z and booking b2 10:15Z-11:15Z"
    expected: "409 with error room_busy and conflictingBookingId b1"
  - name: "boundary_touching_at_end"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Sync\", \"start\": \"2026-11-02T10:00:00Z\", \"end\": \"2026-11-02T10:15:00Z\", \"attendees\": 1} with the same two bookings present"
    expected: "201 because the request touches the end of b1 and the start of b2 without sharing an instant"
  - name: "boundary_containment"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Sync\", \"start\": \"2026-11-02T09:15:00Z\", \"end\": \"2026-11-02T09:45:00Z\", \"attendees\": 1} with the same two bookings present"
    expected: "409 with error room_busy and conflictingBookingId b1"
  - name: "boundary_full_cover"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Sync\", \"start\": \"2026-11-02T08:00:00Z\", \"end\": \"2026-11-02T11:30:00Z\", \"attendees\": 1} with the same two bookings present"
    expected: "409 with error room_busy and conflictingBookingId b1"
  - name: "typical_single_conflict"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Sync\", \"start\": \"2026-11-02T10:30:00Z\", \"end\": \"2026-11-02T11:00:00Z\", \"attendees\": 1} with the same two bookings present"
    expected: "409 with error room_busy and conflictingBookingId b2"
negative_oracle:
  - input_class: "boundary_overlap_two_bookings"
    must_fail_with: "room_busy"
    must_not: "a 201 response, or a conflict body naming b2, or a conflict body without conflictingBookingId"
  - input_class: "boundary_containment"
    must_fail_with: "room_busy"
    must_not: "a 409 response whose body omits conflictingBookingId"
  - input_class: "typical_single_conflict"
    must_fail_with: "room_busy"
    must_not: "a conflict body naming b1"
assertion_summary:
  - "every 409 body carries error room_busy and conflictingBookingId equal to the id of the earliest-starting conflicting booking"
  - "the touching request returns 201 and the new booking appears in the GET /rooms/r1/bookings body"
  - "no booking is added to the room listing by a 409 response"
feasibility: "feasible"
```

### room-booking-api:BEH-011

```yaml
id: "room-booking-api:BEH-011"
template: "Behavior"
obligation: "Bookings with distinct starts come back in ascending start order and equal starts are broken by ascending id."
input_classes:
  - name: "empty_list"
    input: "GET /rooms/r1/bookings on a process where room r1 exists and has no bookings"
    expected: "200 with {\"bookings\": []}"
  - name: "typical_distinct_starts"
    input: "GET /rooms/r1/bookings where b1 was created 09:00Z-10:00Z, b2 was created 08:00Z-09:00Z and b3 was created 10:00Z-11:00Z, all in room r1"
    expected: "200 with bookings [b2, b1, b3]"
  - name: "boundary_equal_starts"
    input: "GET /rooms/r1/bookings where two bookings of room r1 share the start 09:00Z; the second create responds 409 room_busy, so the state is not reachable through the boundary"
    expected: "not producible: the second booking with the same start is rejected with room_busy"
  - name: "boundary_other_room_excluded"
    input: "GET /rooms/r1/bookings where room r2 holds a booking starting 07:00Z and room r1 holds b1 09:00Z-10:00Z"
    expected: "200 with bookings [b1] only"
  - name: "invalid_unknown_room"
    input: "GET /rooms/r9/bookings where no room r9 exists"
    expected: "404 room_not_found"
negative_oracle:
  - input_class: "invalid_unknown_room"
    must_fail_with: "room_not_found"
    must_not: "a 200 response with an empty bookings array"
  - input_class: "boundary_equal_starts"
    must_fail_with: "room_busy"
    must_not: "a second booking with the same start inside one room, so the tie-break cannot be observed"
assertion_summary:
  - "the listing of room r1 lists bookings in ascending start order regardless of creation order"
  - "no booking of another room appears in the listing"
  - "an unknown room returns status 404 with error room_not_found and no bookings array"
feasibility: "infeasible_candidate"
infeasibility_reason: "The equal-start tie-break needs two bookings of one room with an identical start, and creating the second one is rejected with 409 room_busy, so no sequence of boundary requests produces the state the assertion needs."
```

### room-booking-api:BEH-012

```yaml
id: "room-booking-api:BEH-012"
template: "Behavior"
obligation: "A filter interval keeps exactly the bookings whose half-open interval intersects it and reports them in start order."
input_classes:
  - name: "typical_filter_pair"
    input: "GET /rooms/r1/bookings?from=2026-11-02T09:30:00Z&to=2026-11-02T11:00:00Z where room r1 holds b1 09:00Z-10:00Z, b2 10:00Z-11:00Z and b3 13:00Z-14:00Z"
    expected: "200 with bookings [b1, b2]"
  - name: "boundary_ending_exactly_at_from"
    input: "GET /rooms/r1/bookings?from=2026-11-02T10:00:00Z&to=2026-11-02T12:00:00Z with the same three bookings"
    expected: "200 with bookings [b2] because b1 ends exactly at the filter start"
  - name: "boundary_starting_exactly_at_to"
    input: "GET /rooms/r1/bookings?from=2026-11-02T07:00:00Z&to=2026-11-02T09:00:00Z with the same three bookings"
    expected: "200 with {\"bookings\": []} because b1 starts exactly at the filter end"
  - name: "boundary_fully_inside"
    input: "GET /rooms/r1/bookings?from=2026-11-02T13:15:00Z&to=2026-11-02T13:45:00Z with the same three bookings"
    expected: "200 with bookings [b3]"
  - name: "empty_no_filter"
    input: "GET /rooms/r1/bookings without query parameters with the same three bookings"
    expected: "200 with bookings [b1, b2, b3]"
  - name: "invalid_one_sided"
    input: "GET /rooms/r1/bookings?from=2026-11-02T09:00:00Z with the same three bookings"
    expected: "400 invalid_query"
negative_oracle:
  - input_class: "invalid_one_sided"
    must_fail_with: "invalid_query"
    must_not: "a 200 response listing every booking as if the filter were unbounded"
assertion_summary:
  - "the filtered listing contains exactly the bookings whose interval shares at least one instant with the filter interval"
  - "a booking ending at the filter start and a booking starting at the filter end are both excluded"
  - "the kept bookings appear in ascending start order"
feasibility: "feasible"
```

### room-booking-api:BEH-013

```yaml
id: "room-booking-api:BEH-013"
template: "Behavior"
obligation: "One-sided filters, reversed intervals, empty intervals and unparseable times each respond 400 invalid_query while a well-formed pair responds 200."
input_classes:
  - name: "typical_valid_pair"
    input: "GET /rooms/r1/bookings?from=2026-11-02T09:00:00Z&to=2026-11-02T10:00:00Z where room r1 exists"
    expected: "200 with a bookings array"
  - name: "empty_both_absent"
    input: "GET /rooms/r1/bookings with no query string where room r1 exists"
    expected: "200 with a bookings array"
  - name: "invalid_only_from"
    input: "GET /rooms/r1/bookings?from=2026-11-02T09:00:00Z"
    expected: "400 invalid_query"
  - name: "invalid_only_to"
    input: "GET /rooms/r1/bookings?to=2026-11-02T10:00:00Z"
    expected: "400 invalid_query"
  - name: "invalid_to_before_from"
    input: "GET /rooms/r1/bookings?from=2026-11-02T10:00:00Z&to=2026-11-02T09:00:00Z"
    expected: "400 invalid_query"
  - name: "invalid_to_equal_from"
    input: "GET /rooms/r1/bookings?from=2026-11-02T09:00:00Z&to=2026-11-02T09:00:00Z"
    expected: "400 invalid_query"
  - name: "invalid_unparseable_time"
    input: "GET /rooms/r1/bookings?from=not-a-time&to=2026-11-02T10:00:00Z"
    expected: "400 invalid_query"
  - name: "invalid_offset_time"
    input: "GET /rooms/r1/bookings?from=2026-11-02T09:00:00%2B01:00&to=2026-11-02T10:00:00%2B01:00"
    expected: "400 invalid_query"
negative_oracle:
  - input_class: "invalid_only_from"
    must_fail_with: "invalid_query"
    must_not: "a 200 response treating the filter as unbounded above"
  - input_class: "invalid_unparseable_time"
    must_fail_with: "invalid_query"
    must_not: "a 500 response, a dropped connection, or a 200 response"
  - input_class: "invalid_to_equal_from"
    must_fail_with: "invalid_query"
    must_not: "a 200 response with an empty bookings array"
assertion_summary:
  - "each invalid filter returns status 400 with error invalid_query on a JSON body"
  - "the valid pair and the absent pair both return 200"
  - "the process answers the next request after each 400"
feasibility: "feasible"
```

### room-booking-api:BEH-014

```yaml
id: "room-booking-api:BEH-014"
template: "Behavior"
obligation: "Deleting a known booking responds 204 with an empty body and the same interval is bookable afterwards."
input_classes:
  - name: "typical_delete"
    input: "DELETE /bookings/b1 where room r1 holds booking b1 from 09:00Z to 10:00Z"
    expected: "204 with no body"
  - name: "typical_rebook_same_interval"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Standup\", \"start\": \"2026-11-02T09:00:00Z\", \"end\": \"2026-11-02T10:00:00Z\", \"attendees\": 1} directly after the delete"
    expected: "201 with id b2"
  - name: "boundary_repeated_delete"
    input: "DELETE /bookings/b1 a second time"
    expected: "404 booking_not_found"
  - name: "boundary_booking_of_another_room"
    input: "DELETE /bookings/b2 where b2 belongs to room r2"
    expected: "204 with no body, and the GET /rooms/r2/bookings body no longer lists b2"
  - name: "empty_store"
    input: "DELETE /bookings/b1 on a freshly started process with no bookings"
    expected: "404 booking_not_found"
negative_oracle:
  - input_class: "boundary_repeated_delete"
    must_fail_with: "booking_not_found"
    must_not: "a 204 response or a second successful delete"
  - input_class: "empty_store"
    must_fail_with: "booking_not_found"
    must_not: "a 204 response or a 500 response"
assertion_summary:
  - "the successful delete returns status 204 with a zero-length body"
  - "after the delete GET /rooms/r1/bookings returns 200 with an empty bookings array"
  - "a create on the freed interval returns 201 rather than 409"
feasibility: "feasible"
```

### room-booking-api:BEH-015

```yaml
id: "room-booking-api:BEH-015"
template: "Behavior"
obligation: "An unknown booking id responds 404 booking_not_found and the booking store is unchanged."
input_classes:
  - name: "typical_unknown_id"
    input: "DELETE /bookings/b7 where room r1 holds booking b1 and no booking b7 exists"
    expected: "404 booking_not_found"
  - name: "boundary_existing_id"
    input: "DELETE /bookings/b1 with the same state"
    expected: "204 with no body"
  - name: "empty_store"
    input: "DELETE /bookings/b7 on a freshly started process with no rooms and no bookings"
    expected: "404 booking_not_found"
negative_oracle:
  - input_class: "typical_unknown_id"
    must_fail_with: "booking_not_found"
    must_not: "a 204 response or a 500 response"
  - input_class: "empty_store"
    must_fail_with: "booking_not_found"
    must_not: "a 204 response"
assertion_summary:
  - "the unknown-id delete returns status 404 with error booking_not_found"
  - "GET /rooms/r1/bookings after the rejected delete still lists exactly the bookings it listed before"
  - "deleting the existing booking returns 204"
feasibility: "feasible"
```

### room-booking-api:BEH-016

```yaml
id: "room-booking-api:BEH-016"
template: "Behavior"
obligation: "Availability keeps exactly the rooms with capacity at least attendees and no overlapping booking, ordered by capacity ascending then id, and responds 400 invalid_query when a required parameter is missing."
input_classes:
  - name: "typical_busy_and_small_excluded"
    input: "GET /availability?start=2026-11-02T09:30:00Z&end=2026-11-02T10:30:00Z&attendees=5 where r1 has capacity 4, r2 capacity 12 and r3 capacity 8 with a booking on r3 from 09:00Z to 10:00Z"
    expected: "200 with rooms [r2]"
  - name: "boundary_capacity_equal_to_attendees"
    input: "GET /availability?start=2026-11-02T10:00:00Z&end=2026-11-02T11:00:00Z&attendees=8 with the same rooms and booking"
    expected: "200 with rooms [r3, r2]"
  - name: "boundary_touching_interval"
    input: "GET /availability?start=2026-11-02T10:00:00Z&end=2026-11-02T11:00:00Z&attendees=5 with the same rooms and booking"
    expected: "200 with rooms [r3, r2] because the booking on r3 ends exactly at the requested start"
  - name: "boundary_no_room_large_enough"
    input: "GET /availability?start=2026-11-02T09:30:00Z&end=2026-11-02T10:30:00Z&attendees=13 with the same rooms"
    expected: "200 with {\"rooms\": []}"
  - name: "empty_store"
    input: "GET /availability?start=2026-11-02T09:30:00Z&end=2026-11-02T10:30:00Z&attendees=1 on a freshly started process with no rooms"
    expected: "200 with {\"rooms\": []}"
  - name: "boundary_ordering_by_capacity"
    input: "GET /availability?start=2026-11-02T08:00:00Z&end=2026-11-02T09:00:00Z&attendees=4 with the same three rooms and the r3 booking"
    expected: "200 with rooms [r1, r3, r2]"
  - name: "invalid_missing_attendees"
    input: "GET /availability?start=2026-11-02T09:30:00Z&end=2026-11-02T10:30:00Z with attendees omitted"
    expected: "400 invalid_query"
negative_oracle:
  - input_class: "invalid_missing_attendees"
    must_fail_with: "invalid_query"
    must_not: "a 200 response that defaults the attendee count and lists rooms"
assertion_summary:
  - "the response lists exactly the rooms whose capacity is at least attendees and whose bookings do not overlap the requested interval"
  - "the rooms array is ordered by capacity ascending, breaking ties by id, so r3 with capacity 8 precedes r2 with capacity 12"
  - "the busy room r3 is absent from the first response and present in the two touching-interval responses"
  - "an empty result is 200 with an empty rooms array"
feasibility: "feasible"
```

### room-booking-api:BEH-017

```yaml
id: "room-booking-api:BEH-017"
template: "Behavior"
obligation: "Each incomplete or invalid availability query responds 400 invalid_query and a complete valid query responds 200."
input_classes:
  - name: "typical_valid_query"
    input: "GET /availability?start=2026-11-02T09:00:00Z&end=2026-11-02T10:00:00Z&attendees=1"
    expected: "200 with a rooms array"
  - name: "empty_no_parameters"
    input: "GET /availability with no query string"
    expected: "400 invalid_query"
  - name: "invalid_missing_start"
    input: "GET /availability?end=2026-11-02T10:00:00Z&attendees=1"
    expected: "400 invalid_query"
  - name: "invalid_missing_end"
    input: "GET /availability?start=2026-11-02T09:00:00Z&attendees=1"
    expected: "400 invalid_query"
  - name: "invalid_missing_attendees"
    input: "GET /availability?start=2026-11-02T09:00:00Z&end=2026-11-02T10:00:00Z"
    expected: "400 invalid_query"
  - name: "invalid_attendees_zero"
    input: "GET /availability?start=2026-11-02T09:00:00Z&end=2026-11-02T10:00:00Z&attendees=0"
    expected: "400 invalid_query"
  - name: "invalid_reversed_interval"
    input: "GET /availability?start=2026-11-02T10:00:00Z&end=2026-11-02T09:00:00Z&attendees=1"
    expected: "400 invalid_query"
  - name: "invalid_unparseable_time"
    input: "GET /availability?start=not-a-time&end=2026-11-02T10:00:00Z&attendees=1"
    expected: "400 invalid_query"
negative_oracle:
  - input_class: "empty_no_parameters"
    must_fail_with: "invalid_query"
    must_not: "a 200 response with rooms listed under a silent default"
  - input_class: "invalid_attendees_zero"
    must_fail_with: "invalid_query"
    must_not: "a 200 response listing every free room"
  - input_class: "invalid_unparseable_time"
    must_fail_with: "invalid_query"
    must_not: "a 500 response, a dropped connection, or a 200 response"
assertion_summary:
  - "every incomplete or invalid query returns status 400 with error invalid_query on a JSON body"
  - "the complete valid query returns 200"
  - "the process answers the next request after each 400"
feasibility: "feasible"
```

### room-booking-api:BEH-018

```yaml
id: "room-booking-api:BEH-018"
template: "Behavior"
obligation: "A syntactically invalid JSON body responds 400 invalid_json on every endpoint that accepts a body and no state changes."
input_classes:
  - name: "typical_valid_body"
    input: "POST /rooms with body {\"name\": \"Aurora\", \"capacity\": 2}"
    expected: "201 with id r1"
  - name: "boundary_truncated_json"
    input: "POST /rooms with body {\"name\": \"Aurora\", \"capacity\":"
    expected: "400 invalid_json"
  - name: "empty_body"
    input: "POST /rooms with an empty request body"
    expected: "400 invalid_json"
  - name: "boundary_json_array"
    input: "POST /rooms with body [{\"name\": \"Aurora\", \"capacity\": 2}]"
    expected: "400 invalid_json"
  - name: "invalid_booking_endpoint_truncated"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Standup\", where room r1 exists"
    expected: "400 invalid_json"
negative_oracle:
  - input_class: "boundary_truncated_json"
    must_fail_with: "invalid_json"
    must_not: "a 500 response, a dropped connection, a 400 invalid_room response, or any room added to GET /rooms"
  - input_class: "empty_body"
    must_fail_with: "invalid_json"
    must_not: "a 500 response or a 201 response"
  - input_class: "boundary_json_array"
    must_fail_with: "invalid_json"
    must_not: "a 400 invalid_room response or a 201 response"
  - input_class: "invalid_booking_endpoint_truncated"
    must_fail_with: "invalid_json"
    must_not: "a 400 invalid_booking response or a booking added to the room listing"
assertion_summary:
  - "each malformed body returns status 400 with Content-Type application/json and error invalid_json"
  - "the GET /rooms and GET /rooms/r1/bookings bodies are unchanged after each rejection"
  - "the server answers the following valid request normally"
feasibility: "feasible"
```

### room-booking-api:BEH-019

```yaml
id: "room-booking-api:BEH-019"
template: "Behavior"
obligation: "An unknown path responds 404 not_found and a known path with a wrong method responds 405 method_not_allowed."
input_classes:
  - name: "typical_unknown_path"
    input: "GET /unknown on a running server"
    expected: "404 not_found"
  - name: "boundary_known_path_wrong_method"
    input: "PUT /rooms on a running server"
    expected: "405 method_not_allowed"
  - name: "boundary_known_path_right_method"
    input: "GET /rooms on a running server"
    expected: "200 with a rooms array"
  - name: "invalid_wrong_method_on_booking_route"
    input: "PUT /bookings/b1 on a running server"
    expected: "405 method_not_allowed"
negative_oracle:
  - input_class: "typical_unknown_path"
    must_fail_with: "not_found"
    must_not: "a 500 response, a dropped connection, or a 405 response"
  - input_class: "boundary_known_path_wrong_method"
    must_fail_with: "method_not_allowed"
    must_not: "a 404 not_found response or a 400 response"
  - input_class: "invalid_wrong_method_on_booking_route"
    must_fail_with: "method_not_allowed"
    must_not: "a 404 response"
assertion_summary:
  - "the unknown path returns status 404 with error not_found on a JSON body"
  - "the wrong method on a known path returns status 405 with error method_not_allowed"
  - "the correct method on the same path still returns 200"
feasibility: "feasible"
```

### room-booking-api:BEH-020

```yaml
id: "room-booking-api:BEH-020"
template: "Behavior"
obligation: "An unknown room id responds 404 room_not_found and an existing room with no bookings responds 200 with an empty array."
input_classes:
  - name: "typical_unknown_room"
    input: "GET /rooms/r9/bookings on a process where only room r1 exists"
    expected: "404 room_not_found"
  - name: "boundary_existing_room_without_bookings"
    input: "GET /rooms/r1/bookings where room r1 exists and has no bookings"
    expected: "200 with {\"bookings\": []}"
  - name: "boundary_existing_room_with_bookings"
    input: "GET /rooms/r1/bookings where room r1 holds b1 09:00Z-10:00Z"
    expected: "200 with bookings [b1]"
  - name: "empty_store"
    input: "GET /rooms/r1/bookings on a freshly started process with no rooms"
    expected: "404 room_not_found"
negative_oracle:
  - input_class: "typical_unknown_room"
    must_fail_with: "room_not_found"
    must_not: "a 200 response with an empty bookings array, or a 500 response"
  - input_class: "empty_store"
    must_fail_with: "room_not_found"
    must_not: "a 200 response with an empty bookings array"
assertion_summary:
  - "the unknown room returns status 404 with error room_not_found"
  - "the existing room without bookings returns 200 with a bookings key holding an empty array"
  - "the existing room with one booking returns 200 with that booking listed"
feasibility: "feasible"
```

### room-booking-api:BEH-021

```yaml
id: "room-booking-api:BEH-021"
template: "Behavior"
obligation: "A server started with PORT set responds on that port and a server started without PORT responds on 3000."
input_classes:
  - name: "typical_explicit_port"
    input: "start the server with PORT=4123 and send GET /rooms to port 4123"
    expected: "200 with a rooms array from port 4123"
  - name: "empty_port_unset"
    input: "start the server with PORT unset and send GET /rooms to port 3000"
    expected: "200 with a rooms array from port 3000"
  - name: "boundary_ephemeral_port"
    input: "start the server with PORT=0, read the operating-system-assigned port the process reports on its standard output, and send GET /rooms to that port"
    expected: "200 with a rooms array from the assigned ephemeral port"
negative_oracle: []
assertion_summary:
  - "with PORT=4123 the process answers on port 4123 and no request to port 3000 is served"
  - "with PORT unset the process answers on port 3000"
  - "with PORT=0 the process answers on the ephemeral port it reports and the reported port is not 3000"
feasibility: "feasible"
```

### room-booking-api:SCN-001

```yaml
id: "room-booking-api:SCN-001"
template: "Scenario"
obligation: "The sequence yields statuses 201, 201, 409, 204, 200 and 201 in order."
input_classes:
  - name: "typical_full_sequence"
    input: "on a freshly started process: POST /rooms {\"name\": \"Aurora\", \"capacity\": 6}, POST /rooms/r1/bookings {\"title\": \"Standup\", \"start\": \"2026-11-02T09:00:00Z\", \"end\": \"2026-11-02T10:00:00Z\", \"attendees\": 4}, the same create again, DELETE /bookings/b1, GET /rooms/r1/bookings, POST /rooms/r1/bookings with the same interval"
    expected: "201, 201, 409, 204, 200, 201 in that order"
  - name: "boundary_one_existing_booking"
    input: "the second create of the same interval while b1 exists"
    expected: "409 with error room_busy and conflictingBookingId b1"
  - name: "boundary_after_deletion"
    input: "the final create of the same interval after DELETE /bookings/b1 returned 204"
    expected: "201 with id b2"
  - name: "invalid_retry_before_delete"
    input: "the create of the same interval issued twice more before any delete, on a fresh process after the first 201"
    expected: "409 with error room_busy on every retry"
negative_oracle:
  - input_class: "boundary_one_existing_booking"
    must_fail_with: "room_busy"
    must_not: "a 201 response, a conflict body without conflictingBookingId, or a conflict body naming any booking other than b1"
  - input_class: "invalid_retry_before_delete"
    must_fail_with: "room_busy"
    must_not: "a 201 response for the repeated interval while b1 still exists"
assertion_summary:
  - "the six responses carry statuses 201, 201, 409, 204, 200, 201 in the stated order"
  - "the first create returns id b1 and the final create returns id b2, so the deleted id is not reused"
  - "the listing between delete and rebook is 200 with an empty bookings array"
  - "the 204 response carries no body"
observable_sequence:
  - "POST /rooms with a valid room body → 201 with id r1"
  - "POST /rooms/r1/bookings with the interval 09:00Z-10:00Z → 201 with id b1"
  - "POST /rooms/r1/bookings with the same interval → 409 with error room_busy and conflictingBookingId b1"
  - "DELETE /bookings/b1 → 204 with no body"
  - "GET /rooms/r1/bookings → 200 with an empty bookings array"
  - "POST /rooms/r1/bookings with the interval 09:00Z-10:00Z → 201 with id b2"
feasibility: "feasible"
```

### room-booking-api:SCN-002

```yaml
id: "room-booking-api:SCN-002"
template: "Scenario"
obligation: "Availability before the booking lists r3 then r2 and after the booking lists r3 only."
input_classes:
  - name: "typical_no_bookings"
    input: "GET /availability?start=2026-11-02T09:00:00Z&end=2026-11-02T10:00:00Z&attendees=5 where r1 has capacity 4, r2 capacity 12 and r3 capacity 8 with no bookings"
    expected: "200 with rooms [r3, r2]"
  - name: "boundary_one_busy_room"
    input: "the same query after POST /rooms/r2/bookings with {\"title\": \"Standup\", \"start\": \"2026-11-02T09:00:00Z\", \"end\": \"2026-11-02T10:00:00Z\", \"attendees\": 2} returned 201"
    expected: "200 with rooms [r3]"
  - name: "boundary_all_rooms_busy"
    input: "the same query after room r3 also holds a booking 09:00Z-10:00Z"
    expected: "200 with {\"rooms\": []}"
negative_oracle: []
assertion_summary:
  - "the booking of r2 returns 201 with id b1"
  - "the first availability response lists r3 before r2, ordered by capacity ascending"
  - "the second availability response lists r3 only, with r2 absent"
  - "the third availability response is 200 with an empty rooms array"
observable_sequence:
  - "GET /availability with attendees 5 → 200 with rooms [r3, r2]"
  - "POST /rooms/r2/bookings for 09:00Z-10:00Z → 201 with id b1"
  - "GET /availability with attendees 5 → 200 with rooms [r3]"
feasibility: "feasible"
```

### room-booking-api:NFR-001

```yaml
id: "room-booking-api:NFR-001"
template: "NFR"
obligation: "npm run build exits 0 and npm test exits 0."
input_classes:
  - name: "typical_clean_checkout"
    input: "run npm run build and then npm test from a clean checkout"
    expected: "both commands exit 0"
  - name: "boundary_after_source_change"
    input: "run npm run build and then npm test after a source change in the checkout"
    expected: "both commands exit 0"
negative_oracle: []
assertion_summary:
  - "the exit code of npm run build is 0"
  - "the exit code of npm test is 0 and its standard output reports no failing test"
feasibility: "infeasible_candidate"
infeasibility_reason: "The predicate is the exit status of the build command and of the whole suite; a test inside that suite cannot assert the exit status of the run it is part of, and the record names a CI job log as the artefact, which is not a boundary observable."
```

### room-booking-api:CTR-001

```yaml
id: "room-booking-api:CTR-001"
template: "Contract"
obligation: "A valid body responds 201 with a server-assigned r-prefixed id and each invalid body responds with its documented status and code."
input_classes:
  - name: "typical_valid_body"
    input: "POST /rooms with body {\"name\": \"Aurora\", \"capacity\": 6}"
    expected: "201 with Content-Type application/json and body {\"id\": \"r1\", \"name\": \"Aurora\", \"capacity\": 6}"
  - name: "boundary_capacity_1"
    input: "POST /rooms with body {\"name\": \"Borealis\", \"capacity\": 1}"
    expected: "201 with capacity 1"
  - name: "boundary_capacity_100"
    input: "POST /rooms with body {\"name\": \"Cirrus\", \"capacity\": 100}"
    expected: "201 with capacity 100"
  - name: "boundary_name_of_40_characters"
    input: "POST /rooms with body {\"name\": \"0123456789012345678901234567890123456789\", \"capacity\": 2} (40 characters)"
    expected: "201 with the same name"
  - name: "invalid_name_of_41_characters"
    input: "POST /rooms with body {\"name\": \"01234567890123456789012345678901234567890\", \"capacity\": 2} (41 characters)"
    expected: "400 invalid_room"
  - name: "invalid_capacity_0"
    input: "POST /rooms with body {\"name\": \"Dorado\", \"capacity\": 0}"
    expected: "400 invalid_room"
  - name: "invalid_capacity_101"
    input: "POST /rooms with body {\"name\": \"Dorado\", \"capacity\": 101}"
    expected: "400 invalid_room"
  - name: "invalid_capacity_fractional"
    input: "POST /rooms with body {\"name\": \"Dorado\", \"capacity\": 1.5}"
    expected: "400 invalid_room"
  - name: "invalid_empty_name"
    input: "POST /rooms with body {\"name\": \"\", \"capacity\": 2}"
    expected: "400 invalid_room"
  - name: "invalid_duplicate_name_in_other_case"
    input: "POST /rooms with body {\"name\": \"aurora\", \"capacity\": 2} while a room named Aurora exists"
    expected: "409 room_name_taken"
  - name: "invalid_json_body"
    input: "POST /rooms with body {\"name\": \"Aurora\""
    expected: "400 invalid_json"
  - name: "boundary_client_supplied_id"
    input: "POST /rooms with body {\"id\": \"r99\", \"name\": \"Eurus\", \"capacity\": 4} while one room r1 exists"
    expected: "201 with id r2 and no id r99 in the body"
  - name: "invalid_wrong_method"
    input: "PUT /rooms with a valid room body"
    expected: "405 method_not_allowed"
negative_oracle:
  - input_class: "invalid_name_of_41_characters"
    must_fail_with: "invalid_room"
    must_not: "a 201 response or a room in the GET /rooms body carrying a 41-character name"
  - input_class: "invalid_capacity_101"
    must_fail_with: "invalid_room"
    must_not: "a 201 response or a room with capacity above 100 in the listing"
  - input_class: "invalid_duplicate_name_in_other_case"
    must_fail_with: "room_name_taken"
    must_not: "a 201 response or a 400 invalid_room response"
  - input_class: "invalid_json_body"
    must_fail_with: "invalid_json"
    must_not: "a 400 invalid_room response or a room created"
  - input_class: "invalid_wrong_method"
    must_fail_with: "method_not_allowed"
    must_not: "a 404 not_found response or a room created"
assertion_summary:
  - "every accepted create returns status 201 and a body holding id, name and capacity"
  - "the assigned id has the form r followed by a decimal counter value and matches the creation order, never a value supplied by the client"
  - "each rejected create returns the documented status and a JSON body with the documented error field"
  - "the room count in the GET /rooms body is unchanged by every rejection"
feasibility: "feasible"
```

### room-booking-api:CTR-002

```yaml
id: "room-booking-api:CTR-002"
template: "Contract"
obligation: "Room responses carry a rooms array ordered by id and minCapacity filters rooms with capacity at least the value."
input_classes:
  - name: "empty_store"
    input: "GET /rooms on a freshly started process"
    expected: "200 with {\"rooms\": []} and Content-Type application/json"
  - name: "typical_absent_mincapacity"
    input: "GET /rooms with r1 capacity 4, r2 capacity 12 and r3 capacity 8 present"
    expected: "200 with rooms [r1, r2, r3]"
  - name: "boundary_mincapacity_1"
    input: "GET /rooms?minCapacity=1 with the same three rooms"
    expected: "200 with rooms [r1, r2, r3]"
  - name: "boundary_mincapacity_matching_capacity"
    input: "GET /rooms?minCapacity=12 with the same three rooms"
    expected: "200 with rooms [r2]"
  - name: "invalid_mincapacity_zero"
    input: "GET /rooms?minCapacity=0 with the same three rooms"
    expected: "400 invalid_query"
  - name: "invalid_mincapacity_non_numeric"
    input: "GET /rooms?minCapacity=abc with the same three rooms"
    expected: "400 invalid_query"
  - name: "invalid_wrong_method"
    input: "DELETE /rooms"
    expected: "405 method_not_allowed"
negative_oracle:
  - input_class: "invalid_mincapacity_zero"
    must_fail_with: "invalid_query"
    must_not: "a 200 response ignoring the parameter"
  - input_class: "invalid_mincapacity_non_numeric"
    must_fail_with: "invalid_query"
    must_not: "a 500 response or a 200 response"
  - input_class: "invalid_wrong_method"
    must_fail_with: "method_not_allowed"
    must_not: "a 404 not_found response or a 200 response"
assertion_summary:
  - "the response body always has a rooms array, empty when no room matches"
  - "the array is ordered by id in ascending counter order"
  - "minCapacity keeps exactly the rooms whose capacity is at least the value, including equality"
feasibility: "feasible"
```

### room-booking-api:CTR-003

```yaml
id: "room-booking-api:CTR-003"
template: "Contract"
obligation: "A valid body responds 201 with a b-prefixed id and each invalid class responds with its documented status and code."
input_classes:
  - name: "typical_valid_booking"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Standup\", \"start\": \"2026-11-02T09:00:00Z\", \"end\": \"2026-11-02T10:00:00Z\", \"attendees\": 4} where room r1 has capacity 10 and no bookings"
    expected: "201 with body {\"id\": \"b1\", \"roomId\": \"r1\", \"title\": \"Standup\", \"start\": \"2026-11-02T09:00:00Z\", \"end\": \"2026-11-02T10:00:00Z\", \"attendees\": 4}"
  - name: "boundary_eight_hour_interval"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Workshop\", \"start\": \"2026-11-02T09:00:00Z\", \"end\": \"2026-11-02T17:00:00Z\", \"attendees\": 2} where room r1 is free"
    expected: "201"
  - name: "invalid_eight_hours_plus_one_minute"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Workshop\", \"start\": \"2026-11-02T09:00:00Z\", \"end\": \"2026-11-02T17:01:00Z\", \"attendees\": 2}"
    expected: "400 invalid_booking"
  - name: "invalid_reversed_interval"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Workshop\", \"start\": \"2026-11-02T10:00:00Z\", \"end\": \"2026-11-02T09:00:00Z\", \"attendees\": 2}"
    expected: "400 invalid_booking"
  - name: "boundary_attendees_equal_capacity"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Workshop\", \"start\": \"2026-11-02T11:00:00Z\", \"end\": \"2026-11-02T12:00:00Z\", \"attendees\": 10} where room r1 has capacity 10"
    expected: "201 with attendees 10"
  - name: "invalid_attendees_above_capacity"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Workshop\", \"start\": \"2026-11-02T11:00:00Z\", \"end\": \"2026-11-02T12:00:00Z\", \"attendees\": 11} where room r1 has capacity 10"
    expected: "422 over_capacity"
  - name: "boundary_touching_interval"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Review\", \"start\": \"2026-11-02T10:00:00Z\", \"end\": \"2026-11-02T11:00:00Z\", \"attendees\": 2} where booking b1 occupies 09:00Z-10:00Z in room r1"
    expected: "201"
  - name: "invalid_overlap"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Review\", \"start\": \"2026-11-02T09:30:00Z\", \"end\": \"2026-11-02T10:30:00Z\", \"attendees\": 2} where booking b1 occupies 09:00Z-10:00Z in room r1"
    expected: "409 room_busy with conflictingBookingId b1"
  - name: "invalid_unknown_room"
    input: "POST /rooms/r9/bookings with a valid booking body where no room r9 exists"
    expected: "404 room_not_found"
  - name: "invalid_json_body"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Standup\","
    expected: "400 invalid_json"
  - name: "invalid_wrong_method"
    input: "PUT /rooms/r1/bookings with a valid booking body"
    expected: "405 method_not_allowed"
negative_oracle:
  - input_class: "invalid_eight_hours_plus_one_minute"
    must_fail_with: "invalid_booking"
    must_not: "a 201 response or a booking appended to the room listing"
  - input_class: "invalid_attendees_above_capacity"
    must_fail_with: "over_capacity"
    must_not: "a 400 invalid_booking response or a booking created"
  - input_class: "invalid_overlap"
    must_fail_with: "room_busy"
    must_not: "a 201 response or a conflict body without conflictingBookingId"
  - input_class: "invalid_unknown_room"
    must_fail_with: "room_not_found"
    must_not: "a 400 invalid_booking response or a booking created"
  - input_class: "invalid_json_body"
    must_fail_with: "invalid_json"
    must_not: "a 400 invalid_booking response or a booking created"
  - input_class: "invalid_wrong_method"
    must_fail_with: "method_not_allowed"
    must_not: "a 404 not_found response"
assertion_summary:
  - "the accepted create returns status 201 and a body holding id, roomId, title, start, end and attendees"
  - "the assigned id has the form b followed by a decimal counter value"
  - "each rejected create returns the documented status and error code and leaves the room listing unchanged"
feasibility: "feasible"
```

### room-booking-api:CTR-004

```yaml
id: "room-booking-api:CTR-004"
template: "Contract"
obligation: "Bookings of the room come back in start-then-id order and the from and to pair keeps exactly the overlapping bookings."
input_classes:
  - name: "empty_no_bookings"
    input: "GET /rooms/r1/bookings where room r1 exists and has no bookings"
    expected: "200 with {\"bookings\": []}"
  - name: "typical_no_filter"
    input: "GET /rooms/r1/bookings where b1 occupies 09:00Z-10:00Z, b2 10:00Z-11:00Z and b3 13:00Z-14:00Z"
    expected: "200 with bookings [b1, b2, b3]"
  - name: "boundary_touching_booking_excluded"
    input: "GET /rooms/r1/bookings?from=2026-11-02T10:00:00Z&to=2026-11-02T11:00:00Z with the same three bookings"
    expected: "200 with bookings [b2]"
  - name: "boundary_booking_inside_filter"
    input: "GET /rooms/r1/bookings?from=2026-11-02T08:00:00Z&to=2026-11-02T12:00:00Z with the same three bookings"
    expected: "200 with bookings [b1, b2]"
  - name: "invalid_one_sided_filter"
    input: "GET /rooms/r1/bookings?to=2026-11-02T12:00:00Z with the same three bookings"
    expected: "400 invalid_query"
  - name: "invalid_unknown_room"
    input: "GET /rooms/r9/bookings where no room r9 exists"
    expected: "404 room_not_found"
  - name: "invalid_wrong_method"
    input: "PATCH /rooms/r1/bookings"
    expected: "405 method_not_allowed"
negative_oracle:
  - input_class: "invalid_one_sided_filter"
    must_fail_with: "invalid_query"
    must_not: "a 200 response treating the missing parameter as unbounded"
  - input_class: "invalid_unknown_room"
    must_fail_with: "room_not_found"
    must_not: "a 404 for an existing room or a 200 response with an empty array"
  - input_class: "invalid_wrong_method"
    must_fail_with: "method_not_allowed"
    must_not: "a 404 not_found response"
assertion_summary:
  - "the bookings array holds the bookings of the addressed room only"
  - "the array is ordered by start ascending and, for equal starts, by id ascending"
  - "a from and to pair keeps exactly the bookings whose half-open interval intersects the filter interval"
feasibility: "feasible"
```

### room-booking-api:CTR-005

```yaml
id: "room-booking-api:CTR-005"
template: "Contract"
obligation: "Deleting a known booking responds 204 without a body and deleting an unknown id responds 404 booking_not_found."
input_classes:
  - name: "typical_known_booking"
    input: "DELETE /bookings/b1 where b1 exists"
    expected: "204 with no body"
  - name: "boundary_unknown_booking"
    input: "DELETE /bookings/b7 where no booking b7 exists"
    expected: "404 booking_not_found"
  - name: "boundary_repeated_delete"
    input: "DELETE /bookings/b1 immediately after the typical delete"
    expected: "404 booking_not_found"
  - name: "invalid_wrong_method"
    input: "GET /bookings/b1"
    expected: "405 method_not_allowed"
negative_oracle:
  - input_class: "boundary_unknown_booking"
    must_fail_with: "booking_not_found"
    must_not: "a 200 response, a 204 response, or a 500 response"
  - input_class: "boundary_repeated_delete"
    must_fail_with: "booking_not_found"
    must_not: "a second 204 response"
  - input_class: "invalid_wrong_method"
    must_fail_with: "method_not_allowed"
    must_not: "a 404 not_found response"
assertion_summary:
  - "the successful delete returns status 204 with a zero-length body"
  - "the unknown and repeated deletes return status 404 with error booking_not_found on a JSON body"
  - "the booking stays absent from its room listing after the successful delete"
feasibility: "feasible"
```

### room-booking-api:CTR-006

```yaml
id: "room-booking-api:CTR-006"
template: "Contract"
obligation: "Availability returns exactly the rooms large enough and free for the interval, ordered by capacity then id."
input_classes:
  - name: "typical_availability"
    input: "GET /availability?start=2026-11-02T09:30:00Z&end=2026-11-02T10:30:00Z&attendees=5 where r1 has capacity 4, r2 capacity 12 and r3 capacity 8 with a booking on r3 09:00Z-10:00Z"
    expected: "200 with rooms [r2]"
  - name: "boundary_capacity_equal_to_attendees"
    input: "GET /availability?start=2026-11-02T10:00:00Z&end=2026-11-02T11:00:00Z&attendees=8 with the same rooms and booking"
    expected: "200 with rooms [r3, r2]"
  - name: "boundary_busy_room"
    input: "GET /availability?start=2026-11-02T09:00:00Z&end=2026-11-02T09:30:00Z&attendees=8 with the same rooms and the booking 09:00Z-10:00Z on r3"
    expected: "200 with rooms [r2] because r3 is busy for the requested interval and r2 has capacity 12"
  - name: "boundary_touching_interval"
    input: "GET /availability?start=2026-11-02T10:00:00Z&end=2026-11-02T10:30:00Z&attendees=8 with the same rooms and booking"
    expected: "200 with rooms [r3, r2]"
  - name: "invalid_missing_parameter"
    input: "GET /availability?start=2026-11-02T09:30:00Z&end=2026-11-02T10:30:00Z"
    expected: "400 invalid_query"
  - name: "invalid_wrong_method"
    input: "POST /availability with a valid-looking query in the body"
    expected: "405 method_not_allowed"
negative_oracle:
  - input_class: "invalid_missing_parameter"
    must_fail_with: "invalid_query"
    must_not: "a 200 response that lists rooms under a default attendee count"
  - input_class: "invalid_wrong_method"
    must_fail_with: "method_not_allowed"
    must_not: "a 404 not_found response or a 200 response"
assertion_summary:
  - "every listed room has capacity at least the attendee count and no booking overlapping the requested interval"
  - "a room whose booking ends exactly at the requested start is listed"
  - "the array is ordered by capacity ascending then id ascending"
  - "the response is 200 with Content-Type application/json"
feasibility: "feasible"
```

### room-booking-api:CTR-007

```yaml
id: "room-booking-api:CTR-007"
template: "Contract"
obligation: "Every failure response is JSON with one of the catalogue codes in its error field, every non-204 response carries Content-Type application/json, and a server started with PORT set or unset listens on the selected port."
input_classes:
  - name: "typical_unknown_route"
    input: "GET /unknown"
    expected: "404 with error not_found"
  - name: "boundary_wrong_method"
    input: "PUT /rooms"
    expected: "405 with error method_not_allowed"
  - name: "invalid_malformed_body"
    input: "POST /rooms with body {\"name\":"
    expected: "400 with error invalid_json"
  - name: "invalid_query"
    input: "GET /rooms?minCapacity=0"
    expected: "400 with error invalid_query"
  - name: "invalid_room"
    input: "POST /rooms with body {\"name\": \"\", \"capacity\": 3}"
    expected: "400 with error invalid_room"
  - name: "invalid_booking"
    input: "POST /rooms/r1/bookings with body {\"title\": \"\", \"start\": \"2026-11-02T09:00:00Z\", \"end\": \"2026-11-02T10:00:00Z\", \"attendees\": 1} where room r1 exists"
    expected: "400 with error invalid_booking"
  - name: "boundary_unknown_room"
    input: "GET /rooms/r9/bookings where no room r9 exists"
    expected: "404 with error room_not_found"
  - name: "boundary_unknown_booking"
    input: "DELETE /bookings/b7 where no booking b7 exists"
    expected: "404 with error booking_not_found"
  - name: "boundary_duplicate_room_name"
    input: "POST /rooms with body {\"name\": \"aurora\", \"capacity\": 2} while a room named Aurora exists"
    expected: "409 with error room_name_taken"
  - name: "boundary_overlapping_booking"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Sync\", \"start\": \"2026-11-02T09:30:00Z\", \"end\": \"2026-11-02T10:30:00Z\", \"attendees\": 1} where booking b1 occupies 09:00Z-10:00Z in room r1"
    expected: "409 with error room_busy and conflictingBookingId b1"
  - name: "boundary_over_capacity"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Sync\", \"start\": \"2026-11-02T11:00:00Z\", \"end\": \"2026-11-02T12:00:00Z\", \"attendees\": 99} where room r1 has capacity 10"
    expected: "422 with error over_capacity"
  - name: "boundary_no_content_204"
    input: "DELETE /bookings/b1 where b1 exists"
    expected: "204 with a zero-length body"
  - name: "boundary_port_set"
    input: "start the server with PORT=4123 and send GET /rooms to port 4123"
    expected: "200 with a rooms array"
  - name: "empty_port_unset"
    input: "start the server with PORT unset and send GET /rooms to port 3000"
    expected: "200 with a rooms array"
negative_oracle:
  - input_class: "typical_unknown_route"
    must_fail_with: "not_found"
    must_not: "a prose-only error value or a body without an error field"
  - input_class: "boundary_wrong_method"
    must_fail_with: "method_not_allowed"
    must_not: "a 404 response or a body without an error field"
  - input_class: "invalid_malformed_body"
    must_fail_with: "invalid_json"
    must_not: "a 5xx response or a dropped connection"
  - input_class: "invalid_query"
    must_fail_with: "invalid_query"
    must_not: "a 200 response or a body without an error field"
  - input_class: "invalid_room"
    must_fail_with: "invalid_room"
    must_not: "an error value outside the catalogue"
  - input_class: "invalid_booking"
    must_fail_with: "invalid_booking"
    must_not: "an error value outside the catalogue"
  - input_class: "boundary_unknown_room"
    must_fail_with: "room_not_found"
    must_not: "a code outside the catalogue, such as a generic not_found for an unknown room identifier"
  - input_class: "boundary_unknown_booking"
    must_fail_with: "booking_not_found"
    must_not: "a code outside the catalogue"
  - input_class: "boundary_duplicate_room_name"
    must_fail_with: "room_name_taken"
    must_not: "a 400 invalid_room response"
  - input_class: "boundary_overlapping_booking"
    must_fail_with: "room_busy"
    must_not: "a 409 body without conflictingBookingId"
  - input_class: "boundary_over_capacity"
    must_fail_with: "over_capacity"
    must_not: "a 400 invalid_booking response or a 201 response"
assertion_summary:
  - "every failure response is JSON, carries Content-Type application/json, and holds exactly one catalogue code in the error field"
  - "the 409 room_busy body additionally carries conflictingBookingId and no other failure body carries it"
  - "the 204 response has a zero-length body and does not carry a JSON content type"
  - "the server started with PORT=4123 answers on 4123 and the server started without PORT answers on 3000"
feasibility: "feasible"
```

### room-booking-api:INV-001

```yaml
id: "room-booking-api:INV-001"
template: "Invariant"
obligation: "Successive creations return increasing ids with the documented prefixes and no id repeats after a deletion."
input_classes:
  - name: "typical_first_creation"
    input: "POST /rooms with body {\"name\": \"Aurora\", \"capacity\": 6} on a freshly started process"
    expected: "201 with id r1"
  - name: "boundary_second_creation"
    input: "POST /rooms with body {\"name\": \"Borealis\", \"capacity\": 2} directly after the first creation"
    expected: "201 with id r2"
  - name: "boundary_counter_spans_rooms"
    input: "POST /rooms/r1/bookings with a valid body, then POST /rooms/r2/bookings with a valid body, where rooms r1 and r2 exist"
    expected: "201 with id b1 then 201 with id b2"
  - name: "boundary_creation_after_deletion"
    input: "create b1 and b2 in room r1, DELETE /bookings/b1, then create a further booking in room r1"
    expected: "201 with id b3, never b1"
  - name: "invalid_client_supplied_id"
    input: "POST /rooms with body {\"id\": \"r99\", \"name\": \"Cirrus\", \"capacity\": 3} on a freshly started process"
    expected: "201 with id r1, the client value ignored"
negative_oracle: []
assertion_summary:
  - "room ids carry the prefix r and booking ids the prefix b followed by an unpadded decimal counter value"
  - "the counter advances in creation order and is shared by all rooms for bookings"
  - "a deleted booking id never reappears in a later create response or in a room listing"
  - "an id supplied in the request body never appears in the response"
feasibility: "feasible"
```

### room-booking-api:INV-002

```yaml
id: "room-booking-api:INV-002"
template: "Invariant"
obligation: "All sampled responses carry Content-Type application/json except the 204 delete response."
input_classes:
  - name: "typical_success_response"
    input: "POST /rooms with body {\"name\": \"Aurora\", \"capacity\": 6}"
    expected: "201 with Content-Type application/json and a JSON body"
  - name: "boundary_error_response"
    input: "GET /unknown"
    expected: "404 with Content-Type application/json and a JSON body"
  - name: "boundary_conflict_response"
    input: "POST /rooms with body {\"name\": \"aurora\", \"capacity\": 2} while a room named Aurora exists"
    expected: "409 with Content-Type application/json and a JSON body"
  - name: "boundary_no_content_response"
    input: "DELETE /bookings/b1 where b1 exists"
    expected: "204 with no body and no JSON content type"
negative_oracle: []
assertion_summary:
  - "every response with a body carries the header Content-Type application/json"
  - "the 204 response carries no body and does not declare a JSON content type"
  - "no response declares a text content type for an error"
feasibility: "feasible"
```

### room-booking-api:INV-003

```yaml
id: "room-booking-api:INV-003"
template: "Invariant"
obligation: "Each error response carries an error value from the documented catalogue and no other error shape."
input_classes:
  - name: "typical_400_invalid_room"
    input: "POST /rooms with body {\"name\": \"\", \"capacity\": 2}"
    expected: "400 with error invalid_room"
  - name: "boundary_400_invalid_json"
    input: "POST /rooms with body {\"name\":"
    expected: "400 with error invalid_json"
  - name: "boundary_400_invalid_query"
    input: "GET /rooms?minCapacity=0"
    expected: "400 with error invalid_query"
  - name: "boundary_400_invalid_booking"
    input: "POST /rooms/r1/bookings with body {\"title\": \"\", \"start\": \"2026-11-02T09:00:00Z\", \"end\": \"2026-11-02T10:00:00Z\", \"attendees\": 1} where room r1 exists"
    expected: "400 with error invalid_booking"
  - name: "boundary_404_not_found"
    input: "GET /unknown"
    expected: "404 with error not_found"
  - name: "boundary_404_room_not_found"
    input: "GET /rooms/r9/bookings where no room r9 exists"
    expected: "404 with error room_not_found"
  - name: "boundary_404_booking_not_found"
    input: "DELETE /bookings/b7 where no booking b7 exists"
    expected: "404 with error booking_not_found"
  - name: "boundary_405_method_not_allowed"
    input: "PUT /rooms"
    expected: "405 with error method_not_allowed"
  - name: "boundary_409_room_name_taken"
    input: "POST /rooms with body {\"name\": \"AURORA\", \"capacity\": 2} while a room named Aurora exists"
    expected: "409 with error room_name_taken"
  - name: "boundary_409_room_busy"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Sync\", \"start\": \"2026-11-02T09:30:00Z\", \"end\": \"2026-11-02T10:30:00Z\", \"attendees\": 1} where booking b1 occupies 09:00Z-10:00Z"
    expected: "409 with error room_busy and conflictingBookingId b1"
  - name: "boundary_422_over_capacity"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Sync\", \"start\": \"2026-11-02T11:00:00Z\", \"end\": \"2026-11-02T12:00:00Z\", \"attendees\": 99} where room r1 has capacity 10"
    expected: "422 with error over_capacity"
negative_oracle:
  - input_class: "typical_400_invalid_room"
    must_fail_with: "invalid_room"
    must_not: "a human-readable sentence in place of the code"
  - input_class: "boundary_404_room_not_found"
    must_fail_with: "room_not_found"
    must_not: "a generic not_found for an unknown room identifier"
  - input_class: "boundary_409_room_busy"
    must_fail_with: "room_busy"
    must_not: "a 409 body without conflictingBookingId"
assertion_summary:
  - "every error body has an error field whose value is one of the eleven documented snake_case codes"
  - "no error body contains a prose message in place of or beside the code"
  - "only the room_busy body carries conflictingBookingId"
feasibility: "feasible"
```

### room-booking-api:INV-004

```yaml
id: "room-booking-api:INV-004"
template: "Invariant"
obligation: "After a restart a previously created room is no longer listed."
input_classes:
  - name: "typical_fresh_process"
    input: "start the server on an ephemeral port and send GET /rooms"
    expected: "200 with {\"rooms\": []}"
  - name: "boundary_restarted_process"
    input: "start the server, POST /rooms with body {\"name\": \"Aurora\", \"capacity\": 6} (201, id r1), stop the process, start it again, then send GET /rooms"
    expected: "200 with {\"rooms\": []} on the restarted process"
  - name: "boundary_bookings_lost_after_restart"
    input: "start the server, create room r1 and booking b1, stop the process, start it again, then send GET /rooms/r1/bookings"
    expected: "404 room_not_found, since room r1 no longer exists"
negative_oracle: []
assertion_summary:
  - "the restarted process answers GET /rooms with an empty rooms array"
  - "the restarted process does not know the room id r1 that the previous process assigned"
  - "the second process starts on the same configured port and serves requests normally"
feasibility: "feasible"
```

### room-booking-api:INV-005

```yaml
id: "room-booking-api:INV-005"
template: "Invariant"
obligation: "Touching intervals never conflict and overlapping intervals always conflict."
input_classes:
  - name: "boundary_touching_at_end"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Review\", \"start\": \"2026-11-02T10:00:00Z\", \"end\": \"2026-11-02T11:00:00Z\", \"attendees\": 1} where booking b1 occupies 09:00Z-10:00Z in room r1"
    expected: "201"
  - name: "boundary_touching_at_start"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Review\", \"start\": \"2026-11-02T08:00:00Z\", \"end\": \"2026-11-02T09:00:00Z\", \"attendees\": 1} where booking b1 occupies 09:00Z-10:00Z in room r1"
    expected: "201"
  - name: "boundary_one_minute_overlap"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Review\", \"start\": \"2026-11-02T09:59:00Z\", \"end\": \"2026-11-02T10:30:00Z\", \"attendees\": 1} where booking b1 occupies 09:00Z-10:00Z in room r1"
    expected: "409 room_busy with conflictingBookingId b1"
  - name: "boundary_identical_interval"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Review\", \"start\": \"2026-11-02T09:00:00Z\", \"end\": \"2026-11-02T10:00:00Z\", \"attendees\": 1} where booking b1 occupies 09:00Z-10:00Z in room r1"
    expected: "409 room_busy with conflictingBookingId b1"
  - name: "empty_no_bookings"
    input: "POST /rooms/r1/bookings with a valid body where room r1 has no bookings"
    expected: "201"
negative_oracle:
  - input_class: "boundary_one_minute_overlap"
    must_fail_with: "room_busy"
    must_not: "a 201 response"
  - input_class: "boundary_identical_interval"
    must_fail_with: "room_busy"
    must_not: "a 201 response or a conflict body without conflictingBookingId"
assertion_summary:
  - "both touching creates return 201 and the created bookings appear in the room listing"
  - "both overlapping creates return 409 with error room_busy"
  - "the same half-open rule is visible in GET /rooms/r1/bookings?from=...&to=...: a booking ending exactly at from is excluded"
feasibility: "feasible"
```

### room-booking-api:INV-006

```yaml
id: "room-booking-api:INV-006"
template: "Invariant"
obligation: "Accepted times round-trip as minute-precision Z-suffixed strings and second-precision input is rejected."
input_classes:
  - name: "typical_minute_precision"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Standup\", \"start\": \"2026-11-02T09:30:00Z\", \"end\": \"2026-11-02T10:15:00Z\", \"attendees\": 1} where room r1 is free"
    expected: "201 with start 2026-11-02T09:30:00Z and end 2026-11-02T10:15:00Z echoed unchanged, and the same values in GET /rooms/r1/bookings"
  - name: "invalid_second_precision"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Standup\", \"start\": \"2026-11-02T09:00:30Z\", \"end\": \"2026-11-02T10:00:00Z\", \"attendees\": 1}"
    expected: "400 invalid_booking"
  - name: "invalid_offset_time"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Standup\", \"start\": \"2026-11-02T09:00:00+01:00\", \"end\": \"2026-11-02T11:00:00+01:00\", \"attendees\": 1}"
    expected: "400 invalid_booking"
  - name: "invalid_missing_z_suffix"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Standup\", \"start\": \"2026-11-02T09:00:00\", \"end\": \"2026-11-02T10:00:00\", \"attendees\": 1}"
    expected: "400 invalid_booking"
  - name: "boundary_query_time_format"
    input: "GET /rooms/r1/bookings?from=2026-11-02T09:00:00+01:00&to=2026-11-02T10:00:00+01:00 where room r1 exists"
    expected: "400 invalid_query"
negative_oracle:
  - input_class: "invalid_second_precision"
    must_fail_with: "invalid_booking"
    must_not: "a 201 response, or a stored start whose seconds were silently truncated"
  - input_class: "invalid_offset_time"
    must_fail_with: "invalid_booking"
    must_not: "a 201 response, or a stored time expressed with an offset"
  - input_class: "invalid_missing_z_suffix"
    must_fail_with: "invalid_booking"
    must_not: "a 201 response"
assertion_summary:
  - "an accepted booking echoes its start and end exactly as submitted, with a Z suffix and whole minutes"
  - "every returned booking time in the listing and in availability queries is a minute-precision Z-suffixed string"
  - "second-precision, offset and Z-less times are rejected with 400"
feasibility: "feasible"
```

### room-booking-api:POL-001

```yaml
id: "room-booking-api:POL-001"
template: "Policy"
obligation: "Every failure response carries exactly one catalogue code and the documented extra field."
input_classes:
  - name: "typical_400_invalid_room"
    input: "POST /rooms with body {\"name\": \"\", \"capacity\": 2}"
    expected: "400 with error invalid_room"
  - name: "boundary_400_invalid_json"
    input: "POST /rooms with body {\"name\":"
    expected: "400 with error invalid_json"
  - name: "boundary_404_not_found"
    input: "GET /unknown"
    expected: "404 with error not_found"
  - name: "boundary_404_room_not_found"
    input: "GET /rooms/r9/bookings where no room r9 exists"
    expected: "404 with error room_not_found"
  - name: "boundary_405_method_not_allowed"
    input: "PUT /rooms"
    expected: "405 with error method_not_allowed"
  - name: "boundary_409_room_name_taken"
    input: "POST /rooms with body {\"name\": \"aurora\", \"capacity\": 2} while a room named Aurora exists"
    expected: "409 with error room_name_taken"
  - name: "boundary_409_room_busy"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Sync\", \"start\": \"2026-11-02T09:30:00Z\", \"end\": \"2026-11-02T10:30:00Z\", \"attendees\": 1} where booking b1 occupies 09:00Z-10:00Z"
    expected: "409 with error room_busy and conflictingBookingId b1"
  - name: "boundary_422_over_capacity"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Sync\", \"start\": \"2026-11-02T11:00:00Z\", \"end\": \"2026-11-02T12:00:00Z\", \"attendees\": 99} where room r1 has capacity 10"
    expected: "422 with error over_capacity"
negative_oracle:
  - input_class: "typical_400_invalid_room"
    must_fail_with: "invalid_room"
    must_not: "a response without an error field, or a prose-only error value"
  - input_class: "boundary_404_not_found"
    must_fail_with: "not_found"
    must_not: "a response whose body is not JSON or whose error field is empty"
  - input_class: "boundary_405_method_not_allowed"
    must_fail_with: "method_not_allowed"
    must_not: "a prose-only error value"
  - input_class: "boundary_409_room_busy"
    must_fail_with: "room_busy"
    must_not: "a response without conflictingBookingId, or a prose-only error value"
  - input_class: "boundary_422_over_capacity"
    must_fail_with: "over_capacity"
    must_not: "a response whose error field holds a code outside the catalogue"
assertion_summary:
  - "each listed status returns a JSON body with exactly one error field holding the documented snake_case code"
  - "the room_busy body also carries conflictingBookingId and no other failure body carries it"
  - "no failure body substitutes prose for the code, and the process keeps serving after each failure"
feasibility: "feasible"
```

### room-booking-api:POL-002

```yaml
id: "room-booking-api:POL-002"
template: "Policy"
obligation: "After every rejected request the same process still serves a subsequent valid request."
input_classes:
  - name: "typical_malformed_json_then_valid"
    input: "POST /rooms with body {\"name\": \"Aurora\", \"capacity\": followed by POST /rooms with body {\"name\": \"Aurora\", \"capacity\": 2}"
    expected: "400 invalid_json, then 201 with id r1"
  - name: "boundary_unparseable_time"
    input: "POST /rooms/r1/bookings with body {\"title\": \"Standup\", \"start\": \"not-a-time\", \"end\": \"2026-11-02T10:00:00Z\", \"attendees\": 1} followed by GET /rooms"
    expected: "400 invalid_booking, then 200 with a rooms array"
  - name: "boundary_unknown_path"
    input: "GET /no/such/path followed by GET /rooms"
    expected: "404 not_found, then 200 with a rooms array"
  - name: "boundary_oversized_number"
    input: "POST /rooms with body {\"name\": \"Aurora\", \"capacity\": 99999999999999999999} followed by GET /rooms"
    expected: "400 invalid_room, then 200 with a rooms array holding no Aurora room"
  - name: "invalid_state_unchanged_after_rejection"
    input: "create room r1, then POST /rooms with body {\"name\": \"\", \"capacity\": 2}, then GET /rooms"
    expected: "the GET body lists exactly the rooms created before the rejected request"
negative_oracle:
  - input_class: "typical_malformed_json_then_valid"
    must_fail_with: "invalid_json"
    must_not: "a 5xx response, a dropped connection, or a process that stops answering the next request"
  - input_class: "boundary_unparseable_time"
    must_fail_with: "invalid_booking"
    must_not: "a 5xx response or a process exit"
  - input_class: "boundary_unknown_path"
    must_fail_with: "not_found"
    must_not: "a dropped connection or a 5xx response"
  - input_class: "boundary_oversized_number"
    must_fail_with: "invalid_room"
    must_not: "a 5xx response or a room created from the oversized value"
assertion_summary:
  - "every rejected request returns a documented 4xx status with a catalogue code, never a 5xx, never a dropped connection"
  - "the same process answers the following valid request with its documented success status"
  - "the state visible through GET /rooms is unchanged by a rejected write"
feasibility: "feasible"
```

## 4. Infeasible candidates

| id | reason | what would make it feasible |
| --- | --- | --- |
| `room-booking-api:BEH-011` | The equal-start tie-break needs two bookings of one room with an identical start; the second create is rejected with `409 room_busy`, so no sequence of boundary requests produces the state the assertion needs. | A documented boundary operation that creates two bookings with the same start in one room, or a restatement of the ordering rule that a boundary test can observe (for example start then creation order). |
| `room-booking-api:NFR-001` | The predicate is the exit status of `npm run build` and of `npm test`; a test inside that suite cannot assert the exit status of the run it belongs to, and the record names a CI job log as the artefact, which is not a boundary observable. | A CI job that publishes the two exit codes as an artefact the verification stage reads, or a build command whose exit code is observed outside the suite under test. |
