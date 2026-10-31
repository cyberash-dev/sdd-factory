# Plan: url-shortener-api

## 1. Reconciliation

- REC-01: gap — `url-shortener-api:ED-001` and `url-shortener-api:GA-001` are approved records with a `test_obligation`, but verification.md section 1 skips both (the `PORT` variable is verified through BEH-013, BEH-014, BEH-015 and CTR-006; the build output through NFR-001). Resolution taken: both are covered by the composition-root task T-005 and the test-writer derives their tests from `ED-001.test_obligation` and `GA-001.test_obligation` directly.
- REC-02: gap — `url-shortener-api:CON-001`, `url-shortener-api:CON-002` and `url-shortener-api:CON-003` are eligible Constraints with no verification block. Resolution taken: they are covered by their tech.md modules (M-05, M-02, M-04, that is T-005, T-002, T-004); tests are derived from each record's `test_obligation`.
- REC-03: infeasible — `url-shortener-api:NFR-001` is an `infeasible_candidate` in verification.md section 4. Resolution taken: covered by T-005; the lane raises `VD-INFEASIBLE` for that block and asserts the build and test exit statuses through the process scripts.
- REC-04: infeasible — `url-shortener-api:INV-002` carries `UNDEFINED_CODE` in its negative oracle per verification.md section 4. Resolution taken: covered by T-002; the lane asserts the decidable shape and uniqueness predicate and raises `VD-INFEASIBLE` only for the code-less negative oracle.
- REC-05: conflict — verification.md BEH-003 `input_classes.boundary_absent_key` expects `invalid_url` for a body with no `url` key, while tech.md M-03 raises `invalid_json` for a body without a string `url`. Resolution taken: both readings recorded; spec BEH-003 states a body lacking `url` answers `invalid_url`, so BEH-003 stays with T-003 (M-03) and the lane's reviewer arbitrates that input class.
- REC-06: conflict — verification.md BEH-006 `input_classes.absent_code` sends `GET /` and expects `not_found`, while tech.md section 5 makes a bare `/` an unmatched path answered by the composition-root fallback. Resolution taken: both readings recorded; both yield 404 `not_found`, BEH-006 stays with T-004 (M-04) and the lane's reviewer arbitrates.

## 2. Task graph

| wave | task | module | dependsOn |
| --- | --- | --- | --- |
| 1 | T-001 encode error bodies and JSON responses | M-01 | none |
| 1 | T-002 store links in memory and issue codes | M-02 | none |
| 2 | T-003 serve link creation, statistics and deletion | M-03 | T-001, T-002 |
| 2 | T-004 redirect codes to original URLs | M-04 | T-001, T-002 |
| 3 | T-005 compose the server and resolve the port | M-05 | T-001, T-002, T-003, T-004 |

Longest `dependsOn` chain: T-001 to T-003 to T-005, three tasks, at the depth cap of 3. No leaf merge applies:
every module carries at least three eligible IDs (M-01 3, M-02 3, M-04 4, M-03 12, M-05 13). SCN-001 and SCN-002
are re-homed from M-03 to the composition root T-005 because they exercise every module through the server entry
point.

## 3. Coverage matrix

| spec ID | task | module |
| --- | --- | --- |
| url-shortener-api:BEH-001 | T-003 | M-03 |
| url-shortener-api:BEH-002 | T-003 | M-03 |
| url-shortener-api:BEH-003 | T-003 | M-03 |
| url-shortener-api:BEH-004 | T-003 | M-03 |
| url-shortener-api:BEH-005 | T-004 | M-04 |
| url-shortener-api:BEH-006 | T-004 | M-04 |
| url-shortener-api:BEH-007 | T-003 | M-03 |
| url-shortener-api:BEH-008 | T-003 | M-03 |
| url-shortener-api:BEH-009 | T-003 | M-03 |
| url-shortener-api:BEH-010 | T-003 | M-03 |
| url-shortener-api:BEH-011 | T-005 | M-05 |
| url-shortener-api:BEH-012 | T-005 | M-05 |
| url-shortener-api:BEH-013 | T-005 | M-05 |
| url-shortener-api:BEH-014 | T-005 | M-05 |
| url-shortener-api:BEH-015 | T-005 | M-05 |
| url-shortener-api:SCN-001 | T-005 | M-05 |
| url-shortener-api:SCN-002 | T-005 | M-05 |
| url-shortener-api:NFR-001 | T-005 | M-05 |
| url-shortener-api:CTR-001 | T-003 | M-03 |
| url-shortener-api:CTR-002 | T-004 | M-04 |
| url-shortener-api:CTR-003 | T-003 | M-03 |
| url-shortener-api:CTR-004 | T-003 | M-03 |
| url-shortener-api:CTR-005 | T-005 | M-05 |
| url-shortener-api:CTR-006 | T-005 | M-05 |
| url-shortener-api:INV-001 | T-002 | M-02 |
| url-shortener-api:INV-002 | T-002 | M-02 |
| url-shortener-api:INV-003 | T-001 | M-01 |
| url-shortener-api:INV-004 | T-001 | M-01 |
| url-shortener-api:ED-001 | T-005 | M-05 |
| url-shortener-api:GA-001 | T-005 | M-05 |
| url-shortener-api:POL-001 | T-001 | M-01 |
| url-shortener-api:POL-002 | T-003 | M-03 |
| url-shortener-api:CON-001 | T-005 | M-05 |
| url-shortener-api:CON-002 | T-002 | M-02 |
| url-shortener-api:CON-003 | T-004 | M-04 |

## 4. Shared files

T-005 is the composition root: last in the DAG, depends on every other task, and owns `package.json`,
`package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`, `tsconfig.build.json`, `src/config/**` and
`src/server/**`. It wires the interfaces of M-01 through M-04, covers the stack Constraint CON-001, the toolchain and
build records NFR-001 and GA-001, and both end-to-end Scenarios. Its build and start scripts and its emitting
`tsconfig.build.json` are the only tooling changes; no other task writes a shared file and no lane changes
dependencies.

Test budgets follow verification.md `input_classes`, counting three for an ID without a block, bounded to 4 through
80: T-001 18, T-002 14, T-003 77, T-004 23, T-005 68.

## 5. Revisions

none
