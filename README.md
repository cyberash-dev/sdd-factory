# sdd-factory

A spec-driven multi-agent software factory built on [Mozaik](https://docs.jigjoy.ai) (`@mozaik-ai/core` 4.1.0) for the JigJoy Software Factory track. One command turns a Markdown spec into a small TypeScript project (CLI or HTTP API) whose tests pass, and publishes it under `hidden/<slug>/`. Nobody writes code and nobody is consulted during a run: the operator pre-authorises the spec approval at launch, and every question a person would have answered is decided by an agent and recorded as an `ASSUMPTION` in the product's own spec. The factory applies [agent-sdd](https://github.com/cyberash-dev/agent-sdd) end to end: the product gets a typed, linted, approved specification before any code exists, every test carries an `@covers <record id>` marker, and `sdd ready` gates publication. The factory itself is built the same way (`spec/`, 7 partitions, every approved record covered by a test).

## Quick start

Requirements:

- Node 22.9 or newer (`npm run factory` uses `--env-file-if-exists`; preflight checks the major version; developed on Node 26), git, npm.
- The `claude` CLI on `PATH` and logged in: build lanes and the simple-fixer run `claude --print`.
- `OPENROUTER_API_KEY`: both shipped model profiles route every API role through OpenRouter. `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` are needed only when `factory.config.json` names a direct Anthropic or OpenAI model id.
- `FACTORY_OPERATOR`: the human identity that owns the pre-authorised approvals (or `--operator`). Agent identities are refused.
- Optional `MOZAIK_API_KEY` (from [app.jigjoy.ai](https://app.jigjoy.ai)): mirrors the run live into Mozaik Cloud.

```sh
npm ci
cat > .env <<'EOF'
OPENROUTER_API_KEY=...
FACTORY_OPERATOR=<your identity>
MOZAIK_API_KEY=...            # optional
EOF
npm run factory -- run specs/todo-cli.md
```

`npm run factory` loads `.env` (git-ignored) when present. The run works in `.factory/runs/<slug>-<YYYYMMDD-HHMMSS>/` (`product/`, `worktrees/`, `handoffs/`, `trace/`, `state.json`, `run.json`). On success the verified product tree plus `trace/` is copied to `hidden/<slug>/`, committed in this repository as `factory: <slug> <runId>` and pushed to `origin`. `--no-push` keeps the commit local; `--out <dir>` publishes somewhere else. Sample inputs: `specs/todo-cli.md`, `specs/url-shortener-api.md`.

### Check it without API keys

The factory's own suite is offline: every model role is replaced by a scripted participant, and `tests/factory/full-pipeline.test.ts` drives the whole factory (spec, design, two dependent lanes, assembly, publication to `hidden/<slug>/`) without a key or a network call.

```sh
npm ci && npm test
```

Every published product builds and tests on its own:

```sh
cd hidden/todo-cli && npm ci && npm run build && npm test
node dist/cli.js --help
```

Its run trace is next to it in `hidden/<slug>/trace/trace.md`.

## Pipeline

| Stage | Role | Model (`factory.config.json`) | Runs as | Concurrency |
|---|---|---|---|---|
| spec | spec-analyst | `deepseek/deepseek-v4.1-flash-1017`, effort medium | Mozaik agent | loops on `sdd lint` (cap 8) |
| spec | spec-critic | `openai/gpt-6.1-terra`, effort medium | Mozaik agent, fresh context, another vendor than the analyst | after each draft (cap 4 rounds) |
| spec | foreman | none | deterministic Mozaik participant | runs `sdd approve` + `sdd finalize` |
| design | architect | DeepSeek V4.1 Flash, effort medium | Mozaik agent | in parallel with verification-designer |
| design | verification-designer | DeepSeek V4.1 Flash, effort high | Mozaik agent | in parallel with architect |
| design | planner | DeepSeek V4.1 Flash, effort medium | Mozaik agent | at the barrier after both |
| build | test-writer | `claude-sonnet-5-5`, effort medium | lane: Mozaik participant around `claude --print --safe-mode` | one lane per task, up to 4 lanes at once |
| build | Verifier (red / green check) | none | deterministic, foreman effect | per lane |
| build | implementer | `claude-sonnet-5-5`, effort medium | lane, fresh context | per lane |
| build | reviewer | `openai/gpt-6.1-terra` | Mozaik agent, another vendor than the Claude lanes | per lane, while other lanes code |
| assembly | assembler | none | deterministic Mozaik participant | once every task is approved |
| assembly | triage | DeepSeek V4.1 Flash, effort medium | Mozaik agent | on failures no lane owns |
| any | simple-fixer | `claude-opus-5-5`, effort medium | lane: Mozaik participant around `claude --print --safe-mode` | per failing unit, capped |
| any | tracer | none | deterministic Mozaik participant | every event |

1. **Spec.** The spec-analyst rewrites the Markdown input into a typed agent-sdd spec (`spec/spec.md` inside the product): one record per command, endpoint, behaviour, invariant or constraint, each with a test obligation. The spec-critic finds gaps and contradictions and decides every open question; the foreman then executes the approval the operator pre-authorised at launch. Both roles follow fidelity rules, because acceptance tests are written from the source: reject only what the source names as an error, never weaken a stated sentence through an assumption or an out-of-scope note, keep every name the source spells.
2. **Design.** The architect maps records to modules and a toolchain (`design/tech.md`); the verification-designer turns every test obligation into input classes and negative oracles (`design/verification.md`). The planner reconciles both into `design/tasks.json`: disjoint write-sets, an acyclic dependency graph at most 3 tasks deep, every approved record covered exactly once. The graph is validated mechanically and the foreman installs the declared tooling before any lane starts.
3. **Build.** Each task runs in its own git worktree on branch `task/<id>`. The test-writer writes failing tests with `@covers` markers; the Verifier proves they fail for the right reason and freezes them; the implementer makes them green without touching tests; the Verifier runs typecheck and the full suite and checks the write-set; the reviewer checks the diff against the spec records and arbitrates test-versus-code disputes. Approved branches merge into `integration`.
4. **Assembly.** The assembler runs `npm ci`, `tsc`, `vitest` and `sdd ready` on `integration` and routes an attributed failure back to the owning lane, an unattributed one to triage.
5. **Publication.** Product tree plus `trace/` to `hidden/<slug>/`, commit, push.

The critic and the reviewer run on a different vendor's model than the roles whose output they judge, so judge and author share fewer blind spots. The critic moved from GLM-5.3 Flash to GPT-6.1 Terra after micro-evals on the critic's own rules: GLM passed 20 of 25 calls, every failure a stall at its 32k output cap, at 24 to 207 s per call; Terra passed 25 of 25 at 8 to 12 s per call and a similar cost per call. The reviewer moved from DeepSeek V4.1 Flash to Terra after replaying one real review (room booking T-005) on the same input: DeepSeek took 13 to 14 min, Terra 66 to 88 s at about 0.10 to 0.13 USD billed, and all runs found the same blocking defect (an unhandled rejection that ended the server on a malformed request target).

## How agents run concurrently

Every event producer is a joined Mozaik participant, and every event is sent by the participant it names (`bus:BEH-007`). Deterministic roles (foreman, assembler, tracer) are Mozaik humans with situation handlers. LLM stage roles are Mozaik agents; each invocation is a `runLoop` with function tools, so `inference.*`, `function_call.*` and `model.answer` events come from Mozaik itself. Lane roles join as Mozaik participants per task for the lifetime of the lane and delegate their loop to a `claude --print` subprocess in the task's worktree; the subprocess is reported as `inference.started` / `inference.completed` of that participant, so concurrent lanes are visible as concurrent participants in the runtime roster and in Mozaik Cloud.

```mermaid
flowchart LR
  RS[run.started] --> WR[workspace.ready]
  WR --> SA[spec-analyst<br/>spec.drafted]
  SA --> SC[spec-critic<br/>spec.reviewed]
  SC -- spec.rework --> SA
  SC --> AP[foreman<br/>spec.approved]
  AP --> AR[architect<br/>design.tech.ready]
  AP --> VD[verification-designer<br/>design.verification.ready]
  AR --> PL[planner<br/>design.tasks.ready]
  VD --> PL
  PL --> L1[lane T-001]
  PL --> L2[lane T-002]
  PL --> LN[lane T-n]
  L1 --> AS[assembler<br/>assembly.verified]
  L2 --> AS
  LN --> AS
  AS --> PB[run.published]
```

One lane: `task.ready` -> test-writer -> `task.tests_written` -> red check -> `task.tests_red` -> implementer -> `task.impl_done` -> green check -> `task.verified` -> reviewer -> `task.reviewed` -> `task.approved` -> merge into `integration`.

- **Design fan-out.** One `spec.approved` dispatch starts two Mozaik loops, architect and verification-designer. Their active intervals must overlap (`bus:INV-003`, contractual, tested in `tests/bus/design-concurrency.test.ts`). The planner starts at the barrier when both ready events are in.
- **Lane fan-out.** A task starts as soon as every task in its `dependsOn` is approved, up to `maxParallelLanes` active lanes (4 shipped, `--max-parallel-lanes <1..8>`). Independent ready tasks run their test-writers concurrently (`build-stage:INV-006`). Reviews of finished lanes run while other lanes are still coding.
- **Shared state.** The Mozaik runtime bus carries typed events, validated against the catalogue (`spec/bus.md`) at publication; an unknown type or a missing field throws. A pure transition function turns each event into a new `RunState`, written atomically to `state.json` after every transition, plus effects. Code is shared through git: one worktree per task, merged into `integration`. Roles hand results back through handoff files (`bus:CTR-007`).
- **Isolation.** Write-sets are pairwise disjoint (`design-stage:INV-002`). The critic never sees the analyst's reasoning. Design firewall: the architect never reads `design/verification.md`, the verification-designer reads `spec/spec.md` only; a forbidden read, detected from the tool log, re-runs the role once without that file and blocks the stage on a second one. During a repair the architect may read the task graph. The test-writer never reads `src/` beyond the stubs it is given; the implementer cannot change frozen tests or leave its write-set. Lanes run with `--safe-mode`, so the operator's own CLAUDE.md, skills, hooks and MCP servers never reach the product.

## Autonomy

The factory detects its own mistakes with deterministic oracles and recovers without a person:

- **Oracles:** `sdd lint` on the product spec, the red/green Verifier (typecheck, vitest JSON report, frozen-test and write-set checks), the `tasks.json` validator (coverage partition, disjoint write-sets, acyclic graph, depth and task-size bounds), and `sdd ready` at assembly.
- **Rework routing with caps.** A failure goes to the most upstream owner: spec, architect (`VD-INFEASIBLE`), planner (`TASK-OVERFLOW`, re-cut), test-writer or implementer (a `TEST-CONTRACT-CONFLICT` is arbitrated by the reviewer). Caps are instance configuration in `factory.config.json` (`factory:DLT-015`: the spec fixes each bound and its exhausted outcome, not the number); the shipped profiles set implementer attempts 3, test-writer rework 2, planner re-cuts 2, architect repairs 3, assembly rounds 3, handoff re-runs 2.
- **Simple-fixer** (`factory:BEH-012`, `factory:CST-005`). Before a mechanical failure costs a role attempt, a capped Claude Code subprocess repairs it in place: invalid YAML in the product spec, an unparseable design file, a red-check typecheck or load error, a green-check typecheck or load failure, an assembly install, typecheck or load failure. The foreman snapshots the directory, diffs it after the run and reverts everything when a change leaves the allowed paths (frozen tests are never allowed) or alters parsed spec data; otherwise it re-runs the failing check. Each run publishes `fix.attempted`; at most 2 per owner and unit, then the original failure path applies.
- **Fallbacks.** A reviewer that produces no handoff after its re-runs is retried on `models.default` when that differs, then the foreman records `task.reviewed{decision: advisory_only}` and approves on the Verifier's green evidence; the gap is listed in `trace.md`. Triage without a handoff falls back the same way, then routes to a planner re-cut instead of failing the run. An API role that exceeds `timeouts.apiRoleMs` is re-run once with a "write the handoff first" note (`factory:BEH-011`). A rate-limited lane retries once after 30 s.
- **Watchdog** (`bus:DLT-007`). When nothing is in flight, the queue is empty and the run is not terminal for 2 s, the run fails as `run.failed{reason: stalled}` with every unfinished task in the detail, instead of hanging.
- **Resume and replay.** A failed run continues after a factory fix (see below); a cap that failed the run is granted one more attempt on resume.

Humans act only between runs, and every action is an event: `human.intervention{kind: launch}` (pre-authorisation, always line 1 of `interventions.md`), `fix_between_runs` (written by `factory resume`) and `mid_run_nudge` (recorded, never required). There are zero interactive steps inside a run (`factory:INV-001`).

## Transparency

Trace files are written to `.factory/runs/<runId>/trace/` during the run and published with the product in `hidden/<slug>/trace/`; secrets are redacted before every write.

- `trace.jsonl`: every bus and runtime event, append-only, in order.
- `trace.md`: header (operator, start, finish, outcome, `cloud:` link), a Stages table (start, end, duration, cost), a Tasks table (implementer and test-writer attempts, duration, cost, tokens, outcome, simple-fixes), totals, assumptions, interventions, warnings, and per-task and per-stage sections for fixer runs and advisory reviews.
- `costs.json`: the cost ledger the report totals are summed from.
- `interventions.md`: every human step.
- Per lane run: `handoffs/tasks/<taskId>/<role>-<attempt>/{handoff.md,transcript.jsonl}`, the redacted stream-json of the subprocess written line by line, so a killed lane still leaves evidence. API roles keep their final answer as `answer-run<N>.md`; fixer runs keep `answer-run<n>.md` and `transcript-run<n>.jsonl`.

With `MOZAIK_API_KEY` set, a `mozaik-cloud-exporter` participant forwards every event, redacted, to Mozaik Cloud; the session link is logged at start and written to `trace.md`. A failing mirror adds a warning line and never fails the run.

Cost caveat: API roles are priced from token usage with the `pricing` table in `factory.config.json`. Lane and fixer costs are the API-equivalent figures `claude --print` reports; on a Claude Code subscription nothing is billed per run.

## Results

Rehearsal runs on 2026-10-31, all on the shipped cheap profile, each a fresh `npm run factory -- run specs/<spec>.md --no-push`:

| spec | product | duration | cost (USD) | tasks | max concurrent lanes | human steps | published to |
|---|---|---|---|---|---|---|---|
| `specs/url-shortener-api.md` | HTTP API, 4 endpoints | 31 min | 3.47 | 5 | 2 | 0 | [`hidden/url-shortener-api/`](hidden/url-shortener-api/) |
| `specs/todo-cli.md` | CLI, 5 commands, JSON storage | 24 min | 2.56 | 5 | 3 | 0 | [`hidden/todo-cli/`](hidden/todo-cli/) |
| `specs/room-booking-api.md` (earlier run) | HTTP API, 6 endpoints, interval overlaps | 53 min | 3.75 | 6 | 4 | 1 resume | superseded by the control run below |
| `specs/room-booking-api.md` (control run, final factory) | same | 35 min | 3.02 | 4 | 2 | 0 | [`hidden/room-booking-api/`](hidden/room-booking-api/) |
| `specs/expense-ledger-cli.md` | CLI, 6 commands, options, reports, CSV | 30 min | 4.30 | 7 | 3 | 0 (1 logged prompt note) | [`hidden/expense-ledger-cli/`](hidden/expense-ledger-cli/) |

Every published product was checked from a clean checkout (`npm ci && npm run build && npm test`) and black-box against its source spec (curl for the APIs, `node dist/cli.js` for the CLI). The room booking run needed one resume: the root task's tests asserted on Node's internal `net.Socket.prototype.connect` arguments, the reviewer correctly sent them back twice, and the test-writer cap ended the run; after a prompt fix the resumed run (`--note` in `interventions.md`) re-authored the tests and published. An earlier room booking run had published a product whose `npm run build` failed and that lacked the `start` script its spec names; the assembly now runs the build (`assembly-stage:DLT-005`), checks every npm script the spec names (`assembly-stage:DLT-006`) and the tooling step pins Node types for the build config (`design-stage:DLT-011`).

### Conformance against the source specs

After the rehearsals, four independent auditor agents checked the published products black-box against the source Markdown only, the way hidden acceptance tests would, without reading the products' code, tests or formal specs; they read those afterwards only to attribute each deviation to the stage that introduced it.

| product | stated requirements | inferred edge cases | deviations |
|---|---|---|---|
| url-shortener-api | 40/40 | 78/81 | `PORT=0` rejected; a non-ASCII URL breaks the redirect response |
| todo-cli | 47/49 | 51/51 | an id comes back after `rm` although the source says ids are never reused |
| room-booking-api | 84/84 | 82/88 | valid JSON that is not an object reported as `invalid_json`; seconds accepted in query times |
| expense-ledger-cli | 80/80 | 70/72 | the stored field is `amount_cents`, the source says `amount` |

Output formats, orderings, exit codes and error bodies match byte for byte; 251 of 253 stated checks pass. Four of the six deviations entered at the spec-analyst, one in design and one in code on top of an analyst gap: every later stage followed the formal spec faithfully, including its mistakes, and the products' own tests pinned them. The analyst also chose the strictest reading where the source was silent (an unquoted multi-word `todo add` was a usage error, `.000Z` times were rejected). The fidelity rules above came out of this audit; the products in `hidden/` predate them and still carry the deviations listed. Re-running only the spec stage with the new rules fixed the id reuse, the unquoted `todo add` and the rejected `PORT=0` in the new formal specs; it also exposed a concurrency defect, an architect simple-fix that reverted the verification design written meanwhile, fixed by `design-stage:DLT-012`.

First end-to-end publication in detail: `specs/url-shortener-api.md`, run `url-shortener-api-20261031-004751` on the shipped cheap profile, published to [`hidden/url-shortener-api/`](hidden/url-shortener-api/) with its full trace in [`hidden/url-shortener-api/trace/`](hidden/url-shortener-api/trace/trace.md). Zero human interventions after launch.

| stage | duration | cost (USD) |
|---|---|---|
| workspace (bootstrap, `npm install`) | 2 min 17 s | 0.00 |
| spec (analyst, critic: 3 rounds, approval) | 7 min 41 s | 0.66 |
| design (architect ∥ verification-designer, planner) | 4 min 10 s | 0.72 |
| build (5 tasks, 4 concurrent lanes) | 16 min 55 s | 2.08 |
| assembly (`npm ci`, `tsc`, `vitest`, `sdd ready`, round 1 green) | 6 s | 0.00 |
| **total** | **31 min 9 s** | **3.47** |

| task | what | duration | cost (USD) | notes |
|---|---|---|---|---|
| T-001 | error bodies and JSON responses | 2 min 30 s | 0.22 | ran in parallel with T-002 |
| T-002 | in-memory store and code issuing | 6 min 27 s | 0.32 | |
| T-003 | link creation, statistics, deletion | 3 min 57 s | 0.54 | in parallel with T-004; 1 simple-fixer repair |
| T-004 | redirects | 1 min 57 s | 0.37 | 1 simple-fixer repair |
| T-005 | server composition and port | 6 min 31 s | 0.64 | root task, depends on all |

Of the 3.47 USD, 1.75 is real API spend (OpenRouter: DeepSeek V4.1 Flash, GLM-5.3 Flash) and 1.71 is the API-equivalent figure the Claude Code lanes report (test-writer 0.91, implementer 0.62, simple-fixer 0.18; billed to a subscription, not per run). The published product passes `npm ci && npm run build && npm test` (78 tests) from a clean checkout, and a black-box pass with curl over every endpoint of the spec matches the expected statuses, bodies and headers.

What the factory repaired on its own in that run: two stubs whose interface imports pointed one directory level short (fixed by the simple-fixer before the red check, now prevented at stub generation, `build-stage:DLT-009`), and 15 Behaviours missing from the Surface's members, completed at approval (`spec-stage:DLT-007`).

## Operating the factory

```sh
npm run factory -- run <spec.md> [--operator <id>] [--no-push] [--out <dir>] [--max-parallel-lanes <1..8>]
npm run factory -- resume <runId> [--note <text>] [--force] [--no-push] [--out <dir>] [--max-parallel-lanes <1..8>]
npm run factory -- replay <runId> (--event <seq> | --last)
npm run factory -- nudge <runId> --note <text>
```

- **resume** starts a new run that reuses the failed run's product, worktrees and handoffs, replays the bus trace through the pure transition rules (the whole chain when the failed run was itself a resume), cuts the failure chain (`task.failed`, `spec.blocked`, `design.blocked`, `run.failed`), records `fix_between_runs` and re-publishes the last effectful event plus the lane entry of every task that was in flight. A run that failed on an exhausted cap gets exactly one more attempt for that role. `--force` is required when `run.json` still says `running` (process killed with SIGKILL).
- **replay** rebuilds the state before one recorded event, executes that event's effects with real role runners and prints the events they would publish as JSON lines on stdout, without touching the trace, `state.json` or the cloud. `--last` picks the event resume would redo first. Use it to check a fix on the failed stage before resuming. Exit 0 when no printed event is `*.failed`, `*.blocked` or `*.rejected`, 1 otherwise, 2 for an unknown run or seq.
- **nudge** drops a note into a running run; it is published as `human.intervention{mid_run_nudge}`.
- **stop**: Ctrl-C or SIGTERM publishes `run.failed{reason: terminated}`, forwards the signal to running lanes, closes trace and cloud session and exits 1. The run is resumable without `--force`.

Exit codes: `0` published, `1` run failed (terminal report on stderr, evidence in `.factory/runs/<runId>/`), `2` usage or configuration error (unknown model id, provider without a key mapping), `3` environment error (Node below 22, missing API key, `claude` or `git` not on `PATH`).

**Configuration.** `factory.config.json` (template: `factory.config.example.json`) holds caps, timeouts (spec stage 60 min, API role 30 min, lane 25 min, verifier 5 min), `maxParallelLanes`, models and `pricing`. Model keys: `models.default` (spec-analyst, architect, verification-designer, planner), `critic`, `triage`, `reviewer` (falls back to `default` when null), `lanes.<test-writer|implementer|simple-fixer>` (falls back to `lane`, then the CLI default), and `effort.<role>` for API roles and lanes alike. Two profiles ship: `factory.config.json` (active, the cheap profile described above) and `factory.config.target.json` (`anthropic/claude-opus-5.5` as default with effort high for architect, verification-designer and planner, `openai/gpt-6.1-terra` for critic and reviewer, `openai/gpt-6-luna` for triage, same lanes). Switch with `cp factory.config.target.json factory.config.json`. Beyond Mozaik's bundled model list the factory registers `gpt-6.1-terra` (OpenAI) and the OpenRouter ids `deepseek/deepseek-v4.1-flash-1017`, `z-ai/glm-5.3-flash`, `z-ai/glm-5.3-flash:nitro`, `anthropic/claude-opus-5.5`, `openai/gpt-6.1-terra`, `openai/gpt-6-luna`.

## Developing the factory

```sh
npm test            # vitest: src/**/*.test.ts and tests/**/*.test.ts
npm run typecheck   # tsc --noEmit
npx sdd lint        # the factory's own spec
npx sdd ready --partition <bus|factory|trace|spec-stage|design-stage|build-stage|assembly-stage>
npx sdd record get <id>   # read one spec record, e.g. factory:BEH-012
```

- `spec/<partition>.md`: the factory's specification, one file per partition: `bus` (events, state, handoff protocol), `factory` (CLI, run lifecycle, resume, replay, simple-fixer), `trace` (trace files, costs, cloud mirror), `spec-stage`, `design-stage`, `build-stage`, `assembly-stage`. Behaviour changes land as approved `Delta` records first; tests carry `@covers <partition>:<id>`.
- `src/<partition>/`: one vertical slice per partition with `domain/` (pure transition rules), `application/` (effect handlers), `ports/` and `adapters/` (Mozaik runtime, git, subprocesses, trace files). `src/shared/` holds configuration, the API and CLI role runners, the simple-fixer and design-file parsers; `src/slices.ts` and `src/factory/application/compose.ts` wire the slices; `src/cli.ts` is the entry point.
- `prompts/<role>.md`: one prompt per role (spec-analyst, spec-critic, architect, verification-designer, planner, test-writer, implementer, reviewer, triage, simple-fixer). Every role must honour the handoff protocol `bus:CTR-007`.
- `tests/<partition>/`: integration and scripted-run tests per slice; unit tests sit next to the code.
