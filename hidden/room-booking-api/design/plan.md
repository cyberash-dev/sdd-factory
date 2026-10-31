# Plan: room-booking-api

## 1. Reconciliation

- REC-01 — gap — `room-booking-api:CON-001`, `room-booking-api:CON-002`, `room-booking-api:LOC-001`: eligible records with no verification block (verification.md section 1 skips Constraint and LocalizationContract templates). Resolution: covered anyway in T-007; the test-writer derives the tests from each record's `test_obligation`, offline-suite assertion, manifest assertion and byte-identical echo assertion respectively.
- REC-02 — gap — `room-booking-api:INV-006`, `room-booking-api:SCN-003`: tech.md maps both to M-02, but their `test_obligation` requires stopping one process and starting another, which no M-02 unit in isolation can observe. Resolution: both IDs move to T-007, the task owning M-07 (`startServer`), which is the only module able to run a process restart; M-02 still implements the fresh store that T-007 asserts.
- REC-03 — gap — `room-booking-api:IB-001` is an ImplementationBinding and is not in the cover set; its port contract is used by T-007 only as setup, never as an assertion of its own, matching verification.md section 1.
- REC-04 — gap — `room-booking-api:Q-005` (id order numeric or lexicographic) is an Open-Q and not covered; the in-force default A-005 (numeric suffix) is the ordering every list assertion uses, so T-002 and T-005 implement it without covering the question.
- REC-05 — conflict — `room-booking-api:BEH-012` fixes `invalid_json` for a zero-length booking body, `room-booking-api:CTR-003` lists `invalid_json` with `invalid_booking` after `room_not_found`, and tech.md M-02 defines `parseJsonBody` to return `empty` (not `invalid`) for a zero-length body. Verification block BEH-012 requires `invalid_json` for the zero-length body. Resolution: the spec wins; T-004 must answer `invalid_json` for the zero-length booking body, so the route treats `empty` and `invalid` alike on the booking path (the room path of BEH-002 keeps treating `empty` as `invalid_room`); no edit to tech.md or verification.md is made here and the lane reviewer arbitrates. Covered in T-004.
- Infeasible candidates: none (verification.md section 4 holds none).

## 2. Task graph

Waves:

- Wave 1 — T-001 (errors), T-002 (core); both `dependsOn: []`.
- Wave 2 — T-003, T-004, T-005, T-006 (the four route modules); each `dependsOn: [T-001, T-002]` only, so the four run as parallel lanes.
- Wave 3 — T-007 (server and process entry); `dependsOn: [T-003, T-004, T-005, T-006]`.

Topological order and edges:

| task | title | dependsOn | designRefs |
|---|---|---|---|
| T-001 | own the error codes and the JSON response envelope | — | M-01 |
| T-002 | hold the entities, the in-memory store and shared primitives | — | M-02 |
| T-003 | serve room creation and the room list | T-001, T-002 | M-03 |
| T-004 | serve booking creation on a room | T-001, T-002 | M-04 |
| T-005 | serve booking listing and booking deletion | T-001, T-002 | M-05 |
| T-006 | serve availability search | T-001, T-002 | M-06 |
| T-007 | compose the server, route requests and start the process | T-003, T-004, T-005, T-006 | M-07 |

Longest `dependsOn` chain: T-001 → T-003 → T-007, three tasks, at the cap of 3. No transitive edge: T-007 does not list T-001 or T-002 directly; T-003 to T-006 do not list each other.

Merging: none was needed. Every module M-01..M-07 carries at least 3 eligible IDs, the longest chain is 3 tasks and no task sits below `min_covers_per_task` = 3, so no module was merged and none was split. T-001 and T-002 stay separate from the route tasks because they are the dependency-free base four lanes import; folding either into T-003 would have moved a shared `src/` area into one lane and made the four route write-sets non-disjoint.

## 3. Coverage matrix

| spec ID | task | module |
|---|---|---|
| room-booking-api:INV-004 | T-001 | M-01 |
| room-booking-api:INV-005 | T-001 | M-01 |
| room-booking-api:POL-001 | T-001 | M-01 |
| room-booking-api:INV-001 | T-002 | M-02 |
| room-booking-api:INV-002 | T-002 | M-02 |
| room-booking-api:INV-003 | T-002 | M-02 |
| room-booking-api:INV-007 | T-002 | M-02 |
| room-booking-api:INV-008 | T-002 | M-02 |
| room-booking-api:BEH-001 | T-003 | M-03 |
| room-booking-api:BEH-002 | T-003 | M-03 |
| room-booking-api:BEH-003 | T-003 | M-03 |
| room-booking-api:BEH-004 | T-003 | M-03 |
| room-booking-api:BEH-005 | T-003 | M-03 |
| room-booking-api:BEH-006 | T-003 | M-03 |
| room-booking-api:CTR-001 | T-003 | M-03 |
| room-booking-api:CTR-002 | T-003 | M-03 |
| room-booking-api:BEH-007 | T-004 | M-04 |
| room-booking-api:BEH-008 | T-004 | M-04 |
| room-booking-api:BEH-009 | T-004 | M-04 |
| room-booking-api:BEH-010 | T-004 | M-04 |
| room-booking-api:BEH-011 | T-004 | M-04 |
| room-booking-api:BEH-012 | T-004 | M-04 |
| room-booking-api:CTR-003 | T-004 | M-04 |
| room-booking-api:SCN-002 | T-004 | M-04 |
| room-booking-api:BEH-013 | T-005 | M-05 |
| room-booking-api:BEH-014 | T-005 | M-05 |
| room-booking-api:BEH-015 | T-005 | M-05 |
| room-booking-api:BEH-016 | T-005 | M-05 |
| room-booking-api:BEH-017 | T-005 | M-05 |
| room-booking-api:CTR-004 | T-005 | M-05 |
| room-booking-api:CTR-005 | T-005 | M-05 |
| room-booking-api:SCN-001 | T-005 | M-05 |
| room-booking-api:BEH-018 | T-006 | M-06 |
| room-booking-api:BEH-019 | T-006 | M-06 |
| room-booking-api:CTR-006 | T-006 | M-06 |
| room-booking-api:BEH-020 | T-007 | M-07 |
| room-booking-api:BEH-021 | T-007 | M-07 |
| room-booking-api:CTR-007 | T-007 | M-07 |
| room-booking-api:POL-002 | T-007 | M-07 |
| room-booking-api:CON-001 | T-007 | M-07 |
| room-booking-api:CON-002 | T-007 | M-07 |
| room-booking-api:NFR-001 | T-007 | M-07 |
| room-booking-api:LOC-001 | T-007 | M-07 |
| room-booking-api:INV-006 | T-007 | M-02 (implemented) via M-07 (observed) |
| room-booking-api:SCN-003 | T-007 | M-02 (implemented) via M-07 (observed) |

45 rows, one per eligible ID, no ID repeated. Task budget, from ceil(1.5 × the summed `input_classes` of its covers, counting 3 for an ID without a block), bounded to [4, 80]: T-001 41, T-002 39, T-003 80, T-004 80, T-005 65, T-006 32, T-007 60.

## 4. Shared files

T-007 owns `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts` and `tsconfig.build.json`. It is the composition root (last in the DAG, `dependsOn` every route task whose interface the server wires), it covers the stack Constraints (CON-001, CON-002), the build/test NFR (NFR-001) and the end-to-end restart Scenario (SCN-003), and no other task writes a manifest, a compiler configuration or a test-runner configuration. No lane changes dependencies; T-001 to T-006 write only their own `src/` area and the matching `tests/` area.

## 5. Revisions

none
