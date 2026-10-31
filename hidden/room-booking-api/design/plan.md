# Plan: room-booking-api

## 1. Reconciliation

- REC-01 — gap: `room-booking-api:CON-001` … `room-booking-api:CON-006` are in the cover set but verification.md section 1 skips them as "not in the eligible template set" and gives them no block. tech.md assigns all six to M-06. Resolution: covered by T-004 (M-06), which owns the toolchain files and the process entry; the test-writer derives the cases from each Constraint's `test_obligation` (`tsc --noEmit`, Node 22, `npm test`/`npm run build`, no network, empty runtime dependency list, `PORT`).
- REC-02 — infeasible: `room-booking-api:BEH-017` is flagged in verification.md section 4 because its `typical` input class fails on a 200 success path with no error code. Resolution: covered by T-003; the negative check is the absence of the busy room from the 200 body, and the lane raises `VD-INFEASIBLE` instead of inventing a code.
- REC-03 — infeasible: `room-booking-api:BEH-022` is flagged in section 4 because its `boundary_no_content_204` class is a success path with no error code. Resolution: covered by T-004; the check is a zero-length 204 body with no `Content-Type` header.
- Every other eligible ID has exactly one tech.md module row (traceability section 8) and exactly one verification block with `feasibility: feasible`. No error code, exit code or status is stated differently by tech.md and verification.md, so no REC entry of kind `conflict` exists.
- The cover set holds 46 IDs: BEH-001…BEH-022 (22), SCN-001…SCN-003 (3), NFR-001 (1), CTR-001…CTR-007 (7), INV-001…INV-005 (5), POL-001…POL-002 (2), CON-001…CON-006 (6).

## 2. Task graph

Topological order, `graph_depth` 3:

| wave | task | dependsOn | designRefs | covers | input classes | maxTests | lane |
|---|---|---|---|---|---|---|---|
| 1 | T-001 | [] | M-01, M-02, M-03 | 12 | 66 | 80 | lane A |
| 2 | T-002 | [T-001] | M-04 | 12 | 63 | 80 | lane B |
| 2 | T-003 | [T-001] | M-05 | 7 | 44 | 66 | lane C |
| 3 | T-004 | [T-001, T-002, T-003] | M-06 | 15 | 55 | 80 | lane D |

`maxTests` = ceil(1.5 × input classes) bounded to [4, 80]. T-004's six Constraint covers (CON-001 … CON-006) have no verification block, so each counts 3 classes per Rule 7: 37 block classes + 18 = 55, ceil(82.5) = 83, bounded to 80.

Merges taken (start point one task per module):

- M-01 errors and M-02 domain merged into M-03 rooms: M-01 and M-02 sit at the leaves, M-02 covers 4 IDs and M-01 covers 1 ID, both below `min_covers_per_task` 3; their `owns` globs, `covers` and `designRefs` join M-03 into T-001. No `depends_on` edge remains between the merged parts.
- M-04, M-05 and M-06 keep their module boundaries: each covers at least 3 IDs and no leaf merge shortens the T-001 → T-002 → T-004 chain below the depth cap.
- Longest `dependsOn` chain: T-001 → T-002 → T-004 (3 tasks) and T-001 → T-003 → T-004 (3 tasks); both equal `graph_depth` 3.

## 3. Coverage matrix

| spec ID | task | module |
|---|---|---|
| room-booking-api:BEH-001 | T-001 | M-03 |
| room-booking-api:BEH-002 | T-001 | M-03 |
| room-booking-api:BEH-003 | T-001 | M-03 |
| room-booking-api:BEH-004 | T-001 | M-03 |
| room-booking-api:BEH-005 | T-001 | M-03 |
| room-booking-api:BEH-006 | T-002 | M-04 |
| room-booking-api:BEH-007 | T-002 | M-04 |
| room-booking-api:BEH-008 | T-002 | M-04 |
| room-booking-api:BEH-009 | T-002 | M-04 |
| room-booking-api:BEH-010 | T-002 | M-04 |
| room-booking-api:BEH-011 | T-002 | M-04 |
| room-booking-api:BEH-012 | T-003 | M-05 |
| room-booking-api:BEH-013 | T-003 | M-05 |
| room-booking-api:BEH-014 | T-003 | M-05 |
| room-booking-api:BEH-015 | T-002 | M-04 |
| room-booking-api:BEH-016 | T-002 | M-04 |
| room-booking-api:BEH-017 | T-003 | M-05 |
| room-booking-api:BEH-018 | T-003 | M-05 |
| room-booking-api:BEH-019 | T-004 | M-06 |
| room-booking-api:BEH-020 | T-004 | M-06 |
| room-booking-api:BEH-021 | T-004 | M-06 |
| room-booking-api:BEH-022 | T-004 | M-06 |
| room-booking-api:SCN-001 | T-002 | M-04 |
| room-booking-api:SCN-002 | T-002 | M-04 |
| room-booking-api:SCN-003 | T-004 | M-06 |
| room-booking-api:NFR-001 | T-004 | M-06 |
| room-booking-api:CTR-001 | T-004 | M-06 |
| room-booking-api:CTR-002 | T-001 | M-03 |
| room-booking-api:CTR-003 | T-001 | M-03 |
| room-booking-api:CTR-004 | T-002 | M-04 |
| room-booking-api:CTR-005 | T-003 | M-05 |
| room-booking-api:CTR-006 | T-002 | M-04 |
| room-booking-api:CTR-007 | T-003 | M-05 |
| room-booking-api:INV-001 | T-001 | M-02 |
| room-booking-api:INV-002 | T-001 | M-02 |
| room-booking-api:INV-003 | T-001 | M-02 |
| room-booking-api:INV-004 | T-001 | M-02 |
| room-booking-api:INV-005 | T-004 | M-06 |
| room-booking-api:POL-001 | T-001 | M-01 |
| room-booking-api:POL-002 | T-004 | M-06 |
| room-booking-api:CON-001 | T-004 | M-06 |
| room-booking-api:CON-002 | T-004 | M-06 |
| room-booking-api:CON-003 | T-004 | M-06 |
| room-booking-api:CON-004 | T-004 | M-06 |
| room-booking-api:CON-005 | T-004 | M-06 |
| room-booking-api:CON-006 | T-004 | M-06 |

Every eligible ID appears once; 46 rows for 46 covers in `tasks.json`.

## 4. Shared files

- T-004 (M-06 http, the composition root, last in the DAG and `dependsOn` every module whose interface it wires) owns `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts` and `src/index.ts`. tech.md section 2 gives `src/index.ts` to M-06 and DD-14 gives it `package.json` and `tsconfig.build.json`; `tsconfig.json` and `vitest.config.ts` hold the strict `tsc --noEmit` typecheck and the `vitest run` runner that CON-001, CON-003 and NFR-001 require, so they travel with the same task.
- No other task touches these files; no lane changes dependencies (CON-005 keeps the runtime dependency list empty).
- Write-sets are pairwise disjoint: T-001 (`src/domain/**`, `src/errors/**`, `src/rooms/**` plus the three matching `tests/` trees), T-002 (`src/booking-writes/**`, `tests/booking-writes/**`), T-003 (`src/booking-reads/**`, `tests/booking-reads/**`), T-004 (`src/index.ts`, `src/http/**`, `tests/http/**` and the shared files). No glob is nested in another task's glob.

## 5. Revisions

none
