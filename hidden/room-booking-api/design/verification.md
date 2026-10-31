# Verification design: room-booking-api

## 1. Scope

42 blocks, one per approved record whose template is Behavior, Contract, Invariant, Scenario, NFR or Policy:

- Behavior 21: BEH-001 .. BEH-021
- Contract 7: CTR-001 .. CTR-007
- Invariant 8: INV-001 .. INV-008
- Scenario 3: SCN-001 .. SCN-003
- NFR 1: NFR-001
- Policy 2: POL-001, POL-002

Approved records skipped, with reason:

- the Partition record: partition metadata, carries no test obligation.
- `room-booking-api:BL-001` BrownfieldBaseline: baseline record.
- `room-booking-api:SUR-001` Surface: boundary declaration; only its `boundary_type: api` is used, to pick HTTP requests and HTTP observables as the concrete input and output form.
- `room-booking-api:LOC-001` LocalizationContract: no block template covers it; its rule is already decided by the error-body assertions of INV-004 and POL-001 and by the verbatim echo of requester-supplied names and titles in BEH-001, BEH-003, BEH-007 and INV-007.
- `room-booking-api:CON-001`, `room-booking-api:CON-002` Constraint: excluded by the template rule.
- `room-booking-api:IB-001` ImplementationBinding: excluded by the template rule; the port it fixes is used only as a setup fact, never as an assertion of its own.
- `room-booking-api:Q-001` .. `room-booking-api:Q-008` Open-Q: questions, not obligations; their in-force defaults are taken from A-001 .. A-008.
- `room-booking-api:A-001` .. `room-booking-api:A-008`, `room-booking-api:ASM-001` .. `room-booking-api:ASM-005` ASSUMPTION: assumptions.

## 2. Error oracle

Every error response is JSON with an `error` field holding one of these codes (INV-004, POL-001); no response in this table is free text.

| error code | observable signal | source record |
| --- | --- | --- |
| `invalid_json` | HTTP 400, JSON body `{"error": "invalid_json"}`, no state change | CTR-001, CTR-002, CTR-003, CTR-004, CTR-005, CTR-006, CTR-007 |
| `invalid_room` | HTTP 400, JSON body `{"error": "invalid_room"}`, no room created | CTR-001 |
| `room_name_taken` | HTTP 409, JSON body `{"error": "room_name_taken"}`, no room created | CTR-001 |
| `invalid_query` | HTTP 400, JSON body `{"error": "invalid_query"}`, no list returned | CTR-002, CTR-004, CTR-006 |
| `room_not_found` | HTTP 404, JSON body `{"error": "room_not_found"}` | CTR-003, CTR-004 |
| `invalid_booking` | HTTP 400, JSON body `{"error": "invalid_booking"}`, no booking created | CTR-003 |
| `over_capacity` | HTTP 422, JSON body `{"error": "over_capacity"}`, no booking created | CTR-003 |
| `room_busy` | HTTP 409, JSON body `{"error": "room_busy", "conflictingBookingId": "<booking id>"}`, no booking created | CTR-003 |
| `booking_not_found` | HTTP 404, JSON body `{"error": "booking_not_found"}` | CTR-005 |
| `not_found` | HTTP 404, JSON body `{"error": "not_found"}` | CTR-007 |
| `method_not_allowed` | HTTP 405, JSON body `{"error": "method_not_allowed"}` | CTR-007 |

## 3. Blocks

### room-booking-api:BEH-001

```yaml
id: room-booking-api:BEH-001
template: Behavior
obligation: "A valid room request whose name no existing room uses case-insensitively returns status 201 with room id r(N+1) and the created room appears in GET /rooms."
input_classes:
  - name: typical
    input: "POST /rooms with body {\"name\": \"Lab\", \"capacity\": 10} against an empty store"
    expected: "status 201; body {\"id\": \"r1\", \"name\": \"Lab\", \"capacity\": 10}"
  - name: empty
    input: "GET /rooms on the empty store before any room is created"
    expected: "status 200; body {\"rooms\": []}"
  - name: boundary_capacity_1
    input: "POST /rooms with body {\"name\": \"A\", \"capacity\": 1}"
    expected: "status 201; body id r(N+1) with capacity 1"
  - name: boundary_capacity_100
    input: "POST /rooms with body {\"name\": \"B\", \"capacity\": 100}"
    expected: "status 201; body id r(N+1) with capacity 100"
  - name: boundary_name_1_char
    input: "POST /rooms with body {\"name\": \"x\", \"capacity\": 10}"
    expected: "status 201; body name \"x\""
  - name: boundary_name_40_chars
    input: "POST /rooms with body {\"name\": \"0123456789012345678901234567890123456789\", \"capacity\": 10}"
    expected: "status 201; body name equal to the 40-character name given"
  - name: invalid_capacity_0
    input: "POST /rooms with body {\"name\": \"C\", \"capacity\": 0}"
    expected: "invalid_room; status 400"
  - name: invalid_capacity_101
    input: "POST /rooms with body {\"name\": \"D\", \"capacity\": 101}"
    expected: "invalid_room; status 400"
negative_oracle:
  - input_class: invalid_capacity_0
    must_fail_with: "invalid_room"
    must_not: "status 201, a room object in the body, or an additional room in GET /rooms"
  - input_class: invalid_capacity_101
    must_fail_with: "invalid_room"
    must_not: "status 201, a room object in the body, or an additional room in GET /rooms"
assertion_summary:
  - "the response status is 201 and the body holds exactly id, name and capacity"
  - "the body id is r followed by one more than the number of rooms that existed before the request"
  - "the body name and capacity equal the values given in the request"
  - "GET /rooms after a successful creation holds the new room and every earlier room"
  - "GET /rooms after a rejected creation holds exactly the rooms that existed before it"
feasibility: feasible
```

### room-booking-api:BEH-002

```yaml
id: room-booking-api:BEH-002
template: Behavior
obligation: "Each invalid name or capacity class returns status 400 with error invalid_room and leaves the store unchanged."
input_classes:
  - name: typical
    input: "POST /rooms with body {\"name\": \"Lab\", \"capacity\": 10} against an empty store"
    expected: "status 201; body {\"id\": \"r1\", \"name\": \"Lab\", \"capacity\": 10}"
  - name: boundary_name_41_chars
    input: "POST /rooms with body {\"name\": \"01234567890123456789012345678901234567890\", \"capacity\": 10}"
    expected: "invalid_room; status 400"
  - name: invalid_empty_name
    input: "POST /rooms with body {\"name\": \"\", \"capacity\": 10}"
    expected: "invalid_room; status 400"
  - name: invalid_capacity_0
    input: "POST /rooms with body {\"name\": \"Lab\", \"capacity\": 0}"
    expected: "invalid_room; status 400"
  - name: invalid_capacity_101
    input: "POST /rooms with body {\"name\": \"Lab\", \"capacity\": 101}"
    expected: "invalid_room; status 400"
  - name: invalid_capacity_fractional
    input: "POST /rooms with body {\"name\": \"Lab\", \"capacity\": 1.5}"
    expected: "invalid_room; status 400"
  - name: invalid_capacity_missing
    input: "POST /rooms with body {\"name\": \"Lab\"}"
    expected: "invalid_room; status 400"
  - name: invalid_capacity_string
    input: "POST /rooms with body {\"name\": \"Lab\", \"capacity\": \"10\"}"
    expected: "invalid_room; status 400"
  - name: invalid_body_array
    input: "POST /rooms with body [] and Content-Type application/json"
    expected: "invalid_room; status 400"
negative_oracle:
  - input_class: boundary_name_41_chars
    must_fail_with: "invalid_room"
    must_not: "status 201 or a new room in GET /rooms"
  - input_class: invalid_capacity_0
    must_fail_with: "invalid_room"
    must_not: "status 201 or a new room in GET /rooms"
  - input_class: invalid_body_array
    must_fail_with: "invalid_room"
    must_not: "a status of 500 or any response without the error field"
assertion_summary:
  - "every invalid class answers status 400 with body error invalid_room"
  - "GET /rooms after each rejected class holds exactly the rooms that existed before it"
  - "the valid-boundary classes answer status 201 with the created room"
feasibility: feasible
```

### room-booking-api:BEH-003

```yaml
id: room-booking-api:BEH-003
template: Behavior
obligation: "A name differing from an existing room name only by letter case returns status 409 with error room_name_taken and creates no room."
input_classes:
  - name: typical
    input: "room \"Lab\" exists; POST /rooms with body {\"name\": \"Lab 2\", \"capacity\": 10}"
    expected: "status 201; body id r2 with name \"Lab 2\""
  - name: boundary_identical_name
    input: "room \"Lab\" exists; POST /rooms with body {\"name\": \"Lab\", \"capacity\": 10}"
    expected: "room_name_taken; status 409"
  - name: boundary_upper_case_variant
    input: "room \"Lab\" exists; POST /rooms with body {\"name\": \"lAb\", \"capacity\": 10}"
    expected: "room_name_taken; status 409"
  - name: invalid_empty_name
    input: "room \"Lab\" exists; POST /rooms with body {\"name\": \"\", \"capacity\": 10}"
    expected: "invalid_room; status 400"
negative_oracle:
  - input_class: boundary_identical_name
    must_fail_with: "room_name_taken"
    must_not: "status 201 or a second room in GET /rooms"
  - input_class: boundary_upper_case_variant
    must_fail_with: "room_name_taken"
    must_not: "status 201 or a second room in GET /rooms"
  - input_class: invalid_empty_name
    must_fail_with: "invalid_room"
    must_not: "error room_name_taken or status 409"
assertion_summary:
  - "the letter-case variant answers status 409 with body error room_name_taken"
  - "GET /rooms after a rejected duplicate holds exactly one room"
  - "the differing name answers status 201 and its body name is echoed verbatim"
feasibility: feasible
```

### room-booking-api:BEH-004

```yaml
id: room-booking-api:BEH-004
template: Behavior
obligation: "A syntactically invalid JSON body on POST /rooms returns status 400 with error invalid_json and creates no room."
input_classes:
  - name: typical
    input: "POST /rooms with body {\"name\": \"Lab\", \"capacity\": 10}"
    expected: "status 201; body id r1"
  - name: empty
    input: "POST /rooms with a body holding only whitespace, Content-Type application/json"
    expected: "invalid_json; status 400"
  - name: boundary_truncated_json
    input: "POST /rooms with body { and Content-Type application/json"
    expected: "invalid_json; status 400"
  - name: invalid_array_body
    input: "POST /rooms with body [] and Content-Type application/json"
    expected: "invalid_room; status 400"
  - name: invalid_null_body
    input: "POST /rooms with body null and Content-Type application/json"
    expected: "invalid_room; status 400"
negative_oracle:
  - input_class: boundary_truncated_json
    must_fail_with: "invalid_json"
    must_not: "status 500, status 201, or error invalid_room"
  - input_class: empty
    must_fail_with: "invalid_json"
    must_not: "status 500 or a room created"
assertion_summary:
  - "the truncated body answers status 400 with body error invalid_json"
  - "the whitespace-only body answers status 400 with body error invalid_json"
  - "the valid-JSON non-object bodies answer status 400 with error invalid_room, never invalid_json"
  - "GET /rooms after each rejected class holds no room"
feasibility: feasible
```

### room-booking-api:BEH-005

```yaml
id: room-booking-api:BEH-005
template: Behavior
obligation: "The rooms array lists every room exactly once, ordered by room id."
input_classes:
  - name: typical
    input: "rooms r1, r2 and r3 created in that order; GET /rooms with no query"
    expected: "status 200; body {\"rooms\": [r1, r2, r3]}"
  - name: empty
    input: "GET /rooms on a store with no room"
    expected: "status 200; body {\"rooms\": []}"
  - name: boundary_one_room
    input: "one room r1 exists; GET /rooms"
    expected: "status 200; body rooms array holding r1 only"
  - name: boundary_twelve_rooms
    input: "twelve rooms created in order; GET /rooms"
    expected: "status 200; body rooms array r1, r2, ... r12 in that order"
  - name: invalid_min_capacity_0
    input: "GET /rooms?minCapacity=0"
    expected: "invalid_query; status 400"
negative_oracle:
  - input_class: invalid_min_capacity_0
    must_fail_with: "invalid_query"
    must_not: "status 200 or a rooms array in the body"
assertion_summary:
  - "the rooms array holds each created room once, with no duplicate id"
  - "the id order of the array is the numeric order of the id suffix, so r2 precedes r10"
  - "a rejected query returns status 400 with error invalid_query and no rooms array"
feasibility: feasible
```

### room-booking-api:BEH-006

```yaml
id: room-booking-api:BEH-006
template: Behavior
obligation: "minCapacity keeps exactly the rooms whose capacity is at least the value, and a value that is not a positive integer returns status 400 with error invalid_query."
input_classes:
  - name: typical
    input: "rooms r1 capacity 4, r2 capacity 10, r3 capacity 10 exist; GET /rooms?minCapacity=10"
    expected: "status 200; body rooms array r2, r3"
  - name: empty
    input: "the same three rooms exist; GET /rooms with minCapacity absent"
    expected: "status 200; body rooms array r1, r2, r3"
  - name: boundary_min_capacity_1
    input: "GET /rooms?minCapacity=1"
    expected: "status 200; body rooms array r1, r2, r3"
  - name: boundary_min_capacity_100
    input: "GET /rooms?minCapacity=100"
    expected: "status 200; body {\"rooms\": []}"
  - name: invalid_min_capacity_0
    input: "GET /rooms?minCapacity=0"
    expected: "invalid_query; status 400"
  - name: invalid_min_capacity_negative
    input: "GET /rooms?minCapacity=-1"
    expected: "invalid_query; status 400"
  - name: invalid_min_capacity_not_integer
    input: "GET /rooms?minCapacity=abc"
    expected: "invalid_query; status 400"
  - name: invalid_min_capacity_fractional
    input: "GET /rooms?minCapacity=1.5"
    expected: "invalid_query; status 400"
negative_oracle:
  - input_class: invalid_min_capacity_0
    must_fail_with: "invalid_query"
    must_not: "status 200 or a rooms array in the body"
  - input_class: invalid_min_capacity_not_integer
    must_fail_with: "invalid_query"
    must_not: "status 200 or a rooms array in the body"
assertion_summary:
  - "the filtered array holds exactly the rooms whose capacity is at least the value"
  - "a room whose capacity is below the value is absent from the array"
  - "GET /rooms without minCapacity returns every room"
feasibility: feasible
```

### room-booking-api:BEH-007

```yaml
id: room-booking-api:BEH-007
template: Behavior
obligation: "A valid booking request for an existing room, attendees within its capacity and a non-conflicting interval returns status 201 with the id one above the highest booking id handed out so far, and the booking appears in GET /rooms/r1/bookings."
input_classes:
  - name: typical
    input: "room r1 capacity 10 holds b1 to b4, b4 being 2026-11-02T11:00:00Z to 2026-11-02T12:00:00Z; POST /rooms/r1/bookings with body {\"title\": \"Standup\", \"start\": \"2026-11-02T09:30:00Z\", \"end\": \"2026-11-02T10:00:00Z\", \"attendees\": 4}"
    expected: "status 201; body {\"id\": \"b5\", \"roomId\": \"r1\", \"title\": \"Standup\", \"start\": \"2026-11-02T09:30:00Z\", \"end\": \"2026-11-02T10:00:00Z\", \"attendees\": 4}"
  - name: empty
    input: "a fresh process with room r1 and no booking; the first POST /rooms/r1/bookings"
    expected: "status 201; body id b1"
  - name: boundary_second_room
    input: "one booking exists in r1; POST /rooms/r2/bookings with an otherwise valid body"
    expected: "status 201; body id b2 and roomId r2"
  - name: boundary_attendees_1
    input: "POST /rooms/r1/bookings with attendees 1 and otherwise valid fields"
    expected: "status 201; body attendees 1"
  - name: boundary_title_80_chars
    input: "POST /rooms/r1/bookings with a title of 80 characters and otherwise valid fields"
    expected: "status 201; body title equal to the 80 characters given"
  - name: invalid_attendees_0
    input: "POST /rooms/r1/bookings with attendees 0 and otherwise valid fields"
    expected: "invalid_booking; status 400"
  - name: invalid_unknown_room
    input: "POST /rooms/r9/bookings with an otherwise valid body"
    expected: "room_not_found; status 404"
  - name: invalid_over_capacity
    input: "room r1 with capacity 10; POST /rooms/r1/bookings with attendees 11 and otherwise valid fields"
    expected: "over_capacity; status 422"
  - name: invalid_overlap
    input: "b4 from 2026-11-02T11:00:00Z to 2026-11-02T12:00:00Z; POST /rooms/r1/bookings for 2026-11-02T10:30:00Z to 2026-11-02T11:30:00Z"
    expected: "room_busy; status 409"
negative_oracle:
  - input_class: invalid_attendees_0
    must_fail_with: "invalid_booking"
    must_not: "status 201 or a new booking in GET /rooms/r1/bookings"
  - input_class: invalid_unknown_room
    must_fail_with: "room_not_found"
    must_not: "status 201 or a new booking id handed out"
  - input_class: invalid_over_capacity
    must_fail_with: "over_capacity"
    must_not: "status 201 or a new booking in GET /rooms/r1/bookings"
  - input_class: invalid_overlap
    must_fail_with: "room_busy"
    must_not: "status 201 or a second booking stored for that interval"
assertion_summary:
  - "the successful body holds exactly id, roomId, title, start, end and attendees"
  - "the body id is one above the highest booking id handed out earlier in the process, across all rooms"
  - "GET /rooms/r1/bookings after creation holds the new booking"
  - "a rejected class hands out no new booking id"
feasibility: feasible
```

### room-booking-api:BEH-008

```yaml
id: room-booking-api:BEH-008
template: Behavior
obligation: "Every invalid title, time or duration class returns status 400 with error invalid_booking and leaves the store unchanged."
input_classes:
  - name: typical
    input: "room r1 capacity 10 holds no booking; POST /rooms/r1/bookings with body {\"title\": \"Standup\", \"start\": \"2026-11-02T09:30:00Z\", \"end\": \"2026-11-02T10:00:00Z\", \"attendees\": 4}"
    expected: "status 201; body id b1"
  - name: empty_title
    input: "POST /rooms/r1/bookings with body {\"title\": \"\", \"start\": \"2026-11-02T09:30:00Z\", \"end\": \"2026-11-02T10:00:00Z\", \"attendees\": 4}"
    expected: "invalid_booking; status 400"
  - name: boundary_title_81_chars
    input: "POST /rooms/r1/bookings with a title of 81 characters and otherwise valid fields"
    expected: "invalid_booking; status 400"
  - name: boundary_duration_8_hours
    input: "POST /rooms/r1/bookings for 2026-11-02T09:00:00Z to 2026-11-02T17:00:00Z"
    expected: "status 201; body id b1"
  - name: boundary_duration_8_hours_1_minute
    input: "POST /rooms/r1/bookings for 2026-11-02T09:00:00Z to 2026-11-02T17:01:00Z"
    expected: "invalid_booking; status 400"
  - name: invalid_time_unparseable
    input: "POST /rooms/r1/bookings with start \"banana\" and an otherwise valid body"
    expected: "invalid_booking; status 400"
  - name: invalid_time_seconds
    input: "POST /rooms/r1/bookings with start 2026-11-02T09:30:45Z and end 2026-11-02T10:00:00Z"
    expected: "invalid_booking; status 400"
  - name: invalid_time_offset
    input: "POST /rooms/r1/bookings with start 2026-11-02T10:30:00+01:00 and end 2026-11-02T12:00:00Z"
    expected: "invalid_booking; status 400"
  - name: invalid_end_equal_start
    input: "POST /rooms/r1/bookings with start and end both 2026-11-02T09:30:00Z"
    expected: "invalid_booking; status 400"
  - name: invalid_end_before_start
    input: "POST /rooms/r1/bookings for 2026-11-02T10:00:00Z to 2026-11-02T09:00:00Z"
    expected: "invalid_booking; status 400"
  - name: invalid_attendees_0
    input: "POST /rooms/r1/bookings with attendees 0 and otherwise valid fields"
    expected: "invalid_booking; status 400"
  - name: invalid_attendees_fractional
    input: "POST /rooms/r1/bookings with attendees 1.5 and otherwise valid fields"
    expected: "invalid_booking; status 400"
negative_oracle:
  - input_class: boundary_duration_8_hours_1_minute
    must_fail_with: "invalid_booking"
    must_not: "status 201 or a new booking in GET /rooms/r1/bookings"
  - input_class: invalid_time_seconds
    must_fail_with: "invalid_booking"
    must_not: "status 201 or a booking whose start is stored"
  - input_class: invalid_end_equal_start
    must_fail_with: "invalid_booking"
    must_not: "status 201 or a new booking in GET /rooms/r1/bookings"
assertion_summary:
  - "each invalid class answers status 400 with body error invalid_booking"
  - "the 8-hour interval answers status 201 and the 8-hour-and-1-minute interval answers status 400"
  - "GET /rooms/r1/bookings after each rejected class holds no booking"
feasibility: feasible
```

### room-booking-api:BEH-009

```yaml
id: room-booking-api:BEH-009
template: Behavior
obligation: "An unknown room id returns status 404 with error room_not_found before any body validation is reported, including for a body that is not valid JSON."
input_classes:
  - name: typical
    input: "room r1 exists; POST /rooms/r1/bookings with an otherwise valid body"
    expected: "status 201; body id b1 and roomId r1"
  - name: boundary_unknown_room_valid_body
    input: "no room r9 exists; POST /rooms/r9/bookings with a valid body"
    expected: "room_not_found; status 404"
  - name: empty_unknown_room_empty_title
    input: "no room r9 exists; POST /rooms/r9/bookings with body {\"title\": \"\", \"start\": \"2026-11-02T09:30:00Z\", \"end\": \"2026-11-02T10:00:00Z\", \"attendees\": 4}"
    expected: "room_not_found; status 404"
  - name: invalid_json_unknown_room
    input: "no room r9 exists; POST /rooms/r9/bookings with body { and Content-Type application/json"
    expected: "room_not_found; status 404"
negative_oracle:
  - input_class: empty_unknown_room_empty_title
    must_fail_with: "room_not_found"
    must_not: "error invalid_booking or status 400"
  - input_class: invalid_json_unknown_room
    must_fail_with: "room_not_found"
    must_not: "error invalid_json or status 400"
assertion_summary:
  - "every request to /rooms/r9/bookings answers status 404 with body error room_not_found"
  - "no booking is created by any request to an unknown room, checked through GET /rooms/r9/bookings answering room_not_found"
  - "the existing room answers status 201 with the created booking"
feasibility: feasible
```

### room-booking-api:BEH-010

```yaml
id: room-booking-api:BEH-010
template: Behavior
obligation: "Attendees above the room capacity returns status 422 with error over_capacity unless a body field is invalid, and attendees equal to the capacity returns status 201."
input_classes:
  - name: typical
    input: "room r1 capacity 4 holds no booking; POST /rooms/r1/bookings with attendees 5 and otherwise valid fields"
    expected: "over_capacity; status 422"
  - name: boundary_attendees_equal_capacity
    input: "POST /rooms/r1/bookings with attendees 4 and otherwise valid fields"
    expected: "status 201; body attendees 4"
  - name: boundary_attendees_far_above_capacity
    input: "POST /rooms/r1/bookings with attendees 1000 and otherwise valid fields"
    expected: "over_capacity; status 422"
  - name: invalid_empty_title_with_over_capacity
    input: "POST /rooms/r1/bookings with attendees 5 and title \"\""
    expected: "invalid_booking; status 400"
negative_oracle:
  - input_class: typical
    must_fail_with: "over_capacity"
    must_not: "status 201, status 400, or a new booking in GET /rooms/r1/bookings"
  - input_class: invalid_empty_title_with_over_capacity
    must_fail_with: "invalid_booking"
    must_not: "error over_capacity, status 422, or a new booking"
assertion_summary:
  - "attendees above the capacity answer status 422 with body error over_capacity"
  - "attendees equal to the capacity answer status 201 with the created booking"
  - "a request that also carries an invalid title answers status 400 with error invalid_booking"
  - "GET /rooms/r1/bookings after each rejected class holds no booking"
feasibility: feasible
```

### room-booking-api:BEH-011

```yaml
id: room-booking-api:BEH-011
template: Behavior
obligation: "An overlapping interval returns status 409 with error room_busy and the conflictingBookingId of the earliest-starting conflict, and an interval touching another interval is accepted."
input_classes:
  - name: typical
    input: "r1 holds b1 2026-11-02T09:00:00Z to 2026-11-02T10:00:00Z and b2 2026-11-02T10:00:00Z to 2026-11-02T12:00:00Z; POST /rooms/r1/bookings for 2026-11-02T08:00:00Z to 2026-11-02T11:00:00Z"
    expected: "room_busy; status 409; body conflictingBookingId b1"
  - name: empty
    input: "room r1 holds no booking; POST /rooms/r1/bookings for 2026-11-02T09:00:00Z to 2026-11-02T10:00:00Z"
    expected: "status 201; body id b1"
  - name: boundary_overlap_two_bookings
    input: "b1 and b2 exist as above; POST /rooms/r1/bookings for 2026-11-02T10:00:00Z to 2026-11-02T12:30:00Z"
    expected: "room_busy; status 409; body conflictingBookingId b2"
  - name: boundary_starting_at_booking_end
    input: "b1 and b2 exist as above; POST /rooms/r1/bookings for 2026-11-02T12:00:00Z to 2026-11-02T13:00:00Z"
    expected: "status 201; body id b3"
  - name: boundary_ending_at_booking_start
    input: "b1 and b2 exist as above; POST /rooms/r1/bookings for 2026-11-02T06:00:00Z to 2026-11-02T09:00:00Z"
    expected: "status 201; body id b3"
negative_oracle:
  - input_class: typical
    must_fail_with: "room_busy"
    must_not: "status 201, a missing conflictingBookingId, or a new booking in GET /rooms/r1/bookings"
  - input_class: boundary_overlap_two_bookings
    must_fail_with: "room_busy"
    must_not: "conflictingBookingId b1 for this interval or status 201"
assertion_summary:
  - "the room_busy body carries error room_busy and conflictingBookingId of the conflict with the smallest start"
  - "an interval beginning exactly at another booking end answers status 201"
  - "an interval ending exactly at another booking start answers status 201"
  - "GET /rooms/r1/bookings after a rejection holds only the bookings that existed before it"
feasibility: feasible
```

### room-booking-api:BEH-012

```yaml
id: room-booking-api:BEH-012
template: Behavior
obligation: "A syntactically invalid JSON body on POST /rooms/r1/bookings returns status 400 with error invalid_json and creates no booking."
input_classes:
  - name: typical
    input: "room r1 exists; POST /rooms/r1/bookings with a valid booking body"
    expected: "status 201; body id b1"
  - name: empty
    input: "POST /rooms/r1/bookings with a body of zero length and Content-Type application/json"
    expected: "invalid_json; status 400"
  - name: boundary_truncated_json
    input: "POST /rooms/r1/bookings with body { and Content-Type application/json"
    expected: "invalid_json; status 400"
  - name: invalid_json_string_body
    input: "POST /rooms/r1/bookings with body \"text\" and Content-Type application/json"
    expected: "invalid_booking; status 400"
negative_oracle:
  - input_class: boundary_truncated_json
    must_fail_with: "invalid_json"
    must_not: "status 500, error invalid_booking, or a new booking"
  - input_class: empty
    must_fail_with: "invalid_json"
    must_not: "status 500 or a new booking in GET /rooms/r1/bookings"
assertion_summary:
  - "the invalid JSON bodies answer status 400 with body error invalid_json"
  - "the valid-JSON string body answers status 400 with error invalid_booking, never invalid_json"
  - "GET /rooms/r1/bookings after each rejected class holds no booking"
feasibility: feasible
```

### room-booking-api:BEH-013

```yaml
id: room-booking-api:BEH-013
template: Behavior
obligation: "The bookings array holds every booking of the room exactly once, ordered by start and then by booking id."
input_classes:
  - name: typical
    input: "r1 holds b1 2026-11-02T10:00:00Z to 11:00:00Z, b2 2026-11-02T09:00:00Z to 2026-11-02T09:30:00Z and b3 2026-11-03T09:00:00Z to 2026-11-03T10:00:00Z; GET /rooms/r1/bookings with no query"
    expected: "status 200; body bookings array b2, b1, b3 in that order"
  - name: empty
    input: "room r1 holds no booking; GET /rooms/r1/bookings"
    expected: "status 200; body {\"bookings\": []}"
  - name: boundary_single_booking
    input: "room r1 holds one booking b1; GET /rooms/r1/bookings"
    expected: "status 200; body bookings array holding b1 only"
  - name: boundary_twelve_bookings
    input: "room r1 holds twelve hourly bookings from 2026-11-02T08:00:00Z to 2026-11-02T20:00:00Z; GET /rooms/r1/bookings"
    expected: "status 200; body bookings array in ascending start order from b1 to b12"
  - name: invalid_unknown_room
    input: "no room r9 exists; GET /rooms/r9/bookings"
    expected: "room_not_found; status 404"
negative_oracle:
  - input_class: invalid_unknown_room
    must_fail_with: "room_not_found"
    must_not: "status 200 or a bookings array in the body"
assertion_summary:
  - "the array holds every booking of the room exactly once"
  - "each booking is placed after every booking with an earlier start"
  - "no booking of another room appears in the array"
  - "the empty room answers status 200 with an empty bookings array"
feasibility: feasible
```

### room-booking-api:BEH-014

```yaml
id: room-booking-api:BEH-014
template: Behavior
obligation: "The from and to window keeps exactly the bookings overlapping the half-open interval, and an incomplete or invalid window returns status 400 with error invalid_query."
input_classes:
  - name: typical
    input: "r1 holds b1 2026-11-02T09:00:00Z to 10:00:00Z and b2 2026-11-02T10:00:00Z to 11:00:00Z; GET /rooms/r1/bookings?from=2026-11-02T10:00:00Z&to=2026-11-02T12:00:00Z"
    expected: "status 200; body bookings array holding b2 only"
  - name: empty
    input: "GET /rooms/r1/bookings?from=2026-11-02T06:00:00Z&to=2026-11-02T08:00:00Z"
    expected: "status 200; body {\"bookings\": []}"
  - name: boundary_window_starting_at_booking_end
    input: "GET /rooms/r1/bookings?from=2026-11-02T10:00:00Z&to=2026-11-02T11:00:00Z"
    expected: "status 200; body bookings array holding b2 only"
  - name: boundary_window_equal_to_booking
    input: "GET /rooms/r1/bookings?from=2026-11-02T09:00:00Z&to=2026-11-02T10:00:00Z"
    expected: "status 200; body bookings array holding b1 only"
  - name: invalid_only_from
    input: "GET /rooms/r1/bookings?from=2026-11-02T09:00:00Z"
    expected: "invalid_query; status 400"
  - name: invalid_to_equal_from
    input: "GET /rooms/r1/bookings?from=2026-11-02T10:00:00Z&to=2026-11-02T10:00:00Z"
    expected: "invalid_query; status 400"
  - name: invalid_to_before_from
    input: "GET /rooms/r1/bookings?from=2026-11-02T11:00:00Z&to=2026-11-02T10:00:00Z"
    expected: "invalid_query; status 400"
  - name: invalid_time_seconds
    input: "GET /rooms/r1/bookings?from=2026-11-02T10:00:45Z&to=2026-11-02T12:00:00Z"
    expected: "invalid_query; status 400"
  - name: invalid_time_unparseable
    input: "GET /rooms/r1/bookings?from=banana&to=2026-11-02T12:00:00Z"
    expected: "invalid_query; status 400"
negative_oracle:
  - input_class: invalid_only_from
    must_fail_with: "invalid_query"
    must_not: "status 200 or a bookings array in the body"
  - input_class: invalid_to_equal_from
    must_fail_with: "invalid_query"
    must_not: "status 200 or a bookings array in the body"
assertion_summary:
  - "a booking ending exactly at from is absent from the array"
  - "a booking starting exactly at to is absent from the array"
  - "a rejected window answers status 400 with error invalid_query and no bookings array"
feasibility: feasible
```

### room-booking-api:BEH-015

```yaml
id: room-booking-api:BEH-015
template: Behavior
obligation: "An unknown room id with no query returns status 404 with error room_not_found, and an invalid window is answered invalid_query even on an unknown room."
input_classes:
  - name: typical
    input: "room r1 holds b1; GET /rooms/r1/bookings with no query"
    expected: "status 200; body bookings array holding b1"
  - name: empty
    input: "room r1 holds no booking; GET /rooms/r1/bookings with no query"
    expected: "status 200; body {\"bookings\": []}"
  - name: boundary_unknown_room
    input: "no room r9 exists; GET /rooms/r9/bookings with no query"
    expected: "room_not_found; status 404"
  - name: invalid_window_on_unknown_room
    input: "no room r9 exists; GET /rooms/r9/bookings?from=banana&to=2026-11-02T12:00:00Z"
    expected: "invalid_query; status 400"
negative_oracle:
  - input_class: boundary_unknown_room
    must_fail_with: "room_not_found"
    must_not: "status 200 or an empty bookings array presented as success"
  - input_class: invalid_window_on_unknown_room
    must_fail_with: "invalid_query"
    must_not: "error room_not_found or status 404"
assertion_summary:
  - "the unknown room without a query answers status 404 with body error room_not_found"
  - "the malformed window on the unknown room answers status 400 with error invalid_query"
  - "the existing room answers status 200 with a bookings array"
feasibility: feasible
```

### room-booking-api:BEH-016

```yaml
id: room-booking-api:BEH-016
template: Behavior
obligation: "A known booking is removed with status 204, its interval becomes bookable again, and the booking is absent from GET /rooms/r1/bookings."
input_classes:
  - name: typical
    input: "r1 holds b1 2026-11-02T09:00:00Z to 2026-11-02T10:00:00Z; DELETE /bookings/b1, then POST /rooms/r1/bookings for the same interval"
    expected: "status 204 with no body, then status 201 with a new booking"
  - name: empty
    input: "no booking exists; DELETE /bookings/b1"
    expected: "booking_not_found; status 404"
  - name: boundary_one_of_two_bookings
    input: "r1 holds b1 09:00 to 10:00 and b2 10:00 to 11:00 on 2026-11-02; DELETE /bookings/b1"
    expected: "status 204; GET /rooms/r1/bookings holds b2 only"
  - name: boundary_delete_twice
    input: "DELETE /bookings/b1 a second time after it was removed"
    expected: "booking_not_found; status 404"
negative_oracle:
  - input_class: boundary_delete_twice
    must_fail_with: "booking_not_found"
    must_not: "status 204 or a second removal of the same booking"
assertion_summary:
  - "the first deletion answers status 204 with no response body"
  - "GET /rooms/r1/bookings after the deletion does not hold b1"
  - "the interval of the deleted booking accepts a new booking with status 201"
  - "the second deletion answers status 404 with error booking_not_found"
feasibility: feasible
```

### room-booking-api:BEH-017

```yaml
id: room-booking-api:BEH-017
template: Behavior
obligation: "An unknown booking id returns status 404 with error booking_not_found and changes no state."
input_classes:
  - name: typical
    input: "booking b1 exists; DELETE /bookings/b1"
    expected: "status 204 with no body"
  - name: empty
    input: "no booking b7 exists; DELETE /bookings/b7"
    expected: "booking_not_found; status 404"
  - name: boundary_deleted_booking_id
    input: "DELETE /bookings/b1 again after b1 was already removed"
    expected: "booking_not_found; status 404"
  - name: invalid_json_body
    input: "booking b1 exists; DELETE /bookings/b1 with body { and Content-Type application/json"
    expected: "invalid_json; status 400"
negative_oracle:
  - input_class: empty
    must_fail_with: "booking_not_found"
    must_not: "status 204 or any other 2xx status"
  - input_class: invalid_json_body
    must_fail_with: "invalid_json"
    must_not: "status 204 or the removal of b1"
assertion_summary:
  - "the unknown booking answers status 404 with body error booking_not_found"
  - "GET /rooms/r1/bookings after the unknown-id request still holds every earlier booking"
  - "the request carrying an invalid JSON body answers status 400 with error invalid_json"
feasibility: feasible
```

### room-booking-api:BEH-018

```yaml
id: room-booking-api:BEH-018
template: Behavior
obligation: "The rooms array holds exactly the rooms whose capacity is at least attendees and whose bookings do not overlap the availability window, ordered by capacity ascending then by room id."
input_classes:
  - name: typical
    input: "r1 capacity 10, r2 capacity 20, r3 capacity 10 exist and r2 holds 2026-11-02T09:00:00Z to 2026-11-02T11:00:00Z; GET /availability?start=2026-11-02T10:00:00Z&end=2026-11-02T11:00:00Z&attendees=10"
    expected: "status 200; body rooms array r1, r3 in that order"
  - name: empty
    input: "GET /availability?start=2026-11-02T10:00:00Z&end=2026-11-02T11:00:00Z&attendees=21"
    expected: "status 200; body {\"rooms\": []}"
  - name: boundary_window_touching_booking_end
    input: "GET /availability?start=2026-11-02T11:00:00Z&end=2026-11-02T12:00:00Z&attendees=10"
    expected: "status 200; body rooms array r1, r3, r2 in that order"
  - name: boundary_attendees_equal_capacity
    input: "GET /availability?start=2026-11-02T11:00:00Z&end=2026-11-02T12:00:00Z&attendees=20"
    expected: "status 200; body rooms array holding r2 only"
  - name: invalid_missing_end
    input: "GET /availability?start=2026-11-02T10:00:00Z&attendees=10"
    expected: "invalid_query; status 400"
negative_oracle:
  - input_class: invalid_missing_end
    must_fail_with: "invalid_query"
    must_not: "status 200 or a rooms array in the body"
assertion_summary:
  - "r2, whose booking overlaps the window, is absent from the array"
  - "rooms with equal capacity are ordered by the numeric id suffix, so r1 precedes r3"
  - "a room whose capacity is below attendees is absent from the array"
  - "a window starting exactly at a booking end treats the room as free"
feasibility: feasible
```

### room-booking-api:BEH-019

```yaml
id: room-booking-api:BEH-019
template: Behavior
obligation: "Every missing or invalid availability parameter returns status 400 with error invalid_query and no room list."
input_classes:
  - name: typical
    input: "rooms exist; GET /availability?start=2026-11-02T10:00:00Z&end=2026-11-02T11:00:00Z&attendees=2"
    expected: "status 200; body a rooms array"
  - name: empty
    input: "GET /availability?start=2026-11-02T10:00:00Z&end=2026-11-02T11:00:00Z with attendees absent"
    expected: "invalid_query; status 400"
  - name: invalid_start_missing
    input: "GET /availability?end=2026-11-02T11:00:00Z&attendees=2"
    expected: "invalid_query; status 400"
  - name: invalid_end_missing
    input: "GET /availability?start=2026-11-02T10:00:00Z&attendees=2"
    expected: "invalid_query; status 400"
  - name: boundary_end_equal_start
    input: "GET /availability?start=2026-11-02T10:00:00Z&end=2026-11-02T10:00:00Z&attendees=2"
    expected: "invalid_query; status 400"
  - name: invalid_end_before_start
    input: "GET /availability?start=2026-11-02T11:00:00Z&end=2026-11-02T10:00:00Z&attendees=2"
    expected: "invalid_query; status 400"
  - name: invalid_time_unparseable
    input: "GET /availability?start=banana&end=2026-11-02T11:00:00Z&attendees=2"
    expected: "invalid_query; status 400"
  - name: invalid_time_seconds
    input: "GET /availability?start=2026-11-02T10:00:45Z&end=2026-11-02T11:00:00Z&attendees=2"
    expected: "invalid_query; status 400"
  - name: invalid_attendees_fractional
    input: "GET /availability?start=2026-11-02T10:00:00Z&end=2026-11-02T11:00:00Z&attendees=1.5"
    expected: "invalid_query; status 400"
negative_oracle:
  - input_class: invalid_start_missing
    must_fail_with: "invalid_query"
    must_not: "status 200 or a rooms array in the body"
  - input_class: invalid_end_before_start
    must_fail_with: "invalid_query"
    must_not: "status 200 or a rooms array in the body"
assertion_summary:
  - "each class answers status 400 with body error invalid_query"
  - "the rejected responses carry no rooms array"
  - "the complete and valid query answers status 200 with a rooms array"
feasibility: feasible
```

### room-booking-api:BEH-020

```yaml
id: room-booking-api:BEH-020
template: Behavior
obligation: "A path that no endpoint declares returns status 404 with error not_found for every method, and a request carrying a body that is not valid JSON is answered invalid_json before the path is resolved."
input_classes:
  - name: typical
    input: "GET /nope with no body"
    expected: "not_found; status 404"
  - name: empty
    input: "GET /rooms/r1/bookings for the known route with no query"
    expected: "status 200; body a bookings array"
  - name: boundary_known_prefix_undeclared_path
    input: "GET /rooms/r1 with no body"
    expected: "not_found; status 404"
  - name: boundary_unknown_path_with_body
    input: "POST /nope with body {\"a\": 1}"
    expected: "not_found; status 404"
  - name: invalid_json_body
    input: "POST /nope with body { and Content-Type application/json"
    expected: "invalid_json; status 400"
  - name: invalid_declared_path_undeclared_method
    input: "PUT /rooms with no body"
    expected: "method_not_allowed; status 405"
negative_oracle:
  - input_class: typical
    must_fail_with: "not_found"
    must_not: "status 405 or status 200"
  - input_class: invalid_json_body
    must_fail_with: "invalid_json"
    must_not: "error not_found or status 404"
  - input_class: invalid_declared_path_undeclared_method
    must_fail_with: "method_not_allowed"
    must_not: "error not_found or status 404"
assertion_summary:
  - "every undeclared path answers status 404 with body error not_found"
  - "the undeclared path carrying an invalid JSON body answers status 400 with error invalid_json"
  - "the declared path with an undeclared method answers status 405 with error method_not_allowed"
feasibility: feasible
```

### room-booking-api:BEH-021

```yaml
id: room-booking-api:BEH-021
template: Behavior
obligation: "Every method the declared endpoints do not offer on a declared path returns status 405 with error method_not_allowed, and an undeclared path is never answered method_not_allowed."
input_classes:
  - name: typical
    input: "PUT /rooms with no body"
    expected: "method_not_allowed; status 405"
  - name: boundary_delete_on_collection
    input: "DELETE /rooms with no body"
    expected: "method_not_allowed; status 405"
  - name: boundary_get_on_booking_item
    input: "GET /bookings/b1 with no body"
    expected: "method_not_allowed; status 405"
  - name: empty
    input: "POST /rooms with a valid body"
    expected: "status 201 with the created room"
  - name: invalid_undeclared_path
    input: "GET /nope with no body"
    expected: "not_found; status 404"
negative_oracle:
  - input_class: typical
    must_fail_with: "method_not_allowed"
    must_not: "status 404, status 400, or a created room"
  - input_class: invalid_undeclared_path
    must_fail_with: "not_found"
    must_not: "error method_not_allowed or status 405"
assertion_summary:
  - "each unsupported method on a declared path answers status 405 with body error method_not_allowed"
  - "the declared method answers a status other than 405"
  - "the undeclared path answers status 404 with error not_found"
feasibility: feasible
```

### room-booking-api:CTR-001

```yaml
id: room-booking-api:CTR-001
template: Contract
obligation: "POST /rooms answers 201, 400 invalid_json, 400 invalid_room or 409 room_name_taken and no other status; a request whose capacity is 0 and whose name is also taken is answered invalid_room; a body that is not valid JSON is answered invalid_json."
input_classes:
  - name: typical
    input: "POST /rooms with body {\"name\": \"Lab\", \"capacity\": 10} against an empty store"
    expected: "status 201; body {\"id\": \"r1\", \"name\": \"Lab\", \"capacity\": 10}"
  - name: empty
    input: "POST /rooms with a whitespace-only body and Content-Type application/json"
    expected: "invalid_json; status 400"
  - name: boundary_capacity_1
    input: "POST /rooms with body {\"name\": \"A\", \"capacity\": 1}"
    expected: "status 201; body capacity 1"
  - name: boundary_capacity_100
    input: "POST /rooms with body {\"name\": \"B\", \"capacity\": 100}"
    expected: "status 201; body capacity 100"
  - name: boundary_name_40_chars
    input: "POST /rooms with body {\"name\": \"0123456789012345678901234567890123456789\", \"capacity\": 10}"
    expected: "status 201; body name equal to the value given"
  - name: invalid_empty_name
    input: "POST /rooms with body {\"name\": \"\", \"capacity\": 10}"
    expected: "invalid_room; status 400"
  - name: invalid_capacity_0
    input: "POST /rooms with body {\"name\": \"Lab\", \"capacity\": 0}"
    expected: "invalid_room; status 400"
  - name: invalid_duplicate_name
    input: "room \"Lab\" exists; POST /rooms with body {\"name\": \"lAb\", \"capacity\": 10}"
    expected: "room_name_taken; status 409"
  - name: invalid_json_body
    input: "POST /rooms with body { and Content-Type application/json"
    expected: "invalid_json; status 400"
  - name: invalid_taken_name_with_capacity_0
    input: "room \"Lab\" exists; POST /rooms with body {\"name\": \"lAb\", \"capacity\": 0}"
    expected: "invalid_room; status 400"
negative_oracle:
  - input_class: invalid_empty_name
    must_fail_with: "invalid_room"
    must_not: "status 201, room_name_taken, or a new room in GET /rooms"
  - input_class: invalid_duplicate_name
    must_fail_with: "room_name_taken"
    must_not: "status 201 or a second room in GET /rooms"
  - input_class: invalid_json_body
    must_fail_with: "invalid_json"
    must_not: "error invalid_room, status 500, or a created room"
  - input_class: invalid_taken_name_with_capacity_0
    must_fail_with: "invalid_room"
    must_not: "error room_name_taken or status 409"
assertion_summary:
  - "each class returns exactly one of the four statuses of the contract"
  - "the body of a 201 response holds exactly id, name and capacity"
  - "the body of every error response holds error and, for room_busy only, conflictingBookingId"
  - "GET /rooms after a rejected class holds exactly the rooms that existed before it"
feasibility: feasible
```

### room-booking-api:CTR-002

```yaml
id: room-booking-api:CTR-002
template: Contract
obligation: "GET /rooms answers 200, 400 invalid_query or 400 invalid_json and no other status, and a present request body that is not valid JSON is answered 400 invalid_json."
input_classes:
  - name: typical
    input: "rooms r1 and r2 exist; GET /rooms with no query and no body"
    expected: "status 200; body rooms array r1, r2"
  - name: empty
    input: "GET /rooms on a store with no room"
    expected: "status 200; body {\"rooms\": []}"
  - name: boundary_min_capacity_positive
    input: "r1 capacity 4 and r2 capacity 10 exist; GET /rooms?minCapacity=5"
    expected: "status 200; body rooms array holding r2 only"
  - name: boundary_min_capacity_100
    input: "GET /rooms?minCapacity=100"
    expected: "status 200; body {\"rooms\": []}"
  - name: invalid_min_capacity_0
    input: "GET /rooms?minCapacity=0"
    expected: "invalid_query; status 400"
  - name: invalid_min_capacity_not_integer
    input: "GET /rooms?minCapacity=abc"
    expected: "invalid_query; status 400"
  - name: invalid_json_body
    input: "GET /rooms with body { and Content-Type application/json"
    expected: "invalid_json; status 400"
negative_oracle:
  - input_class: invalid_min_capacity_0
    must_fail_with: "invalid_query"
    must_not: "status 200 or a rooms array in the body"
  - input_class: invalid_json_body
    must_fail_with: "invalid_json"
    must_not: "status 200 or a rooms array in the body"
assertion_summary:
  - "the success body holds a rooms array ordered by the numeric id suffix"
  - "the two rejected classes answer status 400 with the declared code"
  - "no status outside 200, 400 appears for any class"
feasibility: feasible
```

### room-booking-api:CTR-003

```yaml
id: room-booking-api:CTR-003
template: Contract
obligation: "POST /rooms/:roomId/bookings answers 201, 400 invalid_json, 400 invalid_booking, 404 room_not_found, 409 room_busy or 422 over_capacity and no other status; an invalid field wins over attendees above capacity, attendees above capacity wins over an overlapping interval, and an unknown room wins over an invalid JSON body."
input_classes:
  - name: typical
    input: "room r1 capacity 10 holds no booking; POST /rooms/r1/bookings with body {\"title\": \"Standup\", \"start\": \"2026-11-02T09:30:00Z\", \"end\": \"2026-11-02T10:00:00Z\", \"attendees\": 4}"
    expected: "status 201; body {\"id\": \"b1\", \"roomId\": \"r1\", \"title\": \"Standup\", \"start\": \"2026-11-02T09:30:00Z\", \"end\": \"2026-11-02T10:00:00Z\", \"attendees\": 4}"
  - name: empty
    input: "POST /rooms/r1/bookings with a body of zero length and Content-Type application/json"
    expected: "invalid_json; status 400"
  - name: boundary_attendees_equal_capacity
    input: "room r1 capacity 10; POST /rooms/r1/bookings with attendees 10 and otherwise valid fields"
    expected: "status 201; body attendees 10"
  - name: boundary_title_80_chars
    input: "POST /rooms/r1/bookings with a title of 80 characters and otherwise valid fields"
    expected: "status 201; body title equal to the value given"
  - name: invalid_unknown_room
    input: "POST /rooms/r9/bookings with an otherwise valid body"
    expected: "room_not_found; status 404"
  - name: invalid_title
    input: "POST /rooms/r1/bookings with body {\"title\": \"\", \"start\": \"2026-11-02T09:30:00Z\", \"end\": \"2026-11-02T10:00:00Z\", \"attendees\": 4}"
    expected: "invalid_booking; status 400"
  - name: invalid_over_capacity
    input: "room r1 capacity 4; POST /rooms/r1/bookings with attendees 5 and otherwise valid fields"
    expected: "over_capacity; status 422"
  - name: invalid_overlapping_interval
    input: "r1 holds 2026-11-02T09:00:00Z to 2026-11-02T10:00:00Z; POST /rooms/r1/bookings for 2026-11-02T09:30:00Z to 2026-11-02T10:30:00Z"
    expected: "room_busy; status 409; body conflictingBookingId"
  - name: invalid_json_body
    input: "POST /rooms/r1/bookings with body { and Content-Type application/json"
    expected: "invalid_json; status 400"
  - name: invalid_precedence_title_over_capacity
    input: "room r1 capacity 4; POST /rooms/r1/bookings with title \"\" and attendees 5"
    expected: "invalid_booking; status 400"
  - name: invalid_precedence_capacity_over_busy
    input: "room r1 capacity 4 holds 2026-11-02T09:00:00Z to 2026-11-02T10:00:00Z; POST /rooms/r1/bookings for 2026-11-02T09:30:00Z to 2026-11-02T10:30:00Z with attendees 5"
    expected: "over_capacity; status 422"
  - name: invalid_precedence_unknown_room_over_json
    input: "POST /rooms/r9/bookings with body { and Content-Type application/json"
    expected: "room_not_found; status 404"
negative_oracle:
  - input_class: invalid_unknown_room
    must_fail_with: "room_not_found"
    must_not: "error invalid_booking, error invalid_json, or a new booking id"
  - input_class: invalid_overlapping_interval
    must_fail_with: "room_busy"
    must_not: "a room_busy body without conflictingBookingId or a stored booking"
  - input_class: invalid_precedence_title_over_capacity
    must_fail_with: "invalid_booking"
    must_not: "error over_capacity or status 422"
  - input_class: invalid_precedence_capacity_over_busy
    must_fail_with: "over_capacity"
    must_not: "error room_busy or status 409"
  - input_class: invalid_precedence_unknown_room_over_json
    must_fail_with: "room_not_found"
    must_not: "error invalid_json or status 400"
assertion_summary:
  - "every class returns exactly one status of the six declared by the contract"
  - "a 201 body holds exactly id, roomId, title, start, end and attendees"
  - "a room_busy body holds error room_busy and conflictingBookingId"
  - "GET /rooms/r1/bookings after a rejected class holds no new booking"
feasibility: feasible
```

### room-booking-api:CTR-004

```yaml
id: room-booking-api:CTR-004
template: Contract
obligation: "GET /rooms/:roomId/bookings answers 200, 400 invalid_query, 404 room_not_found or 400 invalid_json, the query is validated before the room is resolved, and a body that is not valid JSON is rejected with invalid_json."
input_classes:
  - name: typical
    input: "room r1 holds b1 2026-11-02T09:00:00Z to 10:00:00Z; GET /rooms/r1/bookings with no query and no body"
    expected: "status 200; body bookings array holding b1"
  - name: empty
    input: "room r1 holds no booking; GET /rooms/r1/bookings with no query"
    expected: "status 200; body {\"bookings\": []}"
  - name: boundary_complete_window
    input: "GET /rooms/r1/bookings?from=2026-11-02T09:00:00Z&to=2026-11-02T10:00:00Z"
    expected: "status 200; body bookings array holding b1 only"
  - name: invalid_only_from
    input: "GET /rooms/r1/bookings?from=2026-11-02T09:00:00Z"
    expected: "invalid_query; status 400"
  - name: invalid_only_to
    input: "GET /rooms/r1/bookings?to=2026-11-02T10:00:00Z"
    expected: "invalid_query; status 400"
  - name: invalid_time_unparseable
    input: "GET /rooms/r1/bookings?from=banana&to=2026-11-02T12:00:00Z"
    expected: "invalid_query; status 400"
  - name: invalid_unknown_room
    input: "no room r9 exists; GET /rooms/r9/bookings with no query"
    expected: "room_not_found; status 404"
  - name: invalid_query_on_unknown_room
    input: "no room r9 exists; GET /rooms/r9/bookings?from=2026-11-02T09:00:00Z"
    expected: "invalid_query; status 400"
  - name: invalid_json_body
    input: "GET /rooms/r1/bookings with body { and Content-Type application/json"
    expected: "invalid_json; status 400"
negative_oracle:
  - input_class: invalid_only_from
    must_fail_with: "invalid_query"
    must_not: "status 200 or a bookings array in the body"
  - input_class: invalid_query_on_unknown_room
    must_fail_with: "invalid_query"
    must_not: "error room_not_found or status 404"
  - input_class: invalid_unknown_room
    must_fail_with: "room_not_found"
    must_not: "status 200 or an empty bookings array presented as success"
  - input_class: invalid_json_body
    must_fail_with: "invalid_json"
    must_not: "status 200 or a bookings array in the body"
assertion_summary:
  - "every class returns exactly one status of the four declared by the contract"
  - "the success body holds a bookings array ordered by start and then booking id"
  - "the query is decided before the room id is resolved"
feasibility: feasible
```

### room-booking-api:CTR-005

```yaml
id: room-booking-api:CTR-005
template: Contract
obligation: "DELETE /bookings/:bookingId answers 204, 404 booking_not_found or 400 invalid_json and no other status, and a request whose body is not valid JSON is answered invalid_json."
input_classes:
  - name: typical
    input: "booking b1 exists; DELETE /bookings/b1 with no body"
    expected: "status 204; no response body; no Content-Type header"
  - name: empty
    input: "no booking b7 exists; DELETE /bookings/b7 with no body"
    expected: "booking_not_found; status 404"
  - name: boundary_already_deleted
    input: "DELETE /bookings/b1 a second time after b1 was removed"
    expected: "booking_not_found; status 404"
  - name: invalid_json_body
    input: "booking b1 exists; DELETE /bookings/b1 with body { and Content-Type application/json"
    expected: "invalid_json; status 400"
negative_oracle:
  - input_class: empty
    must_fail_with: "booking_not_found"
    must_not: "status 204 or any other 2xx status"
  - input_class: invalid_json_body
    must_fail_with: "invalid_json"
    must_not: "status 204 or the removal of b1"
assertion_summary:
  - "the 204 response carries no response body and no Content-Type header"
  - "the error responses hold a JSON body with the error field"
  - "GET /rooms/r1/bookings after the invalid-body request still holds b1"
feasibility: feasible
```

### room-booking-api:CTR-006

```yaml
id: room-booking-api:CTR-006
template: Contract
obligation: "GET /availability answers 200, 400 invalid_query or 400 invalid_json and no other status, and a request whose body is not valid JSON is answered invalid_json."
input_classes:
  - name: typical
    input: "r1 capacity 4 and r2 capacity 10 exist with no booking; GET /availability?start=2026-11-02T10:00:00Z&end=2026-11-02T11:00:00Z&attendees=4"
    expected: "status 200; body rooms array r1, r2"
  - name: empty
    input: "GET /availability?start=2026-11-02T10:00:00Z&end=2026-11-02T11:00:00Z with attendees absent"
    expected: "invalid_query; status 400"
  - name: invalid_end_missing
    input: "GET /availability?start=2026-11-02T10:00:00Z&attendees=2"
    expected: "invalid_query; status 400"
  - name: invalid_unparseable_time
    input: "GET /availability?start=banana&end=2026-11-02T11:00:00Z&attendees=2"
    expected: "invalid_query; status 400"
  - name: invalid_end_not_after_start
    input: "GET /availability?start=2026-11-02T10:00:00Z&end=2026-11-02T10:00:00Z&attendees=2"
    expected: "invalid_query; status 400"
  - name: invalid_attendees_not_integer
    input: "GET /availability?start=2026-11-02T10:00:00Z&end=2026-11-02T11:00:00Z&attendees=1.5"
    expected: "invalid_query; status 400"
  - name: invalid_json_body
    input: "GET /availability?start=2026-11-02T10:00:00Z&end=2026-11-02T11:00:00Z&attendees=4 with body { and Content-Type application/json"
    expected: "invalid_json; status 400"
negative_oracle:
  - input_class: empty
    must_fail_with: "invalid_query"
    must_not: "status 200 or a rooms array in the body"
  - input_class: invalid_end_missing
    must_fail_with: "invalid_query"
    must_not: "status 200 or a rooms array in the body"
  - input_class: invalid_json_body
    must_fail_with: "invalid_json"
    must_not: "status 200 or a rooms array in the body"
assertion_summary:
  - "every class returns exactly one status of the three declared by the contract"
  - "the success body holds a rooms array ordered by capacity ascending then by the numeric id suffix"
  - "the rejected responses carry no rooms array"
feasibility: feasible
```

### room-booking-api:CTR-007

```yaml
id: room-booking-api:CTR-007
template: Contract
obligation: "An undeclared path answers 404 not_found, a declared path with an undeclared method answers 405 method_not_allowed, and a request whose body is not valid JSON answers 400 invalid_json before either."
input_classes:
  - name: typical
    input: "GET /nope with no body"
    expected: "not_found; status 404"
  - name: empty
    input: "POST /nope with a body of zero length and no Content-Type header"
    expected: "not_found; status 404"
  - name: boundary_undeclared_path_undeclared_method
    input: "PATCH /rooms/r1 with no body"
    expected: "not_found; status 404"
  - name: boundary_declared_path_unsupported_method
    input: "PUT /rooms with no body"
    expected: "method_not_allowed; status 405"
  - name: boundary_declared_path_declared_method
    input: "POST /rooms with body {\"name\": \"Lab\", \"capacity\": 10}"
    expected: "status 201 with the created room"
  - name: boundary_undeclared_path_invalid_json
    input: "PATCH /nope with body { and Content-Type application/json"
    expected: "invalid_json; status 400"
negative_oracle:
  - input_class: typical
    must_fail_with: "not_found"
    must_not: "status 405 or status 200"
  - input_class: boundary_undeclared_path_undeclared_method
    must_fail_with: "not_found"
    must_not: "error method_not_allowed or status 405"
  - input_class: boundary_declared_path_unsupported_method
    must_fail_with: "method_not_allowed"
    must_not: "error not_found or status 404"
  - input_class: boundary_undeclared_path_invalid_json
    must_fail_with: "invalid_json"
    must_not: "error not_found, error method_not_allowed, or status 404"
assertion_summary:
  - "the undeclared path answers status 404 with a JSON body holding error not_found for every method tried"
  - "the declared path with an undeclared method answers status 405 with error method_not_allowed"
  - "an invalid JSON body answers status 400 with error invalid_json before the path or method is decided"
  - "the declared path with its declared method is answered outside the two route errors"
feasibility: feasible
```

### room-booking-api:INV-001

```yaml
id: room-booking-api:INV-001
template: Invariant
obligation: "Every room created through POST /rooms carries the id r(N+1), where N is the number of rooms already created, so room ids always ascend in creation order and are never reused."
input_classes:
  - name: empty
    input: "GET /rooms on a store with no room, then POST /rooms with {\"name\": \"Lab\", \"capacity\": 10}"
    expected: "status 200 with an empty rooms array; then status 201 with id r1"
  - name: typical
    input: "three rooms created in sequence with valid bodies"
    expected: "ids r1, r2, r3 in that order"
  - name: boundary_first_room
    input: "the first POST /rooms of a process"
    expected: "status 201; body id r1"
  - name: boundary_tenth_room
    input: "ten rooms created in order; GET /rooms"
    expected: "the tenth created room carries id r10"
  - name: boundary_after_rejected_creation
    input: "POST /rooms with capacity 0, then POST /rooms with body {\"name\": \"Lab\", \"capacity\": 10}"
    expected: "invalid_room with status 400, then status 201 with id r1"
negative_oracle:
  - input_class: boundary_after_rejected_creation
    must_fail_with: "invalid_room"
    must_not: "status 201 for the rejected request or the next created room carrying id r2"
assertion_summary:
  - "every created room id matches r followed by its position in creation order"
  - "no created room carries id r0"
  - "no two rooms ever carry the same id"
  - "a rejected creation consumes no id"
feasibility: feasible
```

### room-booking-api:INV-002

```yaml
id: room-booking-api:INV-002
template: Invariant
obligation: "Every booking created through POST /rooms/:roomId/bookings carries the id b(N+1), where N is the number of bookings already created in the process across all rooms, so booking ids always ascend in creation order and a deleted id is never handed out again."
input_classes:
  - name: typical
    input: "two bookings created in room r1"
    expected: "ids b1 then b2"
  - name: empty
    input: "the first booking of a fresh process in room r1"
    expected: "status 201; body id b1"
  - name: boundary_two_rooms
    input: "one booking created in r1, then one booking in r2 with an otherwise valid body"
    expected: "the r2 booking carries id b2"
  - name: boundary_after_deletion
    input: "booking b1 created, DELETE /bookings/b1, then a new booking in r1"
    expected: "the new booking carries id b2, never b1"
  - name: boundary_after_rejected_booking
    input: "booking b1 created, an overlapping request answered room_busy, then a valid booking"
    expected: "the valid booking carries id b2"
negative_oracle:
  - input_class: boundary_after_rejected_booking
    must_fail_with: "room_busy"
    must_not: "status 201 for the overlapping request or the next created booking carrying id b3"
assertion_summary:
  - "every created booking id matches b followed by its position in the creation order of the whole process"
  - "the first booking of a second room never receives id b1"
  - "a booking created after a deletion receives an id above every id handed out before"
feasibility: feasible
```

### room-booking-api:INV-003

```yaml
id: room-booking-api:INV-003
template: Invariant
obligation: "No two stored bookings of one room have overlapping half-open intervals at any point in time, and bookings of different rooms never conflict."
input_classes:
  - name: typical
    input: "r1: booking 2026-11-02T09:00:00Z to 2026-11-02T10:00:00Z, then booking 2026-11-02T10:00:00Z to 2026-11-02T11:00:00Z"
    expected: "both requests answer status 201; GET /rooms/r1/bookings holds both bookings"
  - name: empty
    input: "room r1 holds no booking; GET /rooms/r1/bookings"
    expected: "status 200; body {\"bookings\": []}"
  - name: boundary_identical_interval_two_rooms
    input: "the same interval 2026-11-02T09:00:00Z to 2026-11-02T10:00:00Z booked in r1 and in r2"
    expected: "both requests answer status 201; each room holds the booking"
  - name: invalid_nested_interval
    input: "r1 holds 2026-11-02T09:00:00Z to 2026-11-02T11:00:00Z; a request for 2026-11-02T09:30:00Z to 2026-11-02T10:30:00Z in r1"
    expected: "room_busy; status 409"
negative_oracle:
  - input_class: invalid_nested_interval
    must_fail_with: "room_busy"
    must_not: "status 201 or a second booking stored in r1"
assertion_summary:
  - "for every pair of bookings in one room, the half-open intervals do not intersect"
  - "a booking ending exactly at another start is stored alongside it"
  - "the same interval is stored independently in two different rooms"
  - "a rejected overlapping request leaves the room with exactly the bookings it had before"
feasibility: feasible
```

### room-booking-api:INV-004

```yaml
id: room-booking-api:INV-004
template: Invariant
obligation: "Every error response parses as JSON, holds error with a code from the closed snake_case set, and a room_busy response also holds conflictingBookingId."
input_classes:
  - name: typical
    input: "POST /rooms with body {\"name\": \"\", \"capacity\": 10}"
    expected: "status 400; body {\"error\": \"invalid_room\"}"
  - name: empty
    input: "POST /rooms with a body of zero length and Content-Type application/json"
    expected: "status 400; body {\"error\": \"invalid_json\"}"
  - name: boundary_invalid_query
    input: "GET /rooms?minCapacity=0"
    expected: "status 400; body {\"error\": \"invalid_query\"}"
  - name: boundary_invalid_booking
    input: "POST /rooms/r1/bookings with title \"\" and otherwise valid fields"
    expected: "status 400; body {\"error\": \"invalid_booking\"}"
  - name: boundary_room_name_taken
    input: "room \"Lab\" exists; POST /rooms with {\"name\": \"lAb\", \"capacity\": 10}"
    expected: "status 409; body {\"error\": \"room_name_taken\"}"
  - name: boundary_room_busy
    input: "r1 holds 2026-11-02T09:00:00Z to 2026-11-02T10:00:00Z; POST /rooms/r1/bookings for 2026-11-02T09:30:00Z to 2026-11-02T10:30:00Z"
    expected: "status 409; body {\"error\": \"room_busy\", \"conflictingBookingId\": \"b1\"}"
  - name: boundary_room_not_found
    input: "POST /rooms/r9/bookings with an otherwise valid body"
    expected: "status 404; body {\"error\": \"room_not_found\"}"
  - name: boundary_booking_not_found
    input: "no booking b7 exists; DELETE /bookings/b7"
    expected: "status 404; body {\"error\": \"booking_not_found\"}"
  - name: boundary_not_found
    input: "GET /nope"
    expected: "status 404; body {\"error\": \"not_found\"}"
  - name: boundary_method_not_allowed
    input: "PUT /rooms"
    expected: "status 405; body {\"error\": \"method_not_allowed\"}"
  - name: boundary_over_capacity
    input: "room r1 capacity 4; POST /rooms/r1/bookings with attendees 5 and otherwise valid fields"
    expected: "status 422; body {\"error\": \"over_capacity\"}"
negative_oracle:
  - input_class: typical
    must_fail_with: "invalid_room"
    must_not: "a body without the error field or a code outside the closed set"
  - input_class: boundary_room_busy
    must_fail_with: "room_busy"
    must_not: "a room_busy body without conflictingBookingId"
  - input_class: boundary_method_not_allowed
    must_fail_with: "method_not_allowed"
    must_not: "a code spelled in camelCase or a plain-text body"
  - input_class: boundary_over_capacity
    must_fail_with: "over_capacity"
    must_not: "a body carrying only a free-text message"
assertion_summary:
  - "every 4xx response body parses as JSON"
  - "the error value of every error response is one of the eleven codes of section 2, written in snake_case"
  - "the room_busy body also holds conflictingBookingId naming a booking id"
feasibility: feasible
```

### room-booking-api:INV-005

```yaml
id: room-booking-api:INV-005
template: Invariant
obligation: "Every response that carries a body carries the header Content-Type with the value application/json, and the 204 response of DELETE /bookings/:bookingId carries no body."
input_classes:
  - name: typical
    input: "GET /rooms on a store with one room"
    expected: "status 200; header Content-Type application/json"
  - name: empty
    input: "GET /rooms on a store with no room"
    expected: "status 200; header Content-Type application/json; body {\"rooms\": []}"
  - name: boundary_error_response
    input: "POST /rooms with body {\"name\": \"\", \"capacity\": 10}"
    expected: "status 400; header Content-Type application/json"
  - name: boundary_route_error_response
    input: "GET /nope"
    expected: "status 404; header Content-Type application/json"
  - name: boundary_204_response
    input: "booking b1 exists; DELETE /bookings/b1"
    expected: "status 204; no response body and no Content-Type header"
negative_oracle:
  - input_class: boundary_error_response
    must_fail_with: "invalid_room"
    must_not: "a Content-Type other than application/json, in particular text/html, or a missing Content-Type header"
assertion_summary:
  - "every response with a body carries Content-Type with the value application/json"
  - "the 204 response carries no body and no Content-Type header"
feasibility: feasible
```

### room-booking-api:INV-006

```yaml
id: room-booking-api:INV-006
template: Invariant
obligation: "A process started after a previous process stopped serves an empty store with no room and no booking, and assigns room ids from r1 again."
input_classes:
  - name: typical
    input: "start a process, POST /rooms with a valid body, stop the process, start a new process, GET /rooms"
    expected: "status 200; body {\"rooms\": []}"
  - name: empty
    input: "start a process and immediately stop it, then start a new process and GET /rooms"
    expected: "status 200; body {\"rooms\": []}"
  - name: boundary_restart_with_bookings
    input: "start a process, create a room and a booking, stop it, start a new process, GET /rooms/r1/bookings"
    expected: "room_not_found; status 404"
negative_oracle:
  - input_class: boundary_restart_with_bookings
    must_fail_with: "room_not_found"
    must_not: "status 200 or a bookings array holding the booking created before the restart"
assertion_summary:
  - "the new process answers GET /rooms with an empty rooms array"
  - "the new process answers GET /rooms/r1/bookings with status 404 and error room_not_found"
  - "the first room created by the new process carries id r1"
feasibility: feasible
```

### room-booking-api:INV-007

```yaml
id: room-booking-api:INV-007
template: Invariant
obligation: "The key set of every response object equals the documented key set: a room object holds exactly id, name and capacity, a booking object exactly id, roomId, title, start, end and attendees, a list response exactly rooms or bookings, and an error response the error field plus conflictingBookingId for room_busy only."
input_classes:
  - name: typical
    input: "POST /rooms with body {\"name\": \"Lab\", \"capacity\": 10}"
    expected: "status 201; body keys exactly id, name, capacity"
  - name: empty
    input: "GET /rooms on a store with no room"
    expected: "status 200; body key set exactly rooms"
  - name: boundary_booking_object
    input: "POST /rooms/r1/bookings with a valid booking body"
    expected: "status 201; body keys exactly id, roomId, title, start, end, attendees"
  - name: boundary_list_response
    input: "GET /rooms/r1/bookings with no query"
    expected: "status 200; body key set exactly bookings"
  - name: boundary_error_response
    input: "POST /rooms with body {\"name\": \"\", \"capacity\": 10}"
    expected: "status 400; body key set exactly error"
  - name: boundary_room_busy_response
    input: "r1 holds 2026-11-02T09:00:00Z to 2026-11-02T10:00:00Z; overlapping booking request"
    expected: "status 409; body keys exactly error and conflictingBookingId"
negative_oracle:
  - input_class: typical
    must_fail_with: "invalid_room"
    must_not: "a room body carrying a key outside id, name and capacity or a key set missing one of id, name, capacity"
  - input_class: boundary_room_busy_response
    must_fail_with: "room_busy"
    must_not: "a room_busy body carrying a key outside error and conflictingBookingId or missing conflictingBookingId"
assertion_summary:
  - "the key set of each response object equals the documented key set exactly, with no extra and no missing key"
  - "a booking object always holds attendees and roomId"
  - "only a room_busy error body carries conflictingBookingId"
feasibility: feasible
```

### room-booking-api:INV-008

```yaml
id: room-booking-api:INV-008
template: Invariant
obligation: "Every start and end string the API returns on a booking ends with an upper-case Z and denotes a whole minute."
input_classes:
  - name: typical
    input: "POST /rooms/r1/bookings with start 2026-11-02T09:30:00Z and end 2026-11-02T10:00:00Z"
    expected: "status 201; body start ends with Z and lies on a whole minute"
  - name: empty
    input: "GET /rooms/r1/bookings on a room with no booking"
    expected: "status 200; body {\"bookings\": []}"
  - name: boundary_minute_form_short
    input: "POST /rooms/r1/bookings with start 2026-11-02T09:30Z and end 2026-11-02T10:00Z"
    expected: "status 201; body start ends with Z and denotes 09:30"
  - name: boundary_minute_form_with_millis
    input: "POST /rooms/r1/bookings with start 2026-11-02T09:30:00.000Z and end 2026-11-02T10:00:00.000Z"
    expected: "status 201; body start ends with Z and denotes 09:30"
  - name: invalid_time_offset
    input: "POST /rooms/r1/bookings with start 2026-11-02T10:30:00+01:00 and end 2026-11-02T12:00:00Z"
    expected: "invalid_booking; status 400"
  - name: invalid_time_seconds
    input: "POST /rooms/r1/bookings with start 2026-11-02T09:30:45Z and end 2026-11-02T10:00:00Z"
    expected: "invalid_booking; status 400"
negative_oracle:
  - input_class: invalid_time_offset
    must_fail_with: "invalid_booking"
    must_not: "status 201 or a returned start carrying a numeric offset"
  - input_class: invalid_time_seconds
    must_fail_with: "invalid_booking"
    must_not: "status 201 or a returned start off a whole minute"
assertion_summary:
  - "every returned start and end value ends with an upper-case Z"
  - "every returned start and end value denotes a whole minute, with no seconds or milliseconds"
  - "the returned value denotes the same instant as the value given"
feasibility: feasible
```

### room-booking-api:SCN-001

```yaml
id: room-booking-api:SCN-001
template: Scenario
obligation: "The delete frees the interval and the booking created afterwards receives the next booking id."
input_classes:
  - name: typical
    input: "on an empty store: POST /rooms with {\"name\": \"Lab\", \"capacity\": 10}, POST /rooms/r1/bookings for 2026-11-02T09:00:00Z to 2026-11-02T10:00:00Z, DELETE /bookings/b1, POST /rooms/r1/bookings for the same interval"
    expected: "statuses 201, 201, 204, 201; ids r1, b1, then b2"
  - name: empty
    input: "GET /rooms before the first POST /rooms of the sequence"
    expected: "status 200; body {\"rooms\": []}"
  - name: boundary_delete_blocks_availability
    input: "GET /availability?start=2026-11-02T09:00:00Z&end=2026-11-02T09:30:00Z&attendees=5 after the booking and before the DELETE"
    expected: "status 200; body {\"rooms\": []}"
  - name: invalid_rebooking_while_busy
    input: "POST /rooms/r1/bookings for 2026-11-02T09:00:00Z to 2026-11-02T10:00:00Z a second time before the DELETE"
    expected: "room_busy; status 409"
negative_oracle:
  - input_class: invalid_rebooking_while_busy
    must_fail_with: "room_busy"
    must_not: "status 201 or a second booking stored in r1"
assertion_summary:
  - "the DELETE response is status 204 with no body"
  - "GET /rooms/r1/bookings after the DELETE holds no booking"
  - "the booking created after the DELETE carries id b2, never b1"
  - "GET /availability for the freed window holds no room before the DELETE and holds r1 after it"
observable_sequence:
  - "POST /rooms with name \"Lab\" and capacity 10 -> status 201 with body id r1"
  - "POST /rooms/r1/bookings for 2026-11-02T09:00:00Z to 2026-11-02T10:00:00Z -> status 201 with body id b1"
  - "GET /availability?start=2026-11-02T09:00:00Z&end=2026-11-02T09:30:00Z&attendees=5 -> status 200 with a rooms array holding no room"
  - "DELETE /bookings/b1 -> status 204 with no body"
  - "POST /rooms/r1/bookings for 2026-11-02T09:00:00Z to 2026-11-02T10:00:00Z -> status 201 with body id b2"
feasibility: feasible
```

### room-booking-api:SCN-002

```yaml
id: room-booking-api:SCN-002
template: Scenario
obligation: "A conflict in one room never blocks a booking in another room, and booking ids stay global across rooms."
input_classes:
  - name: typical
    input: "rooms r1 and r2 with capacity 4 exist; book 2026-11-02T09:00:00Z to 2026-11-02T10:00:00Z with 4 attendees in r1, repeat it in r1, then book the same interval in r2"
    expected: "statuses 201 b1, 409 room_busy naming b1, 201 b2"
  - name: empty
    input: "GET /rooms/r2/bookings before any booking"
    expected: "status 200; body {\"bookings\": []}"
  - name: boundary_same_interval_twice_one_room
    input: "the second booking of r1 for the same interval"
    expected: "room_busy; status 409; body conflictingBookingId b1"
negative_oracle:
  - input_class: boundary_same_interval_twice_one_room
    must_fail_with: "room_busy"
    must_not: "status 201, a stored second booking in r1, or a booking id above b1 handed out for the rejected request"
assertion_summary:
  - "the booking of r2 for the same interval answers status 201, never room_busy"
  - "the booking of r2 carries id b2, so ids are global across rooms"
  - "GET /rooms/r2/bookings holds b2 only"
  - "GET /rooms/r1/bookings holds b1 only"
observable_sequence:
  - "POST /rooms/r1/bookings for 2026-11-02T09:00:00Z to 2026-11-02T10:00:00Z with 4 attendees -> status 201 with body id b1"
  - "the same request repeated in r1 -> status 409 with body error room_busy and conflictingBookingId b1"
  - "the same request in r2 -> status 201 with body id b2"
  - "GET /rooms/r2/bookings -> status 200 with a bookings array holding b2 only"
feasibility: feasible
```

### room-booking-api:SCN-003

```yaml
id: room-booking-api:SCN-003
template: Scenario
obligation: "A process started after a previous process stopped serves an empty store and restarts room ids at r1."
input_classes:
  - name: typical
    input: "start a process, POST /rooms with a valid body, stop the process, start a new process on the same port, GET /rooms"
    expected: "status 200; body {\"rooms\": []}"
  - name: boundary_restart_with_bookings
    input: "a stopped process held one room and one booking; the new process answers GET /rooms/r1/bookings"
    expected: "room_not_found; status 404"
  - name: boundary_room_ids_restart_at_r1
    input: "the new process then receives POST /rooms with body {\"name\": \"Lab\", \"capacity\": 10}"
    expected: "status 201; body id r1"
negative_oracle:
  - input_class: boundary_restart_with_bookings
    must_fail_with: "room_not_found"
    must_not: "status 200 or a bookings array holding the booking created before the restart"
assertion_summary:
  - "the new process answers GET /rooms with an empty rooms array"
  - "the new process answers GET /rooms/r1/bookings with status 404 and error room_not_found"
  - "the first room created by the new process carries id r1"
observable_sequence:
  - "start a process, POST /rooms and POST /rooms/r1/bookings, then stop the process -> the previous process held one room and one booking"
  - "start a new process on the same port and GET /rooms -> status 200 with a rooms array holding no room"
  - "GET /rooms/r1/bookings on the new process -> status 404 with body error room_not_found"
  - "POST /rooms on the new process with name \"Lab\" and capacity 10 -> status 201 with body id r1"
feasibility: feasible
```

### room-booking-api:NFR-001

```yaml
id: room-booking-api:NFR-001
template: NFR
obligation: "The build command and the test command each exit with code 0 on a clean checkout."
input_classes:
  - name: typical
    input: "on a clean checkout after npm install: run npm run build, then npm test"
    expected: "the build command exits 0 and the test command exits 0"
  - name: empty
    input: "a clean checkout with no build output present before the build command runs"
    expected: "the build produces its compiled output and exits 0; the test command then exits 0"
  - name: boundary_port_0
    input: "the suite started with PORT=0"
    expected: "the test command exits 0 and the server binds an ephemeral port"
assertion_summary:
  - "the exit code of the build command is 0"
  - "the exit code of the test command is 0"
  - "the report of the test command shows no failing test"
feasibility: feasible
```

### room-booking-api:POL-001

```yaml
id: room-booking-api:POL-001
template: Policy
obligation: "Every failure injected at the boundary yields a JSON error body whose error field holds a code of the closed set of section 2, a room_busy failure also names conflictingBookingId, and no failure is reported as free text."
input_classes:
  - name: typical
    input: "POST /rooms with body {\"name\": \"\", \"capacity\": 10}"
    expected: "status 400; body {\"error\": \"invalid_room\"}"
  - name: empty
    input: "POST /rooms with a body of zero length and Content-Type application/json"
    expected: "status 400; body {\"error\": \"invalid_json\"}"
  - name: boundary_invalid_query
    input: "GET /availability?start=2026-11-02T10:00:00Z&end=2026-11-02T11:00:00Z with attendees absent"
    expected: "status 400; body {\"error\": \"invalid_query\"}"
  - name: boundary_invalid_booking
    input: "POST /rooms/r1/bookings with title \"\" and otherwise valid fields"
    expected: "status 400; body {\"error\": \"invalid_booking\"}"
  - name: boundary_room_name_taken
    input: "room \"Lab\" exists; POST /rooms with {\"name\": \"lAb\", \"capacity\": 10}"
    expected: "status 409; body {\"error\": \"room_name_taken\"}"
  - name: boundary_room_busy
    input: "r1 holds 2026-11-02T09:00:00Z to 2026-11-02T10:00:00Z; POST /rooms/r1/bookings for 2026-11-02T09:30:00Z to 2026-11-02T10:30:00Z"
    expected: "status 409; body {\"error\": \"room_busy\", \"conflictingBookingId\": \"b1\"}"
  - name: boundary_room_not_found
    input: "POST /rooms/r9/bookings with an otherwise valid body"
    expected: "status 404; body {\"error\": \"room_not_found\"}"
  - name: boundary_booking_not_found
    input: "no booking b7 exists; DELETE /bookings/b7"
    expected: "status 404; body {\"error\": \"booking_not_found\"}"
  - name: boundary_not_found
    input: "GET /nope"
    expected: "status 404; body {\"error\": \"not_found\"}"
  - name: boundary_method_not_allowed
    input: "PUT /rooms"
    expected: "status 405; body {\"error\": \"method_not_allowed\"}"
  - name: boundary_over_capacity
    input: "room r1 capacity 4; POST /rooms/r1/bookings with attendees 5 and otherwise valid fields"
    expected: "status 422; body {\"error\": \"over_capacity\"}"
negative_oracle:
  - input_class: typical
    must_fail_with: "invalid_room"
    must_not: "a body without the error field or a body written as free text"
  - input_class: empty
    must_fail_with: "invalid_json"
    must_not: "a plain-text body or a status without an error code"
  - input_class: boundary_invalid_query
    must_fail_with: "invalid_query"
    must_not: "a body without the error field"
  - input_class: boundary_invalid_booking
    must_fail_with: "invalid_booking"
    must_not: "a code spelled in camelCase"
  - input_class: boundary_room_name_taken
    must_fail_with: "room_name_taken"
    must_not: "a plain-text body or a missing error field"
  - input_class: boundary_room_busy
    must_fail_with: "room_busy"
    must_not: "a room_busy body without conflictingBookingId"
  - input_class: boundary_room_not_found
    must_fail_with: "room_not_found"
    must_not: "a body without the error field"
  - input_class: boundary_booking_not_found
    must_fail_with: "booking_not_found"
    must_not: "a body without the error field"
  - input_class: boundary_not_found
    must_fail_with: "not_found"
    must_not: "an HTML body or a plain-text body"
  - input_class: boundary_method_not_allowed
    must_fail_with: "method_not_allowed"
    must_not: "a body without the error field"
  - input_class: boundary_over_capacity
    must_fail_with: "over_capacity"
    must_not: "a body carrying a free-text message instead of the code"
assertion_summary:
  - "every injected failure answers a status of 400, 404, 405, 409 or 422 with a JSON body holding the error field"
  - "each error value is one of the eleven codes of section 2 in snake_case"
  - "the room_busy body also holds conflictingBookingId"
  - "no error response body carries a natural-language message in place of the code"
feasibility: feasible
```

### room-booking-api:POL-002

```yaml
id: room-booking-api:POL-002
template: Policy
obligation: "Every invalid input class returns its documented 4xx status, the store after the call equals the store before it, and the process keeps serving further requests."
input_classes:
  - name: typical
    input: "POST /rooms with body { and Content-Type application/json"
    expected: "status 400; body {\"error\": \"invalid_json\"}; the next request is served"
  - name: empty
    input: "GET /availability?start=2026-11-02T10:00:00Z&end=2026-11-02T11:00:00Z with attendees absent"
    expected: "status 400; body {\"error\": \"invalid_query\"}; the next request is served"
  - name: boundary_invalid_field_room
    input: "POST /rooms with body {\"name\": \"Lab\", \"capacity\": 0}"
    expected: "status 400; body {\"error\": \"invalid_room\"}; GET /rooms is unchanged"
  - name: boundary_invalid_field_booking
    input: "room r1 capacity 4; POST /rooms/r1/bookings with attendees 5 and otherwise valid fields"
    expected: "status 422; body {\"error\": \"over_capacity\"}; GET /rooms/r1/bookings is unchanged"
  - name: boundary_unknown_id
    input: "no booking b7 exists; DELETE /bookings/b7"
    expected: "status 404; body {\"error\": \"booking_not_found\"}; the next request is served"
negative_oracle:
  - input_class: typical
    must_fail_with: "invalid_json"
    must_not: "a process exit, a dropped connection without a response, or a new room"
  - input_class: empty
    must_fail_with: "invalid_query"
    must_not: "status 200 or a room list returned for the missing parameter"
  - input_class: boundary_invalid_field_room
    must_fail_with: "invalid_room"
    must_not: "a room created by the rejected request"
  - input_class: boundary_invalid_field_booking
    must_fail_with: "over_capacity"
    must_not: "a booking created by the rejected request"
  - input_class: boundary_unknown_id
    must_fail_with: "booking_not_found"
    must_not: "a booking removed by the rejected request"
assertion_summary:
  - "every invalid class answers its documented 4xx status with a JSON error body"
  - "GET /rooms and GET /rooms/r1/bookings before and after each rejected request return identical bodies"
  - "a valid request issued after each rejected request is answered normally"
  - "no request terminates the process and no request closes the connection without a response"
feasibility: feasible
```

## 4. Infeasible candidates

none
