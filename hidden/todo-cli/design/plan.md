# Plan: todo-cli

## 1. Reconciliation

- REC-01 gap: `todo-cli:GA-001` has no verification block (verification.md section 1 declares GeneratedArtifact not testable); covered anyway by T-004, tests derive from the record's `test_obligation` (post-build `node dist/cli.js --help`, exit 0).
- REC-02 gap: `todo-cli:CON-001` and `todo-cli:CON-002` have no verification block (declared not testable Constraints); covered anyway by T-004, tests assert no network import and no declared runtime dependency in package.json.
- REC-03 infeasible: `todo-cli:BEH-012` carries verification `infeasible_candidate` with `UNDEFINED_CODE`; covered by T-001, the lane raises `VD-INFEASIBLE` for the code name and tests assert exit 2, the `usage:` prefix and empty stdout.
- REC-04 infeasible: `todo-cli:NFR-001` carries verification `infeasible_candidate` (self-referential test-run status); covered by T-004, the lane raises `VD-INFEASIBLE` and the observable part is the build exit status plus zero failing tests while the suite runs.
- REC-05 conflict: for an unrecognised command verification.md section 2 names no code (`UNDEFINED_CODE`) while tech.md DD-01 maps it to `E_USAGE_UNKNOWN_OPTION` with the line `usage: unknown argument <token>`; spec.md BEH-012 fixes only exit 2 and the `usage:` prefix, so both readings stay and the spec wins: tests assert exit 2 and the prefix; the lane's reviewer arbitrates the code name.
- REC-06 gap: `todo-cli:IMP-001` is named by tech.md M-05 but is not in the cover set and is not covered by any task (ImplementationBinding, not eligible).
- REC-07 note: every eligible ID has exactly one module in the tech.md traceability table; no ID needed a surrogate module.

## 2. Task graph

| task | module(s) | dependsOn | covers |
| --- | --- | --- | --- |
| T-001 parse arguments and build usage errors | M-01, M-03 | none | 8 |
| T-002 read, validate and write the storage file | M-02 | none | 12 |
| T-003 run add, list, done and rm against the task list | M-04 | T-001, T-002 | 16 |
| T-004 wire the command entry point and print usage text | M-05 | T-001, T-002, T-003 | 9 |

Waves: wave 1 = {T-001, T-002}; wave 2 = {T-003}; wave 3 = {T-004}. Longest `dependsOn` chain: T-001 → T-003 → T-004, 3 tasks (cap 3). The module map has five modules and the depth cap is three, so the two leaf modules M-01 and M-03 are merged into one task (one dependency level fewer, T-003 then imports a single usage-error surface); M-02, M-04 and M-05 stay one task each. Every non-root task covers at least 3 eligible IDs, so no further merge is required by `min_covers_per_task`.

## 3. Coverage matrix

| spec ID | task | module |
| --- | --- | --- |
| todo-cli:BEH-001 | T-003 | M-04 |
| todo-cli:BEH-002 | T-003 | M-04 |
| todo-cli:BEH-003 | T-003 | M-04 |
| todo-cli:BEH-004 | T-003 | M-04 |
| todo-cli:BEH-005 | T-003 | M-04 |
| todo-cli:BEH-006 | T-003 | M-04 |
| todo-cli:BEH-007 | T-003 | M-04 |
| todo-cli:BEH-008 | T-003 | M-04 |
| todo-cli:BEH-009 | T-003 | M-04 |
| todo-cli:BEH-010 | T-003 | M-04 |
| todo-cli:BEH-011 | T-003 | M-04 |
| todo-cli:BEH-012 | T-001 | M-03 |
| todo-cli:BEH-013 | T-001 | M-03 |
| todo-cli:BEH-014 | T-001 | M-03 |
| todo-cli:BEH-015 | T-001 | M-03 |
| todo-cli:BEH-016 | T-002 | M-02 |
| todo-cli:BEH-017 | T-002 | M-02 |
| todo-cli:BEH-018 | T-002 | M-02 |
| todo-cli:BEH-019 | T-002 | M-02 |
| todo-cli:BEH-020 | T-004 | M-05 |
| todo-cli:BEH-021 | T-001 | M-03 |
| todo-cli:SCN-001 | T-004 | M-05 |
| todo-cli:SCN-002 | T-004 | M-05 |
| todo-cli:SCN-003 | T-004 | M-05 |
| todo-cli:NFR-001 | T-004 | M-05 |
| todo-cli:CTR-001 | T-003 | M-04 |
| todo-cli:CTR-002 | T-003 | M-04 |
| todo-cli:CTR-003 | T-003 | M-04 |
| todo-cli:CTR-004 | T-003 | M-04 |
| todo-cli:CTR-005 | T-004 | M-05 |
| todo-cli:CTR-006 | T-002 | M-02 |
| todo-cli:CTR-007 | T-002 | M-02 |
| todo-cli:INV-001 | T-002 | M-02 |
| todo-cli:INV-002 | T-002 | M-02 |
| todo-cli:INV-003 | T-002 | M-02 |
| todo-cli:INV-004 | T-003 | M-04 |
| todo-cli:INV-005 | T-001 | M-01 |
| todo-cli:INV-006 | T-002 | M-02 |
| todo-cli:INV-007 | T-002 | M-02 |
| todo-cli:GA-001 | T-004 | M-05 |
| todo-cli:POL-001 | T-001 | M-01 |
| todo-cli:POL-002 | T-001 | M-03 |
| todo-cli:POL-003 | T-002 | M-02 |
| todo-cli:CON-001 | T-004 | M-05 |
| todo-cli:CON-002 | T-004 | M-05 |

45 eligible IDs, each in exactly one task: T-001 8, T-002 12, T-003 16, T-004 9.

## 4. Shared files

T-004 is the composition root and owns `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`, plus `src/cli.ts` and `tsconfig.build.json` from M-05 and the whole `tests/cli/**` area. It is last in the DAG and depends on T-001, T-002 and T-003 because its wiring imports the usage-error surface, the store and the command runners; it owns the stack Constraints CON-001 and CON-002, the build obligation NFR-001, the artifact GA-001 and the end-to-end Scenarios SCN-001 to SCN-003. No other task lists any of these paths, so no lane changes dependencies.

## 5. Revisions

none
