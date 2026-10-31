# Plan: room-booking-api

## 1. Reconciliation

- REC-01 — kind: gap — ids: room-booking-api:CON-001, room-booking-api:CON-002, room-booking-api:CON-003 — verification.md section 1 skips the Constraints and derives no block for them, so no input-class count exists. Resolution: all three are covered by the composition-root task T-008, the task that owns `src/index.ts`, `package.json` and `tsconfig.build.json`, where the records are observable; the test-writer derives tests from each record's `test_obligation`, and `maxTests` counts 3 per ID without a block.
- REC-02 — kind: infeasible — ids: room-booking-api:NFR-002 — verification.md section 4 marks the `npm test` block `infeasible_candidate` because the predicate observes the exit code and test count of the run that would assert it. Resolution: the ID stays covered by T-008, which owns the `test` script in `package.json`; the lane raises `VD-INFEASIBLE` instead of inventing an observation point inside the suite.
- REC-03 — kind: gap — ids: room-booking-api:CON-002 — the record's obligation reads a property of `package.json`, a shared file owned by the composition root rather than by a `src/` module. Resolution: T-008 owns `package.json` (Rule 5) and covers CON-002; no other task may touch the dependency sections.
- REC-04 — kind: conflict — ids: room-booking-api:BEH-021, room-booking-api:CTR-001, room-booking-api:BEH-025 — tech.md DD-11 and BEH-025 read zero request bytes as an absent body that is never an error on any route; the spec CTR-001 error taxonomy and the BEH-021 / BEH-025 verification blocks read an empty body on `POST /rooms` as not valid JSON and answer `400 invalid_json`. Both readings are recorded; the spec wins, so T-008 answers `400 invalid_json` to an empty body on a route that documents a body and answers a body-less request with the documented endpoint result. The lane's reviewer arbitrates; tech.md and verification.md are not edited here.
- REC-05 — kind: gap — ids: room-booking-api:NFR-001 — the record observes the exit code of `npm run build`, which no `src/` module can report. Resolution: covered by T-008, which owns `package.json` and `tsconfig.build.json` (DD-14).

Cover set: 52 eligible IDs, taken from the runtime `eligible_ids`, all covered exactly once.

## 2. Task graph

Wave 1 (no dependency, run in parallel):

- T-001 `hold the error codes and the JSON error envelope` — M-01 — dependsOn: []
- T-002 `keep rooms and bookings in memory with creation-ordered ids` — M-02 — dependsOn: []

Wave 2 (one level below wave 1):

- T-003 `match requests against the four route patterns` — M-07 — dependsOn: [T-001]
- T-004 `serve the room creation and room listing endpoints` — M-03 — dependsOn: [T-001, T-002]
- T-005 `serve booking creation and booking deletion` — M-04 — dependsOn: [T-001, T-002]
- T-006 `serve the room booking listing endpoint with the window filter` — M-05 — dependsOn: [T-001, T-002]
- T-007 `serve the availability endpoint` — M-06 — dependsOn: [T-001, T-002]

Wave 3 (composition root):

- T-008 `wire the modules into the HTTP handler and the process` — M-08 — dependsOn: [T-001, T-002, T-003, T-004, T-005, T-006, T-007]

Edges: T-001→T-003, T-001→T-004, T-001→T-005, T-001→T-006, T-001→T-007, T-002→T-004, T-002→T-005, T-002→T-006, T-002→T-007, T-001→T-008, T-002→T-008, T-003→T-008, T-004→T-008, T-005→T-008, T-006→T-008, T-007→T-008. Longest chain: three tasks (T-001 → T-004 → T-008 and T-002 → T-005 → T-008), inside the cap of 3. No transitive edge: T-008 imports every endpoint module's interface, so each of T-003..T-007 is a real import edge; the T-001 and T-002 edges carry the error and state interfaces T-008 serialises and seeds.

No merge was needed beyond the module cut: every task outside the composition root covers at least 3 IDs, and the module map is one level shallower than the cap once the leaf modules hang off the two interface-only modules.

## 3. Coverage matrix

| spec ID | task | module |
| --- | --- | --- |
| room-booking-api:BEH-001 | T-004 | M-03 |
| room-booking-api:BEH-002 | T-004 | M-03 |
| room-booking-api:BEH-003 | T-004 | M-03 |
| room-booking-api:BEH-004 | T-004 | M-03 |
| room-booking-api:BEH-005 | T-004 | M-03 |
| room-booking-api:BEH-006 | T-004 | M-03 |
| room-booking-api:BEH-007 | T-005 | M-04 |
| room-booking-api:BEH-008 | T-005 | M-04 |
| room-booking-api:BEH-009 | T-005 | M-04 |
| room-booking-api:BEH-010 | T-005 | M-04 |
| room-booking-api:BEH-011 | T-005 | M-04 |
| room-booking-api:BEH-012 | T-005 | M-04 |
| room-booking-api:BEH-013 | T-006 | M-05 |
| room-booking-api:BEH-014 | T-006 | M-05 |
| room-booking-api:BEH-015 | T-006 | M-05 |
| room-booking-api:BEH-016 | T-006 | M-05 |
| room-booking-api:BEH-017 | T-005 | M-04 |
| room-booking-api:BEH-018 | T-005 | M-04 |
| room-booking-api:BEH-019 | T-007 | M-06 |
| room-booking-api:BEH-020 | T-007 | M-06 |
| room-booking-api:BEH-021 | T-008 | M-08 |
| room-booking-api:BEH-022 | T-003 | M-07 |
| room-booking-api:BEH-023 | T-003 | M-07 |
| room-booking-api:BEH-024 | T-004 | M-03 |
| room-booking-api:BEH-025 | T-008 | M-08 |
| room-booking-api:BEH-026 | T-005 | M-04 |
| room-booking-api:BEH-027 | T-004 | M-03 |
| room-booking-api:SCN-001 | T-005 | M-04 |
| room-booking-api:SCN-002 | T-005 | M-04 |
| room-booking-api:SCN-003 | T-005 | M-04 |
| room-booking-api:NFR-001 | T-008 | M-08 |
| room-booking-api:NFR-002 | T-008 | M-08 |
| room-booking-api:CTR-001 | T-004 | M-03 |
| room-booking-api:CTR-002 | T-004 | M-03 |
| room-booking-api:CTR-003 | T-005 | M-04 |
| room-booking-api:CTR-004 | T-006 | M-05 |
| room-booking-api:CTR-005 | T-005 | M-04 |
| room-booking-api:CTR-006 | T-007 | M-06 |
| room-booking-api:CTR-008 | T-003 | M-07 |
| room-booking-api:INV-001 | T-002 | M-02 |
| room-booking-api:INV-002 | T-002 | M-02 |
| room-booking-api:INV-003 | T-001 | M-01 |
| room-booking-api:INV-004 | T-001 | M-01 |
| room-booking-api:INV-005 | T-002 | M-02 |
| room-booking-api:INV-006 | T-008 | M-08 |
| room-booking-api:INV-007 | T-002 | M-02 |
| room-booking-api:INV-008 | T-002 | M-02 |
| room-booking-api:POL-001 | T-001 | M-01 |
| room-booking-api:POL-002 | T-008 | M-08 |
| room-booking-api:CON-001 | T-008 | M-08 |
| room-booking-api:CON-002 | T-008 | M-08 |
| room-booking-api:CON-003 | T-008 | M-08 |

## 4. Shared files

`package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.build.json` and `vitest.config.ts` belong to T-008, the composition root: it is last in the DAG, dependsOn every module task whose interface it wires, covers the stack Constraints (CON-001, CON-002, CON-003) and the two NFRs, and holds the `build`, `start` and `test` scripts and the dependency-free declaration CON-002 reads. `src/index.ts` is the composition root itself (M-08), so it belongs to T-008 together with `tests/root/**`. `tsconfig.build.json` is the emitting config of DD-14 and must live beside the `package.json` script that names it. No other task writes any of these paths and no lane changes dependencies.

## 5. Revisions

none
