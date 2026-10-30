# sdd-factory — trace partition

> Single source of truth for the factory's run trace: the machine log,
> the human report, the intervention log and the cost ledger. Version
> 0.1.0. Every record in this file is `lifecycle.status: proposed`; the
> agent that authored it cannot self-approve, promotion to `approved`
> requires a human `sdd approve` + `sdd finalize`.

---

## 1. Context

The track scores transparency on one deliverable: a trace of the run with
time and cost per task. The `trace` partition owns the tracer participant,
a deterministic observer that subscribes to every bus event and to the
runtime's inference events, and the four files it produces under
`.factory/runs/<runId>/trace/`: `trace.jsonl` (append-only machine log),
`trace.md` (human report), `interventions.md` (every human action, with
the launch pre-authorization as its first line) and `costs.json` (per-task
and per-stage durations, tokens and USD).

Cost comes from two sources. API-driven roles report token usage through
the runtime's `inference.completed` events and the tracer prices them with
a model price table from factory config. Subprocess roles (`claude -p`)
report `costUsd` and token counts in the payload of their lane events; the
tracer takes those values as authoritative. Unknown prices never fail a
run: the entry carries `costUsd: null` and the report says so.

At the end of a successful run the trace directory is copied into the
published product tree, so judges read it next to the code.

---

## 2. Glossary

- **Trace directory** — `.factory/runs/<runId>/trace/`.
- **Published trace** — the copy of the trace directory at
  `hidden/<slug>/trace/` written at `run.published`.
- **Seq** — 1-based, strictly increasing by 1, sequence number of a line
  in trace.jsonl.
- **Elapsed** — milliseconds between `run.started.occurredAt` and the
  event's `occurredAt`.
- **Stage** — `workspace` (run.started → workspace.ready), `spec`
  (spec.*), `design` (design.*), `build` (task.*), `assembly`
  (assembly.*), `publish` (run.published or run.failed).
- **Task duration** — milliseconds from `task.ready.occurredAt` to the
  `occurredAt` of `task.approved` or `task.failed` for that taskId; lane
  restarts do not reset the start.
- **Price table** — factory config map `pricing.<model>` with
  `inputPerMTok` and `outputPerMTok` in USD.
- **Cost entry** — one row of the cost ledger: participant, taskId or
  null, stage, model or null, inputTokens, outputTokens, costUsd or null,
  durationMs.
- **Secret value** — the value of any environment variable of the factory
  process whose name matches `/KEY|TOKEN|SECRET|PASSWORD/i` and whose
  length is at least 8 characters.
- **Redaction** — replacing every occurrence of a secret value with the
  literal `[REDACTED]` before a byte is written.

---

## 3. Partition

```yaml
---
id: trace
type: Partition
partition_id: trace
owner_team: sdd-factory
gate_scope:
  - trace
dependencies_on_other_partitions:
  - factory:SUR-001
  - factory:POL-001
  - factory:POL-002
  - factory:POL-003
  - bus:SUR-001
default_policy_set:
  - factory:POL-001
  - factory:POL-002
  - factory:POL-003
id_namespace: trace
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
id: trace:SUR-001
type: Surface
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.223Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: trace
name: trace-files
version: "0.3.1"
boundary_type: public_storage
members:
  - trace:CTR-001
  - trace:CTR-002
  - trace:CTR-003
  - trace:CTR-004
  - trace:BEH-001
  - trace:BEH-002
  - trace:BEH-003
  - trace:BEH-004
  - trace:BEH-005
  - trace:BEH-006
  - trace:BEH-007
  - trace:BEH-008
  - trace:BEH-009
  - trace:BEH-010
consumer_compat_policy: semver_per_surface
notes: |
  Consumers are the hackathon judges (reading hidden/<slug>/trace/ on
  GitHub), the README's "how to read a run" section, and the factory's
  own tests. Adding a column or a key is a minor bump; renaming or
  removing one, or changing the line format of interventions.md, is a
  major bump.
---
```

---

## 6. Requirements

```yaml
---
id: trace:BEH-001
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.223Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: trace
title: tracer records every event as it is dispatched
surface_ref: trace:SUR-001
given: |
  - the tracer participant joined the runtime before run.started was
    published
when: |
  any bus event (bus:SUR-001) or a runtime `inference.started`,
  `inference.completed`, `participant.joined` or `participant.left`
  event is dispatched
then: |
  - one line is appended to trace.jsonl within the same dispatch, before
    the tracer's handler returns, carrying the record of trace:CTR-001
  - `seq` is the previous seq plus 1 (1 for run.started)
  - `elapsedMs` is occurredAt minus run.started.occurredAt
  - the line is redacted (trace:BEH-006) before the write
negative_cases:
  - "the append fails => the tracer publishes run.failed{stage, reason: trace_write_failed} and no further non-terminal event is recorded"
  - "a runtime event arrives before run.started => it is buffered and written after the run.started line with seq 2 onward"
out_of_scope:
  - events of other runs sharing the process (one run per process)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: none
  time_source: "wall_clock:single_process"
data_scope: new_writes_only
policy_refs:
  - factory:POL-003
test_obligation:
  predicate: |
    After a scripted run with N bus events and M runtime events,
    trace.jsonl has N+M lines, seq runs 1..N+M, each line's elapsedMs is
    non-negative and non-decreasing, and the first line is run.started.
  test_template: integration
  boundary_classes:
    - run with runtime events interleaved
    - runtime event before run.started
    - append failure injected
  failure_scenarios:
    - gap or repeat in seq
    - event missing from the log
---
```

```yaml
---
id: trace:BEH-002
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.223Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: trace
title: task duration and attempts are computed from lane events
surface_ref: trace:SUR-001
given: |
  - trace.jsonl contains the lane events of task T
when: trace.md and costs.json are regenerated (trace:BEH-008)
then: |
  - T's durationMs equals occurredAt(task.approved or task.failed for T)
    minus occurredAt(first task.ready for T); for an unfinished task it
    equals elapsed since the first task.ready
  - T's attempts.implementer equals the highest `attempt` seen in
    task.impl_done for T; attempts.testWriter likewise from
    task.tests_written
  - T's outcome is approved | failed | in_progress
negative_cases:
  - a lane restart publishes a second task.ready for T => the start
    stays the first task.ready
out_of_scope:
  - wall time spent waiting for a free lane slot before task.ready
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: none
  time_source: "wall_clock:single_process"
data_scope: all_data
policy_refs:
  - factory:POL-001
test_obligation:
  predicate: |
    For a fixture trace with one lane restart and two implementer
    attempts, the computed row has durationMs equal to the literal
    difference of the fixture timestamps, attempts.implementer 2,
    attempts.testWriter 2 and outcome approved.
  test_template: unit
  boundary_classes:
    - single attempt
    - lane restart
    - unfinished task
  failure_scenarios:
    - start reset on lane restart
    - attempts taken from task.rework instead of role events
---
```

```yaml
---
id: trace:BEH-003
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.223Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: trace
title: stage duration is computed from first to last stage event
surface_ref: trace:SUR-001
given: |
  - trace.jsonl contains events of a stage S
when: trace.md and costs.json are regenerated
then: |
  - S.startedAt is the occurredAt of the first event whose type maps to
    S (Glossary "Stage"); S.endedAt is the occurredAt of the last such
    event, or of the event that opens the next stage when that is later
  - S.durationMs = endedAt minus startedAt
  - stages with no events are absent from the tables
negative_cases:
  - an event of stage S arrives after the next stage opened (a late
    `task.reviewed` during assembly) => it extends S.endedAt
out_of_scope:
  - sub-stage breakdown inside build (owned by per-task rows)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: none
  time_source: "wall_clock:single_process"
data_scope: all_data
policy_refs:
  - factory:POL-001
test_obligation:
  predicate: |
    For a fixture trace, each stage row's startedAt, endedAt and
    durationMs equal hand-written literals; a run that failed in design
    has no build or assembly rows.
  test_template: unit
  boundary_classes:
    - full run
    - run failed in design
    - late event of an earlier stage
  failure_scenarios:
    - stage row present without events
---
```

```yaml
---
id: trace:BEH-004
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.223Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: trace
title: cost of API roles is priced from token usage
surface_ref: trace:SUR-001
given: |
  - a runtime `inference.completed` event for participant P with
    `tokenUsage.inputTokens`, `tokenUsage.outputTokens` and `model`
  - factory config holds `pricing.<model>.inputPerMTok` and
    `pricing.<model>.outputPerMTok`
when: the tracer records the event
then: |
  - a cost entry is appended with participant P, the current stage, the
    taskId of P's current lane or null, model, both token counts,
    durationMs = occurredAt minus the matching inference.started
    occurredAt, and costUsd = inputTokens * inputPerMTok / 1e6 +
    outputTokens * outputPerMTok / 1e6, rounded to 6 decimals
negative_cases:
  - "model has no price table entry => costUsd null, tokens recorded, a line `warning: no price for model <model>` in trace.md, the run continues"
  - "tokenUsage is absent => costUsd null, tokens 0, same warning with `no token usage`"
  - "the matching inference.started is missing => durationMs 0"
out_of_scope:
  - cache-read or cache-write token classes (priced as input tokens)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_global
  read_consistency: strong
  idempotency: none
  time_source: "wall_clock:single_process"
data_scope: new_writes_only
policy_refs:
  - factory:POL-001
test_obligation:
  predicate: |
    With pricing {m: {inputPerMTok: 3, outputPerMTok: 15}} an
    inference.completed with 1000 input and 200 output tokens yields
    costUsd 0.006; a model absent from pricing yields null and a
    warning line; the tracer never throws in either case.
  test_template: unit
  boundary_classes:
    - priced model
    - unpriced model
    - missing tokenUsage
  failure_scenarios:
    - exception on unknown model
    - cost computed with wrong unit
---
```

```yaml
---
id: trace:BEH-005
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.223Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: trace
title: cost of subprocess roles is taken from lane event payloads
surface_ref: trace:SUR-001
given: |
  - a `task.tests_written` or `task.impl_done` event with costUsd,
    inputTokens, outputTokens and durationMs in its payload
when: the tracer records the event
then: |
  - a cost entry is appended with participant test-writer or
    implementer, stage build, the event's taskId, model null, and the
    payload values copied verbatim
  - the entry is never re-priced from the price table
negative_cases:
  - costUsd is null in the payload (subprocess produced no result
    message) => the entry keeps null and trace.md reports the task's
    cost as `n/a` with the token counts shown
out_of_scope:
  - subprocess stderr volume or retries inside the CLI
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: multi_per_resource
  read_consistency: strong
  idempotency: "at_least_once_with_key:(type,runId,payload.taskId,payload.attempt)"
  time_source: "wall_clock:single_process"
data_scope: new_writes_only
policy_refs:
  - factory:POL-001
test_obligation:
  predicate: |
    A task.impl_done with costUsd 0.42 produces one cost entry with
    costUsd 0.42 and model null; a duplicate delivery of the same event
    produces no second entry.
  test_template: unit
  boundary_classes:
    - priced payload
    - null payload cost
    - duplicate delivery
  failure_scenarios:
    - payload cost overwritten by table pricing
    - duplicate entry
---
```

```yaml
---
id: trace:BEH-006
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.223Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: trace
title: secrets are redacted before any trace write
surface_ref: trace:SUR-001
given: |
  - the set of secret values (Glossary) is computed once at tracer start
    from process.env
when: any byte sequence is written to a trace file
then: |
  - every occurrence of every secret value in the text is replaced by
    `[REDACTED]` before the write
  - the replacement applies to event payloads, handoff bodies copied into
    the report, warning lines and file paths alike
negative_cases:
  - a secret value shorter than 8 characters is not redacted (too short
    to be a credential; redacting it would corrupt ordinary words)
out_of_scope:
  - secrets that never entered the process environment
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: none
  time_source: none
data_scope: new_writes_only
policy_refs:
  - factory:POL-003
test_obligation:
  predicate: |
    With FAKE_API_KEY=sk-test-1234567890 in the environment and an event
    payload containing that value, no trace file contains the value and
    trace.jsonl contains `[REDACTED]` at its position.
  test_template: integration
  boundary_classes:
    - secret in payload
    - secret in handoff body
    - 7-character variable value (not redacted)
  failure_scenarios:
    - secret present in any trace file
---
```

```yaml
---
id: trace:BEH-007
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.223Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: trace
title: trace directory is copied into the published product
surface_ref: trace:SUR-001
given: |
  - the assembler is about to publish the product tree (factory:CTR-004)
when: the publish step runs
then: |
  - the tracer regenerates trace.md and costs.json (trace:BEH-008), then
    the four trace files are copied to `hidden/<slug>/trace/` in the
    team repository before the publish commit is created
  - after run.published is recorded, trace.jsonl in the run directory
    receives that final line; the published copy ends with the last
    event before run.published and trace.md states the outcome
    `published`
negative_cases:
  - the run fails => nothing is copied; the trace stays in the run
    directory
out_of_scope:
  - pushing the published trace (owned by the publish step of
    assembly-stage)
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
    After a scripted successful run, hidden/<slug>/trace/ contains
    trace.jsonl, trace.md, interventions.md and costs.json, and trace.md
    contains the outcome line `published`; after a scripted failed run
    hidden/<slug>/trace/ does not exist.
  test_template: integration
  boundary_classes:
    - success
    - failure
  failure_scenarios:
    - published trace missing a file
    - trace copied on failure
---
```

```yaml
---
id: trace:BEH-008
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.223Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: trace
title: report files are regenerated at stage boundaries and task outcomes
surface_ref: trace:SUR-001
given: |
  - trace.jsonl holds the events recorded so far
when: |
  the tracer records workspace.ready, spec.approved, spec.blocked,
  design.tasks.ready, design.blocked, task.approved, task.failed,
  assembly.verified, run.published or run.failed
then: |
  - trace.md (trace:CTR-002) and costs.json (trace:CTR-004) are
    rewritten in full from trace.jsonl and the cost ledger, via
    write-to-temp-file then atomic rename
  - both files reflect every event up to and including the triggering
    one
negative_cases:
  - the rewrite fails => run.failed{reason: trace_write_failed}
out_of_scope:
  - regeneration after every single event (bus-level noise)
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
    During a scripted run, trace.md's modification count equals the
    number of triggering events, and after each trigger the task table
    contains the just-finished task's row.
  test_template: integration
  boundary_classes:
    - each triggering event type
    - a non-triggering event (task.impl_done) leaves trace.md unchanged
  failure_scenarios:
    - stale report after task.approved
    - partial file visible at the final path
---
```

```yaml
---
id: trace:BEH-009
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.223Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: trace
title: human interventions are logged as they happen
surface_ref: trace:SUR-001
given: |
  - interventions.md exists in the trace directory (created at
    run.started)
when: the tracer records run.started or a human.intervention event
then: |
  - on run.started the file is created with line 1 in the format of
    trace:CTR-003 with kind `launch`, actor = payload.operator and the
    note `pre-authorized at launch: spec and baseline approvals
    delegated to the factory`
  - on human.intervention one line is appended immediately in the same
    format with the event's kind, actor and note
  - on run.published or run.failed the final line `mid-run
    interventions: <n>` is appended, where n counts lines with kind
    `mid_run_nudge`
negative_cases:
  - "human.intervention{kind: launch} after line 1 => a line is still appended (the log is complete) but it does not count as mid-run"
out_of_scope:
  - detecting human edits of the product between runs (those are a new
    run with kind fix_between_runs reported at launch)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: none
  time_source: "wall_clock:single_process"
data_scope: new_writes_only
policy_refs:
  - factory:POL-001
test_obligation:
  predicate: |
    A scripted run with zero human.intervention events yields an
    interventions.md whose first line has kind launch and whose last
    line is `mid-run interventions: 0`; a run with two mid_run_nudge
    events yields `mid-run interventions: 2` and four lines in total.
  test_template: integration
  boundary_classes:
    - zero interventions
    - two mid-run nudges
    - one fix_between_runs at launch
  failure_scenarios:
    - missing launch line
    - count excludes a mid-run nudge
---
```

```yaml
---
id: trace:BEH-010
type: Behavior
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-30T11:13:14.872Z
    change_request: mozaik cloud mirror
    scope: first-time-approval
partition_id: trace
title: events are mirrored to Mozaik Cloud when MOZAIK_API_KEY is set
surface_ref: trace:SUR-001
given: |
  - the process environment carries MOZAIK_API_KEY (trace:EXT-001)
  - the secret value set of trace:BEH-006 is known
when: the trace slice joins its participants, before run.started is published
then: |
  - a participant named `mozaik-cloud-exporter` joins the runtime and
    receives every SemanticEvent of the run: bus events and runtime
    events alike
  - every forwarded payload passes the trace redactor first; the mirror
    never carries a secret value (trace:INV-003)
  - the exporter learns the roster from `runtime.state.getParticipants()`,
    so lane participants (build-stage:BEH-017) appear in the cloud roster
  - the session URL `<appUrl>/?s=<sessionId>` is logged once and written
    into the trace.md header as `cloud: <url>` (trace:CTR-002)
  - at slice shutdown the exporter flushes its queue before the process
    exits; the flush is bounded by timeouts.shutdownMs
negative_cases:
  - "MOZAIK_API_KEY absent or empty => no exporter participant joins, no network request is made, trace.md header reads `cloud: none`"
  - "transport failure (network error, 4xx, 5xx, rejected ingest) => the run continues; one Warnings line `warning: cloud export dropped <n> event(s): <reason>` per failed batch; the mirror misses those events, the trace files do not"
  - "an exception inside the exporter handler => caught, counted as a dropped event with the same warning line; the run continues (bus:BEH-006 is not triggered)"
out_of_scope:
  - the cloud UI and what it renders
  - pairing flow and credential files of the SDK (only the environment variable is read)
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: eventual
  idempotency: none
  time_source: none
data_scope: new_writes_only
policy_refs:
  - factory:POL-003
test_obligation:
  predicate: |
    In a scripted run with MOZAIK_API_KEY set and a fake fetch, the roster
    contains mozaik-cloud-exporter before run.started is recorded, the
    fake fetch receives every published bus event type and the
    inference.completed events, a payload carrying a secret value arrives
    redacted, and trace.md's header carries `cloud: <url>`; with a fetch
    that rejects every request the run still ends with run.published and
    Warnings carries the cloud export line; without the key no exporter
    participant exists, fetch is never called and the header reads
    `cloud: none`.
  test_template: integration
  boundary_classes:
    - key present, transport healthy
    - key present, transport failing
    - key absent
    - secret value in a forwarded payload
  failure_scenarios:
    - run.failed caused by the mirror
    - secret value in a forwarded payload
    - exporter joined after run.started
---
```

---

## 7. Data contracts

```yaml
---
id: trace:CTR-001
type: Contract
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.223Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: trace
title: trace.jsonl machine log
surface_ref: trace:SUR-001
schema:
  path: .factory/runs/<runId>/trace/trace.jsonl (published copy at hidden/<slug>/trace/trace.jsonl)
  encoding: UTF-8, one JSON object per line, LF terminated, no blank lines
  line:
    seq: integer, 1-based, previous seq + 1
    elapsedMs: integer, >= 0
    type: string, bus event type or runtime event type (inference.started | inference.completed | participant.joined | participant.left)
    runId: string
    occurredAt: string, ISO-8601 UTC
    producer: string, participant name or "runtime"
    payload: object, the event payload after redaction; for runtime events the fields {participant, model, tokenUsage {inputTokens, outputTokens}} when present
preconditions:
  - run.started has been dispatched
postconditions:
  - the file is append-only; a line, once written, is never modified
  - the last line of a finished run is run.published or run.failed
external_identifiers:
  - file name trace.jsonl and the key names seq, elapsedMs, type, runId, occurredAt, producer, payload
compatibility_rules:
  - adding a key => minor bump on trace:SUR-001
  - renaming or removing a key, or changing seq semantics => major bump
error_taxonomy:
  - "trace_write_failed — append failed; run.failed{reason: trace_write_failed}"
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: none
  time_source: "wall_clock:single_process"
data_scope: new_writes_only
policy_refs:
  - factory:POL-003
test_obligation:
  predicate: |
    Every line of a scripted run's trace.jsonl parses as JSON with the
    seven keys, seq is contiguous from 1, and byte comparison of the file
    captured mid-run against its prefix in the final file is equal.
  test_template: contract
  boundary_classes:
    - full run
    - mid-run snapshot prefix
  failure_scenarios:
    - rewritten earlier line
    - missing key
---
```

```yaml
---
id: trace:CTR-002
type: Contract
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.223Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: trace
title: trace.md human report
surface_ref: trace:SUR-001
schema:
  path: .factory/runs/<runId>/trace/trace.md (published copy at hidden/<slug>/trace/trace.md)
  sections_in_order:
    - "# Run <runId>"
    - "header list: slug, operator, mode (autonomous), startedAt, finishedAt or in progress, outcome (published | failed:<stage>/<reason> | in_progress)"
    - "## Stages — table columns: stage, startedAt, endedAt, durationMs, costUsd"
    - "## Tasks — table columns: taskId, title, implementer attempts, test-writer attempts, durationMs, costUsd, inputTokens, outputTokens, outcome"
    - "## Totals — durationMs, costUsd, inputTokens, outputTokens, unknown-cost entries"
    - "## Assumptions — one bullet per ASSUMPTION record in spec/spec.md and spec/assumptions.md of the product: id and assumption text"
    - "## Interventions — `mid-run interventions: <n>` and a link to interventions.md"
    - "## Warnings — one bullet per warning line (unpriced model, missing token usage), or `none`"
  number_formats:
    costUsd: "fixed 4 decimals, or n/a when null"
    durationMs: integer
preconditions:
  - at least run.started was recorded
postconditions:
  - the file is regenerated in full at the triggers of trace:BEH-008
  - every task of design/tasks.json has a row once task.ready was recorded
external_identifiers:
  - file name trace.md, the section titles and table column names above
compatibility_rules:
  - adding a column or section at the end => minor bump
  - renaming or reordering sections or columns => major bump
error_taxonomy:
  - "trace_write_failed — see trace:CTR-001"
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: none
  time_source: none
data_scope: all_data
policy_refs:
  - factory:POL-003
test_obligation:
  predicate: |
    For a fixture trace, the generated trace.md contains the eight
    sections in order, a Tasks row per task with hand-written literal
    values, and a Totals line whose costUsd equals the literal sum.
  test_template: contract
  boundary_classes:
    - run with null costs
    - failed run
    - run with warnings
  failure_scenarios:
    - section missing or out of order
    - task without a row
---
```

```yaml
---
id: trace:CTR-003
type: Contract
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.223Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: trace
title: interventions.md human action log
surface_ref: trace:SUR-001
schema:
  path: .factory/runs/<runId>/trace/interventions.md (published copy at hidden/<slug>/trace/interventions.md)
  line_format: |
    <occurredAt> <kind> actor=<actor> note="<note>"
    where a double quote inside <note> is escaped as \" and the line ends with LF
  line_1: "kind launch, actor = operator, note = pre-authorized at launch: spec and baseline approvals delegated to the factory"
  last_line: "mid-run interventions: <n>"
  last_line_written_at: run.published or run.failed
  kinds: launch | fix_between_runs | mid_run_nudge
preconditions:
  - run.started recorded
postconditions:
  - line 1 always has kind launch
  - the count n equals the number of lines with kind mid_run_nudge
external_identifiers:
  - file name interventions.md, the line format, the kind values, the literal `mid-run interventions:`
compatibility_rules:
  - adding a kind value => minor bump
  - changing the line format or the final line literal => major bump
error_taxonomy:
  - "trace_write_failed — see trace:CTR-001"
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: none
  time_source: "wall_clock:single_process"
data_scope: new_writes_only
policy_refs:
  - factory:POL-001
  - factory:POL-003
test_obligation:
  predicate: |
    A fixture run with one mid_run_nudge produces exactly three lines:
    a launch line matching the line format, the nudge line, and
    `mid-run interventions: 1`.
  test_template: contract
  boundary_classes:
    - zero nudges
    - note containing a double quote
  failure_scenarios:
    - count mismatch
    - line format drift
---
```

```yaml
---
id: trace:CTR-004
type: Contract
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.223Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: trace
title: costs.json ledger
surface_ref: trace:SUR-001
schema:
  path: .factory/runs/<runId>/trace/costs.json (published copy at hidden/<slug>/trace/costs.json)
  schemaVersion: integer, literal 1
  runId: string
  pricing: object, the price table used, model -> {inputPerMTok, outputPerMTok}
  stages: array of {stage, startedAt, endedAt, durationMs, costUsd number or null, inputTokens, outputTokens}
  tasks: array of {taskId, title, attempts {implementer, testWriter}, durationMs, costUsd number or null, inputTokens, outputTokens, models array of string, outcome approved | failed | in_progress}
  participants: array of {name, inferences integer, costUsd number or null, inputTokens, outputTokens}
  entries: array of cost entries (Glossary) in record order
  totals: {durationMs, costUsd, inputTokens, outputTokens, unknownCostEntries integer}
  rounding: costUsd values carry at most 6 decimals; a null entry contributes 0 to sums and 1 to unknownCostEntries
preconditions:
  - at least run.started recorded
postconditions:
  - regenerated in full at the triggers of trace:BEH-008
  - totals.costUsd equals the sum over entries, and equals the sum over tasks plus entries with taskId null
external_identifiers:
  - file name costs.json and every key above
compatibility_rules:
  - adding a key => minor bump
  - removing or renaming a key => major bump; schemaVersion increments
error_taxonomy:
  - "trace_write_failed — see trace:CTR-001"
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: none
  time_source: none
data_scope: all_data
policy_refs:
  - factory:POL-003
test_obligation:
  predicate: |
    For a fixture ledger with three entries (0.01, null, 0.02) the file
    has totals.costUsd 0.03 and totals.unknownCostEntries 1; the per-task
    sums and the per-stage sums each equal 0.03.
  test_template: contract
  boundary_classes:
    - null entry
    - entry with taskId null
  failure_scenarios:
    - totals differ from entry sum
    - null counted as NaN
---
```

---

## 8. Invariants

```yaml
---
id: trace:INV-001
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.223Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: trace
title: every bus event appears exactly once, in order
always: |
  For a finished run, the multiset of bus events dispatched by the
  runtime equals the multiset of lines in trace.jsonl whose type is a
  bus event type, and the lines are ordered by seq with non-decreasing
  occurredAt.
scope: trace.jsonl of one run
evidence: public_api
stability: contractual
data_scope: all_data
applicability:
  invariant_to_all_axes: true
concurrency_model:
  actor_concurrency: single
  read_consistency: strong
  idempotency: none
  time_source: "wall_clock:single_process"
negative_cases:
  - an event recorded twice with two seq values is a violation
  - a dispatched event absent from the file is a violation
out_of_scope:
  - runtime events dropped before the tracer joined (the tracer joins first, bus:BEH-001)
test_obligation:
  predicate: |
    Capturing every publish call in a scripted run and comparing with
    trace.jsonl yields equal ordered lists of (type, taskId, attempt).
  test_template: integration
  boundary_classes:
    - run with duplicates delivered by the runtime (recorded once each delivery, flagged by the foreman)
  failure_scenarios:
    - missing line
    - order differs from dispatch order
---
```

```yaml
---
id: trace:INV-002
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.223Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: trace
title: report totals equal ledger sums
always: |
  In every generated pair (trace.md, costs.json), the Totals of trace.md
  equal costs.json.totals, and costs.json.totals.costUsd equals the sum
  of costs.json.entries[*].costUsd with null counted as 0, the sum of
  tasks[*].costUsd plus entries with taskId null, and the sum of
  stages[*].costUsd.
scope: trace.md and costs.json of one run
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
  - a task row whose cost is absent from the stage sum is a violation
out_of_scope:
  - rounding differences beyond 6 decimals
test_obligation:
  predicate: |
    For a randomly generated ledger (property test), the three sums and
    the trace.md Totals line agree within 1e-6.
  test_template: property
  boundary_classes:
    - all null
    - mixed null and numbers
  failure_scenarios:
    - sums disagree
---
```

```yaml
---
id: trace:INV-003
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.223Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: trace
title: trace files never contain a secret value
never: |
  Any of the four trace files, in the run directory or in the published
  copy, contains an occurrence of a secret value (Glossary) of the
  factory process.
scope: trace directory and published trace
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
  - a secret inside a handoff body copied into trace.md is a violation
out_of_scope:
  - secrets shorter than 8 characters
test_obligation:
  predicate: |
    With three fake secrets of lengths 8, 40 and 200 in the environment
    and each injected into an event payload and a handoff body, a byte
    search of every trace file finds none of them.
  test_template: integration
  boundary_classes:
    - secret at line start
    - secret inside JSON string
    - secret in a path
  failure_scenarios:
    - any occurrence found
---
```

```yaml
---
id: trace:INV-004
type: Invariant
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.223Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: trace
title: trace.jsonl is append-only
always: |
  For any two captures of trace.jsonl during one run, the earlier
  capture is a byte prefix of the later one.
scope: trace.jsonl of one run
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
  - a regenerated trace.jsonl (as trace.md is regenerated) is a violation
out_of_scope:
  - the published copy, which is a snapshot taken once
test_obligation:
  predicate: |
    Captures taken after every event of a scripted run form a chain of
    byte prefixes.
  test_template: integration
  boundary_classes:
    - capture after each event
  failure_scenarios:
    - earlier capture not a prefix
---
```

---

## 9. External dependencies

```yaml
---
id: trace:EXT-001
type: ExternalDependency
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-30T11:13:14.557Z
    change_request: mozaik cloud mirror
    scope: first-time-approval
partition_id: trace
title: Mozaik Cloud event ingestion through the @mozaik-ai/cloud-sdk exporter
provider: JigJoy Mozaik Cloud
provider_surface: "@mozaik-ai/cloud-sdk 0.1.3 exporter entrypoint; ingest endpoint https://api.app.jigjoy.ai (override MOZAIK_CLOUD_ENDPOINT), app https://app.jigjoy.ai"
interface: "createCloudExporter({endpoint, projectKey, participants, fetch, onError, onSessionUrl}) returns a Mozaik participant named mozaik-cloud-exporter plus end(); the participant batches every SemanticEvent (100 events or 1 s) and posts JSON over HTTPS"
authority_url_or_doc: https://www.npmjs.com/package/@mozaik-ai/cloud-sdk
consumer_contract: |
  The trace slice creates the exporter only when MOZAIK_API_KEY is set,
  wraps its handler so that payloads are redacted and exceptions are
  caught (trace:BEH-010), supplies the roster callback, logs the session
  URL from onSessionUrl and calls end() at shutdown. It reads nothing
  back from the cloud.
failure_modes:
  - 401 invalid key
  - 429 rate limited
  - 5xx or network error
  - ingest rejected events (schema or size)
fallback_policy: "mirror only; a failed batch is dropped from the cloud with a warning line, trace files stay complete, the run never fails because of the mirror"
drift_detection:
  mechanism: none_with_review_by:2026-11-30
last_verified_at: "2026-10-30"
auth_scope: MOZAIK_API_KEY environment variable, never written to disk, never forwarded to lanes
rate_limits: provider-enforced per key; one session per run; batches of at most 100 events
retry_idempotency: the SDK retries a failed batch a bounded number of times, then reports it through onError; events are not re-sent afterwards
error_taxonomy:
  - "warning: cloud export dropped <n> event(s): <reason> in trace.md Warnings"
test_obligation:
  predicate: |
    With a fake fetch, every request goes to the configured endpoint and
    the posted bodies contain the published event types; a fetch that
    rejects yields one warning line per failed batch and no run.failed;
    MOZAIK_API_KEY absent yields no request at all.
  test_template: integration
  boundary_classes:
    - healthy transport
    - rejecting transport
    - key absent
  failure_scenarios:
    - mirror failure escalated to run.failed
    - key value appearing in any artefact
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
id: trace:CST-001
type: Constraint
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.223Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: trace
title: trace files are plain text committed with the product
constraint: |
  The four trace files are UTF-8 text (JSON Lines, Markdown, Markdown,
  JSON), each under 16 MB, and the published copy is committed to the
  team repository alongside hidden/<slug>/.
rationale: |
  Judges read the trace on GitHub without tooling; binary or external
  storage would hide the run.
scope: trace directory and published trace
applicability:
  invariant_to_all_axes: true
data_scope: not_applicable
test_obligation:
  predicate: |
    Each trace file of a scripted run decodes as UTF-8 and the publish
    commit contains the four files under hidden/<slug>/trace/.
  test_template: integration
  boundary_classes:
    - publish commit file list
  failure_scenarios:
    - trace file absent from the commit
---
```

---

## 14. Migrations

none

---

## 15. Deltas

```yaml
---
id: trace:DLT-001
type: Delta
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T21:29:21.040Z
    change_request: surface members 0.2.0
    scope: first-time-approval
partition_id: trace
title: trace-files 0.1.0 -> 0.2.0 - list boundary behaviours as Surface members
target_ids:
  - trace:SUR-001
  - trace:BEH-001
  - trace:BEH-002
  - trace:BEH-003
  - trace:BEH-004
  - trace:BEH-005
  - trace:BEH-006
  - trace:BEH-007
  - trace:BEH-008
  - trace:BEH-009
kind: replace
compatibility_action: ignore
baseline_version: factory:BL-001@v0.1.0
surface_impact:
  - id: trace:SUR-001
    intended_version: "0.2.0"
description: |
  BEH-001 to BEH-009 declare surface_ref trace:SUR-001 but the Surface lists
  only its Contracts as members, which `sdd ready` reports as
  surface_member_drift. Finalising this Delta adds the nine behaviours to the
  members and bumps the Surface version. No observable behaviour changes.
tests_old_behavior:
  - trace:CTR-001 to trace:CTR-004 contract tests stay green
tests_new_behavior:
  - to:trace:BEH-001
  - to:trace:BEH-002
  - to:trace:BEH-003
  - to:trace:BEH-004
  - to:trace:BEH-005
  - to:trace:BEH-006
  - to:trace:BEH-007
  - to:trace:BEH-008
  - to:trace:BEH-009
test_obligation:
  predicate: |
    After finalize, trace:SUR-001.members contains BEH-001 to BEH-009 and
    `sdd ready --partition trace` reports no surface_member_drift.
  test_template: contract
  boundary_classes:
    - members after finalize
  failure_scenarios:
    - drift still reported
---
```

```yaml
---
id: trace:DLT-002
type: Delta
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-30T11:13:15.189Z
    change_request: mozaik cloud mirror
    scope: first-time-approval
partition_id: trace
title: trace-files 0.2.0 -> 0.3.0 - cloud session link in the report header
target_ids:
  - trace:SUR-001
  - trace:CTR-002
kind: replace
compatibility_action: ignore
baseline_version: factory:BL-001@v0.1.0
surface_impact:
  - id: trace:SUR-001
    intended_version: "0.3.0"
description: |
  The trace.md header list (trace:CTR-002) gains one item at its end:
  `cloud: <Mozaik Cloud session url>` when the run was mirrored
  (trace:BEH-010), `cloud: none` otherwise. Sections, columns and number
  formats are unchanged; trace:BEH-010 joins the Surface members.
tests_old_behavior:
  - trace:CTR-002 contract test keeps the eight sections in order with the added header item present
tests_new_behavior:
  - to:trace:BEH-010
  - to:trace:CTR-002
test_obligation:
  predicate: |
    After finalize trace:SUR-001.members contains trace:BEH-010 at version
    0.3.0; the generated trace.md header ends with `- cloud: <url>` for a
    mirrored fixture and `- cloud: none` otherwise.
  test_template: contract
  boundary_classes:
    - mirrored run
    - run without mirror
  failure_scenarios:
    - header item missing
    - drift still reported
---
```

```yaml
---
id: trace:DLT-003
type: Delta
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-30T17:12:29.436Z
    change_request: build stage shakedown after run 9
    scope: first-time-approval
partition_id: trace
title: trace-files 0.3.0 -> 0.3.1 - lane inference events are recorded, not priced
target_ids:
  - trace:SUR-001
  - trace:BEH-004
  - trace:BEH-005
  - trace:BEH-010
kind: replace
compatibility_action: ignore
baseline_version: factory:BL-001@v0.1.0
surface_impact:
  - id: trace:SUR-001
    intended_version: "0.3.1"
description: |
  With build-stage:DLT-001 the lane participants publish
  inference.started / inference.completed for their claude -p
  subprocess. The tracer writes those events to trace.jsonl like any
  runtime event and mirrors them to Mozaik Cloud (trace:BEH-010), but
  trace:BEH-004 pricing applies only to inferences of participants that
  are not lane roles: the cost of a lane stays the costUsd of its task
  event (trace:BEH-005), so costs.json and trace.md count every lane
  once. An inference.completed from a lane participant therefore adds
  no cost entry and raises no "no price for model" warning. trace.jsonl
  gains lines of an existing kind only; patch bump.
tests_old_behavior:
  - an API role's inference.completed is still priced from its token usage and the pricing table
tests_new_behavior:
  - to:trace:BEH-004
  - to:trace:BEH-005
test_obligation:
  predicate: |
    Given inference.completed{model: claude-opus-5-5, tokenUsage: {500,
    120}} from a participant named test-writer with capability
    task:T-001 followed by task.tests_written{costUsd: 0.42}, costs.json
    holds exactly one entry for T-001 and test-writer with costUsd 0.42
    and no warning; trace.jsonl holds both the inference line and the
    task line.
  test_template: integration
  boundary_classes:
    - lane inference followed by its task event
    - API role inference (still priced)
  failure_scenarios:
    - the lane inference priced from the table
    - a "no price for model claude-opus-5-5" warning for a lane
---
```

---

## 16. Implementation bindings

none (greenfield; bindings are added with the first implementation PR)

---

## 17. Open questions

```yaml
---
id: trace:OQ-001
type: Open-Q
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.223Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: trace
question: |
  When are trace.md and costs.json regenerated?
options:
  - id: a
    label: stage_boundaries_and_task_outcomes
    consequence: |
      Reports lag by at most one task; one rewrite per trigger (about
      ten to thirty per run).
  - id: b
    label: every_event
    consequence: |
      Always current; hundreds of rewrites per run and contention with
      the append of trace.jsonl.
blocking: no
owner: sdd-factory
default_if_unresolved: a
---
```

```yaml
---
id: trace:OQ-002
type: Open-Q
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.223Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: trace
question: |
  How is an inference with no price table entry reported?
options:
  - id: a
    label: null_with_warning
    consequence: |
      Totals understate cost; the report says so explicitly in Warnings
      and unknownCostEntries.
  - id: b
    label: estimate_with_default_price
    consequence: |
      Totals are complete but invented; a judge cannot tell measured
      from guessed values.
blocking: no
owner: sdd-factory
default_if_unresolved: a
---
```

---

## 18. Assumptions

```yaml
---
id: trace:ASM-001
type: ASSUMPTION
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.223Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: trace
assumption: |
  Reports are regenerated at stage boundaries and task outcomes only
  (trace:BEH-008).
source_open_q: trace:OQ-001
blocking: no
review_by: "2026-10-31"
default_if_unresolved: keep_assumption
tests:
  - tests/trace/report-regeneration.test.ts
---
```

```yaml
---
id: trace:ASM-002
type: ASSUMPTION
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-29T19:40:42.223Z
    change_request: sdd-factory v0.1.0
    scope: first-time-approval
partition_id: trace
assumption: |
  An unpriced model yields costUsd null plus a warning line; no cost is
  ever estimated (trace:BEH-004).
source_open_q: trace:OQ-002
blocking: no
review_by: "2026-10-31"
default_if_unresolved: keep_assumption
tests:
  - tests/trace/pricing.test.ts
---
```

```yaml
---
id: trace:ASM-003
type: ASSUMPTION
lifecycle:
  status: approved
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-10-30T11:30:56.795Z
    change_request: cloud transport and model registry
    scope: first-time-approval
partition_id: trace
assumption: |
  Mozaik core 4.1.0 opens its own cloud session per agent loop whenever
  MOZAIK_API_KEY is visible in the process environment. The factory reads
  the variable into a snapshot at start and blanks it in its own process
  so that the trace exporter (trace:EXT-001, trace:BEH-010) is the single
  transport of the run. Lanes never saw the variable (allowlist).
source_open_q: not_applicable
blocking: no
review_by: "2026-11-30"
default_if_unresolved: keep_assumption
tests:
  - tests/trace/cloud-mirror.test.ts
---
```

---

## 19. Out of scope

- Live dashboards or streaming the trace to Mozaik Cloud (optional
  `MOZAIK_API_KEY` integration is an implementation choice outside this
  spec).
- Pricing accuracy beyond the configured table; the factory does not
  query provider pricing APIs.
- Traces of runs killed from outside the process.
- Aggregation across runs or across specs.
