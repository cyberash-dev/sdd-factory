# Spec review: room-booking-api, round 2

decision: accept

## Findings

```yaml
- id: GA-001
  kind: missing_negative
  target_ids: [room-booking-api:BEH-013]
  source: L44
  resolution: decide
  required_change: "Add to room-booking-api:BEH-013 at least one negative case naming a code from the error_taxonomy of room-booking-api:CTR-005, for example \"only from given without to => 400 invalid_query\" or \"GET /rooms/r99/bookings with a valid window => 404 room_not_found\", instead of relying on room-booking-api:BEH-014 to carry every code-naming negative case of the GET /rooms/:roomId/bookings surface."
  assumption: null
  applied: yes
- id: GA-002
  kind: untestable
  target_ids: [room-booking-api:CON-004]
  source: L3
  resolution: decide
  required_change: "Replace the test_obligation of room-booking-api:CON-004 with a predicate checkable from responses, exit status or persisted state — for example the restart observation of room-booking-api:INV-005 combined with the keep-serving observation of room-booking-api:POL-002 — because \"no request leaves the process and no service other than the HTTP listener is contacted\" is not observable from the Surface room-booking-api:SUR-001."
  assumption: null
  applied: yes
- id: GA-003
  kind: unmodeled_term
  target_ids: [room-booking-api:BEH-020, room-booking-api:BEH-021]
  source: L64
  resolution: decide
  required_change: "Add Glossary entries in section 2 for Route, Path and Endpoint — a Route being the method and path pair that a Contract of room-booking-api:SUR-001 declares — so that room-booking-api:BEH-020, room-booking-api:BEH-021 and room-booking-api:ASM-009 use modeled terms when they fix the 404 not_found versus 405 method_not_allowed boundary."
  assumption: null
  applied: yes
```

## Assumptions

No ASSUMPTION body is written in round 2. All three round-1 findings were mechanical fixes dictated by the source or by a lint rule and mint no body; the twelve existing bodies room-booking-api:ASM-001 through room-booking-api:ASM-012 are present in spec.md section 18 unchanged.

## Open-Q decisions

Carried over from round 1; every Open-Q is closed as `assume` on its `default_if_unresolved` with the matching existing ASSUMPTION body, and no record changed in round 2:

| Open-Q | option | finding | rationale |
| --- | --- | --- | --- |
| room-booking-api:OQ-001 | reject_whitespace_only | none (assume) | equals default_if_unresolved; room-booking-api:ASM-001 pins the BEH-002 and BEH-008 obligations |
| room-booking-api:OQ-002 | utf16_code_units | none (assume) | equals default_if_unresolved; room-booking-api:ASM-002 pins the length-boundary obligations |
| room-booking-api:OQ-003 | ignore_extra | none (assume) | equals default_if_unresolved; room-booking-api:ASM-003 keeps the accepted request class widest |
| room-booking-api:OQ-004 | route_then_resource_then_body | none (assume) | equals default_if_unresolved; L36-L39 put the unknown-room answer before the body classes; room-booking-api:ASM-004 records the full order |
| room-booking-api:OQ-005 | strict_minute_z | none (assume) | equals default_if_unresolved; L14 fixes the Time form; room-booking-api:ASM-005 exists |
| room-booking-api:OQ-006 | same_strict_rules | none (assume) | equals default_if_unresolved; one Time rule keeps the surface smallest; room-booking-api:ASM-006 exists |
| room-booking-api:OQ-007 | positive_integer_only | none (assume) | equals default_if_unresolved; L33 fixes attendees at 1 or more; room-booking-api:ASM-007 exists |
| room-booking-api:OQ-008 | numeric_suffix | none (assume) | equals default_if_unresolved; L12 assigns ids in creation order; room-booking-api:ASM-008 exists |
| room-booking-api:OQ-009 | declared_paths_only | none (assume) | equals default_if_unresolved; room-booking-api:ASM-009 enumerates the routes |
| room-booking-api:OQ-010 | invalid_json | none (assume) | equals default_if_unresolved; L63 keeps one code for an unusable body; room-booking-api:ASM-010 exists |
| room-booking-api:OQ-011 | lowest_id | none (assume) | equals default_if_unresolved; L39 names the earliest-starting conflicting Booking; room-booking-api:ASM-011 makes the tie deterministic |
| room-booking-api:OQ-012 | inclusive_bound | none (assume) | equals default_if_unresolved; L37 rejects only a Booking longer than 8 hours; room-booking-api:ASM-012 exists |

## Coverage

Unchanged from round 1. Source lines with no record: none; L1-L8 map to room-booking-api:SUR-001, CTR-001 and CON-006, L12-L14 to the Glossary, INV-001, INV-002, BEH-011 and the Contract compatibility rules, L16-L57 to CTR-002 through CTR-007 and BEH-001 through BEH-018, L61-L64 to POL-001, POL-002 and BEH-019 through BEH-022, L68 to section 19 and INV-004, INV-005, L72 to NFR-001 and CON-003. Records with no source line: room-booking-api:BL-001 only, the greenfield baseline of the scaffold commit.
