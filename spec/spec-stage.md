# sdd-factory — spec-stage partition

> Single source of truth for the `spec-stage` partition of `sdd-factory`:
> how an arbitrary Markdown spec becomes an approved agent-sdd product spec
> without a human in the loop — spec-analyst, spec-critic, the lint loop and
> the files they exchange.
>
> **v0.1.0** — every record is `lifecycle.status: proposed`. Promotion to
> `approved` requires a human `sdd approve` + `sdd finalize`; the authoring
> agent cannot self-approve (SDD §7.5).

---

## 1. Context

The hackathon hands the factory a Markdown spec written by someone else, in
an unknown shape. Every downstream role must read the same thing from it, so
the first stage rewrites it into the typed, lint-checked agent-sdd format:
one partition named after the spec, records with stable IDs, a test
obligation on every normative record, every ambiguity an `Open-Q` with a
default, every default an `ASSUMPTION`.

Two LLM roles do this. The spec-analyst (artel stages 1, 3 and 4b) drafts
the spec and runs `sdd lint` in a loop until it is clean. The spec-critic
(artel stage 4a) reads the draft with a fresh context, finds gaps and
conflicts and decides every open question; the analyst applies those
decisions. The foreman then executes the pre-authorised approval
(factory:BEH-003). After approval the approved records are frozen for the
rest of the run; later findings become advisory `ASSUMPTION` records in a
sandbox file that `sdd ready` tolerates.

---

## 2. Glossary

- **Source spec** — the Markdown file given at launch (`{{spec_source_path}}`).
- **Product spec** — `spec/spec.md` in the product repo, single partition
  `<slug>`.
- **Record** — one YAML block with `id`, `type`, `lifecycle` as parsed by
  agent-sdd.
- **Lint cycle** — one `sdd lint --format=json` run followed by edits.
- **Critic round** — one spec-critic invocation; round 1 finds, round 2
  verifies application.
- **Finding** — one `GA-NNN` entry in `spec/review/ga.md`.
- **Decision** — a critic resolution of an `Open-Q` by choosing an option.
- **Assumption file** — `spec/assumptions.md`, listed in
  `partitions.<slug>.sandbox_paths`.
- **Freeze** — the state after `spec.approved`: approved records are not
  edited within the run.

---

## 3. Partition

```yaml
---
id: spec-stage
type: Partition
partition_id: spec-stage
owner_team: sdd-factory
gate_scope:
  - spec-stage
dependencies_on_other_partitions:
  - bus:SUR-001
  - bus:SUR-002
  - factory:POL-001
  - factory:POL-002
  - factory:POL-003
default_policy_set:
  - factory:POL-001
  - factory:POL-002
  - factory:POL-003
id_namespace: spec-stage
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
id: spec-stage:SUR-001
type: Surface
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.546Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: spec-stage
name: product-spec-files
version: "0.2.0"
boundary_type: public_storage
members:
  - spec-stage:CTR-001
  - spec-stage:CTR-002
  - spec-stage:CTR-003
consumer_compat_policy: semver_per_surface
notes: |
  Consumed by the design stage, the build lanes (spec records by ID), the
  assembler (`sdd ready`) and by judges reading the published tree.
---
```

---

## 6. Requirements

```yaml
---
id: spec-stage:BEH-001
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.546Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: spec-stage
title: spec-analyst drafts the product spec from the source spec
given: |
  - `workspace.ready{productDir, slug}` was emitted
  - `spec/spec.md` contains the 19 headings, the Partition record and
    `<slug>:BL-001` written by the foreman
when: the spec-analyst handles `workspace.ready`
then: |
  - the analyst reads the source spec and writes records into
    `spec/spec.md` per spec-stage:CTR-001, leaving the Partition and
    BL-001 records untouched
  - every ambiguity in the source becomes an `Open-Q` with `blocking: no`,
    at least two options with consequences and a `default_if_unresolved`
  - every default taken becomes an `ASSUMPTION` referencing its Open-Q
  - the analyst runs `sdd lint --format=json` and repairs diagnostics until
    the exit code is 0, within the lint-cycle cap (spec-stage:CST-001)
  - the analyst writes `handoffs/spec-analyst/handoff.md` with status
    `complete` and `lint_exit: 0`; the foreman emits `spec.drafted{attempt,
    lintExit:0, recordCounts}`
negative_cases:
  - lint still failing after the cap => handoff status blocked with
    blocked_reason lint_cap => spec.blocked with reason lint_cap
  - the source spec describes neither a CLI nor an HTTP API => handoff
    status blocked with blocked_reason unsupported_product_kind
  - handoff missing or malformed => one automatic re-run, then
    `spec.blocked{reason:"analyst_blocked"}`
out_of_scope:
  - interviewing a human (artel intake questions are replaced by Open-Q
    defaults)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: none
  time_source: none
data_scope: new_writes_only
policy_refs:
  - factory:POL-001
  - factory:POL-002
test_obligation:
  predicate: |
    Given a fixture source spec for a CLI and a fake model that returns a
    canned draft with two lint errors on the first cycle and a clean draft
    on the second, the stage emits spec.drafted with attempt 1 and
    lintExit 0, spec/spec.md parses with sdd lint exit 0, and the Partition
    and BL-001 blocks are byte-identical to what the foreman wrote.
  test_template: integration
  boundary_classes:
    - clean on first cycle
    - clean on second cycle
    - never clean (cap)
    - unsupported product kind
  failure_scenarios:
    - analyst overwriting the Partition record
    - spec.drafted emitted with lintExit 1
---
```

```yaml
---
id: spec-stage:BEH-002
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.546Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: spec-stage
title: spec-critic reviews the draft with a fresh context and decides every open question
given: |
  - `spec.drafted` was emitted for round r (r = 1 or 2)
when: the spec-critic handles `spec.drafted`
then: |
  - the critic reads only `spec/spec.md` and the source spec; it never
    receives the analyst's transcript or handoff body
  - round 1: it writes `spec/review/ga.md` (spec-stage:CTR-003) with
    findings of kinds gap, conflict, weasel, untestable, missing_negative,
    unmodeled_term, and for every `Open-Q` a decision: the chosen option
    id, the rationale, and the ASSUMPTION record body the analyst must add
  - the critic writes its handoff with `decision: accept` when no finding
    has resolution decide (findings with resolution assume confirm an
    existing default and need no edit), otherwise `decision: rework`
  - round 2: it only checks that every round-1 finding was applied and
    every decision materialised; it opens no new finding; `decision` is
    `accept` when all are applied, otherwise `rework` with the unapplied
    finding ids
  - the foreman emits `spec.reviewed{round, decision, findingsPath}`;
    `rework` emits `spec.rework{round, findingsPath}` for the analyst
negative_cases:
  - two records contradict each other and no option reconciles them =>
    finding kind conflict with resolution decide and a chosen reading;
    the analyst applies it; the contradiction never reaches approval
  - round 2 returns `rework` => `spec.blocked{reason:"critic_cap"}`
  - the critic edits spec.md directly => the foreman detects a changed
    spec.md tree hash after the critic and emits
    `spec.blocked{reason:"critic_wrote_spec"}`
out_of_scope:
  - product decisions requiring a human (none exist by construction, the
    critic always decides)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: none
  time_source: none
data_scope: new_writes_only
policy_refs:
  - factory:POL-001
  - factory:POL-002
test_obligation:
  predicate: |
    With a draft containing one undecided Open-Q and one Contract without
    error_taxonomy, round 1 yields decision rework, ga.md with two
    findings and one decision; after the analyst applies them, round 2
    yields accept and spec.reviewed{round:2, decision:"accept"}.
  test_template: integration
  boundary_classes:
    - clean draft (accept in round 1)
    - findings applied (accept in round 2)
    - findings not applied (critic cap)
    - critic writes spec.md
  failure_scenarios:
    - round 2 opening a new finding
    - critic given the analyst transcript
---
```

```yaml
---
id: spec-stage:BEH-003
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.546Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: spec-stage
title: spec-analyst applies critic decisions surgically
given: |
  - `spec.rework{round, findingsPath}` was emitted
when: the spec-analyst handles `spec.rework`
then: |
  - the analyst reads ga.md and edits only the records named by
    `target_ids` of each finding plus the records it must add
    (ASSUMPTION bodies supplied by the critic, new negative cases, new
    Open-Q closures)
  - record IDs are never changed or reused; a statement the critic marks
    superseded is rewritten in place under its id; no record is deleted
    and no lifecycle other than proposed is written (lint requires a human
    approval record for removed)
  - every decided Open-Q keeps status proposed and gains exactly one
    ASSUMPTION in section 18 whose `source_open_q` names it
  - `sdd lint` exits 0 before the handoff; the handoff carries attempt
    = round + 1
negative_cases:
  - a finding names an unknown target id => the analyst records it in the
    handoff body as `unapplied` and continues; the critic's round 2 then
    returns rework for it
out_of_scope:
  - re-reading the source spec for new scope
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
    Applying a ga.md with findings on BEH-002 and CTR-001 changes only
    those two records and adds the listed ASSUMPTION; every other record's
    YAML is byte-identical before and after.
  test_template: integration
  boundary_classes:
    - two targeted findings
    - finding with unknown target id
  failure_scenarios:
    - unrelated record rewritten
    - record id renumbered
---
```

```yaml
---
id: spec-stage:BEH-004
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.546Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: spec-stage
title: approved records are frozen; later findings become sandbox assumptions
given: |
  - `spec.approved` was emitted
when: any role later needs a decision on an approved record (reviewer
  target `contract`, `task.rework{target:"critic"}`)
then: |
  - the spec-critic is invoked in assumption mode with the conflicting
    record ids and the finding; it appends one `ASSUMPTION` record
    (`blocking: no`, `review_by` = the run date, `tests` naming the lane
    tests) to `spec/assumptions.md` (spec-stage:CTR-002) choosing one
    reading
  - `spec/spec.md` is not modified
  - the foreman emits `task.rework{target:"test-writer"}` for every task
    whose `covers` intersects the affected ids
negative_cases:
  - a second request for the same record id => task.failed with reason
    cap_exhausted and detail "critic assumption cap" (spec-stage:CST-003)
out_of_scope:
  - Delta records; the run never evolves an approved record
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: exactly_once_with_key:specId
  time_source: wall_clock:1s
data_scope: new_writes_only
policy_refs:
  - factory:POL-001
  - factory:POL-002
test_obligation:
  predicate: |
    After spec.approved, a task.rework{target:"critic"} for BEH-003 adds
    exactly one ASSUMPTION to spec/assumptions.md, leaves spec/spec.md
    byte-identical, keeps sdd lint exit 0 and sdd ready free of
    `unapproved` violations, and re-emits task.ready for the owning task.
  test_template: integration
  boundary_classes:
    - first assumption on an id
    - second assumption on the same id
  failure_scenarios:
    - spec.md modified after approval
    - assumption written outside sandbox_paths
---
```

```yaml
---
id: spec-stage:SCN-001
type: Scenario
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.546Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: spec-stage
title: source spec to approved product spec in two critic rounds
initial_state: workspace.ready emitted; spec/spec.md holds headings, Partition and BL-001
trigger: workspace.ready
observable_sequence:
  - spec.drafted{attempt:1, lintExit:0}
  - spec.reviewed{round:1, decision:"rework"}
  - spec.rework{round:1}
  - spec.drafted{attempt:2, lintExit:0}
  - spec.reviewed{round:2, decision:"accept"}
  - spec.approved{mode:"pre-authorized-at-launch"}
ordering: strict
idempotency: none
retry_policy: none beyond the caps in section 13
timeout: 20 minutes of wall clock for the whole stage, after which spec.blocked{reason:"stage_timeout"}
applicability:
  invariant_to_all_axes: true
test_obligation:
  predicate: |
    With fakes producing one round of findings, trace.jsonl contains the
    six events above in this order and no other spec.* event.
  test_template: integration
  boundary_classes:
    - one rework round
  failure_scenarios:
    - spec.approved before spec.reviewed accept
---
```

---

## 7. Data contracts

```yaml
---
id: spec-stage:CTR-001
type: Contract
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.546Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: spec-stage
title: product spec file spec/spec.md and its configuration
surface_ref: spec-stage:SUR-001
schema:
  spec_file: spec/spec.md
  sections: the 19 agent-sdd headings in order, `none` where empty
  partition: "<slug>"
  records:
    Partition: id <slug>, default_policy_set non-empty, unmodeled_budget {current 0}
    BrownfieldBaseline: id <slug>:BL-001, written by the foreman
    Surface: exactly one, boundary_type cli or api, members = every Contract id, version "0.1.0"
    Contract: one per command, endpoint or file format; fields surface_ref, schema, preconditions, postconditions, external_identifiers, compatibility_rules, error_taxonomy, applicability, concurrency_model, data_scope, policy_refs
    Behavior: given, when, then, negative_cases, out_of_scope, applicability, concurrency_model, data_scope, policy_refs; surface_ref when observable at the boundary
    Invariant: always or never, scope, evidence, stability, data_scope, applicability, concurrency_model, negative_cases, out_of_scope
    Scenario: initial_state, trigger, observable_sequence, ordering, idempotency, retry_policy, timeout, applicability
    NFR: only with a measurable target in the source; metric, target, verification_obligation {verification_stage ci_unit|ci_integration, artefact}
    Constraint: stack (TypeScript, node >= 22, vitest, no network, dependency list)
    Policy: at least POL-001 error reporting and POL-002 input validation
    Open-Q: question, options (>= 2 with consequence), blocking no, owner spec-critic, default_if_unresolved
    ASSUMPTION: assumption, source_open_q, blocking no, review_by, default_if_unresolved keep_assumption, tests, partition_id
    test_obligation: on every normative record; predicate, test_template, boundary_classes, failure_scenarios
  id_prefixes: [SUR, CTR, BEH, INV, SCN, NFR, CST, POL, OQ, ASM, BL]
  config:
    path: .sdd/config.json
    spec_file: spec/spec.md
    baseline_id: "<slug>:BL-001"
    discovery_scope: [src, tests, package.json, tsconfig.json]
    mechanism: git_tree_hash_v1
    partitions.<slug>.spec_paths: [spec/spec.md]
    partitions.<slug>.test_paths: ["tests/**/*.test.ts", "src/**/*.test.ts"]
    partitions.<slug>.sandbox_paths: [spec/assumptions.md]
preconditions:
  - the product repo exists with the foreman's first commit
postconditions:
  - sdd lint --format=json exits 0 on spec.drafted and after approval
  - after spec.approved every normative record has lifecycle.status approved and an approval_record with approver_identity equal to the operator
external_identifiers:
  - file paths spec/spec.md and .sdd/config.json
  - record id grammar <slug>:<PREFIX>-NNN
compatibility_rules:
  - changing a required record field or the config shape => major bump on spec-stage:SUR-001
error_taxonomy:
  - "lint diagnostics (rule ids sdd:*) are the only accepted failure signal; a parse failure of spec.md is spec.blocked{reason:\"spec_parse_failed\"}"
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: none
  time_source: none
data_scope: all_data
policy_refs:
  - factory:POL-002
test_obligation:
  predicate: |
    A spec.md produced by the stage for the CLI fixture contains exactly
    one Surface, every Contract listed in its members, a test_obligation
    on every normative record, no Open-Q with blocking yes, and the
    config file validates against the agent-sdd schema; sdd lint exits 0.
  test_template: contract
  boundary_classes:
    - CLI product
    - HTTP API product
  failure_scenarios:
    - Contract outside the Surface members
    - normative record without test_obligation
---
```

```yaml
---
id: spec-stage:CTR-002
type: Contract
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.546Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: spec-stage
title: sandbox assumptions file spec/assumptions.md
surface_ref: spec-stage:SUR-001
schema:
  path: spec/assumptions.md
  sections: the 19 agent-sdd headings with `none` everywhere except "18. Assumptions"
  records:
    ASSUMPTION: id <slug>:ASM-NNN continuing the numbering of spec.md, lifecycle proposed, assumption, source_open_q (null when minted from a lane finding), blocking no, review_by, default_if_unresolved keep_assumption, tests, partition_id, notes citing the finding and the task id
preconditions:
  - listed in partitions.<slug>.sandbox_paths and in lint.spec_files of the product config
postconditions:
  - sdd lint exits 0 with the file present
  - sdd ready reports no `unapproved` violation for records in this file
external_identifiers:
  - file path spec/assumptions.md
compatibility_rules:
  - moving the file or changing the record shape => major bump on spec-stage:SUR-001
error_taxonomy:
  - "a record outside section 18 or with a status other than proposed is spec.blocked{reason:\"assumptions_file_invalid\"}"
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: exactly_once_with_key:specId
  time_source: none
data_scope: new_writes_only
policy_refs:
  - factory:POL-002
test_obligation:
  predicate: |
    After one post-approval assumption, the file holds one ASSUMPTION
    record, sdd lint exits 0 and sdd ready has zero unapproved
    violations.
  test_template: contract
  boundary_classes:
    - empty file
    - one record
  failure_scenarios:
    - record with status approved
---
```

```yaml
---
id: spec-stage:CTR-003
type: Contract
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.546Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: spec-stage
title: critic findings file spec/review/ga.md
surface_ref: spec-stage:SUR-001
schema:
  path: spec/review/ga.md
  header:
    - "# Spec review: <slug>, round <n>"
    - "decision: accept | rework"
  findings_section: 'heading "## Findings" holding one yaml fence with a list of findings'
  finding:
    id: GA-NNN
    kind: gap | conflict | weasel | untestable | missing_negative | unmodeled_term
    target_ids: ["<slug>:<PREFIX>-NNN"]
    source: L<n> or none
    resolution: decide | assume
    required_change: text in record terms
    assumption: '"<slug>:ASM-NNN" or null'
    applied: yes | no   # round 2 only
  assumptions_section: 'heading "## Assumptions" holding one yaml fence per ASSUMPTION body to insert verbatim'
  open_q_section: 'heading "## Open-Q decisions" with a table of columns Open-Q, option, finding, rationale'
  coverage_section: 'heading "## Coverage" listing source lines without a record and records without a source line'
preconditions:
  - spec.drafted emitted for the same round
postconditions:
  - the decision line equals the handoff decision
  - decision is accept iff no finding has resolution decide
external_identifiers:
  - file path spec/review/ga.md
  - finding id grammar GA-NNN
compatibility_rules:
  - changing the finding fields => major bump on spec-stage:SUR-001
error_taxonomy:
  - "frontmatter missing decision => unparseable handoff handling (bus:CTR-007)"
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
    ga.md produced by the critic fixture parses into findings and
    decisions with the fields above; round 2 marks each finding applied
    or open and the decision follows the rule in BEH-002.
  test_template: contract
  boundary_classes:
    - round 1 with findings
    - round 2 all applied
    - round 2 one open
  failure_scenarios:
    - decision accept with an open finding
---
```

---

## 8. Invariants

```yaml
---
id: spec-stage:INV-001
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.546Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: spec-stage
title: no undecided question reaches approval
always: |
  At the moment `spec.approved` is emitted, every `Open-Q` in
  `spec/spec.md` has `blocking: no`, a `default_if_unresolved`, and is
  referenced by exactly one `ASSUMPTION.source_open_q` whose assumption
  states the chosen option as a fact.
scope: product spec files
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
  - an Open-Q without a matching ASSUMPTION after round 2 makes the critic
    answer rework, which blocks the run instead of approving
out_of_scope:
  - assumptions minted after approval (they have no Open-Q)
test_obligation:
  predicate: |
    Parsing spec.md at spec.approved yields a bijection between Open-Q
    ids and ASSUMPTION source_open_q values, and no Open-Q with blocking
    yes.
  test_template: integration
  boundary_classes:
    - zero Open-Q
    - three decided Open-Q
  failure_scenarios:
    - approval with a proposed Open-Q
---
```

```yaml
---
id: spec-stage:INV-002
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.546Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: spec-stage
title: the critic never sees the analyst's reasoning
always: |
  The spec-critic's input consists of spec/spec.md, the source spec and,
  in round 2, its own round-1 ga.md; no analyst handoff body, transcript
  or tool log is part of its context.
scope: spec-stage participants
evidence: test_probe
stability: internal
data_scope: not_applicable
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: none
  time_source: none
negative_cases:
  - the analyst handoff body containing a marker string never appears in
    the critic's captured prompt
out_of_scope:
  - the critic reading the source spec (allowed)
test_obligation:
  predicate: |
    With a sentinel string placed in the analyst handoff body, the
    captured critic prompt and tool reads contain no sentinel.
  test_template: integration
  boundary_classes:
    - round 1
    - round 2
  failure_scenarios:
    - sentinel found in the critic prompt
---
```

---

## 9. External dependencies

none (agent-sdd and the model provider are declared in factory:EXT-001 and factory:EXT-003)

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
id: spec-stage:CST-001
type: Constraint
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.546Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: spec-stage
constraint: the spec-analyst runs at most 5 lint cycles per invocation
rationale: |
  Bounds cost and wall clock in the hidden-task window; a draft that is
  not lint-clean after five repairs needs a prompt fix, not more cycles.
test_obligation:
  predicate: |
    A fake model that never produces a clean draft results in handoff
    status blocked with blocked_reason lint_cap after exactly five lint
    runs.
  test_template: integration
  boundary_classes: [never clean]
  failure_scenarios: [sixth lint run]
---
```

```yaml
---
id: spec-stage:CST-002
type: Constraint
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.546Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: spec-stage
constraint: at most 2 critic rounds per run
rationale: |
  Round 2 is verification only; a third round would mean the analyst
  cannot apply decisions, which is a prompt defect to fix between runs.
test_obligation:
  predicate: |
    A critic fixture answering rework twice ends the run with
    spec.blocked{reason:"critic_cap"} and no third spec.drafted.
  test_template: integration
  boundary_classes: [rework twice]
  failure_scenarios: [third round started]
---
```

```yaml
---
id: spec-stage:CST-003
type: Constraint
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.546Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: spec-stage
constraint: at most 1 post-approval ASSUMPTION per spec record id per run
rationale: |
  A second disagreement on the same record means the chosen reading did
  not settle the lanes; the run stops so the factory is fixed between
  runs instead of oscillating.
test_obligation:
  predicate: |
    Two task.rework{target:"critic"} for the same id yield one ASSUMPTION
    and then task.failed with detail "critic assumption cap".
  test_template: integration
  boundary_classes: [same id twice]
  failure_scenarios: [second assumption written]
---
```

---

## 14. Migrations

none

---

## 15. Deltas

```yaml
---
id: spec-stage:DLT-001
type: Delta
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-30T15:02:00.862Z
    change_request: critic never ends the run
    scope: first-time-approval
partition_id: spec-stage
title: product-spec-files 0.1.0 -> 0.2.0 - the final critic round never ends the run; stage budget from configuration
target_ids:
  - spec-stage:SUR-001
  - spec-stage:BEH-002
  - spec-stage:SCN-001
kind: replace
compatibility_action: ignore
baseline_version: factory:BL-001@v0.1.0
surface_impact:
  - id: spec-stage:SUR-001
    intended_version: "0.2.0"
description: |
  - Critic rounds are bounded by the factory configuration
    `caps.criticRounds` (N, shipped value 4) instead of the literal two of
    BEH-002 and SCN-001. Round 1 reviews; rounds 2..N verify that earlier
    findings were applied and open no new finding.
  - The final round N never ends the run. When round N answers `rework`,
    the foreman materialises every finding of the round-N
    `spec/review/ga.md` as an ASSUMPTION record in `spec/assumptions.md`
    (CTR-002) without a model call: id `<slug>:ASM-NNN` continuing the
    numbering, `assumption` = the finding's `required_change` as the
    reading taken, `source_open_q: not_applicable`, `blocking: no`,
    `tests: []`, `notes` citing the finding id and the round. It then runs
    `sdd lint`, emits `spec.reviewed{round: N, decision: "accept",
    findingsPath}` as foreman and proceeds to `spec.approve`. The critic's
    own `rework` event stays in the trace before the foreman's `accept`.
  - A critic handoff that stays unparseable after its automatic re-run no
    longer blocks the run in any round: the round counts as `accept` over
    the findings present in ga.md (materialised as above when it is the
    final round, routed to the analyst otherwise); the rejected handoffs
    stay in the run directory.
  - `spec.blocked{reason: "critic_cap"}` is no longer emitted by the spec
    stage.
  - SCN-001's wall-clock budget is `timeouts.specStageMs` of the factory
    configuration (shipped value 40 minutes) instead of the literal 20
    minutes; its sequence allows up to N review rounds.
  - spec-stage:SUR-001 gains BEH-002 and SCN-001 as members => minor bump.
tests_old_behavior:
  - a rework in a non-final round still routes to the analyst; BEH-003 tests stay green
tests_new_behavior:
  - to:spec-stage:BEH-002
  - to:spec-stage:SCN-001
test_obligation:
  predicate: |
    With caps.criticRounds = 2 and a scripted critic answering rework in
    round 2 with two findings, spec/assumptions.md gains two ASSUMPTION
    records with consecutive ids whose notes name the finding ids,
    spec/spec.md is byte-identical, the foreman emits
    spec.reviewed{round: 2, decision: "accept"} and spec.approved
    follows; no spec.blocked is emitted. With caps.criticRounds = 4 a
    rework in round 1 routes to the analyst as before. A critic handoff
    unparseable twice in round 1 yields spec.reviewed{decision: "accept"}
    and no spec.blocked.
  test_template: integration
  boundary_classes:
    - final round rework
    - non-final round rework
    - unparseable critic handoff after the re-run
  failure_scenarios:
    - run ends with critic_cap or analyst_blocked because of the critic
    - assumption written into spec/spec.md
    - assumption id colliding with an existing record
---
```

```yaml
---
id: spec-stage:DLT-002
type: Delta
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-30T15:13:21.068Z
    change_request: critic never ends the run
    scope: first-time-approval
partition_id: spec-stage
title: final critic round - approval follows the recorded assumptions directly
target_ids:
  - spec-stage:DLT-001
  - spec-stage:BEH-002
kind: replace
compatibility_action: ignore
baseline_version: factory:BL-001@v0.1.0
surface_impact: []
description: |
  spec-stage:DLT-001 let the foreman emit a second
  `spec.reviewed{round: N, decision: "accept"}` after recording the open
  findings. bus:BEH-002 treats an event with the same type and round as a
  duplicate of the critic's `spec.reviewed{round: N, decision: "rework"}`
  and ignores it, so that event cannot drive the approval. The foreman
  therefore proceeds to `spec.approve` directly after writing the
  assumptions and running `sdd lint`: the trace carries the critic's
  `rework` for round N followed by `spec.approved`; the recorded
  assumptions are listed in trace.md and in spec/assumptions.md. The
  foreman's `spec.reviewed` is still emitted when the critic's handoff
  stayed unparseable, because the critic published nothing for that round.
tests_old_behavior:
  - spec-stage:DLT-001 tests on the recorded assumptions and the untouched spec.md stay green
tests_new_behavior:
  - to:spec-stage:BEH-002
test_obligation:
  predicate: |
    With caps.criticRounds = 2 and a scripted critic answering rework in
    round 2, the run engine's trace reads workspace.ready, spec.drafted,
    spec.reviewed, spec.rework, spec.drafted, spec.reviewed, spec.approved
    with no further spec.reviewed, and spec/assumptions.md carries the
    recorded finding.
  test_template: integration
  boundary_classes:
    - final round rework through the run engine
  failure_scenarios:
    - a second spec.reviewed for round N that the engine ignores as a duplicate
    - spec.approved missing after the recorded assumptions
---
```

```yaml
---
id: spec-stage:DLT-003
type: Delta
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-30T16:02:14.266Z
    change_request: spec blockers never end the run
    scope: first-time-approval
partition_id: spec-stage
title: approval materialises the default of every undecided Open-Q instead of blocking
target_ids:
  - spec-stage:INV-001
  - spec-stage:BEH-002
kind: replace
compatibility_action: ignore
baseline_version: factory:BL-001@v0.1.0
surface_impact: []
description: |
  INV-001 still holds at `spec.approved`, but the way an undecided
  `Open-Q` is handled changes. Before the integrity check of `spec.approve`
  the foreman finds every Open-Q of spec/spec.md with `blocking: no`, a
  `default_if_unresolved` and no ASSUMPTION naming it in `source_open_q`,
  and appends one ASSUMPTION record to section 18 of spec/spec.md without
  a model call: id continuing the numbering, `assumption` stating the
  default option (its id, label and consequence) as the reading taken,
  `source_open_q` the Open-Q id, `blocking: no`, `tests: []`, `notes`
  naming the Open-Q and this rule. `sdd lint` runs afterwards as before.
  Only an Open-Q with `blocking: yes` or without `default_if_unresolved`,
  and the Surface membership problems, still block approval. The critic
  (BEH-002) keeps deciding Open-Qs in its rounds; this rule is the
  deterministic floor under a critic that misses one, which is what the
  SDD methodology prescribes for blocking: no questions.
tests_old_behavior:
  - a decided Open-Q is approved unchanged; Surface membership problems still block (spec-stage:CTR-001 test)
tests_new_behavior:
  - to:spec-stage:INV-001
test_obligation:
  predicate: |
    A spec whose Open-Q has no ASSUMPTION naming it is approved with a new
    ASSUMPTION in section 18 whose source_open_q is that Open-Q and whose
    assumption names the default option; an Open-Q with blocking yes still
    blocks with analyst_blocked.
  test_template: integration
  boundary_classes:
    - one undecided Open-Q with a default
    - blocking Open-Q
  failure_scenarios:
    - approval blocked by a decidable Open-Q
    - ASSUMPTION added for an Open-Q that already has one
---
```

```yaml
---
id: spec-stage:DLT-004
type: Delta
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-30T16:58:58.853Z
    change_request: approval repairs surface membership
    scope: first-time-approval
partition_id: spec-stage
title: approval repairs Surface membership mechanically instead of blocking
target_ids:
  - spec-stage:CTR-001
  - spec-stage:BEH-004
kind: replace
compatibility_action: ignore
baseline_version: factory:BL-001@v0.1.0
surface_impact: []
description: |
  The approval step checks that spec/spec.md holds exactly one Surface
  whose members list every Contract. A Contract missing from members is
  a bookkeeping slip with one correct repair (the analyst's own rule
  says members = all Contract ids), so the foreman repairs it instead of
  ending the stage: before the pre-authorised approval it appends every
  Contract id absent from `members` to the Surface record, re-runs
  `sdd lint`, logs `spec.approve: <SUR-id> members += <ids>` and records
  the repair in the run trace as part of the approval. Zero or several
  Surface records, a lint failure after the repair, and `sdd approve` /
  `sdd finalize` failures still block with their existing reasons: they
  have no single mechanical repair.
tests_old_behavior:
  - a spec with exactly one Surface listing every Contract approves unchanged
  - zero or two Surface records still block with spec_integrity
tests_new_behavior:
  - to:spec-stage:CTR-001
test_obligation:
  predicate: |
    Given a lint-clean spec whose Surface lists two of its three
    Contracts, the approve effect appends the third id to members,
    lints again, logs the repair and emits spec.approved; given two
    Surface records, it still emits spec.blocked with spec_integrity.
  test_template: integration
  boundary_classes:
    - one missing member
    - every member present
    - zero or two Surfaces
  failure_scenarios:
    - members rewritten in a different order or duplicated
    - the repair skipping the lint
---
```

```yaml
---
id: spec-stage:DLT-005
type: Delta
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-30T17:56:55.356Z
    change_request: "run 10: role timeouts, architect scope, yaml-invalid lint"
    scope: first-time-approval
partition_id: spec-stage
title: a record fence the yaml parser rejects is a lint diagnostic, not an invisible record
target_ids:
  - spec-stage:BEH-001
  - spec-stage:CTR-001
kind: replace
compatibility_action: ignore
baseline_version: factory:BL-001@v0.1.0
surface_impact: []
description: |
  `sdd lint` skips a record fence whose yaml has errors instead of
  reporting it: in run 10 nine of 63 records (values starting with a
  backtick, plain values containing ": ") were never linted, were
  approved anyway, and were invisible to the foreman's integrity checks,
  which then warned about assumptions whose Open-Q "did not exist". The
  factory closes the gap on its side. The `sdd_lint` tool the analyst
  calls (spec-stage:BEH-001) and the foreman's own lint after the
  handoff parse every ```yaml fence of spec/spec.md and
  spec/assumptions.md with the same yaml parser sdd uses; a fence with
  errors yields one diagnostic `yaml_invalid <id or "fence at line N">:
  <parser message> (line L, column C)` appended to sdd's output, and
  the lint result counts as failed (exit code 1 when sdd itself exited
  0). The analyst repairs it within the lint-cycle cap like any
  diagnostic. spec-stage:CTR-001 gains the rule "every record fence
  parses without yaml errors". The parser the factory uses for its own
  record checks keeps rejecting such fences; once the lint loop enforces
  validity it sees every record.
tests_old_behavior:
  - a spec whose fences all parse lints exactly as sdd reports
tests_new_behavior:
  - to:spec-stage:BEH-001
  - to:spec-stage:CTR-001
test_obligation:
  predicate: |
    Given sdd lint exiting 0 on a spec with one fence whose value starts
    with a backtick and one whose plain value contains ": ", the
    sdd_lint tool result names both records with yaml_invalid and a
    line number and reports exit 1; with every fence valid the tool
    returns sdd's result unchanged; the foreman's post-handoff lint
    blocks with the same diagnostics when the analyst claims lint_exit 0
    over an invalid fence.
  test_template: integration
  boundary_classes:
    - backtick-leading value
    - colon-space inside a plain value
    - every fence valid
  failure_scenarios:
    - the diagnostic without the record id
    - exit 0 despite an invalid fence
---
```

```yaml
---
id: spec-stage:DLT-006
type: Delta
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-30T19:08:13.848Z
    change_request: "run 11: task graph size, stub imports, reviewer fallback, multi-lane resume, simple-fixer"
    scope: first-time-approval
partition_id: spec-stage
title: a yaml_invalid lint diagnostic goes to the simple-fixer before the stage blocks
target_ids:
  - spec-stage:BEH-001
  - spec-stage:BEH-003
  - spec-stage:CTR-001
kind: replace
compatibility_action: ignore
baseline_version: factory:BL-001@v0.1.0
surface_impact: []
description: |
  spec-stage:DLT-005 made a record fence the yaml parser rejects visible
  as a yaml_invalid diagnostic; the analyst repairs it inside its lint
  cycles, and when the cycles run out the stage blocks over a quoting
  mistake. factory:BEH-012 adds a cheaper repair step: every foreman lint
  of the product spec (after the analyst handoff in spec-stage:BEH-001,
  including a handoff with blocked_reason lint_cap; after a revision in
  spec-stage:BEH-003; before approval) whose diagnostics include at least
  one yaml_invalid entry invokes the simple-fixer with trigger
  spec_yaml_invalid (allowed paths spec/spec.md and spec/assumptions.md,
  format only) up to factory:CST-005, re-running the lint after each
  run. A lint that exits 0 after a fix continues the flow (spec.drafted,
  spec.revised or the approval); a lint that still fails follows the
  existing paths (spec.blocked with lint_cap or lint_failed). The
  analyst's own lint cycles and spec-stage:CST-001 are unchanged.
  spec-stage:CTR-001 error_taxonomy row for yaml_invalid gains
  "=> simple-fixer per factory:BEH-012, then the existing route".
tests_old_behavior:
  - a lint failure without yaml_invalid diagnostics still blocks with the existing reasons and never invokes the fixer
tests_new_behavior:
  - to:factory:BEH-012
test_obligation:
  predicate: |
    Given an analyst handoff with status complete and a spec whose one
    fence has an unquoted colon, and a fake fixer that quotes it, the
    stage publishes spec.drafted{lintExit: 0} after one fix.attempted;
    given a handoff with blocked_reason lint_cap over the same defect, the
    stage publishes spec.drafted instead of spec.blocked; given a lint
    failing on a missing required field only, no fixer runs and
    spec.blocked carries lint_failed.
  test_template: integration
  boundary_classes:
    - yaml_invalid after a complete handoff
    - yaml_invalid after a lint_cap handoff
    - semantic lint failure (no fixer)
  failure_scenarios:
    - fixer invoked without a yaml_invalid diagnostic
    - spec.drafted published while lint still fails
---
```

---

## 16. Implementation bindings

none (added once the implementation exists)

---

## 17. Open questions

```yaml
---
id: spec-stage:OQ-001
type: Open-Q
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.546Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: spec-stage
question: |
  Should the lint-cycle cap be 5 (a) or 3 (b)?
options:
  - id: a
    label: five
    consequence: more tolerance for long specs; up to five model turns of cost
  - id: b
    label: three
    consequence: cheaper; long specs with many records are likelier to block
blocking: no
owner: operator
default_if_unresolved: a
---
```

```yaml
---
id: spec-stage:OQ-002
type: Open-Q
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.546Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: spec-stage
question: |
  Should the stage timeout of SCN-001 be 20 minutes (a) or 30 minutes (b)?
options:
  - id: a
    label: twenty
    consequence: leaves more of the two-hour window for lanes and re-runs
  - id: b
    label: thirty
    consequence: safer for very long source specs; fewer re-runs possible
blocking: no
owner: operator
default_if_unresolved: a
---
```

---

## 18. Assumptions

```yaml
---
id: spec-stage:ASM-001
type: ASSUMPTION
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.546Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: spec-stage
assumption: the lint-cycle cap is 5
source_open_q: spec-stage:OQ-001
blocking: no
review_by: "2026-10-31"
default_if_unresolved: keep_assumption
tests:
  - spec-stage:CST-001 boundary class "never clean"
---
```

```yaml
---
id: spec-stage:ASM-002
type: ASSUMPTION
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.546Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: spec-stage
assumption: the spec stage timeout is 20 minutes
source_open_q: spec-stage:OQ-002
blocking: no
review_by: "2026-10-31"
default_if_unresolved: keep_assumption
tests:
  - spec-stage:SCN-001 timeout branch
---
```

---

## 19. Out of scope

- Brownfield recon (artel stage 2); the product has no prior code.
- Human review of the product spec during the run (factory:POL-001).
- Evolving an approved product record within a run (`Delta`); the run is
  re-launched instead.
- Localisation, migrations and generated artifacts in generated product
  specs; the analyst emits `none` for those sections.
