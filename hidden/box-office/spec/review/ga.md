# Spec review: box-office, round 2

decision: rework

## Findings

```yaml
- id: GA-001
  kind: gap
  target_ids: [box-office:SUR-001]
  source: L83
  resolution: decide
  severity: major
  required_change: "Add a Contract for customer GET /me/waitlist and a reachable Behavior specifying 200 with an array containing only the caller's entries and each entry's current position, including empty and changed-position cases and authentication and role errors; add the Contract to box-office:SUR-001.members."
  assumption: null
  applied: no
- id: GA-002
  kind: conflict
  target_ids: [box-office:BEH-004]
  source: L28
  resolution: decide
  severity: major
  required_change: "Change box-office:BEH-004.when to require the matching email and password for its 200 outcome, and retain 401 for wrong email or password."
  assumption: null
  applied: yes
- id: GA-003
  kind: conflict
  target_ids: [box-office:BEH-023]
  source: L68
  resolution: decide
  severity: major
  required_change: "Change box-office:BEH-023.then so code is the upper-case form of the submitted code, with EARLYBIRD only for the earlybird example, and the supplied discount field retains its value."
  assumption: null
  applied: yes
- id: GA-004
  kind: conflict
  target_ids: [box-office:BEH-018, box-office:BEH-020, box-office:INV-005, box-office:INV-007, box-office:SCN-001]
  source: L58, L81
  resolution: decide
  severity: major
  required_change: "Rewrite the availability outcomes and negative cases in box-office:BEH-018, box-office:BEH-020, box-office:INV-005 and box-office:INV-007 to account for any immediately served waitlist orders; restrict expiry to orders that were held, not paid orders past their former expiresAt. Change box-office:SCN-001.then and observable_sequence so the final available is 0 and do not require a response showing the intermediate availability of 2."
  assumption: null
  applied: no
- id: GA-005
  kind: conflict
  target_ids: [box-office:BEH-028]
  source: L81-L82
  resolution: decide
  severity: major
  required_change: "Change box-office:BEH-028.when and test_obligation so an over-limit first entry is removed when its quantity fits available tickets; if the first entry does not fit, it remains first and nobody behind it is served."
  assumption: null
  applied: no
- id: GA-006
  kind: conflict
  target_ids: [box-office:BEH-005, box-office:BEH-030, box-office:BEH-031, box-office:INV-011, box-office:OQ-009, box-office:ASM-009]
  source: L15-L16, L20
  resolution: decide
  severity: major
  required_change: "Select box-office:OQ-009.opt-json-first and rewrite its consequence, box-office:ASM-009, box-office:BEH-005, box-office:BEH-030, box-office:BEH-031 and box-office:INV-011 so unknown route is checked first, then method, then body syntax, before token and the remaining endpoint checks; a malformed JSON body on a known protected route answers 400 even without a valid token. Add a test obligation for that combination."
  assumption: box-office:ASM-009
  applied: no
- id: GA-007
  kind: conflict
  target_ids: [box-office:CTR-014, box-office:OQ-004, box-office:ASM-004]
  source: L20, L78
  resolution: decide
  severity: major
  required_change: "Select box-office:OQ-004.opt-404 and change box-office:CTR-014.error_taxonomy and box-office:ASM-004 so a tierId not naming a tier of the event is 404 E_NOT_FOUND, rather than adding the orders endpoint's 400 tier error to the waitlist endpoint; cover the foreign-tier case in box-office:BEH-026.test_obligation."
  assumption: box-office:ASM-004
  applied: no
- id: GA-008
  kind: conflict
  target_ids: [box-office:POL-001]
  source: L16
  resolution: decide
  severity: major
  required_change: "Rewrite box-office:POL-001.negative_test_obligations so a stable error message is permitted; message text remains unconstrained and callers cannot rely on a particular message."
  assumption: null
  applied: no
- id: GA-009
  kind: conflict
  target_ids: [box-office:INV-002]
  source: L17, L37
  resolution: decide
  severity: major
  required_change: "Change box-office:INV-002.statement to require integer cents in accepted monetary input and monetary responses, while permitting an invalid fractional monetary request to receive its stated validation error."
  assumption: null
  applied: no
- id: GA-010
  kind: gap
  target_ids: [box-office:CST-003]
  source: L7-L8
  resolution: decide
  severity: major
  required_change: "Add a Constraint and test obligation stating that the standalone product is at hidden/box-office/ and is started there after npm install, with npm run build when present, followed by npm start."
  assumption: null
  applied: no
- id: GA-011
  kind: gap
  target_ids: [box-office:BEH-001, box-office:BEH-002, box-office:BEH-003, box-office:BEH-004, box-office:BEH-005, box-office:BEH-006, box-office:BEH-007, box-office:BEH-008, box-office:BEH-009, box-office:BEH-010, box-office:BEH-011, box-office:BEH-012, box-office:BEH-013, box-office:BEH-014, box-office:BEH-015, box-office:BEH-016, box-office:BEH-017, box-office:BEH-018, box-office:BEH-019, box-office:BEH-020, box-office:BEH-021, box-office:BEH-022, box-office:BEH-023, box-office:BEH-024, box-office:BEH-025, box-office:BEH-026, box-office:BEH-027, box-office:BEH-028, box-office:BEH-029, box-office:BEH-030, box-office:BEH-031]
  source: none
  resolution: decide
  severity: minor
  required_change: "Add surface_ref box-office:SUR-001 to each listed Behavior and make each when identify a Contract-defined endpoint or input class."
  assumption: null
  applied: no
- id: GA-012
  kind: missing_negative
  target_ids: [box-office:BEH-003, box-office:BEH-027, box-office:BEH-028]
  source: none
  resolution: decide
  severity: minor
  required_change: "Add to each listed Behavior a negative case naming an error code from the Contract for the input that triggers it."
  assumption: null
  applied: no
- id: GA-013
  kind: gap
  target_ids: [box-office:CST-005]
  source: none
  resolution: decide
  severity: minor
  required_change: "Rewrite box-office:CST-005.constraint and its test_obligation to state only the factory toolchain and the source's no-network and in-memory constraints, without forbidding all runtime dependencies."
  assumption: null
  applied: no
- id: GA-014
  kind: gap
  target_ids: [box-office:OQ-001, box-office:ASM-001]
  source: L25, L28
  resolution: assume
  severity: minor
  required_change: "Keep box-office:OQ-001.opt-400 and box-office:ASM-001."
  assumption: box-office:ASM-001
- id: GA-015
  kind: gap
  target_ids: [box-office:OQ-002, box-office:ASM-002]
  source: L16
  resolution: assume
  severity: minor
  required_change: "Keep box-office:OQ-002.opt-404 and box-office:ASM-002."
  assumption: box-office:ASM-002
- id: GA-016
  kind: gap
  target_ids: [box-office:OQ-003, box-office:ASM-003]
  source: L25, L40
  resolution: assume
  severity: minor
  required_change: "Keep box-office:OQ-003.opt-ignore and box-office:ASM-003."
  assumption: box-office:ASM-003
- id: GA-017
  kind: gap
  target_ids: [box-office:OQ-005, box-office:ASM-005]
  source: L78-L80
  resolution: assume
  severity: minor
  required_change: "Keep box-office:OQ-005.opt-join and box-office:ASM-005."
  assumption: box-office:ASM-005
- id: GA-018
  kind: gap
  target_ids: [box-office:OQ-006, box-office:ASM-006]
  source: L40
  resolution: assume
  severity: minor
  required_change: "Keep box-office:OQ-006.opt-empty and box-office:ASM-006."
  assumption: box-office:ASM-006
- id: GA-019
  kind: gap
  target_ids: [box-office:OQ-007, box-office:ASM-007]
  source: L55-L56
  resolution: assume
  severity: minor
  required_change: "Keep box-office:OQ-007.opt-limit and box-office:ASM-007."
  assumption: box-office:ASM-007
- id: GA-020
  kind: gap
  target_ids: [box-office:OQ-008, box-office:ASM-008]
  source: L28-L29
  resolution: assume
  severity: minor
  required_change: "Keep box-office:OQ-008.opt-opaque and box-office:ASM-008."
  assumption: box-office:ASM-008
- id: GA-021
  kind: gap
  target_ids: [box-office:OQ-010, box-office:ASM-010]
  source: L40
  resolution: assume
  severity: minor
  required_change: "Keep box-office:OQ-010.opt-int and box-office:ASM-010."
  assumption: box-office:ASM-010
- id: GA-022
  kind: gap
  target_ids: [box-office:OQ-011, box-office:ASM-011]
  source: L18, L68-L69
  resolution: assume
  severity: minor
  required_change: "Keep box-office:OQ-011.opt-400 and box-office:ASM-011."
  assumption: box-office:ASM-011
```

## Assumptions

```yaml
---
id: box-office:ASM-009
type: ASSUMPTION
lifecycle: {status: proposed}
partition_id: box-office
title: body syntax before protected endpoint checks
assumption: "On a known protected route with a served method, a malformed JSON body answers 400 E_MALFORMED_JSON even when the token is missing or invalid."
source_open_q: box-office:OQ-009
blocking: no
review_by: "2027-01-29"
default_if_unresolved: keep_assumption
tests: [box-office:BEH-005 test_obligation, box-office:BEH-030 test_obligation]
notes: "decided by GA-006; source: L15-L16, L20"
---
```

```yaml
---
id: box-office:ASM-004
type: ASSUMPTION
lifecycle: {status: proposed}
partition_id: box-office
title: a foreign tier on the waitlist is not found
assumption: "POST /events/:id/waitlist answers 404 E_NOT_FOUND when tierId does not name a tier of the event."
source_open_q: box-office:OQ-004
blocking: no
review_by: "2027-01-29"
default_if_unresolved: keep_assumption
tests: [box-office:BEH-026 test_obligation]
notes: "decided by GA-007; source: L20, L78"
---
```

## Open-Q decisions

| Open-Q | option | finding | rationale |
| --- | --- | --- | --- |
| box-office:OQ-001 | opt-400 | GA-014 | Missing required input fails the applicable field rules; the existing assumption gives the default. |
| box-office:OQ-002 | opt-404 | GA-015 | The source names an unknown route as 404; the existing assumption gives the default. |
| box-office:OQ-003 | opt-ignore | GA-016 | The source names no error for extra keys; the existing assumption gives the default. |
| box-office:OQ-004 | opt-404 | GA-007 | A tier not belonging to the named event is not found there; the orders-specific 400 is not stated for waitlists. |
| box-office:OQ-005 | opt-join | GA-017 | The source states no cancelled-event restriction on joining. |
| box-office:OQ-006 | opt-empty | GA-018 | Inclusive bounds independently select no event when reversed. |
| box-office:OQ-007 | opt-limit | GA-019 | L55 precedes L56. |
| box-office:OQ-008 | opt-opaque | GA-020 | The source specifies no token expiry; the existing assumption gives a deterministic lifetime. |
| box-office:OQ-009 | opt-json-first | GA-006 | Body syntax precedes endpoint checks under the HTTP precedence rule. |
| box-office:OQ-010 | opt-int | GA-021 | The existing assumption supplies deterministic pagination validity. |
| box-office:OQ-011 | opt-400 | GA-022 | L18 requires request times to be readable by Date.parse. |

## Coverage

- Verification only: GA-002 and GA-003 are applied; the remaining decide findings are not fully applied.
- GA-001: box-office:SUR-001 has no member Contract for GET /me/waitlist and no Behavior specifies it.
- GA-004: box-office:SCN-001 still requires available 2 in a response and box-office:INV-005 still treats unchanged available after expiry as a violation; box-office:INV-007.test_obligation still requires any order past expiresAt to read expired.
- GA-005: box-office:BEH-028.when and test_obligation do not condition removal on the first entry fitting.
- GA-006: box-office:ASM-009 is not the required replacement body, although the named Behavior, Invariant and Open-Q changes are present.
- GA-007: box-office:CTR-014, box-office:OQ-004 and box-office:ASM-004 retain the 400 decision; box-office:BEH-026 lacks the foreign-tier test obligation.
- GA-008 and GA-009: box-office:POL-001 and box-office:INV-002 retain the prior statements.
- GA-010: no Constraint specifies the output location and startup sequence.
- GA-011, GA-012 and GA-013: the requested minor changes are not present.
