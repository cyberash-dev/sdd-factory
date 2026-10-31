# Spec review: room-booking-api, round 2

decision: accept

Round 2 is verification only: the nine round 1 findings, all with resolution decide, were re-checked against spec.md as it now stands; no new finding is opened and no re-decision is made. Evidence per finding: room-booking-api:CTR-007 compatibility_rules carries the shared-Error-code entry verbatim and the six error_taxonomy lists are unchanged (GA-001); the when clauses of room-booking-api:BEH-003, room-booking-api:BEH-011 and room-booking-api:BEH-015 cover an absent capacity, start, end and attendees and room-booking-api:ASM-002 lists BEH-011 and BEH-015 in tests (GA-002); room-booking-api:BEH-002 and room-booking-api:BEH-010 state the whitespace-only name and title, the one-space negative cases and the whitespace-only boundary class per room-booking-api:ASM-006 (GA-003); room-booking-api:BEH-001 and room-booking-api:BEH-008 state that an extra body member is neither stored nor echoed and room-booking-api:ASM-008 lists BEH-008 in tests (GA-004); room-booking-api:BEH-012 carries the negative case "start 2026-11-02T09:30Z (no seconds member) => HTTP 201 (created) (see room-booking-api:ASM-004)" and the seconds-less boundary class (GA-005); room-booking-api:POL-002 names POST /rooms/r1/bookings in the malformed-time obligation (GA-006); the Glossary defines Instant (GA-007); room-booking-api:CN-001 states that the server is implemented in TypeScript (GA-008); room-booking-api:CN-003 titled acceptance gates covers npm run build, npm test and the ephemeral port with notes source: L70-L72 (GA-009). One cosmetic deviation was found and accepted: the notes member of room-booking-api:ASM-010 reads "source: L61 (decided by GA-001)" where the round 1 body read "decided by GA-001; source: none"; every decision-bearing member (id, type, lifecycle, partition_id, title, assumption, source_open_q, blocking, review_by, default_if_unresolved, tests) is verbatim, so the body counts as inserted verbatim and is recorded as applied.

## Findings

```yaml
- id: GA-001
  kind: conflict
  target_ids: [room-booking-api:CTR-001, room-booking-api:CTR-002, room-booking-api:CTR-003, room-booking-api:CTR-004, room-booking-api:CTR-006, room-booking-api:CTR-007]
  source: none
  resolution: decide
  required_change: "In room-booking-api:CTR-007 add to compatibility_rules the entry \"a shared Error code — invalid_json, invalid_query or room_not_found — carries one definition, the same HTTP status and body shape wherever it is listed, and every Contract whose endpoint can emit it lists that code in its own error_taxonomy\"; keep the error_taxonomy lists of CTR-001, CTR-002, CTR-003, CTR-004, CTR-006 and CTR-007 as they stand. Rationale: the codes invalid_json (CTR-001, CTR-003, CTR-007), invalid_query (CTR-002, CTR-004, CTR-006) and room_not_found (CTR-003, CTR-004) each appear in more than one error_taxonomy, and no de-duplication avoids an empty taxonomy, because CTR-002 and CTR-006 can emit only invalid_query — removing the code from either leaves that Contract with no entry the source states for it, while moving room_not_found out of CTR-004 hides the L45 error from the Contract that emits it. The per-emitter listings with a single shared definition recorded once in CTR-007 is the reading that breaks no source-backed record."
  assumption: room-booking-api:ASM-010
  applied: yes
- id: GA-002
  kind: gap
  target_ids: [room-booking-api:BEH-003, room-booking-api:BEH-011, room-booking-api:BEH-015, room-booking-api:ASM-002]
  source: L33
  resolution: decide
  required_change: "Extend the when clause of room-booking-api:BEH-003 with an absent capacity, of room-booking-api:BEH-011 with an absent or non-string start or end, and of room-booking-api:BEH-015 with an absent attendees, each answered by the body validation code exactly as room-booking-api:ASM-002 states; add room-booking-api:BEH-011 and room-booking-api:BEH-015 to the tests of room-booking-api:ASM-002. The Open-Q default is recorded only in the ASSUMPTION body; no Behavior states the reading, so acceptance tests written from the source would not cover absent capacity, start, end or attendees."
  assumption: room-booking-api:ASM-002
  applied: yes
- id: GA-003
  kind: gap
  target_ids: [room-booking-api:BEH-002, room-booking-api:BEH-010, room-booking-api:ASM-006]
  source: L20
  resolution: decide
  required_change: "Extend the when clause and the boundary_classes of the test_obligation of room-booking-api:BEH-002 and room-booking-api:BEH-010 with a whitespace-only name and title, stated as accepted and echoed verbatim per room-booking-api:ASM-006, with the corresponding negative_cases \"a name of one space => HTTP 201 (created)\" and \"a title of one space => HTTP 201 (created)\". The Open-Q default is recorded only in the ASSUMPTION body; no Behavior states the reading."
  assumption: room-booking-api:ASM-006
  applied: yes
- id: GA-004
  kind: gap
  target_ids: [room-booking-api:BEH-001, room-booking-api:BEH-008, room-booking-api:ASM-008]
  source: L20
  resolution: decide
  required_change: "State in room-booking-api:BEH-001 and room-booking-api:BEH-008, in the when clause or as a negative_case, that a request body carrying a member beyond the stated ones is accepted with the extra member neither stored nor echoed, per room-booking-api:ASM-008; add room-booking-api:BEH-008 to the tests of room-booking-api:ASM-008. The Open-Q default is recorded only in the ASSUMPTION body; room-booking-api:INV-005 covers response bodies only."
  assumption: room-booking-api:ASM-008
  applied: yes
- id: GA-005
  kind: gap
  target_ids: [room-booking-api:BEH-012, room-booking-api:ASM-004]
  source: L14
  resolution: decide
  required_change: "Add to the negative_cases of room-booking-api:BEH-012 the case \"start 2026-11-02T09:30Z (no seconds member) => HTTP 201 (created) (see room-booking-api:ASM-004)\" and add the seconds-less form to its test_obligation boundary_classes. The Open-Q default accepts the seconds-less writing, but the only form any Behavior states is the zero-fraction form 2026-11-02T09:00:00.000Z."
  assumption: room-booking-api:ASM-004
  applied: yes
- id: GA-006
  kind: untestable
  target_ids: [room-booking-api:POL-002]
  source: none
  resolution: decide
  required_change: "In room-booking-api:POL-002 name the endpoint in the malformed-time negative_test_obligation, reading \"a POST /rooms/r1/bookings with the time 2026-13-45T99:99:99Z yields 400 invalid_booking and the next request still succeeds\". As written the obligation gives an input with no route, so the expected code is undetermined: the same time on GET /availability yields invalid_query."
  assumption: null
  applied: yes
- id: GA-007
  kind: unmodeled_term
  target_ids: [room-booking-api:INV-003]
  source: L14
  resolution: decide
  required_change: "In section 2 Glossary add the entry Instant — the point in time a Time denotes, the unit over which Overlap, Interval and the statement of room-booking-api:INV-003 are quantified. Instant is used in the normative statement of INV-003 and in the Overlap definition but is absent from the Glossary."
  assumption: null
  applied: yes
- id: GA-008
  kind: gap
  target_ids: [room-booking-api:CN-001]
  source: L3
  resolution: decide
  required_change: "Extend the constraint of room-booking-api:CN-001 with the sentence \"the server is implemented in TypeScript\"; the source names the language at L3 and no record of the specification states it."
  assumption: null
  applied: yes
- id: GA-009
  kind: gap
  target_ids: []
  source: L72
  resolution: decide
  required_change: "Add the Constraint room-booking-api:CN-003 titled \"acceptance gates\" whose constraint states that npm run build compiles and npm test passes and that tests may start the server on an ephemeral port, with notes \"source: L70-L72\". The acceptance section of the source has no record."
  assumption: null
  applied: yes
```

## Assumptions

(none — round 2 is verification only; no new ASSUMPTION body must be inserted. The three bodies round 1 required, room-booking-api:ASM-010, room-booking-api:ASM-002 and room-booking-api:ASM-008, stand in section 18 of spec.md with every decision-bearing member verbatim; the sole deviation is the non-normative notes member of room-booking-api:ASM-010, recorded as accepted in the verification note above.)

## Open-Q decisions

| Open-Q | option | finding | rationale |
| --- | --- | --- | --- |
| room-booking-api:OQ-001 | OQ-001-A | — | default; L64 states unknown routes answer 404 not_found and room-booking-api:BEH-026 states the reading |
| room-booking-api:OQ-002 | OQ-002-A | GA-002 | default; an absent member is the invalid value of that body, matching the per-body error classes of L23 and L37; the reading needs stating in the Behaviors |
| room-booking-api:OQ-003 | OQ-003-A | — | default; L38 reserves over_capacity for attendees greater than the room capacity, so a non-positive or non-integer attendees is an invalid booking body |
| room-booking-api:OQ-004 | OQ-004-A | GA-005 | default; accepts the writings the source lists among no error case, and a non-zero seconds or fraction stays not on a whole minute |
| room-booking-api:OQ-005 | OQ-005-A | — | default; L12 and L13 assign ids in creation order, so an order by id is that order |
| room-booking-api:OQ-006 | OQ-006-A | GA-003 | default; accepts the whitespace-only value the source lists among no error case and echoes the value as given |
| room-booking-api:OQ-007 | OQ-007-A | — | default; L54 types the availability attendees only as an integer, and every capacity of a Room is at least any integer below 1 |
| room-booking-api:OQ-008 | OQ-008-A | GA-004 | default; accepts the extra member the source lists among no error case and keeps the response bodies exact per room-booking-api:INV-005 |
| room-booking-api:OQ-009 | OQ-009-A | — | default; L14 defines a Time as a Z-suffixed UTC string, so a writing with an offset is not a Time and takes the invalid-time class of the endpoint |

## Coverage

- No source line of L1-L68 is without a record. The two coverage gaps of round 1 are closed: L3 is cited by room-booking-api:CN-001 and L70-L72 by room-booking-api:CN-003.
- No record carries a normative statement without a cited source line or an ASSUMPTION behind it.
- Every error code of the surface appears in the error_taxonomy of every Contract that can emit it and shares one definition recorded in room-booking-api:CTR-007 per room-booking-api:ASM-010.
