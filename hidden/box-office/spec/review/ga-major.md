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
