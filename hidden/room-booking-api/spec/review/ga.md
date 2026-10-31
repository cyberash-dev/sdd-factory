# Spec review: room-booking-api, round 2

decision: accept

## Findings

```yaml
- id: GA-001
  kind: gap
  target_ids: [room-booking-api:BEH-021, room-booking-api:CTR-007]
  source: none
  resolution: decide
  required_change: |
    Back the PORT=0 negative case of room-booking-api:BEH-021 with
    room-booking-api:ASM-007 and add an external_identifiers entry for the
    PORT environment variable to room-booking-api:CTR-007 so the Behavior is
    reachable through a member Contract of room-booking-api:SUR-001.
  assumption: room-booking-api:ASM-007
  applied: yes
- id: GA-002
  kind: missing_negative
  target_ids: [room-booking-api:BEH-016]
  source: L54
  resolution: decide
  required_change: |
    Add one negative case to room-booking-api:BEH-016 naming invalid_query,
    for example GET /availability with attendees omitted responds 400
    invalid_query.
  assumption: null
  applied: yes
- id: GA-003
  kind: gap
  target_ids: [room-booking-api:CON-004, room-booking-api:CON-005]
  source: none
  resolution: decide
  required_change: |
    Keep room-booking-api:CON-004 and room-booking-api:CON-005 and back them
    with room-booking-api:ASM-008.
  assumption: room-booking-api:ASM-008
  applied: yes
```

## Assumptions

```yaml
---
id: room-booking-api:ASM-007
type: ASSUMPTION
lifecycle: {status: proposed}
partition_id: room-booking-api
title: PORT zero binds an ephemeral port
assumption: "When the environment variable PORT is set to 0, the server binds an operating-system-assigned ephemeral port and accepts requests on that port."
source_open_q: null
blocking: no
review_by: "2027-01-29"
default_if_unresolved: keep_assumption
tests:
  - room-booking-api:BEH-021
notes: "decided by GA-001; source: none"
---
```

```yaml
---
id: room-booking-api:ASM-008
type: ASSUMPTION
lifecycle: {status: proposed}
partition_id: room-booking-api
title: no third-party runtime dependencies and no network access
assumption: "The product uses only Node.js built-in modules at runtime, adds no third-party runtime dependency, and neither the build, the tests nor the running server contact any external service over the network."
source_open_q: null
blocking: no
review_by: "2027-01-29"
default_if_unresolved: keep_assumption
tests:
  - room-booking-api:CON-004
  - room-booking-api:CON-005
notes: "decided by GA-003; source: none"
---
```

## Open-Q decisions

| Open-Q | option | finding | rationale |
|---|---|---|---|
| room-booking-api:OQ-001 | plain_decimal_no_reuse | none (assume, room-booking-api:ASM-001) | Closed in round 1; not revisited. |
| room-booking-api:OQ-002 | numeric_suffix | none (assume, room-booking-api:ASM-002) | Closed in round 1; not revisited. |
| room-booking-api:OQ-003 | reject_blank | none (assume, room-booking-api:ASM-003) | Closed in round 1; not revisited. |
| room-booking-api:OQ-004 | code_points | none (assume, room-booking-api:ASM-004) | Closed in round 1; not revisited. |
| room-booking-api:OQ-005 | at_least_one | none (assume, room-booking-api:ASM-005) | Closed in round 1; not revisited. |
| room-booking-api:OQ-006 | strict_time_format | none (assume, room-booking-api:ASM-006) | Closed in round 1; not revisited. |

## Coverage

Verification round; the round-1 coverage table stands unchanged. Every required change is present: room-booking-api:BEH-021 carries the PORT=0 case under room-booking-api:ASM-007 and room-booking-api:CTR-007 declares PORT in external_identifiers; room-booking-api:BEH-016 carries a negative case naming invalid_query; room-booking-api:CON-004 and room-booking-api:CON-005 carry room-booking-api:ASM-008 in their notes. Both ASSUMPTION bodies appear verbatim in section 18.
