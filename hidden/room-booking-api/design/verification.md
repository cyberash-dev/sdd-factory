# Verification design: room-booking-api

## 1. Scope

48 blocks, one per approved record whose template is Behavior, Contract, Invariant, Scenario or Policy, in spec order.

| template | blocks |
| --- | --- |
| Behavior | 28 (room-booking-api:BEH-001 … BEH-028) |
| Contract | 7 (room-booking-api:CTR-001 … CTR-007) |
| Invariant | 7 (room-booking-api:INV-001 … INV-007) |
| Scenario | 4 (room-booking-api:SCN-001 … SCN-004) |
| Policy | 2 (room-booking-api:POL-001, POL-002) |

IDs skipped and why:

- `room-booking-api` (the Partition record): not a testable record.
- `room-booking-api:BL-001` (BrownfieldBaseline): not a testable record.
- `room-booking-api:SUR-001` (Surface): excluded by this role.
- `room-booking-api:CN-001`, `CN-002`, `CN-003` (Constraint): excluded by this role.
- `room-booking-api:OQ-001` … `OQ-009` (Open-Q): a question, not a behavior.
- `room-booking-api:ASM-001` … `ASM-010` (ASSUMPTION): a recorded default; each is verified through the Behavior and Contract records its `tests` member names.

## 2. Error oracle

Every error body is JSON, carries the member `error` with a stable snake_case code, carries the member `conflictingBookingId` on `room_busy`, and is served with Content-Type `application/json`.

| error code | observable signal | source record |
| --- | --- | --- |
| invalid_json | HTTP 400, `error` member equal to `invalid_json` | POL-001, CTR-001, CTR-003, CTR-007, ASM-010 |
| invalid_room | HTTP 400, `error` member equal to `invalid_room` | POL-001, CTR-001 |
| room_name_taken | HTTP 409, `error` member equal to `room_name_taken` | POL-001, CTR-001 |
| invalid_query | HTTP 400, `error` member equal to `invalid_query` | POL-001, CTR-002, CTR-004, CTR-006 |
| room_not_found | HTTP 404, `error` member equal to `room_not_found` | POL-001, CTR-003, CTR-004 |
| invalid_booking | HTTP 400, `error` member equal to `invalid_booking` | POL-001, CTR-003 |
| over_capacity | HTTP 422, `error` member equal to `over_capacity` | POL-001, CTR-003 |
| room_busy | HTTP 409, `error` member equal to `room_busy` plus the member `conflictingBookingId` | POL-001, CTR-003, CTR-007 |
| booking_not_found | HTTP 404, `error` member equal to `booking_not_found` | POL-001, CTR-005 |
| not_found | HTTP 404, `error` member equal to `not_found` | POL-001, CTR-007 |
| method_not_allowed | HTTP 405, `error` member equal to `method_not_allowed` | POL-001, CTR-007 |

## 3. Blocks

### room-booking-api:BEH-001

```yaml
id: room-booking-api:BEH-001
template: Behavior
obligation: "A valid room body answers 201 with the next room id in creation order, the store grows by exactly one room, and a member beyond name and capacity is neither stored nor echoed."
input_classes:
  - name: typical
    input: "POST /rooms with body {\"name\": \"Aurora\", \"capacity\": 10} while the store holds the rooms r1, r2 and r3"
    expected: "201, Content-Type application/json, body {\"id\": \"r4\", \"name\": \"Aurora\", \"capacity\": 10}"
  - name: empty
    input: "POST /rooms with body {\"name\": \"Aurora\", \"capacity\": 10} on a freshly started process with an empty store"
    expected: "201 with body id r1; a following GET /rooms answers 200 with exactly one room"
  - name: boundary_eleventh_room
    input: "POST /rooms with body {\"name\": \"Aurora\", \"capacity\": 10} after ten rooms were created in order, r1 to r10"
    expected: "201 with id r11; GET /rooms lists r11 after r10"
  - name: boundary_extra_member
    input: "POST /rooms with body {\"name\": \"Borealis\", \"capacity\": 10, \"floor\": 3}"
    expected: "201 whose body carries exactly id, name and capacity, with no floor member"
  - name: invalid_capacity_below_range
    input: "POST /rooms with body {\"name\": \"Aurora\", \"capacity\": 0}"
    expected: "invalid_room; HTTP 400; the store still holds the same number of rooms"
negative_oracle:
  - input_class: invalid_capacity_below_range
    must_fail_with: "invalid_room"
    must_not: "a 201 response, a room id in the body, or a room added to the store"
assertion_summary:
  - "POST /rooms with a valid body answers status 201, never 200."
  - "the response body carries exactly the members id, name and capacity and the id continues the creation-order sequence."
  - "the extra member floor never appears in the response body and never reappears in a later GET /rooms listing."
feasibility: feasible
```

### room-booking-api:BEH-002

```yaml
id: room-booking-api:BEH-002
template: Behavior
obligation: "An empty, over-long, absent or non-string name answers 400 invalid_room without adding a room, while a whitespace-only name is created and echoed verbatim."
input_classes:
  - name: typical
    input: "POST /rooms with body {\"name\": \"Aurora\", \"capacity\": 10}"
    expected: "201 with the name Aurora echoed unchanged"
  - name: boundary_forty_characters
    input: "POST /rooms with a name of forty repetitions of the letter A and capacity 10"
    expected: "201 with the forty-character name echoed unchanged"
  - name: boundary_forty_one_characters
    input: "POST /rooms with a name of forty-one repetitions of the letter A and capacity 10"
    expected: "invalid_room; HTTP 400"
  - name: empty_string
    input: "POST /rooms with body {\"name\": \"\", \"capacity\": 10}"
    expected: "invalid_room; HTTP 400"
  - name: absent_member
    input: "POST /rooms with body {\"capacity\": 10}"
    expected: "invalid_room; HTTP 400"
  - name: boundary_whitespace_only
    input: "POST /rooms with body {\"name\": \" \", \"capacity\": 10}"
    expected: "201 with the name one space, echoed verbatim"
  - name: invalid_non_string
    input: "POST /rooms with body {\"name\": 42, \"capacity\": 10}"
    expected: "invalid_room; HTTP 400"
negative_oracle:
  - input_class: boundary_forty_one_characters
    must_fail_with: "invalid_room"
    must_not: "a 201 response or a room added to the store"
  - input_class: empty_string
    must_fail_with: "invalid_room"
    must_not: "a 201 response or a room added to the store"
  - input_class: invalid_non_string
    must_fail_with: "invalid_room"
    must_not: "a 201 response or a room added to the store"
assertion_summary:
  - "every rejected attempt answers status 400 with a JSON body whose error member is invalid_room, never invalid_json."
  - "GET /rooms after each rejected attempt still lists the same rooms as before the attempt."
  - "the whitespace-only name answers 201 and the stored name is the submitted single space, never a trimmed empty string."
feasibility: feasible
```

### room-booking-api:BEH-003

```yaml
id: room-booking-api:BEH-003
template: Behavior
obligation: "A capacity outside the integer range 1..100 or absent from the body answers 400 invalid_room and leaves the store unchanged."
input_classes:
  - name: typical
    input: "POST /rooms with body {\"name\": \"Aurora\", \"capacity\": 10}"
    expected: "201 with capacity 10"
  - name: boundary_lowest
    input: "POST /rooms with body {\"name\": \"Aurora\", \"capacity\": 1}"
    expected: "201 with capacity 1"
  - name: boundary_highest
    input: "POST /rooms with body {\"name\": \"Borealis\", \"capacity\": 100}"
    expected: "201 with capacity 100"
  - name: boundary_above_range
    input: "POST /rooms with body {\"name\": \"Cepheus\", \"capacity\": 101}"
    expected: "invalid_room; HTTP 400"
  - name: invalid_below_range
    input: "POST /rooms with body {\"name\": \"Draco\", \"capacity\": 0}"
    expected: "invalid_room; HTTP 400"
  - name: invalid_non_integer
    input: "POST /rooms with body {\"name\": \"Eridanus\", \"capacity\": 2.5}"
    expected: "invalid_room; HTTP 400"
  - name: absent_member
    input: "POST /rooms with body {\"name\": \"Fornax\"}"
    expected: "invalid_room; HTTP 400"
negative_oracle:
  - input_class: boundary_above_range
    must_fail_with: "invalid_room"
    must_not: "a 201 response or a room added to the store"
  - input_class: invalid_non_integer
    must_fail_with: "invalid_room"
    must_not: "a 201 response with the capacity rounded to 2 or 3"
  - input_class: absent_member
    must_fail_with: "invalid_room"
    must_not: "a 201 response or a room added with a default capacity"
assertion_summary:
  - "capacity 1 and capacity 100 are accepted with status 201 and echoed unchanged."
  - "every rejected attempt answers 400 with the error member invalid_room."
  - "GET /rooms after each rejected attempt lists the same rooms as before."
feasibility: feasible
```

### room-booking-api:BEH-004

```yaml
id: room-booking-api:BEH-004
template: Behavior
obligation: "A name equal to an existing name ignoring case answers 409 room_name_taken, the existing room is unchanged and no room is added."
input_classes:
  - name: typical_distinct_name
    input: "POST /rooms with body {\"name\": \"Borealis\", \"capacity\": 10} while the store holds a room named Aurora"
    expected: "201 with a room id after the existing one"
  - name: empty_store
    input: "POST /rooms with body {\"name\": \"Aurora\", \"capacity\": 4} on an empty store"
    expected: "201 with id r1"
  - name: boundary_identical_name
    input: "POST /rooms with body {\"name\": \"Aurora\", \"capacity\": 10} while the store holds a room named Aurora"
    expected: "room_name_taken; HTTP 409"
  - name: boundary_case_lower
    input: "POST /rooms with body {\"name\": \"aurora\", \"capacity\": 20} while the store holds a room named Aurora"
    expected: "room_name_taken; HTTP 409"
  - name: boundary_case_upper
    input: "POST /rooms with body {\"name\": \"AURORA\", \"capacity\": 10} while the store holds a room named Aurora"
    expected: "room_name_taken; HTTP 409"
negative_oracle:
  - input_class: boundary_case_lower
    must_fail_with: "room_name_taken"
    must_not: "a 201 response or a second room whose name differs only in case"
  - input_class: boundary_identical_name
    must_fail_with: "room_name_taken"
    must_not: "a 201 response or a room added to the store"
  - input_class: boundary_case_upper
    must_fail_with: "room_name_taken"
    must_not: "a 201 response or a change to the existing room"
assertion_summary:
  - "the rejected attempts answer status 409 with the error member room_name_taken."
  - "GET /rooms still lists exactly one room with the name Aurora, with its original id and capacity."
  - "the distinct name Borealis answers 201 with a new room id."
feasibility: feasible
```

### room-booking-api:BEH-005

```yaml
id: room-booking-api:BEH-005
template: Behavior
obligation: "GET /rooms returns every room exactly once, ordered by the creation order of the room ids, each room carrying exactly id, name and capacity."
input_classes:
  - name: typical
    input: "GET /rooms while the store holds r1 Aurora capacity 4, r2 Borealis capacity 10 and r3 Cepheus capacity 10"
    expected: "200 with body {\"rooms\": [...]} listing r1, r2, r3 in that order, each carrying exactly id, name and capacity"
  - name: empty
    input: "GET /rooms on a freshly started process with an empty store"
    expected: "200 with body {\"rooms\": []}"
  - name: boundary_ten_rooms
    input: "GET /rooms while the store holds r1 to r10, r10 created after r2"
    expected: "200 listing r2 before r10, in creation order"
  - name: invalid_min_capacity_zero
    input: "GET /rooms?minCapacity=0"
    expected: "invalid_query; HTTP 400"
negative_oracle:
  - input_class: invalid_min_capacity_zero
    must_fail_with: "invalid_query"
    must_not: "a 200 response listing every room as if no filter were given"
assertion_summary:
  - "the response body has exactly the member rooms and each element carries exactly id, name and capacity."
  - "the elements appear in creation order of the room ids, so r2 precedes r10."
  - "no room appears twice in the list."
feasibility: feasible
```

### room-booking-api:BEH-006

```yaml
id: room-booking-api:BEH-006
template: Behavior
obligation: "Only rooms with capacity greater than or equal to minCapacity are returned, in id order, and a room whose capacity equals minCapacity is included."
input_classes:
  - name: typical
    input: "GET /rooms?minCapacity=10 while the store holds r1 capacity 4, r2 capacity 10 and r3 capacity 10 created later"
    expected: "200 listing r2 then r3 only"
  - name: boundary_equal_capacity
    input: "GET /rooms?minCapacity=4 on the same store"
    expected: "200 listing r1, r2 and r3"
  - name: boundary_above_every_capacity
    input: "GET /rooms?minCapacity=101 on the same store"
    expected: "200 with body {\"rooms\": []}"
  - name: empty
    input: "GET /rooms?minCapacity=1 on an empty store"
    expected: "200 with body {\"rooms\": []}"
  - name: invalid_threshold_text
    input: "GET /rooms?minCapacity=abc"
    expected: "invalid_query; HTTP 400"
negative_oracle:
  - input_class: invalid_threshold_text
    must_fail_with: "invalid_query"
    must_not: "a 200 response listing every room"
assertion_summary:
  - "no room with a capacity below minCapacity appears in the response, and a room with capacity equal to minCapacity does appear."
  - "the filtered rooms keep the id order of the full list."
  - "the response body has exactly the member rooms."
feasibility: feasible
```

### room-booking-api:BEH-007

```yaml
id: room-booking-api:BEH-007
template: Behavior
obligation: "A minCapacity value that is not a positive integer answers 400 invalid_query."
input_classes:
  - name: typical
    input: "GET /rooms?minCapacity=3 while the store holds a room of capacity 4 and a room of capacity 10"
    expected: "200 listing both rooms"
  - name: boundary_zero
    input: "GET /rooms?minCapacity=0"
    expected: "invalid_query; HTTP 400"
  - name: invalid_negative_integer
    input: "GET /rooms?minCapacity=-1"
    expected: "invalid_query; HTTP 400"
  - name: invalid_fraction
    input: "GET /rooms?minCapacity=2.5"
    expected: "invalid_query; HTTP 400"
  - name: invalid_text
    input: "GET /rooms?minCapacity=abc"
    expected: "invalid_query; HTTP 400"
  - name: empty_value
    input: "GET /rooms?minCapacity="
    expected: "invalid_query; HTTP 400"
negative_oracle:
  - input_class: boundary_zero
    must_fail_with: "invalid_query"
    must_not: "a 200 response treating zero as no filter"
  - input_class: invalid_negative_integer
    must_fail_with: "invalid_query"
    must_not: "a 200 response listing rooms"
  - input_class: empty_value
    must_fail_with: "invalid_query"
    must_not: "a 200 response treating the empty value as no filter"
assertion_summary:
  - "each rejected attempt answers status 400 with the error member invalid_query and a JSON body."
  - "GET /rooms without a query still answers 200 after every rejected attempt."
feasibility: feasible
```

### room-booking-api:BEH-008

```yaml
id: room-booking-api:BEH-008
template: Behavior
obligation: "A valid booking body on a known room answers 201 with the next booking id in global creation order, echoing the submitted title, start, end and attendees, and a member beyond the stated ones is neither stored nor echoed."
input_classes:
  - name: empty_first_booking
    input: "POST /rooms/r1/bookings with body {\"title\": \"Standup\", \"start\": \"2026-11-02T09:00:00Z\", \"end\": \"2026-11-02T09:30:00Z\", \"attendees\": 5} as the first booking of the process"
    expected: "201 with body {\"id\": \"b1\", \"roomId\": \"r1\", \"title\": \"Standup\", \"start\": \"2026-11-02T09:00:00Z\", \"end\": \"2026-11-02T09:30:00Z\", \"attendees\": 5}"
  - name: typical_after_other_rooms
    input: "the same body against r1 while b1 already exists on r2"
    expected: "201 with body id b2 and roomId r1"
  - name: boundary_extra_member
    input: "POST /rooms/r1/bookings with body {\"title\": \"Standup\", \"start\": \"2026-11-02T09:00:00Z\", \"end\": \"2026-11-02T09:30:00Z\", \"attendees\": 5, \"notes\": \"weekly\"}"
    expected: "201 whose body carries exactly id, roomId, title, start, end and attendees, with no notes member"
  - name: invalid_unknown_room
    input: "the valid body against the unknown room r9"
    expected: "room_not_found; HTTP 404"
  - name: invalid_over_capacity
    input: "the valid body with attendees 11 against r1 of capacity 10"
    expected: "over_capacity; HTTP 422"
negative_oracle:
  - input_class: invalid_unknown_room
    must_fail_with: "room_not_found"
    must_not: "a 201 response or a booking added to the store"
  - input_class: invalid_over_capacity
    must_fail_with: "over_capacity"
    must_not: "a 201 response or a booking added to the store"
assertion_summary:
  - "the created booking carries exactly id, roomId, title, start, end and attendees, and start and end are echoed exactly as submitted."
  - "the id counts across all rooms, so a booking created on r1 after a booking on r2 takes the next id."
  - "the extra member notes never appears in the response body nor in a later GET /rooms/r1/bookings listing."
feasibility: feasible
```

### room-booking-api:BEH-009

```yaml
id: room-booking-api:BEH-009
template: Behavior
obligation: "A request naming a room id absent from the store answers 404 room_not_found."
input_classes:
  - name: typical_listing_unknown_room
    input: "GET /rooms/r9/bookings while no room r9 exists"
    expected: "room_not_found; HTTP 404"
  - name: typical_known_room
    input: "GET /rooms/r1/bookings while r1 exists and holds no booking"
    expected: "200 with body {\"bookings\": []}"
  - name: empty_store
    input: "GET /rooms/r1/bookings on a freshly started process whose store holds no room"
    expected: "room_not_found; HTTP 404"
  - name: boundary_id_shaped_like_a_real_id
    input: "GET /rooms/r99/bookings, an id shaped like a real room id that was never created"
    expected: "room_not_found; HTTP 404"
  - name: invalid_post_to_unknown_room
    input: "POST /rooms/r9/bookings with a valid booking body"
    expected: "room_not_found; HTTP 404 and no booking stored"
negative_oracle:
  - input_class: typical_listing_unknown_room
    must_fail_with: "room_not_found"
    must_not: "a 200 listing, or the code not_found"
  - input_class: invalid_post_to_unknown_room
    must_fail_with: "room_not_found"
    must_not: "a 201 response, a 400 response, or a booking added to the store"
assertion_summary:
  - "the body of the rejected response carries exactly the member error with value room_not_found, never not_found."
  - "a request naming an existing room answers 200 or 201, so room_not_found is reserved for an absent room id."
  - "no booking is stored by a request naming an absent room."
feasibility: feasible
```

### room-booking-api:BEH-010

```yaml
id: room-booking-api:BEH-010
template: Behavior
obligation: "An empty, over-long, absent or non-string title answers 400 invalid_booking without storing a booking, while a whitespace-only title is created and echoed verbatim."
input_classes:
  - name: typical
    input: "POST /rooms/r1/bookings with a title Standup, start 2026-11-02T09:00:00Z, end 2026-11-02T10:00:00Z and attendees 5"
    expected: "201 with the title Standup echoed unchanged"
  - name: boundary_eighty_characters
    input: "the same body with a title of eighty repetitions of the letter A"
    expected: "201 with the eighty-character title echoed unchanged"
  - name: boundary_eighty_one_characters
    input: "the same body with a title of eighty-one repetitions of the letter A"
    expected: "invalid_booking; HTTP 400"
  - name: empty_string
    input: "the same body with the title the empty string"
    expected: "invalid_booking; HTTP 400"
  - name: absent_member
    input: "POST /rooms/r1/bookings with body {\"start\": \"2026-11-02T09:00:00Z\", \"end\": \"2026-11-02T10:00:00Z\", \"attendees\": 5}"
    expected: "invalid_booking; HTTP 400"
  - name: boundary_whitespace_only
    input: "the same body with the title one space"
    expected: "201 with the title one space, echoed verbatim"
  - name: invalid_non_string
    input: "the same body with the title 42"
    expected: "invalid_booking; HTTP 400"
negative_oracle:
  - input_class: boundary_eighty_one_characters
    must_fail_with: "invalid_booking"
    must_not: "a 201 response or a stored booking"
  - input_class: empty_string
    must_fail_with: "invalid_booking"
    must_not: "a 201 response or a stored booking"
  - input_class: invalid_non_string
    must_fail_with: "invalid_booking"
    must_not: "the code invalid_room, or a 201 response"
assertion_summary:
  - "every rejected attempt answers status 400 with the error member invalid_booking, never invalid_room for a title fault."
  - "GET /rooms/r1/bookings shows no new booking after a rejected attempt."
  - "the whitespace-only title answers 201 and the stored title is the submitted single space."
feasibility: feasible
```

### room-booking-api:BEH-011

```yaml
id: room-booking-api:BEH-011
template: Behavior
obligation: "A start or end that is absent, not a string, unparseable as an ISO-8601 time or not a UTC Z-suffixed time answers 400 invalid_booking and stores no booking."
input_classes:
  - name: typical
    input: "POST /rooms/r1/bookings with title Standup, start 2026-11-02T09:00:00Z, end 2026-11-02T10:00:00Z and attendees 5"
    expected: "201 with start and end echoed as submitted"
  - name: invalid_unparseable_text
    input: "the same body with start tomorrow"
    expected: "invalid_booking; HTTP 400"
  - name: boundary_date_without_time
    input: "the same body with start 2026-11-02"
    expected: "invalid_booking; HTTP 400"
  - name: invalid_offset_time
    input: "the same body with start 2026-11-02T09:00:00+02:00"
    expected: "invalid_booking; HTTP 400"
  - name: absent_member
    input: "POST /rooms/r1/bookings with body {\"title\": \"Standup\", \"end\": \"2026-11-02T10:00:00Z\", \"attendees\": 5}"
    expected: "invalid_booking; HTTP 400"
  - name: invalid_non_string
    input: "the same body with start 1729, a number"
    expected: "invalid_booking; HTTP 400"
negative_oracle:
  - input_class: invalid_unparseable_text
    must_fail_with: "invalid_booking"
    must_not: "a 201 response, a 500 status, or a stored booking"
  - input_class: invalid_offset_time
    must_fail_with: "invalid_booking"
    must_not: "a 201 response with the start shifted to 2026-11-02T07:00:00Z"
  - input_class: absent_member
    must_fail_with: "invalid_booking"
    must_not: "a 201 response with a default start"
assertion_summary:
  - "every rejected attempt answers status 400 with the error member invalid_booking."
  - "GET /rooms/r1/bookings shows no new booking after a rejected attempt."
  - "an accepted booking echoes start and end exactly as submitted."
feasibility: feasible
```

### room-booking-api:BEH-012

```yaml
id: room-booking-api:BEH-012
template: Behavior
obligation: "A time with a non-zero seconds or non-zero fractional-second part answers 400 invalid_booking and stores no booking, while a seconds-less or zero-fraction writing of a whole minute is accepted as the same instant."
input_classes:
  - name: typical
    input: "POST /rooms/r1/bookings with title Standup, start 2026-11-02T09:00:00Z, end 2026-11-02T10:00:00Z and attendees 5"
    expected: "201 with start 2026-11-02T09:00:00Z"
  - name: invalid_non_zero_seconds
    input: "the same body with start 2026-11-02T09:00:30Z"
    expected: "invalid_booking; HTTP 400"
  - name: invalid_non_zero_fraction
    input: "the same body with start 2026-11-02T09:00:00.500Z"
    expected: "invalid_booking; HTTP 400"
  - name: boundary_zero_fraction
    input: "the same body with start 2026-11-02T09:00:00.000Z"
    expected: "201 with a whole-minute start"
  - name: boundary_seconds_less_writing
    input: "the same body with start 2026-11-02T09:30Z and end 2026-11-02T10:30Z"
    expected: "201 whose echoed start and end denote the same instants as 2026-11-02T09:30:00Z and 2026-11-02T10:30:00Z"
negative_oracle:
  - input_class: invalid_non_zero_seconds
    must_fail_with: "invalid_booking"
    must_not: "a 201 response or a booking stored with the time rounded down to 09:00"
  - input_class: invalid_non_zero_fraction
    must_fail_with: "invalid_booking"
    must_not: "a 201 response or a booking stored with the fraction dropped"
assertion_summary:
  - "a non-zero seconds or fraction part answers status 400 with the error member invalid_booking."
  - "GET /rooms/r1/bookings shows no booking at the rejected interval."
  - "the three whole-minute writings of one instant are accepted and denote the same instant in the stored booking."
feasibility: feasible
```

### room-booking-api:BEH-013

```yaml
id: room-booking-api:BEH-013
template: Behavior
obligation: "An end equal to or earlier than start answers 400 invalid_booking and stores no booking, while an end one minute after start is accepted."
input_classes:
  - name: typical
    input: "POST /rooms/r1/bookings with title Standup, start 2026-11-02T09:00:00Z, end 2026-11-02T10:00:00Z and attendees 5"
    expected: "201"
  - name: boundary_one_minute
    input: "the same body with start 2026-11-02T09:00:00Z and end 2026-11-02T09:01:00Z"
    expected: "201"
  - name: invalid_end_before_start
    input: "the same body with start 2026-11-02T10:00:00Z and end 2026-11-02T09:00:00Z"
    expected: "invalid_booking; HTTP 400"
  - name: boundary_end_equal_to_start
    input: "the same body with start 2026-11-02T10:00:00Z and end 2026-11-02T10:00:00Z"
    expected: "invalid_booking; HTTP 400"
negative_oracle:
  - input_class: boundary_end_equal_to_start
    must_fail_with: "invalid_booking"
    must_not: "a 201 response or a zero-length booking in the store"
  - input_class: invalid_end_before_start
    must_fail_with: "invalid_booking"
    must_not: "a 201 response or a stored booking"
assertion_summary:
  - "both rejected attempts answer status 400 with the error member invalid_booking."
  - "GET /rooms/r1/bookings lists no zero-length booking after the equal-start attempt."
feasibility: feasible
```

### room-booking-api:BEH-014

```yaml
id: room-booking-api:BEH-014
template: Behavior
obligation: "A duration above eight hours answers 400 invalid_booking while exactly eight hours is accepted."
input_classes:
  - name: typical
    input: "POST /rooms/r1/bookings with title Standup, start 2026-11-02T09:00:00Z, end 2026-11-02T10:00:00Z and attendees 5 on a room holding no booking"
    expected: "201"
  - name: boundary_exactly_eight_hours
    input: "the same body with start 2026-11-02T09:00:00Z and end 2026-11-02T17:00:00Z"
    expected: "201"
  - name: invalid_eight_hours_and_one_minute
    input: "the same body with start 2026-11-02T09:00:00Z and end 2026-11-02T17:01:00Z"
    expected: "invalid_booking; HTTP 400"
  - name: empty
    input: "POST /rooms/r1/bookings on r1 while r1 holds no booking, with start 2026-11-02T09:00:00Z and end 2026-11-02T16:59:00Z"
    expected: "201"
negative_oracle:
  - input_class: invalid_eight_hours_and_one_minute
    must_fail_with: "invalid_booking"
    must_not: "a 201 response or a stored booking"
assertion_summary:
  - "exactly eight hours answers 201 and the echoed interval spans eight hours."
  - "eight hours and one minute answers status 400 with the error member invalid_booking and the booking list is unchanged."
feasibility: feasible
```

### room-booking-api:BEH-015

```yaml
id: room-booking-api:BEH-015
template: Behavior
obligation: "attendees above the room capacity answers 422 over_capacity, attendees equal to the capacity is accepted and an absent attendees answers 400 invalid_booking."
input_classes:
  - name: typical
    input: "POST /rooms/r1/bookings with attendees 5 on r1 of capacity 10"
    expected: "201 with attendees 5"
  - name: boundary_equal_to_capacity
    input: "the same body with attendees 10 on r1 of capacity 10"
    expected: "201 with attendees 10"
  - name: boundary_one_above_capacity
    input: "the same body with attendees 11 on r1 of capacity 10"
    expected: "over_capacity; HTTP 422"
  - name: invalid_zero
    input: "the same body with attendees 0"
    expected: "invalid_booking; HTTP 400"
  - name: absent_member
    input: "POST /rooms/r1/bookings with body {\"title\": \"Standup\", \"start\": \"2026-11-02T09:00:00Z\", \"end\": \"2026-11-02T10:00:00Z\"}"
    expected: "invalid_booking; HTTP 400"
negative_oracle:
  - input_class: boundary_one_above_capacity
    must_fail_with: "over_capacity"
    must_not: "a 201 response, a 400 response, or a stored booking"
  - input_class: invalid_zero
    must_fail_with: "invalid_booking"
    must_not: "a 201 response or a stored booking"
  - input_class: absent_member
    must_fail_with: "invalid_booking"
    must_not: "a 201 response with a default attendees value"
assertion_summary:
  - "attendees equal to the room capacity answers 201, so the comparison is inclusive."
  - "attendees one above the capacity answers status 422 with the error member over_capacity, never status 400."
  - "GET /rooms/r1/bookings shows no booking after a rejected attempt."
feasibility: feasible
```

### room-booking-api:BEH-016

```yaml
id: room-booking-api:BEH-016
template: Behavior
obligation: "An interval overlapping an existing booking of the same room answers 409 room_busy naming the earliest-starting conflict, and no booking is stored."
input_classes:
  - name: typical_free_interval
    input: "POST /rooms/r1/bookings 2026-11-02T13:00:00Z to 2026-11-02T14:00:00Z while r1 holds b1 09:00 to 10:00 and b2 11:00 to 12:00"
    expected: "201 with a booking id"
  - name: empty_other_room
    input: "the interval 2026-11-02T09:30:00Z to 2026-11-02T11:30:00Z against an otherwise empty room r2"
    expected: "201"
  - name: invalid_two_conflicts
    input: "the interval 2026-11-02T09:30:00Z to 2026-11-02T11:30:00Z against r1"
    expected: "room_busy; HTTP 409; body {\"error\": \"room_busy\", \"conflictingBookingId\": \"b1\"}"
  - name: invalid_one_conflict
    input: "the interval 2026-11-02T09:30:00Z to 2026-11-02T09:45:00Z against r1"
    expected: "room_busy; HTTP 409 with conflictingBookingId b1"
negative_oracle:
  - input_class: invalid_two_conflicts
    must_fail_with: "room_busy"
    must_not: "a 201 response, a stored booking, or a conflictingBookingId naming b2"
assertion_summary:
  - "the rejected response answers status 409 and its body carries exactly error and conflictingBookingId."
  - "the conflictingBookingId is the earliest-starting conflict, b1, not the latest, b2."
  - "GET /rooms/r1/bookings still lists exactly b1 and b2 after the rejected attempt."
feasibility: feasible
```

### room-booking-api:BEH-017

```yaml
id: room-booking-api:BEH-017
template: Behavior
obligation: "A booking starting exactly when another ends is accepted, while an interval overlapping by one minute answers 409 room_busy."
input_classes:
  - name: typical_adjacent_after
    input: "POST /rooms/r1/bookings 2026-11-02T10:00:00Z to 2026-11-02T11:00:00Z while r1 holds b1 2026-11-02T09:00:00Z to 2026-11-02T10:00:00Z"
    expected: "201 with a new booking id"
  - name: boundary_adjacent_before
    input: "the interval 2026-11-02T08:00:00Z to 2026-11-02T09:00:00Z against the same room"
    expected: "201 with a new booking id"
  - name: invalid_one_minute_overlap
    input: "the interval 2026-11-02T09:59:00Z to 2026-11-02T10:01:00Z against the same room"
    expected: "room_busy; HTTP 409 with conflictingBookingId b1"
  - name: empty_room
    input: "the interval 2026-11-02T09:00:00Z to 2026-11-02T10:00:00Z against a room holding no booking"
    expected: "201"
negative_oracle:
  - input_class: invalid_one_minute_overlap
    must_fail_with: "room_busy"
    must_not: "a 201 response or a stored overlapping booking"
assertion_summary:
  - "the two adjacent intervals are both accepted with status 201 and both appear in GET /rooms/r1/bookings."
  - "the one-minute overlap answers status 409 with the error member room_busy."
  - "the intervals behave as half-open, so 10:00 belongs to the second booking only."
feasibility: feasible
```

### room-booking-api:BEH-018

```yaml
id: room-booking-api:BEH-018
template: Behavior
obligation: "The booking listing is ordered by start ascending and by id for equal starts, and each booking carries exactly id, roomId, title, start, end and attendees."
input_classes:
  - name: typical
    input: "GET /rooms/r1/bookings while r1 holds b1 11:00 to 12:00, b2 09:00 to 10:00 and b3 11:00 to 11:30"
    expected: "200 with body {\"bookings\": [...]} ordered b2, b3, b1, each carrying exactly id, roomId, title, start, end and attendees"
  - name: empty
    input: "GET /rooms/r1/bookings while r1 holds no booking"
    expected: "200 with body {\"bookings\": []}"
  - name: boundary_ten_bookings
    input: "GET /rooms/r1/bookings while r1 holds b1 to b10 in start order, b10 created after b2"
    expected: "200 listing b2 before b10 in creation order"
  - name: invalid_single_parameter
    input: "GET /rooms/r1/bookings?from=2026-11-02T09:00:00Z"
    expected: "invalid_query; HTTP 400"
negative_oracle:
  - input_class: invalid_single_parameter
    must_fail_with: "invalid_query"
    must_not: "a 200 listing treating the single from value as an open range"
assertion_summary:
  - "the elements appear in ascending start order, so the 09:00 booking precedes the two 11:00 bookings."
  - "for equal starts the lower id precedes the higher one."
  - "the response body has exactly the member bookings and each element carries exactly the six documented members."
feasibility: feasible
```

### room-booking-api:BEH-019

```yaml
id: room-booking-api:BEH-019
template: Behavior
obligation: "Only bookings whose interval overlaps the half-open range [from, to) are returned."
input_classes:
  - name: typical_overlapping_both
    input: "GET /rooms/r1/bookings?from=2026-11-02T09:30:00Z&to=2026-11-02T11:30:00Z while r1 holds b1 09:00 to 10:00 and b2 11:00 to 12:00"
    expected: "200 listing b1 and b2"
  - name: boundary_adjacent_to_both
    input: "GET /rooms/r1/bookings?from=2026-11-02T10:00:00Z&to=2026-11-02T11:00:00Z"
    expected: "200 with body {\"bookings\": []}"
  - name: boundary_to_inside_second_booking
    input: "GET /rooms/r1/bookings?from=2026-11-02T09:00:00Z&to=2026-11-02T11:00:00Z"
    expected: "200 listing b1 only"
  - name: empty_room
    input: "GET /rooms/r2/bookings?from=2026-11-02T09:00:00Z&to=2026-11-02T10:00:00Z while r2 holds no booking"
    expected: "200 with body {\"bookings\": []}"
  - name: invalid_inverted_pair
    input: "GET /rooms/r1/bookings?from=2026-11-02T11:00:00Z&to=2026-11-02T09:00:00Z"
    expected: "invalid_query; HTTP 400"
negative_oracle:
  - input_class: invalid_inverted_pair
    must_fail_with: "invalid_query"
    must_not: "a 200 listing or an empty bookings array"
assertion_summary:
  - "a booking is included when it shares at least one instant with [from, to) and excluded when it only touches a boundary."
  - "the filtered list keeps the start-then-id ordering of the full list."
  - "the empty range answers status 200 with an empty bookings array, not an error."
feasibility: feasible
```

### room-booking-api:BEH-020

```yaml
id: room-booking-api:BEH-020
template: Behavior
obligation: "An incomplete, unparseable, non-Z, non-whole-minute or inverted from and to pair answers 400 invalid_query."
input_classes:
  - name: typical
    input: "GET /rooms/r1/bookings?from=2026-11-02T09:00:00Z&to=2026-11-02T10:00:00Z"
    expected: "200 with the filtered booking list"
  - name: invalid_only_from
    input: "GET /rooms/r1/bookings?from=2026-11-02T09:00:00Z"
    expected: "invalid_query; HTTP 400"
  - name: invalid_only_to
    input: "GET /rooms/r1/bookings?to=2026-11-02T10:00:00Z"
    expected: "invalid_query; HTTP 400"
  - name: boundary_inverted_pair
    input: "GET /rooms/r1/bookings?from=2026-11-02T10:00:00Z&to=2026-11-02T10:00:00Z"
    expected: "invalid_query; HTTP 400"
  - name: invalid_non_z_time
    input: "GET /rooms/r1/bookings?from=2026-11-02T09:00:00%2B02:00&to=2026-11-02T10:00:00Z"
    expected: "invalid_query; HTTP 400"
  - name: invalid_non_whole_minute
    input: "GET /rooms/r1/bookings?from=2026-11-02T09:00:30Z&to=2026-11-02T10:00:00Z"
    expected: "invalid_query; HTTP 400"
negative_oracle:
  - input_class: invalid_only_from
    must_fail_with: "invalid_query"
    must_not: "a 200 listing that treats the single from value as an open range"
  - input_class: boundary_inverted_pair
    must_fail_with: "invalid_query"
    must_not: "a 200 listing or an empty bookings array"
  - input_class: invalid_non_z_time
    must_fail_with: "invalid_query"
    must_not: "a 200 listing with the offset time shifted to UTC"
  - input_class: invalid_non_whole_minute
    must_fail_with: "invalid_query"
    must_not: "a 200 listing with the time rounded to the minute"
assertion_summary:
  - "each rejected attempt answers status 400 with the error member invalid_query."
  - "a request naming an existing room with a valid pair still answers 200 after every rejected attempt."
feasibility: feasible
```

### room-booking-api:BEH-021

```yaml
id: room-booking-api:BEH-021
template: Behavior
obligation: "A known booking id answers 204 with an empty body, the booking disappears from the listing and its interval accepts a new booking."
input_classes:
  - name: typical
    input: "DELETE /bookings/b1 while r1 holds b1 2026-11-02T09:00:00Z to 2026-11-02T10:00:00Z"
    expected: "204 with an empty body; GET /rooms/r1/bookings then answers 200 with an empty bookings array"
  - name: boundary_freed_interval
    input: "POST /rooms/r1/bookings 2026-11-02T09:00:00Z to 2026-11-02T10:00:00Z after the deletion"
    expected: "201 with a new booking id"
  - name: invalid_repeat_deletion
    input: "DELETE /bookings/b1 a second time"
    expected: "booking_not_found; HTTP 404"
  - name: empty_listing_after_deletion
    input: "GET /rooms/r1/bookings after the deletion while b1 was the only booking"
    expected: "200 with body {\"bookings\": []}"
negative_oracle:
  - input_class: invalid_repeat_deletion
    must_fail_with: "booking_not_found"
    must_not: "a second 204 response"
assertion_summary:
  - "the successful deletion answers status 204 with no body at all, never a JSON body."
  - "b1 is absent from GET /rooms/r1/bookings after the deletion."
  - "the freed interval answers 201 for a new booking, never room_busy."
feasibility: feasible
```

### room-booking-api:BEH-022

```yaml
id: room-booking-api:BEH-022
template: Behavior
obligation: "An unknown booking id answers 404 booking_not_found, including the id of an already deleted booking."
input_classes:
  - name: typical_known_booking
    input: "DELETE /bookings/b1 while b1 exists"
    expected: "204 with an empty body"
  - name: invalid_never_created
    input: "DELETE /bookings/b7 while no booking b7 exists"
    expected: "booking_not_found; HTTP 404"
  - name: invalid_already_deleted
    input: "DELETE /bookings/b1 after b1 was deleted"
    expected: "booking_not_found; HTTP 404"
negative_oracle:
  - input_class: invalid_never_created
    must_fail_with: "booking_not_found"
    must_not: "a 204 response, or the code not_found"
  - input_class: invalid_already_deleted
    must_fail_with: "booking_not_found"
    must_not: "a 204 response"
assertion_summary:
  - "the rejected response answers status 404 and its body carries exactly error with value booking_not_found."
  - "a second deletion never answers 204, so deletion is not reported as successful twice."
feasibility: feasible
```

### room-booking-api:BEH-023

```yaml
id: room-booking-api:BEH-023
template: Behavior
obligation: "Only rooms with capacity at least attendees and no conflicting booking for the interval are returned, ordered by capacity ascending then by id."
input_classes:
  - name: typical
    input: "GET /availability?start=2026-11-02T09:00:00Z&end=2026-11-02T10:00:00Z&attendees=4 while r1 capacity 10 holds a booking 09:00 to 10:00, r2 capacity 4 is free, r3 capacity 10 is free and r4 capacity 4 holds a booking 09:30 to 10:30"
    expected: "200 with body {\"rooms\": [...]} listing r2 then r3"
  - name: boundary_exactly_at_the_requested_capacity
    input: "the same query with attendees=4 against r2 of capacity 4 while r2 is free"
    expected: "200 whose rooms list includes r2"
  - name: boundary_no_room_matches_capacity
    input: "the same query with attendees=11"
    expected: "200 with body {\"rooms\": []}"
  - name: boundary_ordering_by_capacity
    input: "the same query while a capacity-4 room was created after a capacity-10 room and both are free"
    expected: "200 listing the capacity-4 room before the capacity-10 room"
  - name: invalid_missing_end
    input: "GET /availability?start=2026-11-02T09:00:00Z&attendees=4"
    expected: "invalid_query; HTTP 400"
negative_oracle:
  - input_class: invalid_missing_end
    must_fail_with: "invalid_query"
    must_not: "a 200 response treating the missing end as unbounded"
assertion_summary:
  - "r1 and r4 are absent from the rooms list because each holds a booking overlapping the requested interval."
  - "the rooms appear in ascending capacity order and, for equal capacities, in ascending id order."
  - "a capacity equal to attendees qualifies the room."
feasibility: feasible
```

### room-booking-api:BEH-024

```yaml
id: room-booking-api:BEH-024
template: Behavior
obligation: "A missing or invalid availability parameter answers 400 invalid_query."
input_classes:
  - name: typical
    input: "GET /availability?start=2026-11-02T09:00:00Z&end=2026-11-02T10:00:00Z&attendees=4"
    expected: "200 with a rooms list"
  - name: invalid_missing_start
    input: "GET /availability?end=2026-11-02T10:00:00Z&attendees=4"
    expected: "invalid_query; HTTP 400"
  - name: invalid_missing_attendees
    input: "GET /availability?start=2026-11-02T09:00:00Z&end=2026-11-02T10:00:00Z"
    expected: "invalid_query; HTTP 400"
  - name: boundary_start_equal_to_end
    input: "GET /availability?start=2026-11-02T10:00:00Z&end=2026-11-02T10:00:00Z&attendees=4"
    expected: "invalid_query; HTTP 400"
  - name: invalid_unparseable_time
    input: "GET /availability?start=tomorrow&end=2026-11-02T10:00:00Z&attendees=4"
    expected: "invalid_query; HTTP 400"
  - name: invalid_non_integer_attendees
    input: "GET /availability?start=2026-11-02T09:00:00Z&end=2026-11-02T10:00:00Z&attendees=2.5"
    expected: "invalid_query; HTTP 400"
negative_oracle:
  - input_class: invalid_missing_attendees
    must_fail_with: "invalid_query"
    must_not: "a 200 response with a default attendees value"
  - input_class: boundary_start_equal_to_end
    must_fail_with: "invalid_query"
    must_not: "a 200 response with an empty rooms list"
  - input_class: invalid_unparseable_time
    must_fail_with: "invalid_query"
    must_not: "a 500 status or a 200 response"
assertion_summary:
  - "every rejected attempt answers status 400 with the error member invalid_query."
  - "GET /availability with all three parameters valid still answers 200 after every rejected attempt."
feasibility: feasible
```

### room-booking-api:BEH-025

```yaml
id: room-booking-api:BEH-025
template: Behavior
obligation: "A body that does not parse as JSON answers 400 invalid_json, while a JSON value that parses but is not an object answers the body validation code of the endpoint."
input_classes:
  - name: typical_valid_body
    input: "POST /rooms with body {\"name\": \"Aurora\", \"capacity\": 10}"
    expected: "201"
  - name: invalid_truncated_json
    input: "POST /rooms with the truncated body {\"name\": \"Aurora\","
    expected: "invalid_json; HTTP 400"
  - name: empty
    input: "POST /rooms/r1/bookings with an empty request body"
    expected: "invalid_json; HTTP 400"
  - name: boundary_json_array
    input: "POST /rooms with body []"
    expected: "invalid_room; HTTP 400, never invalid_json"
  - name: boundary_json_string
    input: "POST /rooms/r1/bookings with body \"Standup\""
    expected: "invalid_booking; HTTP 400, never invalid_json"
negative_oracle:
  - input_class: invalid_truncated_json
    must_fail_with: "invalid_json"
    must_not: "a 500 status or a 201 response"
  - input_class: boundary_json_array
    must_fail_with: "invalid_room"
    must_not: "the code invalid_json for a body that parses as JSON"
  - input_class: boundary_json_string
    must_fail_with: "invalid_booking"
    must_not: "the code invalid_json for a body that parses as JSON"
assertion_summary:
  - "an unparseable or empty body answers status 400 with the error member invalid_json on both POST endpoints."
  - "a JSON value that is not an object answers the validation code of the endpoint, invalid_room on POST /rooms and invalid_booking on POST /rooms/r1/bookings."
  - "no request with an unparseable body answers 500."
feasibility: feasible
```

### room-booking-api:BEH-026

```yaml
id: room-booking-api:BEH-026
template: Behavior
obligation: "A path matching no listed endpoint answers 404 not_found."
input_classes:
  - name: typical_unknown_top_level_path
    input: "GET /nope"
    expected: "404 with body {\"error\": \"not_found\"}"
  - name: boundary_unlisted_sub_resource
    input: "GET /bookings"
    expected: "404 with body {\"error\": \"not_found\"}"
  - name: boundary_trailing_slash
    input: "GET /rooms/"
    expected: "404 with body {\"error\": \"not_found\"}"
  - name: boundary_unlisted_room_path
    input: "DELETE /rooms/r1 while r1 exists"
    expected: "404 with body {\"error\": \"not_found\"}"
  - name: typical_listed_path
    input: "GET /rooms"
    expected: "200 with a rooms list"
negative_oracle:
  - input_class: typical_unknown_top_level_path
    must_fail_with: "not_found"
    must_not: "a 405 status, a 500 status, or the code method_not_allowed"
  - input_class: boundary_trailing_slash
    must_fail_with: "not_found"
    must_not: "a 200 response or a 301 status"
assertion_summary:
  - "each unlisted path answers status 404 with the body member error equal to not_found."
  - "the error body is JSON, never plain text."
  - "the listed path still answers 200 after the unlisted requests."
feasibility: feasible
```

### room-booking-api:BEH-027

```yaml
id: room-booking-api:BEH-027
template: Behavior
obligation: "A listed path with an unlisted method answers 405 method_not_allowed."
input_classes:
  - name: typical_put_rooms
    input: "PUT /rooms"
    expected: "405 with body {\"error\": \"method_not_allowed\"}"
  - name: boundary_patch_bookings
    input: "PATCH /rooms/r1/bookings"
    expected: "405 with body {\"error\": \"method_not_allowed\"}"
  - name: boundary_post_availability
    input: "POST /availability"
    expected: "405 with body {\"error\": \"method_not_allowed\"}"
  - name: boundary_delete_rooms
    input: "DELETE /rooms"
    expected: "405 with body {\"error\": \"method_not_allowed\"}"
  - name: typical_listed_method
    input: "POST /rooms with body {\"name\": \"Aurora\", \"capacity\": 10}"
    expected: "201, never 405"
negative_oracle:
  - input_class: typical_put_rooms
    must_fail_with: "method_not_allowed"
    must_not: "the code not_found or a 404 status"
  - input_class: boundary_post_availability
    must_fail_with: "method_not_allowed"
    must_not: "the code not_found or a 200 response"
assertion_summary:
  - "each rejected request answers status 405 with the body member error equal to method_not_allowed."
  - "a listed method on the same path is never rejected with 405."
  - "the error body is JSON, never plain text."
feasibility: feasible
```

### room-booking-api:BEH-028

```yaml
id: room-booking-api:BEH-028
template: Behavior
obligation: "When one request breaks several rules the response carries the code of the rule listed first: invalid_json, then room_not_found, then invalid_booking, then over_capacity, then room_busy, and on GET /rooms/:roomId/bookings invalid_query before room_not_found."
input_classes:
  - name: empty
    input: "POST /rooms/r9/bookings with an empty body while no room r9 exists"
    expected: "invalid_json; HTTP 400"
  - name: typical_unknown_room_with_invalid_body
    input: "POST /rooms/r9/bookings with a valid JSON body whose title is the empty string"
    expected: "room_not_found; HTTP 404"
  - name: boundary_invalid_body_with_conflict
    input: "POST /rooms/r1/bookings with an empty title and the interval 2026-11-02T09:30:00Z to 2026-11-02T10:30:00Z while b1 holds 09:00 to 10:00"
    expected: "invalid_booking; HTTP 400"
  - name: boundary_over_capacity_with_conflict
    input: "the same request with a valid title and attendees 11"
    expected: "over_capacity; HTTP 422"
  - name: boundary_invalid_query_before_unknown_room
    input: "GET /rooms/r9/bookings?from=2026-11-02T09:00:00Z"
    expected: "invalid_query; HTTP 400"
  - name: typical_single_rule
    input: "POST /rooms/r1/bookings with a valid body on a free interval"
    expected: "201 with a booking id"
negative_oracle:
  - input_class: typical_unknown_room_with_invalid_body
    must_fail_with: "room_not_found"
    must_not: "the code invalid_booking for a body fault on an unknown room"
  - input_class: boundary_invalid_body_with_conflict
    must_fail_with: "invalid_booking"
    must_not: "the code room_busy for a body that also fails validation"
  - input_class: boundary_over_capacity_with_conflict
    must_fail_with: "over_capacity"
    must_not: "the code room_busy for an interval that also conflicts"
  - input_class: boundary_invalid_query_before_unknown_room
    must_fail_with: "invalid_query"
    must_not: "the code room_not_found for an invalid query on an unknown room"
assertion_summary:
  - "each response carries exactly one error code, the code of the first applicable rule in the stated order."
  - "no response carries two error members or a body describing several failures."
  - "a request breaking one rule still answers that rule's code, so the ordering matters only when rules are combined."
feasibility: feasible
```

### room-booking-api:SCN-001

```yaml
id: room-booking-api:SCN-001
template: Scenario
obligation: "The first two rooms created by a freshly started process carry the ids r1 and r2."
input_classes:
  - name: empty
    input: "a freshly started process with an empty store, GET /rooms"
    expected: "200 with body {\"rooms\": []}"
  - name: boundary_two_rooms
    input: "POST /rooms with name Aurora and capacity 4, then POST /rooms with name Borealis and capacity 10"
    expected: "201 with id r1, then 201 with id r2"
  - name: invalid_retry_same_body
    input: "POST /rooms with the Aurora body again after Aurora exists"
    expected: "room_name_taken; HTTP 409 and no new room id"
negative_oracle:
  - input_class: invalid_retry_same_body
    must_fail_with: "room_name_taken"
    must_not: "a 201 response or a newly assigned room id"
assertion_summary:
  - "the first created room carries id r1 and the second r2, never r0 and never an id chosen from the name."
  - "GET /rooms answers 200 with r1 before r2."
  - "the retried creation answers status 409 and the room list is unchanged."
observable_sequence:
  - "POST /rooms with name Aurora and capacity 4 → 201 whose body carries id r1"
  - "POST /rooms with name Borealis and capacity 10 → 201 whose body carries id r2"
  - "GET /rooms → 200 whose rooms list holds r1 before r2"
feasibility: feasible
```

### room-booking-api:SCN-002

```yaml
id: room-booking-api:SCN-002
template: Scenario
obligation: "Booking ids increase across rooms in creation order and a rejected creation consumes no id."
input_classes:
  - name: empty
    input: "the store holds r1 and r2 and no booking, GET /rooms/r1/bookings"
    expected: "200 with body {\"bookings\": []}"
  - name: typical_first_booking
    input: "POST /rooms/r1/bookings 2026-11-02T09:00:00Z to 2026-11-02T10:00:00Z on a store with no booking"
    expected: "201 with id b1"
  - name: boundary_second_room
    input: "POST /rooms/r2/bookings 2026-11-02T09:00:00Z to 2026-11-02T10:00:00Z after b1 exists on r1"
    expected: "201 with id b2"
  - name: invalid_rejected_creation
    input: "POST /rooms/r1/bookings with an empty title, then POST /rooms/r1/bookings 2026-11-02T11:00:00Z to 2026-11-02T12:00:00Z"
    expected: "invalid_booking; HTTP 400, then 201 with the id the next accepted creation takes"
negative_oracle:
  - input_class: invalid_rejected_creation
    must_fail_with: "invalid_booking"
    must_not: "a 201 response for the rejected body or a booking id consumed by the rejected request"
assertion_summary:
  - "the ids are b1, b2 and b3 in creation order across the two rooms."
  - "GET /rooms/r1/bookings lists b1 and b3 only."
  - "the rejected creation leaves the id sequence where it was, so the next accepted booking takes b3, not b4."
observable_sequence:
  - "POST /rooms/r1/bookings 09:00 to 10:00 → 201 whose body carries id b1"
  - "POST /rooms/r2/bookings 09:00 to 10:00 → 201 whose body carries id b2"
  - "POST /rooms/r1/bookings 11:00 to 12:00 → 201 whose body carries id b3"
  - "GET /rooms/r1/bookings → 200 whose bookings list holds b1 and b3"
feasibility: feasible
```

### room-booking-api:SCN-003

```yaml
id: room-booking-api:SCN-003
template: Scenario
obligation: "The interval of a deleted booking accepts a new booking and the deleted interval is no longer reported busy."
input_classes:
  - name: invalid_before_deletion
    input: "POST /rooms/r1/bookings 2026-11-02T09:30:00Z to 2026-11-02T10:30:00Z while b1 holds 09:00 to 10:00"
    expected: "room_busy; HTTP 409 with conflictingBookingId b1"
  - name: typical_after_deletion
    input: "the same request after DELETE /bookings/b1"
    expected: "201 with a fresh booking id"
  - name: boundary_adjacent_to_deleted_interval
    input: "POST /rooms/r1/bookings 2026-11-02T10:00:00Z to 2026-11-02T11:00:00Z after the deletion"
    expected: "201 with a fresh booking id"
  - name: empty_after_deletion
    input: "GET /rooms/r1/bookings after deleting the only booking b1"
    expected: "200 with body {\"bookings\": []}"
negative_oracle:
  - input_class: invalid_before_deletion
    must_fail_with: "room_busy"
    must_not: "a 201 response or a stored booking before the deletion"
assertion_summary:
  - "the deletion answers 204 and GET /rooms/r1/bookings then lists no b1."
  - "the retried creation after the deletion answers 201 with a fresh booking id, never b1 again."
  - "the adjacent interval also answers 201, so the freed interval is genuinely free."
observable_sequence:
  - "POST /rooms/r1/bookings 09:30 to 10:30 → 409 room_busy with conflictingBookingId b1"
  - "DELETE /bookings/b1 → 204 with an empty body"
  - "POST /rooms/r1/bookings 09:30 to 10:30 → 201 whose body carries a booking id other than b1"
  - "GET /rooms/r1/bookings → 200 whose bookings list holds the new booking only"
feasibility: feasible
```

### room-booking-api:SCN-004

```yaml
id: room-booking-api:SCN-004
template: Scenario
obligation: "The conflictingBookingId is the earliest-starting conflict among all conflicts of the requested interval."
input_classes:
  - name: empty_room
    input: "POST /rooms/r1/bookings 2026-11-02T09:30:00Z to 2026-11-02T11:30:00Z while r1 holds no booking"
    expected: "201"
  - name: typical_two_conflicts
    input: "the same request while r1 holds b1 09:00 to 10:00 and b2 11:00 to 12:00"
    expected: "room_busy; HTTP 409 with conflictingBookingId b1"
  - name: boundary_next_conflict
    input: "the same request after DELETE /bookings/b1"
    expected: "room_busy; HTTP 409 with conflictingBookingId b2"
  - name: boundary_idempotent_repeat
    input: "the same rejected request sent again while b1 and b2 both exist"
    expected: "room_busy; HTTP 409 with conflictingBookingId b1 again"
negative_oracle:
  - input_class: typical_two_conflicts
    must_fail_with: "room_busy"
    must_not: "a 201 response, a conflictingBookingId naming b2, or a body without the member conflictingBookingId"
  - input_class: boundary_next_conflict
    must_fail_with: "room_busy"
    must_not: "a conflictingBookingId naming the deleted b1"
assertion_summary:
  - "the rejected body carries the members error and conflictingBookingId only, with error equal to room_busy."
  - "the named conflict is the earliest-starting one, and after freeing it the next earliest is named."
  - "repeating the rejected request yields the same conflictingBookingId."
observable_sequence:
  - "POST /rooms/r1/bookings 09:30 to 11:30 → 409 room_busy with conflictingBookingId b1"
  - "DELETE /bookings/b1 → 204 with an empty body"
  - "POST /rooms/r1/bookings 09:30 to 11:30 → 409 room_busy with conflictingBookingId b2"
feasibility: feasible
```

### room-booking-api:CTR-001

```yaml
id: room-booking-api:CTR-001
template: Contract
obligation: "POST /rooms answers 201 with the created room for a valid body and each invalid class answers its own documented code."
input_classes:
  - name: typical
    input: "POST /rooms with body {\"name\": \"Aurora\", \"capacity\": 10} on an empty store"
    expected: "201, Content-Type application/json, body carrying exactly id, name and capacity"
  - name: boundary_absent_member
    input: "POST /rooms with body {\"name\": \"Aurora\"}"
    expected: "invalid_room; HTTP 400"
  - name: invalid_name
    input: "POST /rooms with body {\"name\": \"\", \"capacity\": 10}"
    expected: "invalid_room; HTTP 400"
  - name: invalid_taken_name
    input: "POST /rooms with body {\"name\": \"aurora\", \"capacity\": 10} while a room named Aurora exists"
    expected: "room_name_taken; HTTP 409"
  - name: invalid_non_json_body
    input: "POST /rooms with the truncated body {\"name\": \"Aurora\","
    expected: "invalid_json; HTTP 400"
negative_oracle:
  - input_class: invalid_taken_name
    must_fail_with: "room_name_taken"
    must_not: "a 400 response or a 201 response"
  - input_class: invalid_non_json_body
    must_fail_with: "invalid_json"
    must_not: "the code invalid_room for a body that does not parse"
  - input_class: invalid_name
    must_fail_with: "invalid_room"
    must_not: "a 201 response"
assertion_summary:
  - "the success status is 201 and the success body carries exactly the members id, name and capacity."
  - "the three error classes answer the three codes of the taxonomy with statuses 400, 400 and 409."
  - "every response of the endpoint carries Content-Type application/json."
feasibility: feasible
```

### room-booking-api:CTR-002

```yaml
id: room-booking-api:CTR-002
template: Contract
obligation: "GET /rooms answers 200 with a body carrying exactly the member rooms, filtered by minCapacity and ordered by id."
input_classes:
  - name: typical_no_query
    input: "GET /rooms while the store holds r1 and r2"
    expected: "200 with body {\"rooms\": [...]} listing r1 then r2"
  - name: empty
    input: "GET /rooms on an empty store"
    expected: "200 with body {\"rooms\": []}"
  - name: boundary_valid_min_capacity
    input: "GET /rooms?minCapacity=4 while the store holds a room of capacity 4 and a room of capacity 10"
    expected: "200 listing both rooms"
  - name: invalid_min_capacity
    input: "GET /rooms?minCapacity=0"
    expected: "invalid_query; HTTP 400"
negative_oracle:
  - input_class: invalid_min_capacity
    must_fail_with: "invalid_query"
    must_not: "a 200 response listing rooms without a filter"
assertion_summary:
  - "the success body carries exactly the member rooms, never a bare array."
  - "the rooms are ordered by id, so r2 precedes r10."
  - "the single error class answers status 400 with the error member invalid_query."
feasibility: feasible
```

### room-booking-api:CTR-003

```yaml
id: room-booking-api:CTR-003
template: Contract
obligation: "POST /rooms/:roomId/bookings answers 201 with the created booking for a valid body and each invalid class answers its own documented code."
input_classes:
  - name: typical
    input: "POST /rooms/r1/bookings with body {\"title\": \"Standup\", \"start\": \"2026-11-02T09:00:00Z\", \"end\": \"2026-11-02T09:30:00Z\", \"attendees\": 5} on r1 of capacity 10"
    expected: "201, Content-Type application/json, body carrying exactly id, roomId, title, start, end and attendees with start and end echoed as submitted"
  - name: invalid_non_json_body
    input: "POST /rooms/r1/bookings with the truncated body {\"title\": \"Standup\","
    expected: "invalid_json; HTTP 400"
  - name: invalid_unknown_room
    input: "the valid body against the unknown room r9"
    expected: "room_not_found; HTTP 404"
  - name: invalid_body
    input: "the valid body with the title the empty string"
    expected: "invalid_booking; HTTP 400"
  - name: invalid_over_capacity
    input: "the valid body with attendees 11 on r1 of capacity 10"
    expected: "over_capacity; HTTP 422"
  - name: invalid_busy_interval
    input: "the valid body with the interval 2026-11-02T09:30:00Z to 2026-11-02T10:30:00Z while b1 holds 09:00 to 10:00"
    expected: "room_busy; HTTP 409 with the member conflictingBookingId"
negative_oracle:
  - input_class: invalid_busy_interval
    must_fail_with: "room_busy"
    must_not: "a 201 response or a body without the member conflictingBookingId"
  - input_class: invalid_over_capacity
    must_fail_with: "over_capacity"
    must_not: "a 400 response"
  - input_class: invalid_unknown_room
    must_fail_with: "room_not_found"
    must_not: "a 201 response or a 400 response"
assertion_summary:
  - "the success status is 201 and the success body carries exactly the six documented members."
  - "the five error classes answer invalid_json, room_not_found, invalid_booking, over_capacity and room_busy with statuses 400, 404, 400, 422 and 409."
  - "start and end appear in the response exactly as submitted."
feasibility: feasible
```

### room-booking-api:CTR-004

```yaml
id: room-booking-api:CTR-004
template: Contract
obligation: "GET /rooms/:roomId/bookings answers 200 with a body carrying exactly the member bookings, filtered by overlap with [from, to) and ordered by start then id."
input_classes:
  - name: typical_no_query
    input: "GET /rooms/r1/bookings while r1 holds b1 11:00 to 12:00 and b2 09:00 to 10:00"
    expected: "200 with body {\"bookings\": [...]} listing b2 then b1"
  - name: empty
    input: "GET /rooms/r1/bookings while r1 holds no booking"
    expected: "200 with body {\"bookings\": []}"
  - name: boundary_valid_window
    input: "GET /rooms/r1/bookings?from=2026-11-02T09:30:00Z&to=2026-11-02T11:30:00Z"
    expected: "200 listing b2 then b1"
  - name: invalid_single_parameter
    input: "GET /rooms/r1/bookings?from=2026-11-02T09:00:00Z"
    expected: "invalid_query; HTTP 400"
  - name: invalid_unknown_room
    input: "GET /rooms/r9/bookings?from=2026-11-02T09:00:00Z"
    expected: "invalid_query; HTTP 400"
negative_oracle:
  - input_class: invalid_single_parameter
    must_fail_with: "invalid_query"
    must_not: "a 200 listing for a half-given window"
  - input_class: invalid_unknown_room
    must_fail_with: "invalid_query"
    must_not: "the code room_not_found, which the rule order places after invalid_query"
assertion_summary:
  - "the success body carries exactly the member bookings."
  - "the elements are ordered by start ascending then by id."
  - "a window given with only one boundary answers status 400 with the error member invalid_query."
feasibility: feasible
```

### room-booking-api:CTR-005

```yaml
id: room-booking-api:CTR-005
template: Contract
obligation: "A known booking id answers 204 with no body and an unknown or already deleted id answers 404 booking_not_found."
input_classes:
  - name: typical_known_id
    input: "DELETE /bookings/b1 while b1 exists"
    expected: "204 with no body and no Content-Type requirement"
  - name: invalid_unknown_id
    input: "DELETE /bookings/b7 while no booking b7 exists"
    expected: "booking_not_found; HTTP 404"
  - name: invalid_already_deleted_id
    input: "DELETE /bookings/b1 after b1 was deleted"
    expected: "booking_not_found; HTTP 404"
negative_oracle:
  - input_class: typical_known_id
    must_fail_with: "booking_not_found"
    must_not: "a JSON body in the 204 response, since a 204 carries no body"
  - input_class: invalid_unknown_id
    must_fail_with: "booking_not_found"
    must_not: "a 204 response or a 200 response with a deletion report"
assertion_summary:
  - "the success status is 204 and the response has an empty body."
  - "the error status is 404 with the body member error equal to booking_not_found."
  - "every error response of the endpoint carries Content-Type application/json."
feasibility: feasible
```

### room-booking-api:CTR-006

```yaml
id: room-booking-api:CTR-006
template: Contract
obligation: "GET /availability answers 200 with a body carrying exactly the member rooms, listing every room with capacity at least attendees and no conflict in capacity then id order."
input_classes:
  - name: typical
    input: "GET /availability?start=2026-11-02T09:00:00Z&end=2026-11-02T10:00:00Z&attendees=4 while r1 capacity 10 holds a booking 09:00 to 10:00, r2 capacity 4 is free and r3 capacity 10 is free"
    expected: "200 with body {\"rooms\": [...]} listing r2 then r3"
  - name: boundary_busy_room
    input: "the same query while r4 capacity 4 holds a booking 09:30 to 10:30"
    expected: "200 listing r2 then r3, with r4 absent"
  - name: boundary_empty_result
    input: "the same query with attendees=11"
    expected: "200 with body {\"rooms\": []}"
  - name: invalid_missing_parameter
    input: "GET /availability?start=2026-11-02T09:00:00Z&attendees=4"
    expected: "invalid_query; HTTP 400"
negative_oracle:
  - input_class: invalid_missing_parameter
    must_fail_with: "invalid_query"
    must_not: "a 200 response with a default end"
assertion_summary:
  - "the success body carries exactly the member rooms."
  - "the rooms are ordered by capacity ascending then by id."
  - "a missing parameter answers status 400 with the error member invalid_query."
feasibility: feasible
```

### room-booking-api:CTR-007

```yaml
id: room-booking-api:CTR-007
template: Contract
obligation: "A non-JSON body answers 400 invalid_json, an unlisted path 404 not_found and a listed path with an unlisted method 405 method_not_allowed, each as a JSON body carrying exactly the member error."
input_classes:
  - name: typical_non_json_body
    input: "POST /rooms with a body that is not valid JSON, such as the text Aurora"
    expected: "invalid_json; HTTP 400; Content-Type application/json; body carrying exactly the member error"
  - name: boundary_unknown_path
    input: "GET /nope"
    expected: "not_found; HTTP 404; Content-Type application/json"
  - name: boundary_unlisted_method
    input: "PUT /rooms"
    expected: "method_not_allowed; HTTP 405; Content-Type application/json"
  - name: boundary_conflict_body
    input: "POST /rooms/r1/bookings 09:30 to 10:30 while b1 holds 09:00 to 10:00"
    expected: "room_busy; HTTP 409; body carrying exactly error and conflictingBookingId"
negative_oracle:
  - input_class: typical_non_json_body
    must_fail_with: "invalid_json"
    must_not: "a plain-text body or a body whose only member is message"
  - input_class: boundary_unknown_path
    must_fail_with: "not_found"
    must_not: "the code method_not_allowed for a path matching no endpoint"
  - input_class: boundary_unlisted_method
    must_fail_with: "method_not_allowed"
    must_not: "the code not_found for a listed path"
assertion_summary:
  - "every error response is JSON with Content-Type application/json and carries exactly the member error, plus conflictingBookingId on room_busy."
  - "a path matching no endpoint never answers 405 and a listed path with an unlisted method never answers 404."
  - "no error response reports the failure in a free-text member only."
feasibility: feasible
```

### room-booking-api:INV-001

```yaml
id: room-booking-api:INV-001
template: Invariant
obligation: "For every room, the k-th created room since process start carries the id r<k> and no other id shape is ever assigned."
input_classes:
  - name: typical_first_room
    input: "POST /rooms with name Aurora and capacity 4 on an empty store"
    expected: "201 with id r1"
  - name: boundary_tenth_room
    input: "POST /rooms with name Aurora and capacity 4 after nine rooms were created in order"
    expected: "201 with id r10"
  - name: invalid_rejected_creation
    input: "POST /rooms with name Aurora and capacity 0 between two valid creations, then POST /rooms with name Borealis and capacity 10"
    expected: "invalid_room; HTTP 400, then 201 with the next id after the created count"
  - name: boundary_full_listing
    input: "GET /rooms after three valid creations"
    expected: "200 listing the ids r1, r2 and r3 and no other id value"
negative_oracle:
  - input_class: invalid_rejected_creation
    must_fail_with: "invalid_room"
    must_not: "a room id consumed by the rejected request or a gap in the ids of the created rooms"
assertion_summary:
  - "every room id in every response matches the shape r followed by the creation rank, starting at r1."
  - "no rejected creation consumes an id, so the ids of the created rooms stay consecutive."
  - "the property holds for every room listed by GET /rooms, not only for the most recent one."
feasibility: feasible
```

### room-booking-api:INV-002

```yaml
id: room-booking-api:INV-002
template: Invariant
obligation: "The k-th booking created since process start carries the id b<k> counted across all rooms, and a deleted id is never reused."
input_classes:
  - name: typical_two_rooms
    input: "POST /rooms/r1/bookings 09:00 to 10:00, then POST /rooms/r2/bookings 09:00 to 10:00"
    expected: "201 with id b1, then 201 with id b2"
  - name: empty_first_booking
    input: "POST /rooms/r1/bookings as the first booking of the process"
    expected: "201 with id b1"
  - name: boundary_after_deletion
    input: "DELETE /bookings/b1, then POST /rooms/r1/bookings 09:00 to 10:00"
    expected: "204, then 201 with id b3"
  - name: invalid_rejected_creation
    input: "POST /rooms/r1/bookings with the title the empty string, then a valid booking"
    expected: "invalid_booking; HTTP 400, then 201 with the next id of the sequence"
negative_oracle:
  - input_class: invalid_rejected_creation
    must_fail_with: "invalid_booking"
    must_not: "a booking id consumed by the rejected request"
assertion_summary:
  - "booking ids increase across rooms, so the second room's booking takes the next id, never b1 again."
  - "the id of a deleted booking is never assigned to a later booking."
  - "the ids of all listed bookings follow the global creation order."
feasibility: feasible
```

### room-booking-api:INV-003

```yaml
id: room-booking-api:INV-003
template: Invariant
obligation: "The store never holds two bookings of the same room whose half-open intervals share an instant, while an interval starting when another ends is stored."
input_classes:
  - name: typical_adjacent_pair
    input: "POST /rooms/r1/bookings 09:00 to 10:00, then POST /rooms/r1/bookings 10:00 to 11:00"
    expected: "201, then 201; GET /rooms/r1/bookings lists both"
  - name: boundary_partially_overlapping_pair
    input: "POST /rooms/r1/bookings 09:00 to 10:00, then POST /rooms/r1/bookings 09:30 to 10:30"
    expected: "201, then room_busy; HTTP 409 with conflictingBookingId b1"
  - name: boundary_identical_interval
    input: "POST /rooms/r1/bookings 09:00 to 10:00 twice"
    expected: "201, then room_busy; HTTP 409 with conflictingBookingId b1"
  - name: typical_different_rooms
    input: "POST /rooms/r1/bookings 09:00 to 10:00 and POST /rooms/r2/bookings 09:00 to 10:00"
    expected: "201 for both"
negative_oracle:
  - input_class: boundary_partially_overlapping_pair
    must_fail_with: "room_busy"
    must_not: "a second booking stored for the overlapping interval"
  - input_class: boundary_identical_interval
    must_fail_with: "room_busy"
    must_not: "a stored duplicate booking"
assertion_summary:
  - "after every accepted creation, no two bookings in GET /rooms/r1/bookings share an instant."
  - "two bookings whose intervals touch at a boundary both appear in the listing."
  - "bookings of different rooms may share an interval freely."
feasibility: feasible
```

### room-booking-api:INV-004

```yaml
id: room-booking-api:INV-004
template: Invariant
obligation: "Every response with a body carries Content-Type application/json and a 204 response carries no body."
input_classes:
  - name: typical_success_response
    input: "POST /rooms with a valid body"
    expected: "201 with Content-Type application/json"
  - name: boundary_no_content_response
    input: "DELETE /bookings/b1 while b1 exists"
    expected: "204 with an empty body"
  - name: invalid_error_response
    input: "GET /rooms?minCapacity=0"
    expected: "invalid_query; HTTP 400 with Content-Type application/json"
negative_oracle:
  - input_class: invalid_error_response
    must_fail_with: "invalid_query"
    must_not: "a plain-text body or a Content-Type other than application/json"
assertion_summary:
  - "the success response and the error response both carry Content-Type application/json."
  - "the 204 response carries no body and no JSON payload."
  - "no response served as text/plain is observed over any of the three classes."
feasibility: feasible
```

### room-booking-api:INV-005

```yaml
id: room-booking-api:INV-005
template: Invariant
obligation: "A room body carries exactly id, name and capacity, a booking body exactly id, roomId, title, start, end and attendees, and an error exactly error plus conflictingBookingId on room_busy."
input_classes:
  - name: typical_room_body
    input: "POST /rooms with body {\"name\": \"Aurora\", \"capacity\": 10, \"floor\": 3}"
    expected: "201 whose body carries exactly id, name and capacity"
  - name: typical_booking_body
    input: "POST /rooms/r1/bookings with a valid body carrying the extra member notes"
    expected: "201 whose body carries exactly id, roomId, title, start, end and attendees"
  - name: boundary_room_busy_body
    input: "POST /rooms/r1/bookings 09:30 to 10:30 while b1 holds 09:00 to 10:00"
    expected: "room_busy; HTTP 409 whose body carries exactly error and conflictingBookingId"
negative_oracle:
  - input_class: boundary_room_busy_body
    must_fail_with: "room_busy"
    must_not: "a body carrying a message member alongside the code, or a body without conflictingBookingId"
assertion_summary:
  - "the member set of each response body equals the documented set exactly, with no extra and no missing member."
  - "members submitted beyond the stated ones never appear in any response body or listing."
  - "the room_busy body carries two members and every other error body carries one."
feasibility: feasible
```

### room-booking-api:INV-006

```yaml
id: room-booking-api:INV-006
template: Invariant
obligation: "No room or booking survives a restart of the process: the restarted process starts with an empty store and assigns ids from r1 and b1 again."
input_classes:
  - name: typical_restart_after_writes
    input: "create a room and a booking, stop the process, start it again, then GET /rooms and GET /rooms/r1/bookings"
    expected: "200 with body {\"rooms\": []} and 404 with the error member room_not_found"
  - name: empty_fresh_start
    input: "GET /rooms on a freshly started process that has served no write"
    expected: "200 with body {\"rooms\": []}"
  - name: boundary_ids_restart
    input: "POST /rooms with a valid body on the restarted process"
    expected: "201 with id r1"
assertion_summary:
  - "the rooms and bookings created before the restart are absent from every response after it."
  - "the restarted process answers 200 with an empty rooms list as its first observation."
  - "the id sequence restarts at r1, so no id from the earlier run reappears."
feasibility: feasible
```

### room-booking-api:INV-007

```yaml
id: room-booking-api:INV-007
template: Invariant
obligation: "Every listing respects its stated ordering: rooms by id, bookings by start then id, availability rooms by capacity then id."
input_classes:
  - name: typical_room_listing
    input: "GET /rooms after three rooms were created in order"
    expected: "200 listing r1, r2, r3 in that order"
  - name: boundary_booking_listing
    input: "GET /rooms/r1/bookings while r1 holds bookings with starts 11:00, 09:00 and 11:00 created in that order"
    expected: "200 listing the 09:00 booking first, then the two 11:00 bookings in id order"
  - name: boundary_availability_equal_capacity
    input: "GET /availability for a free interval while two free rooms of capacity 10 exist as r1 and r3"
    expected: "200 listing r1 before r3"
  - name: empty_listing
    input: "GET /rooms/r1/bookings while r1 holds no booking"
    expected: "200 with body {\"bookings\": []}"
assertion_summary:
  - "each listing is ordered by its stated keys and never by insertion order alone."
  - "equal sort keys are broken by ascending id."
  - "a single-element or empty listing satisfies the ordering vacuously and returns no error."
feasibility: feasible
```

### room-booking-api:POL-001

```yaml
id: room-booking-api:POL-001
template: Policy
obligation: "Every error response is JSON carrying exactly the documented error code, plus conflictingBookingId on room_busy, and no free-text message is part of the contract."
input_classes:
  - name: typical_validation_error
    input: "POST /rooms with body {\"name\": \"\", \"capacity\": 10}"
    expected: "400 with body {\"error\": \"invalid_room\"}"
  - name: typical_conflict_error
    input: "POST /rooms/r1/bookings 09:30 to 10:30 while b1 holds 09:00 to 10:00"
    expected: "409 with body {\"error\": \"room_busy\", \"conflictingBookingId\": \"b1\"}"
  - name: boundary_routing_error
    input: "GET /nope, then PUT /rooms"
    expected: "404 with body {\"error\": \"not_found\"}, then 405 with body {\"error\": \"method_not_allowed\"}"
  - name: boundary_capacity_error
    input: "POST /rooms/r1/bookings with attendees 11 on r1 of capacity 10"
    expected: "422 with body {\"error\": \"over_capacity\"}"
negative_oracle:
  - input_class: typical_validation_error
    must_fail_with: "invalid_room"
    must_not: "a plain-text body, or a body whose only member is message"
  - input_class: typical_conflict_error
    must_fail_with: "room_busy"
    must_not: "a body without the member conflictingBookingId"
  - input_class: boundary_routing_error
    must_fail_with: "not_found"
    must_not: "an undocumented code or an HTML body"
  - input_class: boundary_capacity_error
    must_fail_with: "over_capacity"
    must_not: "a code outside the documented set"
assertion_summary:
  - "every observed error body carries a member error whose value is one of the documented codes."
  - "the members of every error body are exactly error, plus conflictingBookingId on room_busy."
  - "no failure is reported in free text only, and no response body carries an undocumented code."
feasibility: feasible
```

### room-booking-api:POL-002

```yaml
id: room-booking-api:POL-002
template: Policy
obligation: "Every request is validated at the boundary, an input that violates a stated rule yields its documented error response, and the process still serves the next request."
input_classes:
  - name: typical_malformed_body
    input: "POST /rooms with the truncated body {\"name\": \"Aurora\", then GET /rooms"
    expected: "invalid_json; HTTP 400, then 200 with a rooms list"
  - name: boundary_out_of_range_time
    input: "POST /rooms/r1/bookings with start 2026-13-45T99:99:99Z, then GET /rooms/r1/bookings"
    expected: "invalid_booking; HTTP 400, then 200 with a bookings list"
  - name: boundary_oversized_number
    input: "POST /rooms with body {\"name\": \"Aurora\", \"capacity\": 1e400}, then GET /rooms"
    expected: "invalid_room; HTTP 400, then 200 with a rooms list"
  - name: empty
    input: "POST /rooms with an empty body, then POST /rooms with body {\"name\": \"Aurora\", \"capacity\": 10}"
    expected: "invalid_json; HTTP 400, then 201 with id r1"
negative_oracle:
  - input_class: typical_malformed_body
    must_fail_with: "invalid_json"
    must_not: "the process exiting, or a request left without a response"
  - input_class: boundary_out_of_range_time
    must_fail_with: "invalid_booking"
    must_not: "a 500 status or a crashed process"
assertion_summary:
  - "every rejected request receives a response with a documented code and Content-Type application/json."
  - "the request sent after a rejected request answers its normal status, so the process is still serving."
  - "no rejected request ends the process, leaves the connection open without a response, or answers 500."
feasibility: feasible
```

## 4. Infeasible candidates

none
