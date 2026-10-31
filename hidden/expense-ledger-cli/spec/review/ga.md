# Spec review: expense-ledger-cli, round 2

decision: accept

## Findings
```yaml
- id: GA-001
  kind: conflict
  target_ids: [expense-ledger-cli:CTR-004, expense-ledger-cli:CTR-007, expense-ledger-cli:BEH-013]
  source: L8
  resolution: decide
  required_change: |
    "In expense-ledger-cli:CTR-004 replace the precondition \"the ledger file exists\" with \"an absent ledger file is read as an empty ledger, so rm of any well-formed id reports E_NO_EXPENSE with exit 1\"; in expense-ledger-cli:BEH-013 add the boundary class \"absent ledger file\" and the negative case \"ledger rm 1 against an absent ledger file => exit 1 E_NO_EXPENSE and stderr error: no expense #1\". No ASSUMPTION is minted: source L8 (an absent file is an empty ledger) and L28 (unknown expense id for rm) dictate the reading."
  assumption: null
  applied: yes
- id: GA-002
  kind: unmodeled_term
  target_ids: [expense-ledger-cli:BEH-015, expense-ledger-cli:CTR-006]
  source: L23
  resolution: decide
  required_change: |
    "Add to section 2 Glossary the term \"usage text\": the text printed by expense-ledger-cli:CTR-006 for `ledger --help`, naming the add, list, summary, rm and export commands and the --help option (source L23). Mechanical glossary fix; no ASSUMPTION."
  assumption: null
  applied: yes
- id: GA-003
  kind: unmodeled_term
  target_ids: [expense-ledger-cli:INV-001, expense-ledger-cli:CTR-004, expense-ledger-cli:BEH-013]
  source: L9
  resolution: decide
  required_change: |
    "Add to section 2 Glossary the term \"id\": the integer expense identifier starting at 1 and never reused within a ledger file, held by every expense (source L9). Mechanical glossary fix; no ASSUMPTION."
  assumption: null
  applied: yes
```

## Assumptions
none — no ASSUMPTION body was minted in round 1 and none is required now; all three round-1 findings were source-dictated mechanical fixes, and the nine existing ASSUMPTION records expense-ledger-cli:A-001 through expense-ledger-cli:A-009 still close Open-Qs Q-001 through Q-009 at their defaults with no change to insert.

## Open-Q decisions
| Open-Q | option | finding | rationale |
|---|---|---|---|
| expense-ledger-cli:Q-001 | Q-001-A | none | verified unchanged in round 2: expense-ledger-cli:A-001 exists and equals default_if_unresolved |
| expense-ledger-cli:Q-002 | Q-002-A | none | verified unchanged in round 2: expense-ledger-cli:A-002 exists and equals default_if_unresolved |
| expense-ledger-cli:Q-003 | Q-003-A | none | verified unchanged in round 2: expense-ledger-cli:A-003 exists and equals default_if_unresolved |
| expense-ledger-cli:Q-004 | Q-004-A | none | verified unchanged in round 2: expense-ledger-cli:A-004 exists and equals default_if_unresolved |
| expense-ledger-cli:Q-005 | Q-005-A | none | verified unchanged in round 2: expense-ledger-cli:A-005 exists and equals default_if_unresolved |
| expense-ledger-cli:Q-006 | Q-006-A | none | verified unchanged in round 2: expense-ledger-cli:A-006 exists and equals default_if_unresolved |
| expense-ledger-cli:Q-007 | Q-007-A | none | verified unchanged in round 2: expense-ledger-cli:A-007 exists and equals default_if_unresolved |
| expense-ledger-cli:Q-008 | Q-008-A | none | verified unchanged in round 2: expense-ledger-cli:A-008 exists and equals default_if_unresolved |
| expense-ledger-cli:Q-009 | Q-009-A | none | verified unchanged in round 2: expense-ledger-cli:A-009 exists and equals default_if_unresolved |

## Coverage
Verification round: no new coverage analysis was performed and no new finding was opened (rule 10). The round-1 coverage statement remains in force: every source line (L3, L7, L8, L9, L13, L15, L17, L19, L21, L23, L27, L28, L29, L30, L34, L35, L39) maps to at least one record, reachability holds via expense-ledger-cli:SUR-001, and every error code appears in exactly one `error_taxonomy` entry per Contract.
