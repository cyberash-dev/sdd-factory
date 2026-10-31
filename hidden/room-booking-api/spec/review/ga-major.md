# Spec review: room-booking-api, round 1

decision: rework

## Findings
```yaml
- id: GA-001
  kind: conflict
  target_ids: [room-booking-api:BEH-026, room-booking-api:CTR-003, room-booking-api:OQ-002, room-booking-api:OQ-005, room-booking-api:ASM-002, room-booking-api:ASM-005]
  source: L13-L14
  resolution: decide
  severity: major
  finding: "The booking start and end are normalized instead of being returned as given, including when a valid whole-minute time contains zero fractional seconds."
  required_change: "Rewrite BEH-026, CTR-003 time_format, OQ-002 option A and ASM-002 to accept the stated whole-minute spellings and preserve each input spelling in the booking; select OQ-005 OPT-B and rewrite ASM-005 to require the start and end strings as given in every booking response, with corresponding examples and test obligations."
  assumption: null
- id: GA-002
  kind: conflict
  target_ids: [room-booking-api:BEH-025, room-booking-api:CTR-002, room-booking-api:CTR-004, room-booking-api:CTR-005, room-booking-api:CTR-006, room-booking-api:INV-006, room-booking-api:OQ-007, room-booking-api:ASM-007]
  source: L63-L64
  resolution: decide
  severity: major
  finding: "A malformed request body on GET or DELETE is ignored, although the invalid_json rule applies to a request body generally."
  required_change: "Select OQ-007 OPT-B and rewrite BEH-025, CTR-002 compatibility_rules, INV-006 and ASM-007 so that a supplied malformed request body on a supported GET or DELETE yields 400 invalid_json after route and method checks, while an absent body remains acceptable; add invalid_json to the error taxonomies of CTR-002, CTR-004, CTR-005 and CTR-006 and test the affected endpoints and precedence."
  assumption: null
- id: GA-003
  kind: untestable
  target_ids: [room-booking-api:BEH-011, room-booking-api:BEH-013, room-booking-api:SCN-003]
  source: L39-L43
  resolution: decide
  severity: major
  finding: "The given states require overlapping existing bookings in one room, which cannot be created through the API; equal-start existing bookings in that room are likewise unreachable."
  required_change: "Rewrite BEH-011 and SCN-003 with adjacent non-overlapping existing bookings that both overlap the requested interval, and rewrite BEH-013 with reachable distinct-start bookings in a different creation order; adjust the negative cases and test obligations to use reachable states while retaining earliest-conflict and booking-order checks."
  assumption: null
- id: GA-004
  kind: conflict
  target_ids: [room-booking-api:BEH-020, room-booking-api:ASM-004]
  source: L54-L56
  resolution: decide
  severity: major
  finding: "The attendees=0 example returns every room even when a room has an overlapping booking, contrary to the availability rule."
  required_change: "Rewrite the attendees=0 negative case of BEH-020 and the assumption of ASM-004 so that all rooms satisfy the capacity test but only rooms with no overlapping booking are returned; test both free and busy rooms."
  assumption: null
- id: GA-005
  kind: conflict
  target_ids: [room-booking-api:BEH-008]
  source: L36, L63-L64
  resolution: decide
  severity: major
  finding: "The test obligation gives room_not_found precedence over any body validation, including malformed JSON, contrary to the required body-syntax precedence."
  required_change: "Rewrite the BEH-008 test obligation so that invalid_json wins for a malformed body and room_not_found precedes endpoint field validation for valid JSON, and test an unknown room with a malformed body."
  assumption: null
- id: GA-006
  kind: conflict
  target_ids: [room-booking-api:CTR-003]
  source: L33, L37
  resolution: decide
  severity: major
  finding: "The invalid_booking taxonomy includes attendees below 1 but omits missing, non-integer and non-number attendees, which also violate the stated field constraint."
  required_change: "Rewrite CTR-003 E_INVALID_BOOKING to cover every attendees value outside integer at least 1, including missing, non-number and non-integer values, and add those classes to its test obligation."
  assumption: null
- id: GA-007
  kind: conflict
  target_ids: [room-booking-api:BEH-014]
  source: L14, L44
  resolution: decide
  severity: major
  finding: "The successful query example spells from and to as time-only values rather than the required ISO-8601 UTC time strings."
  required_change: "Rewrite BEH-014 when and its query examples with complete ISO-8601 UTC timestamps, preserving the stated half-open interval and expected booking."
  assumption: null
- id: GA-008
  kind: conflict
  target_ids: [room-booking-api:INV-006]
  source: L64
  resolution: decide
  severity: major
  finding: "The negative case says POST /rooms/r99/bookings matches no route, although it matches the documented booking route."
  required_change: "Rewrite the INV-006 routing negative case using an actually unknown path with an unsupported method and require 404 not_found before method or body checks."
  assumption: null
```

## Assumptions
none
