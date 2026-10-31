# Plan: room-booking-api

## 1. Reconciliation

- REC-01: kind gap; ids room-booking-api:CN-001, room-booking-api:CN-002, room-booking-api:CN-003; `design/verification.md` records no block for a Constraint, so the three stack Constraints have no verification block. Resolution: covered by T-005, the composition root, which owns `src/app/**`, `src/index.ts` and the build configuration; the test-writer derives the tests from each Constraint's own `test_obligation` (`PORT` set and unset, ephemeral port 0, cold build with no type error, no declared runtime dependency).
- REC-02: kind gap; ids room-booking-api:BEH-011, room-booking-api:BEH-012; both records are assigned to M-01 in `design/tech.md` although they are observable only through `POST /rooms/:roomId/bookings`. Resolution: kept in T-001 (M-01) as the traceability table states, because the Time parser that rejects them is `parseTime` in M-01; T-003 exercises the same codes through the endpoint and its own records (BEH-010, BEH-013).
- REC-03: kind gap; id room-booking-api:BEH-028; the rule order spans three modules (the router's `invalid_json` in M-05, the query-before-room rule in M-04, the body/capacity/Conflict order in M-03) while `design/tech.md` assigns the record to M-03 only. Resolution: T-003 covers BEH-028 through M-03; the M-04 half is verified by BEH-020 and the M-05 half by BEH-025, and T-005 lists both so the precedence is exercised end to end.
- REC-04: kind gap; ids room-booking-api:POL-001, room-booking-api:POL-002; both Policies apply to the whole surface but name a single implementation (`formatError` in M-01, response writing in M-05). Resolution: POL-001 goes to T-001, which owns the only copy of the code-to-status table; POL-002 goes to T-005, which owns body reading and response writing.
- REC-05: no conflict found; `design/tech.md` and `design/verification.md` agree on every Error code, HTTP status and body member (invalid_json 400, invalid_room 400, room_name_taken 409, invalid_query 400, room_not_found 404, invalid_booking 400, over_capacity 422, room_busy 409 with `conflictingBookingId`, booking_not_found 404, not_found 404, method_not_allowed 405).
- REC-06: no infeasible candidate; section 4 of `design/verification.md` records none, and every eligible ID is covered.

## 2. Task graph

Wave 1: T-001 (no dependency).
Wave 2: T-002, T-003, T-004, each depending only on T-001; they run in parallel lanes because their write-sets are disjoint.
Wave 3: T-005, depending on T-001, T-002, T-003 and T-004.

Edges: T-002 → T-001, T-003 → T-001, T-004 → T-001, T-005 → T-001, T-005 → T-002, T-005 → T-003, T-005 → T-004. Longest chain holds three tasks (T-001, T-002, T-005), within the depth cap of 3. No transitive edge is listed: T-002, T-003 and T-004 do not depend on one another, and T-005's edges to them are kept because its tests import their route tables.

Modules merged into one task: M-05 and M-06 into T-005. M-06 depends on every other module and owns the shared files, and a separate M-05 task would have added a fourth level, so the router and the composition root form one task, the composition root owning `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts` and `src/index.ts`.

## 3. Coverage matrix

| Spec ID | Task | Module |
|---|---|---|
| room-booking-api:BEH-001 | T-002 | M-02 |
| room-booking-api:BEH-002 | T-002 | M-02 |
| room-booking-api:BEH-003 | T-002 | M-02 |
| room-booking-api:BEH-004 | T-002 | M-02 |
| room-booking-api:BEH-005 | T-002 | M-02 |
| room-booking-api:BEH-006 | T-002 | M-02 |
| room-booking-api:BEH-007 | T-002 | M-02 |
| room-booking-api:BEH-008 | T-003 | M-03 |
| room-booking-api:BEH-009 | T-003 | M-03 |
| room-booking-api:BEH-010 | T-003 | M-03 |
| room-booking-api:BEH-011 | T-001 | M-01 |
| room-booking-api:BEH-012 | T-001 | M-01 |
| room-booking-api:BEH-013 | T-003 | M-03 |
| room-booking-api:BEH-014 | T-003 | M-03 |
| room-booking-api:BEH-015 | T-003 | M-03 |
| room-booking-api:BEH-016 | T-003 | M-03 |
| room-booking-api:BEH-017 | T-003 | M-03 |
| room-booking-api:BEH-018 | T-004 | M-04 |
| room-booking-api:BEH-019 | T-004 | M-04 |
| room-booking-api:BEH-020 | T-004 | M-04 |
| room-booking-api:BEH-021 | T-004 | M-04 |
| room-booking-api:BEH-022 | T-004 | M-04 |
| room-booking-api:BEH-023 | T-004 | M-04 |
| room-booking-api:BEH-024 | T-004 | M-04 |
| room-booking-api:BEH-025 | T-005 | M-05 |
| room-booking-api:BEH-026 | T-005 | M-05 |
| room-booking-api:BEH-027 | T-005 | M-05 |
| room-booking-api:BEH-028 | T-003 | M-03 |
| room-booking-api:SCN-001 | T-002 | M-02 |
| room-booking-api:SCN-002 | T-003 | M-03 |
| room-booking-api:SCN-003 | T-004 | M-04 |
| room-booking-api:SCN-004 | T-003 | M-03 |
| room-booking-api:CTR-001 | T-002 | M-02 |
| room-booking-api:CTR-002 | T-002 | M-02 |
| room-booking-api:CTR-003 | T-003 | M-03 |
| room-booking-api:CTR-004 | T-004 | M-04 |
| room-booking-api:CTR-005 | T-004 | M-04 |
| room-booking-api:CTR-006 | T-004 | M-04 |
| room-booking-api:CTR-007 | T-005 | M-05 |
| room-booking-api:INV-001 | T-001 | M-01 |
| room-booking-api:INV-002 | T-001 | M-01 |
| room-booking-api:INV-003 | T-001 | M-01 |
| room-booking-api:INV-004 | T-005 | M-05 |
| room-booking-api:INV-005 | T-001 | M-01 |
| room-booking-api:INV-006 | T-001 | M-01 |
| room-booking-api:INV-007 | T-001 | M-01 |
| room-booking-api:POL-001 | T-001 | M-01 |
| room-booking-api:POL-002 | T-005 | M-05 |
| room-booking-api:CN-001 | T-005 | M-06 |
| room-booking-api:CN-002 | T-005 | M-06 |
| room-booking-api:CN-003 | T-005 | M-06 |

51 rows, one per eligible ID; every ID appears in exactly one task.

## 4. Shared files

T-005 owns `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts` and `src/index.ts`. It is the composition root: last in the DAG, depending on T-001, T-002, T-003 and T-004, wiring their route tables into one Store and one server, and covering the stack Constraints CN-001, CN-002 and CN-003 that fix the dependency set, the `PORT` boundary and the build commands. Its own scope also holds `tsconfig.build.json`, the emitting build configuration that M-06 owns. No other task declares a dependency or touches a root configuration file.

## 5. Revisions

none
