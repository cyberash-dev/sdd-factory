# Plan: todo-cli

## 1. Reconciliation

| Kind | IDs | Finding | Resolution |
| --- | --- | --- | --- |
| REC-01 | todo-cli:CON-001, todo-cli:CON-002, todo-cli:CON-003, todo-cli:CON-004, todo-cli:CON-005, todo-cli:CON-006 | gap: verification.md section 1 excludes every Constraint from its template set, so these six eligible records have no block; tech.md traceability assigns all six to M-06 | kept in the cover set and placed on T-005 (owner of M-06, `src/cli.ts`, `package.json`, `tsconfig.json`, `vitest.config.ts`); the test-writer derives their tests from each record's `test_obligation` (`npm run build` emits `dist/cli.js`, `npx tsc --noEmit` strict, `npx vitest run` via `npm test`, empty `dependencies`) |
| REC-02 | todo-cli:CON-001, todo-cli:CON-002, todo-cli:CON-003, todo-cli:CON-004, todo-cli:CON-005 | gap: those records also have no `input_classes`, so `testBudget` for T-005 counts 3 per ID: 4 × 1.5 for todo-cli:INV-003 plus 6 × 3 × 1.5 = 33 tests | `maxTests: 33` on T-005 |
| REC-03 | todo-cli:POL-001 | conflict: tech.md section 4 lists a fourth row `E_SUCCESS` in the error-mapping table, while M-01's `ErrorCode` union and spec error taxonomies carry only `E_USAGE`, `E_NO_TASK`, `E_STORAGE`; `E_SUCCESS` names the exit-0 class, not a failure code | recorded both readings; the failure taxonomy stays three codes (spec wins), `E_SUCCESS` is treated as the success-class label on T-001 and T-003; the lane reviewer arbitrates if a test asserts `E_SUCCESS` as a member of `ErrorCode` |
| REC-04 | todo-cli:CTR-002, todo-cli:BEH-013 | conflict: verification.md BEH-013 class `boundary_unknown_flag` and CTR-002 class `invalid_unknown_flag` both expect `E_USAGE` exit 2 for `list --verbose`, while tech.md DD-07 states the same rule; no divergence remains, but spec BEH-013 `out_of_scope` leaves flag handling open and ASM-008 fixes it | recorded; both IDs stay on their module tasks (T-002, T-003); the usage rejection is produced by M-03 and the `--all`-only flag set by M-04 |
| REC-05 | todo-cli:BEH-006 | conflict: spec BEH-006 fixes one ascending-id order for `--all` and ASSUMPTION ASM-004 repeats it, while verification.md BEH-006 `assertion_summary` says a completed task is never placed after an open task with a lower id — the same rule stated as an ordering and as a prefix constraint | recorded; spec wins, one ascending-id order with the `[x] ` prefix on completed lines; covered by T-003 |
| REC-06 | all 37 eligible IDs | tech.md section 8 traceability names an M-NN for every eligible ID; verification.md section 4 reports `infeasible_candidate: none` | no `infeasible` finding; no ID needs the surface_ref fallback |

## 2. Task graph

Topological order, waves, and lanes:

| Wave | Task | dependsOn | designRefs |
| --- | --- | --- | --- |
| 1 | T-001 Define error codes and storage file access | — | M-01, M-02 |
| 2 | T-002 Parse command-line arguments into typed commands | T-001 | M-03 |
| 2 | T-003 Render list output and the usage text | T-001 | M-04 |
| 2 | T-004 Execute add, done and rm against the storage file | T-001 | M-05 |
| 3 | T-005 Wire the process entry, build and test scripts | T-001, T-002, T-003, T-004 | M-06 |

Edges: T-001 → T-002, T-001 → T-003, T-001 → T-004, T-002 → T-005, T-003 → T-005, T-004 → T-005. Longest chain holds 3 tasks (T-001 → T-002 → T-005), within the cap of 3. No transitive edge: T-005 does not list T-005 or itself; T-002, T-003 and T-004 depend on T-001 only, because each imports `../errors/index.js` and `../store/index.js` for its tests to load.

Merges from the leaves: T-001 merges M-01 errors with M-02 store because both are leaves under tech.md DD-01 and neither imports the other, which yields one leaf lane instead of two. M-03, M-04 and M-05 stay separate: each holds a distinct responsibility, disjoint `owns` globs, and an independent lane. M-06 stays the composition root. No further merge is needed to reach depth 3.

## 3. Coverage matrix

| Spec ID | Task | Module |
| --- | --- | --- |
| todo-cli:BEH-001 | T-004 | M-05 |
| todo-cli:BEH-002 | T-002 | M-03 |
| todo-cli:BEH-003 | T-001 | M-02 |
| todo-cli:BEH-004 | T-001 | M-02 |
| todo-cli:BEH-005 | T-003 | M-04 |
| todo-cli:BEH-006 | T-003 | M-04 |
| todo-cli:BEH-007 | T-003 | M-04 |
| todo-cli:BEH-008 | T-004 | M-05 |
| todo-cli:BEH-009 | T-004 | M-05 |
| todo-cli:BEH-010 | T-004 | M-05 |
| todo-cli:BEH-011 | T-004 | M-05 |
| todo-cli:BEH-012 | T-004 | M-05 |
| todo-cli:BEH-013 | T-002 | M-03 |
| todo-cli:BEH-014 | T-002 | M-03 |
| todo-cli:BEH-015 | T-002 | M-03 |
| todo-cli:BEH-016 | T-003 | M-04 |
| todo-cli:BEH-017 | T-001 | M-02 |
| todo-cli:BEH-018 | T-001 | M-02 |
| todo-cli:BEH-019 | T-001 | M-02 |
| todo-cli:CTR-001 | T-004 | M-05 |
| todo-cli:CTR-002 | T-003 | M-04 |
| todo-cli:CTR-003 | T-004 | M-05 |
| todo-cli:CTR-004 | T-004 | M-05 |
| todo-cli:CTR-005 | T-003 | M-04 |
| todo-cli:CTR-006 | T-001 | M-02 |
| todo-cli:INV-001 | T-001 | M-02 |
| todo-cli:INV-002 | T-001 | M-02 |
| todo-cli:INV-003 | T-005 | M-06 |
| todo-cli:INV-004 | T-001 | M-02 |
| todo-cli:POL-001 | T-001 | M-01 |
| todo-cli:POL-002 | T-002 | M-03 |
| todo-cli:CON-001 | T-005 | M-06 |
| todo-cli:CON-002 | T-005 | M-06 |
| todo-cli:CON-003 | T-005 | M-06 |
| todo-cli:CON-004 | T-005 | M-06 |
| todo-cli:CON-005 | T-005 | M-06 |
| todo-cli:CON-006 | T-005 | M-06 |

37 rows, one per eligible ID; no ID appears twice.

## 4. Shared files

- `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `src/cli.ts`, `src/index.ts` → T-005 only. tech.md DD-09 and DD-10 place the build entry, the emitting tsconfig, the package scripts and the pinned dev toolchain on M-06, the composition root, which is last in the DAG and depends on every task whose interface it wires.
- tech.md DD-09 fixes `src/cli.ts` as the process entry so `npm run build` emits `dist/cli.js`, the path the spec invokes. `src/index.ts` is not a package entry in this design; T-005 declares it in `writes` so that no task file of the toolchain set is left unowned.
- `writes` globs are pairwise disjoint: T-001 holds `src/errors/**`, `src/store/**`, `tests/errors/**`, `tests/store/**`; T-002 `src/parse/**`, `tests/parse/**`; T-003 `src/read-commands/**`, `tests/read-commands/**`; T-004 `src/write-commands/**`, `tests/write-commands/**`; T-005 the seven root-level files, `src/cli.ts`, `src/index.ts` and `tests/cli/**`. The two `src/` file globs match no other task's directory glob.
- No lane adds a dependency: tech.md DD-10 pins the dev toolchain and leaves `dependencies` empty, so only T-005 edits `package.json`.

## 5. Revisions

Attempt 2, finding `shared_file_unowned: src/index.ts`. Only T-005 changed: `writes` gained the file glob `src/index.ts`; its `id`, `title`, `covers`, `dependsOn`, `designRefs`, `testBudget` and `reworkRoute` are byte-identical to attempt 1, as are all other tasks. No task was merged, renumbered or added. `src/index.ts` belongs to T-005 because the composition root owns every shared toolchain file and no src/ file may stay unowned.
