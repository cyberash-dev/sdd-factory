# Plan: box-office

## 1. Reconciliation

REC-01 gap — `box-office:CST-001`, `CST-002`, `CST-003`, `CST-004`, `CST-005`: verification.md §1 excludes Constraints from the block rule, so these five eligible IDs have no verification block. Each has a module in the tech.md traceability table. Covered anyway: `CST-001` and `CST-004` in T-002, `CST-002`, `CST-003` and `CST-005` in T-007; the test-writer derives tests from each record's `test_obligation` (state visible to the next request of the process; request completes with outbound networking unavailable; server answers on `PORT`; `expiresAt` follows `HOLD_SECONDS` including 0 and unset; empty runtime dependency set).

REC-02 conflict — a foreign `tierId` on the waitlist: tech.md DD-10 states 404 `E_NOT_FOUND` and cites `box-office:ASM-016`, which no record of spec.md carries; the approved `box-office:ASM-004` and verification.md `box-office:CTR-014` (input class `invalid_tier_of_other_event`) state 400 `E_INVALID_TIER`. Both readings recorded; the spec wins, so the lane builds the 400 `E_INVALID_TIER` reading and the reviewer arbitrates. Task T-007.

REC-03 conflict — `GET /me/waitlist`: tech.md DD-11 serves it and cites `box-office:ASM-012`, absent from spec.md; no approved record of spec.md requires the route and no verification block covers it. Recorded, no eligible ID assigned; T-007 implements the route as tech.md states it, and no task's coverage depends on it.

REC-04 conflict — body syntax versus token: the approved `box-office:ASM-009` states that a missing token answers 401 even when the body is not valid JSON; the approved records `box-office:BEH-005`, `box-office:BEH-030`, `box-office:BEH-031` and `box-office:INV-011` and their verification blocks require 400 `E_MALFORMED_JSON` before the token check on a served route with a served method, and `box-office:OQ-009`'s `opt-json-first` is the design reading. Both readings recorded; the record prose wins, so body syntax is decided before the token. Task T-007.

REC-05 gap — verification.md §1 drops two boundary classes the spec states: `box-office:CTR-010` "event exactly 24 hours away" and `box-office:BEH-007` `startsAt` exactly a millisecond ahead. Both are covered anyway in T-005 and T-004; DD-14 fixes the reading at exactly 24 hours to 409 `E_ORDER_STATE`, and the tests bracket the millisecond case with the verified future and past classes.

REC-06 gap — `box-office:BEH-018`, `BEH-027`, `BEH-028`, `SCN-001` and `SCN-004` are HTTP-observable obligations whose tech.md `covers` list assigns them to M-02, a module with no route. They stay in T-002 and are tested through `createStore` with an injected clock, which is where the design puts the expiry, serving and code-use rules.

## 2. Task graph

Topological order, three waves:

| wave | task | modules | dependsOn |
| --- | --- | --- | --- |
| 1 | T-001 | M-01 core | — |
| 1 | T-002 | M-02 store | — |
| 2 | T-003 | M-03 accounts | T-001, T-002 |
| 2 | T-004 | M-04 events | T-001, T-002 |
| 2 | T-005 | M-05 orders | T-001, T-002 |
| 2 | T-006 | M-06 discounts | T-001, T-002 |
| 3 | T-007 | M-07 waitlist, M-08 app | T-001, T-002, T-003, T-004, T-005, T-006 |

Longest chain: T-001 → T-003 → T-007, three tasks, at the depth cap of 3. Edges: every route module imports `src/core/index.ts` and `src/store/index.ts` for its types, which its tests load; the composition root imports all six. No transitive edge and no edge for relatedness only. Lanes per wave: wave 1 two lanes, wave 2 four lanes, wave 3 one lane.

Cut: one task per M-NN, then M-07 waitlist merged into M-08 app along the `depends_on` edge, because M-07 alone covers two IDs, below `min_covers_per_task`, and M-08 is the only composition root.

## 3. Coverage matrix

| spec ID | task | module |
| --- | --- | --- |
| box-office:POL-001 | T-001 | M-01 |
| box-office:POL-002 | T-001 | M-01 |
| box-office:INV-004 | T-001 | M-01 |
| box-office:INV-008 | T-001 | M-01 |
| box-office:CST-001 | T-002 | M-02 |
| box-office:CST-004 | T-002 | M-02 |
| box-office:INV-003 | T-002 | M-02 |
| box-office:INV-005 | T-002 | M-02 |
| box-office:INV-007 | T-002 | M-02 |
| box-office:INV-009 | T-002 | M-02 |
| box-office:INV-010 | T-002 | M-02 |
| box-office:BEH-018 | T-002 | M-02 |
| box-office:BEH-027 | T-002 | M-02 |
| box-office:BEH-028 | T-002 | M-02 |
| box-office:SCN-001 | T-002 | M-02 |
| box-office:SCN-004 | T-002 | M-02 |
| box-office:CTR-001 | T-003 | M-03 |
| box-office:CTR-002 | T-003 | M-03 |
| box-office:CTR-003 | T-003 | M-03 |
| box-office:BEH-001 | T-003 | M-03 |
| box-office:BEH-002 | T-003 | M-03 |
| box-office:BEH-003 | T-003 | M-03 |
| box-office:BEH-004 | T-003 | M-03 |
| box-office:BEH-006 | T-003 | M-03 |
| box-office:INV-001 | T-003 | M-03 |
| box-office:CTR-004 | T-004 | M-04 |
| box-office:CTR-005 | T-004 | M-04 |
| box-office:CTR-006 | T-004 | M-04 |
| box-office:CTR-007 | T-004 | M-04 |
| box-office:CTR-015 | T-004 | M-04 |
| box-office:BEH-007 | T-004 | M-04 |
| box-office:BEH-008 | T-004 | M-04 |
| box-office:BEH-009 | T-004 | M-04 |
| box-office:BEH-010 | T-004 | M-04 |
| box-office:BEH-011 | T-004 | M-04 |
| box-office:BEH-012 | T-004 | M-04 |
| box-office:BEH-013 | T-004 | M-04 |
| box-office:BEH-029 | T-004 | M-04 |
| box-office:INV-002 | T-004 | M-04 |
| box-office:SCN-003 | T-004 | M-04 |
| box-office:CTR-008 | T-005 | M-05 |
| box-office:CTR-009 | T-005 | M-05 |
| box-office:CTR-010 | T-005 | M-05 |
| box-office:CTR-011 | T-005 | M-05 |
| box-office:CTR-012 | T-005 | M-05 |
| box-office:BEH-014 | T-005 | M-05 |
| box-office:BEH-015 | T-005 | M-05 |
| box-office:BEH-016 | T-005 | M-05 |
| box-office:BEH-017 | T-005 | M-05 |
| box-office:BEH-019 | T-005 | M-05 |
| box-office:BEH-020 | T-005 | M-05 |
| box-office:BEH-021 | T-005 | M-05 |
| box-office:BEH-022 | T-005 | M-05 |
| box-office:BEH-025 | T-005 | M-05 |
| box-office:INV-006 | T-005 | M-05 |
| box-office:SCN-002 | T-005 | M-05 |
| box-office:CTR-013 | T-006 | M-06 |
| box-office:BEH-023 | T-006 | M-06 |
| box-office:BEH-024 | T-006 | M-06 |
| box-office:CTR-014 | T-007 | M-07 |
| box-office:BEH-026 | T-007 | M-07 |
| box-office:BEH-005 | T-007 | M-08 |
| box-office:BEH-030 | T-007 | M-08 |
| box-office:BEH-031 | T-007 | M-08 |
| box-office:INV-011 | T-007 | M-08 |
| box-office:CST-002 | T-007 | M-08 |
| box-office:CST-003 | T-007 | M-08 |
| box-office:CST-005 | T-007 | M-08 |

## 4. Shared files

`package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts` and `src/index.ts` belong to T-007 alone: it is the composition root, last in the DAG, depends on every other task, and owns the tooling of TD-TOOLING (DD-12: `npm run build` is `tsc -p tsconfig.build.json`, `npm start` is `node dist/index.js`) plus the stack Constraints `CST-003` and `CST-005` and the end-to-end obligations `BEH-030`, `BEH-031` and `INV-011`. No other task's globs match them, so no lane changes a dependency or a compiler option.

## 5. Revisions

none
