# Verification design: room-booking-api

## 1. Scope

Eligible approved records: Behavior 22 (BEH-001..BEH-022), Scenario 3 (SCN-001..SCN-003), NFR 1 (NFR-001), Contract 7 (CTR-001..CTR-007), Invariant 5 (INV-001..INV-005), Policy 2 (POL-001, POL-002). Total 40 blocks, one per ID, in spec order.

Skipped, with reason:
- `room-booking-api:SUR-001` — Surface, not a verifiable record (governs boundary form only).
- Partition block — structural, no test obligation.
- `room-booking-api:BL-001` — BrownfieldBaseline, not a requirement.
- `room-booking-api:CON-001`..`CON-006` — Constraint records, not in the eligible template set; their toolchain and in-memory effects are covered through NFR-001, BEH-017..BEH-022, SCN-003 and INV-005.
- `room-booking-api:OQ-001`..`OQ-012` — Open-Q records, not requirements.
- `room-booking-api:ASM-001`..`ASM-012` — ASSUMPTION records; their defaults are folded into the input classes of the Behavior records they name.

## 2. Error oracle

| error code | observable signal | source record |
| --- | --- | --- |
| invalid_json | HTTP 400, body is a JSON object whose `error` field is `invalid_json`, Content-Type application/json | CTR-001, CTR-002, CTR-003, CTR-004, CTR-005, CTR-006, CTR-007, POL-001 |
| not_found | HTTP 404, body is a JSON object whose `error` field is `not_found` | CTR-001, CTR-002, CTR-003, CTR-004, CTR-005, CTR-006, CTR-007, POL-001 |
| method_not_allowed | HTTP 405, body is a JSON object whose `error` field is `method_not_allowed` | CTR-001, CTR-002, CTR-003, CTR-004, CTR-005, CTR-006, CTR-007, POL-001 |
| invalid_room | HTTP 400, body is a JSON object whose `error` field is `invalid_room` | CTR-002, POL-001 |
| room_name_taken | HTTP 409, body is a JSON object whose `error` field is `room_name_taken` | CTR-002, POL-001 |
| invalid_query | HTTP 400, body is a JSON object whose `error` field is `invalid_query` | CTR-003, CTR-005, CTR-007, POL-001 |
| room_not_found | HTTP 404, body is a JSON object whose `error` field is `room_not_found` | CTR-004, CTR-005, POL-001 |
| invalid_booking | HTTP 400, body is a JSON object whose `error` field is `invalid_booking` | CTR-004, POL-001 |
| over_capacity | HTTP 422, body is a JSON object whose `error` field is `over_capacity` | CTR-004, POL-001 |
| room_busy | HTTP 409, body is a JSON object whose `error` field is `room_busy` and which also carries `conflictingBookingId` | CTR-004, POL-001 |
| booking_not_found | HTTP 404, body is a JSON object whose `error` field is `booking_not_found` | CTR-006, POL-001 |

No other code is defined by the spec; no block uses a code outside this table.

## 3. Blocks

### room-booking-api:BEH-001

```yaml
id: "room-booking-api:BEH-001"
template: "Behavior"
obligation: "a valid room body on an empty server returns 201 and exactly one room with id r1 is listed by a later GET /rooms"
input_classes:
  - name: "typical"
    input: "POST /rooms with body {\"name\":\"Aurora\",\"capacity\":4} against a freshly started server"
    expected: "HTTP 201, Content-Type application/json, body {\"id\":\"r1\",\"name\":\"Aurora\",\"capacity\":4}"
  - name: "empty"
    input: "GET /rooms on the freshly started server before any creation"
    expected: "HTTP 200, body {\"rooms\":[]}"
  - name: "typical_second_room"
    input: "POST /rooms with body {\"name\":\"Borealis\",\"capacity\":4} after r1 exists"
    expected: "HTTP 201, body carries id r2"
  - name: "boundary_name_length_1"
    input: "POST /rooms with body {\"name\":\"A\",\"capacity\":4}"
    expected: "HTTP 201, body echoes name A"
  - name: "boundary_name_length_40"
    input: "POST /rooms with a 40-character name and capacity 4"
    expected: "HTTP 201, body echoes the 40-character name"
  - name: "boundary_capacity_1"
    input: "POST /rooms with body {\"name\":\"Aurora\",\"capacity\":1}"
    expected: "HTTP 201, body echoes capacity 1"
  - name: "boundary_capacity_100"
    input: "POST /rooms with body {\"name\":\"Aurora\",\"capacity\":100}"
    expected: "HTTP 201, body echoes capacity 100"
  - name: "invalid_capacity_101"
    input: "POST /rooms with body {\"name\":\"Aurora\",\"capacity\":101}"
    expected: "invalid_room; HTTP 400"
negative_oracle:
  - input_class: "invalid_capacity_101"
    must_fail_with: "invalid_room"
    must_not: "HTTP 201 and a room object carrying an id in the response body"
assertion_summary:
  - "the creation response status is 201 and its Content-Type is application/json"
  - "the creation response body holds id r1 plus the submitted name and capacity"
  - "GET /rooms afterwards returns 200 with exactly one room and that room has id r1"
feasibility: "feasible"
```

### room-booking-api:BEH-002

```yaml
id: "room-booking-api:BEH-002"
template: "Behavior"
obligation: "every invalid name or capacity value returns 400 invalid_room and leaves the room count unchanged"
input_classes:
  - name: "typical"
    input: "POST /rooms with body {\"name\":\"Aurora\",\"capacity\":4}"
    expected: "HTTP 201 with id r1"
  - name: "empty"
    input: "POST /rooms with body {\"name\":\"\",\"capacity\":1}"
    expected: "invalid_room; HTTP 400"
  - name: "invalid_whitespace_name"
    input: "POST /rooms with body {\"name\":\"   \",\"capacity\":1}"
    expected: "invalid_room; HTTP 400"
  - name: "boundary_name_length_41"
    input: "POST /rooms with a 41-character name and capacity 1"
    expected: "invalid_room; HTTP 400"
  - name: "boundary_capacity_0"
    input: "POST /rooms with body {\"name\":\"Aurora\",\"capacity\":0}"
    expected: "invalid_room; HTTP 400"
  - name: "boundary_capacity_1"
    input: "POST /rooms with body {\"name\":\"Aurora\",\"capacity\":1}"
    expected: "HTTP 201"
  - name: "boundary_capacity_100"
    input: "POST /rooms with body {\"name\":\"Aurora\",\"capacity\":100}"
    expected: "HTTP 201"
  - name: "boundary_capacity_101"
    input: "POST /rooms with body {\"name\":\"Aurora\",\"capacity\":101}"
    expected: "invalid_room; HTTP 400"
  - name: "invalid_fractional_capacity"
    input: "POST /rooms with body {\"name\":\"Aurora\",\"capacity\":2.5}"
    expected: "invalid_room; HTTP 400"
  - name: "invalid_non_string_name"
    input: "POST /rooms with body {\"name\":7,\"capacity\":4}"
    expected: "invalid_room; HTTP 400"
  - name: "invalid_missing_capacity"
    input: "POST /rooms with body {\"name\":\"Aurora\"}"
    expected: "invalid_room; HTTP 400"
negative_oracle:
  - input_class: "empty"
    must_fail_with: "invalid_room"
    must_not: "HTTP 201 and a new entry in GET /rooms"
  - input_class: "invalid_whitespace_name"
    must_fail_with: "invalid_room"
    must_not: "HTTP 201 and a new entry in GET /rooms"
  - input_class: "boundary_name_length_41"
    must_fail_with: "invalid_room"
    must_not: "HTTP 201 and a new entry in GET /rooms"
  - input_class: "boundary_capacity_0"
    must_fail_with: "invalid_room"
    must_not: "HTTP 201 and a new entry in GET /rooms"
  - input_class: "boundary_capacity_101"
    must_fail_with: "invalid_room"
    must_not: "HTTP 201 and a new entry in GET /rooms"
  - input_class: "invalid_fractional_capacity"
    must_fail_with: "invalid_room"
    must_not: "HTTP 201 and a new entry in GET /rooms"
  - input_class: "invalid_non_string_name"
    must_fail_with: "invalid_room"
    must_not: "HTTP 201 and a new entry in GET /rooms"
  - input_class: "invalid_missing_capacity"
    must_fail_with: "invalid_room"
    must_not: "HTTP 201 and a new entry in GET /rooms"
assertion_summary:
  - "each invalid submission answers 400 with the error field equal to invalid_room"
  - "the number of rooms listed by GET /rooms is identical before and after each rejected submission"
feasibility: "feasible"
```

### room-booking-api:BEH-003

```yaml
id: "room-booking-api:BEH-003"
template: "Behavior"
obligation: "a room name equal to an existing name ignoring letter case returns 409 room_name_taken and creates no room"
input_classes:
  - name: "typical"
    input: "POST /rooms with body {\"name\":\"Borealis\",\"capacity\":4} after Aurora exists"
    expected: "HTTP 201 with id r2"
  - name: "empty"
    input: "POST /rooms with body {\"name\":\"Aurora\",\"capacity\":4} on a server with no room at all"
    expected: "HTTP 201 with id r1"
  - name: "boundary_identical_case"
    input: "POST /rooms with body {\"name\":\"Aurora\",\"capacity\":9} after Aurora exists"
    expected: "room_name_taken; HTTP 409"
  - name: "boundary_lower_case"
    input: "POST /rooms with body {\"name\":\"aurora\",\"capacity\":9} after Aurora exists"
    expected: "room_name_taken; HTTP 409"
  - name: "boundary_upper_case"
    input: "POST /rooms with body {\"name\":\"AURORA\",\"capacity\":9} after Aurora exists"
    expected: "room_name_taken; HTTP 409"
negative_oracle:
  - input_class: "boundary_lower_case"
    must_fail_with: "room_name_taken"
    must_not: "HTTP 201 and a second room in the GET /rooms list"
  - input_class: "boundary_upper_case"
    must_fail_with: "room_name_taken"
    must_not: "HTTP 201 and a second room in the GET /rooms list"
assertion_summary:
  - "the duplicate submission answers 409 with the error field equal to room_name_taken"
  - "GET /rooms lists the same single room with id r1 before and after the rejected submission"
feasibility: "feasible"
```

### room-booking-api:BEH-004

```yaml
id: "room-booking-api:BEH-004"
template: "Behavior"
obligation: "GET /rooms returns every room ordered by id using numeric id order"
input_classes:
  - name: "empty"
    input: "GET /rooms on a freshly started server"
    expected: "HTTP 200, body {\"rooms\":[]}"
  - name: "boundary_nine_then_ten"
    input: "GET /rooms after creating rooms up to r10"
    expected: "HTTP 200 with the ids r1 through r10 in that order, r10 last"
  - name: "typical"
    input: "GET /rooms after creating twelve rooms in order"
    expected: "HTTP 200 with 12 rooms whose ids are r1, r2, ..., r12 in that order"
  - name: "invalid_min_capacity_nonnumeric"
    input: "GET /rooms?minCapacity=abc"
    expected: "invalid_query; HTTP 400"
negative_oracle:
  - input_class: "invalid_min_capacity_nonnumeric"
    must_fail_with: "invalid_query"
    must_not: "HTTP 200 and a rooms envelope"
assertion_summary:
  - "the list holds exactly one entry per created room, with no duplicate id"
  - "the room after r9 is r10, so id order is numeric and not character order"
  - "the response status is 200 and the body is an object with a rooms field holding an array"
feasibility: "feasible"
```

### room-booking-api:BEH-005

```yaml
id: "room-booking-api:BEH-005"
template: "Behavior"
obligation: "minCapacity keeps exactly the rooms with capacity at least the value and rejects values that are not positive integers with 400 invalid_query"
input_classes:
  - name: "typical"
    input: "GET /rooms?minCapacity=5 with r1 capacity 4, r2 capacity 10, r3 capacity 40"
    expected: "HTTP 200 with rooms r2 and r3 only, ordered r2 then r3"
  - name: "empty"
    input: "GET /rooms with no query on the same three rooms"
    expected: "HTTP 200 with r1, r2, r3"
  - name: "boundary_equal_to_capacity"
    input: "GET /rooms?minCapacity=10 with r1 capacity 4, r2 capacity 10, r3 capacity 40"
    expected: "HTTP 200 with r2 and r3, r2 included because its capacity equals the value"
  - name: "boundary_above_every_capacity"
    input: "GET /rooms?minCapacity=41"
    expected: "HTTP 200 with body {\"rooms\":[]}"
  - name: "invalid_zero"
    input: "GET /rooms?minCapacity=0"
    expected: "invalid_query; HTTP 400"
  - name: "invalid_negative"
    input: "GET /rooms?minCapacity=-1"
    expected: "invalid_query; HTTP 400"
  - name: "invalid_fractional"
    input: "GET /rooms?minCapacity=2.5"
    expected: "invalid_query; HTTP 400"
  - name: "invalid_non_numeric"
    input: "GET /rooms?minCapacity=ten"
    expected: "invalid_query; HTTP 400"
negative_oracle:
  - input_class: "invalid_zero"
    must_fail_with: "invalid_query"
    must_not: "HTTP 200 and a rooms envelope containing r1"
  - input_class: "invalid_negative"
    must_fail_with: "invalid_query"
    must_not: "HTTP 200 and a rooms envelope containing r1"
  - input_class: "invalid_fractional"
    must_fail_with: "invalid_query"
    must_not: "HTTP 200 and a rooms envelope"
  - input_class: "invalid_non_numeric"
    must_fail_with: "invalid_query"
    must_not: "HTTP 200 and a rooms envelope"
assertion_summary:
  - "no returned room has a capacity below the requested value"
  - "the returned rooms are ordered by id"
  - "the value above every capacity answers 200 with an empty rooms array, not 400"
feasibility: "feasible"
```

### room-booking-api:BEH-006

```yaml
id: "room-booking-api:BEH-006"
template: "Behavior"
obligation: "a valid booking body returns 201 and the booking is listed by GET /rooms/r1/bookings with the next booking id"
input_classes:
  - name: "typical"
    input: "POST /rooms/r1/bookings with body {\"title\":\"Standup\",\"start\":\"2026-11-02T09:00:00Z\",\"end\":\"2026-11-02T09:30:00Z\",\"attendees\":6} on a server with no booking"
    expected: "HTTP 201, Content-Type application/json, body {\"id\":\"b1\",\"roomId\":\"r1\",\"title\":\"Standup\",\"start\":\"2026-11-02T09:00:00Z\",\"end\":\"2026-11-02T09:30:00Z\",\"attendees\":6}"
  - name: "empty"
    input: "GET /rooms/r1/bookings on the same server before any booking"
    expected: "HTTP 200, body {\"bookings\":[]}"
  - name: "typical_later_booking"
    input: "a second booking of 10:00 to 10:30 in r1 after b1 exists"
    expected: "HTTP 201 with id b2"
  - name: "boundary_attendees_1"
    input: "POST /rooms/r1/bookings with attendees 1 and title Standup"
    expected: "HTTP 201, body echoes attendees 1"
  - name: "boundary_attendees_equal_capacity"
    input: "POST /rooms/r1/bookings with attendees 10 against room capacity 10"
    expected: "HTTP 201, body echoes attendees 10"
  - name: "invalid_over_capacity"
    input: "POST /rooms/r1/bookings with attendees 11 against room capacity 10"
    expected: "over_capacity; HTTP 422"
  - name: "invalid_unknown_room"
    input: "POST /rooms/r99/bookings with a valid booking body"
    expected: "room_not_found; HTTP 404"
negative_oracle:
  - input_class: "invalid_over_capacity"
    must_fail_with: "over_capacity"
    must_not: "HTTP 201 and a new entry in GET /rooms/r1/bookings"
  - input_class: "invalid_unknown_room"
    must_fail_with: "room_not_found"
    must_not: "HTTP 201 and a booking object in the response body"
assertion_summary:
  - "the creation response status is 201 with Content-Type application/json"
  - "GET /rooms/r1/bookings afterwards lists an entry whose id, roomId, title, start, end and attendees equal the submitted values"
  - "the assigned id is b1 for the first booking and b2 for the next booking"
feasibility: "feasible"
```

### room-booking-api:BEH-007

```yaml
id: "room-booking-api:BEH-007"
template: "Behavior"
obligation: "a booking request for an unknown room returns 404 room_not_found and creates nothing"
input_classes:
  - name: "typical"
    input: "POST /rooms/r99/bookings with a valid booking body when no room has id r99"
    expected: "room_not_found; HTTP 404"
  - name: "typical_existing_room"
    input: "the same body sent to POST /rooms/r1/bookings when r1 exists"
    expected: "HTTP 201"
  - name: "boundary_non_numeric_room_id"
    input: "POST /rooms/room-99/bookings with a valid booking body"
    expected: "room_not_found; HTTP 404"
negative_oracle:
  - input_class: "typical"
    must_fail_with: "room_not_found"
    must_not: "HTTP 201 and a booking object in the response body"
  - input_class: "boundary_non_numeric_room_id"
    must_fail_with: "room_not_found"
    must_not: "HTTP 201 and a booking object in the response body"
assertion_summary:
  - "the unknown-room response status is 404 and the body error field is room_not_found"
  - "no booking exists after the rejected request, observable through an empty GET /rooms/r1/bookings on the existing room"
feasibility: "feasible"
```

### room-booking-api:BEH-008

```yaml
id: "room-booking-api:BEH-008"
template: "Behavior"
obligation: "each invalid title, time, ordering and duration value returns 400 invalid_booking and creates no booking"
input_classes:
  - name: "typical"
    input: "POST /rooms/r1/bookings with title Standup, start 2026-11-02T09:00:00Z, end 2026-11-02T09:30:00Z, attendees 1"
    expected: "HTTP 201"
  - name: "empty_title"
    input: "POST /rooms/r1/bookings with title \"\" and valid times"
    expected: "invalid_booking; HTTP 400"
  - name: "invalid_whitespace_title"
    input: "POST /rooms/r1/bookings with title \"   \" and valid times"
    expected: "invalid_booking; HTTP 400"
  - name: "boundary_title_length_80"
    input: "POST /rooms/r1/bookings with an 80-character title and valid times"
    expected: "HTTP 201"
  - name: "boundary_title_length_81"
    input: "POST /rooms/r1/bookings with an 81-character title and valid times"
    expected: "invalid_booking; HTTP 400"
  - name: "invalid_time_without_z"
    input: "POST /rooms/r1/bookings with start 2026-11-02T09:30:00 and end 2026-11-02T10:00:00Z"
    expected: "invalid_booking; HTTP 400"
  - name: "invalid_time_with_offset"
    input: "POST /rooms/r1/bookings with start 2026-11-02T09:30:00+00:00 and end 2026-11-02T10:00:00Z"
    expected: "invalid_booking; HTTP 400"
  - name: "boundary_time_with_seconds"
    input: "POST /rooms/r1/bookings with start 2026-11-02T09:30:30Z and end 2026-11-02T10:00:00Z"
    expected: "invalid_booking; HTTP 400"
  - name: "boundary_time_with_millis"
    input: "POST /rooms/r1/bookings with start 2026-11-02T09:30:00.500Z and end 2026-11-02T10:00:00Z"
    expected: "invalid_booking; HTTP 400"
  - name: "invalid_unparsable_time"
    input: "POST /rooms/r1/bookings with start not-a-time and end 2026-11-02T10:00:00Z"
    expected: "invalid_booking; HTTP 400"
  - name: "boundary_end_equal_start"
    input: "POST /rooms/r1/bookings with start 2026-11-02T09:00:00Z and end 2026-11-02T09:00:00Z"
    expected: "invalid_booking; HTTP 400"
  - name: "boundary_end_before_start"
    input: "POST /rooms/r1/bookings with start 2026-11-02T10:00:00Z and end 2026-11-02T09:59:00Z"
    expected: "invalid_booking; HTTP 400"
  - name: "boundary_duration_8_hours"
    input: "POST /rooms/r1/bookings with start 2026-11-02T09:00:00Z and end 2026-11-02T17:00:00Z"
    expected: "HTTP 201, the 8-hour bound is inclusive"
  - name: "boundary_duration_8_hours_plus_1"
    input: "POST /rooms/r1/bookings with start 2026-11-02T09:00:00Z and end 2026-11-02T17:01:00Z"
    expected: "invalid_booking; HTTP 400"
  - name: "invalid_attendees_zero"
    input: "POST /rooms/r1/bookings with attendees 0 and valid times"
    expected: "invalid_booking; HTTP 400"
  - name: "duplicate_extra_field"
    input: "POST /rooms/r1/bookings with a valid field set plus the unknown field color red"
    expected: "HTTP 201, unknown fields are ignored"
negative_oracle:
  - input_class: "empty_title"
    must_fail_with: "invalid_booking"
    must_not: "HTTP 201 and a new entry in GET /rooms/r1/bookings"
  - input_class: "invalid_whitespace_title"
    must_fail_with: "invalid_booking"
    must_not: "HTTP 201 and a new entry in GET /rooms/r1/bookings"
  - input_class: "boundary_title_length_81"
    must_fail_with: "invalid_booking"
    must_not: "HTTP 201 and a new entry in GET /rooms/r1/bookings"
  - input_class: "invalid_time_without_z"
    must_fail_with: "invalid_booking"
    must_not: "HTTP 201 and a stored booking"
  - input_class: "invalid_time_with_offset"
    must_fail_with: "invalid_booking"
    must_not: "HTTP 201 and a stored booking"
  - input_class: "boundary_time_with_seconds"
    must_fail_with: "invalid_booking"
    must_not: "HTTP 201 and a stored booking whose start carries seconds"
  - input_class: "boundary_time_with_millis"
    must_fail_with: "invalid_booking"
    must_not: "HTTP 201 and a stored booking whose start carries milliseconds"
  - input_class: "invalid_unparsable_time"
    must_fail_with: "invalid_booking"
    must_not: "HTTP 201 and a stored booking"
  - input_class: "boundary_end_equal_start"
    must_fail_with: "invalid_booking"
    must_not: "HTTP 201 and a stored booking"
  - input_class: "boundary_end_before_start"
    must_fail_with: "invalid_booking"
    must_not: "HTTP 201 and a stored booking"
  - input_class: "boundary_duration_8_hours_plus_1"
    must_fail_with: "invalid_booking"
    must_not: "HTTP 201 and a stored booking"
  - input_class: "invalid_attendees_zero"
    must_fail_with: "invalid_booking"
    must_not: "HTTP 201 and a stored booking"
assertion_summary:
  - "every rejected submission answers 400 with the error field equal to invalid_booking"
  - "the number of bookings listed by GET /rooms/r1/bookings is unchanged by every rejected submission"
  - "the 8-hour duration answers 201 and the 8-hour-and-one-minute duration answers 400"
feasibility: "feasible"
```

### room-booking-api:BEH-009

```yaml
id: "room-booking-api:BEH-009"
template: "Behavior"
obligation: "attendees above the room capacity return 422 over_capacity while attendees equal to the capacity return 201"
input_classes:
  - name: "boundary_equal_capacity"
    input: "POST /rooms/r2/bookings with attendees 4 against room r2 capacity 4"
    expected: "HTTP 201"
  - name: "typical"
    input: "POST /rooms/r2/bookings with attendees 5 against room r2 capacity 4"
    expected: "over_capacity; HTTP 422"
  - name: "invalid_attendees_zero"
    input: "POST /rooms/r2/bookings with attendees 0 against room r2 capacity 4"
    expected: "invalid_booking; HTTP 400"
negative_oracle:
  - input_class: "typical"
    must_fail_with: "over_capacity"
    must_not: "HTTP 201 and a new entry in GET /rooms/r2/bookings"
assertion_summary:
  - "the over-capacity response status is 422 and the body error field is over_capacity"
  - "the at-capacity response status is 201 and the booking is listed by GET /rooms/r2/bookings"
  - "attendees 0 answers 400 invalid_booking and not 422 over_capacity"
feasibility: "feasible"
```

### room-booking-api:BEH-010

```yaml
id: "room-booking-api:BEH-010"
template: "Behavior"
obligation: "an interval overlapping an existing booking of the same room returns 409 room_busy whose conflictingBookingId is the earliest-starting overlapping booking"
input_classes:
  - name: "typical"
    input: "POST /rooms/r1/bookings for 2026-11-02T10:30:00Z to 2026-11-02T11:30:00Z when b1 spans 10:00 to 11:00 and b2 spans 11:00 to 12:00"
    expected: "room_busy; HTTP 409, body {\"error\":\"room_busy\",\"conflictingBookingId\":\"b1\"}"
  - name: "empty"
    input: "the same interval posted to a room with no booking"
    expected: "HTTP 201"
  - name: "boundary_overlap_at_end"
    input: "POST /rooms/r1/bookings for 2026-11-02T10:30:00Z to 2026-11-02T11:30:00Z against b1 alone"
    expected: "room_busy; HTTP 409 naming b1"
  - name: "boundary_spans_two_conflicts"
    input: "POST /rooms/r1/bookings for 2026-11-02T09:30:00Z to 2026-11-02T12:30:00Z against b1 and b2"
    expected: "room_busy; HTTP 409 naming b1, the earliest-starting conflict"
  - name: "typical_other_room_free"
    input: "an overlapping request against another room with free capacity"
    expected: "HTTP 201"
  - name: "boundary_starts_at_existing_end"
    input: "POST /rooms/r1/bookings for 2026-11-02T12:00:00Z to 2026-11-02T12:30:00Z"
    expected: "HTTP 201"
negative_oracle:
  - input_class: "typical"
    must_fail_with: "room_busy"
    must_not: "HTTP 201 and a stored booking"
  - input_class: "boundary_spans_two_conflicts"
    must_fail_with: "room_busy"
    must_not: "a conflictingBookingId equal to b2 or absent from the body"
assertion_summary:
  - "the conflict body is a JSON object with error equal to room_busy and a conflictingBookingId field equal to the earliest-starting overlapping booking id"
  - "GET /rooms/r1/bookings lists exactly the bookings that existed before the rejected request"
  - "a request against another room is created with 201"
feasibility: "feasible"
```

### room-booking-api:BEH-011

```yaml
id: "room-booking-api:BEH-011"
template: "Behavior"
obligation: "an interval sharing only an endpoint with an existing booking is accepted while an interval sharing one minute is rejected with 409 room_busy"
input_classes:
  - name: "boundary_touching_at_end"
    input: "POST /rooms/r1/bookings for 2026-11-02T11:00:00Z to 2026-11-02T11:30:00Z when b1 spans 10:00 to 11:00"
    expected: "HTTP 201"
  - name: "boundary_touching_at_start"
    input: "POST /rooms/r1/bookings for 2026-11-02T09:30:00Z to 2026-11-02T10:00:00Z when b1 spans 10:00 to 11:00"
    expected: "HTTP 201"
  - name: "boundary_sharing_one_minute"
    input: "POST /rooms/r1/bookings for 2026-11-02T10:59:00Z to 2026-11-02T11:30:00Z"
    expected: "room_busy; HTTP 409 naming b1"
  - name: "typical"
    input: "GET /rooms/r1/bookings after the two touching bookings were created"
    expected: "HTTP 200 with all three bookings listed"
negative_oracle:
  - input_class: "boundary_sharing_one_minute"
    must_fail_with: "room_busy"
    must_not: "HTTP 201 and a stored booking"
assertion_summary:
  - "both touching requests answer 201 and both bookings appear in GET /rooms/r1/bookings"
  - "the one-minute overlap answers 409 with error equal to room_busy"
feasibility: "feasible"
```

### room-booking-api:BEH-012

```yaml
id: "room-booking-api:BEH-012"
template: "Behavior"
obligation: "the booking list is ordered by start and, for equal starts, by ascending booking id"
input_classes:
  - name: "empty"
    input: "GET /rooms/r1/bookings for a room with no booking"
    expected: "HTTP 200, body {\"bookings\":[]}"
  - name: "typical"
    input: "GET /rooms/r1/bookings after creating b1 10:00-11:00, b2 09:00-09:30, b3 10:00-10:30"
    expected: "HTTP 200 with ids in the order b2, b1, b3"
  - name: "boundary_equal_start_times"
    input: "GET /rooms/r1/bookings when b1 and b3 both start at 10:00"
    expected: "b1 appears before b3"
  - name: "invalid_unknown_room"
    input: "GET /rooms/r99/bookings"
    expected: "room_not_found; HTTP 404"
negative_oracle:
  - input_class: "invalid_unknown_room"
    must_fail_with: "room_not_found"
    must_not: "HTTP 200 with an empty bookings array"
assertion_summary:
  - "the listed ids follow ascending start time and, for equal starts, ascending id"
  - "no booking of another room appears in the list"
  - "an unknown room answers 404 room_not_found instead of an empty list"
feasibility: "feasible"
```

### room-booking-api:BEH-013

```yaml
id: "room-booking-api:BEH-013"
template: "Behavior"
obligation: "a from/to window returns exactly the bookings whose half-open interval intersects the window, an incomplete window returns 400 invalid_query and an unknown room returns 404 room_not_found"
input_classes:
  - name: "typical"
    input: "GET /rooms/r1/bookings?from=2026-11-02T10:30:00Z&to=2026-11-02T11:30:00Z when b1 spans 10:00 to 11:00"
    expected: "HTTP 200 with b1 listed"
  - name: "boundary_window_inside_booking"
    input: "GET /rooms/r1/bookings?from=2026-11-02T10:00:00Z&to=2026-11-02T10:30:00Z"
    expected: "HTTP 200 with b1 listed"
  - name: "boundary_window_ends_at_booking_start"
    input: "GET /rooms/r1/bookings?from=2026-11-02T09:00:00Z&to=2026-11-02T10:00:00Z"
    expected: "HTTP 200 with body {\"bookings\":[]}"
  - name: "boundary_window_starts_at_booking_end"
    input: "GET /rooms/r1/bookings?from=2026-11-02T11:00:00Z&to=2026-11-02T12:00:00Z"
    expected: "HTTP 200 with body {\"bookings\":[]}"
  - name: "invalid_only_from"
    input: "GET /rooms/r1/bookings?from=2026-11-02T10:00:00Z"
    expected: "invalid_query; HTTP 400"
  - name: "invalid_unknown_room"
    input: "GET /rooms/r99/bookings?from=2026-11-02T10:00:00Z&to=2026-11-02T12:00:00Z"
    expected: "room_not_found; HTTP 404"
negative_oracle:
  - input_class: "invalid_only_from"
    must_fail_with: "invalid_query"
    must_not: "HTTP 200 and an unfiltered bookings envelope"
  - input_class: "invalid_unknown_room"
    must_fail_with: "room_not_found"
    must_not: "HTTP 200 with an empty bookings array"
assertion_summary:
  - "a booking that only touches the window boundary is absent from the response"
  - "a booking intersecting the window interior is present in the response"
  - "the response envelope is an object with a bookings array"
feasibility: "feasible"
```

### room-booking-api:BEH-014

```yaml
id: "room-booking-api:BEH-014"
template: "Behavior"
obligation: "an incomplete or invalid booking window returns 400 invalid_query and an unknown room returns 404 room_not_found"
input_classes:
  - name: "typical"
    input: "GET /rooms/r1/bookings?from=2026-11-02T10:00:00Z&to=2026-11-02T12:00:00Z"
    expected: "HTTP 200"
  - name: "invalid_only_from"
    input: "GET /rooms/r1/bookings?from=2026-11-02T10:00:00Z"
    expected: "invalid_query; HTTP 400"
  - name: "invalid_only_to"
    input: "GET /rooms/r1/bookings?to=2026-11-02T12:00:00Z"
    expected: "invalid_query; HTTP 400"
  - name: "boundary_to_equal_from"
    input: "GET /rooms/r1/bookings?from=2026-11-02T11:00:00Z&to=2026-11-02T11:00:00Z"
    expected: "invalid_query; HTTP 400"
  - name: "boundary_to_before_from"
    input: "GET /rooms/r1/bookings?from=2026-11-02T11:00:00Z&to=2026-11-02T10:00:00Z"
    expected: "invalid_query; HTTP 400"
  - name: "invalid_unparsable_time"
    input: "GET /rooms/r1/bookings?from=yesterday&to=today"
    expected: "invalid_query; HTTP 400"
  - name: "invalid_unknown_room"
    input: "GET /rooms/r99/bookings"
    expected: "room_not_found; HTTP 404"
negative_oracle:
  - input_class: "invalid_only_from"
    must_fail_with: "invalid_query"
    must_not: "HTTP 200 and an unfiltered bookings envelope"
  - input_class: "invalid_only_to"
    must_fail_with: "invalid_query"
    must_not: "HTTP 200 and an unfiltered bookings envelope"
  - input_class: "boundary_to_equal_from"
    must_fail_with: "invalid_query"
    must_not: "HTTP 200 and an empty bookings envelope"
  - input_class: "boundary_to_before_from"
    must_fail_with: "invalid_query"
    must_not: "HTTP 200 and a bookings envelope"
  - input_class: "invalid_unparsable_time"
    must_fail_with: "invalid_query"
    must_not: "HTTP 200 and a bookings envelope"
  - input_class: "invalid_unknown_room"
    must_fail_with: "room_not_found"
    must_not: "HTTP 200 with an empty bookings array"
assertion_summary:
  - "each invalid window answers 400 with the error field equal to invalid_query"
  - "the unknown room answers 404 with the error field equal to room_not_found, not a 200 list"
  - "the complete valid window answers 200 with a bookings array"
feasibility: "feasible"
```

### room-booking-api:BEH-015

```yaml
id: "room-booking-api:BEH-015"
template: "Behavior"
obligation: "a delete of a known booking returns 204, removes the booking and frees its interval for a later booking"
input_classes:
  - name: "typical"
    input: "DELETE /bookings/b1 when r1 holds b1 from 10:00 to 11:00"
    expected: "HTTP 204 with an empty body"
  - name: "boundary_delete_only_booking"
    input: "GET /rooms/r1/bookings after the delete of its only booking"
    expected: "HTTP 200 with body {\"bookings\":[]}"
  - name: "typical_rebook_after_delete"
    input: "POST /rooms/r1/bookings for 2026-11-02T10:00:00Z to 2026-11-02T11:00:00Z after the delete"
    expected: "HTTP 201 with a new booking id"
  - name: "invalid_second_delete"
    input: "DELETE /bookings/b1 a second time"
    expected: "booking_not_found; HTTP 404"
  - name: "invalid_get_booking"
    input: "GET /bookings/b1 on an existing booking"
    expected: "method_not_allowed; HTTP 405"
negative_oracle:
  - input_class: "invalid_second_delete"
    must_fail_with: "booking_not_found"
    must_not: "HTTP 204"
  - input_class: "invalid_get_booking"
    must_fail_with: "method_not_allowed"
    must_not: "HTTP 200 with a booking body"
assertion_summary:
  - "the delete answers 204 with a zero-length body"
  - "b1 is absent from the GET /rooms/r1/bookings list after the delete"
  - "the freed interval answers 201 on a new booking instead of 409 room_busy"
feasibility: "feasible"
```

### room-booking-api:BEH-016

```yaml
id: "room-booking-api:BEH-016"
template: "Behavior"
obligation: "deleting an unknown booking id returns 404 booking_not_found and changes no state"
input_classes:
  - name: "typical"
    input: "DELETE /bookings/b99 when no booking has id b99"
    expected: "booking_not_found; HTTP 404"
  - name: "typical_existing_booking"
    input: "DELETE /bookings/b1 when b1 exists"
    expected: "HTTP 204"
  - name: "boundary_unknown_after_delete"
    input: "DELETE /bookings/b99 while room r1 holds b1"
    expected: "booking_not_found; HTTP 404 and b1 still listed by GET /rooms/r1/bookings"
negative_oracle:
  - input_class: "typical"
    must_fail_with: "booking_not_found"
    must_not: "HTTP 204"
  - input_class: "boundary_unknown_after_delete"
    must_fail_with: "booking_not_found"
    must_not: "HTTP 204 and the removal of b1 from GET /rooms/r1/bookings"
assertion_summary:
  - "the unknown delete answers 404 with the error field equal to booking_not_found"
  - "the booking list of the room is identical before and after the rejected delete"
feasibility: "feasible"
```

### room-booking-api:BEH-017

```yaml
id: "room-booking-api:BEH-017"
template: "Behavior"
obligation: "availability returns the rooms with capacity at least attendees and no overlapping booking, ordered by capacity then id"
input_classes:
  - name: "typical"
    input: "GET /availability?start=2026-11-02T10:30:00Z&end=2026-11-02T11:30:00Z&attendees=6 with r1 capacity 4, r2 capacity 10 busy 10:00-11:00, r3 capacity 10 free, r4 capacity 8 free"
    expected: "HTTP 200, body {\"rooms\":[r4, r3]}"
  - name: "empty"
    input: "GET /availability?start=2026-11-02T12:00:00Z&end=2026-11-02T13:00:00Z&attendees=6"
    expected: "HTTP 200, body {\"rooms\":[r4, r2, r3]}"
  - name: "boundary_capacity_equal_attendees"
    input: "GET /availability?start=2026-11-02T12:00:00Z&end=2026-11-02T13:00:00Z&attendees=4"
    expected: "HTTP 200 with r1 listed among the rooms"
  - name: "boundary_attendees_above_every_capacity"
    input: "GET /availability?start=2026-11-02T12:00:00Z&end=2026-11-02T13:00:00Z&attendees=11"
    expected: "HTTP 200 with body {\"rooms\":[]}"
  - name: "invalid_attendees_zero"
    input: "GET /availability?start=2026-11-02T12:00:00Z&end=2026-11-02T13:00:00Z&attendees=0"
    expected: "invalid_query; HTTP 400"
negative_oracle:
  - input_class: "typical"
    must_fail_with: "UNDEFINED_CODE"
    must_not: "r2 in the rooms array"
  - input_class: "invalid_attendees_zero"
    must_fail_with: "invalid_query"
    must_not: "HTTP 200 and a rooms envelope"
assertion_summary:
  - "no returned room has a capacity below attendees"
  - "no returned room holds a booking overlapping the queried window"
  - "the rooms array is ordered by capacity ascending and then by numeric id, so r4 precedes r3 when both are free"
  - "a request that excludes every room answers 200 with an empty rooms array"
feasibility: "feasible"
```

### room-booking-api:BEH-018

```yaml
id: "room-booking-api:BEH-018"
template: "Behavior"
obligation: "any missing or invalid availability parameter returns 400 invalid_query while a complete valid query returns 200"
input_classes:
  - name: "typical"
    input: "GET /availability?start=2026-11-02T10:00:00Z&end=2026-11-02T11:00:00Z&attendees=2"
    expected: "HTTP 200"
  - name: "empty"
    input: "GET /availability with no query at all"
    expected: "invalid_query; HTTP 400"
  - name: "invalid_missing_attendees"
    input: "GET /availability?start=2026-11-02T10:00:00Z&end=2026-11-02T11:00:00Z"
    expected: "invalid_query; HTTP 400"
  - name: "invalid_missing_start"
    input: "GET /availability?end=2026-11-02T11:00:00Z&attendees=2"
    expected: "invalid_query; HTTP 400"
  - name: "invalid_missing_end"
    input: "GET /availability?start=2026-11-02T10:00:00Z&attendees=2"
    expected: "invalid_query; HTTP 400"
  - name: "boundary_end_equal_start"
    input: "GET /availability?start=2026-11-02T10:00:00Z&end=2026-11-02T10:00:00Z&attendees=2"
    expected: "invalid_query; HTTP 400"
  - name: "boundary_end_before_start"
    input: "GET /availability?start=2026-11-02T11:00:00Z&end=2026-11-02T10:00:00Z&attendees=2"
    expected: "invalid_query; HTTP 400"
  - name: "invalid_time_without_z"
    input: "GET /availability?start=2026-11-02T10:00:00Z&end=2026-11-02T10:00:00&attendees=2"
    expected: "invalid_query; HTTP 400"
  - name: "boundary_attendees_zero"
    input: "GET /availability?start=2026-11-02T10:00:00Z&end=2026-11-02T11:00:00Z&attendees=0"
    expected: "invalid_query; HTTP 400"
  - name: "invalid_attendees_fractional"
    input: "GET /availability?start=2026-11-02T10:00:00Z&end=2026-11-02T11:00:00Z&attendees=2.5"
    expected: "invalid_query; HTTP 400"
negative_oracle:
  - input_class: "empty"
    must_fail_with: "invalid_query"
    must_not: "HTTP 200 and a rooms envelope"
  - input_class: "invalid_missing_attendees"
    must_fail_with: "invalid_query"
    must_not: "HTTP 200 and a rooms envelope"
  - input_class: "invalid_missing_start"
    must_fail_with: "invalid_query"
    must_not: "HTTP 200 and a rooms envelope"
  - input_class: "invalid_missing_end"
    must_fail_with: "invalid_query"
    must_not: "HTTP 200 and a rooms envelope"
  - input_class: "boundary_end_equal_start"
    must_fail_with: "invalid_query"
    must_not: "HTTP 200 and a rooms envelope"
  - input_class: "boundary_end_before_start"
    must_fail_with: "invalid_query"
    must_not: "HTTP 200 and a rooms envelope"
  - input_class: "invalid_time_without_z"
    must_fail_with: "invalid_query"
    must_not: "HTTP 200 and a rooms envelope"
  - input_class: "boundary_attendees_zero"
    must_fail_with: "invalid_query"
    must_not: "HTTP 200 and every free room"
  - input_class: "invalid_attendees_fractional"
    must_fail_with: "invalid_query"
    must_not: "HTTP 200 and a rooms envelope"
assertion_summary:
  - "each incomplete or invalid query answers 400 with the error field equal to invalid_query"
  - "no missing parameter is treated as a default that yields a room list"
  - "the complete valid query answers 200 with a rooms array"
feasibility: "feasible"
```

### room-booking-api:BEH-019

```yaml
id: "room-booking-api:BEH-019"
template: "Behavior"
obligation: "an unparsable, empty or non-object body returns 400 invalid_json and the process keeps serving later requests"
input_classes:
  - name: "invalid_truncated_json"
    input: "POST /rooms with body {\"name\":"
    expected: "invalid_json; HTTP 400"
  - name: "empty"
    input: "POST /rooms with an empty body"
    expected: "invalid_json; HTTP 400"
  - name: "invalid_array_body"
    input: "POST /rooms with body [1,2,3]"
    expected: "invalid_json; HTTP 400"
  - name: "typical"
    input: "POST /rooms with body {\"name\":\"Aurora\",\"capacity\":4}"
    expected: "HTTP 201"
  - name: "typical_next_request_served"
    input: "GET /rooms issued after the rejected bodies"
    expected: "HTTP 200 with body {\"rooms\":[]}"
negative_oracle:
  - input_class: "invalid_truncated_json"
    must_fail_with: "invalid_json"
    must_not: "HTTP 201 and a room entry in GET /rooms"
  - input_class: "empty"
    must_fail_with: "invalid_json"
    must_not: "HTTP 201 and a room entry in GET /rooms"
  - input_class: "invalid_array_body"
    must_fail_with: "invalid_json"
    must_not: "HTTP 201 and a room entry in GET /rooms"
assertion_summary:
  - "each rejected body answers 400 with the error field equal to invalid_json"
  - "GET /rooms still answers 200 after the rejected bodies, so the process is still serving"
  - "the room count is unchanged by the rejected bodies"
feasibility: "feasible"
```

### room-booking-api:BEH-020

```yaml
id: "room-booking-api:BEH-020"
template: "Behavior"
obligation: "every path outside the defined endpoint set returns 404 not_found"
input_classes:
  - name: "typical"
    input: "GET /rooms/r1"
    expected: "not_found; HTTP 404"
  - name: "invalid_unknown_literal_path"
    input: "GET /booking"
    expected: "not_found; HTTP 404"
  - name: "invalid_extra_segment"
    input: "GET /rooms/r1/bookings/extra"
    expected: "not_found; HTTP 404"
  - name: "boundary_undefined_method_on_undefined_path"
    input: "DELETE /rooms/r1"
    expected: "not_found; HTTP 404"
  - name: "empty"
    input: "GET /rooms"
    expected: "HTTP 200 with a rooms envelope"
negative_oracle:
  - input_class: "typical"
    must_fail_with: "not_found"
    must_not: "HTTP 405 and method_not_allowed"
  - input_class: "invalid_unknown_literal_path"
    must_fail_with: "not_found"
    must_not: "HTTP 405 and method_not_allowed"
  - input_class: "invalid_extra_segment"
    must_fail_with: "not_found"
    must_not: "HTTP 200 and a bookings envelope"
  - input_class: "boundary_undefined_method_on_undefined_path"
    must_fail_with: "not_found"
    must_not: "HTTP 405 and method_not_allowed"
assertion_summary:
  - "each unknown path answers 404 with a JSON body whose error field is not_found"
  - "no unknown path answers 405 or a 5xx status"
  - "a defined path without query answers 200"
feasibility: "feasible"
```

### room-booking-api:BEH-021

```yaml
id: "room-booking-api:BEH-021"
template: "Behavior"
obligation: "an unsupported method on a defined route path returns 405 method_not_allowed while an undefined path returns 404 not_found"
input_classes:
  - name: "typical"
    input: "DELETE /rooms"
    expected: "method_not_allowed; HTTP 405"
  - name: "invalid_patch_booking_route"
    input: "PATCH /rooms/r1/bookings with an empty body"
    expected: "method_not_allowed; HTTP 405"
  - name: "invalid_get_booking"
    input: "GET /bookings/b1"
    expected: "method_not_allowed; HTTP 405"
  - name: "invalid_post_availability"
    input: "POST /availability with an empty body"
    expected: "method_not_allowed; HTTP 405"
  - name: "boundary_undefined_path"
    input: "GET /nope"
    expected: "not_found; HTTP 404"
negative_oracle:
  - input_class: "typical"
    must_fail_with: "method_not_allowed"
    must_not: "HTTP 404 and not_found"
  - input_class: "invalid_patch_booking_route"
    must_fail_with: "method_not_allowed"
    must_not: "HTTP 201 and a stored booking"
  - input_class: "invalid_get_booking"
    must_fail_with: "method_not_allowed"
    must_not: "HTTP 200 with a booking body"
  - input_class: "invalid_post_availability"
    must_fail_with: "method_not_allowed"
    must_not: "HTTP 200 with a rooms envelope"
  - input_class: "boundary_undefined_path"
    must_fail_with: "not_found"
    must_not: "HTTP 405 and method_not_allowed"
assertion_summary:
  - "each unsupported method on a defined path answers 405 with the error field equal to method_not_allowed"
  - "the state is unchanged after each 405: GET /rooms and the booking lists show the same entries as before"
  - "the undefined path answers 404 not_found rather than 405"
feasibility: "feasible"
```

### room-booking-api:BEH-022

```yaml
id: "room-booking-api:BEH-022"
template: "Behavior"
obligation: "the content type is application/json on 200, 201, 400, 404, 405, 409 and 422 responses and the 204 response has no body and no content type"
input_classes:
  - name: "typical"
    input: "POST /rooms with body {\"name\":\"Aurora\",\"capacity\":4}"
    expected: "HTTP 201 with Content-Type application/json"
  - name: "boundary_success_200"
    input: "GET /rooms"
    expected: "HTTP 200 with Content-Type application/json"
  - name: "invalid_body_400"
    input: "POST /rooms with body {\"name\":\"\",\"capacity\":1}"
    expected: "HTTP 400 with Content-Type application/json"
  - name: "invalid_route_404"
    input: "GET /rooms/r1"
    expected: "HTTP 404 with Content-Type application/json"
  - name: "invalid_method_405"
    input: "DELETE /rooms"
    expected: "HTTP 405 with Content-Type application/json"
  - name: "invalid_conflict_409"
    input: "POST /rooms with body {\"name\":\"aurora\",\"capacity\":4} after Aurora exists"
    expected: "HTTP 409 with Content-Type application/json"
  - name: "invalid_capacity_422"
    input: "POST /rooms/r2/bookings with attendees 5 against room capacity 4"
    expected: "HTTP 422 with Content-Type application/json"
  - name: "boundary_no_content_204"
    input: "DELETE /bookings/b1 for an existing booking"
    expected: "HTTP 204 with no body and no Content-Type header"
negative_oracle:
  - input_class: "invalid_body_400"
    must_fail_with: "invalid_room"
    must_not: "a text/plain content type"
  - input_class: "boundary_no_content_204"
    must_fail_with: "UNDEFINED_CODE"
    must_not: "a JSON body or a Content-Type header on the 204 response"
assertion_summary:
  - "the Content-Type header of every non-204 response begins with application/json"
  - "the 204 response has a zero-length body and no Content-Type header"
feasibility: "feasible"
```

### room-booking-api:SCN-001

```yaml
id: "room-booking-api:SCN-001"
template: "Scenario"
obligation: "the ordered sequence ends with a successful booking of an interval that was refused before the delete"
input_classes:
  - name: "typical"
    input: "POST /rooms {\"name\":\"Aurora\",\"capacity\":4}, then POST /rooms/r1/bookings for 2026-11-02T10:00:00Z to 2026-11-02T11:00:00Z, then the overlapping 10:30 to 11:30 request, then DELETE /bookings/b1, then the same 10:00 to 11:00 request again"
    expected: "201, 201, 409 room_busy naming b1, 204, 200 with an empty list, 201 with a new id"
  - name: "boundary_conflicting_interval"
    input: "the 10:30 to 11:30 request while b1 still exists"
    expected: "room_busy; HTTP 409"
  - name: "boundary_freed_interval"
    input: "the 10:00 to 11:00 request after the delete of b1"
    expected: "HTTP 201"
negative_oracle:
  - input_class: "boundary_conflicting_interval"
    must_fail_with: "room_busy"
    must_not: "HTTP 201 and a stored booking"
assertion_summary:
  - "each step produces the status listed in the sequence, in order"
  - "the rebooking after the delete answers 201 and the booking list afterwards holds exactly one booking"
observable_sequence:
  - "POST /rooms with {\"name\":\"Aurora\",\"capacity\":4} from an empty server yields HTTP 201 with id r1"
  - "POST /rooms/r1/bookings for 2026-11-02T10:00:00Z to 2026-11-02T11:00:00Z yields HTTP 201 with id b1"
  - "POST /rooms/r1/bookings for 2026-11-02T10:30:00Z to 2026-11-02T11:30:00Z yields HTTP 409 with error room_busy and conflictingBookingId b1"
  - "GET /rooms/r1/bookings still lists exactly b1 after the rejected request"
  - "DELETE /bookings/b1 yields HTTP 204 with no body"
  - "GET /rooms/r1/bookings yields HTTP 200 with body {\"bookings\":[]}"
  - "POST /rooms/r1/bookings for 2026-11-02T10:00:00Z to 2026-11-02T11:00:00Z yields HTTP 201 with a booking id different from b1"
feasibility: "feasible"
```

### room-booking-api:SCN-002

```yaml
id: "room-booking-api:SCN-002"
template: "Scenario"
obligation: "booking and room ids increase monotonically in creation order and are not reused after a delete"
input_classes:
  - name: "typical"
    input: "book r1, book r2, delete the first booking, book r1 again, then create a room"
    expected: "ids b1, b2, then b3, and the new room r3"
  - name: "boundary_bookings_in_two_rooms"
    input: "the first booking in r1 and the second booking in r2 while rooms r1 and r2 exist"
    expected: "the second booking carries id b2, so one counter serves both rooms"
  - name: "boundary_creation_after_delete"
    input: "a booking created after deleting b1"
    expected: "the new booking id is b3 and not b1"
assertion_summary:
  - "the ids returned across the sequence are b1, b2, b3 and r3 in that order"
  - "no id observed in the sequence repeats"
observable_sequence:
  - "POST /rooms/r1/bookings for 2026-11-02T09:00:00Z to 2026-11-02T09:30:00Z yields HTTP 201 with id b1 and roomId r1"
  - "POST /rooms/r2/bookings for 2026-11-02T09:00:00Z to 2026-11-02T09:30:00Z yields HTTP 201 with id b2 and roomId r2"
  - "DELETE /bookings/b1 yields HTTP 204"
  - "POST /rooms/r1/bookings for 2026-11-02T11:00:00Z to 2026-11-02T11:30:00Z yields HTTP 201 with id b3"
  - "POST /rooms with {\"name\":\"Borealis\",\"capacity\":4} yields HTTP 201 with id r3"
  - "GET /rooms lists exactly r1, r2, r3 in that order"
feasibility: "feasible"
```

### room-booking-api:SCN-003

```yaml
id: "room-booking-api:SCN-003"
template: "Scenario"
obligation: "after a restart no room or booking from the previous process is visible and ids start at r1 again"
input_classes:
  - name: "typical"
    input: "start the server, create room r1 with booking b1, stop the process, start it again on the same port, then GET /rooms"
    expected: "HTTP 200 with body {\"rooms\":[]}"
  - name: "boundary_restart_after_rooms_only"
    input: "a restart after rooms were created and no booking"
    expected: "GET /rooms answers 200 with an empty rooms array"
  - name: "boundary_booking_of_old_room"
    input: "GET /rooms/r1/bookings after the restart"
    expected: "room_not_found; HTTP 404"
negative_oracle:
  - input_class: "boundary_booking_of_old_room"
    must_fail_with: "room_not_found"
    must_not: "HTTP 200 with the booking b1 listed"
assertion_summary:
  - "the room list after the restart is empty"
  - "the old room id answers 404 room_not_found on its booking list"
  - "the first room created after the restart receives id r1"
observable_sequence:
  - "create room Aurora and booking b1 in it, then stop the process and start it again on the same port"
  - "GET /rooms yields HTTP 200 with body {\"rooms\":[]}"
  - "GET /rooms/r1/bookings yields HTTP 404 with error room_not_found"
  - "POST /rooms with {\"name\":\"Aurora\",\"capacity\":4} yields HTTP 201 with id r1"
feasibility: "feasible"
```

### room-booking-api:NFR-001

```yaml
id: "room-booking-api:NFR-001"
template: "NFR"
obligation: "npm run build emits the compiled output with exit code 0 and npm test exits 0 with no failing test"
input_classes:
  - name: "typical"
    input: "a clean checkout of the product with the committed source tree, npm run build followed by npm test"
    expected: "both commands exit with status 0 and the test run reports no failures"
  - name: "boundary_compiled_output_present"
    input: "npm run build run twice in a row on the same checkout"
    expected: "the second run also exits with status 0 and the compiled output is present after it"
negative_oracle: []
assertion_summary:
  - "the build command exits with status 0"
  - "the test command exits with status 0 and its transcript reports zero failures"
feasibility: "feasible"
```

### room-booking-api:CTR-001

```yaml
id: "room-booking-api:CTR-001"
template: "Contract"
obligation: "the server listens on the PORT value when set and on 3000 otherwise"
input_classes:
  - name: "typical"
    input: "start the server from the compiled output with PORT set to an ephemeral port, then GET /rooms on that port"
    expected: "HTTP 200 with a rooms envelope on the ephemeral port"
  - name: "boundary_port_unset"
    input: "start the server with PORT absent from the environment, then GET /rooms on port 3000"
    expected: "HTTP 200 with a rooms envelope on port 3000"
negative_oracle: []
assertion_summary:
  - "with PORT set, a request to the ephemeral port is answered and a request to port 3000 is not answered by this server"
  - "with PORT unset, the request to port 3000 is answered with a documented status and not refused"
feasibility: "feasible"
```

### room-booking-api:CTR-002

```yaml
id: "room-booking-api:CTR-002"
template: "Contract"
obligation: "POST /rooms returns 201 with the created room and the documented 400 and 409 codes for the invalid inputs"
input_classes:
  - name: "typical"
    input: "POST /rooms with body {\"name\":\"Aurora\",\"capacity\":4}"
    expected: "HTTP 201, body {\"id\":\"r1\",\"name\":\"Aurora\",\"capacity\":4}"
  - name: "empty"
    input: "GET /rooms on a server with no room"
    expected: "HTTP 200, body {\"rooms\":[]}"
  - name: "invalid_invalid_room"
    input: "POST /rooms with body {\"name\":\"Aurora\",\"capacity\":0}"
    expected: "invalid_room; HTTP 400"
  - name: "invalid_room_name_taken"
    input: "POST /rooms with body {\"name\":\"aurora\",\"capacity\":4} after Aurora exists"
    expected: "room_name_taken; HTTP 409"
  - name: "invalid_json"
    input: "POST /rooms with body {\"name\":"
    expected: "invalid_json; HTTP 400"
  - name: "invalid_method"
    input: "DELETE /rooms"
    expected: "method_not_allowed; HTTP 405"
negative_oracle:
  - input_class: "invalid_invalid_room"
    must_fail_with: "invalid_room"
    must_not: "HTTP 201 and a room body"
  - input_class: "invalid_room_name_taken"
    must_fail_with: "room_name_taken"
    must_not: "HTTP 201 and a second room"
  - input_class: "invalid_json"
    must_fail_with: "invalid_json"
    must_not: "HTTP 201 and a room body"
  - input_class: "invalid_method"
    must_fail_with: "method_not_allowed"
    must_not: "HTTP 201 and a room body"
assertion_summary:
  - "the success body is a JSON object with exactly the fields id, name and capacity"
  - "the id field is present in every success body and equals r1 for the first room"
  - "each documented error class answers its documented status with a JSON error body"
feasibility: "feasible"
```

### room-booking-api:CTR-003

```yaml
id: "room-booking-api:CTR-003"
template: "Contract"
obligation: "GET /rooms returns 200 with all rooms ordered by id, filters by minCapacity and returns 400 invalid_query for a value that is not a positive integer"
input_classes:
  - name: "typical"
    input: "GET /rooms with no query after creating r1 capacity 4 and r2 capacity 10"
    expected: "HTTP 200, body {\"rooms\":[{r1 ...},{r2 ...}]}"
  - name: "empty"
    input: "GET /rooms on a server with no room"
    expected: "HTTP 200, body {\"rooms\":[]}"
  - name: "boundary_valid_min_capacity"
    input: "GET /rooms?minCapacity=10 with r1 capacity 4 and r2 capacity 10"
    expected: "HTTP 200 with only r2"
  - name: "invalid_min_capacity"
    input: "GET /rooms?minCapacity=0"
    expected: "invalid_query; HTTP 400"
  - name: "invalid_method"
    input: "PATCH /rooms"
    expected: "method_not_allowed; HTTP 405"
negative_oracle:
  - input_class: "invalid_min_capacity"
    must_fail_with: "invalid_query"
    must_not: "HTTP 200 and a rooms envelope"
  - input_class: "invalid_method"
    must_fail_with: "method_not_allowed"
    must_not: "HTTP 200 and a rooms envelope"
assertion_summary:
  - "the success body is an object with a rooms field holding an array of room objects"
  - "the array is ordered by numeric id suffix"
  - "the filtered array holds only rooms whose capacity is at least the value"
feasibility: "feasible"
```

### room-booking-api:CTR-004

```yaml
id: "room-booking-api:CTR-004"
template: "Contract"
obligation: "POST /rooms/:roomId/bookings returns 201 for a valid body and exactly one of 404 room_not_found, 400 invalid_booking, 422 over_capacity or 409 room_busy for each invalid input class"
input_classes:
  - name: "typical"
    input: "POST /rooms/r1/bookings with body {\"title\":\"Standup\",\"start\":\"2026-11-02T09:00:00Z\",\"end\":\"2026-11-02T09:30:00Z\",\"attendees\":6} against room capacity 10"
    expected: "HTTP 201, body {\"id\":\"b1\",\"roomId\":\"r1\",\"title\":\"Standup\",\"start\":\"2026-11-02T09:00:00Z\",\"end\":\"2026-11-02T09:30:00Z\",\"attendees\":6}"
  - name: "empty"
    input: "GET /rooms/r1/bookings before any booking"
    expected: "HTTP 200, body {\"bookings\":[]}"
  - name: "invalid_room_not_found"
    input: "POST /rooms/r99/bookings with a valid body"
    expected: "room_not_found; HTTP 404"
  - name: "invalid_invalid_booking"
    input: "POST /rooms/r1/bookings with an empty title"
    expected: "invalid_booking; HTTP 400"
  - name: "invalid_over_capacity"
    input: "POST /rooms/r1/bookings with attendees 11 against room capacity 10"
    expected: "over_capacity; HTTP 422"
  - name: "invalid_room_busy"
    input: "POST /rooms/r1/bookings for 2026-11-02T09:00:00Z to 2026-11-02T10:00:00Z when b1 spans 09:00 to 09:30"
    expected: "room_busy; HTTP 409 with conflictingBookingId b1"
  - name: "invalid_json"
    input: "POST /rooms/r1/bookings with body {\"title\":"
    expected: "invalid_json; HTTP 400"
negative_oracle:
  - input_class: "invalid_room_not_found"
    must_fail_with: "room_not_found"
    must_not: "HTTP 201 and a booking body"
  - input_class: "invalid_invalid_booking"
    must_fail_with: "invalid_booking"
    must_not: "HTTP 201 and a booking body"
  - input_class: "invalid_over_capacity"
    must_fail_with: "over_capacity"
    must_not: "HTTP 409 and room_busy"
  - input_class: "invalid_room_busy"
    must_fail_with: "room_busy"
    must_not: "HTTP 400 and invalid_booking"
  - input_class: "invalid_json"
    must_fail_with: "invalid_json"
    must_not: "HTTP 201 and a booking body"
assertion_summary:
  - "the success body holds the fields id, roomId, title, start, end and attendees"
  - "start and end are echoed in the YYYY-MM-DDTHH:MM:SSZ form"
  - "the over-capacity case answers 422 and the overlapping case answers 409, never the reverse"
  - "every room_busy body carries conflictingBookingId"
feasibility: "feasible"
```

### room-booking-api:CTR-005

```yaml
id: "room-booking-api:CTR-005"
template: "Contract"
obligation: "GET /rooms/:roomId/bookings returns the ordered booking list, filters by an overlap window and returns 400 invalid_query or 404 room_not_found for the invalid input classes"
input_classes:
  - name: "typical"
    input: "GET /rooms/r1/bookings with no query for a room holding b1 10:00-11:00 and b2 09:00-09:30"
    expected: "HTTP 200 with bookings ordered b2 then b1"
  - name: "empty"
    input: "GET /rooms/r1/bookings for a room with no booking"
    expected: "HTTP 200, body {\"bookings\":[]}"
  - name: "boundary_valid_window"
    input: "GET /rooms/r1/bookings?from=2026-11-02T09:00:00Z&to=2026-11-02T10:00:00Z"
    expected: "HTTP 200 with b2 listed and b1 absent"
  - name: "invalid_only_from"
    input: "GET /rooms/r1/bookings?from=2026-11-02T09:00:00Z"
    expected: "invalid_query; HTTP 400"
  - name: "invalid_unknown_room"
    input: "GET /rooms/r99/bookings"
    expected: "room_not_found; HTTP 404"
  - name: "invalid_method"
    input: "DELETE /rooms/r1/bookings"
    expected: "method_not_allowed; HTTP 405"
negative_oracle:
  - input_class: "invalid_only_from"
    must_fail_with: "invalid_query"
    must_not: "HTTP 200 and an unfiltered bookings envelope"
  - input_class: "invalid_unknown_room"
    must_fail_with: "room_not_found"
    must_not: "HTTP 200 with an empty bookings array"
  - input_class: "invalid_method"
    must_fail_with: "method_not_allowed"
    must_not: "HTTP 204 or HTTP 200"
assertion_summary:
  - "the success body is an object with a bookings field holding an array"
  - "the array is ordered by start and then by ascending booking id"
  - "the window is half-open, so a booking touching only an endpoint is absent"
feasibility: "feasible"
```

### room-booking-api:CTR-006

```yaml
id: "room-booking-api:CTR-006"
template: "Contract"
obligation: "DELETE /bookings/:bookingId returns 204 for a known booking and 404 booking_not_found for an unknown one"
input_classes:
  - name: "typical"
    input: "DELETE /bookings/b1 for an existing booking"
    expected: "HTTP 204 with no body and no Content-Type header"
  - name: "empty"
    input: "GET /rooms/r1/bookings after the delete"
    expected: "HTTP 200, body {\"bookings\":[]}"
  - name: "invalid_unknown_booking"
    input: "DELETE /bookings/b99"
    expected: "booking_not_found; HTTP 404"
  - name: "invalid_method"
    input: "GET /bookings/b1"
    expected: "method_not_allowed; HTTP 405"
negative_oracle:
  - input_class: "invalid_unknown_booking"
    must_fail_with: "booking_not_found"
    must_not: "HTTP 204"
  - input_class: "invalid_method"
    must_fail_with: "method_not_allowed"
    must_not: "HTTP 204"
assertion_summary:
  - "the known delete answers 204 with a zero-length body"
  - "the unknown delete answers 404 with the JSON error field booking_not_found"
feasibility: "feasible"
```

### room-booking-api:CTR-007

```yaml
id: "room-booking-api:CTR-007"
template: "Contract"
obligation: "GET /availability returns the free rooms with capacity at least attendees ordered by capacity then id, and 400 invalid_query for a missing or invalid parameter"
input_classes:
  - name: "typical"
    input: "GET /availability?start=2026-11-02T10:30:00Z&end=2026-11-02T11:30:00Z&attendees=6 with r2 busy and r3 free at equal capacity"
    expected: "HTTP 200 with the free rooms ordered by capacity then numeric id"
  - name: "empty"
    input: "GET /availability?start=2026-11-02T13:00:00Z&end=2026-11-02T14:00:00Z&attendees=11 on a server with no room"
    expected: "HTTP 200, body {\"rooms\":[]}"
  - name: "invalid_missing_parameter"
    input: "GET /availability?start=2026-11-02T10:00:00Z&end=2026-11-02T11:00:00Z"
    expected: "invalid_query; HTTP 400"
  - name: "invalid_end_not_after_start"
    input: "GET /availability?start=2026-11-02T11:00:00Z&end=2026-11-02T11:00:00Z&attendees=2"
    expected: "invalid_query; HTTP 400"
  - name: "invalid_attendees_not_positive_integer"
    input: "GET /availability?start=2026-11-02T10:00:00Z&end=2026-11-02T11:00:00Z&attendees=0"
    expected: "invalid_query; HTTP 400"
  - name: "invalid_method"
    input: "POST /availability with an empty body"
    expected: "method_not_allowed; HTTP 405"
negative_oracle:
  - input_class: "invalid_missing_parameter"
    must_fail_with: "invalid_query"
    must_not: "HTTP 200 and a rooms envelope"
  - input_class: "invalid_end_not_after_start"
    must_fail_with: "invalid_query"
    must_not: "HTTP 200 and a rooms envelope"
  - input_class: "invalid_attendees_not_positive_integer"
    must_fail_with: "invalid_query"
    must_not: "HTTP 200 and a rooms envelope"
  - input_class: "invalid_method"
    must_fail_with: "method_not_allowed"
    must_not: "HTTP 200 and a rooms envelope"
assertion_summary:
  - "the success body is an object with a rooms field holding an array ordered by capacity ascending then numeric id"
  - "no room in the array is busy for the queried window and none has capacity below attendees"
  - "a missing or invalid parameter answers 400 invalid_query"
feasibility: "feasible"
```

### room-booking-api:INV-001

```yaml
id: "room-booking-api:INV-001"
template: "Invariant"
obligation: "the room ids observed through GET /rooms are r1..rN without gaps or duplicates"
input_classes:
  - name: "typical"
    input: "GET /rooms after creating one room"
    expected: "HTTP 200 with exactly one room whose id is r1"
  - name: "empty"
    input: "GET /rooms on a freshly started server"
    expected: "HTTP 200 with body {\"rooms\":[]}"
  - name: "boundary_more_than_nine_rooms"
    input: "GET /rooms after creating twelve rooms in order"
    expected: "HTTP 200 with ids r1 through r12, each appearing once"
  - name: "boundary_second_creation"
    input: "POST /rooms with a different valid name after r1 exists"
    expected: "HTTP 201 with id r2"
assertion_summary:
  - "every observed id matches the form r followed by a positive integer"
  - "the observed ids are exactly r1 through rN, so no gap and no duplicate appears"
  - "the second creation never reuses r1"
feasibility: "feasible"
```

### room-booking-api:INV-002

```yaml
id: "room-booking-api:INV-002"
template: "Invariant"
obligation: "booking ids observed through the API are unique across rooms and increase in creation order"
input_classes:
  - name: "typical"
    input: "book r1 then r2 and read both creation responses"
    expected: "the ids are b1 and b2 in that order"
  - name: "empty"
    input: "GET /rooms/r1/bookings on a server with no booking"
    expected: "HTTP 200 with an empty bookings array"
  - name: "boundary_creation_after_delete"
    input: "a booking created after deleting b1"
    expected: "HTTP 201 with an id different from b1 and greater than every id seen before"
assertion_summary:
  - "every observed booking id matches the form b followed by a positive integer"
  - "one counter serves all rooms, so the second booking anywhere in the process carries the next number"
  - "a deleted id never appears again"
feasibility: "feasible"
```

### room-booking-api:INV-003

```yaml
id: "room-booking-api:INV-003"
template: "Invariant"
obligation: "no read of the booking list ever shows two overlapping intervals in one room"
input_classes:
  - name: "typical"
    input: "GET /rooms/r1/bookings after an overlapping request was rejected"
    expected: "HTTP 200 with exactly one booking, the one created before the rejected request"
  - name: "boundary_adjacent_intervals"
    input: "book 10:00-11:00 and then 11:00-11:30 in r1, then read the list"
    expected: "HTTP 200 with both bookings listed and no overlapping pair"
  - name: "invalid_overlapping_intervals"
    input: "book 10:00-11:00 and then 10:30-11:30 in r1"
    expected: "room_busy; HTTP 409 for the second request"
  - name: "boundary_other_room"
    input: "book 10:00-11:00 in r2 while r1 holds 10:00-11:00"
    expected: "HTTP 201, conflicts across rooms are allowed"
negative_oracle:
  - input_class: "invalid_overlapping_intervals"
    must_fail_with: "room_busy"
    must_not: "HTTP 201 and a second overlapping entry in GET /rooms/r1/bookings"
assertion_summary:
  - "in every list read from GET /rooms/:roomId/bookings no two intervals of the same room intersect"
  - "intervals that touch at an endpoint are both present and do not count as overlapping"
feasibility: "feasible"
```

### room-booking-api:INV-004

```yaml
id: "room-booking-api:INV-004"
template: "Invariant"
obligation: "every listed booking satisfies attendees <= the capacity of its room"
input_classes:
  - name: "typical"
    input: "GET /rooms/r2/bookings and GET /rooms after a booking of attendees 4 in a room of capacity 4"
    expected: "the listed booking has attendees 4 and the room entry has capacity 4"
  - name: "boundary_equal_capacity"
    input: "a booking with attendees equal to the room capacity"
    expected: "HTTP 201 and the booking is listed"
  - name: "invalid_above_capacity"
    input: "a booking with attendees 5 against a room of capacity 4"
    expected: "over_capacity; HTTP 422"
negative_oracle:
  - input_class: "invalid_above_capacity"
    must_fail_with: "over_capacity"
    must_not: "HTTP 201 and an entry in GET /rooms/r2/bookings"
assertion_summary:
  - "for every listed booking the attendees value is not greater than the capacity reported for its room"
  - "no room capacity changes across the sequence, since rooms are never updated"
feasibility: "feasible"
```

### room-booking-api:INV-005

```yaml
id: "room-booking-api:INV-005"
template: "Invariant"
obligation: "a restarted process exposes no room or booking created before the restart"
input_classes:
  - name: "typical"
    input: "create room r1 with booking b1, stop the process, start it again on the same port, then GET /rooms"
    expected: "HTTP 200 with body {\"rooms\":[]}"
  - name: "boundary_restart_with_rooms_and_bookings"
    input: "GET /rooms/r1/bookings after the restart"
    expected: "room_not_found; HTTP 404"
  - name: "boundary_restart_with_rooms_only"
    input: "create two rooms without bookings, restart, then GET /rooms"
    expected: "HTTP 200 with body {\"rooms\":[]}"
negative_oracle:
  - input_class: "boundary_restart_with_rooms_and_bookings"
    must_fail_with: "room_not_found"
    must_not: "HTTP 200 with the booking b1 listed"
assertion_summary:
  - "the room list after the restart holds no room created before the restart"
  - "the first room created after the restart receives id r1"
feasibility: "feasible"
```

### room-booking-api:POL-001

```yaml
id: "room-booking-api:POL-001"
template: "Policy"
obligation: "every error response body parses as a JSON object with a stable snake_case error code and room_busy additionally carries conflictingBookingId"
input_classes:
  - name: "typical"
    input: "POST /rooms with body {\"name\":\"Aurora\",\"capacity\":0}"
    expected: "HTTP 400, Content-Type application/json, body {\"error\":\"invalid_room\"}"
  - name: "invalid_not_found"
    input: "GET /rooms/r1"
    expected: "HTTP 404, body {\"error\":\"not_found\"}"
  - name: "invalid_method_not_allowed"
    input: "DELETE /rooms"
    expected: "HTTP 405, body {\"error\":\"method_not_allowed\"}"
  - name: "typical_conflict_with_extra_field"
    input: "POST /rooms/r1/bookings for an interval overlapping b1"
    expected: "HTTP 409, body {\"error\":\"room_busy\",\"conflictingBookingId\":\"b1\"}"
negative_oracle:
  - input_class: "typical"
    must_fail_with: "invalid_room"
    must_not: "a text/plain body or a body without an error field"
  - input_class: "invalid_not_found"
    must_fail_with: "not_found"
    must_not: "a body without an error field"
  - input_class: "invalid_method_not_allowed"
    must_fail_with: "method_not_allowed"
    must_not: "a body without an error field"
  - input_class: "typical_conflict_with_extra_field"
    must_fail_with: "room_busy"
    must_not: "a room_busy body without conflictingBookingId"
assertion_summary:
  - "every error body parses as a JSON object"
  - "the error field equals one of the snake_case codes of section 2, in lower case with underscore separators"
  - "no error response is plain text and no error body relies on free text in place of a code"
feasibility: "feasible"
```

### room-booking-api:POL-002

```yaml
id: "room-booking-api:POL-002"
template: "Policy"
obligation: "for each documented invalid input class the server answers with the documented 4xx code and keeps serving the next request"
input_classes:
  - name: "typical"
    input: "POST /rooms with body {\"name\":\"Aurora\",\"capacity\":4}"
    expected: "HTTP 201"
  - name: "invalid_body"
    input: "POST /rooms with body {\"name\":"
    expected: "invalid_json; HTTP 400"
  - name: "invalid_query_parameter"
    input: "GET /rooms?minCapacity=0"
    expected: "invalid_query; HTTP 400"
  - name: "invalid_path_parameter"
    input: "POST /rooms/r99/bookings with a valid body"
    expected: "room_not_found; HTTP 404"
negative_oracle:
  - input_class: "invalid_body"
    must_fail_with: "invalid_json"
    must_not: "any 5xx status or a terminated process"
  - input_class: "invalid_query_parameter"
    must_fail_with: "invalid_query"
    must_not: "HTTP 200 with a default value applied"
  - input_class: "invalid_path_parameter"
    must_fail_with: "room_not_found"
    must_not: "HTTP 201 and a stored booking"
assertion_summary:
  - "no invalid input produces a 5xx status"
  - "GET /rooms answers 200 with an unchanged room count after each rejected request, so the process still serves"
  - "no rejected request changes the state it targets"
feasibility: "feasible"
```

## 4. Infeasible candidates

Two candidates are flagged: their error oracle is not defined by the spec, so the negative oracle entry cannot name a code.

- `room-booking-api:BEH-017` (input class `typical`): the failure "a busy room is returned" has no error code in section 2 because the request succeeds with 200. The check is still decidable from the response body; the entry is written as `UNDEFINED_CODE` only because the oracle field expects a code. Feasible in practice once the test asserts the absence of the busy room from the 200 body.
- `room-booking-api:BEH-022` (input class `boundary_no_content_204`): the failure "the 204 response carries a body" is a success path with no error code. The check is decidable from the response headers and body length; the `UNDEFINED_CODE` marker only reflects the shape of the oracle field.

Neither candidate weakens its obligation, and no block is dropped.
