# Spec review: room-booking-api, round 2

decision: rework

## Findings

```yaml
- id: GA-001
  kind: conflict
  target_ids: [room-booking-api:BEH-001, room-booking-api:BEH-007]
  source: L23-L24, L36-L39
  finding: "The stated success conditions also cover a duplicate room name and a booking that exceeds capacity or overlaps another booking."
  resolution: decide
  required_change: "In BEH-001 require a name not already used case-insensitively; in BEH-007 require an existing room, attendees within its capacity and an interval without a conflict, in addition to the valid body."
  assumption: null
  applied: yes
- id: GA-002
  kind: untestable
  target_ids: [room-booking-api:BEH-011, room-booking-api:BEH-013, room-booking-api:INV-003]
  source: L14, L39, L43
  finding: "BEH-011 requires two overlapping bookings in one room, contradicting INV-003; BEH-013 requires testing equal-start bookings in one room, which cannot be created."
  resolution: decide
  required_change: "In BEH-011 change b2 to start at 10:00 and retain the requested interval and expected earliest conflict; in BEH-013 replace the unreachable equal-start boundary and failure scenario with reachable differently-starting bookings while retaining the source ordering rule."
  assumption: null
  applied: yes
- id: GA-003
  kind: missing_negative
  target_ids: [room-booking-api:BEH-003, room-booking-api:BEH-005, room-booking-api:BEH-010, room-booking-api:BEH-013, room-booking-api:BEH-017, room-booking-api:BEH-018, room-booking-api:BEH-020, room-booking-api:BEH-021]
  source: none
  finding: "These Behaviors have no negative case naming an error code in their Contract error_taxonomy."
  resolution: decide
  required_change: "Add a reachable negative case with a Contract error code to each listed Behavior, without changing the source-defined success cases."
  assumption: null
  applied: yes
- id: GA-004
  kind: conflict
  target_ids: [room-booking-api:BEH-015, room-booking-api:CTR-004]
  source: L44-L45
  finding: "An invalid from or to query on an unknown room is assigned room_not_found, although invalid_query is listed first."
  resolution: decide
  required_change: "Change CTR-004 schema.code_precedence to invalid_query then room_not_found, and change BEH-015 negative_cases and test_obligation so an invalid query on an unknown room returns 400 invalid_query."
  assumption: null
  applied: yes
- id: GA-005
  kind: gap
  target_ids: [room-booking-api:CTR-001, room-booking-api:CTR-003]
  source: L23-L24, L36-L39
  finding: "CTR-001 does not specify the winner for an invalid room that also has a taken name, and CTR-003 does not explicitly test precedence between invalid_booking, over_capacity and room_busy."
  resolution: decide
  required_change: "Add CTR-001 schema.code_precedence and test obligations requiring invalid_room before room_name_taken; add CTR-003 test obligations for invalid_booking before over_capacity and over_capacity before room_busy when both rules apply."
  assumption: null
  applied: yes
- id: GA-006
  kind: conflict
  target_ids: [room-booking-api:CTR-002, room-booking-api:CTR-003, room-booking-api:CTR-004, room-booking-api:CTR-005, room-booking-api:CTR-006, room-booking-api:CTR-007, room-booking-api:BEH-009, room-booking-api:BEH-020, room-booking-api:BEH-021]
  source: L29, L36-L39, L44-L45, L50, L57, L63-L64
  finding: "The general invalid_json rule covers a request body on every route, but several Contracts exclude it; CTR-003 also puts invalid_json before room_not_found despite the source listing room_not_found first."
  resolution: decide
  required_change: "Add 400 invalid_json to CTR-002, CTR-004, CTR-005, CTR-006 and CTR-007 error_taxonomy and their test obligations for a present invalid JSON body; specify source-listing precedence for simultaneous errors, including room_not_found before invalid_json in CTR-003, invalid_query before room_not_found before invalid_json in CTR-004, and invalid_json before not_found or method_not_allowed in CTR-007; align BEH-009, BEH-020 and BEH-021 and the affected Contract predicates and test obligations with those rules."
  assumption: null
  applied: no
  resolution_text: "CTR-002, CTR-004, CTR-005 and CTR-006 test obligations require invalid_json without the stated precedence exceptions; BEH-020 and BEH-021 also retain unconditional route-error predicates or failure scenarios that conflict with invalid_json precedence."
- id: GA-007
  kind: conflict
  target_ids: [room-booking-api:LOC-001]
  source: L12-L13, L20, L33
  finding: "LOC-001 forbids natural-language text in every response body, but room names and booking titles are strings supplied by the requester and returned in room and booking objects."
  resolution: decide
  required_change: "Rewrite LOC-001 rule and test_obligation to allow requester-supplied room names and booking titles, while retaining stable error codes and UTC time requirements."
  assumption: null
  applied: yes
- id: GA-008
  kind: gap
  target_ids: [room-booking-api:CON-001]
  source: none
  finding: "The source requires in-memory state but does not require the prohibition on outbound network access."
  resolution: decide
  required_change: "Retain CON-001's prohibition on outbound network access and cite room-booking-api:ASM-001 in its notes as the decision supporting that prohibition."
  assumption: room-booking-api:ASM-001
  applied: no
  resolution_text: "CON-001 cites ASM-001, but the ASSUMPTION body is not inserted verbatim: lifecycle and tests use different YAML representations."
- id: GA-009
  kind: gap
  target_ids: [room-booking-api:CON-002]
  source: none
  finding: "The source does not require the stated prohibition on runtime dependencies."
  resolution: decide
  required_change: "Retain CON-002's prohibition on runtime dependencies and cite room-booking-api:ASM-002 in its notes as the decision supporting that prohibition."
  assumption: room-booking-api:ASM-002
  applied: no
  resolution_text: "CON-002 cites ASM-002, but the ASSUMPTION body is not inserted verbatim: lifecycle and tests use different YAML representations."
- id: GA-010
  kind: conflict
  target_ids: [room-booking-api:Q-001, room-booking-api:Q-002, room-booking-api:Q-003, room-booking-api:Q-004, room-booking-api:Q-006, room-booking-api:Q-008]
  source: L13-L14, L20, L29, L33, L54, L57
  finding: "The highest_present, minute_form_only, accept_offset, trim_then_check, reject_extra and positive_only options respectively reuse a creation-order id, reject valid whole-minute spellings, accept a time without Z, reject non-empty strings, add unlisted validation errors, or reject integers that availability accepts."
  resolution: decide
  required_change: "Rewrite those options under their existing ids and their consequences to preserve the source readings: monotonic booking ids; acceptance of the stated whole-minute Z spellings; rejection of times without Z; acceptance of non-empty untrimmed names and titles; ignoring undocumented fields and parameters; and acceptance of any integer availability attendees."
  assumption: null
  applied: yes
- id: GA-011
  kind: gap
  target_ids: [room-booking-api:Q-001, room-booking-api:A-001]
  source: L13, L49
  finding: "The default monotonic_counter option is already stated and supported by A-001."
  resolution: assume
  required_change: "No change; retain monotonic_counter."
  assumption: null
- id: GA-012
  kind: gap
  target_ids: [room-booking-api:Q-002, room-booking-api:A-002]
  source: L14
  finding: "The default accept_and_echo option is already stated and supported by A-002."
  resolution: assume
  required_change: "No change; retain accept_and_echo."
  assumption: null
- id: GA-013
  kind: gap
  target_ids: [room-booking-api:Q-003, room-booking-api:A-003]
  source: L14
  finding: "The default reject_offset option is already stated and supported by A-003."
  resolution: assume
  required_change: "No change; retain reject_offset."
  assumption: null
- id: GA-014
  kind: gap
  target_ids: [room-booking-api:Q-004, room-booking-api:A-004]
  source: L20, L33
  finding: "The default length_only option is already stated and supported by A-004."
  resolution: assume
  required_change: "No change; retain length_only."
  assumption: null
- id: GA-015
  kind: gap
  target_ids: [room-booking-api:Q-005, room-booking-api:A-005]
  source: L28, L43, L56
  finding: "The default numeric_suffix option is already stated and supported by A-005."
  resolution: assume
  required_change: "No change; retain numeric_suffix."
  assumption: null
- id: GA-016
  kind: gap
  target_ids: [room-booking-api:Q-006, room-booking-api:A-006]
  source: L20, L29, L33, L44, L54
  finding: "The default ignore_extra option is already stated and supported by A-006."
  resolution: assume
  required_change: "No change; retain ignore_extra."
  assumption: null
- id: GA-017
  kind: gap
  target_ids: [room-booking-api:Q-007, room-booking-api:A-007]
  source: L7
  finding: "The default fail_to_start option is already stated and supported by A-007."
  resolution: assume
  required_change: "No change; retain fail_to_start."
  assumption: null
- id: GA-018
  kind: gap
  target_ids: [room-booking-api:Q-008, room-booking-api:A-008]
  source: L54, L57
  finding: "The default any_integer option is already stated and supported by A-008."
  resolution: assume
  required_change: "No change; retain any_integer."
  assumption: null
```

## Assumptions

```yaml
---
id: room-booking-api:ASM-001
type: ASSUMPTION
lifecycle: {status: proposed}
partition_id: room-booking-api
title: No outbound network access
assumption: The product makes no outbound network call and depends on no remote service.
source_open_q: null
blocking: no
review_by: "2027-01-29"
default_if_unresolved: keep_assumption
tests: [room-booking-api:CON-001 test_obligation]
notes: 'decided by GA-008; source: none'
---
```

```yaml
---
id: room-booking-api:ASM-002
type: ASSUMPTION
lifecycle: {status: proposed}
partition_id: room-booking-api
title: No runtime dependencies
assumption: The product declares no runtime dependency.
source_open_q: null
blocking: no
review_by: "2027-01-29"
default_if_unresolved: keep_assumption
tests: [room-booking-api:CON-002 test_obligation]
notes: 'decided by GA-009; source: none'
---
```

## Open-Q decisions

| Open-Q | option | finding | rationale |
| --- | --- | --- | --- |
| room-booking-api:Q-001 | monotonic_counter | GA-011; GA-010 | L13 assigns ids in creation order, including after deletion. |
| room-booking-api:Q-002 | accept_and_echo | GA-012; GA-010 | L14 accepts UTC whole-minute spellings; the existing assumption deterministically preserves the given string. |
| room-booking-api:Q-003 | reject_offset | GA-013; GA-010 | L14 requires a Z suffix. |
| room-booking-api:Q-004 | length_only | GA-014; GA-010 | L20 and L33 require non-empty strings, not trimmed strings. |
| room-booking-api:Q-005 | numeric_suffix | GA-015 | L28, L43 and L56 do not specify comparison of id strings; numeric order is the existing deterministic default. |
| room-booking-api:Q-006 | ignore_extra | GA-016; GA-010 | L20, L29, L33, L44 and L54 do not list extra fields or parameters as an error. |
| room-booking-api:Q-007 | fail_to_start | GA-017 | L7 does not specify malformed PORT values; the existing default is deterministic. |
| room-booking-api:Q-008 | any_integer | GA-018; GA-010 | L54 specifies an integer without a positive range. |

## Coverage

Verification only: GA-001 through GA-005, GA-007 and GA-010 are applied. GA-006 is not fully applied; GA-008 and GA-009 have the required citations but their ASSUMPTION bodies are not verbatim. The prior round's assume findings were not revisited.
