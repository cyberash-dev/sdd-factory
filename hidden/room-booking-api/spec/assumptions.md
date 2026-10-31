# room-booking-api assumptions (sandbox)

> ASSUMPTION records minted after approval live here; see spec/spec.md for the approved records.

---

## 1. Context

none

---

## 2. Glossary

none

---

## 3. Partition

none

---

## 4. Brownfield baseline

none

---

## 5. Surfaces

none

---

## 6. Requirements

none

---

## 7. Data contracts

none

---

## 8. Invariants

none

---

## 9. External dependencies

none

---

## 10. Generated artifacts

none

---

## 11. Localization

none

---

## 12. Policies

none

---

## 13. Constraints

none

---

## 14. Migrations

none

---

## 15. Deltas

none

---

## 16. Implementation bindings

none

---

## 17. Open questions

none

---

## 18. Assumptions

```yaml
---
id: room-booking-api:ASM-003
type: ASSUMPTION
lifecycle:
  status: approved
  approval_record:
    owner_role: product-owner
    approver_identity: cyberash
    timestamp: 2026-10-31T13:43:41.273Z
    change_request: "room-booking-api-20261031-132516: pre-authorised at launch"
    scope: first-time-approval
partition_id: room-booking-api
assumption: |
  Add 400 invalid_json to CTR-002, CTR-004, CTR-005, CTR-006 and CTR-007 error_taxonomy and their test obligations for a present invalid JSON body; specify source-listing precedence for simultaneous errors, including room_not_found before invalid_json in CTR-003, invalid_query before room_not_found before invalid_json in CTR-004, and invalid_json before not_found or method_not_allowed in CTR-007; align BEH-009, BEH-020 and BEH-021 and the affected Contract predicates and test obligations with those rules.
source_open_q: not_applicable
blocking: no
review_by: "2026-10-31"
default_if_unresolved: keep_assumption
tests: []
notes: "critic finding GA-006 (conflict; targets room-booking-api:CTR-002, room-booking-api:CTR-003, room-booking-api:CTR-004, room-booking-api:CTR-005, room-booking-api:CTR-006, room-booking-api:CTR-007, room-booking-api:BEH-009, room-booking-api:BEH-020, room-booking-api:BEH-021) of round 2, unapplied at the critic cap; recorded by the foreman as the reading taken"
---
```

```yaml
---
id: room-booking-api:ASM-004
type: ASSUMPTION
lifecycle:
  status: approved
  approval_record:
    owner_role: product-owner
    approver_identity: cyberash
    timestamp: 2026-10-31T13:43:41.599Z
    change_request: "room-booking-api-20261031-132516: pre-authorised at launch"
    scope: first-time-approval
partition_id: room-booking-api
assumption: |
  Retain CON-001's prohibition on outbound network access and cite room-booking-api:ASM-001 in its notes as the decision supporting that prohibition.
source_open_q: not_applicable
blocking: no
review_by: "2026-10-31"
default_if_unresolved: keep_assumption
tests: []
notes: "critic finding GA-008 (gap; targets room-booking-api:CON-001) of round 2, unapplied at the critic cap; recorded by the foreman as the reading taken"
---
```

```yaml
---
id: room-booking-api:ASM-005
type: ASSUMPTION
lifecycle:
  status: approved
  approval_record:
    owner_role: product-owner
    approver_identity: cyberash
    timestamp: 2026-10-31T13:43:41.927Z
    change_request: "room-booking-api-20261031-132516: pre-authorised at launch"
    scope: first-time-approval
partition_id: room-booking-api
assumption: |
  Retain CON-002's prohibition on runtime dependencies and cite room-booking-api:ASM-002 in its notes as the decision supporting that prohibition.
source_open_q: not_applicable
blocking: no
review_by: "2026-10-31"
default_if_unresolved: keep_assumption
tests: []
notes: "critic finding GA-009 (gap; targets room-booking-api:CON-002) of round 2, unapplied at the critic cap; recorded by the foreman as the reading taken"
---
```

```yaml
---
id: room-booking-api:ASM-006
type: ASSUMPTION
lifecycle: {status: proposed}
partition_id: room-booking-api
title: HTTP transport and independent verification
assumption: |
  A HEAD request receives the same status and headers as the corresponding error response, but no response body is transmitted; for an unknown path the status is 404, and for a declared path with an unsupported method it is 405, unless a higher-precedence error applies. For other methods the documented JSON error body is transmitted. A request body containing malformed UTF-8 is not valid JSON and receives 400 invalid_json under the applicable error precedence; invalid UTF-8 is not repaired before JSON validity is determined. The product makes no outbound network calls; the test suite passes with non-loopback outbound network access blocked while loopback access remains available for local API requests. When a server process holding rooms and bookings stops, a distinct new process on the same port starts with an empty store and assigns the first new room id r1.
source_open_q: null
blocking: no
review_by: "2026-10-31"
default_if_unresolved: keep_assumption
tests:
  - T-007 room-booking-api:BEH-020 and room-booking-api:BEH-021 HEAD status and empty-body lane test
  - T-007 room-booking-api:CTR-007 malformed UTF-8 and invalid_json precedence lane test
  - T-007 room-booking-api:CON-001 blocked outbound network lane test
  - T-007 room-booking-api:SCN-003 and room-booking-api:INV-006 distinct-process restart lane test
notes: "T-007 findings RV-001, RV-002, RV-003 and RV-004; source: L3, L61-L64"
---
```

---

## 19. Out of scope

none

---
