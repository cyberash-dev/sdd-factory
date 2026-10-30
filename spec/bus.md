# sdd-factory — bus partition

> Single source of truth for the factory's event bus, handoff protocol and
> shared run state. Version 0.1.0. Every record in this file is
> `lifecycle.status: proposed`; the agent that authored it cannot
> self-approve, promotion to `approved` requires a human `sdd approve` +
> `sdd finalize`.

---

## 1. Context

The factory is a set of participants on one Mozaik runtime inside one Node
process. Participants never call each other: they publish typed events on
the runtime's bus and react to events whose type and payload match their
handler. The `bus` partition owns the vocabulary of those events, the file
protocol by which LLM participants hand their results back to the
deterministic reactors (`handoff.md`), and the shared run state snapshot
(`state.json`) that every reactor reads and the tracer mirrors.

Everything the factory does is a transition of a small state machine:
run → workspace → spec → design → tasks → lanes → assembly → published or
failed. This partition fixes that each transition is caused by exactly one
event, that duplicate deliveries are harmless, and that a malformed
handoff is a failure that routes, never a value that is guessed.

The runtime itself (`@mozaik-ai/core`) is an external dependency pinned to
an exact version; its own event types (`inference.completed`, participant
join/leave) are consumed by the `trace` partition and are outside this
partition's contract.

---

## 2. Glossary

- **Run** — one execution of the factory on one spec file, identified by
  `runId` = `<slug>-<yyyymmdd-hhmmss>`.
- **Slug** — kebab-case basename of the input spec file, matching
  `^[a-z][a-z0-9-]*$`; also the product spec partition name.
- **Participant** — a named member of the Mozaik runtime: an LLM agent
  (API-driven or a `claude -p` subprocess wrapped as a participant) or a
  deterministic reactor.
- **Reactor** — a participant without a model; it reacts to events with
  code only (foreman, assembler, tracer).
- **Event** — a Mozaik `SemanticEvent` with the envelope of `bus:CTR-001`.
- **Envelope** — the fixed outer fields of every event: `type`, `runId`,
  `occurredAt`, `producer`, `payload`.
- **Transition** — one change of the run state or of one task's state in
  `state.json`, caused by one event.
- **Handoff** — the `handoff.md` file an LLM role writes when it finishes;
  YAML frontmatter is the machine-readable part.
- **Lane** — the per-task sequence test-writer → verifier → implementer →
  verifier → reviewer, executed in the task's git worktree.
- **Attempt** — the 1-based counter of invocations of one role for one
  task (or one stage) within a run.
- **Cap** — the configured maximum of attempts for a route; exhaustion is
  a terminal failure of the task or the run.
- **Stage** — one of `workspace`, `spec`, `design`, `build`, `assembly`,
  `publish`, derived from the event type prefix.
- **Terminal event** — `run.published` or `run.failed`; exactly one per run.

---

## 3. Partition

```yaml
---
id: bus
type: Partition
partition_id: bus
owner_team: sdd-factory
gate_scope:
  - bus
dependencies_on_other_partitions:
  - factory:SUR-001
  - factory:POL-001
  - factory:POL-002
  - factory:POL-003
default_policy_set:
  - factory:POL-001
  - factory:POL-002
  - factory:POL-003
id_namespace: bus
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
id: bus:SUR-001
type: Surface
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:41.895Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: bus
name: factory-events
version: "0.3.0"
boundary_type: event_bus
members:
  - bus:CTR-001
  - bus:CTR-002
  - bus:CTR-003
  - bus:CTR-004
  - bus:CTR-005
  - bus:CTR-006
  - bus:BEH-001
  - bus:BEH-002
  - bus:BEH-005
  - bus:BEH-006
  - bus:BEH-007
consumer_compat_policy: semver_per_surface
notes: |
  Consumers are every participant of the runtime and the tracer. Adding
  an event type or an optional payload field is a minor bump; renaming or
  removing an event type, a payload field or an enum value is a major
  bump.
---
```

```yaml
---
id: bus:SUR-002
type: Surface
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:41.895Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: bus
name: handoff-files
version: "0.2.0"
boundary_type: public_storage
members:
  - bus:CTR-007
  - bus:CTR-008
  - bus:BEH-003
  - bus:BEH-004
consumer_compat_policy: semver_per_surface
notes: |
  Files under `.factory/runs/<runId>/`. Producers of handoff.md are the
  role prompts (prompts/<role>.md); the consumer is the foreman reactor.
  state.json is produced by the foreman and consumed by the tracer and by
  operators debugging a failed run.
---
```

---

## 6. Requirements

```yaml
---
id: bus:BEH-001
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:41.895Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: bus
title: participants react to events only
surface_ref: bus:SUR-001
given: |
  - the runtime is initialised and every participant has joined
  - a participant P has a handler whose situation matches event type E
when: an event of type E is published on the bus
then: |
  - P's handler for E is invoked exactly once with that event
  - no participant reads handoff files, state.json or the worktrees on a
    timer or in a loop; every read of those files happens inside a
    handler invocation
  - a participant without a matching handler is not invoked
negative_cases:
  - an event whose type is not in bus:CTR-002..006 => publication is
    rejected with error_taxonomy `unknown_event_type`; no handler runs
  - two handlers of the same participant match E => both run; order is
    the registration order
out_of_scope:
  - delivery across processes or machines (single process only)
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
    Publishing one event of each catalogued type invokes exactly the
    handlers registered for that type, once each; a fake clock advanced
    by 10 minutes with no events published produces zero handler
    invocations and zero file reads.
  test_template: unit
  boundary_classes:
    - every catalogued event type
    - event with two matching handlers on one participant
    - idle runtime under an advanced fake clock
  failure_scenarios:
    - handler invoked twice for one publication
    - handler invoked with no event (polling)
    - unknown event type accepted
---
```

```yaml
---
id: bus:BEH-002
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:41.895Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: bus
title: one transition per event, duplicates ignored
surface_ref: bus:SUR-001
given: |
  - state.json holds the current run status and every task's status
  - an event E addressing the run or one task T is delivered
when: the foreman consumes E
then: |
  - at most one transition is applied to the run or to T
  - the resulting event(s) of that transition are published after the
    transition is persisted (bus:BEH-004)
  - a second delivery of an event with the same `type`, `runId`,
    `payload.taskId` and `payload.attempt` as an already-consumed event
    applies no transition and is recorded as `duplicate_ignored` in the
    handler's log line
negative_cases:
  - E addresses a task whose status does not accept E (for example
    `task.impl_done` while T is in `tests_pending`) => no transition;
    event recorded as `out_of_order_ignored`; the run continues
  - E addresses an unknown taskId => no transition; recorded as
    `unknown_task_ignored`
out_of_scope:
  - transitions caused by anything other than an event
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_global
  read_consistency: strong
  idempotency: "at_least_once_with_key:(type,runId,payload.taskId,payload.attempt)"
  time_source: none
data_scope: all_data
policy_refs:
  - factory:POL-002
test_obligation:
  predicate: |
    Delivering `task.verified{green}` twice for the same task and attempt
    leaves the task in `review_pending` with exactly one `task.reviewed`
    request issued; delivering `task.impl_done` to a task in
    `tests_pending` leaves state.json byte-identical.
  test_template: unit
  boundary_classes:
    - exact duplicate delivery
    - out-of-order event
    - unknown taskId
  failure_scenarios:
    - two transitions for one duplicate
    - state mutated by an out-of-order event
---
```

```yaml
---
id: bus:BEH-003
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:41.895Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: bus
title: unparseable handoff triggers one automatic re-run, then failure
surface_ref: bus:SUR-002
given: |
  - an LLM role R finished its invocation for a run stage or a task T
  - the foreman reads the handoff.md path announced for that invocation
when: |
  the file is missing, has no YAML frontmatter, the frontmatter does not
  parse, a required key for R (bus:CTR-007) is missing, or an enum-valued
  key holds a value outside its enum
then: |
  - if this is the first unparseable handoff of R for T (or for the
    stage), R is re-run once with the same inputs plus the parse error
    text appended to its task message; the attempt counter increments
  - if R already had one unparseable handoff for T (or the stage), the
    foreman publishes `task.failed{taskId, reason: unparseable_handoff}`
    for lane roles, `spec.blocked{reason: analyst_blocked}` for
    spec-analyst and spec-critic, `design.blocked{reason}` for architect,
    verification-designer and planner
  - the malformed file is kept at its path with suffix `.rejected-<n>`
negative_cases:
  - the frontmatter parses and carries all required keys but an optional
    key is malformed => accepted; the optional key is treated as absent
    and the fact is logged
out_of_scope:
  - semantic validation of the handoff body
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
    A role stub that writes no handoff is invoked exactly twice and the
    second miss yields `task.failed{reason: unparseable_handoff}`; a stub
    that writes a handoff missing `decision:` for reviewer is re-run once
    with the error text present in its task message.
  test_template: integration
  boundary_classes:
    - missing file
    - missing frontmatter
    - YAML parse error
    - missing required key
    - enum value outside its set
    - malformed optional key
  failure_scenarios:
    - third invocation of the role
    - run continues with a guessed value
---
```

```yaml
---
id: bus:BEH-004
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:41.895Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: bus
title: state snapshot persisted after every transition
surface_ref: bus:SUR-002
given: |
  - a transition was applied in memory by the foreman (bus:BEH-002)
when: the transition completes
then: |
  - `.factory/runs/<runId>/state.json` is written with the full snapshot
    of bus:CTR-008, via write-to-temp-file then atomic rename
  - `updatedAt` equals the `occurredAt` of the causing event and
    `lastSeq` equals that event's trace sequence number
  - the resulting events of the transition are published only after the
    rename returned
negative_cases:
  - "the write fails (disk error, permission) => the transition is not considered applied; run.failed{stage, reason: runtime_error} is published and the process exits non-zero"
out_of_scope:
  - snapshot history (only the latest snapshot is kept)
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
    After each of N events in a scripted run, state.json parses, carries
    the expected status, and `lastSeq` equals the event's seq; a
    simulated rename failure produces `run.failed{reason: runtime_error}`
    and no further events.
  test_template: integration
  boundary_classes:
    - every transition of a scripted happy-path run
    - write failure injected on one transition
  failure_scenarios:
    - partially written JSON observable at the final path
    - resulting event published before the snapshot exists
---
```

```yaml
---
id: bus:BEH-005
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:41.895Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: bus
title: envelope validation at publication
surface_ref: bus:SUR-001
given: |
  - a participant calls the runtime's publish function with an event
when: the event is handed to the bus
then: |
  - the event carries every envelope field of bus:CTR-001 with the
    declared type, and `type` is in the catalogue of bus:CTR-002..006
  - the payload carries every required field of that event type
  - the event is delivered to matching handlers
negative_cases:
  - "a required envelope or payload field is missing or has the wrong type => the publish call throws with error_taxonomy envelope_invalid naming the field; nothing is delivered"
  - "type not in the catalogue => throws unknown_event_type"
out_of_scope:
  - validation of optional payload fields beyond their declared type
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_global
  read_consistency: strong
  idempotency: none
  time_source: none
data_scope: not_applicable
policy_refs:
  - factory:POL-002
test_obligation:
  predicate: |
    For each catalogued event type, a payload missing one required field
    makes publish throw `envelope_invalid` with that field name, and a
    complete payload is delivered; an unknown type throws
    `unknown_event_type`.
  test_template: unit
  boundary_classes:
    - each event type with one required field removed
    - each event type complete
    - unknown type
  failure_scenarios:
    - invalid event delivered to a handler
    - error thrown without the offending field name
---
```

```yaml
---
id: bus:BEH-006
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:41.895Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: bus
title: runtime errors terminate the run, never hang it
surface_ref: bus:SUR-001
given: |
  - the run is in any non-terminal status
when: |
  a handler throws, a `runLoop` of an LLM participant rejects, a
  subprocess participant exits with a signal, or an unhandled rejection
  reaches the process
then: |
  - the foreman publishes `run.failed{stage, reason: runtime_error,
    detail: <error message>}` where stage is the current stage of
    state.json
  - running subprocess participants receive SIGTERM
  - the process exits with the non-zero code defined by factory:CTR-002
    after the tracer flushed trace files
  - nothing is published to `hidden/<slug>/`
negative_cases:
  - the error occurs after `run.published` was emitted => the exit code
    stays the success code; the error is appended to the trace as a
    warning line
out_of_scope:
  - automatic retry of a crashed participant
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
    A handler that throws during the design stage produces exactly one
    `run.failed{stage: design, reason: runtime_error}` event, the trace
    files exist and end with that event, the process exit code is
    non-zero, and no `hidden/<slug>/` directory was created.
  test_template: integration
  boundary_classes:
    - throwing handler
    - rejected runLoop
    - subprocess killed by signal
    - error after run.published
  failure_scenarios:
    - process stays alive with no terminal event
    - product published after a runtime error
---
```

```yaml
---
id: bus:BEH-007
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-30T10:53:11.281Z
    change_request: participant roster
    scope: first-time-approval
partition_id: bus
title: every event is sent by the participant it names
surface_ref: bus:SUR-001
given: |
  - the runtime is initialised with a participant roster: one joined
    Mozaik participant per producer name of bus:CTR-001 except the lane
    roles test-writer and implementer; deterministic producers (foreman,
    assembler, tracer) are Mozaik humans, LLM producers are Mozaik agents
  - a lane role joins a participant per task on lane start and leaves it
    on lane end (build-stage:BEH-017); its capabilities contain
    `task:<taskId>`
when: a participant publishes an event with envelope field producer P
then: |
  - the Mozaik `producerId` of the delivered SemanticEvent equals the id
    of a joined participant whose name is P
  - when P is a lane role and the payload carries taskId, the sender is
    the lane participant of that task
  - `runtime.state.getParticipants()` lists, at any instant, exactly the
    roster participants plus one participant per running lane, so the
    roster reflects the lanes that run concurrently (bus:INV-003)
negative_cases:
  - P has no joined participant (a lane role after its lane left, or a
    lane role without taskId) => publication is rejected with
    error_taxonomy `producer_not_joined`; nothing is delivered
  - a participant whose name is not a producer of bus:CTR-001 is never
    chosen as sender
out_of_scope:
  - the identity of the transient inference agents an LLM role creates
    for each `runLoop`; they publish `inference.*` events under their own
    id and are not roster members
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
    An observer joined to the runtime sees an event published with
    producer assembler carrying the id of the joined participant named
    assembler; after joinLane(implementer, T-001) an event with producer
    implementer and taskId T-001 carries the id of a participant whose
    capabilities contain task:T-001; after leaveLane the same publication
    is rejected with producer_not_joined and the observer sees nothing.
  test_template: unit
  boundary_classes:
    - roster producer
    - lane producer with a joined lane
    - lane producer after leave
  failure_scenarios:
    - every event sent under one shared participant id
    - lane participant still listed after the lane ended
---
```

```yaml
---
id: bus:SCN-001
type: Scenario
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:41.895Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: bus
title: duplicate delivery of a lane event is idempotent
initial_state: |
  task T-001 is in status `impl_pending` with implementer attempt 1;
  state.json lastSeq = 41
trigger: |
  `task.impl_done{taskId: T-001, attempt: 1}` is delivered, then the
  identical event is delivered again before the verifier finished
observable_sequence:
  - "1. foreman applies transition impl_pending -> verify_pending; writes state.json (lastSeq 42)"
  - "2. foreman starts exactly one green-check verifier run for T-001"
  - "3. second delivery is recorded as duplicate_ignored; state.json unchanged (lastSeq 43 recorded by the tracer only)"
  - "4. verifier publishes exactly one task.verified for T-001 attempt 1"
ordering: strict
idempotency: "at_least_once_with_key:(type,runId,payload.taskId,payload.attempt)"
retry_policy: none
timeout: verifier run bounded by the factory verifier timeout (factory config)
applicability:
  invariant_to_all_axes: true
data_scope: all_data
test_obligation:
  predicate: |
    With a stubbed verifier, two deliveries of the same `task.impl_done`
    produce one verifier invocation and one `task.verified` event.
  test_template: integration
  boundary_classes:
    - duplicate before verifier completion
    - duplicate after verifier completion
  failure_scenarios:
    - two verifier runs
    - two task.verified events
---
```

---

## 7. Data contracts

```yaml
---
id: bus:CTR-001
type: Contract
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:41.895Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: bus
title: event envelope
surface_ref: bus:SUR-001
schema:
  type: string, dotted lowercase, one of the types in bus:CTR-002..006
  runId: string, matches ^[a-z][a-z0-9-]*-[0-9]{8}-[0-9]{6}$
  occurredAt: string, ISO-8601 UTC with milliseconds, assigned by the runtime at publication
  producer: string, participant name, one of foreman | spec-analyst | spec-critic | architect | verification-designer | planner | test-writer | implementer | reviewer | assembler | triage | tracer
  payload: object, fields per event type; unknown extra fields are preserved and ignored
preconditions:
  - the runtime is initialised for runId
postconditions:
  - every delivered event carries all five fields with the declared types
  - occurredAt is non-decreasing in delivery order within one run
external_identifiers:
  - field names type, runId, occurredAt, producer, payload
  - producer names listed above
compatibility_rules:
  - adding an optional payload field => minor bump on bus:SUR-001
  - renaming or removing an envelope field, an event type or a producer name => major bump
error_taxonomy:
  - "envelope_invalid — a required envelope or payload field is missing or mistyped; publish throws"
  - "unknown_event_type — type not in the catalogue; publish throws"
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_global
  read_consistency: strong
  idempotency: "at_least_once_with_key:(type,runId,payload.taskId,payload.attempt)"
  time_source: "wall_clock:single_process"
data_scope: not_applicable
policy_refs:
  - factory:POL-002
  - factory:POL-003
test_obligation:
  predicate: |
    Every event captured during a scripted run validates against the
    envelope schema; occurredAt values are non-decreasing; producer is in
    the enum.
  test_template: contract
  boundary_classes:
    - events from every producer
    - first and last event of a run
  failure_scenarios:
    - occurredAt decreasing
    - producer outside the enum
---
```

```yaml
---
id: bus:CTR-002
type: Contract
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:41.895Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: bus
title: run lifecycle events
surface_ref: bus:SUR-001
schema:
  run.started:
    specPath: string, path of the input Markdown spec
    slug: string, ^[a-z][a-z0-9-]*$
    operator: string, identity named at launch
    mode: string, literal "autonomous"
  workspace.ready:
    productDir: string, absolute path of the product git repository
    slug: string
    baselineId: string, "<slug>:BL-001"
  run.failed:
    stage: string, one of workspace | spec | design | build | assembly | publish
    reason: string, one of lint_cap | critic_cap | analyst_blocked | design_blocked | cap_exhausted | unparseable_handoff | tooling_broken | runtime_error | publish_failed | trace_write_failed
    detail: string, human-readable cause
  run.published:
    commitSha: string, 40 hex chars, commit in the team repository
    outputDir: string, "hidden/<slug>/"
    pushed: boolean
  human.intervention:
    kind: string, one of launch | fix_between_runs | mid_run_nudge
    note: string
    actor: string
preconditions:
  - run.started is the first event of a run
postconditions:
  - exactly one of run.failed or run.published is published per run, and it is the last bus event of the run
  - human.intervention{kind: launch} is published exactly once, immediately after run.started
external_identifiers:
  - event types run.started, workspace.ready, run.failed, run.published, human.intervention
  - enum values of stage, reason, kind
compatibility_rules:
  - adding a reason or kind value => minor bump on bus:SUR-001
  - removing or renaming a type, field or enum value => major bump
error_taxonomy:
  - "envelope_invalid — see bus:CTR-001"
  - "terminal_event_duplicate — a second terminal event for the same run is rejected at publication"
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: none
  time_source: "wall_clock:single_process"
data_scope: not_applicable
policy_refs:
  - factory:POL-001
test_obligation:
  predicate: |
    A scripted successful run emits run.started first,
    human.intervention{kind: launch} second, run.published last and no
    run.failed; a scripted failing run emits run.failed last and no
    run.published; publishing a second terminal event throws
    `terminal_event_duplicate`.
  test_template: contract
  boundary_classes:
    - successful run
    - failing run at each stage value
    - duplicate terminal event
  failure_scenarios:
    - both terminal events emitted
    - run.failed with a reason outside the enum
---
```

```yaml
---
id: bus:CTR-003
type: Contract
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:41.895Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: bus
title: spec-stage events
surface_ref: bus:SUR-001
schema:
  spec.drafted:
    attempt: integer, 1-based analyst invocation counter
    lintExit: integer, literal 0 (the analyst publishes only after `sdd lint` exit 0)
    recordCounts: object, keys behaviors | contracts | invariants | scenarios | constraints | policies | open_questions | assumptions, integer values
  spec.reviewed:
    round: integer, 1-based critic round
    decision: string, accept | rework
    findingsPath: string, path of spec/review/ga.md inside the product repo
  spec.rework:
    round: integer
    findingsPath: string
  spec.approved:
    approver: string, operator identity
    mode: string, literal "pre-authorized-at-launch"
    approvedIds: integer, number of records flipped to approved
  spec.blocked:
    reason: string, one of lint_cap | critic_cap | analyst_blocked
    detail: string
preconditions:
  - workspace.ready was published for the run
postconditions:
  - spec.approved or spec.blocked is published exactly once per run
  - spec.rework.round never exceeds the critic round cap of the spec-stage partition
external_identifiers:
  - event types spec.drafted, spec.reviewed, spec.rework, spec.approved, spec.blocked
  - enum values of decision, reason, mode
compatibility_rules:
  - adding a field or reason value => minor bump
  - removing or renaming => major bump
error_taxonomy:
  - "envelope_invalid — see bus:CTR-001"
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: "at_least_once_with_key:(type,runId,payload.attempt|payload.round)"
  time_source: "wall_clock:single_process"
data_scope: not_applicable
policy_refs:
  - factory:POL-001
test_obligation:
  predicate: |
    Each spec-stage event type is accepted with a complete payload and
    rejected with `envelope_invalid` when `decision`, `reason` or `mode`
    holds a value outside its enum.
  test_template: contract
  boundary_classes:
    - each event type, complete
    - each enum field with an invalid value
  failure_scenarios:
    - spec.drafted accepted with lintExit != 0
---
```

```yaml
---
id: bus:CTR-004
type: Contract
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:41.895Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: bus
title: design-stage events
surface_ref: bus:SUR-001
schema:
  design.tech.ready:
    path: string, design/tech.md inside the product repo
  design.verification.ready:
    path: string, design/verification.md
  design.tasks.ready:
    path: string, design/tasks.json
    taskCount: integer, >= 1
  design.rework:
    target: string, planner | architect
    reason: string
    attempt: integer
  design.blocked:
    reason: string
preconditions:
  - spec.approved was published for the run
postconditions:
  - design.tasks.ready is published only after both design.tech.ready and design.verification.ready
  - design.tasks.ready or design.blocked is published exactly once per run
external_identifiers:
  - event types design.tech.ready, design.verification.ready, design.tasks.ready, design.rework, design.blocked
  - enum values of target
compatibility_rules:
  - adding a field or target value => minor bump
  - removing or renaming => major bump
error_taxonomy:
  - "envelope_invalid — see bus:CTR-001"
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_per_resource
  read_consistency: strong
  idempotency: "at_least_once_with_key:(type,runId,payload.attempt)"
  time_source: "wall_clock:single_process"
data_scope: not_applicable
policy_refs:
  - factory:POL-001
test_obligation:
  predicate: |
    design.tasks.ready published before one of the two design.*.ready
    events is rejected by the foreman's barrier (no transition); after
    both, exactly one design.tasks.ready is accepted; taskCount 0 is
    `envelope_invalid`.
  test_template: contract
  boundary_classes:
    - tech ready first, verification ready first
    - tasks ready before barrier
    - taskCount 0
  failure_scenarios:
    - planner started with one design artefact missing
---
```

```yaml
---
id: bus:CTR-005
type: Contract
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:41.895Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: bus
title: task-lane events
surface_ref: bus:SUR-001
schema:
  task.ready:
    taskId: string, ^T-[0-9]{3}$
    worktree: string, absolute path
    baseSha: string, 40 hex
    covers: array of string, product spec IDs
    writes: array of string, glob patterns relative to the product root
  task.tests_written:
    taskId: string
    attempt: integer
    handoffPath: string
    costUsd: number or null
    inputTokens: integer
    outputTokens: integer
    durationMs: integer
  task.tests_red:
    taskId: string
    testsSha: string, 40 hex, commit holding the frozen tests
    testFiles: array of string
  task.tests_rejected:
    taskId: string
    reason: string, vacuous | suite_error | missing_covers | orphan_covers | outside_write_set
    detail: string
  task.impl_done:
    taskId: string
    attempt: integer
    handoffPath: string
    costUsd: number or null
    inputTokens: integer
    outputTokens: integer
    durationMs: integer
  task.verified:
    taskId: string
    result: string, green | red
    evidencePath: string, verifier.json of build-stage:CTR-002
    testsUnchanged: boolean
    writeSetOk: boolean
  task.finding:
    taskId: string
    type: string, TEST-CONTRACT-CONFLICT | TASK-OVERFLOW | VD-INFEASIBLE | TOOLING-BROKEN
    specIds: array of string
    detail: string
  task.reviewed:
    taskId: string
    decision: string, approve | request_changes | advisory_only
    target: string, implementer | test-writer | architect | contract | none
    reportPath: string, reviews/<taskId>.md
  task.rework:
    taskId: string
    target: string, implementer | test-writer | planner | architect | critic
    attempt: integer, the attempt number the re-run will carry
    reason: string
    findingPath: string or null
  task.approved:
    taskId: string
    implSha: string, 40 hex
  task.failed:
    taskId: string
    reason: string, cap_exhausted | unparseable_handoff | blocked
    detail: string
preconditions:
  - design.tasks.ready was published and taskId is in design/tasks.json
postconditions:
  - for every taskId exactly one of task.approved or task.failed is published
  - task.tests_red for a task is published only after a task.tests_written with no later task.tests_rejected
  - task.verified is published only after task.impl_done of the same attempt
external_identifiers:
  - all event types above and the enum values of reason, result, type, decision, target
compatibility_rules:
  - adding a payload field, a reason value or a finding type => minor bump
  - removing or renaming => major bump
error_taxonomy:
  - "envelope_invalid — see bus:CTR-001"
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_per_resource
  read_consistency: strong
  idempotency: "at_least_once_with_key:(type,runId,payload.taskId,payload.attempt)"
  time_source: "wall_clock:single_process"
data_scope: not_applicable
policy_refs:
  - factory:POL-002
test_obligation:
  predicate: |
    Each task-lane event type is accepted with a complete payload and
    rejected with `envelope_invalid` on a missing field or an enum value
    outside its set; a scripted lane emits the postcondition order.
  test_template: contract
  boundary_classes:
    - each event type complete
    - each enum field invalid
    - lane with one implementer rework
  failure_scenarios:
    - task.approved and task.failed both emitted for one task
    - task.verified without preceding task.impl_done
---
```

```yaml
---
id: bus:CTR-006
type: Contract
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:41.895Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: bus
title: assembly events
surface_ref: bus:SUR-001
schema:
  assembly.started:
    taskOrder: array of string, task IDs in merge order (topological over dependsOn)
  assembly.verified:
    result: string, green | red
    step: string, install | typecheck | test | sdd_ready
    evidencePath: string
    failingCovers: array of string, product spec IDs of failing tests, empty when green
  assembly.triaged:
    taskId: string or null
    target: string, implementer | test-writer | planner
    reason: string
  assembly.rework:
    round: integer, 1-based
    taskId: string
    target: string, implementer | test-writer | planner
preconditions:
  - every task of the run has task.approved
postconditions:
  - assembly.verified{green, step: sdd_ready} precedes run.published
  - assembly.rework.round never exceeds the assembly round cap of the assembly-stage partition
external_identifiers:
  - event types assembly.started, assembly.verified, assembly.triaged, assembly.rework
  - enum values of result, step, target
compatibility_rules:
  - adding a step or target value => minor bump
  - removing or renaming => major bump
error_taxonomy:
  - "envelope_invalid — see bus:CTR-001"
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: "at_least_once_with_key:(type,runId,payload.round)"
  time_source: "wall_clock:single_process"
data_scope: not_applicable
policy_refs:
  - factory:POL-002
test_obligation:
  predicate: |
    Each assembly event type is accepted with a complete payload and
    rejected on an enum value outside its set; a scripted run emits
    assembly.verified{green, step: sdd_ready} before run.published.
  test_template: contract
  boundary_classes:
    - each event type complete
    - each enum field invalid
  failure_scenarios:
    - run.published without a green sdd_ready verification
---
```

```yaml
---
id: bus:CTR-007
type: Contract
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:41.895Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: bus
title: handoff file protocol
surface_ref: bus:SUR-002
schema:
  path:
    stage_roles: ".factory/runs/<runId>/handoffs/<role>/handoff.md"
    lane_roles: ".factory/runs/<runId>/handoffs/tasks/<taskId>/<role>-<attempt>/handoff.md"
  format: |
    UTF-8 Markdown. Line 1 is `---`; the YAML frontmatter ends at the next
    line that is exactly `---`; everything after it is a free-text body
    the reactors do not parse.
  common_keys:
    role: string, the role name
    attempt: integer, 1-based
  required_keys_by_role:
    spec-analyst:
      status: complete | blocked
      lint_exit: integer
      records: object with integer values for behaviors, contracts, invariants, scenarios, constraints, policies, open_questions, assumptions
      blocked_reason: string, required when status is blocked
    spec-critic:
      status: complete
      decision: accept | rework
      findings: array of {id ^GA-[0-9]{3}$, kind gap | conflict | weasel | untestable | missing_negative | unmodeled_term, target_ids array, required_change string, resolution decide | assume}
      assumptions_added: array of string, "<slug>:ASM-NNN"
    architect:
      status: complete | blocked
      modules: array of {id ^M-[0-9]{2}$, name, covers array}
      tooling: object {node, test_cmd, typecheck_cmd, dependencies array, dev_dependencies array}
    verification-designer:
      status: complete | blocked
      obligations: array of {id, input_classes integer, negative_oracle boolean}
    planner:
      status: complete | blocked
      tasks_path: string, design/tasks.json
      task_count: integer
      uncovered_ids: array, empty when status is complete
    test-writer:
      status: complete | blocked
      test_files: array of string
      covers: array of string
      blocked_reason: string, required when blocked
    implementer:
      status: complete | blocked | finding
      changed_files: array of string
      finding: object {type TEST-CONTRACT-CONFLICT | TASK-OVERFLOW | VD-INFEASIBLE | TOOLING-BROKEN, spec_ids array, detail}, required when status is finding
    reviewer:
      decision: approve | request_changes | advisory_only
      target: implementer | test-writer | architect | contract | none
      findings: array of {id ^RV-[0-9]{3}$, severity blocking | advisory, target, spec_ids array, evidence string}
    triage:
      status: complete
      route: object {task_id string or null, target implementer | test-writer | planner, reason}
preconditions:
  - the role invocation has ended (API loop returned or subprocess exited)
postconditions:
  - the foreman reads only the frontmatter; the body is copied verbatim into the trace
  - an unparseable handoff follows bus:BEH-003
  - a `decision` key is the only decision carrier; keys named verdict, status (for reviewer) or result are not accepted as substitutes
external_identifiers:
  - file name handoff.md and the directory layout above
  - every key name and enum value listed in required_keys_by_role
compatibility_rules:
  - adding an optional key => minor bump on bus:SUR-002
  - adding a required key, renaming a key or removing an enum value => major bump
error_taxonomy:
  - "missing_file"
  - "missing_frontmatter"
  - "yaml_parse_error"
  - "missing_required_key:<key>"
  - "invalid_enum_value:<key>"
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
  - factory:POL-003
test_obligation:
  predicate: |
    For each role, a fixture handoff with every required key parses into
    the typed record; removing each required key in turn yields
    `missing_required_key:<key>`; an out-of-enum value yields
    `invalid_enum_value:<key>`; a reviewer file carrying `verdict:` but no
    `decision:` yields `missing_required_key:decision`.
  test_template: contract
  boundary_classes:
    - each role, complete frontmatter
    - each required key removed
    - each enum key invalid
    - body containing a second `---` line
  failure_scenarios:
    - body parsed as frontmatter
    - substitute key accepted as decision
---
```

```yaml
---
id: bus:CTR-008
type: Contract
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:41.895Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: bus
title: shared run state snapshot (state.json)
surface_ref: bus:SUR-002
schema:
  path: ".factory/runs/<runId>/state.json"
  schemaVersion: integer, literal 1
  runId: string
  slug: string
  operator: string
  status: string, one of started | workspace | spec_drafting | spec_review | spec_approved | designing | planning | building | assembling | publishing | published | failed
  startedAt: string, ISO-8601 UTC
  updatedAt: string, ISO-8601 UTC, equals occurredAt of the last applied event
  lastSeq: integer, trace sequence number of the last applied event
  stageAttempts:
    lintCycles: integer
    criticRounds: integer
    plannerRecuts: integer
    architectRepairs: integer
    assemblyRounds: integer
  tasks:
    "<taskId>":
      status: string, one of ready | tests_pending | tests_red | impl_pending | verify_pending | review_pending | approved | failed
      attempts:
        implementer: integer
        testWriter: integer
      baseSha: string or null
      testsSha: string or null
      implSha: string or null
      worktree: string
      covers: array of string
      writes: array of string
      lastEvent: string, event type
  costLedger:
    entries: array of {participant, taskId string or null, stage, costUsd number or null, inputTokens, outputTokens, model string or null, durationMs}
    totalUsd: number
  failure: object or null, {stage, reason, detail} once status is failed
preconditions:
  - run.started was applied
postconditions:
  - the file is valid JSON at every instant it exists (atomic rename, bus:BEH-004)
  - status and every task status are consistent with the last applied event
external_identifiers:
  - file name state.json and every key above
  - enum values of status and tasks.<id>.status
compatibility_rules:
  - adding a key => minor bump on bus:SUR-002
  - removing or renaming a key or enum value => major bump; schemaVersion increments
error_taxonomy:
  - "state_write_failed — write or rename failed; run.failed{reason: runtime_error}"
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: none
  time_source: "wall_clock:single_process"
data_scope: all_data
policy_refs:
  - factory:POL-002
  - factory:POL-003
test_obligation:
  predicate: |
    After a scripted happy-path run, state.json validates against the
    schema, status is `published`, every task is `approved` with three
    non-null shas, and costLedger.totalUsd equals the sum of entry costs
    with null treated as 0; after a scripted lane failure, status is
    `failed` and `failure.reason` is `cap_exhausted`.
  test_template: contract
  boundary_classes:
    - happy path
    - cap exhaustion
    - run with null costs
  failure_scenarios:
    - status published with a task not approved
    - totalUsd differs from the entry sum
---
```

---

## 8. Invariants

```yaml
---
id: bus:INV-001
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:41.895Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: bus
title: every transition is caused by exactly one recorded event
always: |
  For every change of `status` or of any `tasks.<id>.status` in
  state.json there exists exactly one event in trace.jsonl whose `seq`
  equals the snapshot's `lastSeq` at the time of the change, and that
  event's type is an accepted trigger for that transition.
scope: state.json and trace.jsonl of one run
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
  - a status change with lastSeq pointing at a duplicate_ignored event is a violation
out_of_scope:
  - changes to costLedger (not a transition)
test_obligation:
  predicate: |
    Replaying trace.jsonl through the pure transition function reproduces
    every intermediate state.json snapshot captured during a scripted
    run; a snapshot with a status change and no matching event fails.
  test_template: property
  boundary_classes:
    - happy path replay
    - replay with reworks
  failure_scenarios:
    - snapshot not reproducible from events
---
```

```yaml
---
id: bus:INV-002
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:41.895Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: bus
title: attempt counters are monotonic non-decreasing
always: |
  For every task and every role, `tasks.<id>.attempts.<role>` in
  consecutive state.json snapshots never decreases, and
  `stageAttempts.*` never decreases within a run, including after a lane
  restart (`git reset --hard baseSha`).
scope: state.json of one run
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
  - a lane restart that resets implementer attempts to 0 is a violation
out_of_scope:
  - counters across different runs
test_obligation:
  predicate: |
    Across all snapshots of a scripted run containing one test-writer
    rework (lane restart) and two implementer reworks, every attempt
    counter sequence is non-decreasing.
  test_template: property
  boundary_classes:
    - lane restart
    - implementer rework
  failure_scenarios:
    - counter reset on restart
---
```

```yaml
---
id: bus:INV-003
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:41.895Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: bus
title: two LLM participants are simultaneously active in design and build
always: |
  In every run that reaches `design.tasks.ready`, the active intervals
  of architect and verification-designer (from their first
  `inference.started` to their `design.*.ready` event) overlap in time.
  In every run whose tasks.json has two or more tasks without a
  dependsOn relation between them, at least two task lanes have
  overlapping active intervals (from `task.ready` to `task.approved` or
  `task.failed`).
scope: trace.jsonl of one run
evidence: test_probe
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_global
  read_consistency: strong
  idempotency: none
  time_source: "wall_clock:single_process"
negative_cases:
  - a run where verification-designer starts only after design.tech.ready is a violation
  - a run with independent tasks executed strictly one after another is a violation
out_of_scope:
  - runs whose tasks.json forms a single dependency chain (lanes are then sequential by design)
test_obligation:
  predicate: |
    From the trace of a scripted run with stubbed participants that
    sleep, the computed intervals of architect and verification-designer
    overlap, and the intervals of two independent tasks overlap.
  test_template: integration
  boundary_classes:
    - two independent tasks
    - chain of dependent tasks (exempt)
  failure_scenarios:
    - design roles serialized
    - independent lanes serialized
---
```

```yaml
---
id: bus:INV-004
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:41.895Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: bus
title: exactly one terminal event per run
always: |
  trace.jsonl of a finished run contains exactly one event whose type is
  run.published or run.failed, it is the last bus event, and state.json
  status is published or failed accordingly.
scope: one run
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
  - a run.failed followed by run.published is a violation
  - a finished process with no terminal event is a violation
out_of_scope:
  - runs killed by SIGKILL from outside the process
test_obligation:
  predicate: |
    For a scripted successful run and a scripted failing run, the count
    of terminal events in trace.jsonl is 1 and it is the last line.
  test_template: integration
  boundary_classes:
    - success
    - failure at each stage
  failure_scenarios:
    - zero terminal events
    - two terminal events
---
```

---

## 9. External dependencies

```yaml
---
id: bus:EXT-001
type: ExternalDependency
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:41.895Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: bus
title: Mozaik agent runtime
provider: JigJoy (npm package @mozaik-ai/core)
provider_surface@version: "@mozaik-ai/core@4.1.0"
authority_url_or_doc: https://docs.jigjoy.ai
consumer_contract: |
  The factory uses defineRuntime, initializeRuntime, createAgent, join,
  sendEvent, runLoop, SemanticEvent.create and the RuntimeState base
  class, with the Anthropic provider selected by model name. The factory
  depends on runLoop being fire-and-forget and on handlers being
  synchronous situation/processor pairs.
interface: npm ESM package, in-process API
failure_modes:
  - runLoop rejection surfaces as an unhandled rejection (bus:BEH-006)
  - tokenUsage absent on inference.completed (trace computes null cost)
fallback_policy: none; the run fails fast (bus:BEH-006)
drift_detection:
  mechanism: "none_with_review_by:2026-11-30"
last_verified_at: "2026-10-29"
auth_scope: not_applicable
rate_limits: not_applicable
retry_idempotency: not_applicable
error_taxonomy: not_applicable
sandbox_or_fixture: not_applicable
applicability:
  invariant_to_all_axes: true
data_scope: not_applicable
test_obligation:
  predicate: |
    package.json pins "@mozaik-ai/core" to the exact string "4.1.0" and
    package-lock.json resolves it to 4.1.0; a smoke test initialises a
    runtime with two participants and delivers one event end to end.
  test_template: contract
  boundary_classes:
    - lockfile resolution
    - two-participant smoke run
  failure_scenarios:
    - dependency range allows a beta
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

none (inherits factory:POL-001, factory:POL-002, factory:POL-003)

---

## 13. Constraints

```yaml
---
id: bus:CST-001
type: Constraint
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:41.895Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: bus
title: Mozaik runtime pinned to 4.1.0
constraint: |
  package.json declares "@mozaik-ai/core": "4.1.0" (exact, no range) and
  the lockfile resolves to that version.
rationale: |
  The track rules require the factory to be built on Mozaik. The `latest`
  dist-tag resolves to 4.2.0-beta with a different, incomplete API
  (no createAgent, createHuman or RuntimeState); the documentation and
  the published examples describe 4.1.0.
scope: factory package manifest
applicability:
  invariant_to_all_axes: true
data_scope: not_applicable
test_obligation:
  predicate: |
    package.json dependencies["@mozaik-ai/core"] equals "4.1.0" verbatim.
  test_template: contract
  boundary_classes:
    - canonical package.json
  failure_scenarios:
    - caret or tilde range
    - version other than 4.1.0
---
```

```yaml
---
id: bus:CST-002
type: Constraint
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:41.895Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: bus
title: at least two LLM participants run concurrently
constraint: |
  The runtime hosts at least two distinct LLM participants whose active
  intervals overlap during the design stage and, for independent tasks,
  during the build stage (bus:INV-003).
rationale: |
  Track rule: a factory must have two or more agents genuinely running
  concurrently; one agent with a pile of tools does not count.
scope: runtime composition
applicability:
  invariant_to_all_axes: true
data_scope: not_applicable
test_obligation:
  predicate: |
    The composition root joins architect and verification-designer as two
    distinct participants with distinct names and both handle
    spec.approved.
  test_template: unit
  boundary_classes:
    - composition root participant list
  failure_scenarios:
    - a single participant handling both design roles
---
```

```yaml
---
id: bus:CST-003
type: Constraint
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:41.895Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: bus
title: handoff re-run cap
constraint: |
  An unparseable handoff triggers exactly one automatic re-run of the
  role per task (or per stage); the second unparseable handoff is a
  failure (bus:BEH-003). The value 1 is read from factory config key
  `caps.handoffRerun`.
rationale: |
  A second malformed handoff from a fresh context is evidence of a
  prompt defect, not noise; spending a third invocation delays the run
  without new information.
scope: foreman handoff parsing
applicability:
  invariant_to_all_axes: true
data_scope: not_applicable
test_obligation:
  predicate: |
    With caps.handoffRerun = 1, a role that never writes a handoff is
    invoked exactly twice.
  test_template: unit
  boundary_classes:
    - cap value 1
  failure_scenarios:
    - third invocation
---
```

---

## 14. Migrations

none

---

## 15. Deltas

```yaml
---
id: bus:DLT-001
type: Delta
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T21:29:20.672Z
    change_request: surface members and state keys 0.2.0
    scope: first-time-approval
partition_id: bus
title: factory-events and handoff-files 0.1.0 -> 0.2.0 - list boundary behaviours as Surface members
target_ids:
  - bus:SUR-001
  - bus:SUR-002
  - bus:BEH-001
  - bus:BEH-002
  - bus:BEH-003
  - bus:BEH-004
  - bus:BEH-005
  - bus:BEH-006
kind: replace
compatibility_action: ignore
baseline_version: factory:BL-001@v0.1.0
surface_impact:
  - id: bus:SUR-001
    intended_version: "0.2.0"
  - id: bus:SUR-002
    intended_version: "0.2.0"
description: |
  BEH-001, BEH-002, BEH-005 and BEH-006 declare surface_ref bus:SUR-001 and
  BEH-003, BEH-004 declare surface_ref bus:SUR-002, but the Surfaces list
  only their Contracts as members, which `sdd ready` reports as
  surface_member_drift. Finalising this Delta adds the behaviours to the
  members and bumps both Surface versions. No observable behaviour changes.
tests_old_behavior:
  - bus:CTR-001 to bus:CTR-008 contract tests stay green
tests_new_behavior:
  - to:bus:BEH-001
  - to:bus:BEH-002
  - to:bus:BEH-003
  - to:bus:BEH-004
  - to:bus:BEH-005
  - to:bus:BEH-006
test_obligation:
  predicate: |
    After finalize, bus:SUR-001.members contains BEH-001, BEH-002, BEH-005,
    BEH-006 and bus:SUR-002.members contains BEH-003, BEH-004; `sdd ready
    --partition bus` reports no surface_member_drift.
  test_template: contract
  boundary_classes:
    - members after finalize
  failure_scenarios:
    - drift still reported
---
```

```yaml
---
id: bus:DLT-002
type: Delta
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T21:29:20.672Z
    change_request: surface members and state keys 0.2.0
    scope: first-time-approval
partition_id: bus
title: state.json - add design progress, per-task dependsOn and handoff re-run counters, assumption counters
target_ids:
  - bus:CTR-008
  - bus:SUR-002
kind: replace
compatibility_action: ignore
baseline_version: factory:BL-001@v0.1.0
surface_impact:
  - id: bus:SUR-002
    intended_version: "0.2.0"
description: |
  The pure transition function needs every fact a transition depends on
  inside state.json, otherwise replay (bus:INV-001) cannot reproduce the
  snapshots. Added keys: `design {techReady, verificationReady, tasksPath}`
  for the planner barrier; `tasks.<id>.dependsOn` (string array) for lane
  scheduling; `tasks.<id>.handoffReruns` and `stageHandoffReruns`
  (role -> integer) for bus:BEH-003; `assumptionsByRecord` (spec id ->
  integer) for the critic assumption cap. schemaVersion stays 1: keys are
  added, none removed or renamed.
tests_old_behavior:
  - bus:CTR-008 contract test on the initial snapshot shape stays green with the added keys present
tests_new_behavior:
  - to:bus:CTR-008
  - to:bus:BEH-003
test_obligation:
  predicate: |
    createRunState yields the added keys with their zero values; a task
    created from tasks.json carries dependsOn and an empty handoffReruns
    map.
  test_template: unit
  boundary_classes:
    - initial run state
    - initial task state
  failure_scenarios:
    - a key missing from the snapshot
---
```

```yaml
---
id: bus:DLT-003
type: Delta
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-30T10:53:11.600Z
    change_request: participant roster
    scope: first-time-approval
partition_id: bus
title: factory-events 0.2.0 -> 0.3.0 - participant roster as event senders
target_ids:
  - bus:SUR-001
  - bus:CTR-001
kind: replace
compatibility_action: ignore
baseline_version: factory:BL-001@v0.1.0
surface_impact:
  - id: bus:SUR-001
    intended_version: "0.3.0"
description: |
  Until now one Mozaik participant named `bus` sent every event and the
  producer existed only as an envelope field, so the Mozaik roster showed
  a single sender and the lanes were invisible as participants. bus:BEH-007
  introduces a participant roster: one joined participant per producer
  name, per-task participants for the lane roles, and the sender of every
  SemanticEvent is the participant named by the envelope producer.
  bus:CTR-001 gains the error_taxonomy value `producer_not_joined`
  (publication from a producer with no joined participant). The envelope
  fields, event types and producer names are unchanged.
tests_old_behavior:
  - bus:CTR-001 envelope test stays green (producer field, seq, occurredAt unchanged)
tests_new_behavior:
  - to:bus:BEH-007
  - to:build-stage:BEH-017
test_obligation:
  predicate: |
    After finalize bus:SUR-001.members contains bus:BEH-007 and
    `sdd ready --partition bus` reports no surface_member_drift.
  test_template: contract
  boundary_classes:
    - members after finalize
  failure_scenarios:
    - drift still reported
---
```

---

## 16. Implementation bindings

none (greenfield; bindings are added with the first implementation PR)

---

## 17. Open questions

```yaml
---
id: bus:OQ-001
type: Open-Q
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:41.895Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: bus
question: |
  How many automatic re-runs does an unparseable handoff get before the
  task or stage fails?
options:
  - id: a
    label: one_rerun
    consequence: |
      Fast failure; a prompt defect surfaces after two invocations.
  - id: b
    label: two_reruns
    consequence: |
      One more chance for transient model output noise; adds one
      invocation of cost and time per malformed handoff.
blocking: no
owner: sdd-factory
default_if_unresolved: a
---
```

```yaml
---
id: bus:OQ-002
type: Open-Q
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:41.895Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: bus
question: |
  How does the foreman treat a duplicate or out-of-order event?
options:
  - id: a
    label: ignore_and_log
    consequence: |
      The run continues; the trace shows the ignored delivery; a real
      ordering bug is visible only in the trace.
  - id: b
    label: fail_run
    consequence: |
      Any duplicate terminates the run; a benign double delivery from
      the runtime costs a whole run.
blocking: no
owner: sdd-factory
default_if_unresolved: a
---
```

```yaml
---
id: bus:OQ-003
type: Open-Q
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:41.895Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: bus
question: |
  Is state.json written after every transition or debounced?
options:
  - id: a
    label: every_transition
    consequence: |
      Snapshot always matches the last event; one small file write per
      event.
  - id: b
    label: debounced
    consequence: |
      Fewer writes; a crash loses the last transitions and bus:INV-001
      cannot be checked from the snapshot.
blocking: no
owner: sdd-factory
default_if_unresolved: a
---
```

---

## 18. Assumptions

```yaml
---
id: bus:ASM-001
type: ASSUMPTION
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:41.895Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: bus
assumption: |
  caps.handoffRerun defaults to 1 (bus:CST-003).
source_open_q: bus:OQ-001
blocking: no
review_by: "2026-10-31"
default_if_unresolved: keep_assumption
tests:
  - tests/bus/handoff-rerun-cap.test.ts
---
```

```yaml
---
id: bus:ASM-002
type: ASSUMPTION
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:41.895Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: bus
assumption: |
  Duplicate and out-of-order events are ignored and logged, never fatal
  (bus:BEH-002).
source_open_q: bus:OQ-002
blocking: no
review_by: "2026-10-31"
default_if_unresolved: keep_assumption
tests:
  - tests/bus/duplicate-event.test.ts
---
```

```yaml
---
id: bus:ASM-003
type: ASSUMPTION
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:41.895Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: bus
assumption: |
  state.json is written after every transition (bus:BEH-004).
source_open_q: bus:OQ-003
blocking: no
review_by: "2026-10-31"
default_if_unresolved: keep_assumption
tests:
  - tests/bus/state-snapshot.test.ts
---
```

---

## 19. Out of scope

- Delivery of events across processes, hosts or Mozaik Cloud; the bus is
  in-process.
- Persistence of the full event history in state.json (trace.jsonl owns
  history, trace partition).
- Resuming a run from a state.json snapshot after a crash.
- Semantics of each stage's transitions (owned by spec-stage,
  design-stage, build-stage, assembly-stage); this partition fixes the
  vocabulary and the mechanics only.
- Cost computation and reporting (trace partition).
