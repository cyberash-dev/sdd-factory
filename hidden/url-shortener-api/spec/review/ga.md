# Spec review: url-shortener-api, round 3

decision: accept

## Findings

Round-2 verification. All four round-1 findings with `resolution: decide` are now applied in spec.md; no new finding is opened and no `assume` finding is revisited.

```yaml
- id: GA-001
  kind: conflict
  target_ids: [url-shortener-api:POL-001, url-shortener-api:CTR-001, url-shortener-api:CTR-002, url-shortener-api:CTR-003, url-shortener-api:CTR-004, url-shortener-api:CTR-005, url-shortener-api:CTR-006, url-shortener-api:ED-001, url-shortener-api:INV-001]
  source: L19
  resolution: decide
  required_change: |
    "Round-1 instruction unchanged: the wire codes invalid_url, invalid_json, not_found and invalid_port must be the spellings carried in the error_taxonomy entries of the contracts and in the failure_behaviour of url-shortener-api:ED-001, and every E_-prefixed spelling must be rewritten out of the negative_cases and failure_scenarios of the Behavior and Invariant records."
  assumption: null
  applied: yes

- id: GA-002
  kind: unmodeled_term
  target_ids: [url-shortener-api:POL-002, url-shortener-api:BEH-001, url-shortener-api:BEH-002, url-shortener-api:BEH-003, url-shortener-api:BEH-004, url-shortener-api:INV-001, url-shortener-api:SCN-001, url-shortener-api:SCN-002]
  source: L3
  resolution: decide
  required_change: |
    "Round-1 instruction unchanged: every normative use of the noun store must be rewritten as the existing Glossary term in-memory state, including the second negative_test_obligations entry of url-shortener-api:POL-002, which must read 'a request with an unsupported method leaves the in-memory state unchanged'."
  assumption: null
  applied: yes

- id: GA-003
  kind: conflict
  target_ids: [url-shortener-api:BEH-001]
  source: L19
  resolution: decide
  required_change: |
    "Round-1 instruction unchanged: the first negative case of BEH-001 must take an invalid url as its input and expect 400 invalid_url instead of 201."
  assumption: null
  applied: yes

- id: GA-004
  kind: gap
  target_ids: [url-shortener-api:CON-003]
  source: none
  resolution: decide
  required_change: |
    "Round-1 instruction unchanged: CON-003 must state only what the source entails, a 302 redirect whose Location carries the original URL and no fetch, proxy or reachability validation of that URL by this service, with the third-party-dependency clause rewritten out of the record."
  assumption: null
  applied: yes
```

Verification detail:

- GA-001 applied: the spec now spells the wire codes invalid_url, invalid_json, not_found and invalid_port in the error_taxonomy of CTR-001 through CTR-006 and in the failure_behaviour of ED-001; no E_-prefixed spelling remains in any negative_cases or failure_scenarios field of a Behavior or Invariant record.
- GA-002 applied: the noun store no longer appears in any normative field; the second negative_test_obligations entry of POL-002 reads "a request with an unsupported method leaves the in-memory state unchanged", and the given/then of BEH-001 through BEH-004, the test_obligation of INV-001 and the initial_state of SCN-001 and SCN-002 use in-memory state.
- GA-003 applied: the first negative_cases entry of BEH-001 reads "an invalid url answers 201 instead of 400 invalid_url", which is the counter example with the correct input class and code.
- GA-004 applied: CON-003 states the 302 redirect with Location equal to the original URL and that the service never fetches, proxies or validates the reachability of that URL; the third-party-dependency clause is gone.

## Assumptions

None. The seven ASSUMPTION bodies url-shortener-api:ASM-001 through url-shortener-api:ASM-007 already exist verbatim in section 18 of spec.md; no body is minted or replaced this round.

## Open-Q decisions

| Open-Q | option | finding | rationale |
| --- | --- | --- | --- |
| url-shortener-api:OQ-001 | opt-literal | assume (url-shortener-api:ASM-001) | L16 states shortUrl literally as `http://localhost:<port>/<code>`; BEH-001, CTR-006 and ASM-001 already state it. |
| url-shortener-api:OQ-002 | opt-random | assume (url-shortener-api:ASM-002) | L17 fixes only the shape and uniqueness of a code; both options yield the same observable surface under INV-002; ASM-002 exists. |
| url-shortener-api:OQ-003 | opt-exact | assume (url-shortener-api:ASM-003) | L18 speaks of shortening the same URL as submitted; the default stands and ASM-003 exists. |
| url-shortener-api:OQ-004 | opt-new | assume (url-shortener-api:ASM-004) | L34 forgets the Link, so the repeated-URL rule of L18 cannot apply after deletion; ASM-004 exists. |
| url-shortener-api:OQ-005 | opt-fallback | assume (url-shortener-api:ASM-005) | L41 makes 404 with not_found the uniform answer for unknown routes and the source defines no 405; BEH-012, CTR-005 and ASM-005 exist. |
| url-shortener-api:OQ-006 | opt-exit | assume (url-shortener-api:ASM-006) | The source is silent at process level; the default keeps the misconfiguration observable; BEH-015, CTR-006, ED-001 and ASM-006 exist. |
| url-shortener-api:OQ-007 | opt-sensitive | assume (url-shortener-api:ASM-007) | L17 draws codes from a mixed-case alphabet; case folding would shrink the effective code space; ASM-007 exists. |

## Coverage

Source lines with no record: none. L1-L3 map to the Context, INV-001 and CON-002; L7 to BEH-013, BEH-014, BEH-015, CTR-006 and ED-001; L8 to CTR-006, CON-001 and GA-001 (GeneratedArtifact); L12-L20 to CTR-001 and BEH-001 through BEH-004; L22-L25 to CTR-002, BEH-005 and BEH-006; L27-L30 to CTR-003, BEH-007 and BEH-008; L32-L35 to CTR-004, BEH-009 and BEH-010; L39-L41 to INV-003, INV-004, CTR-005, BEH-011, BEH-012, POL-001 and POL-002; L45 to CON-002 and section 19; L49 to NFR-001 and CON-001.

Records with no source line: none; every record cites at least one source line.

Error-code map: invalid_url appears only in CTR-001, invalid_json only in CTR-001, not_found in CTR-002, CTR-003, CTR-004 and CTR-005 with a consistent meaning, and invalid_port only in CTR-006; no code is defined with conflicting meanings across taxonomies.
