# box-office assumptions (sandbox)

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
id: box-office:ASM-012
type: ASSUMPTION
lifecycle:
  status: approved
  approval_record:
    owner_role: product-owner
    approver_identity: cyberash
    timestamp: 2026-10-31T17:13:15.783Z
    change_request: "box-office-20261031-170345: pre-authorised at launch"
    scope: first-time-approval
partition_id: box-office
assumption: |
  Add a Contract for customer GET /me/waitlist and a reachable Behavior specifying 200 with an array containing only the caller's entries and each entry's current position, including empty and changed-position cases and authentication and role errors; add the Contract to box-office:SUR-001.members.
source_open_q: not_applicable
blocking: no
review_by: "2026-10-31"
default_if_unresolved: keep_assumption
tests: []
notes: "critic finding GA-001 (gap; targets box-office:SUR-001) of round 2, unapplied at the critic cap; recorded by the foreman as the reading taken"
---
```

```yaml
---
id: box-office:ASM-013
type: ASSUMPTION
lifecycle:
  status: approved
  approval_record:
    owner_role: product-owner
    approver_identity: cyberash
    timestamp: 2026-10-31T17:13:16.096Z
    change_request: "box-office-20261031-170345: pre-authorised at launch"
    scope: first-time-approval
partition_id: box-office
assumption: |
  Rewrite the availability outcomes and negative cases in box-office:BEH-018, box-office:BEH-020, box-office:INV-005 and box-office:INV-007 to account for any immediately served waitlist orders; restrict expiry to orders that were held, not paid orders past their former expiresAt. Change box-office:SCN-001.then and observable_sequence so the final available is 0 and do not require a response showing the intermediate availability of 2.
source_open_q: not_applicable
blocking: no
review_by: "2026-10-31"
default_if_unresolved: keep_assumption
tests: []
notes: "critic finding GA-004 (conflict; targets box-office:BEH-018, box-office:BEH-020, box-office:INV-005, box-office:INV-007, box-office:SCN-001) of round 2, unapplied at the critic cap; recorded by the foreman as the reading taken"
---
```

```yaml
---
id: box-office:ASM-014
type: ASSUMPTION
lifecycle:
  status: approved
  approval_record:
    owner_role: product-owner
    approver_identity: cyberash
    timestamp: 2026-10-31T17:13:16.418Z
    change_request: "box-office-20261031-170345: pre-authorised at launch"
    scope: first-time-approval
partition_id: box-office
assumption: |
  Change box-office:BEH-028.when and test_obligation so an over-limit first entry is removed when its quantity fits available tickets; if the first entry does not fit, it remains first and nobody behind it is served.
source_open_q: not_applicable
blocking: no
review_by: "2026-10-31"
default_if_unresolved: keep_assumption
tests: []
notes: "critic finding GA-005 (conflict; targets box-office:BEH-028) of round 2, unapplied at the critic cap; recorded by the foreman as the reading taken"
---
```

```yaml
---
id: box-office:ASM-015
type: ASSUMPTION
lifecycle:
  status: approved
  approval_record:
    owner_role: product-owner
    approver_identity: cyberash
    timestamp: 2026-10-31T17:13:16.737Z
    change_request: "box-office-20261031-170345: pre-authorised at launch"
    scope: first-time-approval
partition_id: box-office
assumption: |
  Select box-office:OQ-009.opt-json-first and rewrite its consequence, box-office:ASM-009, box-office:BEH-005, box-office:BEH-030, box-office:BEH-031 and box-office:INV-011 so unknown route is checked first, then method, then body syntax, before token and the remaining endpoint checks; a malformed JSON body on a known protected route answers 400 even without a valid token. Add a test obligation for that combination.
source_open_q: not_applicable
blocking: no
review_by: "2026-10-31"
default_if_unresolved: keep_assumption
tests: []
notes: "critic finding GA-006 (conflict; targets box-office:BEH-005, box-office:BEH-030, box-office:BEH-031, box-office:INV-011, box-office:OQ-009, box-office:ASM-009) of round 2, unapplied at the critic cap; recorded by the foreman as the reading taken"
---
```

```yaml
---
id: box-office:ASM-016
type: ASSUMPTION
lifecycle:
  status: approved
  approval_record:
    owner_role: product-owner
    approver_identity: cyberash
    timestamp: 2026-10-31T17:13:17.054Z
    change_request: "box-office-20261031-170345: pre-authorised at launch"
    scope: first-time-approval
partition_id: box-office
assumption: |
  Select box-office:OQ-004.opt-404 and change box-office:CTR-014.error_taxonomy and box-office:ASM-004 so a tierId not naming a tier of the event is 404 E_NOT_FOUND, rather than adding the orders endpoint's 400 tier error to the waitlist endpoint; cover the foreign-tier case in box-office:BEH-026.test_obligation.
source_open_q: not_applicable
blocking: no
review_by: "2026-10-31"
default_if_unresolved: keep_assumption
tests: []
notes: "critic finding GA-007 (conflict; targets box-office:CTR-014, box-office:OQ-004, box-office:ASM-004) of round 2, unapplied at the critic cap; recorded by the foreman as the reading taken"
---
```

```yaml
---
id: box-office:ASM-017
type: ASSUMPTION
lifecycle:
  status: approved
  approval_record:
    owner_role: product-owner
    approver_identity: cyberash
    timestamp: 2026-10-31T17:13:17.373Z
    change_request: "box-office-20261031-170345: pre-authorised at launch"
    scope: first-time-approval
partition_id: box-office
assumption: |
  Rewrite box-office:POL-001.negative_test_obligations so a stable error message is permitted; message text remains unconstrained and callers cannot rely on a particular message.
source_open_q: not_applicable
blocking: no
review_by: "2026-10-31"
default_if_unresolved: keep_assumption
tests: []
notes: "critic finding GA-008 (conflict; targets box-office:POL-001) of round 2, unapplied at the critic cap; recorded by the foreman as the reading taken"
---
```

```yaml
---
id: box-office:ASM-018
type: ASSUMPTION
lifecycle:
  status: approved
  approval_record:
    owner_role: product-owner
    approver_identity: cyberash
    timestamp: 2026-10-31T17:13:17.691Z
    change_request: "box-office-20261031-170345: pre-authorised at launch"
    scope: first-time-approval
partition_id: box-office
assumption: |
  Change box-office:INV-002.statement to require integer cents in accepted monetary input and monetary responses, while permitting an invalid fractional monetary request to receive its stated validation error.
source_open_q: not_applicable
blocking: no
review_by: "2026-10-31"
default_if_unresolved: keep_assumption
tests: []
notes: "critic finding GA-009 (conflict; targets box-office:INV-002) of round 2, unapplied at the critic cap; recorded by the foreman as the reading taken"
---
```

```yaml
---
id: box-office:ASM-019
type: ASSUMPTION
lifecycle:
  status: approved
  approval_record:
    owner_role: product-owner
    approver_identity: cyberash
    timestamp: 2026-10-31T17:13:18.009Z
    change_request: "box-office-20261031-170345: pre-authorised at launch"
    scope: first-time-approval
partition_id: box-office
assumption: |
  Add a Constraint and test obligation stating that the standalone product is at hidden/box-office/ and is started there after npm install, with npm run build when present, followed by npm start.
source_open_q: not_applicable
blocking: no
review_by: "2026-10-31"
default_if_unresolved: keep_assumption
tests: []
notes: "critic finding GA-010 (gap; targets box-office:CST-003) of round 2, unapplied at the critic cap; recorded by the foreman as the reading taken"
---
```

```yaml
---
id: box-office:ASM-020
type: ASSUMPTION
lifecycle: {status: proposed}
partition_id: box-office
title: Account response, duplicate registration and character boundaries
assumption: |
  A password is not returned as a credential or password field; an independently submitted name or email is returned unchanged even if it equals or contains a registered password string. A case-insensitive duplicate registration returns 409 and creates no account, leaving the account count unchanged. For account name and password length validation, a character is a Unicode code point, so a supplementary-plane code point counts as one character; a name of 1 through 100 code points is valid and a password requires at least 8 code points.
source_open_q: null
blocking: no
review_by: "2026-10-31"
default_if_unresolved: keep_assumption
tests:
  - "T-003 tests/accounts/accounts.test.ts: registration and GET /me return submitted name even when it equals the password, without a password field"
  - "T-003 tests/accounts/accounts.test.ts: case-insensitive duplicate returns 409 and account count and creation calls do not increase"
  - "T-003 tests/accounts/accounts.test.ts: Unicode code point boundaries for name and password"
notes: "T-003 lane findings RV-001, RV-002, RV-003; source: L24-L27"
---
```

---

## 19. Out of scope

none

---
