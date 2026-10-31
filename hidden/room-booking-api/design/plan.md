# Plan: room-booking-api

## 1. Reconciliation

- REC-01: gap — `room-booking-api:CON-001`, `room-booking-api:CON-002`, `room-booking-api:CON-003` have no verification block (section 1 of verification.md skips every Constraint); covered anyway in T-006, which owns the composition root where the constraint is observable; the test-writer derives the checks from each record's `test_obligation`.
- REC-02: infeasible — `room-booking-api:CTR-011` is an `infeasible_candidate` on its `port_unset` class (binding machine-wide port 3000); covered anyway in T-006; the lane raises `VD-INFEASIBLE` and T-006 exercises the `port_set` class through `startServer(0)` plus `resolvePort`.
- REC-03: conflict — error precedence: verification.md BEH-009 requires `404 room_not_found` for an unknown room combined with an invalid title, while CTR-003's taxonomy lists `invalid_booking` beside `room_not_found`; tech.md DD-07 and ASM-002 order body parse, route, room existence, body validation, capacity, conflict. The spec records win; T-004 implements and tests the DD-07 order and the lane's reviewer arbitrates.
- REC-04: none — `room-booking-api:BEH-012` names the earliest-starting conflicting booking in both the spec and verification.md BEH-012; ASM-005 adds the id tie-break, implemented by tech.md DD-11 in T-004.
- REC-05: none — the traceability table module of every eligible ID matches the `covers` list of that module in tech.md; no ID resolves to a module owning a different surface.

## 2. Task graph

Topological order and waves (edge = `dependsOn`):

| wave | tasks | edges |
| --- | --- | --- |
| 1 | T-001 | none |
| 2 | T-002, T-003, T-004, T-005 | each → T-001 |
| 3 | T-006 (composition root) | → T-001, T-002, T-003, T-004, T-005 |

Longest chain: T-001 → T-002 → T-006, three tasks, equal to the depth cap.

Module mapping: T-001 = M-01, T-002 = M-02, T-003 = M-03, T-004 = M-04, T-005 = M-05, T-006 = M-06.

No merge was needed: every task other than the composition root covers at least three IDs (7, 5, 10, 15, 3), and the graph is already three levels deep.

Test budgets follow ceil(1.5 × Σ input_classes): T-001 53, T-002 38, T-003 80 (capped), T-004 80 (capped), T-005 32, T-006 15.

## 3. Coverage matrix

| spec ID | task | module |
| --- | --- | --- |
| room-booking-api:BEH-001 | T-003 | M-03 |
| room-booking-api:BEH-002 | T-003 | M-03 |
| room-booking-api:BEH-003 | T-003 | M-03 |
| room-booking-api:BEH-004 | T-003 | M-03 |
| room-booking-api:BEH-005 | T-003 | M-03 |
| room-booking-api:BEH-006 | T-003 | M-03 |
| room-booking-api:BEH-007 | T-003 | M-03 |
| room-booking-api:BEH-008 | T-004 | M-04 |
| room-booking-api:BEH-009 | T-004 | M-04 |
| room-booking-api:BEH-010 | T-004 | M-04 |
| room-booking-api:BEH-011 | T-004 | M-04 |
| room-booking-api:BEH-012 | T-004 | M-04 |
| room-booking-api:BEH-013 | T-004 | M-04 |
| room-booking-api:BEH-014 | T-004 | M-04 |
| room-booking-api:BEH-015 | T-004 | M-04 |
| room-booking-api:BEH-016 | T-004 | M-04 |
| room-booking-api:BEH-017 | T-004 | M-04 |
| room-booking-api:BEH-018 | T-004 | M-04 |
| room-booking-api:BEH-019 | T-005 | M-05 |
| room-booking-api:BEH-020 | T-005 | M-05 |
| room-booking-api:BEH-021 | T-002 | M-02 |
| room-booking-api:BEH-022 | T-002 | M-02 |
| room-booking-api:BEH-023 | T-002 | M-02 |
| room-booking-api:BEH-024 | T-002 | M-02 |
| room-booking-api:CTR-001 | T-003 | M-03 |
| room-booking-api:CTR-002 | T-003 | M-03 |
| room-booking-api:CTR-003 | T-004 | M-04 |
| room-booking-api:CTR-004 | T-004 | M-04 |
| room-booking-api:CTR-005 | T-004 | M-04 |
| room-booking-api:CTR-006 | T-005 | M-05 |
| room-booking-api:CTR-007 | T-001 | M-01 |
| room-booking-api:CTR-008 | T-001 | M-01 |
| room-booking-api:CTR-009 | T-001 | M-01 |
| room-booking-api:CTR-010 | T-001 | M-01 |
| room-booking-api:CTR-011 | T-006 | M-06 |
| room-booking-api:INV-001 | T-001 | M-01 |
| room-booking-api:INV-002 | T-004 | M-04 |
| room-booking-api:INV-003 | T-001 | M-01 |
| room-booking-api:INV-004 | T-006 | M-06 |
| room-booking-api:INV-005 | T-003 | M-03 |
| room-booking-api:POL-001 | T-001 | M-01 |
| room-booking-api:POL-002 | T-002 | M-02 |
| room-booking-api:CON-001 | T-006 | M-06 |
| room-booking-api:CON-002 | T-006 | M-06 |
| room-booking-api:CON-003 | T-006 | M-06 |

45 rows, 45 eligible IDs, each in exactly one task.

## 4. Shared files

T-006 owns `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `src/index.ts` and `src/main.ts`: it is the composition root, last in the DAG, depends on every other task, and covers the stack Constraints CON-001, CON-002 and CON-003 plus the process invariants INV-004 and CTR-011. It adds the `start` script, keeps `dependencies` empty and adds no dependency. No other task writes a shared file; `src/core`, `src/http`, `src/rooms`, `src/bookings` and `src/availability` are disjoint directories, and `tests/core`, `tests/http`, `tests/rooms`, `tests/bookings`, `tests/availability` and `tests/root` are disjoint test directories.

## 5. Revisions

none
