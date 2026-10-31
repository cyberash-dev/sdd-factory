# Spec review: room-booking-api, round 2

decision: accept

## Findings

```yaml
- id: GA-001
  kind: conflict
  target_ids: [room-booking-api:CTR-009, room-booking-api:ASM-008, room-booking-api:OQ-008]
  source: L14
  resolution: decide
  finding: "room-booking-api:CTR-009 makes a query time parameter that is not an accepted time answer 400 invalid_query and its accepted set requires a seconds part of 00, while room-booking-api:ASM-008 and the default option OPT-001 of room-booking-api:OQ-008 state that the whole-minute rule is not applied to query times, so for a query time whose seconds part is not 00 the two records cannot both hold"
  resolution_text: "The source fixes the time format once at L14 with minute precision and the query specifications at L44 and L54 reuse that same time, so the reading already encoded in the error_taxonomy of room-booking-api:CTR-009 is the faithful one and the default option of room-booking-api:OQ-008 is the side that breaks a source-backed record"
  required_change: |
    Replace the body of room-booking-api:ASM-008 with the body given in the Assumptions section of
    this review, which states that the query time parameters from, to, start and end must be
    accepted times under room-booking-api:CTR-009, so a query value whose seconds part is not 00,
    that carries a non-UTC offset or that is unparseable answers 400 invalid_query on the route
    that consumes it. In room-booking-api:BEH-015 and room-booking-api:BEH-020 add the boundary
    class and the negative case of a query time whose seconds part is not 00 answering 400
    invalid_query. Keep room-booking-api:CTR-009 unchanged.
  assumption: room-booking-api:ASM-008
  applied: yes

- id: GA-002
  kind: missing_negative
  target_ids: [room-booking-api:BEH-005]
  source: L29
  resolution: decide
  finding: "room-booking-api:BEH-005 carries no negative case naming a code from the error_taxonomy of room-booking-api:CTR-002; its only negative case is the empty room list"
  resolution_text: "The missing negative case is dictated by L29 and by the error_taxonomy of room-booking-api:CTR-002, so the fix is mechanical and needs no assumption"
  required_change: |
    In room-booking-api:BEH-005 add the negative case that GET /rooms?minCapacity=abc answers
    400 invalid_query, so the behavior carries a code-naming negative case drawn from the
    error_taxonomy of room-booking-api:CTR-002.
  assumption: null
  applied: yes

- id: GA-003
  kind: gap
  target_ids: [room-booking-api:BEH-020, room-booking-api:CTR-006]
  source: L54
  resolution: decide
  finding: "room-booking-api:BEH-020 asserts that an attendees value that is not a positive integer answers 400 invalid_query, but the source asks only for an integer in the availability query and states the positive-integer rule explicitly only for minCapacity, and no ASSUMPTION records the stronger reading"
  resolution_text: "The glossary defines attendees as an integer of at least 1 and the source applies that bound to booking bodies, so the spec keeps its rejection and records it explicitly, which also keeps the availability answer deterministic"
  required_change: |
    Insert room-booking-api:ASM-009 with the body given in the Assumptions section of this review,
    stating that the attendees query parameter of GET /availability must be an integer of at least
    1 and that a missing, non-integer or non-positive value answers 400 invalid_query. Change the
    query of room-booking-api:CTR-006 to attendees=<integer of at least 1>. Cite
    room-booking-api:ASM-009 in the notes of room-booking-api:BEH-020.
  assumption: room-booking-api:ASM-009
  applied: yes

- id: GA-004
  kind: missing_negative
  target_ids: [room-booking-api:BEH-024]
  source: L61
  resolution: decide
  finding: "room-booking-api:BEH-024 carries no negative case naming a code from the error_taxonomy of room-booking-api:CTR-010; its negative cases assert only the empty 204 body and the 200 content type"
  resolution_text: "The missing negative case is dictated by L61 and L62 and by the error_taxonomy of room-booking-api:CTR-010, so the fix is mechanical and needs no assumption"
  required_change: |
    In room-booking-api:BEH-024 add the negative case that an error response, for example
    GET /rooms?minCapacity=abc answering 400 invalid_query, carries Content-Type application/json
    and a code from the error_taxonomy of room-booking-api:CTR-010.
  assumption: null
  applied: yes

- id: GA-005
  kind: gap
  target_ids: [room-booking-api:CON-003]
  source: L72
  resolution: decide
  finding: "the acceptance line of the source is traced by no record because room-booking-api:CON-003 cites L67, which carries no requirement, instead of the acceptance line"
  resolution_text: "The acceptance criteria are already carried by the constraint itself and the ephemeral-port allowance is already a boundary class of room-booking-api:CTR-011, so the citation is the only defect"
  required_change: |
    In the notes of room-booking-api:CON-003 replace the citation L67 with L72 and keep every
    other field of the constraint unchanged.
  assumption: null
  applied: yes
```

## Assumptions

```yaml
---
id: room-booking-api:ASM-008
type: ASSUMPTION
lifecycle: {status: proposed}
partition_id: room-booking-api
title: query times obey the whole-minute rule
assumption: "the query time parameters `from`, `to`, `start` and `end` must be accepted times under room-booking-api:CTR-009, so a query value whose seconds part is not `00`, that carries a non-UTC offset or that is unparseable answers 400 invalid_query on the route that consumes it"
source_open_q: room-booking-api:OQ-008
blocking: no
review_by: 2027-01-29
default_if_unresolved: keep_assumption
tests: [room-booking-api:BEH-015, room-booking-api:BEH-020, room-booking-api:CTR-009]
notes: "decided by GA-001; source: L14, L44, L54, L57"
---
```

```yaml
---
id: room-booking-api:ASM-009
type: ASSUMPTION
lifecycle: {status: proposed}
partition_id: room-booking-api
title: availability attendees must be a positive integer
assumption: "the attendees query parameter of GET /availability must be an integer of at least 1, and a missing, non-integer or non-positive value answers 400 invalid_query"
source_open_q: null
blocking: no
review_by: 2027-01-29
default_if_unresolved: keep_assumption
tests: [room-booking-api:BEH-020, room-booking-api:CTR-006]
notes: "decided by GA-003; source: L29, L33, L54-L57"
---
```

## Open-Q decisions

Round 2 is verification only; no Open-Q is re-decided. The decisions of round 1 stand unchanged: room-booking-api:OQ-001 through room-booking-api:OQ-007 by their existing assumption records, room-booking-api:OQ-008 by OPT-002 through GA-001, whose replacement body of room-booking-api:ASM-008 is now present in section 18 of the spec.

## Coverage

Verification notes: every required change of round 1 is present in the spec. room-booking-api:ASM-008 and room-booking-api:ASM-009 are inserted verbatim in section 18, room-booking-api:BEH-005 carries the missing_negative case for room-booking-api:CTR-002, room-booking-api:BEH-015 and room-booking-api:BEH-020 carry the whole-minute query-time boundary class and negative case, room-booking-api:BEH-024 carries a negative case naming a code from the taxonomy of room-booking-api:CTR-010, room-booking-api:CTR-006 states the attendees bound, and room-booking-api:CON-003 cites L72. No new finding is opened and no assume finding is revisited.
