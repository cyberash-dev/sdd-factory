# sdd-factory — design-stage partition

> Single source of truth for the `design-stage` partition of `sdd-factory`:
> the two concurrent design roles (architect, verification-designer), the
> planner that reconciles them into a task graph, and the three design files
> the build lanes consume.
>
> **v0.1.0** — every record is `lifecycle.status: proposed`. Promotion to
> `approved` requires a human `sdd approve` + `sdd finalize`; the authoring
> agent cannot self-approve (SDD §7.5).

---

## 1. Context

Once the product spec is approved, two LLM roles start from the same event
and never read each other: the architect (artel stage 5a) maps approved
records to modules, interfaces and tooling; the verification-designer
(artel stage 5b) turns every test obligation into input classes, negative
oracles and assertion summaries without knowing the design. This is the
first point in a run where two agents are genuinely concurrent.

The planner (artel stages 6a and 6b) waits for both files, computes the
coverage matrix deterministically, and cuts the work into tasks with
pairwise-disjoint write-sets and a dependency DAG. The task file is the
contract between the design stage and the build lanes; the runtime
validates it before any lane starts and sends violations back to the
planner once.

---

## 2. Glossary

- **Approved record** — a product spec record with `lifecycle.status:
  approved` after `spec.approved`.
- **Module** — a unit of the design (`M-NN`) owning one file area under
  `src/` and a set of spec ids.
- **Tooling block** — the `TD-TOOLING` section of tech.md: node version,
  test and typecheck commands, exact dependency versions.
- **Obligation block** — one entry in verification.md for one spec id.
- **Task** — one entry in tasks.json (`T-NNN`) with `covers`, `writes`,
  `dependsOn`.
- **Write-set** — the `writes` globs of a task.
- **Coverage matrix** — the mapping spec id → task → module computed by
  the planner reactor.
- **Barrier** — the planner starts only after both design files exist.
- **Re-cut** — a planner rework that merges or splits tasks.

---

## 3. Partition

```yaml
---
id: design-stage
type: Partition
partition_id: design-stage
owner_team: sdd-factory
gate_scope:
  - design-stage
dependencies_on_other_partitions:
  - bus:SUR-001
  - bus:SUR-002
  - spec-stage:SUR-001
  - factory:POL-001
  - factory:POL-002
  - factory:POL-003
default_policy_set:
  - factory:POL-001
  - factory:POL-002
  - factory:POL-003
id_namespace: design-stage
unmodeled_budget:
  current: 0
  baseline_at: "2026-10-29"
  baseline_value: 0
  trend: monotonic_non_increasing
---
```

---

## 4. Brownfield baseline

none (greenfield; single baseline factory:BL-001)

---

## 5. Surfaces

```yaml
---
id: design-stage:SUR-001
type: Surface
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.871Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: design-stage
name: design-files
version: "0.1.1"
boundary_type: public_storage
members:
  - design-stage:CTR-001
  - design-stage:CTR-002
  - design-stage:CTR-003
consumer_compat_policy: semver_per_surface
notes: |
  Consumed by the foreman (tooling install, stubs, worktrees), the build
  lanes (module interfaces, obligations) and judges reading the published
  tree.
---
```

---

## 6. Requirements

```yaml
---
id: design-stage:BEH-001
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.871Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: design-stage
title: architect and verification-designer start concurrently from spec.approved
given: |
  - `spec.approved` was emitted
when: the runtime dispatches `spec.approved`
then: |
  - two Mozaik loops start within the same event dispatch: architect and
    verification-designer; the trace records their first `inference.started`
    events before either emits its ready event
  - the architect reads spec/spec.md and the source spec; it never reads
    design/verification.md
  - the verification-designer reads spec/spec.md only; it never reads
    design/tech.md or the source spec
  - each writes its file (design-stage:CTR-001, design-stage:CTR-002) and
    its handoff; the foreman emits `design.tech.ready{path}` and
    `design.verification.ready{path}` independently
negative_cases:
  - one role's handoff is blocked => design.blocked with reason
    <role>_blocked; the other loop is left to finish, then the run fails
  - a role reads the other role's file (detected from the tool log) =>
    `design.blocked{reason:"context_firewall_violation"}`
out_of_scope:
  - sequencing the two roles to save tokens
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_global
  read_consistency: strong
  idempotency: none
  time_source: none
data_scope: new_writes_only
policy_refs:
  - factory:POL-001
  - factory:POL-002
test_obligation:
  predicate: |
    With fake models, trace.jsonl shows inference.started for both roles
    before any design.*.ready event, and the captured prompts of each role
    contain no content from the other role's file.
  test_template: integration
  boundary_classes:
    - both complete
    - architect blocked
    - firewall violation
  failure_scenarios:
    - verification-designer started after design.tech.ready
---
```

```yaml
---
id: design-stage:BEH-002
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.871Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: design-stage
title: planner starts at the barrier and cuts the task graph
given: |
  - both `design.tech.ready` and `design.verification.ready` were emitted
when: the planner barrier is satisfied
then: |
  - exactly one planner loop starts, reading spec/spec.md, design/tech.md
    and design/verification.md
  - it writes design/tasks.json (design-stage:CTR-003) and
    design/plan.md with the coverage matrix, then its handoff
  - the foreman validates tasks.json per design-stage:INV-001..003; on
    success it emits `design.tasks.ready{path, taskCount}`
negative_cases:
  - only one ready event arrived => no planner loop starts
  - validation fails => `design.rework{target:"planner", reason:<validator
    message>, attempt:1}` and the planner re-runs with the message; a
    second failure => `design.blocked{reason:"planner_cap"}`
  - handoff `uncovered_ids` non-empty with status complete => treated as a
    validation failure
out_of_scope:
  - estimating effort or ordering tasks by priority
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: exactly_once_with_key:runId
  time_source: none
data_scope: new_writes_only
policy_refs:
  - factory:POL-002
test_obligation:
  predicate: |
    Emitting design.tech.ready alone starts no planner; emitting both
    starts one; a tasks.json with overlapping writes triggers exactly one
    design.rework and a valid second output yields design.tasks.ready.
  test_template: integration
  boundary_classes:
    - one ready event
    - both ready events
    - invalid then valid
    - invalid twice
  failure_scenarios:
    - two planner loops started
    - design.tasks.ready with a validation violation
---
```

```yaml
---
id: design-stage:BEH-003
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.871Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: design-stage
title: foreman installs the tooling declared by the architect before lanes start
given: |
  - `design.tasks.ready` was emitted
  - design/tech.md contains a tooling block with `dependencies` and
    `dev_dependencies` pinned to exact versions
when: the foreman handles `design.tasks.ready`
then: |
  - the foreman runs `npm install --save-exact` for the listed runtime
    dependencies and `--save-dev --save-exact` for the dev dependencies in
    the product repo, overwrites `compilerOptions` of tsconfig.json with
    the tooling block's `tsconfig` sub-key when present, commits the
    changed files on `integration`, and only then provisions worktrees
    (factory:BEH-004)
  - with empty lists and no `tsconfig` sub-key nothing is installed and
    no commit is made
negative_cases:
  - install fails => run.failed with stage design, reason
    toolchain_install_failed and the npm output tail as detail
  - a dependency without an exact version => design.rework with target
    architect and reason unpinned_dependency (architect repair cap)
out_of_scope:
  - installing anything after lanes start (factory:CST-004)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: exactly_once_with_key:runId
  time_source: none
data_scope: new_writes_only
policy_refs:
  - factory:POL-002
test_obligation:
  predicate: |
    A tech.md declaring one runtime dependency results in that exact
    version in package.json and a commit on integration before the first
    task.ready; an unpinned entry routes to the architect.
  test_template: integration
  boundary_classes:
    - empty lists
    - one pinned dependency
    - unpinned dependency
  failure_scenarios:
    - task.ready emitted before the lockfile commit
---
```

```yaml
---
id: design-stage:BEH-004
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.871Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: design-stage
title: design rework repairs only the affected part
given: |
  - `task.rework{target:"architect"}` (VD-INFEASIBLE or reviewer target
    architect) or `task.rework{target:"planner"}` (TASK-OVERFLOW or
    write-set conflict) was emitted
when: the targeted role is re-invoked with the finding
then: |
  - the architect edits only the module named by the finding's spec ids
    and appends a `## Revisions` entry; the foreman emits
    `design.tech.ready` again and then `task.rework{target:"test-writer"}`
    for every task whose covers intersect the finding's spec ids
  - the planner merges or re-cuts only the tasks named in the finding,
    keeps every other task id and content unchanged, and the foreman
    re-validates tasks.json; lanes of changed tasks restart from
    test-writer, unchanged approved tasks stay approved
  - each role's repair counter is incremented (design-stage:CST-001,
    design-stage:CST-002)
negative_cases:
  - counter exceeded => `run.failed{stage:"design", reason:"cap_exhausted"}`
  - the planner changes an unrelated task => validation compares the
    previous tasks.json and emits `design.rework` with reason
    `unrelated_task_changed`
out_of_scope:
  - re-running the verification-designer (its file is spec-derived and
    does not depend on the design)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: none
  time_source: none
data_scope: new_writes_only
policy_refs:
  - factory:POL-002
test_obligation:
  predicate: |
    A TASK-OVERFLOW from T-002 naming T-003's file yields a new tasks.json
    where T-001 is byte-identical, T-002 and T-003 are merged or re-cut,
    and only the affected lanes receive task.rework.
  test_template: integration
  boundary_classes:
    - planner re-cut
    - architect repair
    - cap exceeded
  failure_scenarios:
    - unrelated task rewritten
    - approved lane restarted without an intersecting id
---
```

---

## 7. Data contracts

```yaml
---
id: design-stage:CTR-001
type: Contract
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.871Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: design-stage
title: technical design file design/tech.md
surface_ref: design-stage:SUR-001
schema:
  path: design/tech.md
  sections:
    - "## Modules": entries M-NN with name, responsibility, covers (spec ids), owns (exact src file paths), interface (every exported name with its TypeScript signature), depends_on (module ids whose exports this module imports)
    - "## Data shapes": TypeScript type aliases for boundary payloads
    - "## Error mapping": spec error_taxonomy entry -> exit code or HTTP status and body shape
    - "## Process boundaries": argv parsing, environment variables, ports, file IO
    - "## TD-TOOLING": node, test_cmd, typecheck_cmd, dependencies [{name, version}], dev_dependencies [{name, version}]
    - "## Design decisions": DD-NN entries with rationale
    - "## Traceability": table spec id -> module
    - "## Revisions": appended on repair (optional before any repair)
  constraints:
    - every approved Behavior, Contract, Invariant, Scenario and NFR id appears in exactly one module's covers
    - every module lists at least one exact src file path and every exported name with its signature (the foreman creates throwing stubs from them before a lane starts); no two modules own the same path
    - dependency versions are exact (no range operators)
preconditions:
  - spec.approved emitted
postconditions:
  - the foreman can derive stub module paths and the install list from the file without model calls
external_identifiers:
  - file path design/tech.md and the section headings above
  - module id grammar M-NN
compatibility_rules:
  - renaming a heading or the tooling keys => major bump on design-stage:SUR-001
error_taxonomy:
  - "missing TD-TOOLING or unparseable dependency list => design.blocked{reason:\"tech_md_invalid\"}"
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: none
  time_source: none
data_scope: new_writes_only
policy_refs:
  - factory:POL-002
test_obligation:
  predicate: |
    The parser extracts modules, owned paths and the tooling block from a
    fixture tech.md; a fixture with a module owning no path or an
    unpinned dependency is rejected with the stated reason.
  test_template: contract
  boundary_classes:
    - valid file
    - module without owned path
    - unpinned dependency
  failure_scenarios:
    - tooling block silently defaulted
---
```

```yaml
---
id: design-stage:CTR-002
type: Contract
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.871Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: design-stage
title: verification design file design/verification.md
surface_ref: design-stage:SUR-001
schema:
  path: design/verification.md
  blocks:
    - heading: "### <spec id>"
      fields:
        obligation: the test_obligation predicate restated
        input_classes: list (empty, boundary, invalid, nominal at minimum where applicable)
        negative_oracle: what must fail and with which error code or exit code
        assertion_summary: observable outputs only
        sequence: ordered observable steps (Scenario records only)
  constraints:
    - one block per approved Behavior, Contract, Invariant, Scenario, NFR and Policy id
    - no reference to module names, file paths or TypeScript identifiers
preconditions:
  - spec.approved emitted
postconditions:
  - the test-writer of a task receives the blocks of its covers verbatim
external_identifiers:
  - file path design/verification.md
  - block heading grammar "### <slug>:<PREFIX>-NNN"
compatibility_rules:
  - changing block fields => major bump on design-stage:SUR-001
error_taxonomy:
  - "missing block for an approved id => design.rework{target:\"verification-designer\"} once, then design.blocked"
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: none
  time_source: none
data_scope: new_writes_only
policy_refs:
  - factory:POL-002
test_obligation:
  predicate: |
    For a fixture spec with n approved obligation-bearing ids the parsed
    file has n blocks with the four fields; a block mentioning a src path
    is flagged.
  test_template: contract
  boundary_classes:
    - complete file
    - missing block
    - block naming a file path
  failure_scenarios:
    - block count mismatch accepted
---
```

```yaml
---
id: design-stage:CTR-003
type: Contract
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.871Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: design-stage
title: task graph file design/tasks.json
surface_ref: design-stage:SUR-001
schema:
  path: design/tasks.json
  json:
    schemaVersion: 1
    partition: "<slug>"
    tasks:
      - id: "T-NNN"
        title: string
        covers: ["<slug>:<PREFIX>-NNN"]
        writes: ["<glob>"]
        dependsOn: ["T-NNN"]
        designRefs: ["M-NN"]
        testBudget: { maxTests: integer }
        reworkRoute: { onImplementationFailure: "implementer", onTestContractConflict: "reviewer" }
  validation:
    - every approved normative id except Surface and Partition appears in exactly one task's covers
    - writes glob sets are pairwise disjoint (no file path matches two tasks)
    - every task has at least one writes glob under src/ and one under tests/
    - dependsOn references existing tasks and forms a DAG
    - designRefs reference modules present in tech.md
    - shared files (package.json, tsconfig.json, src/index.ts) belong to exactly one task
preconditions:
  - both design files exist
postconditions:
  - the foreman can start lanes from the file alone
external_identifiers:
  - file path design/tasks.json and the JSON keys above
  - task id grammar T-NNN
compatibility_rules:
  - removing a key or changing a validation rule => major bump on design-stage:SUR-001
  - adding an optional key => minor bump
error_taxonomy:
  - "validation failure => design.rework{target:\"planner\", reason:<rule name and offending ids>}"
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: none
  time_source: none
data_scope: new_writes_only
policy_refs:
  - factory:POL-002
test_obligation:
  predicate: |
    Each validation rule is exercised by one fixture that violates only
    that rule and is reported with its name; a valid fixture passes all
    rules.
  test_template: contract
  boundary_classes:
    - valid
    - uncovered id
    - id covered twice
    - overlapping writes
    - cycle
    - unknown module ref
    - task without tests glob
  failure_scenarios:
    - overlapping globs accepted because they differ textually
---
```

---

## 8. Invariants

```yaml
---
id: design-stage:INV-001
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.871Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: design-stage
title: coverage partition of approved ids over tasks
always: |
  At `design.tasks.ready` the multiset union of `covers` over all tasks
  equals the set of approved normative ids of the product spec minus
  Surface and Partition, with every id occurring exactly once.
scope: design/tasks.json
evidence: test_probe
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: none
  time_source: none
negative_cases:
  - an id covered by two tasks is rejected even when both tasks' tests would cover it
out_of_scope:
  - ids of assumptions minted after approval (they attach to the task of
    the record they interpret)
test_obligation:
  predicate: |
    For every fixture spec and planner output accepted by the validator,
    sorted covers equal sorted approved ids; the validator rejects any
    duplicate or omission.
  test_template: unit
  boundary_classes:
    - exact partition
    - omission
    - duplicate
  failure_scenarios:
    - Surface id required in covers
---
```

```yaml
---
id: design-stage:INV-002
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.871Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: design-stage
title: write-sets are pairwise disjoint
always: |
  No file path in the product repo matches the `writes` globs of two
  different tasks, evaluated against the union of existing paths and the
  paths tech.md assigns to modules.
scope: design/tasks.json
evidence: test_probe
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: none
  time_source: none
negative_cases:
  - src/** in one task and src/cli/** in another is a violation
out_of_scope:
  - paths outside src/ and tests/ (owned by the foreman)
test_obligation:
  predicate: |
    Overlapping globs are rejected with both task ids named; disjoint
    globs over the same parent directory are accepted.
  test_template: unit
  boundary_classes:
    - nested overlap
    - sibling directories
  failure_scenarios:
    - overlap detected only after a lane wrote the file
---
```

```yaml
---
id: design-stage:INV-003
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.871Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: design-stage
title: the task dependency graph is acyclic
always: |
  `dependsOn` over all tasks forms a directed acyclic graph, and every
  referenced task id exists.
scope: design/tasks.json
evidence: test_probe
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: none
  time_source: none
negative_cases:
  - a self-dependency is a cycle
out_of_scope:
  - optimal ordering
test_obligation:
  predicate: |
    A two-node cycle and a self-dependency are rejected naming the cycle;
    a diamond dependency is accepted.
  test_template: unit
  boundary_classes:
    - cycle
    - self-dependency
    - diamond
  failure_scenarios:
    - dangling dependsOn accepted
---
```

---

## 9. External dependencies

none

---

## 10. Generated artifacts

none

---

## 11. Localization

none

---

## 12. Policies

none (inherits factory:POL-001, factory:POL-002, factory:POL-003)

---

## 13. Constraints

```yaml
---
id: design-stage:CST-001
type: Constraint
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.871Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: design-stage
constraint: at most 1 planner re-cut per run (validation rework and TASK-OVERFLOW rework share the counter)
rationale: |
  A second re-cut means the design itself is unstable; the run stops so
  the prompts are fixed between runs.
test_obligation:
  predicate: |
    Two consecutive planner validation failures end the run with
    design.blocked{reason:"planner_cap"}; a TASK-OVERFLOW after one
    validation rework ends it with run.failed cap_exhausted.
  test_template: integration
  boundary_classes: [two failures]
  failure_scenarios: [third planner invocation]
---
```

```yaml
---
id: design-stage:CST-002
type: Constraint
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.871Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: design-stage
constraint: at most 1 architect repair per run
rationale: |
  Each repair restarts every lane touching the repaired module; a second
  repair is cheaper to do by re-launching with a fixed prompt.
test_obligation:
  predicate: |
    A second task.rework{target:"architect"} ends the run with
    run.failed{reason:"cap_exhausted"}.
  test_template: integration
  boundary_classes: [second repair]
  failure_scenarios: [second repair executed]
---
```

---

## 14. Migrations

none

---

## 15. Deltas

```yaml
---
id: design-stage:DLT-001
type: Delta
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-30T16:43:07.167Z
    change_request: malformed design file is a rework finding
    scope: first-time-approval
partition_id: design-stage
title: a malformed design file is a rework finding, not a blocker
target_ids:
  - design-stage:CTR-001
  - design-stage:CTR-002
kind: replace
compatibility_action: ignore
baseline_version: design-stage:BL-001@v0.1.0
description: |
  Live run 8 ended at the design stage because the verification-designer
  left an unescaped quote inside a yaml scalar of design/verification.md:
  the parser rejected the file and design.blocked{reason:
  "verification_md_invalid"} failed the run. The author of the file is
  the role best placed to repair it when told the parser message, so a
  file the parser rejects is treated like a missing block: the role
  re-runs once with the parser message as its rework finding, and only a
  second unusable output blocks.
  design-stage:CTR-001 error_taxonomy row "missing TD-TOOLING or
  unparseable dependency list => design.blocked{reason:
  \"tech_md_invalid\"}" becomes "missing TD-TOOLING, unparseable file or
  unparseable dependency list => design.rework{target: \"architect\"}
  once, then design.blocked{reason: \"tech_md_invalid\"}"; an unpinned
  dependency keeps its existing design.rework route. A missing file keeps
  design.blocked (the role produced nothing to repair).
  design-stage:CTR-002 error_taxonomy row gains "unparseable file =>
  design.rework{target: \"verification-designer\"} once, then
  design.blocked{reason: \"verification_md_invalid\"}". The rework
  finding carries the parser message verbatim (block heading, line and
  column when the parser reports them). No change to design-stage:SUR-001
  members or file shapes.
surface_impact:
  - id: design-stage:SUR-001
    intended_version: "0.1.1"
tests_old_behavior:
  - a missing design/tech.md or design/verification.md still ends in design.blocked with the existing reasons
tests_new_behavior:
  - to:design-stage:CTR-001
  - to:design-stage:CTR-002
test_obligation:
  predicate: |
    Given a verification-designer whose first design/verification.md
    fails to parse and whose second parses and covers every id, the
    effect publishes design.verification.ready and the role was invoked
    twice with the parser message in the second rework finding; given an
    architect whose first design/tech.md fails to parse, the effect
    publishes design.rework{target: "architect"} with the parser message;
    given two unparseable outputs in a row, design.blocked carries the
    existing reason; a file that was never written still blocks at once.
  test_template: integration
  boundary_classes:
    - unparseable then valid verification.md
    - unparseable tech.md
    - unparseable twice
    - file not written
  failure_scenarios:
    - the parser message lost from the rework finding
    - the rework loop running past one repair
---
```

```yaml
---
id: design-stage:DLT-002
type: Delta
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-30T17:12:28.452Z
    change_request: build stage shakedown after run 9
    scope: first-time-approval
partition_id: design-stage
title: the tooling step drops rootDir so the typecheck keeps covering tests
target_ids:
  - design-stage:BEH-003
  - design-stage:CTR-001
kind: replace
compatibility_action: ignore
baseline_version: design-stage:BL-001@v0.1.0
surface_impact: []
description: |
  Run 9 lost its first task to the tooling step: the architect's
  TD-TOOLING `tsconfig` carried `rootDir: "src"` for emission, the
  foreman copied it into the one tsconfig.json whose `include` lists
  `src`, `tests` and `vitest.config.ts`, and `npx tsc --noEmit` then
  failed with TS6059 on every test file, so the red check reported
  suite_error for tests that were fine. The typecheck of
  design-stage:CTR-001 `typecheck_cmd` covers src and tests by
  construction, so `rootDir` can never be right in that file: the
  foreman now applies the architect's compilerOptions without
  `rootDir`, logs `design-stage: tsconfig rootDir dropped` when it was
  present, and keeps `include` as scaffolded. An emitting build that
  needs `rootDir` belongs in a separate tsconfig the composition-root
  task owns (tsconfig.build.json). The architect prompt says so too.
tests_old_behavior:
  - every other compilerOption of the tooling block still overwrites the scaffold's
tests_new_behavior:
  - to:design-stage:BEH-003
test_obligation:
  predicate: |
    Given a tooling block with tsconfig {strict: true, rootDir: "src",
    outDir: "dist"}, the committed tsconfig.json has compilerOptions
    {strict: true, outDir: "dist"} and include unchanged; a block without
    rootDir is applied verbatim.
  test_template: integration
  boundary_classes:
    - tsconfig with rootDir
    - tsconfig without rootDir
  failure_scenarios:
    - rootDir kept
    - include rewritten
---
```

---

## 16. Implementation bindings

none (added once the implementation exists)

---

## 17. Open questions

```yaml
---
id: design-stage:OQ-001
type: Open-Q
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.871Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: design-stage
question: |
  Should the verification-designer be re-run after an architect repair?
options:
  - id: a
    label: never
    consequence: verification.md stays spec-derived; obligations are design-independent by construction
  - id: b
    label: on_repair
    consequence: more tokens; no benefit while verification.md references no design element
blocking: no
owner: operator
default_if_unresolved: a
---
```

---

## 18. Assumptions

```yaml
---
id: design-stage:ASM-001
type: ASSUMPTION
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.871Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: design-stage
assumption: the verification-designer runs exactly once per run
source_open_q: design-stage:OQ-001
blocking: no
review_by: "2026-10-31"
default_if_unresolved: keep_assumption
tests:
  - design-stage:BEH-004 boundary class "architect repair"
---
```

---

## 19. Out of scope

- Effort estimates, priorities and schedules in tasks.json.
- Cross-module refactoring during a run; a module boundary that does not
  hold is a prompt fix between runs.
- Non-TypeScript products.
