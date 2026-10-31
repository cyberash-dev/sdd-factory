# Plan: expense-ledger-cli

## 1. Reconciliation

- REC-01 gap: `expense-ledger-cli:EXT-001` has no verification block (verification.md section 1 lists ExternalDependency as not eligible) but is in the cover set; covered by T-001, tests derived from the record's `test_obligation` (`node:fs`, `node:path`, `LEDGER_FILE`).
- REC-02 gap: `expense-ledger-cli:GEN-001` has no verification block; covered by T-007, test derived from its `test_obligation` (build, then `node dist/cli.js --help`).
- REC-03 gap: `expense-ledger-cli:CON-001` to `expense-ledger-cli:CON-006` have no verification blocks; all covered by T-007, tests derived from their `test_obligation` records.
- REC-04 conflict: verification.md section 1 declares EXT-001, GEN-001 and CON-001 to CON-006 not eligible, while `sdd ready` requires a test for each of them; resolution: the cover set of Rule 1 wins, all seven IDs are covered in exactly one task, and the lane reviewer arbitrates any remaining contract disagreement.
- REC-05 conflict: verification.md assertions for BEH-001, BEH-018 and CTR-007 describe the ledger file as a bare JSON array of expense objects, while tech.md DD-01 and DD-02 fix the document root at `{"next_id": <integer>, "expenses": [...]}`; both readings recorded; the spec fixes only the expense fields and the id non-reuse rule, so T-001 implements the tech.md document root and the reviewer arbitrates the file-shape assertion.
- REC-06 infeasible: `expense-ledger-cli:BEH-005` is an `infeasible_candidate` (uncontrolled UTC clock); covered by T-006 and the lane raises `VD-INFEASIBLE`.
- REC-07 infeasible: `expense-ledger-cli:INV-003` is an `infeasible_candidate` (its default-date half reads the uncontrolled clock); covered by T-002 and the lane raises `VD-INFEASIBLE`; the explicit-date half stays testable.

## 2. Task graph

Topological order; wave = the set of tasks whose dependencies are all in earlier waves.

| task | dependsOn | designRefs | wave |
| --- | --- | --- | --- |
| T-001 | — | M-01 | 1 |
| T-002 | — | M-02 | 1 |
| T-003 | — | M-03 | 1 |
| T-004 | T-002, T-003 | M-04 | 2 |
| T-005 | T-001, T-002, T-003 | M-05 | 2 |
| T-006 | T-001, T-002, T-003 | M-06 | 2 |
| T-007 | T-001, T-003, T-004, T-005, T-006 | M-07 | 3 |

Lanes per wave:

- Wave 1: T-001 store, T-002 domain, T-003 diagnostics.
- Wave 2: T-004 parse, T-005 query, T-006 mutate.
- Wave 3: T-007 root and CLI entry.

Longest chain holds 3 tasks (T-001 → T-005 → T-007), inside the depth cap of 3. No merge was needed: every task covers at least 3 eligible IDs (T-002 and T-003 cover exactly 3; the others 5 to 13), and one task per module already fits the cap.

## 3. Coverage matrix

| spec ID | task | module |
| --- | --- | --- |
| expense-ledger-cli:BEH-001 | T-006 | M-06 |
| expense-ledger-cli:BEH-002 | T-004 | M-04 |
| expense-ledger-cli:BEH-003 | T-004 | M-04 |
| expense-ledger-cli:BEH-004 | T-004 | M-04 |
| expense-ledger-cli:BEH-005 | T-006 | M-06 |
| expense-ledger-cli:BEH-006 | T-005 | M-05 |
| expense-ledger-cli:BEH-007 | T-005 | M-05 |
| expense-ledger-cli:BEH-008 | T-005 | M-05 |
| expense-ledger-cli:BEH-009 | T-005 | M-05 |
| expense-ledger-cli:BEH-010 | T-005 | M-05 |
| expense-ledger-cli:BEH-011 | T-005 | M-05 |
| expense-ledger-cli:BEH-012 | T-006 | M-06 |
| expense-ledger-cli:BEH-013 | T-006 | M-06 |
| expense-ledger-cli:BEH-014 | T-005 | M-05 |
| expense-ledger-cli:BEH-015 | T-004 | M-04 |
| expense-ledger-cli:BEH-016 | T-004 | M-04 |
| expense-ledger-cli:BEH-017 | T-001 | M-01 |
| expense-ledger-cli:BEH-018 | T-001 | M-01 |
| expense-ledger-cli:SCN-001 | T-007 | M-07 |
| expense-ledger-cli:SCN-002 | T-007 | M-07 |
| expense-ledger-cli:SCN-003 | T-007 | M-07 |
| expense-ledger-cli:CTR-001 | T-006 | M-06 |
| expense-ledger-cli:CTR-002 | T-005 | M-05 |
| expense-ledger-cli:CTR-003 | T-005 | M-05 |
| expense-ledger-cli:CTR-004 | T-006 | M-06 |
| expense-ledger-cli:CTR-005 | T-005 | M-05 |
| expense-ledger-cli:CTR-006 | T-004 | M-04 |
| expense-ledger-cli:CTR-007 | T-001 | M-01 |
| expense-ledger-cli:CTR-008 | T-003 | M-03 |
| expense-ledger-cli:INV-001 | T-001 | M-01 |
| expense-ledger-cli:INV-002 | T-002 | M-02 |
| expense-ledger-cli:INV-003 | T-002 | M-02 |
| expense-ledger-cli:INV-004 | T-005 | M-05 |
| expense-ledger-cli:INV-005 | T-005 | M-05 |
| expense-ledger-cli:INV-006 | T-005 | M-05 |
| expense-ledger-cli:INV-007 | T-003 | M-03 |
| expense-ledger-cli:INV-008 | T-002 | M-02 |
| expense-ledger-cli:EXT-001 | T-001 | M-01 |
| expense-ledger-cli:GEN-001 | T-007 | M-07 |
| expense-ledger-cli:POL-001 | T-003 | M-03 |
| expense-ledger-cli:POL-002 | T-004 | M-04 |
| expense-ledger-cli:CON-001 | T-007 | M-07 |
| expense-ledger-cli:CON-002 | T-007 | M-07 |
| expense-ledger-cli:CON-003 | T-007 | M-07 |
| expense-ledger-cli:CON-004 | T-007 | M-07 |
| expense-ledger-cli:CON-005 | T-007 | M-07 |
| expense-ledger-cli:CON-006 | T-007 | M-07 |

47 rows, one per eligible ID, no duplicate.

## 4. Shared files

T-007 owns `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `src/index.ts` and `src/cli.ts`. It is the composition root: last in the DAG, depends on every task whose `src/` interface it imports (T-001 store, T-003 diagnostics, T-004 parse, T-005 query, T-006 mutate), and carries the stack Constraints (CON-001 to CON-006) plus the end-to-end Scenarios (SCN-001 to SCN-003) and the emitting build (GEN-001). It holds no edge to T-002 because `src/index.ts` imports no module of `src/domain/`; the domain reaches the root through T-004 to T-006, so that edge would be transitive. No lane outside T-007 touches the shared files, so `"type": "module"`, the `build` and `test` scripts, `tsconfig.build.json` and the vitest include globs have exactly one writer.

## 5. Revisions

none
