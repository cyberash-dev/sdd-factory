# sdd-factory — assembly-stage partition

> Version 0.1.0. Every record in this file is `lifecycle.status: proposed`
> and becomes implementable only after a human owner runs `sdd approve`
> followed by `sdd finalize`. The partition owns what happens after the
> last task is approved: ancestry check of the `integration` branch, the
> verification sequence, attribution of failures back to lanes, triage of
> unattributable failures, the rework-round cap, and the hand-over to
> publication.

---

## 1. Context

Integration is progressive: the foreman (factory partition) merges each
approved task branch into the `integration` branch on `task.approved`, so
by the time the last task is approved the branch already contains every
lane's work. The assembler therefore does not build the product from
pieces; it verifies that nothing is missing, runs the whole product
through a clean install, typecheck, test run and the `sdd ready` gate on
`integration`, and only then hands over to publication as specified by
`factory:CTR-004`.

When verification fails, the assembler routes the failure back to the
lane that owns it. Attribution is deterministic wherever a failing test
file carries a `@covers` marker: the marker names a spec id, and
`design/tasks.json` names the task that covers it. Only failures without
such a marker (install or compile errors, `sdd ready` violations that do
not name a task) reach the triage participant, a cheap language-model
role that returns one route. Rounds are capped; the run fails rather
than loops.

The assembler adds no source. Every byte under `src/` and `tests/` in the
published tree comes out of a lane, which is what makes the trace an
honest account of who produced what.

---

## 2. Glossary

- **Integration branch** — the git branch `integration` in
  `{{product_dir}}` that the foreman advances on every `task.approved`.
- **Ancestry check** — the test that a task's `implSha` is reachable from
  the `integration` head (`git merge-base --is-ancestor`).
- **Straggler** — an approved task whose `implSha` is not yet an ancestor
  of `integration` when assembly starts.
- **Verification sequence** — the ordered commands `npm ci`,
  `npx tsc --noEmit`, `npx vitest run --reporter=json`,
  `npx sdd ready --format=json`, executed on the integration branch.
- **Attribution** — mapping a failing test file to the task whose
  `covers` contains the spec id named by the file's `@covers` marker.
- **Round** — one pass through ancestry check, verification sequence and,
  on failure, the rework it triggers; round 1 is the first pass.
- **Triage** — the language-model participant that classifies an
  unattributable failure into one route.
- **Route** — a target role plus a task id (or null) that receives the
  failure as a rework.
- **Assembly report** — `assembly/report.md`, the record of every round,
  committed on the integration branch before publication.
- **Publication** — the copy of the integration tree and the trace into
  `hidden/<slug>/` of the team repository, as contracted by
  `factory:CTR-004`.
- **Task** — an entry of `design/tasks.json` (`design-stage:CTR-003`).

---

## 3. Partition

```yaml
---
id: assembly-stage
type: Partition
partition_id: assembly-stage
owner_team: sdd-factory
gate_scope:
  - assembly-stage
dependencies_on_other_partitions:
  - bus:SUR-001
  - bus:SUR-002
  - design-stage:SUR-001
  - build-stage:SUR-001
  - factory:SUR-002
  - trace:SUR-001
  - factory:POL-001
  - factory:POL-002
  - factory:POL-003
default_policy_set:
  - factory:POL-001
  - factory:POL-002
  - factory:POL-003
id_namespace: assembly-stage
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
id: assembly-stage:SUR-001
type: Surface
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.521Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: assembly-stage
name: assembly-files
version: "0.2.0"
boundary_type: public_storage
members:
  - assembly-stage:CTR-001
consumer_compat_policy: semver_per_surface
notes: |
  The assembly report is committed on the integration branch and
  therefore published with the product; judges and the tracer read it.
---
```

---

## 6. Requirements

```yaml
---
id: assembly-stage:BEH-001
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.521Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: assembly-stage
title: barrier — assembly starts when every task is approved
given: |
  - design/tasks.json lists tasks T1..Tn
  - no run.failed has been emitted
when: the last task.approved arrives so that every Ti is in state approved
then: |
  - assembly.started{taskOrder} is emitted exactly once per round, where
    taskOrder is a topological order of tasks by dependsOn
  - round = 1 on the first start; later starts carry the round number
    reached through BEH-004..BEH-006
negative_cases:
  - at least one task not yet approved => no event
  - a task.failed was emitted => assembly never starts (build-stage
    BEH-016 fails the run)
out_of_scope:
  - partial assembly of a subset of tasks
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: "exactly_once_with_key:(runId,round)"
  time_source: monotonic
data_scope: all_data
policy_refs:
  - factory:POL-001
test_obligation:
  predicate: |
    With three tasks, assembly.started is emitted only after the third
    task.approved and carries a taskOrder in which every task appears
    after all of its dependsOn; a run with a task.failed never emits
    assembly.started.
  test_template: unit
  boundary_classes:
    - all approved
    - one pending
    - one failed
  failure_scenarios:
    - assembly.started before the last approval
    - taskOrder violating dependsOn
---
```

```yaml
---
id: assembly-stage:BEH-002
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.521Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: assembly-stage
title: ancestry check and straggler merge
given: |
  - assembly.started{taskOrder} was emitted
when: the assembler walks taskOrder
then: |
  - for each task T in taskOrder: if T.implSha is an ancestor of the
    integration head the task is recorded as skipped_ancestor; otherwise
    T.implSha is merged into integration with a fast-forward when
    possible and a merge commit otherwise, recorded as fast_forward or
    merged
  - a merge that reports a conflict is aborted (`git merge --abort`),
    recorded as conflict, and assembly.triaged{taskId: T, target:
    planner, reason: write_set_conflict} followed by assembly.rework{round,
    taskId: T, target: planner} are emitted; the foreman forwards this as
    task.rework{taskId: T, target: planner, reason: write_set_conflict}
    (build-stage BEH-009)
  - after the walk without conflict the assembler continues with BEH-003
negative_cases:
  - every task already an ancestor (the normal case with progressive
    integration) => no merge commit is created
  - "implSha of a task missing from the repository => run.failed{stage: assembly, reason: missing_commit, detail: T.id}"
out_of_scope:
  - resolving conflicts by editing files (forbidden by factory:POL-002)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: "exactly_once_with_key:(runId,round)"
  time_source: monotonic
data_scope: all_data
policy_refs:
  - factory:POL-002
test_obligation:
  predicate: |
    On a fixture repository where two tasks are already ancestors and one
    is not, the walk records skipped_ancestor twice and merged or
    fast_forward once and the head afterwards contains all three; on a
    fixture with a conflicting straggler the merge is aborted, the
    working tree is clean, and assembly.rework{target: planner} is
    emitted.
  test_template: integration
  boundary_classes:
    - all ancestors
    - one straggler fast-forward
    - one straggler conflict
  failure_scenarios:
    - conflict markers left in the working tree
    - merge commit created for an ancestor
---
```

```yaml
---
id: assembly-stage:BEH-003
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.521Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: assembly-stage
title: verification sequence on the integration branch
given: |
  - BEH-002 finished without conflict
  - {{product_dir}} is checked out at the integration head with a clean
    working tree
when: the assembler runs the verification sequence
then: |
  - the commands run in this order, each on the integration checkout:
      1. install:   npm ci                 (dependencies are those declared
                                            in package.json, which the
                                            foreman populated from
                                            design/tech.md tooling)
      2. typecheck: npx tsc --noEmit
      3. test:      npx vitest run --reporter=json --outputFile=<path>
      4. sdd_ready: npx sdd ready --format=json
  - after each command assembly.verified{result, step, evidencePath,
    failingCovers} is emitted; result green when the exit code is 0 (for
    sdd_ready: ok true), otherwise red
  - the sequence stops at the first red step
  - failingCovers lists, for step test, the @covers ids found in every
    failing test file; for step sdd_ready, the ids named by uncovered and
    orphan_covers violations; otherwise an empty list
  - every command's stdout and stderr are captured to files under
    {{run_dir}}/handoffs/assembly/round-<n>/ with secrets redacted
  - when all four steps are green the assembler writes the assembly
    report (CTR-001), commits it on integration as "assembly report round
    <n>", and emits assembly.verified{result: green, step: sdd_ready} as
    the last event of the sequence
negative_cases:
  - network unavailable during npm ci => red at step install, routed
    through BEH-005 (EXT-001 fallback is tried first)
  - vitest exit 0 but the JSON report shows a load failure => treated as
    red at step test
out_of_scope:
  - running the product (black-box scenarios are a later stretch)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: "exactly_once_with_key:(runId,round)"
  time_source: monotonic
data_scope: all_data
policy_refs:
  - factory:POL-002
  - factory:POL-003
test_obligation:
  predicate: |
    With a fake command runner scripted per step, the emitted
    assembly.verified events match the scripted exit codes, the sequence
    stops at the first non-zero step, failingCovers equals the markers of
    the failing files in the fixture report, and on an all-green script
    the report commit exists on integration.
  test_template: unit
  boundary_classes:
    - all green
    - red at install
    - red at typecheck
    - red at test with two failing files
    - red at sdd_ready with an uncovered id
  failure_scenarios:
    - a later step runs after a red step
    - failingCovers empty for a failing test file that carries a marker
---
```

```yaml
---
id: assembly-stage:BEH-004
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.521Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: assembly-stage
title: attributed test failure routes to the owning lane's implementer
given: |
  - assembly.verified{result: red, step: test, failingCovers} was emitted
  - every failing test file carries at least one @covers marker whose id
    is covered by exactly one task in design/tasks.json
  - round <= CST-001 cap
when: the assembler attributes the failures
then: |
  - for every distinct owning task T: assembly.rework{round, taskId: T,
    target: implementer} is emitted and the foreman forwards it as
    task.rework{taskId: T, target: implementer, reason: assembly_red,
    findingPath: <evidencePath>} (build-stage BEH-005 path; the attempt
    counts toward build-stage CST-001)
  - the rework carries the failing test names and messages for T's files
  - each routed lane runs implementer, green check and reviewer again;
    when every routed task is approved again (and merged by the foreman),
    BEH-001 starts round + 1
negative_cases:
  - a failing file whose marker id is covered by no task => BEH-005
    (unattributable)
  - a failing file with markers of two different tasks => both tasks are
    routed
out_of_scope:
  - re-running only the failing files (the whole sequence runs again next
    round)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_global
  read_consistency: strong
  idempotency: "exactly_once_with_key:(runId,round,taskId)"
  time_source: monotonic
data_scope: all_data
policy_refs:
  - factory:POL-001
  - factory:POL-002
test_obligation:
  predicate: |
    Given a fixture report with failing files owned by T1 and T2, exactly
    two assembly.rework events are emitted (one per task) with target
    implementer, and after both tasks report task.approved a second
    assembly.started with round 2 is emitted.
  test_template: integration
  boundary_classes:
    - one owning task
    - two owning tasks
    - file with markers of two tasks
  failure_scenarios:
    - rework emitted twice for one task in one round
    - round 2 started before every routed task is approved
---
```

```yaml
---
id: assembly-stage:BEH-005
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.521Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: assembly-stage
title: unattributable failure goes to triage
given: |
  - assembly.verified{result: red, step} was emitted and at least one
    failure cannot be attributed by BEH-004 or BEH-006: step install or
    typecheck, a failing test file without a usable @covers marker, or an
    sdd ready violation that names no task
  - round <= CST-001 cap
when: the assembler invokes triage
then: |
  - the triage participant receives: the captured stdout/stderr of the red
    step, the failing file names, design/tasks.json, and the list of
    tasks; it writes a handoff (bus:CTR-007, role triage) with route
    {task_id, target: implementer | test-writer | planner, reason}
  - assembly.triaged{taskId, target, reason} is emitted, then
    assembly.rework{round, taskId, target} which the foreman forwards as
    task.rework with reason triage
  - task_id null with target planner means a cross-task problem (for
    example two tasks exporting the same symbol); the planner re-cut path
    of build-stage BEH-009 applies
  - after the routed lanes are approved again, BEH-001 starts round + 1
negative_cases:
  - triage handoff malformed => one re-run, then run.failed{stage:
    assembly, reason: unparseable_handoff}
  - triage names a task_id not in tasks.json => treated as malformed
out_of_scope:
  - triage editing any file
applicability:
  invariant_to_all_axes: true
data_scope: all_data
policy_refs:
  - factory:POL-001
  - factory:POL-002
test_obligation:
  predicate: |
    With a fake triage runner returning route {T2, implementer}, the
    events assembly.triaged and assembly.rework carry T2 and implementer;
    a route naming an unknown task triggers the malformed path; a
    typecheck failure fixture invokes triage exactly once.
  test_template: unit
  boundary_classes:
    - typecheck failure
    - test file without marker
    - unknown task in route
  failure_scenarios:
    - triage invoked for an attributable failure
---
```

```yaml
---
id: assembly-stage:BEH-006
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.521Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: assembly-stage
title: sdd ready violations route by ownership
given: |
  - assembly.verified{result: red, step: sdd_ready, failingCovers} was
    emitted
  - round <= CST-001 cap
when: the assembler maps the violations
then: |
  - uncovered <id> => the task whose covers contains <id> receives
    assembly.rework{round, taskId, target: test-writer} (the lane
    restarts per build-stage BEH-004 so that a marker for <id> is written)
  - orphan_covers or unknown_partition_covers in file F => the task whose
    writes match F receives assembly.rework{round, taskId, target:
    test-writer}
  - unapproved <id> => run.failed{stage: assembly, reason: spec_gate,
    detail: <id>} (the spec gate of the spec-stage was bypassed; this is
    a factory defect, not a lane defect)
  - aggregated_lint or aggregated_check => BEH-005 (triage)
negative_cases:
  - an uncovered id covered by no task => BEH-005
out_of_scope:
  - editing spec records to silence a violation
applicability:
  invariant_to_all_axes: true
data_scope: all_data
policy_refs:
  - factory:POL-001
  - factory:POL-002
test_obligation:
  predicate: |
    Given an sdd ready JSON fixture with one uncovered id owned by T1 and
    one orphan marker in a file written by T3, two assembly.rework events
    with target test-writer are emitted for T1 and T3; an unapproved
    violation emits run.failed{reason: spec_gate}.
  test_template: unit
  boundary_classes:
    - uncovered
    - orphan_covers
    - unapproved
    - aggregated_lint
  failure_scenarios:
    - uncovered routed to the implementer
---
```

```yaml
---
id: assembly-stage:BEH-007
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.521Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: assembly-stage
title: round cap fails the run
given: |
  - a red assembly.verified occurred in round r and r = CST-001 cap
when: the assembler would start rework for round r + 1
then: |
  - run.failed{stage: assembly, reason: cap_exhausted, detail: round r} is
    emitted
  - no assembly.rework is emitted
  - nothing is published
negative_cases:
  - r < cap => BEH-004..BEH-006 apply
out_of_scope:
  - raising the cap at runtime
applicability:
  invariant_to_all_axes: true
data_scope: not_applicable
policy_refs:
  - factory:POL-001
test_obligation:
  predicate: |
    With the cap at 2, a red result in round 2 emits run.failed{reason:
    cap_exhausted} and no assembly.rework; a red result in round 1 emits
    assembly.rework.
  test_template: unit
  boundary_classes:
    - round 1 red
    - round 2 red
  failure_scenarios:
    - a third round
---
```

```yaml
---
id: assembly-stage:BEH-008
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.521Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: assembly-stage
title: hand-over to publication on green
given: |
  - assembly.verified{result: green, step: sdd_ready} was emitted and the
    assembly report commit is the integration head
when: the assembler hands over
then: |
  - the publication specified by factory:CTR-004 is performed from the
    integration head: the product tree (without .git and node_modules),
    the assembly report and the trace directory are placed under
    hidden/<slug>/ in the team repository and committed; push follows
    unless the run was started with --no-push
  - run.published{commitSha, outputDir, pushed} is emitted after the
    commit in the team repository exists
  - the trace directory copied is the trace as of the moment before the
    commit; run.published itself is appended only to the run-directory
    trace
negative_cases:
  - "push rejected by the remote => run.published{pushed: false}; the run still counts as produced and the operator's manual push is recorded as human.intervention{kind: mid_run_nudge}"
  - any red step => no publication (INV-003)
out_of_scope:
  - the layout of hidden/<slug>/ (factory:CTR-004)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: "exactly_once_with_key:runId"
  time_source: monotonic
data_scope: new_writes_only
policy_refs:
  - factory:POL-002
  - factory:POL-003
test_obligation:
  predicate: |
    After an all-green round on a fixture, hidden/<slug>/ exists in a
    temporary team repository with package.json, src/, tests/,
    assembly/report.md and trace/trace.jsonl, a commit containing it
    exists, and run.published carries that commit sha; with a fake remote
    that rejects the push, pushed is false.
  test_template: integration
  boundary_classes:
    - push accepted
    - push rejected
    - --no-push
  failure_scenarios:
    - run.published before the commit exists
    - node_modules copied
---
```

```yaml
---
id: assembly-stage:SCN-001
type: Scenario
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.521Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: assembly-stage
title: green assembly end-to-end
initial_state: |
  Three tasks approved and merged progressively by the foreman; the
  integration head contains all three implShas; the product installs,
  typechecks, passes its tests and passes sdd ready.
trigger: the third task.approved
observable_sequence:
  - "assembly.started{taskOrder: [T1, T2, T3]}"
  - "assembly.verified{result: green, step: install}"
  - "assembly.verified{result: green, step: typecheck}"
  - "assembly.verified{result: green, step: test}"
  - "assembly.verified{result: green, step: sdd_ready}"
  - "run.published{commitSha, outputDir: hidden/<slug>/}"
ordering: strict
idempotency: "exactly_once_with_key:runId"
retry_policy: none
timeout: 15 minutes from assembly.started to run.published
applicability:
  invariant_to_all_axes: true
data_scope: all_data
test_obligation:
  predicate: |
    On the fixture product the six events appear in order within the
    timeout and the published tree passes `npm ci && npm test` in a fresh
    copy.
  test_template: e2e
  boundary_classes:
    - three tasks, no stragglers
  failure_scenarios:
    - an assembly.rework in a green run
---
```

```yaml
---
id: assembly-stage:SCN-002
type: Scenario
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.521Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: assembly-stage
title: one failing attributed test fixed within one round
initial_state: |
  As SCN-001, except that tests/cli/parse.test.ts (written by T1,
  @covers <slug>:CTR-001) fails on integration because T2 changed a shared
  export signature; T1's implementer fixes the usage on its rework.
trigger: the last task.approved
observable_sequence:
  - "assembly.started{taskOrder}"
  - "assembly.verified{result: green, step: install}"
  - "assembly.verified{result: green, step: typecheck}"
  - "assembly.verified{result: red, step: test, failingCovers: [<slug>:CTR-001]}"
  - "assembly.rework{round: 1, taskId: T1, target: implementer}"
  - "task.rework{taskId: T1, target: implementer, reason: assembly_red}"
  - "task.verified{taskId: T1, result: green}"
  - "task.reviewed{taskId: T1, decision: approve}"
  - "task.approved{taskId: T1}"
  - "assembly.started{taskOrder}"
  - "assembly.verified{result: green, step: install}"
  - "assembly.verified{result: green, step: typecheck}"
  - "assembly.verified{result: green, step: test}"
  - "assembly.verified{result: green, step: sdd_ready}"
  - "run.published{commitSha}"
ordering: strict
idempotency: "exactly_once_with_key:(runId,round)"
retry_policy: one assembly round of rework (CST-001 allows two)
timeout: 40 minutes from the first assembly.started to run.published
applicability:
  invariant_to_all_axes: true
data_scope: all_data
test_obligation:
  predicate: |
    With a fake implementer runner that fixes the usage on its second
    invocation, the fifteen events appear in order; no triage invocation
    occurs; the published tree contains T1's fix.
  test_template: e2e
  boundary_classes:
    - one attributed failure
  failure_scenarios:
    - triage invoked for an attributed failure
    - publication of the tree from round 1
---
```

---

## 7. Data contracts

```yaml
---
id: assembly-stage:CTR-001
type: Contract
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.521Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: assembly-stage
title: assembly report assembly/report.md
surface_ref: assembly-stage:SUR-001
schema: |
  path: {{product_dir}}/assembly/report.md, committed on the integration
  branch before publication and therefore present in hidden/<slug>/
  frontmatter (YAML between two `---` lines):
    run_id: <string>
    slug: <string>
    rounds: <int>                                  # rounds executed
    verdict: published | failed
    task_order: [<taskId>, ...]
    merges:
      - { round: <int>, task_id: <taskId>, impl_sha: <40-hex>,
          result: fast_forward | merged | skipped_ancestor | conflict }
    verification:
      - { round: <int>, step: install | typecheck | test | sdd_ready,
          argv: [<string>], exit_code: <int>, duration_ms: <int>,
          result: green | red, evidence_path: <string> }
    sdd_ready: { ok: <bool>, violations: [ { kind: <string>, id: <string>, file: <string> } ] }
    triage:
      - { round: <int>, task_id: <taskId> | null,
          target: implementer | test-writer | planner, reason: <string> }
    reworks:
      - { round: <int>, task_id: <taskId>, target: implementer | test-writer | planner,
          source: attribution | triage | sdd_ready }
    published: { commit_sha: <40-hex> | null, output_dir: <string>, pushed: <bool> } | null
  body (markdown): one section per round with the command summaries and
  the failing test names, then a final "Published" or "Failed" section.
preconditions:
  - written only by the assembler, after the verification sequence of the
    current round completed (green) or the run failed in assembly
postconditions:
  - verdict published iff every verification entry of the last round is
    green and published.commit_sha is not null
  - every assembly.rework event of the run has exactly one reworks entry
  - every assembly.triaged event has exactly one triage entry
  - secrets are absent from every string (factory:POL-003)
external_identifiers:
  - path assembly/report.md
  - every frontmatter key named in schema and the enums of result, step,
    target, source, verdict
compatibility_rules:
  - adding a key => minor bump on SUR-001
  - renaming or removing a key, or changing an enum => major bump on SUR-001
error_taxonomy:
  - report cannot be written (disk error) => run.failed{stage: assembly,
    reason: report_write_error}
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: "exactly_once_with_key:(runId,round)"
  time_source: monotonic
data_scope: new_writes_only
policy_refs:
  - factory:POL-002
  - factory:POL-003
test_obligation:
  predicate: |
    The report written after each fixture run (green, one attributed
    rework, triage rework, cap failure) validates against the schema and
    its reworks and triage lists equal the corresponding events in the
    trace of that run.
  test_template: contract
  boundary_classes:
    - published after round 1
    - published after round 2
    - failed at the cap
  failure_scenarios:
    - verdict published with a red verification entry in the last round
    - a rework event missing from reworks
---
```

---

## 8. Invariants

```yaml
---
id: assembly-stage:INV-001
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.521Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: assembly-stage
title: the assembler adds no source
never: |
  A commit authored by the assembler on the integration branch changes a
  path under src/ or tests/; the only files the assembler creates are
  assembly/report.md and, for a straggler merge, the merge commit whose
  tree equals the merge of the two parents without manual edits.
scope: assembly-stage
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
  - a merge conflict is aborted, never resolved by editing
out_of_scope:
  - commits authored by lanes
test_obligation:
  predicate: |
    For every commit on integration after the last task.approved of a
    fixture run, `git show --stat` lists no path under src/ or tests/
    except in merge commits whose tree equals `git merge-tree` of the
    parents.
  test_template: integration
  boundary_classes:
    - report commit
    - straggler fast-forward
    - straggler merge commit
  failure_scenarios:
    - assembler commit touching src/
---
```

```yaml
---
id: assembly-stage:INV-002
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.521Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: assembly-stage
title: the published tree equals the verified integration tree plus trace
always: |
  For every run.published{commitSha}: every file under hidden/<slug>/
  other than trace/** is byte-identical to the file at the same relative
  path in the integration head that passed the verification sequence,
  and every tracked file of that head except .git and node_modules is
  present under hidden/<slug>/.
scope: assembly-stage and factory:CTR-004
evidence: public_api
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
  - a file edited after verification never reaches hidden/<slug>/
out_of_scope:
  - the content of trace/**
test_obligation:
  predicate: |
    After a fixture publication, a recursive diff between `git archive
    <integration head>` and hidden/<slug>/ (ignoring trace/) is empty in
    both directions.
  test_template: integration
  boundary_classes:
    - product with nested directories
  failure_scenarios:
    - extra file in hidden/<slug>/
    - missing file in hidden/<slug>/
---
```

```yaml
---
id: assembly-stage:INV-003
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.521Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: assembly-stage
title: publication only after a fully green verification sequence
always: |
  run.published is emitted only after, in the same round, assembly.verified
  reported green for every step install, typecheck, test and sdd_ready on
  the integration head that is published.
scope: assembly-stage
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
  - a green round whose head changed before publication => the sequence
    runs again on the new head before publication
out_of_scope:
  - the organisers' acceptance tests
test_obligation:
  predicate: |
    In every fixture trace, the four green assembly.verified events of the
    final round precede run.published, and the published commit's product
    tree hash equals the tree hash of the head those events ran on.
  test_template: integration
  boundary_classes:
    - green on round 1
    - green on round 2
  failure_scenarios:
    - run.published after a red step
---
```

```yaml
---
id: assembly-stage:INV-004
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.521Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: assembly-stage
title: rounds never exceed the cap
always: |
  The number of assembly.started events in a run is at most CST-001 cap,
  and a run with a red result in the last allowed round ends with
  run.failed{reason: cap_exhausted}.
scope: assembly-stage
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
  - none
out_of_scope:
  - lane-level caps (build-stage)
test_obligation:
  predicate: |
    A fixture whose tests keep failing produces exactly cap
    assembly.started events and then run.failed{reason: cap_exhausted}.
  test_template: integration
  boundary_classes:
    - persistent failure
  failure_scenarios:
    - cap + 1 rounds
---
```

```yaml
---
id: assembly-stage:INV-005
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.521Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: assembly-stage
title: the published product is self-contained
always: |
  In a fresh copy of hidden/<slug>/ with no node_modules, the commands
  `npm ci` and `npm test` exit 0 without any file from the factory
  repository outside that directory.
scope: assembly-stage and factory:CTR-004
evidence: public_api
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
  - a product depending on a path outside its directory fails this
    invariant and is not published (the verification sequence runs in the
    product directory only)
out_of_scope:
  - network availability of the npm registry at the consumer's side
test_obligation:
  predicate: |
    Copying a published fixture product to a temporary directory and
    running `npm ci && npm test` there exits 0.
  test_template: e2e
  boundary_classes:
    - CLI product
    - HTTP API product
  failure_scenarios:
    - missing package-lock.json
    - test script referencing a path outside the product
---
```

---

## 9. External dependencies

```yaml
---
id: assembly-stage:EXT-001
type: ExternalDependency
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.521Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: assembly-stage
title: npm registry for the clean install
provider: npm public registry (registry.npmjs.org)
provider_surface: "npm CLI 11.x `npm ci` against the registry HTTP API"
authority_url_or_doc: https://docs.npmjs.com/cli/v11/commands/npm-ci
interface: |
  `npm ci` reads package.json and package-lock.json, downloads every
  locked package from the registry (or the local cache) and exits 0 on
  success, non-zero otherwise.
consumer_contract: |
  The assembler runs `npm ci --prefer-offline --no-audit --no-fund` and
  reads only the exit code and the captured output; on a network error
  it retries once with `--offline`, which succeeds when every package is
  already in the local cache from the foreman's provisioning.
drift_detection:
  mechanism: "none_with_review_by:2026-10-31"
last_verified_at: "2026-10-29"
retry_idempotency: the command npm ci is idempotent; the retry with --offline is safe
error_taxonomy:
  - exit code non-zero with ENOTFOUND, ECONNRESET or ETIMEDOUT in output => network failure, one offline retry, then red at step install
  - exit code non-zero otherwise => red at step install (lockfile or dependency problem) routed through triage
failure_modes:
  - registry unreachable and cache incomplete => red at step install
rate_limits: not_applicable (registry rate limits are not reached by one install per round)
auth_scope: not_applicable (public packages only)
fallback_policy: the offline retry; no alternative registry
test_obligation:
  predicate: |
    With a fake command runner that fails the first `npm ci` with
    ENOTFOUND, a second invocation with --offline is issued; when both
    fail, assembly.verified{result: red, step: install} is emitted once.
  test_template: unit
  boundary_classes:
    - online success
    - network failure then offline success
    - both fail
  failure_scenarios:
    - unbounded install retries
---
```

```yaml
---
id: assembly-stage:EXT-002
type: ExternalDependency
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.521Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: assembly-stage
title: git remote of the team repository for the push
provider: GitHub (git over HTTPS or SSH)
provider_surface: "git push to origin, git 2.x protocol"
authority_url_or_doc: https://git-scm.com/docs/git-push
interface: |
  `git push origin <branch>` exits 0 when the remote accepted the ref
  update, non-zero on rejection, authentication failure or network
  failure.
consumer_contract: |
  The publication step reads only the exit code; on non-zero it emits
  run.published{pushed: false} and prints the exact command for the
  operator to run; it never retries with --force.
drift_detection:
  mechanism: "none_with_review_by:2026-10-31"
last_verified_at: "2026-10-29"
auth_scope: the operator's existing git credentials; never read or stored by the factory
retry_idempotency: a repeated push of the same commit is idempotent; the factory does not retry automatically
error_taxonomy:
  - non-fast-forward rejection => pushed false; the operator rebases and pushes (logged as human.intervention)
  - authentication failure => pushed false
  - network failure => pushed false
failure_modes:
  - remote unavailable => pushed false
rate_limits: not_applicable
fallback_policy: manual push by the operator, recorded as human.intervention
test_obligation:
  predicate: |
    With a fake command runner that returns exit 1 for git push,
    run.published carries pushed false and no second push is attempted.
  test_template: unit
  boundary_classes:
    - push ok
    - push rejected
  failure_scenarios:
    - automatic force push
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
id: assembly-stage:CST-001
type: Constraint
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.521Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: assembly-stage
title: assembly rework rounds per run
constraint: a run executes at most 2 assembly rounds (OQ-001); a red result in round 2 fails the run.
rationale: |
  Each round re-runs lanes and the whole verification sequence; two rounds
  fit the two-hour hidden-spec window with time left for a full restart.
test_obligation:
  predicate: |
    The configured cap equals 2 unless overridden by factory configuration;
    BEH-007 and INV-004 tests use the configured value.
  test_template: unit
  boundary_classes:
    - default configuration
  failure_scenarios:
    - third round observed
---
```

```yaml
---
id: assembly-stage:CST-002
type: Constraint
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.521Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: assembly-stage
title: merges are fast-forward or clean only
constraint: |
  The assembler performs merges only when git completes them without
  conflict markers; a conflicting merge is aborted and routed to the
  planner, never resolved by editing files.
rationale: |
  factory:POL-002 forbids the assembler from adding source; conflict
  resolution is source authoring. Disjoint write-sets make conflicts a
  planning defect.
test_obligation:
  predicate: |
    On a fixture with a conflicting straggler, after BEH-002 the working
    tree has no conflict markers and `git status` is clean.
  test_template: integration
  boundary_classes:
    - conflicting straggler
  failure_scenarios:
    - conflict resolved by the assembler
---
```

```yaml
---
id: assembly-stage:CST-003
type: Constraint
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.521Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: assembly-stage
title: sdd ready is a mandatory step of the verification sequence
constraint: |
  The verification sequence includes `npx sdd ready --format=json` on the
  integration branch and treats ok false as red; publication without an
  sdd ready pass is forbidden.
rationale: |
  The product spec is the oracle of the run; sdd ready is the
  implementation-valid gate of the methodology and proves every approved
  id has a test marker.
test_obligation:
  predicate: |
    Removing the sdd_ready step from the configured sequence fails the
    factory's own configuration test; a fixture with ok false never
    publishes.
  test_template: unit
  boundary_classes:
    - ok true
    - ok false
  failure_scenarios:
    - publication with ok false
---
```

---

## 14. Migrations

none

---

## 15. Deltas

```yaml
id: assembly-stage:DLT-001
type: Delta
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-30T19:08:13.518Z
    change_request: "run 11: task graph size, stub imports, reviewer fallback, multi-lane resume, simple-fixer"
    scope: first-time-approval
partition_id: assembly-stage
title: assembly-files 0.1.0 -> 0.2.0 - mechanical red steps go to the simple-fixer before triage
target_ids:
  - assembly-stage:BEH-003
  - assembly-stage:BEH-005
  - assembly-stage:CTR-001
kind: replace
compatibility_action: ignore
baseline_version: factory:BL-001@v0.1.0
surface_impact:
  - id: assembly-stage:SUR-001
    intended_version: "0.2.0"
description: |
  A typecheck error or a test file that fails to load on the integration
  branch is a mechanical defect of the merged tree, yet today it goes to
  triage and back to a lane for a full rework round. factory:BEH-012
  inserts the simple-fixer in front of assembly-stage:BEH-005.
  assembly-stage:BEH-003: when a step ends red with trigger
  assembly_install (exit code not 0 and not NETWORK_FAILURE),
  assembly_typecheck, or assembly_load_failure (load failures with zero
  failed tests) and simpleFixes(assembler, run) is below factory:CST-005,
  the foreman invokes the fixer in the integration checkout (allowed
  paths: every file outside tests/** and spec/**); on outcome fixed the
  changes are committed on integration as "fix assembly round <n> <k>"
  with author simple-fixer and the sequence restarts at step install in
  the same round; assembly.verified{result: red} for the repaired step is
  published only when the fixer is exhausted. assembly-stage:BEH-005 is
  then entered as before. assembly-stage:INV-001 holds: the assembler
  authors none of the fix commits.
  assembly-stage:CTR-001 report frontmatter gains
  `fixes: [{round, attempt, trigger, outcome, commit_sha | null, files}]`
  and the round section of the body lists each fix with its trigger and
  outcome; assembly-stage:SUR-001 0.1.0 -> 0.2.0.
tests_old_behavior:
  - a red test step with failed assertions still routes by attribution (BEH-004) or triage (BEH-005) without a fixer run; NETWORK_FAILURE at install still takes the offline fallback
tests_new_behavior:
  - to:factory:BEH-012
  - to:assembly-stage:CTR-001
test_obligation:
  predicate: |
    With a scripted command runner whose first typecheck fails and passes
    after a fake fixer edit under src/, the integration branch carries a
    commit "fix assembly round 1 1" authored simple-fixer, the sequence
    runs install, typecheck, test and sdd_ready again, no assembly.triaged
    is published and the report frontmatter lists one fix with outcome
    fixed; with a fixer that never repairs, two fix.attempted events
    precede assembly.verified{result: red, step: typecheck} and triage.
  test_template: unit
  boundary_classes:
    - typecheck fixed on the first run
    - typecheck unfixed at the cap
    - failed assertion (no fixer)
  failure_scenarios:
    - fix commit authored by the assembler
    - triage invoked before the fixer cap
```

---

## 16. Implementation bindings

none (greenfield; bindings are added once the implementation exists)

---

## 17. Open questions

```yaml
---
id: assembly-stage:OQ-001
type: Open-Q
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.521Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: assembly-stage
question: |
  How many assembly rounds should a run allow before failing?
options:
  - id: a
    label: two
    consequence: |
      One rework round; a persistent integration failure fails the run
      within the hidden window.
  - id: b
    label: three
    consequence: |
      Two rework rounds; up to two extra verification sequences and lane
      reworks per run.
blocking: no
owner: sdd-factory
default_if_unresolved: a
---
```

```yaml
---
id: assembly-stage:OQ-002
type: Open-Q
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.521Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: assembly-stage
question: |
  When a failing test file carries markers of two tasks, should both
  tasks be routed, or only the task whose write-set contains the file?
options:
  - id: a
    label: both_tasks
    consequence: |
      Both implementers see the failure; one of the reworks is redundant
      when the fault lies in one task.
  - id: b
    label: file_owner_only
    consequence: |
      Cheaper; the real culprit is missed when the failure comes from the
      other task's module.
blocking: no
owner: sdd-factory
default_if_unresolved: a
---
```

---

## 18. Assumptions

```yaml
---
id: assembly-stage:ASM-001
type: ASSUMPTION
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:43.521Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: assembly-stage
assumption: |
  The organisers' acceptance harness runs the published product with
  `npm ci` followed by `npm test` (or an equivalent that depends only on
  package.json scripts) inside hidden/<slug>/, so a self-contained tree
  whose own test suite passes is the right definition of done.
source_open_q: null
blocking: no
review_by: "2026-10-31"
default_if_unresolved: keep_assumption
tests:
  - tests/assembly-stage/self-contained.test.ts § "npm ci && npm test in a fresh copy"
---
```

---

## 19. Out of scope

- Pull requests, code review on a hosting platform, deployment of the
  product.
- Rolling back or amending a published commit.
- Assembling several products in one run.
- Black-box execution of the product against Scenario records (a later
  stretch owned by a validator role, not by the assembler).
- The layout of hidden/<slug>/ and the commit message, which
  factory:CTR-004 fixes.
