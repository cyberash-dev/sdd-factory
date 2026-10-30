# sdd-factory — build-stage partition

> Version 0.1.0. Every record in this file is `lifecycle.status: proposed`
> and becomes implementable only after a human owner runs `sdd approve`
> followed by `sdd finalize`. The partition owns the per-task build lane:
> test-writer, Verifier red check, implementer, Verifier green check,
> reviewer, and the rework routing between them.

---

## 1. Context

The build stage turns one task from `design/tasks.json` into a reviewed,
green commit on a dedicated git worktree. Each task runs as an isolated
**lane**: a test-writer subprocess authors failing tests, a deterministic
Verifier confirms they fail for the right reason and freezes them, an
implementer subprocess with a fresh context makes them green inside the
task's write-set, the Verifier confirms green with the tests untouched,
and a reviewer with a fresh context issues a single decision. Every
transition is caused by one event on `bus:SUR-001` and every retry is
bounded by a cap, so a lane either ends in `task.approved` or in
`task.failed`; there is no state in which a human is awaited.

Lanes of independent tasks run concurrently. A lane whose task declares
`dependsOn` starts only after those tasks are approved and merged into the
`integration` branch by the foreman (factory partition), so the worktree
base already contains the dependencies. The foreman scaffolds the module
files that `design/tech.md` assigns to the task before the test-writer
starts, so tests import stable paths and fail at execution time rather
than at load time.

This partition specifies observable lane behaviour, the two files the lane
publishes (`reviews/<taskId>.md`, `verifier.json`), its invariants and its
caps. Participant internals, prompt wording and Mozaik wiring are the
implementer's domain.

---

## 2. Glossary

- **Lane** — the sequence of participant invocations and Verifier runs
  that processes exactly one task from `task.ready` to `task.approved` or
  `task.failed`.
- **Task** — one entry of `design/tasks.json` (`design-stage:CTR-003`):
  `id`, `covers[]`, `writes[]`, `dependsOn[]`, `designRefs[]`.
- **Write-set** — the `writes[]` glob list of a task; the only paths a lane
  role is allowed to create or change.
- **Worktree** — the git worktree `{{run_dir}}/worktrees/<taskId>` created
  from the `integration` branch head.
- **baseSha** — the commit the worktree was created from, after the
  scaffold commit.
- **testsSha** — the commit that froze the task's tests after a passing red
  check.
- **implSha** — the commit produced by a passing green check.
- **Red check** — the Verifier run after the test-writer: tests execute and
  fail, markers are complete, changes stay inside the write-set.
- **Green check** — the Verifier run after the implementer: typecheck and
  tests pass, tests unchanged since `testsSha`, changes stay inside the
  write-set.
- **Load failure** — a test file that vitest could not import or compile,
  reported with an empty assertion list and a file-level message.
- **Execution failure** — a test that ran and failed, by assertion mismatch
  or by a thrown error inside the test body.
- **Vacuous test** — a test that passes while the behaviour it names is
  absent (passes at the red check).
- **Finding** — a typed escalation record emitted by the implementer:
  `TEST-CONTRACT-CONFLICT`, `TASK-OVERFLOW`, `VD-INFEASIBLE`,
  `TOOLING-BROKEN`.
- **Handoff** — the `handoff.md` file every LLM role writes
  (`bus:CTR-007`); reactors parse only its YAML frontmatter.
- **Cap** — the maximum number of attempts a route grants before the lane
  fails.
- **Attempt** — one invocation of a role for one task; attempts are counted
  per role per task.
- **Lane restart** — `git reset --hard <baseSha>` on the worktree followed
  by a fresh test-writer invocation.
- **Verifier** — the deterministic part of the foreman that runs the
  typecheck and test commands and writes `verifier.json`.
- **Covers marker** — a `@covers <slug>:<ID>` comment inside a test file.

---

## 3. Partition

```yaml
---
id: build-stage
type: Partition
partition_id: build-stage
owner_team: sdd-factory
gate_scope:
  - build-stage
dependencies_on_other_partitions:
  - bus:SUR-001
  - bus:SUR-002
  - design-stage:SUR-001
  - spec-stage:SUR-001
  - factory:POL-001
  - factory:POL-002
  - factory:POL-003
default_policy_set:
  - factory:POL-001
  - factory:POL-002
  - factory:POL-003
id_namespace: build-stage
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
id: build-stage:SUR-001
type: Surface
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
name: lane-files
version: "0.1.0"
boundary_type: public_storage
members:
  - build-stage:CTR-001
  - build-stage:CTR-002
consumer_compat_policy: semver_per_surface
notes: |
  Files a lane writes for consumers outside the lane: the review report
  (published with the product) and the Verifier evidence (consumed by the
  tracer, the reviewer and the assembler).
---
```

---

## 6. Requirements

```yaml
---
id: build-stage:BEH-001
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
title: lane start — worktree, scaffold, task.ready
given: |
  - design.tasks.ready has been emitted and design/tasks.json validates
    against design-stage:CTR-003
  - task T has every id in dependsOn in state approved (or dependsOn is
    empty); the foreman merged each approved dependency into the
    integration branch on its task.approved event (factory partition)
  - design/tech.md lists, for every designRef of T, the module file paths
    and exported signatures
when: the foreman selects T for lane start
then: |
  - a git worktree {{run_dir}}/worktrees/<T.id> is created from the current
    head of the integration branch
  - {{product_dir}}/node_modules is symlinked into the worktree
  - for every module path assigned to T in design/tech.md that does not yet
    exist, a stub file is written whose every declared export throws
    Error("not implemented: <export>"); the stubs are committed on the
    worktree branch as "scaffold <T.id>"
  - baseSha = the worktree head after the scaffold commit
  - task.ready{taskId, worktree, baseSha, covers, writes} is emitted
  - lane state for T becomes tests_pending with every attempt counter at 0
negative_cases:
  - a dependsOn task is not yet approved => T is not started; no event
  - a dependsOn task is in state failed => T is never started; the run
    fails through BEH-016
  - git worktree creation fails => task.failed{taskId, reason: blocked,
    detail: worktree_error}
out_of_scope:
  - choosing the task order among independent ready tasks
  - merging dependencies (factory partition, on task.approved)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_global
  read_consistency: strong
  idempotency: "exactly_once_with_key:taskId"
  time_source: monotonic
data_scope: all_data
policy_refs:
  - factory:POL-002
test_obligation:
  predicate: |
    Given tasks.json with T1 (no deps) and T2 (dependsOn T1), after
    design.tasks.ready exactly one task.ready is emitted (for T1); after
    task.approved for T1 a task.ready for T2 is emitted whose baseSha
    contains T1's implSha as an ancestor; the T2 worktree contains stub
    files for every module path of T2 and each stub export throws.
  test_template: integration
  boundary_classes:
    - task without dependencies
    - task with one approved dependency
    - task with a failed dependency
    - module path already present on integration (no stub written)
  failure_scenarios:
    - dependent task started before its dependency is approved
    - stub overwrites an existing module file
    - baseSha recorded before the scaffold commit
---
```

```yaml
---
id: build-stage:BEH-002
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
title: test-writer invocation
given: |
  - lane state for T is tests_pending (after task.ready) or tests_rework
    (after task.rework{target: test-writer})
  - testWriterAttempts(T) < 1 + CST-002 cap
when: the foreman invokes the test-writer for T
then: |
  - a `claude -p` subprocess starts with cwd = the worktree and the first
    user message carrying: T.id, T.covers with the full record text of each
    id (`sdd record get`), the path of design/verification.md, the excerpt
    of design/tech.md for T.designRefs, T.writes, {{test_cmd}},
    {{typecheck_cmd}}, {{handoff_path}} and, on rework, the rejection or
    finding text
  - the subprocess has no read access to src/ other than the stub files
    listed in the first message (prompt rule, verified by INV-003)
  - on subprocess exit the handoff is parsed per bus:CTR-007; status
    complete => task.tests_written{taskId, attempt, handoffPath, costUsd,
    inputTokens, outputTokens, durationMs}; status blocked =>
    task.failed{taskId, reason: blocked, detail: blocked_reason}
  - testWriterAttempts(T) is incremented before the subprocess starts
negative_cases:
  - handoff missing or malformed => BEH-015 (one re-run, then failed)
  - subprocess exit code non-zero without a handoff => BEH-015
  - cap exhausted => BEH-014
out_of_scope:
  - prompt wording
  - model selection
applicability:
  invariant_to_all_axes: true
data_scope: all_data
policy_refs:
  - factory:POL-001
  - factory:POL-002
test_obligation:
  predicate: |
    With a fake subprocess runner, the first message contains every item
    listed in `then`; a handoff with status complete produces exactly one
    task.tests_written whose payload carries the cost fields from the
    runner's result; a handoff with status blocked produces task.failed
    with reason blocked.
  test_template: unit
  boundary_classes:
    - first attempt
    - rework attempt with rejection text
    - blocked handoff
  failure_scenarios:
    - rework attempt without the rejection text in the first message
    - cost fields missing from the emitted payload
---
```

```yaml
---
id: build-stage:BEH-003
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
title: red check — confirm tests fail for the right reason, freeze them
given: |
  - task.tests_written{taskId: T} was emitted
when: the Verifier runs the red check in the worktree of T
then: |
  - the Verifier runs {{typecheck_cmd}} and {{test_cmd}} with the vitest
    JSON reporter and writes build-stage:CTR-002 with phase red
  - the check passes iff all of the following hold:
      a. at least one test exists in files matching T.writes under tests/
      b. every test in those files has status failed with failureKind
         assertion or thrown; zero tests passed or skipped
      c. zero load failures across the run
      d. the set of ids referenced by @covers markers in those files equals
         T.covers (no missing id, no unknown id)
      e. every file changed relative to baseSha matches a T.writes glob and
         lies under tests/
  - on pass: the test files are committed as "tests <T.id>", testsSha is
    recorded, task.tests_red{taskId, testsSha, testFiles} is emitted, lane
    state becomes impl_pending
  - on fail: task.tests_rejected{taskId, reason, detail} is emitted with
    reason vacuous (b violated by a passing test), suite_error (c
    violated), missing_covers or orphan_covers (d violated),
    outside_write_set (e violated); when several reasons apply the first
    in this order is reported and all are listed in detail
negative_cases:
  - typecheck fails because a stub signature is used wrongly => reported as
    suite_error with the tsc output in detail
  - a test file outside tests/ but inside T.writes => outside_write_set
  - zero tests => vacuous with detail "no tests"
out_of_scope:
  - judging whether the tests are semantically complete (reviewer)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: "exactly_once_with_key:(taskId,attempt)"
  time_source: monotonic
data_scope: all_data
policy_refs:
  - factory:POL-002
test_obligation:
  predicate: |
    Given a worktree fixture, a vitest JSON report and a changed-file list,
    the Verifier emits task.tests_red exactly when conditions a–e hold and
    task.tests_rejected with the first applicable reason otherwise; on
    pass the worktree head differs from baseSha and equals testsSha.
  test_template: unit
  boundary_classes:
    - all tests fail by assertion
    - one test throws, others assert
    - one test passes
    - one file fails to load
    - marker set missing one id
    - marker referencing an unknown id
    - a change under src/
  failure_scenarios:
    - a passing test is accepted as red
    - a load failure is accepted as red
    - tests committed although a marker is missing
---
```

```yaml
---
id: build-stage:BEH-004
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
title: test-writer rework — lane restart
given: |
  - task.tests_rejected{taskId: T} was emitted, or task.rework{taskId: T,
    target: test-writer} was emitted
when: the foreman handles the rework
then: |
  - if testWriterAttempts(T) <= CST-002 cap: the worktree is reset with
    `git reset --hard <baseSha>` and untracked files are removed; any
    implementer attempt counter for T is reset to 0; testsSha and implSha
    for T are cleared; lane state becomes tests_rework; BEH-002 runs with
    the rejection reason or the routed finding in the first message
  - otherwise task.failed{taskId: T, reason: cap_exhausted, detail:
    test-writer} is emitted
negative_cases:
  - reset fails (dirty worktree lock) => task.failed{reason: blocked,
    detail: worktree_error}
out_of_scope:
  - partial re-authoring of tests on top of an implementation
applicability:
  invariant_to_all_axes: true
data_scope: all_data
policy_refs:
  - factory:POL-002
test_obligation:
  predicate: |
    After task.tests_rejected on the first attempt the worktree head
    equals baseSha, no file differs from baseSha, and a second test-writer
    invocation starts; after a rejection on the second attempt
    task.failed{reason: cap_exhausted} is emitted and no subprocess starts.
  test_template: integration
  boundary_classes:
    - first rejection
    - rejection at cap
    - rework routed from reviewer after an implementation existed
  failure_scenarios:
    - implementation files survive the restart
    - implementer attempt counter not reset
---
```

```yaml
---
id: build-stage:BEH-005
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
title: implementer invocation
given: |
  - lane state for T is impl_pending (after task.tests_red) or impl_rework
    (after task.rework{target: implementer})
  - implementerAttempts(T) < CST-001 cap
when: the foreman invokes the implementer for T
then: |
  - a `claude -p` subprocess starts with a fresh context, cwd = the
    worktree, and the first user message carrying: T.id, T.covers with
    full record text, the excerpt of design/tech.md for T.designRefs, the
    list of frozen test files (read-only), T.writes, {{test_cmd}},
    {{typecheck_cmd}}, {{handoff_path}} and, on rework, the Verifier
    evidence path or the reviewer findings
  - the subprocess is allowed to run {{test_cmd}} and {{typecheck_cmd}};
    it is not allowed to run a package manager or to access the network
  - implementerAttempts(T) is incremented before the subprocess starts
  - on exit the handoff is parsed; status complete =>
    task.impl_done{taskId, attempt, handoffPath, costUsd, inputTokens,
    outputTokens, durationMs}; status finding => task.finding{taskId,
    type, specIds, detail}; status blocked => task.failed{taskId, reason:
    blocked, detail}
negative_cases:
  - handoff missing or malformed => BEH-015
  - finding.type outside the closed set => treated as malformed handoff
  - cap exhausted => BEH-014
out_of_scope:
  - prompt wording and tool permission mechanics
applicability:
  invariant_to_all_axes: true
data_scope: all_data
policy_refs:
  - factory:POL-001
  - factory:POL-002
test_obligation:
  predicate: |
    With a fake subprocess runner, the first message names the frozen test
    files and the write-set; handoff status complete emits task.impl_done
    with cost fields; status finding with type TASK-OVERFLOW emits
    task.finding with that type; an unknown finding type triggers the
    malformed-handoff path.
  test_template: unit
  boundary_classes:
    - first attempt
    - rework with Verifier evidence
    - rework with reviewer findings
    - finding handoff
  failure_scenarios:
    - attempt counter incremented only on success
    - finding type not validated
---
```

```yaml
---
id: build-stage:BEH-006
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
title: green check — typecheck, tests, frozen tests, write-set
given: |
  - task.impl_done{taskId: T} was emitted
when: the Verifier runs the green check in the worktree of T
then: |
  - the Verifier runs {{typecheck_cmd}} then {{test_cmd}} (full worktree
    suite, vitest JSON reporter) and writes build-stage:CTR-002 with phase
    green
  - testsUnchanged = `git diff --quiet <testsSha> -- <test files of T>`
    exits 0
  - writeSetOk = every file changed relative to testsSha matches a T.writes
    glob and none matches tests/**
  - the check passes iff typecheck exit 0, zero failed tests, zero load
    failures, testsUnchanged and writeSetOk
  - on pass: the changes are committed as "impl <T.id> attempt <n>",
    implSha is recorded, task.verified{taskId, result: green,
    evidencePath, testsUnchanged: true, writeSetOk: true} is emitted,
    lane state becomes review_pending
  - on fail: when testsUnchanged is false the test files are restored from
    testsSha; when writeSetOk is false every offending change is reverted
    and offending untracked files are deleted; then task.verified{taskId,
    result: red, evidencePath, testsUnchanged, writeSetOk} is emitted
negative_cases:
  - implementer added a new test file inside tests/ => writeSetOk false,
    the file is deleted before rework
  - implementer modified package.json => writeSetOk false unless
    package.json matches T.writes
out_of_scope:
  - evaluating code quality (reviewer)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: "exactly_once_with_key:(taskId,attempt)"
  time_source: monotonic
data_scope: all_data
policy_refs:
  - factory:POL-002
test_obligation:
  predicate: |
    Given fixtures for each failure axis, task.verified carries result red
    with the matching flag false and the worktree no longer contains the
    offending change; given a clean green fixture, the worktree head is a
    new commit, implSha equals it and result is green.
  test_template: unit
  boundary_classes:
    - green
    - one failing test
    - typecheck error
    - test file edited
    - file outside write-set created
    - file outside write-set modified
  failure_scenarios:
    - edited test accepted
    - green emitted while a load failure exists
    - out-of-write-set file survives into the rework
---
```

```yaml
---
id: build-stage:BEH-007
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
title: red verification routes to the implementer within the cap
given: |
  - task.verified{taskId: T, result: red} was emitted
when: the foreman routes the result
then: |
  - if implementerAttempts(T) < CST-001 cap: task.rework{taskId: T, target:
    implementer, attempt: implementerAttempts(T) + 1, reason:
    verification_red, findingPath: evidencePath} is emitted and lane state
    becomes impl_rework
  - otherwise task.failed{taskId: T, reason: cap_exhausted, detail:
    implementer} is emitted
  - no LLM participant takes part in this decision
negative_cases:
  - result green => this behaviour does not apply (BEH-012)
out_of_scope:
  - deciding whether the tests are wrong (BEH-008 via a finding)
applicability:
  invariant_to_all_axes: true
data_scope: not_applicable
policy_refs:
  - factory:POL-001
test_obligation:
  predicate: |
    Three consecutive red results on T produce two task.rework events with
    attempts 2 and 3 and then task.failed{reason: cap_exhausted}; no
    inference call is made between task.verified and task.rework.
  test_template: unit
  boundary_classes:
    - first red
    - red at cap
  failure_scenarios:
    - a fourth implementer attempt starts
    - rework emitted without findingPath
---
```

```yaml
---
id: build-stage:BEH-008
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
title: TEST-CONTRACT-CONFLICT — reviewer arbitration
given: |
  - task.finding{taskId: T, type: TEST-CONTRACT-CONFLICT, specIds} was
    emitted
when: the foreman handles the finding
then: |
  - the reviewer is invoked in arbitration mode with: the finding text, the
    frozen test files, the full record text of every id in specIds, and
    T.covers; it writes reviews/<T.id>.md with decision request_changes
    and exactly one of the targets below, or decision approve meaning the
    claim is rejected
  - target test-writer (test contradicts the record) =>
    task.rework{target: test-writer, reason: test_contract_conflict};
    BEH-004 applies
  - decision approve or target implementer (test matches the record) =>
    task.rework{target: implementer, reason: claim_rejected} with the
    reviewer rationale as findingPath; the implementer attempt that raised
    the finding counts toward CST-001
  - target contract (records contradict each other) =>
    task.rework{target: critic, reason: spec_contradiction}; the
    spec-critic mints one ASSUMPTION per affected id in
    spec/assumptions.md (spec-stage:CTR-002); afterwards every task whose
    covers intersect the affected ids receives task.rework{target:
    test-writer, reason: assumption_added} and BEH-004 applies
  - target architect => BEH-010 applies
negative_cases:
  - "the critic already minted an ASSUMPTION for one of the ids (CST-005) => task.failed{reason: cap_exhausted, detail: critic}"
  - reviewer handoff malformed => BEH-015
out_of_scope:
  - editing approved spec records (forbidden for the whole run)
applicability:
  invariant_to_all_axes: true
data_scope: all_data
policy_refs:
  - factory:POL-001
  - factory:POL-002
test_obligation:
  predicate: |
    For each of the three reviewer outcomes the matching task.rework target
    is emitted; for target contract an ASSUMPTION record appears in
    spec/assumptions.md and every task covering an affected id restarts
    from the test-writer; a second contract route on the same id fails the
    task.
  test_template: integration
  boundary_classes:
    - arbitration to test-writer
    - arbitration to implementer
    - arbitration to contract with two affected tasks
    - second contract route on the same id
  failure_scenarios:
    - the implementer attempt is not counted after a rejected claim
    - a task covering an affected id keeps its stale tests
---
```

```yaml
---
id: build-stage:BEH-009
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
title: TASK-OVERFLOW routes to the planner
given: |
  - task.finding{taskId: T, type: TASK-OVERFLOW, detail} was emitted
    (missing dependency, file owned by another task, or budget exceeded)
when: the foreman handles the finding
then: |
  - if plannerRecuts(run) < CST-003 cap: task.rework{taskId: T, target:
    planner, reason: task_overflow, findingPath} is emitted and the
    design-stage planner re-cuts design/tasks.json (design-stage
    partition); plannerRecuts(run) is incremented
  - every task whose entry changed in the re-cut (id removed, covers or
    writes changed) has its worktree removed and its lane restarted from
    BEH-001; unchanged tasks keep their lane state
  - otherwise task.failed{taskId: T, reason: cap_exhausted, detail:
    planner}
negative_cases:
  - re-cut produces a tasks.json that violates design-stage invariants =>
    design.blocked, then run.failed (design-stage partition)
out_of_scope:
  - the re-cut algorithm
applicability:
  invariant_to_all_axes: true
data_scope: all_data
policy_refs:
  - factory:POL-001
test_obligation:
  predicate: |
    A TASK-OVERFLOW on T1 triggers one planner invocation; after a re-cut
    that merges T1 and T2 into T3, the worktrees of T1 and T2 are removed,
    task.ready for T3 is emitted, and an untouched T4 keeps its state; a
    second TASK-OVERFLOW in the same run fails the task.
  test_template: integration
  boundary_classes:
    - first overflow
    - overflow after the cap
  failure_scenarios:
    - an unchanged task is restarted
    - a changed task keeps a stale worktree
---
```

```yaml
---
id: build-stage:BEH-010
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
title: VD-INFEASIBLE routes to the architect
given: |
  - task.finding{taskId: T, type: VD-INFEASIBLE, specIds} was emitted, or
    the reviewer decided target architect
when: the foreman handles the route
then: |
  - if architectRepairs(run) < CST-004 cap: task.rework{taskId: T, target:
    architect, reason: design_repair, findingPath} is emitted; the
    architect revises design/tech.md (design-stage partition);
    architectRepairs(run) is incremented
  - after the repair, every task whose designRefs or covers intersect the
    modules or ids changed in tech.md receives task.rework{target:
    test-writer, reason: design_repaired} and BEH-004 applies; stubs are
    regenerated from the revised module table during the restart
  - otherwise task.failed{taskId: T, reason: cap_exhausted, detail:
    architect}
negative_cases:
  - the revised tech.md changes a module path of a task already approved =>
    that task is also restarted (its approval is revoked, implSha cleared)
out_of_scope:
  - changing approved spec records (a contradiction routes to the critic)
applicability:
  invariant_to_all_axes: true
data_scope: all_data
policy_refs:
  - factory:POL-001
test_obligation:
  predicate: |
    After VD-INFEASIBLE on T1 the architect is invoked once; tasks whose
    designRefs intersect the changed modules restart from the test-writer
    with regenerated stubs; a second VD-INFEASIBLE in the run fails the
    task.
  test_template: integration
  boundary_classes:
    - repair touching one task
    - repair touching an approved task
    - repair after the cap
  failure_scenarios:
    - stale stubs survive the restart
    - an approved task keeps its approval after its module path changed
---
```

```yaml
---
id: build-stage:BEH-011
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
title: TOOLING-BROKEN — one re-provision, then run failure
given: |
  - task.finding{taskId: T, type: TOOLING-BROKEN, detail} was emitted, or
    the Verifier's typecheck or test command exits with a code that
    indicates a missing runner (command not found, module resolution of
    vitest or typescript failed)
when: the foreman handles the condition
then: |
  - if toolingReprovisions(run) = 0: the foreman re-runs the product
    toolchain provisioning (`npm ci` in {{product_dir}}, node_modules
    symlink refreshed in every worktree), increments
    toolingReprovisions(run), and re-invokes the role that reported the
    condition without counting an attempt
  - otherwise run.failed{stage: build, reason: tooling, detail} is emitted
negative_cases:
  - "TOOLING-BROKEN raised while the Verifier can run both commands => the finding is treated as an implementer claim and rejected: task.rework{target: implementer, reason: claim_rejected}"
out_of_scope:
  - installing dependencies not declared in design/tech.md tooling
applicability:
  invariant_to_all_axes: true
data_scope: all_data
policy_refs:
  - factory:POL-001
test_obligation:
  predicate: |
    With node_modules removed, the first TOOLING-BROKEN triggers one
    provisioning run and a re-invocation whose attempt number equals the
    previous one; a second occurrence emits run.failed{reason: tooling}.
  test_template: integration
  boundary_classes:
    - first occurrence
    - second occurrence
    - false claim with a working toolchain
  failure_scenarios:
    - attempt counted on re-provision
    - unbounded re-provision loop
---
```

```yaml
---
id: build-stage:BEH-012
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
title: reviewer invocation on green
given: |
  - task.verified{taskId: T, result: green} was emitted
when: the foreman invokes the reviewer for T
then: |
  - the reviewer runs with a fresh context and read-only inputs: the diff
    baseSha..implSha, the full record text of every id in T.covers, the
    Verifier evidence of the green run, the frozen test files, and the
    design/tech.md excerpt for T.designRefs
  - it writes {{product_dir}}/reviews/<T.id>.md per build-stage:CTR-001
    and the handoff per bus:CTR-007
  - task.reviewed{taskId, decision, target, reportPath} is emitted
  - the reviewer does not modify any file under src/ or tests/
negative_cases:
  - handoff malformed or decision/target outside the enums => BEH-015
  - report written but a blocking finding has no target => treated as
    malformed
out_of_scope:
  - running tests (the Verifier evidence is the oracle)
applicability:
  invariant_to_all_axes: true
data_scope: all_data
policy_refs:
  - factory:POL-001
  - factory:POL-002
test_obligation:
  predicate: |
    With a fake reviewer runner, the inputs listed in `then` are provided,
    reviews/<T.id>.md exists after the run with parseable frontmatter, and
    task.reviewed carries the decision and target from the frontmatter;
    the worktree diff is unchanged by the reviewer.
  test_template: unit
  boundary_classes:
    - approve
    - request_changes with target
    - advisory_only
  failure_scenarios:
    - review report missing while task.reviewed is emitted
    - reviewer changed a source file
---
```

```yaml
---
id: build-stage:BEH-013
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
title: reviewer decision routing
given: |
  - task.reviewed{taskId: T, decision, target} was emitted
when: the foreman routes the decision
then: |
  - approve => task.approved{taskId: T, implSha} and lane state approved
  - advisory_only => task.approved{taskId: T, implSha}; the findings are
    forwarded to the trace as advisory
  - request_changes with target implementer => BEH-007 path with reason
    review_changes and the report as findingPath (counts toward CST-001)
  - request_changes with target test-writer => BEH-004 path
  - request_changes with target architect => BEH-010 path
  - request_changes with target contract => the contract branch of BEH-008
  - when several blocking findings name different targets the reviewer has
    already chosen the most upstream one (contract > architect >
    test-writer > implementer); the foreman routes that single target
negative_cases:
  - request_changes with target none => treated as malformed handoff
    (BEH-015)
out_of_scope:
  - overriding the reviewer's target
applicability:
  invariant_to_all_axes: true
data_scope: not_applicable
policy_refs:
  - factory:POL-001
test_obligation:
  predicate: |
    Each decision/target combination in `then` produces exactly the listed
    follow-up event; request_changes with target none produces the
    malformed-handoff path.
  test_template: unit
  boundary_classes:
    - approve
    - advisory_only
    - each request_changes target
    - request_changes with target none
  failure_scenarios:
    - advisory findings dropped
    - approve emitted without implSha
---
```

```yaml
---
id: build-stage:BEH-014
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
title: cap exhaustion fails the task
given: |
  - a route would start an attempt beyond its cap (CST-001..CST-005)
when: the foreman evaluates the route
then: |
  - task.failed{taskId, reason: cap_exhausted, detail: <role>} is emitted
  - no further participant is invoked for the task
  - any running subprocess of the task is terminated with SIGTERM
negative_cases:
  - none
out_of_scope:
  - raising caps at runtime
applicability:
  invariant_to_all_axes: true
data_scope: not_applicable
policy_refs:
  - factory:POL-001
test_obligation:
  predicate: |
    For each cap, exceeding it by one emits task.failed with the role name
    in detail and starts no subprocess.
  test_template: unit
  boundary_classes:
    - implementer cap
    - test-writer cap
    - planner cap
    - architect cap
    - critic per-id cap
  failure_scenarios:
    - a subprocess starts after task.failed
---
```

```yaml
---
id: build-stage:BEH-015
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
title: unparseable handoff — one automatic re-run
given: |
  - a role subprocess or inference loop for T ended and the handoff file
    is missing, has no frontmatter, lacks a required key for its role, or
    holds a value outside its enum (bus:CTR-007)
when: the foreman parses the handoff
then: |
  - if handoffRetries(T, role) = 0: handoffRetries is incremented and the
    same role is re-invoked with the parse error appended to the first
    message; the role's attempt counter is not incremented
  - otherwise task.failed{taskId: T, reason: unparseable_handoff, detail:
    <role>, <parse error>} is emitted
negative_cases:
  - handoff parseable but status blocked => not this behaviour (BEH-002,
    BEH-005)
out_of_scope:
  - repairing a malformed handoff heuristically
applicability:
  invariant_to_all_axes: true
data_scope: not_applicable
policy_refs:
  - factory:POL-001
test_obligation:
  predicate: |
    A missing handoff triggers exactly one re-invocation whose first
    message contains the parse error; a second malformed handoff emits
    task.failed{reason: unparseable_handoff}; the attempt counter is
    unchanged by the retry.
  test_template: unit
  boundary_classes:
    - file missing
    - frontmatter missing
    - required key missing
    - enum violation
  failure_scenarios:
    - a third invocation
    - attempt counter incremented by the retry
---
```

```yaml
---
id: build-stage:BEH-016
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
title: a failed task fails the run
given: |
  - task.failed{taskId: T, reason} was emitted
when: the foreman handles the first task.failed of the run
then: |
  - run.failed{stage: build, reason, detail: T.id} is emitted
  - no new lane work is started
  - every running lane subprocess is terminated with SIGTERM and its
    partial state stays in its worktree for inspection
  - nothing is published
negative_cases:
  - a second task.failed after run.failed => no second run.failed
out_of_scope:
  - resuming a failed run
applicability:
  invariant_to_all_axes: true
data_scope: not_applicable
policy_refs:
  - factory:POL-001
test_obligation:
  predicate: |
    With two lanes running, task.failed on one emits a single run.failed,
    the other lane's fake subprocess receives SIGTERM, and no task.ready is
    emitted afterwards.
  test_template: integration
  boundary_classes:
    - one failure with another lane running
    - two failures in quick succession
  failure_scenarios:
    - a lane started after run.failed
    - two run.failed events
---
```

```yaml
---
id: build-stage:BEH-017
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-30T10:53:11.919Z
    change_request: participant roster
    scope: first-time-approval
partition_id: build-stage
title: lane participants join and leave with the lane
given: |
  - lane state for T allows a test-writer or implementer invocation
    (BEH-002, BEH-005)
when: the foreman invokes the test-writer or the implementer for T
then: |
  - before the `claude -p` subprocess starts, a Mozaik agent participant
    named after the role joins the runtime with capabilities
    [`lane`, `task:<T.id>`]
  - every event this invocation publishes (task.tests_written,
    task.impl_done, task.finding, task.failed{reason: blocked}) is sent by
    that participant (bus:BEH-007)
  - after the last event of the invocation the participant leaves the
    runtime; a handoff re-run (BEH-015) happens inside the same
    participant lifetime
  - lanes of independent tasks that run concurrently are represented by
    concurrently joined participants
negative_cases:
  - "the lane is cancelled while the subprocess runs (restart or termination) => the participant leaves without publishing"
  - "the subprocess fails without a handoff => task.failed{reason: unparseable_handoff} is sent by the foreman, then the participant leaves"
out_of_scope:
  - the reviewer, which is an API role with a roster participant
  - participants for the verifier runs (deterministic, foreman effects)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_global
  read_consistency: strong
  idempotency: none
  time_source: none
data_scope: not_applicable
policy_refs:
  - factory:POL-001
test_obligation:
  predicate: |
    With a fake subprocess runner that records the runtime roster while it
    runs, the roster contains a participant named test-writer with
    capability task:T-001 during the invocation and not after it; the
    published task.tests_written carries that participant's id as its
    Mozaik producerId; two concurrently scheduled independent lanes yield
    two simultaneously joined lane participants.
  test_template: integration
  boundary_classes:
    - single lane
    - two concurrent lanes
    - cancelled lane
  failure_scenarios:
    - lane participant joined once per run instead of per invocation
    - participant left before the final event was sent
---
```

```yaml
---
id: build-stage:SCN-001
type: Scenario
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
title: happy lane
initial_state: |
  design.tasks.ready emitted; task T has no dependencies; tech.md assigns
  module src/greet.ts exporting greet(name) to T; T.covers =
  [<slug>:BEH-001]; T.writes = [src/greet.ts, tests/greet.test.ts].
trigger: foreman selects T
observable_sequence:
  - "task.ready{taskId: T, baseSha}"
  - "task.tests_written{taskId: T, attempt: 1}"
  - "task.tests_red{taskId: T, testsSha}"
  - "task.impl_done{taskId: T, attempt: 1}"
  - "task.verified{taskId: T, result: green}"
  - "task.reviewed{taskId: T, decision: approve, target: none}"
  - "task.approved{taskId: T, implSha}"
ordering: strict
idempotency: "exactly_once_with_key:taskId"
retry_policy: none within this scenario
timeout: 30 minutes from task.ready to task.approved
applicability:
  invariant_to_all_axes: true
data_scope: all_data
test_obligation:
  predicate: |
    With fake test-writer, implementer and reviewer runners that write
    valid handoffs and a real Verifier on a fixture worktree, the seven
    events appear in this order and the final worktree head equals implSha
    with the test file identical to its content at testsSha.
  test_template: e2e
  boundary_classes:
    - single task
  failure_scenarios:
    - any event out of order
    - task.approved without a preceding green task.verified
---
```

```yaml
---
id: build-stage:SCN-002
type: Scenario
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
title: rework lane — red verification, retry, green, approve
initial_state: |
  As SCN-001, with an implementer runner whose first attempt leaves one
  test failing and whose second attempt makes all tests pass.
trigger: foreman selects T
observable_sequence:
  - "task.ready{taskId: T}"
  - "task.tests_written{taskId: T, attempt: 1}"
  - "task.tests_red{taskId: T}"
  - "task.impl_done{taskId: T, attempt: 1}"
  - "task.verified{taskId: T, result: red}"
  - "task.rework{taskId: T, target: implementer, attempt: 2}"
  - "task.impl_done{taskId: T, attempt: 2}"
  - "task.verified{taskId: T, result: green}"
  - "task.reviewed{taskId: T, decision: approve}"
  - "task.approved{taskId: T}"
ordering: strict
idempotency: "exactly_once_with_key:(taskId,attempt)"
retry_policy: implementer up to CST-001 attempts
timeout: 45 minutes from task.ready to task.approved
applicability:
  invariant_to_all_axes: true
data_scope: all_data
test_obligation:
  predicate: |
    The ten events appear in order; the second implementer first message
    contains the Verifier evidence path of the red run; the tests at
    task.approved are byte-identical to testsSha.
  test_template: e2e
  boundary_classes:
    - one red then green
  failure_scenarios:
    - second attempt started without evidence
    - attempt numbers not increasing
---
```

```yaml
---
id: build-stage:SCN-003
type: Scenario
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
title: test-contract conflict arbitrated to the test-writer, lane restart
initial_state: |
  As SCN-001, with an implementer runner that raises
  TEST-CONTRACT-CONFLICT on attempt 1 and a reviewer runner that decides
  request_changes with target test-writer; the second test-writer attempt
  writes correct tests and the next implementer attempt makes them pass.
trigger: foreman selects T
observable_sequence:
  - "task.ready{taskId: T, baseSha}"
  - "task.tests_written{taskId: T, attempt: 1}"
  - "task.tests_red{taskId: T}"
  - "task.finding{taskId: T, type: TEST-CONTRACT-CONFLICT}"
  - "task.reviewed{taskId: T, decision: request_changes, target: test-writer}"
  - "task.rework{taskId: T, target: test-writer}"
  - "task.tests_written{taskId: T, attempt: 2}"
  - "task.tests_red{taskId: T}"
  - "task.impl_done{taskId: T, attempt: 1}"
  - "task.verified{taskId: T, result: green}"
  - "task.reviewed{taskId: T, decision: approve}"
  - "task.approved{taskId: T}"
ordering: strict
idempotency: "exactly_once_with_key:(taskId,role,attempt)"
retry_policy: test-writer rework once (CST-002); implementer counter reset by the restart
timeout: 60 minutes from task.ready to task.approved
applicability:
  invariant_to_all_axes: true
data_scope: all_data
test_obligation:
  predicate: |
    Between task.rework{target: test-writer} and the second
    task.tests_written the worktree head equals baseSha; the implementer
    attempt after the restart is numbered 1; the twelve events appear in
    order.
  test_template: e2e
  boundary_classes:
    - one arbitration to test-writer
  failure_scenarios:
    - implementation from attempt 1 survives the restart
    - implementer attempt numbered 2 after the restart
---
```

---

## 7. Data contracts

```yaml
---
id: build-stage:CTR-001
type: Contract
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
title: review report reviews/<taskId>.md
surface_ref: build-stage:SUR-001
schema: |
  path: {{product_dir}}/reviews/<taskId>.md (published with the product)
  frontmatter (YAML between two `---` lines, first bytes of the file):
    role: reviewer                          # constant
    attempt: <int>                          # reviewer attempt for the task
    task_id: <string>
    impl_sha: <40-hex> | null               # null in arbitration mode
    mode: review | arbitration
    decision: approve | request_changes | advisory_only
    target: implementer | test-writer | architect | contract | none
    findings:
      - id: RV-<NNN>                        # unique within the file
        severity: blocking | advisory
        target: implementer | test-writer | architect | contract
        spec_ids: [<slug>:<ID>, ...]
        evidence: <string>                  # file:line or test name plus quote
  body (markdown, in this order):
    ## Scope checked
    ## Spec conformance                     # one line per id in task.covers
    ## Findings
    ## Verdict rationale
preconditions:
  - the task has a green Verifier run (mode review) or an open
    TEST-CONTRACT-CONFLICT finding (mode arbitration)
  - every spec_ids entry is an id present in spec/spec.md or
    spec/assumptions.md
postconditions:
  - decision = request_changes iff findings contains at least one entry
    with severity blocking
  - decision = approve iff findings has no blocking entry and no advisory
    entry
  - decision = advisory_only iff findings has no blocking entry and at
    least one advisory entry
  - target = none iff decision is not request_changes
  - target of a request_changes decision equals the most upstream target
    among its blocking findings in the order contract, architect,
    test-writer, implementer
  - the file is rewritten in full on every reviewer attempt
external_identifiers:
  - path pattern reviews/<taskId>.md
  - keys role, attempt, task_id, impl_sha, mode, decision, target, findings
  - enums of decision, target, severity, mode
  - finding id prefix RV-
compatibility_rules:
  - adding an optional frontmatter key => minor bump on SUR-001
  - renaming or removing a key, or changing an enum => major bump on SUR-001
error_taxonomy:
  - file missing or frontmatter missing => unparseable_handoff (BEH-015)
  - required key missing => unparseable_handoff
  - value outside an enum => unparseable_handoff
  - postcondition violated (for example request_changes without a blocking
    finding) => unparseable_handoff
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: "exactly_once_with_key:(taskId,attempt)"
  time_source: none
data_scope: all_data
policy_refs:
  - factory:POL-002
  - factory:POL-003
test_obligation:
  predicate: |
    A parser accepts the canonical example and rejects each listed error
    with the unparseable_handoff classification; the decision/findings
    consistency rules are enforced by the parser.
  test_template: contract
  boundary_classes:
    - approve without findings
    - advisory_only with one advisory finding
    - request_changes with findings of mixed targets
    - arbitration mode with impl_sha null
  failure_scenarios:
    - request_changes accepted with zero blocking findings
    - target not the most upstream blocking target
---
```

```yaml
---
id: build-stage:CTR-002
type: Contract
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
title: verifier evidence file verifier.json
surface_ref: build-stage:SUR-001
schema: |
  path: {{run_dir}}/handoffs/tasks/<taskId>/verifier-<phase>-<attempt>.json
  JSON object:
    schemaVersion: 1
    taskId: string
    attempt: int                              # attempt of the role being verified
    phase: "red" | "green"
    timestamp: ISO-8601 string
    worktree: string
    baseSha: 40-hex
    testsSha: 40-hex | null                   # null before the first passing red check
    implSha: 40-hex | null                    # set on a passing green check
    commands: [ { argv: string[], exitCode: int, durationMs: int, stdoutPath: string, stderrPath: string } ]
    vitest: { total: int, passed: int, failed: int, skipped: int, suitesFailedToLoad: int }
    tests: [ { file: string, name: string, status: "passed"|"failed"|"skipped",
               failureKind: "assertion"|"thrown"|"load"|"timeout"|"none", message: string } ]
    covers: { required: string[], found: string[], missing: string[], unknown: string[] }
    changedFiles: string[]                    # relative to the worktree root
    writeSetOk: boolean
    testsUnchanged: boolean | null            # null in phase red
    verdict: "pass" | "fail"
    reasons: string[]                         # empty on pass; red reasons or green failure axes
preconditions:
  - the commands were run in the worktree named in the file
  - secrets are redacted from stdout/stderr files (factory:POL-003)
postconditions:
  - verdict pass in phase red iff the five red conditions of BEH-003 hold
  - verdict pass in phase green iff the five green conditions of BEH-006
    hold
  - tests[] lists every test case reported by vitest; a file with a load
    failure contributes one entry with failureKind load and name "<file>"
  - the file is written before the corresponding task.tests_red,
    task.tests_rejected or task.verified event is emitted
external_identifiers:
  - path pattern verifier-<phase>-<attempt>.json
  - every key named in schema
  - enums of phase, status, failureKind, verdict
compatibility_rules:
  - adding a key => minor bump on SUR-001
  - renaming or removing a key, or changing an enum => major bump on SUR-001
error_taxonomy:
  - vitest JSON report unreadable => verdict fail, reasons ["suite_error"],
    tests [] and the raw output paths kept in commands
  - command timeout => commands[].exitCode = -1, verdict fail, reasons
    ["timeout"]
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: "exactly_once_with_key:(taskId,phase,attempt)"
  time_source: monotonic
data_scope: all_data
policy_refs:
  - factory:POL-002
  - factory:POL-003
test_obligation:
  predicate: |
    Serialising the Verifier result of each BEH-003 and BEH-006 fixture
    yields a document that validates against the schema, with verdict and
    reasons matching the fixture; a vitest report with a load failure
    yields one tests[] entry with failureKind load.
  test_template: contract
  boundary_classes:
    - red pass
    - red fail each reason
    - green pass
    - green fail each axis
    - unreadable report
  failure_scenarios:
    - verdict pass with a non-empty reasons list
    - load failure missing from tests[]
---
```

---

## 8. Invariants

```yaml
---
id: build-stage:INV-001
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
title: tests are frozen after the red check
always: |
  For every task T in state approved, every file matching T.writes under
  tests/ has, at T.implSha, byte-identical content to the same file at
  T.testsSha.
scope: build-stage lanes
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
  - an implementer edit to a test file is reverted before any rework and
    never reaches implSha
  - a test file added by the implementer is deleted before any rework
out_of_scope:
  - test files of other tasks
test_obligation:
  predicate: |
    For every approved task in an end-to-end fixture run, `git diff
    <testsSha> <implSha> -- <test files>` is empty; a fixture implementer
    that edits a test never reaches task.approved with that edit.
  test_template: integration
  boundary_classes:
    - untouched tests
    - edited test
    - added test file
  failure_scenarios:
    - approved implSha with a differing test file
---
```

```yaml
---
id: build-stage:INV-002
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
title: implementer changes stay inside the write-set
always: |
  For every task T, every path changed between T.testsSha and T.implSha
  matches at least one glob of T.writes and matches no glob under tests/.
scope: build-stage lanes
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
  - a change outside the write-set is reverted and the attempt is routed as
    red; it never reaches implSha
out_of_scope:
  - files created by the scaffold commit (part of baseSha)
test_obligation:
  predicate: |
    For every approved task in a fixture run, the changed-path list of
    testsSha..implSha is a subset of the write-set and disjoint from
    tests/; a fixture implementer writing src/other/file.ts outside its
    write-set never reaches task.approved with that file.
  test_template: integration
  boundary_classes:
    - inside write-set
    - outside write-set
    - path under tests/
  failure_scenarios:
    - implSha containing an out-of-write-set path
---
```

```yaml
---
id: build-stage:INV-003
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
title: the test-writer never reads implementation files
never: |
  The tool-call log of a test-writer subprocess contains a read, search or
  listing operation whose target path lies under src/ other than the stub
  files named in the first message.
scope: build-stage test-writer invocations
evidence: test_probe
stability: internal
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: none
  time_source: none
negative_cases:
  - a read of a stub file named in the first message is allowed
  - a read of spec/, design/ or tests/ is allowed
out_of_scope:
  - the implementer, which reads src/ freely
test_obligation:
  predicate: |
    The stream-json tool-call records captured from a test-writer run are
    scanned; any Read, Grep, Glob or Bash invocation targeting a non-stub
    path under src/ is reported as a violation and recorded in the trace;
    the fixture run with a compliant transcript reports zero violations.
  test_template: integration
  boundary_classes:
    - compliant transcript
    - transcript reading src/index.ts
    - transcript reading a stub
  failure_scenarios:
    - a violation not recorded in the trace
---
```

```yaml
---
id: build-stage:INV-004
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
title: attempts never exceed caps
always: |
  For every task T: implementerAttempts(T) <= CST-001 cap,
  testWriterAttempts(T) <= 1 + CST-002 cap; for the run:
  plannerRecuts <= CST-003 cap, architectRepairs <= CST-004 cap, and for
  every spec id at most CST-005 ASSUMPTION records are minted by the
  critic through the contract route.
scope: build-stage lanes and routes
evidence: test_probe
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_global
  read_consistency: strong
  idempotency: none
  time_source: none
negative_cases:
  - a retry caused by BEH-015 (unparseable handoff) or BEH-011
    (re-provision) does not increment an attempt counter
out_of_scope:
  - caps of other partitions
test_obligation:
  predicate: |
    Counting events in the trace of each fixture run, the number of
    task.rework{target: implementer} for a task never exceeds cap - 1, the
    number of test-writer invocations never exceeds 1 + cap, and runs that
    hit a cap end with task.failed{reason: cap_exhausted}.
  test_template: integration
  boundary_classes:
    - at cap
    - one past cap
  failure_scenarios:
    - an attempt beyond a cap
---
```

```yaml
---
id: build-stage:INV-005
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
title: approval only after a green Verifier run on the approved commit
always: |
  For every task.approved{taskId: T, implSha}, a verifier.json exists for T
  with phase green, verdict pass and implSha equal to the event's implSha,
  written before the event; and task.reviewed for T with decision approve
  or advisory_only was emitted after that evidence.
scope: build-stage lanes
evidence: test_probe
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: none
  time_source: monotonic
negative_cases:
  - an approve decision in arbitration mode (impl_sha null) never produces
    task.approved
out_of_scope:
  - assembly-level verification (assembly-stage)
test_obligation:
  predicate: |
    For every task.approved in a fixture trace, the matching green
    verifier.json exists with an earlier timestamp and the same implSha;
    an arbitration approve produces no task.approved.
  test_template: integration
  boundary_classes:
    - normal approval
    - arbitration approve
  failure_scenarios:
    - task.approved whose implSha differs from the evidence
---
```

```yaml
---
id: build-stage:INV-006
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
title: independent ready tasks run concurrently
always: |
  When two or more tasks become ready within the same routing step, their
  first test-writer subprocesses overlap in time: the start timestamp of
  each is earlier than the end timestamp of every other.
scope: build-stage lanes
evidence: test_probe
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_global
  read_consistency: strong
  idempotency: none
  time_source: monotonic
negative_cases:
  - tasks ordered by dependsOn do not overlap
out_of_scope:
  - a configured concurrency limit lower than the number of ready tasks
test_obligation:
  predicate: |
    With two independent tasks and fake subprocesses lasting 200 ms each,
    the trace shows both task.tests_written events less than 400 ms after
    the first task.ready, and the subprocess start/end intervals overlap.
  test_template: integration
  boundary_classes:
    - two independent tasks
    - two dependent tasks
  failure_scenarios:
    - serial execution of independent tasks
---
```

---

## 9. External dependencies

```yaml
---
id: build-stage:EXT-001
type: ExternalDependency
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
title: Claude Code CLI as lane subprocess
provider: Anthropic Claude Code CLI (`claude`)
provider_surface: "claude@2.1.x (observed 2.1.312 on 2026-10-29)"
authority_url_or_doc: https://docs.claude.com/en/docs/claude-code/cli-reference
interface: |
  argv: claude --print --output-format stream-json --verbose
        --permission-mode bypassPermissions --add-dir <worktree>
        [--model <id>]; prompt on stdin; cwd = worktree
  stream: newline-delimited JSON; the final message has type "result"
  with fields is_error, total_cost_usd, usage.input_tokens,
  usage.output_tokens, duration_ms; tool invocations appear as
  assistant messages with content[].type == "tool_use"
consumer_contract: |
  The lane wrapper reads only: process exit code, the "result" message
  (is_error, total_cost_usd, usage, duration_ms) and tool_use records for
  INV-003. The role's outputs are files in the worktree and the handoff;
  stdout text is not interpreted.
drift_detection:
  mechanism: "none_with_review_by:2026-10-31"
last_verified_at: "2026-10-29"
auth_scope: ANTHROPIC_API_KEY or an interactive login already present in the operator's HOME; never written to any run file
rate_limits: provider-enforced; a result with is_error true and a rate-limit message is retried once after 30 s without counting an attempt
retry_idempotency: re-invocation is safe because every attempt starts from a known worktree commit (baseSha or testsSha)
error_taxonomy:
  - exit code non-zero without a result message => handoff treated as missing (BEH-015)
  - result.is_error true => handoff treated as missing (BEH-015) unless rate-limited (one retry)
  - no output for longer than the lane step timeout => subprocess killed, handoff treated as missing
failure_modes:
  - CLI not on PATH => TOOLING-BROKEN path (BEH-011)
  - stream-json shape changed => cost fields absent; the lane still routes on the handoff and the tracer records cost as unknown
fallback_policy: no alternative provider; the run fails after the retry budget
test_obligation:
  predicate: |
    A recorded stream-json transcript fixture is parsed into exit code,
    cost, tokens, duration and tool_use records; a fixture without a result
    message is classified as missing handoff; a rate-limited fixture
    triggers exactly one retry.
  test_template: contract
  boundary_classes:
    - complete transcript
    - transcript without result
    - rate-limited result
  failure_scenarios:
    - cost parsed from a non-result message
---
```

```yaml
---
id: build-stage:EXT-002
type: ExternalDependency
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
title: vitest JSON reporter
provider: vitest (test runner of the product)
provider_surface: "vitest@3 JSON reporter (version pinned by the product scaffold package.json)"
authority_url_or_doc: https://vitest.dev/guide/reporters#json-reporter
interface: |
  argv: npx vitest run --reporter=json --outputFile=<path>
  report: numTotalTests, numPassedTests, numFailedTests, numPendingTests,
  testResults[] { name, status, message, assertionResults[] { fullName,
  status, failureMessages[] } }
consumer_contract: |
  The Verifier derives vitest.total/passed/failed/skipped from the
  top-level counters, classifies a testResults[] entry with status failed
  and an empty assertionResults[] as a load failure, and classifies a
  failed assertionResults[] entry as assertion when failureMessages[0]
  starts with "AssertionError" or contains "expected", otherwise as thrown;
  "Test timed out" classifies as timeout.
drift_detection:
  mechanism: contract_test_against_sandbox
last_verified_at: "2026-10-29"
retry_idempotency: read-only consumption; re-running the command is safe
error_taxonomy:
  - report file missing or not JSON => suite_error (CTR-002)
  - exit code 1 with a readable report => failures taken from the report
sandbox_or_fixture: tests/fixtures/vitest-report-*.json recorded from the pinned version
failure_modes:
  - reporter schema changed => Verifier mis-classifies; detected by the fixture contract test at CI
fallback_policy: none; the pinned version is part of the product scaffold
test_obligation:
  predicate: |
    For each recorded fixture report (all pass, assertion failure, thrown
    error, load failure, timeout) the Verifier classification equals the
    expected failureKind per test.
  test_template: contract
  boundary_classes:
    - each fixture
  failure_scenarios:
    - load failure classified as assertion
---
```

---

## 10. Generated artifacts

none

---

## 11. Localization

none

---

## 12. Policies

none in this partition; every boundary record inherits factory:POL-001, factory:POL-002 and factory:POL-003 through the Partition default_policy_set.

---

## 13. Constraints

```yaml
---
id: build-stage:CST-001
type: Constraint
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
title: implementer attempts per task
constraint: implementerAttempts(T) for any task T is at most 3 (OQ-001).
rationale: |
  Bounds cost and wall-clock inside the two-hour hidden-spec window; a
  third red result signals a test or design problem that retrying the
  same role will not fix.
test_obligation:
  predicate: |
    The configured cap equals 3 unless overridden by factory configuration;
    BEH-007 and BEH-014 tests use the configured value.
  test_template: unit
  boundary_classes:
    - default configuration
  failure_scenarios:
    - fourth attempt observed
---
```

```yaml
---
id: build-stage:CST-002
type: Constraint
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
title: test-writer rework per task
constraint: a task's tests are re-authored at most once (OQ-002); the second rejection or second routed test-writer rework fails the task.
rationale: |
  Every re-authoring discards the implementation; a second failure means
  the task's spec ids or design excerpt are not specific enough for a
  blind test author, which a third attempt will not repair.
test_obligation:
  predicate: |
    The configured cap equals 1; BEH-004 tests use the configured value.
  test_template: unit
  boundary_classes:
    - default configuration
  failure_scenarios:
    - third test-writer invocation for one task
---
```

```yaml
---
id: build-stage:CST-003
type: Constraint
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
title: planner re-cut per run
constraint: the planner re-cuts design/tasks.json at most once per run (OQ-003).
rationale: |
  A re-cut restarts every changed lane; two re-cuts would double the
  worst-case lane cost of the run.
test_obligation:
  predicate: |
    The configured cap equals 1; BEH-009 tests use the configured value.
  test_template: unit
  boundary_classes:
    - default configuration
  failure_scenarios:
    - second re-cut in one run
---
```

```yaml
---
id: build-stage:CST-004
type: Constraint
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
title: architect repair per run
constraint: design/tech.md is repaired by the architect at most once per run (OQ-004).
rationale: |
  A repair restarts every lane whose modules changed; a second repair
  indicates the approved spec and the design disagree in a way the run
  cannot settle without a spec change.
test_obligation:
  predicate: |
    The configured cap equals 1; BEH-010 tests use the configured value.
  test_template: unit
  boundary_classes:
    - default configuration
  failure_scenarios:
    - second repair in one run
---
```

```yaml
---
id: build-stage:CST-005
type: Constraint
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
title: one critic ASSUMPTION per spec id
constraint: through the contract route of BEH-008 the spec-critic mints at most one ASSUMPTION record per spec id per run (OQ-005).
rationale: |
  Approved records are immutable within a run; a second assumption on the
  same id would mean the first interpretation was wrong, which only a
  spec change outside the run can settle.
test_obligation:
  predicate: |
    A second contract route naming an id that already has an ASSUMPTION
    from this run emits task.failed{reason: cap_exhausted, detail: critic}.
  test_template: unit
  boundary_classes:
    - first assumption
    - second assumption on the same id
  failure_scenarios:
    - two ASSUMPTION records for one id in one run
---
```

```yaml
---
id: build-stage:CST-006
type: Constraint
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
title: lane coding roles run as isolated subprocesses with a per-invocation cost report
constraint: |
  The test-writer and the implementer execute as separate operating-system
  subprocesses of the Claude Code CLI (EXT-001), one invocation per
  attempt, each starting with an empty conversation, and each reporting
  total_cost_usd, token usage and duration that the lane attaches to its
  task.tests_written or task.impl_done event.
rationale: |
  Transcript isolation between the test author and the implementer is the
  property that makes the red check meaningful; per-invocation cost is
  required for the per-task time-and-cost trace the hackathon judges on.
test_obligation:
  predicate: |
    Two consecutive attempts of the same role for one task are two distinct
    subprocess invocations; the implementer's first message never contains
    the test-writer transcript; every task.tests_written and task.impl_done
    payload carries costUsd and durationMs.
  test_template: integration
  boundary_classes:
    - two attempts of one role
    - test-writer then implementer
  failure_scenarios:
    - shared conversation between roles
    - event without cost fields
---
```

---

## 14. Migrations

none

---

## 15. Deltas

none

---

## 16. Implementation bindings

none (greenfield; bindings are added once the implementation exists)

---

## 17. Open questions

```yaml
---
id: build-stage:OQ-001
type: Open-Q
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
question: |
  How many implementer attempts per task should the lane allow before
  failing the task?
options:
  - id: a
    label: three
    consequence: |
      Bounded cost; a design or test defect surfaces after two retries.
  - id: b
    label: five
    consequence: |
      More tolerance for flaky model output; worst-case lane cost grows by
      two full implementer invocations.
blocking: no
owner: sdd-factory
default_if_unresolved: a
---
```

```yaml
---
id: build-stage:OQ-002
type: Open-Q
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
question: |
  How many times should a task's tests be re-authored (lane restart)
  before the task fails?
options:
  - id: a
    label: once
    consequence: |
      One restart; a second rejection fails the task quickly.
  - id: b
    label: twice
    consequence: |
      Two restarts; doubles the worst case of a lane with bad tests.
blocking: no
owner: sdd-factory
default_if_unresolved: a
---
```

```yaml
---
id: build-stage:OQ-003
type: Open-Q
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
question: |
  How many planner re-cuts should a run allow?
options:
  - id: a
    label: one
    consequence: |
      One re-cut; the second overflow fails the run.
  - id: b
    label: two
    consequence: |
      Two re-cuts; up to two restarts of every changed lane.
blocking: no
owner: sdd-factory
default_if_unresolved: a
---
```

```yaml
---
id: build-stage:OQ-004
type: Open-Q
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
question: |
  How many architect repairs of design/tech.md should a run allow?
options:
  - id: a
    label: one
    consequence: |
      One repair; the second infeasibility fails the run.
  - id: b
    label: two
    consequence: |
      Two repairs; up to two restarts of every affected lane.
blocking: no
owner: sdd-factory
default_if_unresolved: a
---
```

```yaml
---
id: build-stage:OQ-005
type: Open-Q
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
question: |
  How many ASSUMPTION records per spec id should the critic be allowed to
  mint through the contract route in one run?
options:
  - id: a
    label: one
    consequence: |
      One interpretation per id; a second contradiction fails the task.
  - id: b
    label: unbounded
    consequence: |
      The critic can keep reinterpreting; risk of an endless
      interpretation loop inside the run.
blocking: no
owner: sdd-factory
default_if_unresolved: a
---
```

```yaml
---
id: build-stage:OQ-006
type: Open-Q
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
question: |
  Should a task with dependsOn start only after its dependencies are
  approved and merged (level barrier), or should every task start at once
  from the same base and rely on the design contract?
options:
  - id: a
    label: level_barrier
    consequence: |
      Dependents compile against real dependencies; less parallelism when
      the DAG is deep.
  - id: b
    label: all_at_once
    consequence: |
      Maximal parallelism; dependents cannot typecheck imports of modules
      that do not exist yet, so every dependent lane would fail its green
      check until assembly.
blocking: no
owner: sdd-factory
default_if_unresolved: a
---
```

---

## 18. Assumptions

```yaml
---
id: build-stage:ASM-001
type: ASSUMPTION
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
assumption: |
  design/tech.md (design-stage:CTR-001) fixes, for every task's designRefs,
  the module file paths under src/ and the exported names with their
  signatures, so that the foreman can scaffold throwing stubs before the
  test-writer starts and the test-writer and implementer agree on import
  paths without seeing each other's work.
source_open_q: null
blocking: no
review_by: "2026-10-30"
default_if_unresolved: keep_assumption
tests:
  - tests/build-stage/lane-start.test.ts § "scaffolds stubs from tech.md module table"
---
```

```yaml
---
id: build-stage:ASM-002
type: ASSUMPTION
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.198Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: build-stage
assumption: |
  The vitest JSON reporter reports a test file that failed to import or
  compile as a testResults[] entry with status failed, an empty
  assertionResults[] and a non-empty message, which is what the Verifier
  uses to tell a load failure from an execution failure.
source_open_q: null
blocking: no
review_by: "2026-10-30"
default_if_unresolved: keep_assumption
tests:
  - tests/build-stage/verifier-classify.test.ts § "load failure fixture"
---
```

---

## 19. Out of scope

- Human review or approval of any lane artefact during a run.
- Pull requests, code hosting reviews, CI systems outside the factory.
- Resuming a half-finished lane in a later run; every run starts its lanes
  from scratch.
- Products in languages other than TypeScript or with test runners other
  than vitest.
- Editing approved product spec records during a run (contradictions
  become ASSUMPTION records).
- Choosing or switching the language model behind a role.
