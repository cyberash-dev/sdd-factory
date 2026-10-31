# Verification design: room-booking-api

## 1. Scope

Eligible approved records, one block each, in spec order.

| template | blocks | ids |
|---|---|---|
| Behavior | 24 | room-booking-api:BEH-001 … room-booking-api:BEH-024 |
| Contract | 11 | room-booking-api:CTR-001 … room-booking-api:CTR-011 |
| Invariant | 5 | room-booking-api:INV-001 … room-booking-api:INV-005 |
| Policy | 2 | room-booking-api:POL-001, room-booking-api:POL-002 |
| **total** | **42** | |

No Scenario and no NFR record exists in the spec, so those templates have no block.

Skipped, with reason:

- `room-booking-api` (Partition) and `room-booking-api:BL-001` (BrownfieldBaseline) — not boundary requirements.
- `room-booking-api:SUR-001` (Surface) — the boundary is used, never verified as a record.
- `room-booking-api:CON-001`, `room-booking-api:CON-002`, `room-booking-api:CON-003` (Constraint) — implementation constraints with no product-boundary observable.
- `room-booking-api:OQ-001` … `room-booking-api:OQ-008` (Open-Q) — resolved by the ASSUMPTION records listed below.
- `room-booking-api:ASM-001` … `room-booking-api:ASM-009` (ASSUMPTION) — in force, applied inside the blocks they name.

## 2. Error oracle

Every code below comes from the error taxonomy of `room-booking-api:CTR-010` and from the taxonomies of `room-booking-api:CTR-001` … `room-booking-api:CTR-009`. Every error body is `{ "error": "<code>" }` plus `conflictingBookingId` only for `room_busy`, and every error response with a body carries `Content-Type: application/json`.

| error code | observable signal | source record |
|---|---|---|
| `invalid_json` | 400; body error field is `invalid_json` | room-booking-api:CTR-010, room-booking-api:CTR-001, room-booking-api:CTR-003 |
| `invalid_query` | 400; body error field is `invalid_query` | room-booking-api:CTR-010, room-booking-api:CTR-002, room-booking-api:CTR-004, room-booking-api:CTR-006 |
| `invalid_room` | 400; body error field is `invalid_room` | room-booking-api:CTR-010, room-booking-api:CTR-001, room-booking-api:CTR-007 |
| `invalid_booking` | 400; body error field is `invalid_booking` | room-booking-api:CTR-010, room-booking-api:CTR-003, room-booking-api:CTR-008, room-booking-api:CTR-009 |
| `not_found` | 404; body error field is `not_found` | room-booking-api:CTR-010, room-booking-api:BEH-022 |
| `room_not_found` | 404; body error field is `room_not_found` | room-booking-api:CTR-010, room-booking-api:CTR-003, room-booking-api:CTR-004 |
| `booking_not_found` | 404; body error field is `booking_not_found` | room-booking-api:CTR-010, room-booking-api:CTR-005 |
| `method_not_allowed` | 405; body error field is `method_not_allowed` | room-booking-api:CTR-010, room-booking-api:BEH-023 |
| `room_name_taken` | 409; body error field is `room_name_taken` | room-booking-api:CTR-010, room-booking-api:CTR-001 |
| `room_busy` | 409; body error field is `room_busy` plus `conflictingBookingId` | room-booking-api:CTR-010, room-booking-api:CTR-003 |
| `over_capacity` | 422; body error field is `over_capacity` | room-booking-api:CTR-010, room-booking-api:CTR-003, room-booking-api:CTR-008 |

## 3. Blocks

### room-booking-api:BEH-001

```yaml
id: room-booking-api:BEH-001
template: Behavior
obligation: "a valid room body answers 201 with the created room and that room is listed by GET /rooms"
input_classes:
  - name: "typical"
    input: "POST /rooms with body { \"name\": \"Focus\", \"capacity\": 6 } on a state without that name"
    expected: "201 with Content-Type application/json and a body carrying id, name Focus and capacity 6"
  - name: "boundary_name_40_capacity_100"
    input: "POST /rooms with a 40-character name and capacity 100"
    expected: "201 with the submitted 40-character name and capacity 100"
  - name: "boundary_name_1_capacity_1"
    input: "POST /rooms with body { \"name\": \"A\", \"capacity\": 1 }"
    expected: "201 with name A and capacity 1"
  - name: "empty_state_first_room"
    input: "POST /rooms with body { \"name\": \"Focus\", \"capacity\": 6 } on a freshly started process, then GET /rooms"
    expected: "201 with id r1, then 200 with { \"rooms\": [ { \"id\": \"r1\", \"name\": \"Focus\", \"capacity\": 6 } ] }"
  - name: "invalid_duplicate_name"
    input: "POST /rooms with body { \"name\": \"focus\", \"capacity\": 6 } while a room named Focus exists"
    expected: "409; no new room"
  - name: "invalid_capacity_zero"
    input: "POST /rooms with body { \"name\": \"Lab\", \"capacity\": 0 }"
    expected: "400 invalid_room; no new room"
negative_oracle:
  - input_class: "invalid_duplicate_name"
    must_fail_with: "room_name_taken"
    must_not: "a second room with that name in the GET /rooms list"
  - input_class: "invalid_capacity_zero"
    must_fail_with: "invalid_room"
    must_not: "a 201 response or any new entry in the GET /rooms list"
assertion_summary:
  - "the 201 body carries name and capacity equal to the submitted values"
  - "the id in the 201 body is the id of the room with that name in the following GET /rooms response, so the room is never absent from the list"
  - "the GET /rooms list length grows by exactly one after the 201 and stays unchanged after each rejected request"
feasibility: feasible
```

### room-booking-api:BEH-002

```yaml
id: room-booking-api:BEH-002
template: Behavior
obligation: "a room name that is missing, empty, whitespace only, longer than 40 characters or not a string answers 400 invalid_room and the state is unchanged"
input_classes:
  - name: "typical"
    input: "POST /rooms with body { \"name\": \"A\", \"capacity\": 6 }"
    expected: "201 with name A"
  - name: "boundary_40_chars"
    input: "POST /rooms with a name of exactly 40 characters and capacity 6"
    expected: "201"
  - name: "empty_name"
    input: "POST /rooms with body { \"name\": \"\", \"capacity\": 6 }"
    expected: "400; body error field invalid_room"
  - name: "boundary_41_chars"
    input: "POST /rooms with a name of exactly 41 characters and capacity 6"
    expected: "400; body error field invalid_room"
  - name: "invalid_whitespace_only"
    input: "POST /rooms with body { \"name\": \"   \", \"capacity\": 6 }"
    expected: "400; body error field invalid_room"
  - name: "invalid_missing_name"
    input: "POST /rooms with body { \"capacity\": 6 }"
    expected: "400; body error field invalid_room"
  - name: "invalid_non_string"
    input: "POST /rooms with body { \"name\": 42, \"capacity\": 6 }"
    expected: "400; body error field invalid_room"
negative_oracle:
  - input_class: "boundary_41_chars"
    must_fail_with: "invalid_room"
    must_not: "a 201 response"
  - input_class: "empty_name"
    must_fail_with: "invalid_room"
    must_not: "a 500 status"
  - input_class: "invalid_missing_name"
    must_fail_with: "invalid_room"
    must_not: "a 201 response"
  - input_class: "invalid_whitespace_only"
    must_fail_with: "invalid_room"
    must_not: "a 201 response"
  - input_class: "invalid_non_string"
    must_fail_with: "invalid_room"
    must_not: "a 201 response or a 500 status"
assertion_summary:
  - "each rejected request answers 400 and its body error field is invalid_room"
  - "the GET /rooms response before and after every rejected request lists the same rooms in the same order"
feasibility: feasible
```

### room-booking-api:BEH-003

```yaml
id: room-booking-api:BEH-003
template: Behavior
obligation: "a capacity that is missing, not an integer, below 1 or above 100 answers 400 invalid_room and the state is unchanged"
input_classes:
  - name: "typical"
    input: "POST /rooms with body { \"name\": \"Focus\", \"capacity\": 6 }"
    expected: "201 with capacity 6"
  - name: "boundary_capacity_1"
    input: "POST /rooms with body { \"name\": \"Nook\", \"capacity\": 1 }"
    expected: "201 with capacity 1"
  - name: "boundary_capacity_100"
    input: "POST /rooms with body { \"name\": \"Hall\", \"capacity\": 100 }"
    expected: "201 with capacity 100"
  - name: "invalid_capacity_0"
    input: "POST /rooms with body { \"name\": \"Lab\", \"capacity\": 0 }"
    expected: "400; body error field invalid_room"
  - name: "boundary_capacity_101"
    input: "POST /rooms with body { \"name\": \"Lab\", \"capacity\": 101 }"
    expected: "400; body error field invalid_room"
  - name: "invalid_missing_capacity"
    input: "POST /rooms with body { \"name\": \"Lab\" }"
    expected: "400; body error field invalid_room"
  - name: "invalid_non_integer"
    input: "POST /rooms with body { \"name\": \"Lab\", \"capacity\": 1.5 }"
    expected: "400; body error field invalid_room"
  - name: "invalid_string_capacity"
    input: "POST /rooms with body { \"name\": \"Lab\", \"capacity\": \"6\" }"
    expected: "400; body error field invalid_room"
negative_oracle:
  - input_class: "invalid_capacity_0"
    must_fail_with: "invalid_room"
    must_not: "a 201 response"
  - input_class: "boundary_capacity_101"
    must_fail_with: "invalid_room"
    must_not: "a 201 response"
  - input_class: "invalid_non_integer"
    must_fail_with: "invalid_room"
    must_not: "a 201 response"
  - input_class: "invalid_string_capacity"
    must_fail_with: "invalid_room"
    must_not: "a 201 response"
assertion_summary:
  - "each rejected request answers 400 with body error field invalid_room"
  - "the GET /rooms list is identical before and after every rejected request"
feasibility: feasible
```

### room-booking-api:BEH-004

```yaml
id: room-booking-api:BEH-004
template: Behavior
obligation: "a name already used by another room under case-insensitive comparison answers 409 room_name_taken and the state is unchanged"
input_classes:
  - name: "typical"
    input: "with a room named Focus in the state, POST /rooms with body { \"name\": \"Field\", \"capacity\": 6 }"
    expected: "201 with name Field"
  - name: "boundary_identical"
    input: "POST /rooms with body { \"name\": \"Focus\", \"capacity\": 6 }"
    expected: "409; body error field room_name_taken"
  - name: "invalid_case_only_lower"
    input: "POST /rooms with body { \"name\": \"focus\", \"capacity\": 6 }"
    expected: "409; body error field room_name_taken"
  - name: "invalid_case_only_upper"
    input: "POST /rooms with body { \"name\": \"FOCUS\", \"capacity\": 6 }"
    expected: "409; body error field room_name_taken"
  - name: "boundary_one_char_diff"
    input: "POST /rooms with body { \"name\": \"Focuz\", \"capacity\": 6 }"
    expected: "201 with name Focuz"
negative_oracle:
  - input_class: "invalid_case_only_lower"
    must_fail_with: "room_name_taken"
    must_not: "a 201 response or a second room in the GET /rooms list"
  - input_class: "invalid_case_only_upper"
    must_fail_with: "room_name_taken"
    must_not: "a 201 response or a second room in the GET /rooms list"
  - input_class: "boundary_identical"
    must_fail_with: "room_name_taken"
    must_not: "a 201 response"
assertion_summary:
  - "the GET /rooms list holds exactly one room whose name equals Focus after lower-casing, before and after each rejection"
  - "the stored name of the existing room is still spelled Focus, never lower-cased"
feasibility: feasible
```

### room-booking-api:BEH-005

```yaml
id: room-booking-api:BEH-005
template: Behavior
obligation: "GET /rooms answers 200 with every room in ascending room-id order, including past the ninth room"
input_classes:
  - name: "empty_state"
    input: "GET /rooms on a freshly started process"
    expected: "200 with body { \"rooms\": [] }"
  - name: "one_room"
    input: "create one room, then GET /rooms"
    expected: "200 with exactly one entry, id r1"
  - name: "ten_rooms"
    input: "create ten rooms in order, then GET /rooms"
    expected: "200 with the ten entries ordered r1, r2, r3, r4, r5, r6, r7, r8, r9, r10"
  - name: "absent_min_capacity"
    input: "with three rooms present, GET /rooms without a query string"
    expected: "200 with all three rooms"
  - name: "invalid_min_capacity_not_integer"
    input: "GET /rooms?minCapacity=abc"
    expected: "400; body error field invalid_query"
negative_oracle:
  - input_class: "invalid_min_capacity_not_integer"
    must_fail_with: "invalid_query"
    must_not: "a 200 response"
assertion_summary:
  - "the entry for r10 never appears before the entry for r9 in the ten_rooms response"
  - "every room created in the state appears exactly once in the response"
  - "the empty body is { \"rooms\": [] } and never an absent or null field"
feasibility: feasible
```

### room-booking-api:BEH-006

```yaml
id: room-booking-api:BEH-006
template: Behavior
obligation: "minCapacity keeps exactly the rooms whose capacity is at least its value, in ascending room-id order"
input_classes:
  - name: "typical"
    input: "with r1 capacity 4, r2 capacity 8 and r3 capacity 12, GET /rooms?minCapacity=8"
    expected: "200 with r2 then r3"
  - name: "boundary_equals_existing"
    input: "GET /rooms?minCapacity=4 on the same state"
    expected: "200 with r1, r2, r3"
  - name: "boundary_above_all"
    input: "GET /rooms?minCapacity=20 on the same state"
    expected: "200 with body { \"rooms\": [] }"
  - name: "boundary_min_1"
    input: "GET /rooms?minCapacity=1 on the same state"
    expected: "200 with r1, r2, r3"
  - name: "absent_min_capacity"
    input: "GET /rooms with no query string on the same state"
    expected: "200 with r1, r2, r3"
  - name: "invalid_zero"
    input: "GET /rooms?minCapacity=0"
    expected: "400; body error field invalid_query"
negative_oracle:
  - input_class: "invalid_zero"
    must_fail_with: "invalid_query"
    must_not: "a 200 response"
assertion_summary:
  - "no room whose capacity is below the minCapacity value ever appears in the response"
  - "the capacities in the response never decrease from one entry to the next"
feasibility: feasible
```

### room-booking-api:BEH-007

```yaml
id: room-booking-api:BEH-007
template: Behavior
obligation: "a minCapacity that is not a positive integer answers 400 invalid_query"
input_classes:
  - name: "typical"
    input: "GET /rooms?minCapacity=1"
    expected: "200 with every room"
  - name: "absent_min_capacity"
    input: "GET /rooms with no query string"
    expected: "200 with every room"
  - name: "invalid_zero"
    input: "GET /rooms?minCapacity=0"
    expected: "400; body error field invalid_query"
  - name: "invalid_negative"
    input: "GET /rooms?minCapacity=-1"
    expected: "400; body error field invalid_query"
  - name: "invalid_decimal"
    input: "GET /rooms?minCapacity=1.5"
    expected: "400; body error field invalid_query"
  - name: "invalid_letters"
    input: "GET /rooms?minCapacity=abc"
    expected: "400; body error field invalid_query"
negative_oracle:
  - input_class: "invalid_zero"
    must_fail_with: "invalid_query"
    must_not: "a 200 response"
  - input_class: "invalid_letters"
    must_fail_with: "invalid_query"
    must_not: "a 500 status"
  - input_class: "invalid_decimal"
    must_fail_with: "invalid_query"
    must_not: "a 200 response"
  - input_class: "invalid_negative"
    must_fail_with: "invalid_query"
    must_not: "a 200 response"
assertion_summary:
  - "each rejected request answers 400 with body error field invalid_query and Content-Type application/json"
  - "a GET /rooms without a query string sent after each rejection answers 200"
feasibility: feasible
```

### room-booking-api:BEH-008

```yaml
id: room-booking-api:BEH-008
template: Behavior
obligation: "a valid booking body answers 201 with a server-assigned booking id and that booking appears in the booking list of the room"
input_classes:
  - name: "typical"
    input: "with r1 capacity 6 and no conflicting booking, POST /rooms/r1/bookings with body { \"title\": \"Standup\", \"start\": \"2026-11-02T09:30:00Z\", \"end\": \"2026-11-02T10:00:00Z\", \"attendees\": 4 }"
    expected: "201 with id, roomId r1, title Standup, start 2026-11-02T09:30:00Z, end 2026-11-02T10:00:00Z and attendees 4"
  - name: "boundary_attendees_equal_capacity"
    input: "POST /rooms/r1/bookings with attendees 6, start 2026-11-02T11:00:00Z and end 2026-11-02T12:00:00Z"
    expected: "201 with attendees 6"
  - name: "boundary_one_minute"
    input: "POST /rooms/r1/bookings with start 2026-11-02T13:00:00Z and end 2026-11-02T13:01:00Z"
    expected: "201"
  - name: "empty_booking_list"
    input: "GET /rooms/r1/bookings before any booking, then create one booking and GET again"
    expected: "200 with body { \"bookings\": [] } first, then 200 with exactly one entry"
  - name: "invalid_repeat_interval"
    input: "the typical request sent a second time"
    expected: "409; body error field room_busy with conflictingBookingId"
  - name: "invalid_unknown_room"
    input: "POST /rooms/r99/bookings with a valid body while no room r99 exists"
    expected: "404; body error field room_not_found"
negative_oracle:
  - input_class: "invalid_repeat_interval"
    must_fail_with: "room_busy"
    must_not: "a 201 response or a second booking in the list of r1"
  - input_class: "invalid_unknown_room"
    must_fail_with: "room_not_found"
    must_not: "a 201 response or a stored booking"
assertion_summary:
  - "the 201 body carries an id matching the room-booking-api:CTR-008 form with a b prefix and roomId equal to the path room"
  - "the booking id of the 201 body appears exactly once in the following GET /rooms/r1/bookings response"
  - "the number of entries in GET /rooms/r1/bookings is unchanged after each rejected request"
feasibility: feasible
```

### room-booking-api:BEH-009

```yaml
id: room-booking-api:BEH-009
template: Behavior
obligation: "a booking request for a room id that does not exist answers 404 room_not_found and no booking is stored"
input_classes:
  - name: "typical_existing_room"
    input: "with r1 present, POST /rooms/r1/bookings with an otherwise valid body"
    expected: "201"
  - name: "unknown_never_created"
    input: "with no room r99, POST /rooms/r99/bookings with body { \"title\": \"Sync\", \"start\": \"2026-11-02T09:00:00Z\", \"end\": \"2026-11-02T10:00:00Z\", \"attendees\": 2 }"
    expected: "404; body error field room_not_found"
  - name: "invalid_shape_unused"
    input: "POST /rooms/R1/bookings with an otherwise valid body while the state holds r1"
    expected: "404; body error field room_not_found"
  - name: "invalid_combined_bad_title"
    input: "POST /rooms/r99/bookings with body { \"title\": \"\", \"start\": \"2026-11-02T09:00:00Z\", \"end\": \"2026-11-02T10:00:00Z\", \"attendees\": 2 }"
    expected: "404; body error field room_not_found"
negative_oracle:
  - input_class: "unknown_never_created"
    must_fail_with: "room_not_found"
    must_not: "a 400 invalid_booking response or a 201 response"
  - input_class: "invalid_combined_bad_title"
    must_fail_with: "room_not_found"
    must_not: "a 400 invalid_booking response"
  - input_class: "invalid_shape_unused"
    must_fail_with: "room_not_found"
    must_not: "a 201 response"
assertion_summary:
  - "the GET /rooms list is unchanged after each rejected request, so no room is created implicitly"
  - "the booking list of every existing room is unchanged after each rejected request"
feasibility: feasible
```

### room-booking-api:BEH-010

```yaml
id: room-booking-api:BEH-010
template: Behavior
obligation: "each invalid title, time or duration class answers 400 invalid_booking and the state is unchanged"
input_classes:
  - name: "typical"
    input: "with r1 capacity 10, POST /rooms/r1/bookings with an 80-character title from 2026-11-02T09:00:00Z to 2026-11-02T17:00:00Z and attendees 3"
    expected: "201 with the submitted title and interval"
  - name: "boundary_title_80"
    input: "POST /rooms/r1/bookings with a title of exactly 80 characters"
    expected: "201"
  - name: "boundary_duration_8h"
    input: "POST /rooms/r1/bookings from 2026-11-03T08:00:00Z to 2026-11-03T16:00:00Z"
    expected: "201"
  - name: "invalid_duration_8h_1min"
    input: "POST /rooms/r1/bookings from 2026-11-04T08:00:00Z to 2026-11-04T16:01:00Z"
    expected: "400; body error field invalid_booking"
  - name: "invalid_title_81"
    input: "POST /rooms/r1/bookings with a title of exactly 81 characters"
    expected: "400; body error field invalid_booking"
  - name: "invalid_end_equal_start"
    input: "POST /rooms/r1/bookings from 2026-11-05T09:00:00Z to 2026-11-05T09:00:00Z"
    expected: "400; body error field invalid_booking"
  - name: "invalid_seconds_part"
    input: "POST /rooms/r1/bookings with start 2026-11-06T09:00:30Z and end 2026-11-06T10:00:00Z"
    expected: "400; body error field invalid_booking"
  - name: "invalid_missing_title"
    input: "POST /rooms/r1/bookings with body { \"start\": \"2026-11-06T09:00:00Z\", \"end\": \"2026-11-06T10:00:00Z\", \"attendees\": 3 }"
    expected: "400; body error field invalid_booking"
  - name: "invalid_whitespace_title"
    input: "POST /rooms/r1/bookings with body { \"title\": \"   \", \"start\": \"2026-11-06T09:00:00Z\", \"end\": \"2026-11-06T10:00:00Z\", \"attendees\": 3 }"
    expected: "400; body error field invalid_booking"
  - name: "invalid_non_utc_offset"
    input: "POST /rooms/r1/bookings with start 2026-11-07T11:00:00+02:00 and end 2026-11-07T12:00:00Z"
    expected: "400; body error field invalid_booking"
  - name: "invalid_unparseable_date"
    input: "POST /rooms/r1/bookings with start 2026-13-45T09:00:00Z and end 2026-11-08T10:00:00Z"
    expected: "400; body error field invalid_booking"
  - name: "invalid_end_before_start"
    input: "POST /rooms/r1/bookings from 2026-11-09T10:00:00Z to 2026-11-09T09:00:00Z"
    expected: "400; body error field invalid_booking"
negative_oracle:
  - input_class: "invalid_duration_8h_1min"
    must_fail_with: "invalid_booking"
    must_not: "a 201 response"
  - input_class: "invalid_end_equal_start"
    must_fail_with: "invalid_booking"
    must_not: "a 201 response"
  - input_class: "invalid_title_81"
    must_fail_with: "invalid_booking"
    must_not: "a 201 response"
  - input_class: "invalid_seconds_part"
    must_fail_with: "invalid_booking"
    must_not: "a 201 response"
  - input_class: "invalid_non_utc_offset"
    must_fail_with: "invalid_booking"
    must_not: "a 201 response"
  - input_class: "invalid_unparseable_date"
    must_fail_with: "invalid_booking"
    must_not: "a 201 response or a 500 status"
  - input_class: "invalid_end_before_start"
    must_fail_with: "invalid_booking"
    must_not: "a 201 response"
  - input_class: "invalid_whitespace_title"
    must_fail_with: "invalid_booking"
    must_not: "a 201 response"
assertion_summary:
  - "every rejected request answers 400 with body error field invalid_booking"
  - "GET /rooms/r1/bookings returns the same entries before and after every rejected request"
feasibility: feasible
```

### room-booking-api:BEH-011

```yaml
id: room-booking-api:BEH-011
template: Behavior
obligation: "attendees above the room capacity answers 422 over_capacity and the state is unchanged"
input_classes:
  - name: "typical"
    input: "with r1 capacity 6, POST /rooms/r1/bookings with attendees 4 for 2026-11-02T09:00:00Z to 2026-11-02T10:00:00Z"
    expected: "201 with attendees 4"
  - name: "boundary_attendees_equal_capacity"
    input: "POST /rooms/r1/bookings with attendees 6 for 2026-11-02T11:00:00Z to 2026-11-02T12:00:00Z"
    expected: "201 with attendees 6"
  - name: "invalid_one_above_capacity"
    input: "POST /rooms/r1/bookings with attendees 7 for 2026-11-02T13:00:00Z to 2026-11-02T14:00:00Z"
    expected: "422; body error field over_capacity"
  - name: "invalid_attendees_zero"
    input: "POST /rooms/r1/bookings with attendees 0 for 2026-11-02T15:00:00Z to 2026-11-02T16:00:00Z"
    expected: "400; body error field invalid_booking"
  - name: "invalid_missing_attendees"
    input: "POST /rooms/r1/bookings with body { \"title\": \"Sync\", \"start\": \"2026-11-02T15:00:00Z\", \"end\": \"2026-11-02T16:00:00Z\" }"
    expected: "400; body error field invalid_booking"
  - name: "invalid_non_integer_attendees"
    input: "POST /rooms/r1/bookings with attendees 2.5"
    expected: "400; body error field invalid_booking"
negative_oracle:
  - input_class: "invalid_one_above_capacity"
    must_fail_with: "over_capacity"
    must_not: "a 201 response or a 400 invalid_booking response"
  - input_class: "invalid_attendees_zero"
    must_fail_with: "invalid_booking"
    must_not: "a 201 response or a 422 over_capacity response"
assertion_summary:
  - "the 422 response carries body error field over_capacity and Content-Type application/json"
  - "GET /rooms/r1/bookings is unchanged after each rejected request"
feasibility: feasible
```

### room-booking-api:BEH-012

```yaml
id: room-booking-api:BEH-012
template: Behavior
obligation: "an interval overlapping an existing booking of the room answers 409 room_busy naming the earliest-starting conflicting booking, and the state is unchanged"
input_classes:
  - name: "typical"
    input: "with r1 holding b1 from 2026-11-02T09:00:00Z to 2026-11-02T09:20:00Z and b2 from 2026-11-02T09:40:00Z to 2026-11-02T10:00:00Z, POST /rooms/r1/bookings from 2026-11-02T09:10:00Z to 2026-11-02T09:50:00Z"
    expected: "409 with body error field room_busy and conflictingBookingId equal to the id of b1"
  - name: "boundary_inside"
    input: "with b1 from 2026-11-02T09:00:00Z to 2026-11-02T10:00:00Z, POST /rooms/r1/bookings from 2026-11-02T09:05:00Z to 2026-11-02T09:10:00Z"
    expected: "409 with conflictingBookingId equal to the id of b1"
  - name: "boundary_two_bookings"
    input: "with b1 from 2026-11-02T09:00:00Z to 2026-11-02T09:20:00Z and b2 from 2026-11-02T09:40:00Z to 2026-11-02T10:00:00Z, POST /rooms/r1/bookings from 2026-11-02T08:50:00Z to 2026-11-02T10:10:00Z"
    expected: "409 with conflictingBookingId equal to the id of b1, the earliest-starting of the two"
  - name: "boundary_touch_at_start"
    input: "with b1 from 2026-11-02T09:00:00Z to 2026-11-02T10:00:00Z, POST /rooms/r1/bookings from 2026-11-02T08:00:00Z to 2026-11-02T09:00:00Z"
    expected: "201"
  - name: "boundary_touch_at_end"
    input: "with b1 from 2026-11-02T09:00:00Z to 2026-11-02T10:00:00Z, POST /rooms/r1/bookings from 2026-11-02T10:00:00Z to 2026-11-02T11:00:00Z"
    expected: "201"
  - name: "other_room"
    input: "with r1 booked from 2026-11-02T09:00:00Z to 2026-11-02T10:00:00Z, POST /rooms/r2/bookings for the same interval"
    expected: "201"
negative_oracle:
  - input_class: "typical"
    must_fail_with: "room_busy"
    must_not: "a 201 response or a stored booking"
  - input_class: "boundary_inside"
    must_fail_with: "room_busy"
    must_not: "a body lacking conflictingBookingId"
  - input_class: "boundary_two_bookings"
    must_fail_with: "room_busy"
    must_not: "a conflictingBookingId naming the booking that starts last"
assertion_summary:
  - "the 409 body carries error field room_busy and a conflictingBookingId naming a booking whose interval overlaps the requested interval"
  - "an interval sharing only one endpoint with an existing booking never answers 409"
  - "the GET /rooms/r1/bookings list holds the same entries after each rejection"
feasibility: feasible
```

### room-booking-api:BEH-013

```yaml
id: room-booking-api:BEH-013
template: Behavior
obligation: "GET /rooms/:roomId/bookings answers 200 with the bookings of that room ordered by ascending start and then by ascending booking id"
input_classes:
  - name: "no_bookings"
    input: "GET /rooms/r1/bookings on a room without bookings"
    expected: "200 with body { \"bookings\": [] }"
  - name: "typical_three_bookings"
    input: "r1 booked 2026-11-02T09:00:00Z to 10:00:00Z, then 2026-11-02T10:00:00Z to 11:00:00Z, then 2026-11-02T11:00:00Z to 12:00:00Z; GET /rooms/r1/bookings"
    expected: "200 with the three entries in that start order"
  - name: "boundary_ten_bookings"
    input: "r1 booked in ten consecutive one-hour intervals from 2026-11-02T08:00:00Z; GET /rooms/r1/bookings"
    expected: "200 with ten entries ordered by ascending start, ids ascending under numeric order so the tenth entry is the ten-booking id"
  - name: "other_room_bookings"
    input: "r2 holds bookings; GET /rooms/r1/bookings on r1 holding one booking"
    expected: "200 with only the booking of r1"
  - name: "invalid_unknown_room"
    input: "GET /rooms/r99/bookings with no room r99"
    expected: "404; body error field room_not_found"
negative_oracle:
  - input_class: "invalid_unknown_room"
    must_fail_with: "room_not_found"
    must_not: "a 200 response with an empty bookings array"
assertion_summary:
  - "no entry of the response carries a roomId other than the room in the path"
  - "the start values never decrease from one entry to the next"
  - "with ten bookings the entry whose id ends in 10 appears after the entry whose id ends in 9"
feasibility: feasible
```

### room-booking-api:BEH-014

```yaml
id: room-booking-api:BEH-014
template: Behavior
obligation: "the from and to window keeps exactly the bookings overlapping the half-open interval"
input_classes:
  - name: "typical"
    input: "r1 holding a booking ending at 2026-11-02T10:00:00Z and a booking starting at 2026-11-02T10:00:00Z; GET /rooms/r1/bookings?from=2026-11-02T09:00:00Z&to=2026-11-02T10:00:00Z"
    expected: "200 with only the booking ending at 10:00"
  - name: "boundary_ending_at_from"
    input: "r1 holding a booking from 2026-11-03T08:00:00Z to 2026-11-03T09:00:00Z; GET /rooms/r1/bookings?from=2026-11-03T09:00:00Z&to=2026-11-03T10:00:00Z"
    expected: "200 with body { \"bookings\": [] }"
  - name: "boundary_starting_at_to"
    input: "r1 holding a booking from 2026-11-04T10:00:00Z to 2026-11-04T11:00:00Z; GET /rooms/r1/bookings?from=2026-11-04T09:00:00Z&to=2026-11-04T10:00:00Z"
    expected: "200 with body { \"bookings\": [] }"
  - name: "boundary_spanning_window"
    input: "r1 holding a booking from 2026-11-05T08:00:00Z to 2026-11-05T12:00:00Z; GET /rooms/r1/bookings?from=2026-11-05T09:00:00Z&to=2026-11-05T10:00:00Z"
    expected: "200 with that booking"
  - name: "no_window"
    input: "GET /rooms/r1/bookings with no query string"
    expected: "200 with every booking of the room"
  - name: "invalid_only_from"
    input: "GET /rooms/r1/bookings?from=2026-11-02T09:00:00Z"
    expected: "400; body error field invalid_query"
  - name: "invalid_to_before_from"
    input: "GET /rooms/r1/bookings?from=2026-11-02T10:00:00Z&to=2026-11-02T09:00:00Z"
    expected: "400; body error field invalid_query"
negative_oracle:
  - input_class: "invalid_only_from"
    must_fail_with: "invalid_query"
    must_not: "a 200 response"
  - input_class: "invalid_to_before_from"
    must_fail_with: "invalid_query"
    must_not: "a 200 response"
assertion_summary:
  - "a booking that starts exactly at the to value never appears in the filtered response"
  - "a booking that ends exactly at the from value never appears in the filtered response"
  - "with no query string the response equals the unfiltered list of the room"
feasibility: feasible
```

### room-booking-api:BEH-015

```yaml
id: room-booking-api:BEH-015
template: Behavior
obligation: "an incomplete or invalid from and to window answers 400 invalid_query"
input_classes:
  - name: "typical"
    input: "GET /rooms/r1/bookings?from=2026-11-02T09:00:00Z&to=2026-11-02T10:00:00Z with r1 present"
    expected: "200"
  - name: "absent_window"
    input: "GET /rooms/r1/bookings with no query string"
    expected: "200"
  - name: "invalid_only_from"
    input: "GET /rooms/r1/bookings?from=2026-11-02T09:00:00Z"
    expected: "400; body error field invalid_query"
  - name: "invalid_only_to"
    input: "GET /rooms/r1/bookings?to=2026-11-02T10:00:00Z"
    expected: "400; body error field invalid_query"
  - name: "invalid_to_equals_from"
    input: "GET /rooms/r1/bookings?from=2026-11-02T09:00:00Z&to=2026-11-02T09:00:00Z"
    expected: "400; body error field invalid_query"
  - name: "invalid_unparseable"
    input: "GET /rooms/r1/bookings?from=not-a-time&to=2026-11-02T10:00:00Z"
    expected: "400; body error field invalid_query"
  - name: "invalid_seconds_part"
    input: "GET /rooms/r1/bookings?from=2026-11-02T09:00:30Z&to=2026-11-02T10:00:00Z"
    expected: "400; body error field invalid_query"
  - name: "invalid_offset"
    input: "GET /rooms/r1/bookings?from=2026-11-02T11:00:00+02:00&to=2026-11-02T10:00:00Z"
    expected: "400; body error field invalid_query"
negative_oracle:
  - input_class: "invalid_only_from"
    must_fail_with: "invalid_query"
    must_not: "a 200 response"
  - input_class: "invalid_only_to"
    must_fail_with: "invalid_query"
    must_not: "a 200 response"
  - input_class: "invalid_to_equals_from"
    must_fail_with: "invalid_query"
    must_not: "a 200 response"
  - input_class: "invalid_unparseable"
    must_fail_with: "invalid_query"
    must_not: "a 500 status"
  - input_class: "invalid_seconds_part"
    must_fail_with: "invalid_query"
    must_not: "a 200 response"
  - input_class: "invalid_offset"
    must_fail_with: "invalid_query"
    must_not: "a 200 response"
assertion_summary:
  - "each rejected request answers 400 with body error field invalid_query and Content-Type application/json"
  - "a request with a valid window sent after each rejection answers 200"
feasibility: feasible
```

### room-booking-api:BEH-016

```yaml
id: room-booking-api:BEH-016
template: Behavior
obligation: "a booking list request for a room id that does not exist answers 404 room_not_found"
input_classes:
  - name: "typical_existing_room"
    input: "with r1 present, GET /rooms/r1/bookings"
    expected: "200"
  - name: "unknown_never_created"
    input: "GET /rooms/r99/bookings with no room r99"
    expected: "404; body error field room_not_found"
  - name: "unknown_with_window"
    input: "GET /rooms/r99/bookings?from=2026-11-02T09:00:00Z&to=2026-11-02T10:00:00Z"
    expected: "404; body error field room_not_found"
  - name: "invalid_shape_unused"
    input: "GET /rooms/R99/bookings while the state holds no room R99"
    expected: "404; body error field room_not_found"
negative_oracle:
  - input_class: "unknown_never_created"
    must_fail_with: "room_not_found"
    must_not: "a 200 response with an empty bookings array"
  - input_class: "unknown_with_window"
    must_fail_with: "room_not_found"
    must_not: "a 200 response or a 400 invalid_query response"
assertion_summary:
  - "the 404 body error field is room_not_found on every class"
  - "the GET /rooms list is unchanged after each rejected request"
feasibility: feasible
```

### room-booking-api:BEH-017

```yaml
id: room-booking-api:BEH-017
template: Behavior
obligation: "a deleted booking disappears from the booking list of its room and its interval becomes bookable"
input_classes:
  - name: "typical"
    input: "r1 holding b1 from 2026-11-02T09:00:00Z to 2026-11-02T10:00:00Z; DELETE /bookings/b1, then POST /rooms/r1/bookings from 2026-11-02T09:30:00Z to 2026-11-02T09:45:00Z"
    expected: "204 with no body, then 201"
  - name: "boundary_one_of_several"
    input: "r1 holding b1 from 09:00 to 10:00 and b2 from 10:00 to 11:00; DELETE /bookings/b1 then GET /rooms/r1/bookings and POST /rooms/r1/bookings from 09:00 to 10:00"
    expected: "204, then 200 with only b2, then 201"
  - name: "invalid_already_deleted"
    input: "DELETE /bookings/b1 sent a second time"
    expected: "404; body error field booking_not_found"
  - name: "invalid_unknown_booking"
    input: "DELETE /bookings/b404 on a state without that booking"
    expected: "404; body error field booking_not_found"
negative_oracle:
  - input_class: "invalid_already_deleted"
    must_fail_with: "booking_not_found"
    must_not: "a 204 response"
  - input_class: "invalid_unknown_booking"
    must_fail_with: "booking_not_found"
    must_not: "a 204 response or a 500 status"
assertion_summary:
  - "the 204 response carries no body"
  - "the deleted booking id is never returned by GET /rooms/r1/bookings after the delete"
  - "the interval of the deleted booking answers 201 for a new booking, never 409"
feasibility: feasible
```

### room-booking-api:BEH-018

```yaml
id: room-booking-api:BEH-018
template: Behavior
obligation: "deleting a booking id that is not in the state answers 404 booking_not_found"
input_classes:
  - name: "typical_existing"
    input: "with b1 present, DELETE /bookings/b1"
    expected: "204 with no body"
  - name: "unknown_never_assigned"
    input: "DELETE /bookings/b404 on a state without that booking"
    expected: "404; body error field booking_not_found"
  - name: "invalid_already_deleted"
    input: "DELETE /bookings/b1 immediately after the successful delete of b1"
    expected: "404; body error field booking_not_found"
  - name: "invalid_shape_unused"
    input: "DELETE /bookings/B1 while the state holds b1"
    expected: "404; body error field booking_not_found"
negative_oracle:
  - input_class: "unknown_never_assigned"
    must_fail_with: "booking_not_found"
    must_not: "a 204 response or a 500 status"
  - input_class: "invalid_already_deleted"
    must_fail_with: "booking_not_found"
    must_not: "a 204 response"
assertion_summary:
  - "the 404 body error field is booking_not_found and Content-Type is application/json"
  - "an existing booking named in another delete request is still listed by its room"
feasibility: feasible
```

### room-booking-api:BEH-019

```yaml
id: room-booking-api:BEH-019
template: Behavior
obligation: "availability returns exactly the rooms with capacity at least attendees and no overlapping booking, ordered by capacity ascending and then by ascending room id"
input_classes:
  - name: "typical"
    input: "r1 capacity 4, r2 capacity 8, r3 capacity 8 booked from 2026-11-02T09:00:00Z to 2026-11-02T10:00:00Z, r4 capacity 2; GET /availability?start=2026-11-02T09:00:00Z&end=2026-11-02T10:00:00Z&attendees=4"
    expected: "200 with r1 then r2"
  - name: "boundary_attendees_equal_capacity"
    input: "GET /availability?start=2026-11-02T11:00:00Z&end=2026-11-02T12:00:00Z&attendees=8 on the same rooms"
    expected: "200 with r2 then r3"
  - name: "boundary_touching_booking"
    input: "r3 booked from 2026-11-02T08:00:00Z to 2026-11-02T09:00:00Z; GET /availability?start=2026-11-02T09:00:00Z&end=2026-11-02T10:00:00Z&attendees=8"
    expected: "200 with r2 then r3, the touching booking excluded as non-overlapping"
  - name: "boundary_no_match"
    input: "GET /availability?start=2026-11-02T09:00:00Z&end=2026-11-02T10:00:00Z&attendees=100"
    expected: "200 with body { \"rooms\": [] }"
  - name: "invalid_missing_attendees"
    input: "GET /availability?start=2026-11-02T09:00:00Z&end=2026-11-02T10:00:00Z"
    expected: "400; body error field invalid_query"
negative_oracle:
  - input_class: "invalid_missing_attendees"
    must_fail_with: "invalid_query"
    must_not: "a 200 response"
assertion_summary:
  - "no room with an overlapping booking for the requested interval appears in the response"
  - "no room whose capacity is below the attendees value appears in the response"
  - "the capacities never decrease from one entry to the next and, for equal capacities, the room ids ascend"
  - "when every room is booked for the interval the body is { \"rooms\": [] }"
feasibility: feasible
```

### room-booking-api:BEH-020

```yaml
id: room-booking-api:BEH-020
template: Behavior
obligation: "each missing or invalid availability parameter answers 400 invalid_query"
input_classes:
  - name: "typical"
    input: "GET /availability?start=2026-11-02T09:00:00Z&end=2026-11-02T10:00:00Z&attendees=2"
    expected: "200"
  - name: "absent_all"
    input: "GET /availability"
    expected: "400; body error field invalid_query"
  - name: "invalid_missing_start"
    input: "GET /availability?end=2026-11-02T10:00:00Z&attendees=2"
    expected: "400; body error field invalid_query"
  - name: "invalid_missing_attendees"
    input: "GET /availability?start=2026-11-02T09:00:00Z&end=2026-11-02T10:00:00Z"
    expected: "400; body error field invalid_query"
  - name: "invalid_attendees_zero"
    input: "GET /availability?start=2026-11-02T09:00:00Z&end=2026-11-02T10:00:00Z&attendees=0"
    expected: "400; body error field invalid_query"
  - name: "invalid_attendees_decimal"
    input: "GET /availability?start=2026-11-02T09:00:00Z&end=2026-11-02T10:00:00Z&attendees=2.5"
    expected: "400; body error field invalid_query"
  - name: "invalid_end_equals_start"
    input: "GET /availability?start=2026-11-02T10:00:00Z&end=2026-11-02T10:00:00Z&attendees=2"
    expected: "400; body error field invalid_query"
  - name: "invalid_seconds_part"
    input: "GET /availability?start=2026-11-02T09:00:30Z&end=2026-11-02T10:00:00Z&attendees=2"
    expected: "400; body error field invalid_query"
  - name: "invalid_unparseable_time"
    input: "GET /availability?start=2026-11-02T09:00:00Z&end=2026-11-02T25:00:00Z&attendees=2"
    expected: "400; body error field invalid_query"
  - name: "invalid_offset"
    input: "GET /availability?start=2026-11-02T11:00:00+02:00&end=2026-11-02T10:00:00Z&attendees=2"
    expected: "400; body error field invalid_query"
negative_oracle:
  - input_class: "invalid_missing_start"
    must_fail_with: "invalid_query"
    must_not: "a 200 response"
  - input_class: "invalid_missing_attendees"
    must_fail_with: "invalid_query"
    must_not: "a 200 response"
  - input_class: "invalid_attendees_zero"
    must_fail_with: "invalid_query"
    must_not: "a 200 response"
  - input_class: "invalid_end_equals_start"
    must_fail_with: "invalid_query"
    must_not: "a 200 response"
  - input_class: "invalid_seconds_part"
    must_fail_with: "invalid_query"
    must_not: "a 500 status"
  - input_class: "invalid_unparseable_time"
    must_fail_with: "invalid_query"
    must_not: "a 500 status"
assertion_summary:
  - "every rejected request answers 400 with body error field invalid_query and Content-Type application/json"
  - "a fully valid request sent after each rejection answers 200"
feasibility: feasible
```

### room-booking-api:BEH-021

```yaml
id: room-booking-api:BEH-021
template: Behavior
obligation: "an unparseable request body answers 400 invalid_json on every route that accepts a body and the state is unchanged"
input_classes:
  - name: "typical_valid_json"
    input: "POST /rooms with body { \"name\": \"Focus\", \"capacity\": 6 }"
    expected: "201"
  - name: "empty_body"
    input: "POST /rooms with an empty request body"
    expected: "400; body error field invalid_json"
  - name: "invalid_truncated"
    input: "POST /rooms with body { \"name\": \"Focus\", \"capacity\":"
    expected: "400; body error field invalid_json"
  - name: "invalid_array"
    input: "POST /rooms with body []"
    expected: "400; body error field invalid_json"
  - name: "invalid_on_booking_route"
    input: "with r1 present, POST /rooms/r1/bookings with body {"
    expected: "400; body error field invalid_json"
  - name: "valid_json_invalid_fields"
    input: "POST /rooms with body { \"name\": \"\", \"capacity\": 6 }"
    expected: "400; body error field invalid_room"
negative_oracle:
  - input_class: "empty_body"
    must_fail_with: "invalid_json"
    must_not: "a 500 status or a 400 invalid_room response"
  - input_class: "invalid_truncated"
    must_fail_with: "invalid_json"
    must_not: "a 500 status"
  - input_class: "invalid_array"
    must_fail_with: "invalid_json"
    must_not: "a 201 response"
  - input_class: "invalid_on_booking_route"
    must_fail_with: "invalid_json"
    must_not: "a 500 status or a 201 response"
assertion_summary:
  - "the GET /rooms list is unchanged after every malformed request"
  - "GET /rooms sent immediately after each malformed request answers 200, so the process keeps serving"
feasibility: feasible
```

### room-booking-api:BEH-022

```yaml
id: room-booking-api:BEH-022
template: Behavior
obligation: "a request whose path matches no documented route answers 404 not_found whatever the method"
input_classes:
  - name: "typical_documented"
    input: "GET /rooms"
    expected: "200"
  - name: "boundary_one_segment_too_long"
    input: "GET /rooms/r1"
    expected: "404; body error field not_found"
  - name: "boundary_one_segment_too_short"
    input: "GET /bookings"
    expected: "404; body error field not_found"
  - name: "boundary_outside_prefixes"
    input: "GET /status"
    expected: "404; body error field not_found"
  - name: "other_method_unknown_path"
    input: "DELETE /health"
    expected: "404; body error field not_found"
negative_oracle:
  - input_class: "boundary_one_segment_too_long"
    must_fail_with: "not_found"
    must_not: "a 400 response or a 405 response"
  - input_class: "boundary_outside_prefixes"
    must_fail_with: "not_found"
    must_not: "a 405 method_not_allowed response"
  - input_class: "other_method_unknown_path"
    must_fail_with: "not_found"
    must_not: "a 405 method_not_allowed response or a 500 status"
assertion_summary:
  - "each 404 body carries error field not_found and Content-Type application/json"
  - "GET /rooms sent after each of these requests still answers 200 with the documented room list"
feasibility: feasible
```

### room-booking-api:BEH-023

```yaml
id: room-booking-api:BEH-023
template: Behavior
obligation: "a method a documented path does not support answers 405 method_not_allowed, while a method on an undocumented path answers 404 not_found"
input_classes:
  - name: "typical_documented"
    input: "GET /rooms"
    expected: "200"
  - name: "invalid_delete_on_rooms"
    input: "DELETE /rooms"
    expected: "405; body error field method_not_allowed"
  - name: "invalid_put_on_booking_list"
    input: "PUT /rooms/r1/bookings"
    expected: "405; body error field method_not_allowed"
  - name: "boundary_unsupported_on_availability"
    input: "POST /availability"
    expected: "405; body error field method_not_allowed"
  - name: "boundary_unmatched_path"
    input: "PATCH /rooms/r1"
    expected: "404; body error field not_found"
negative_oracle:
  - input_class: "invalid_delete_on_rooms"
    must_fail_with: "method_not_allowed"
    must_not: "a 404 not_found response or a 500 status"
  - input_class: "invalid_put_on_booking_list"
    must_fail_with: "method_not_allowed"
    must_not: "a 500 status or a 201 response"
  - input_class: "boundary_unmatched_path"
    must_fail_with: "not_found"
    must_not: "a 405 method_not_allowed response"
assertion_summary:
  - "the 405 body carries error field method_not_allowed and Content-Type application/json"
  - "a documented method on the same path sent afterwards still answers its documented status"
  - "the GET /rooms list is unchanged after each rejected request"
feasibility: feasible
```

### room-booking-api:BEH-024

```yaml
id: room-booking-api:BEH-024
template: Behavior
obligation: "every response carrying a body sets Content-Type application/json while the 204 response of the booking delete carries no body"
input_classes:
  - name: "typical_200"
    input: "GET /rooms"
    expected: "200 with Content-Type application/json and a JSON body"
  - name: "boundary_400"
    input: "GET /rooms?minCapacity=abc"
    expected: "400 with Content-Type application/json and body error field invalid_query"
  - name: "boundary_204"
    input: "with b1 present, DELETE /bookings/b1"
    expected: "204 with an empty body"
  - name: "boundary_409"
    input: "POST /rooms with a name already present under another case"
    expected: "409 with Content-Type application/json and body error field room_name_taken"
negative_oracle:
  - input_class: "boundary_400"
    must_fail_with: "invalid_query"
    must_not: "a text/plain Content-Type"
  - input_class: "boundary_409"
    must_fail_with: "room_name_taken"
    must_not: "a body without Content-Type application/json"
assertion_summary:
  - "every response with a body carries Content-Type application/json, never text/plain"
  - "the 204 response carries no body and no JSON document"
feasibility: feasible
```

### room-booking-api:CTR-001

```yaml
id: room-booking-api:CTR-001
template: Contract
obligation: "POST /rooms answers 201, 400 invalid_room, 400 invalid_json, 409 room_name_taken, 404 not_found or 405 method_not_allowed and no other status"
input_classes:
  - name: "typical_valid"
    input: "POST /rooms with body { \"name\": \"Focus\", \"capacity\": 6 }"
    expected: "201 with the created room"
  - name: "invalid_name"
    input: "POST /rooms with body { \"name\": \"\", \"capacity\": 6 }"
    expected: "400; body error field invalid_room"
  - name: "invalid_duplicate_other_case"
    input: "POST /rooms with body { \"name\": \"focus\", \"capacity\": 6 } while Focus exists"
    expected: "409; body error field room_name_taken"
  - name: "invalid_malformed_json"
    input: "POST /rooms with body {"
    expected: "400; body error field invalid_json"
  - name: "boundary_extra_segment"
    input: "POST /rooms/extra with a valid body"
    expected: "404; body error field not_found"
  - name: "boundary_wrong_method"
    input: "PUT /rooms with a valid body"
    expected: "405; body error field method_not_allowed"
negative_oracle:
  - input_class: "invalid_name"
    must_fail_with: "invalid_room"
    must_not: "a 500 status or a 201 response"
  - input_class: "invalid_duplicate_other_case"
    must_fail_with: "room_name_taken"
    must_not: "a 201 response"
  - input_class: "invalid_malformed_json"
    must_fail_with: "invalid_json"
    must_not: "a 500 status or a 400 invalid_room response"
  - input_class: "boundary_wrong_method"
    must_fail_with: "method_not_allowed"
    must_not: "a 404 not_found response"
assertion_summary:
  - "every response status is one of 201, 400, 404, 405 or 409 and never 200 or 500"
  - "each non-2xx body carries a JSON error field with the documented code"
  - "the GET /rooms list grows only for the 201 response"
feasibility: feasible
```

### room-booking-api:CTR-002

```yaml
id: room-booking-api:CTR-002
template: Contract
obligation: "GET /rooms answers 200, 400 invalid_query, 404 not_found or 405 method_not_allowed and lists every room in ascending room-id order"
input_classes:
  - name: "boundary_no_rooms"
    input: "GET /rooms on a freshly started process"
    expected: "200 with body { \"rooms\": [] }"
  - name: "typical_with_rooms"
    input: "with three rooms created in order, GET /rooms"
    expected: "200 with the three rooms ordered r1, r2, r3"
  - name: "invalid_min_capacity"
    input: "GET /rooms?minCapacity=0"
    expected: "400; body error field invalid_query"
  - name: "boundary_extra_segment"
    input: "GET /rooms/extra"
    expected: "404; body error field not_found"
  - name: "boundary_wrong_method"
    input: "DELETE /rooms"
    expected: "405; body error field method_not_allowed"
negative_oracle:
  - input_class: "invalid_min_capacity"
    must_fail_with: "invalid_query"
    must_not: "a 200 response"
  - input_class: "boundary_extra_segment"
    must_fail_with: "not_found"
    must_not: "a 400 response"
assertion_summary:
  - "every response status is one of 200, 400, 404 or 405 and never 500"
  - "every created room appears exactly once in the 200 response and the ids ascend"
feasibility: feasible
```

### room-booking-api:CTR-003

```yaml
id: room-booking-api:CTR-003
template: Contract
obligation: "POST /rooms/:roomId/bookings answers 201, 400 invalid_booking, 400 invalid_json, 404 room_not_found, 404 not_found, 405 method_not_allowed, 409 room_busy or 422 over_capacity and no other status"
input_classes:
  - name: "typical_valid"
    input: "with r1 capacity 6 free from 2026-11-02T09:00:00Z, POST /rooms/r1/bookings with body { \"title\": \"Standup\", \"start\": \"2026-11-02T09:00:00Z\", \"end\": \"2026-11-02T10:00:00Z\", \"attendees\": 4 }"
    expected: "201 with the created booking"
  - name: "invalid_body"
    input: "POST /rooms/r1/bookings with body { \"title\": \"\", \"start\": \"2026-11-02T11:00:00Z\", \"end\": \"2026-11-02T12:00:00Z\", \"attendees\": 4 }"
    expected: "400; body error field invalid_booking"
  - name: "invalid_malformed_json"
    input: "POST /rooms/r1/bookings with body {"
    expected: "400; body error field invalid_json"
  - name: "invalid_unknown_room"
    input: "POST /rooms/r99/bookings with a valid body"
    expected: "404; body error field room_not_found"
  - name: "boundary_extra_segment"
    input: "POST /rooms/r1/bookings/extra with a valid body"
    expected: "404; body error field not_found"
  - name: "boundary_wrong_method"
    input: "PUT /rooms/r1/bookings with a valid body"
    expected: "405; body error field method_not_allowed"
  - name: "invalid_overlapping"
    input: "POST /rooms/r1/bookings from 2026-11-02T09:30:00Z to 2026-11-02T10:30:00Z"
    expected: "409 with body error field room_busy and conflictingBookingId"
  - name: "invalid_over_capacity"
    input: "POST /rooms/r1/bookings with attendees 7 for 2026-11-02T13:00:00Z to 2026-11-02T14:00:00Z"
    expected: "422; body error field over_capacity"
negative_oracle:
  - input_class: "invalid_overlapping"
    must_fail_with: "room_busy"
    must_not: "a 201 response"
  - input_class: "invalid_over_capacity"
    must_fail_with: "over_capacity"
    must_not: "a 400 invalid_booking response or a 201 response"
  - input_class: "invalid_unknown_room"
    must_fail_with: "room_not_found"
    must_not: "a 400 invalid_booking response"
  - input_class: "boundary_wrong_method"
    must_fail_with: "method_not_allowed"
    must_not: "a 404 not_found response"
assertion_summary:
  - "every response status is one of 201, 400, 404, 405, 409 or 422 and never 500"
  - "the room_busy body always carries conflictingBookingId naming an existing booking of the same room"
  - "GET /rooms/r1/bookings grows only for the 201 response"
feasibility: feasible
```

### room-booking-api:CTR-004

```yaml
id: room-booking-api:CTR-004
template: Contract
obligation: "GET /rooms/:roomId/bookings answers 200, 400 invalid_query, 404 room_not_found, 404 not_found or 405 method_not_allowed and applies the half-open window"
input_classes:
  - name: "typical_no_window"
    input: "GET /rooms/r1/bookings on r1 holding one booking"
    expected: "200 with that booking"
  - name: "boundary_window_covers_all"
    input: "GET /rooms/r1/bookings?from=2026-11-02T00:00:00Z&to=2026-11-03T00:00:00Z with the bookings inside that range"
    expected: "200 with every booking of the room"
  - name: "boundary_touch_at_to"
    input: "with a booking starting at 2026-11-02T10:00:00Z, GET /rooms/r1/bookings?from=2026-11-02T09:00:00Z&to=2026-11-02T10:00:00Z"
    expected: "200 with body { \"bookings\": [] }"
  - name: "invalid_only_from"
    input: "GET /rooms/r1/bookings?from=2026-11-02T09:00:00Z"
    expected: "400; body error field invalid_query"
  - name: "invalid_unknown_room"
    input: "GET /rooms/r99/bookings"
    expected: "404; body error field room_not_found"
  - name: "boundary_extra_segment"
    input: "GET /rooms/r1/bookings/extra"
    expected: "404; body error field not_found"
  - name: "boundary_wrong_method"
    input: "DELETE /rooms/r1/bookings"
    expected: "405; body error field method_not_allowed"
negative_oracle:
  - input_class: "invalid_only_from"
    must_fail_with: "invalid_query"
    must_not: "a 200 response"
  - input_class: "invalid_unknown_room"
    must_fail_with: "room_not_found"
    must_not: "a 200 response with an empty bookings array"
  - input_class: "boundary_wrong_method"
    must_fail_with: "method_not_allowed"
    must_not: "a 204 response"
assertion_summary:
  - "every response status is one of 200, 400, 404 or 405 and never 500"
  - "the bookings of the 200 response ascend by start and never include a booking starting exactly at the to value"
feasibility: feasible
```

### room-booking-api:CTR-005

```yaml
id: room-booking-api:CTR-005
template: Contract
obligation: "DELETE /bookings/:bookingId answers 204, 404 booking_not_found, 404 not_found or 405 method_not_allowed and the 204 carries no body"
input_classes:
  - name: "typical_existing"
    input: "with b1 present, DELETE /bookings/b1"
    expected: "204 with no body"
  - name: "invalid_unknown_booking"
    input: "DELETE /bookings/b404"
    expected: "404; body error field booking_not_found"
  - name: "invalid_already_deleted"
    input: "DELETE /bookings/b1 sent a second time"
    expected: "404; body error field booking_not_found"
  - name: "boundary_extra_segment"
    input: "DELETE /bookings/b1/extra"
    expected: "404; body error field not_found"
  - name: "boundary_wrong_method"
    input: "GET /bookings/b1"
    expected: "405; body error field method_not_allowed"
negative_oracle:
  - input_class: "invalid_already_deleted"
    must_fail_with: "booking_not_found"
    must_not: "a 204 response"
  - input_class: "boundary_wrong_method"
    must_fail_with: "method_not_allowed"
    must_not: "a 200 response or a 404 not_found response"
assertion_summary:
  - "every response status is one of 204, 404 or 405 and never 500"
  - "the 204 response carries no body and the deleted booking is absent from the later booking list of its room"
feasibility: feasible
```

### room-booking-api:CTR-006

```yaml
id: room-booking-api:CTR-006
template: Contract
obligation: "GET /availability answers 200, 400 invalid_query, 404 not_found or 405 method_not_allowed and returns exactly the free rooms with sufficient capacity"
input_classes:
  - name: "typical_every_room_free"
    input: "r1 capacity 4 and r2 capacity 8 with no bookings; GET /availability?start=2026-11-02T09:00:00Z&end=2026-11-02T10:00:00Z&attendees=4"
    expected: "200 with r1 then r2"
  - name: "boundary_every_room_booked"
    input: "r1 and r2 both booked across the interval; GET /availability?start=2026-11-02T09:00:00Z&end=2026-11-02T10:00:00Z&attendees=1"
    expected: "200 with body { \"rooms\": [] }"
  - name: "boundary_attendees_equal_capacity"
    input: "GET /availability?start=2026-11-02T11:00:00Z&end=2026-11-02T12:00:00Z&attendees=8"
    expected: "200 with r2 only"
  - name: "invalid_attendees_not_positive"
    input: "GET /availability?start=2026-11-02T09:00:00Z&end=2026-11-02T10:00:00Z&attendees=0"
    expected: "400; body error field invalid_query"
  - name: "boundary_extra_segment"
    input: "GET /availability/extra?start=2026-11-02T09:00:00Z&end=2026-11-02T10:00:00Z&attendees=1"
    expected: "404; body error field not_found"
  - name: "boundary_wrong_method"
    input: "POST /availability with the three query parameters"
    expected: "405; body error field method_not_allowed"
negative_oracle:
  - input_class: "invalid_attendees_not_positive"
    must_fail_with: "invalid_query"
    must_not: "a 200 response"
  - input_class: "boundary_wrong_method"
    must_fail_with: "method_not_allowed"
    must_not: "a 404 not_found response"
assertion_summary:
  - "every response status is one of 200, 400, 404 or 405 and never 500"
  - "a room with an overlapping booking for the interval never appears in the 200 response"
  - "the response orders rooms by ascending capacity and then by ascending room id"
feasibility: feasible
```

### room-booking-api:CTR-007

```yaml
id: room-booking-api:CTR-007
template: Contract
obligation: "every room object in a response carries exactly the id, name and capacity fields with the documented types"
input_classes:
  - name: "boundary_name_40"
    input: "POST /rooms with a 40-character name and capacity 6, then GET /rooms"
    expected: "each room object carries id, name and capacity with the name equal to the submitted 40 characters"
  - name: "boundary_capacity_1"
    input: "POST /rooms with body { \"name\": \"Nook\", \"capacity\": 1 }"
    expected: "the 201 room object carries capacity 1 as a JSON number"
  - name: "boundary_capacity_100"
    input: "POST /rooms with body { \"name\": \"Hall\", \"capacity\": 100 }"
    expected: "the 201 room object carries capacity 100 as a JSON number"
  - name: "invalid_capacity_as_string"
    input: "POST /rooms with body { \"name\": \"Lab\", \"capacity\": \"6\" }"
    expected: "400; body error field invalid_room"
negative_oracle:
  - input_class: "invalid_capacity_as_string"
    must_fail_with: "invalid_room"
    must_not: "a 201 response carrying a room whose capacity is a string"
assertion_summary:
  - "every room object returned by POST /rooms, GET /rooms and GET /availability carries an id with the r prefix, a name and an integer capacity"
  - "no room object lacks id, name or capacity"
  - "capacity is always a JSON number, never a string"
feasibility: feasible
```

### room-booking-api:CTR-008

```yaml
id: room-booking-api:CTR-008
template: Contract
obligation: "every booking object in a response carries exactly the id, roomId, title, start, end and attendees fields with the documented types"
input_classes:
  - name: "boundary_title_80"
    input: "with r1 capacity 10, POST /rooms/r1/bookings with an 80-character title from 2026-11-02T09:00:00Z to 2026-11-02T10:00:00Z"
    expected: "201 with the six fields and the submitted title"
  - name: "boundary_attendees_1"
    input: "POST /rooms/r1/bookings with attendees 1"
    expected: "201 with attendees 1 as a JSON number"
  - name: "boundary_whole_minutes"
    input: "POST /rooms/r1/bookings from 2026-11-03T09:30:00Z to 2026-11-03T10:00:00Z, then GET /rooms/r1/bookings"
    expected: "start and end echoed as 2026-11-03T09:30:00Z and 2026-11-03T10:00:00Z"
  - name: "invalid_non_utc_start"
    input: "POST /rooms/r1/bookings with start 2026-11-04T11:00:00+02:00 and end 2026-11-04T12:00:00Z"
    expected: "400; body error field invalid_booking"
  - name: "invalid_over_capacity"
    input: "with r1 capacity 6, POST /rooms/r1/bookings with attendees 7"
    expected: "422; body error field over_capacity"
negative_oracle:
  - input_class: "invalid_non_utc_start"
    must_fail_with: "invalid_booking"
    must_not: "a 201 response whose start carries an offset instead of the Z designator"
  - input_class: "invalid_over_capacity"
    must_fail_with: "over_capacity"
    must_not: "a 201 response"
assertion_summary:
  - "every booking object in the POST 201 body and in the GET booking list carries id, roomId, title, start, end and attendees"
  - "roomId equals the room in the path and attendees is a JSON number"
  - "start and end always carry the Z designator with a seconds part of 00"
feasibility: feasible
```

### room-booking-api:CTR-009

```yaml
id: room-booking-api:CTR-009
template: Contract
obligation: "a time with the Z designator and 00 seconds is accepted while a non-UTC offset, a non-zero seconds part, a fractional seconds part or an unparseable calendar value is refused by the route that consumes it"
input_classes:
  - name: "typical_accepted_write_time"
    input: "with r1 capacity 10, POST /rooms/r1/bookings from 2026-11-02T09:30:00Z to 2026-11-02T10:00:00Z"
    expected: "201 with start and end echoed in the same form"
  - name: "invalid_write_seconds"
    input: "POST /rooms/r1/bookings with start 2026-11-02T11:00:30Z and end 2026-11-02T12:00:00Z"
    expected: "400; body error field invalid_booking"
  - name: "invalid_write_offset"
    input: "POST /rooms/r1/bookings with start 2026-11-02T11:00:00+02:00 and end 2026-11-02T12:00:00Z"
    expected: "400; body error field invalid_booking"
  - name: "invalid_unparseable_calendar"
    input: "POST /rooms/r1/bookings with start 2026-02-30T09:00:00Z and end 2026-03-01T10:00:00Z"
    expected: "400; body error field invalid_booking"
  - name: "invalid_fractional_seconds"
    input: "POST /rooms/r1/bookings with start 2026-11-02T09:30:00.500Z and end 2026-11-02T10:00:00Z"
    expected: "400; body error field invalid_booking"
  - name: "invalid_query_seconds"
    input: "GET /rooms/r1/bookings?from=2026-11-02T09:00:30Z&to=2026-11-02T10:00:00Z"
    expected: "400; body error field invalid_query"
  - name: "invalid_query_offset"
    input: "GET /availability?start=2026-11-02T11:00:00+02:00&end=2026-11-02T10:00:00Z&attendees=1"
    expected: "400; body error field invalid_query"
negative_oracle:
  - input_class: "invalid_write_offset"
    must_fail_with: "invalid_booking"
    must_not: "a 201 response"
  - input_class: "invalid_write_seconds"
    must_fail_with: "invalid_booking"
    must_not: "a 201 response"
  - input_class: "invalid_fractional_seconds"
    must_fail_with: "invalid_booking"
    must_not: "a 201 response"
  - input_class: "invalid_unparseable_calendar"
    must_fail_with: "invalid_booking"
    must_not: "a 201 response or a 500 status"
  - input_class: "invalid_query_seconds"
    must_fail_with: "invalid_query"
    must_not: "a 200 response"
  - input_class: "invalid_query_offset"
    must_fail_with: "invalid_query"
    must_not: "a 200 response"
assertion_summary:
  - "every accepted time is echoed with the Z designator and a seconds part of 00"
  - "no rejected class creates a booking or changes the booking list of the room"
  - "the interval reading is half-open, so a booking ending at 2026-11-02T10:00:00Z and one starting at that instant both exist"
feasibility: feasible
```

### room-booking-api:CTR-010

```yaml
id: room-booking-api:CTR-010
template: Contract
obligation: "every non-2xx response carries a JSON body whose error field is a snake_case code of the taxonomy and the documented content type"
input_classes:
  - name: "invalid_unknown_route"
    input: "GET /rooms/r1"
    expected: "404; body error field not_found"
  - name: "invalid_unsupported_method"
    input: "DELETE /rooms"
    expected: "405; body error field method_not_allowed"
  - name: "invalid_malformed_body"
    input: "POST /rooms with body {"
    expected: "400; body error field invalid_json"
  - name: "invalid_validation_failure"
    input: "POST /rooms with body { \"name\": \"\", \"capacity\": 6 }"
    expected: "400; body error field invalid_room"
  - name: "invalid_conflict"
    input: "with r1 booked from 2026-11-02T09:00:00Z to 2026-11-02T10:00:00Z, POST /rooms/r1/bookings from 2026-11-02T09:30:00Z to 2026-11-02T10:30:00Z"
    expected: "409 with body error field room_busy and conflictingBookingId"
  - name: "invalid_over_capacity"
    input: "with r1 capacity 6, POST /rooms/r1/bookings with attendees 7"
    expected: "422; body error field over_capacity"
  - name: "invalid_unknown_room"
    input: "POST /rooms/r99/bookings with a valid body"
    expected: "404; body error field room_not_found"
  - name: "invalid_unknown_booking"
    input: "DELETE /bookings/b404"
    expected: "404; body error field booking_not_found"
negative_oracle:
  - input_class: "invalid_validation_failure"
    must_fail_with: "invalid_room"
    must_not: "a body whose error field is free text"
  - input_class: "invalid_conflict"
    must_fail_with: "room_busy"
    must_not: "a room_busy body without conflictingBookingId or a conflictingBookingId on any other code"
  - input_class: "invalid_unknown_route"
    must_fail_with: "not_found"
    must_not: "a missing Content-Type header"
  - input_class: "invalid_malformed_body"
    must_fail_with: "invalid_json"
    must_not: "a 500 status"
assertion_summary:
  - "every non-2xx body is a JSON object whose error value matches lower snake_case without spaces"
  - "the conflictingBookingId field appears only on room_busy bodies"
  - "every non-2xx response with a body carries Content-Type application/json"
feasibility: feasible
```

### room-booking-api:CTR-011

```yaml
id: room-booking-api:CTR-011
template: Contract
obligation: "with the PORT variable set the routes answer on that port and with PORT unset they answer on port 3000"
input_classes:
  - name: "port_set"
    input: "start the process with PORT set to a free high port, then GET /rooms on that port"
    expected: "200 with body { \"rooms\": [] }"
  - name: "port_unset"
    input: "start the process with PORT unset, then GET /rooms on port 3000"
    expected: "200 with body { \"rooms\": [] }"
negative_oracle: []
assertion_summary:
  - "with PORT set, a request to port 3000 never answers, so the process does not fall back to the default port"
  - "with PORT unset, a request to port 3000 answers 200 rather than failing to connect"
feasibility: infeasible_candidate
infeasibility_reason: "the port_unset class requires binding the fixed machine-wide port 3000, so the observation depends on host state that no boundary stimulus controls; a concurrent listener on 3000 makes the answer non-deterministic"
```

### room-booking-api:INV-001

```yaml
id: room-booking-api:INV-001
template: Invariant
obligation: "assigned ids always follow the creation order with the documented prefixes, room ids restarting nowhere and booking ids shared across all rooms"
input_classes:
  - name: "first_room"
    input: "create one room on a freshly started process, then GET /rooms"
    expected: "the only room carries id r1"
  - name: "tenth_room"
    input: "create ten rooms in order, then GET /rooms"
    expected: "the ids are r1 through r10 in creation order with no gap"
  - name: "bookings_two_rooms"
    input: "create r1 and r2, book r1 then r2, then GET the booking list of each room"
    expected: "the first booking carries b1 and the second b2, even though the rooms differ"
  - name: "client_supplied_id"
    input: "POST /rooms with body { \"name\": \"Focus\", \"capacity\": 6, \"id\": \"r99\" }"
    expected: "201 with a server-assigned id; no room r99 in GET /rooms"
negative_oracle: []
assertion_summary:
  - "every room id matches an r followed by a positive integer and every booking id a b followed by a positive integer"
  - "the numeric parts appear in creation order with a step of exactly one and never restart for a second room"
  - "a client-supplied id is never echoed as the id of a created resource"
feasibility: feasible
```

### room-booking-api:INV-002

```yaml
id: room-booking-api:INV-002
template: Invariant
obligation: "no two bookings of one room ever overlap under the half-open reading"
input_classes:
  - name: "boundary_adjacent"
    input: "with r1 booked from 2026-11-02T09:00:00Z to 2026-11-02T10:00:00Z, POST /rooms/r1/bookings from 2026-11-02T10:00:00Z to 2026-11-02T11:00:00Z"
    expected: "201 and both bookings listed"
  - name: "invalid_identical"
    input: "with r1 booked from 2026-11-02T09:00:00Z to 2026-11-02T10:00:00Z, POST the same interval again"
    expected: "409; body error field room_busy"
  - name: "invalid_partial_overlap"
    input: "with r1 booked from 2026-11-02T09:00:00Z to 2026-11-02T10:00:00Z, POST /rooms/r1/bookings from 2026-11-03T09:30:00Z to 2026-11-03T10:30:00Z"
    expected: "409; body error field room_busy"
  - name: "invalid_zero_length"
    input: "POST /rooms/r1/bookings from 2026-11-02T12:00:00Z to 2026-11-02T12:00:00Z"
    expected: "400; body error field invalid_booking"
negative_oracle:
  - input_class: "invalid_identical"
    must_fail_with: "room_busy"
    must_not: "a 201 response or a stored pair of overlapping bookings"
  - input_class: "invalid_partial_overlap"
    must_fail_with: "room_busy"
    must_not: "a 201 response"
  - input_class: "invalid_zero_length"
    must_fail_with: "invalid_booking"
    must_not: "a 201 response storing a zero-length booking"
assertion_summary:
  - "the booking list of a room returned by GET /rooms/:roomId/bookings never holds two entries sharing at least one instant"
  - "an adjacent interval is always accepted and never rejected with room_busy"
feasibility: feasible
```

### room-booking-api:INV-003

```yaml
id: room-booking-api:INV-003
template: Invariant
obligation: "every response with a status of 400 or above carries a JSON body whose error field holds a stable snake_case code and never free-text prose"
input_classes:
  - name: "status_400"
    input: "GET /rooms?minCapacity=abc"
    expected: "400 with body error field invalid_query"
  - name: "status_404"
    input: "DELETE /bookings/b404"
    expected: "404 with body error field booking_not_found"
  - name: "status_409"
    input: "while a room named Focus exists, POST /rooms with body { \"name\": \"focus\", \"capacity\": 6 }"
    expected: "409 with body error field room_name_taken"
  - name: "status_422"
    input: "with r1 capacity 6, POST /rooms/r1/bookings with attendees 7"
    expected: "422 with body error field over_capacity"
negative_oracle:
  - input_class: "status_400"
    must_fail_with: "invalid_query"
    must_not: "a body that is a bare string or a sentence"
  - input_class: "status_404"
    must_fail_with: "booking_not_found"
    must_not: "a body without an error field"
  - input_class: "status_409"
    must_fail_with: "room_name_taken"
    must_not: "an error value containing a space"
  - input_class: "status_422"
    must_fail_with: "over_capacity"
    must_not: "a prose error value"
assertion_summary:
  - "every body of a response with status 400 or above is a JSON object with an error field"
  - "the error value matches lower snake_case and never contains a space or a full stop"
feasibility: feasible
```

### room-booking-api:INV-004

```yaml
id: room-booking-api:INV-004
template: Invariant
obligation: "a restarted process exposes an empty state"
input_classes:
  - name: "restart_empty"
    input: "start the process and GET /rooms without creating anything"
    expected: "200 with body { \"rooms\": [] }"
  - name: "restart_after_data"
    input: "create two rooms and one booking, stop the process, start it again, then GET /rooms and GET /rooms/r1/bookings"
    expected: "200 with body { \"rooms\": [] }, then 404 with body error field room_not_found"
negative_oracle:
  - input_class: "restart_after_data"
    must_fail_with: "room_not_found"
    must_not: "the room id created before the restart appearing again"
assertion_summary:
  - "the GET /rooms response after a restart is empty whatever was created before the restart"
  - "the first room created after a restart carries id r1 and the first booking b1"
feasibility: feasible
```

### room-booking-api:INV-005

```yaml
id: room-booking-api:INV-005
template: Invariant
obligation: "no two rooms share a name under case-insensitive comparison and each stored name keeps the spelling the client sent"
input_classes:
  - name: "invalid_identical"
    input: "create a room named Focus, then POST /rooms with body { \"name\": \"Focus\", \"capacity\": 6 }"
    expected: "409; body error field room_name_taken"
  - name: "invalid_case_only"
    input: "create a room named Focus, then POST /rooms with body { \"name\": \"focus\", \"capacity\": 6 }"
    expected: "409; body error field room_name_taken"
  - name: "boundary_one_char_diff"
    input: "create a room named Focus, then POST /rooms with body { \"name\": \"Field\", \"capacity\": 6 }, then GET /rooms"
    expected: "201 and both names listed with their submitted spelling"
negative_oracle:
  - input_class: "invalid_case_only"
    must_fail_with: "room_name_taken"
    must_not: "a 201 response or two rooms whose names are equal after lower-casing"
  - input_class: "invalid_identical"
    must_fail_with: "room_name_taken"
    must_not: "a 201 response"
assertion_summary:
  - "the GET /rooms list never holds two names equal after lower-casing"
  - "each stored name equals the submitted spelling and is never lower-cased in the response"
feasibility: feasible
```

### room-booking-api:POL-001

```yaml
id: room-booking-api:POL-001
template: Policy
obligation: "every error path answers the documented status and code, with conflictingBookingId present only on room_busy"
input_classes:
  - name: "validation_error"
    input: "POST /rooms with body { \"name\": \"\", \"capacity\": 6 }"
    expected: "400 with body error field invalid_room and no conflictingBookingId"
  - name: "routing_error"
    input: "GET /rooms/r1"
    expected: "404 with body error field not_found and no conflictingBookingId"
  - name: "conflict_error"
    input: "with r1 booked from 2026-11-02T09:00:00Z to 2026-11-02T10:00:00Z, POST /rooms/r1/bookings from 2026-11-02T09:30:00Z to 2026-11-02T10:30:00Z"
    expected: "409 with body error field room_busy and conflictingBookingId naming the existing booking"
negative_oracle:
  - input_class: "validation_error"
    must_fail_with: "invalid_room"
    must_not: "a 500 status or an error field holding a prose sentence"
  - input_class: "conflict_error"
    must_fail_with: "room_busy"
    must_not: "a room_busy body without conflictingBookingId"
  - input_class: "routing_error"
    must_fail_with: "not_found"
    must_not: "a non-snake_case error value"
assertion_summary:
  - "each error body carries an error field matching lower snake_case"
  - "conflictingBookingId appears only on room_busy bodies"
  - "no documented validation failure answers 500"
feasibility: feasible
```

### room-booking-api:POL-002

```yaml
id: room-booking-api:POL-002
template: Policy
obligation: "every missing, mistyped, malformed or out-of-range input is answered with its documented 400 or 422 status while the process keeps serving subsequent requests"
input_classes:
  - name: "malformed_json"
    input: "POST /rooms with body {"
    expected: "400 with body error field invalid_json"
  - name: "wrong_field_types"
    input: "POST /rooms with body { \"name\": \"Focus\", \"capacity\": \"six\" }"
    expected: "400 with body error field invalid_room"
  - name: "out_of_range"
    input: "POST /rooms with body { \"name\": \"Focus\", \"capacity\": 101 }"
    expected: "400 with body error field invalid_room"
  - name: "invalid_query_parameter"
    input: "GET /rooms?minCapacity=abc"
    expected: "400 with body error field invalid_query"
  - name: "above_capacity"
    input: "with r1 capacity 6, POST /rooms/r1/bookings with attendees 7"
    expected: "422 with body error field over_capacity"
negative_oracle:
  - input_class: "malformed_json"
    must_fail_with: "invalid_json"
    must_not: "a 500 status or a process that stops answering"
  - input_class: "wrong_field_types"
    must_fail_with: "invalid_room"
    must_not: "a room whose capacity is a string in the GET /rooms list"
  - input_class: "invalid_query_parameter"
    must_fail_with: "invalid_query"
    must_not: "a 500 status"
  - input_class: "above_capacity"
    must_fail_with: "over_capacity"
    must_not: "a stored booking above the room capacity"
assertion_summary:
  - "each rejected request answers its documented status with a JSON error body and no stack trace"
  - "a GET /rooms request sent immediately after each rejection answers 200, so the process never exits"
  - "the state is unchanged after every rejection"
feasibility: feasible
```

## 4. Infeasible candidates

- `room-booking-api:CTR-011` — the `port_unset` class requires binding the fixed machine-wide port 3000, so the outcome depends on host state that no boundary stimulus controls: a concurrent listener on 3000 makes the observation non-deterministic and indistinguishable from a process that failed to start. It would become feasible with a guarantee that port 3000 is free on the test host, or with an operator-visible way to read the effective listen port without binding it.
