# Plan: room-booking-api

## 1. Reconciliation

- REC-01 `gap`: `room-booking-api:EXT-001` is in the cover set but verification.md §1 lists it as skipped and gives it no block. Covered anyway in T-006, whose module M-08 owns the `PORT` boundary (BEH-021, CTR-007); the test-writer derives tests from the record's `test_obligation`.
- REC-02 `gap`: `room-booking-api:CON-001` … `room-booking-api:CON-005` are in the cover set but verification.md §1 lists Constraints as skipped and gives them no block. All five map to M-08 in the tech.md traceability table and are covered in T-006; tests derive from each record's `test_obligation` (`npm run build` and `npm test`, typecheck, no runtime dependency, offline run).
- REC-03 `conflict`: verification.md §1 counts 39 eligible records, while the cover set holds 45 (the six additions named in REC-01 and REC-02). The cover set supplied by the runtime wins; all 45 IDs appear exactly once in the cut.
- REC-04 `conflict`: `room-booking-api:BEH-011` and `room-booking-api:CTR-004` state that equal starts are broken by ascending id, while the BEH-011 block in verification.md declares that state unreachable because a second identical-start booking in one room is rejected with `409 room_busy`. Both readings are recorded; the spec wins. The tie-break stays covered by T-004 for the lane's reviewer to arbitrate.
- REC-05 `conflict`: the BEH-021 block in verification.md expects the ephemeral `PORT=0` port to be read from the process standard output, while tech.md §5 and DD-10 state the server writes nothing to `stdout` and reports the effective port only through `StartedServer.port`. Both readings are recorded; the spec (BEH-021, ASM-007) requires only that the server accept requests on the assigned port, which T-006 covers.
- REC-06 `infeasible`: verification.md lists `room-booking-api:BEH-011` as an `infeasible_candidate` (unreachable equal-start state). It is covered by T-004; the lane raises `VD-INFEASIBLE`.
- REC-07 `infeasible`: verification.md lists `room-booking-api:NFR-001` as an `infeasible_candidate` (a suite cannot assert the exit status of the run it belongs to). It is covered by T-006; the lane raises `VD-INFEASIBLE`.

No eligible ID lacks a module in the tech.md traceability table, and no eligible ID is left without a task.

## 2. Task graph

Six tasks, three `dependsOn` levels, numbered topologically.

| wave | task | designRefs | dependsOn |
| --- | --- | --- | --- |
| 1 | T-001 provide the error catalogue, in-memory store and time rules | M-01, M-02, M-03 | — |
| 2 | T-002 create and list rooms with field and name validation | M-04 | T-001 |
| 2 | T-003 create and delete bookings with capacity and overlap checks | M-05 | T-001 |
| 2 | T-004 list room bookings in start order with the interval filter | M-06 | T-001 |
| 2 | T-005 query the rooms available for a requested interval | M-07 | T-001 |
| 3 | T-006 compose the HTTP server, routing and JSON error envelope | M-08 | T-001, T-002, T-003, T-004, T-005 |

Longest chain: `T-001 → T-002 → T-006`, three tasks, at the cap of 3.

Cut rationale: the starting point was one task per module. M-01, M-02 and M-03 each depend on nothing, own disjoint leaves and are imported by every handler module, so they were merged into T-001 from the leaves up; the merge also removes two dependency levels from every wave. M-04 through M-07 each cover at least 3 eligible IDs on their own, so they stay separate, and M-08 is the composition root that must depend on all four handlers.

Scenario placement follows the tech.md module map, which attributes each Scenario to the single module that runs its sequence: `room-booking-api:SCN-001` (create, conflict, delete, re-create) stays with T-003 (M-05) and `room-booking-api:SCN-002` (availability around one booking) with T-005 (M-07). The composition root T-006 keeps the cross-cutting `room-booking-api:CTR-007` envelope and `room-booking-api:POL-002` boundary.

## 3. Coverage matrix

| spec ID | task | module |
| --- | --- | --- |
| room-booking-api:BEH-001 | T-002 | M-04 |
| room-booking-api:BEH-002 | T-002 | M-04 |
| room-booking-api:BEH-003 | T-002 | M-04 |
| room-booking-api:BEH-004 | T-002 | M-04 |
| room-booking-api:BEH-005 | T-002 | M-04 |
| room-booking-api:BEH-006 | T-003 | M-05 |
| room-booking-api:BEH-007 | T-003 | M-05 |
| room-booking-api:BEH-008 | T-003 | M-05 |
| room-booking-api:BEH-009 | T-003 | M-05 |
| room-booking-api:BEH-010 | T-003 | M-05 |
| room-booking-api:BEH-011 | T-004 | M-06 |
| room-booking-api:BEH-012 | T-004 | M-06 |
| room-booking-api:BEH-013 | T-004 | M-06 |
| room-booking-api:BEH-014 | T-003 | M-05 |
| room-booking-api:BEH-015 | T-003 | M-05 |
| room-booking-api:BEH-016 | T-005 | M-07 |
| room-booking-api:BEH-017 | T-005 | M-07 |
| room-booking-api:BEH-018 | T-006 | M-08 |
| room-booking-api:BEH-019 | T-006 | M-08 |
| room-booking-api:BEH-020 | T-004 | M-06 |
| room-booking-api:BEH-021 | T-006 | M-08 |
| room-booking-api:SCN-001 | T-003 | M-05 |
| room-booking-api:SCN-002 | T-005 | M-07 |
| room-booking-api:NFR-001 | T-006 | M-08 |
| room-booking-api:CTR-001 | T-002 | M-04 |
| room-booking-api:CTR-002 | T-002 | M-04 |
| room-booking-api:CTR-003 | T-003 | M-05 |
| room-booking-api:CTR-004 | T-004 | M-06 |
| room-booking-api:CTR-005 | T-003 | M-05 |
| room-booking-api:CTR-006 | T-005 | M-07 |
| room-booking-api:CTR-007 | T-006 | M-08 |
| room-booking-api:INV-001 | T-001 | M-02 |
| room-booking-api:INV-002 | T-006 | M-08 |
| room-booking-api:INV-003 | T-001 | M-01 |
| room-booking-api:INV-004 | T-001 | M-02 |
| room-booking-api:INV-005 | T-001 | M-03 |
| room-booking-api:INV-006 | T-001 | M-03 |
| room-booking-api:EXT-001 | T-006 | M-08 |
| room-booking-api:POL-001 | T-001 | M-01 |
| room-booking-api:POL-002 | T-006 | M-08 |
| room-booking-api:CON-001 | T-006 | M-08 |
| room-booking-api:CON-002 | T-006 | M-08 |
| room-booking-api:CON-003 | T-006 | M-08 |
| room-booking-api:CON-004 | T-006 | M-08 |
| room-booking-api:CON-005 | T-006 | M-08 |

45 eligible IDs, 45 matrix rows, each ID in exactly one task. Test budgets: T-001 56, T-002 78, T-003 80, T-004 44, T-005 33, T-006 80 (`ceil(1.5 × Σ input_classes)`, 3 for an ID without a block, bounded to [4, 80]).

## 4. Shared files

T-006 owns every shared file, because it is the composition root: last in the DAG, the only task that wires the modules together and the only task allowed to touch build configuration.

- `package.json`, `package-lock.json` — the `build`, `start` and `test` scripts and the dev-dependency set of TD-TOOLING. No lane adds or changes a dependency; T-006 alone owns them.
- `tsconfig.json`, `tsconfig.build.json` — the strict ESM compiler options of CON-001 and the `tsc -p tsconfig.build.json` build of CON-003.
- `vitest.config.ts` — the single suite runner through which every other task's `tests/<area>/**` is discovered.
- `src/index.ts` — the entry that wires `createServer()` and `startServer()` to the store of M-02 and the handlers of M-04 through M-07; the only file that binds a port (BEH-021, EXT-001) or renders the error envelope (CTR-007, INV-002).
- `tests/server/**` — the boundary and contract tests of T-006's covers, including POL-002, INV-002 and the stack Constraints.

`src/index.ts` is the only file at the `src/` root, so it overlaps no other task's subtree. Every other task owns exactly one `src/<module>/**` subtree plus the matching `tests/<area>/**` subtree, so all `writes` globs are pairwise disjoint.

## 5. Revisions

none
