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
id: room-booking-api:ASM-011
type: ASSUMPTION
lifecycle: {status: proposed}
partition_id: room-booking-api
title: "Empty request bodies and observable verification"
assumption: "After route and method checks, a zero-byte body on POST /rooms or POST /rooms/:roomId/bookings yields 400 invalid_json and creates no room or booking; an absent body on GET or DELETE proceeds to the endpoint rules. A supplied malformed body on any supported route yields 400 invalid_json. While the server starts and serves requests, it opens no outbound connection. An independent invocation of npm test exits 0 and reports a non-empty test count with every test of the suite executed; an HTTP response or an empty runtime dependency list alone does not establish either verification outcome."
source_open_q: null
blocking: no
review_by: "2026-10-31"
default_if_unresolved: keep_assumption
tests:
  - "T-008 lane tests: empty and absent request bodies on both POST routes and supported GET and DELETE routes"
  - "T-008 lane tests: observe outbound connection attempts during server startup and request handling"
  - "T-008 lane tests: independently observe npm test exit status and test count"
notes: "T-008 findings RV-001, RV-002, RV-003; source: L20, L33, L63, L72"
---
```

---

## 19. Out of scope

none

---
