# sdd-factory

A spec-driven multi-agent software factory built on [Mozaik](https://docs.jigjoy.ai) (`@mozaik-ai/core` 4.1.0) for the JigJoy Software Factory track. One command turns a one-page Markdown spec into a small TypeScript project (CLI or HTTP API) whose tests pass, and publishes it under `hidden/<slug>/`. No human writes code and no human is consulted during a run: every decision a person would have made is either pre-authorised at launch or recorded as an `ASSUMPTION` in the product's own spec.

## What it does

1. **Spec stage.** A *spec-analyst* rewrites the organisers' Markdown into a typed [agent-sdd](https://github.com/cyberash-dev/agent-sdd) specification (`spec/spec.md` inside the product): one record per command, endpoint, behaviour, invariant or constraint, each with a test obligation. It loops on `sdd lint` until the spec is machine-valid. A fresh-context *spec-critic* finds gaps and contradictions and decides every open question. The foreman then executes the approval that the operator pre-authorised at launch (`sdd approve` + `sdd finalize`).
2. **Design stage.** An *architect* and a *verification-designer* run concurrently from the same event and never read each other: one maps records to modules and a toolchain, the other turns every test obligation into input classes and negative oracles. A *planner* reconciles both into `design/tasks.json`: tasks with disjoint write-sets, a dependency DAG, and every approved record covered exactly once. The task graph is validated deterministically before any lane starts.
3. **Build stage.** Each task runs in its own git worktree as a lane: a *test-writer* (Claude Code in print mode, no access to `src/`) writes failing tests with `@covers <record id>` markers; the Verifier proves they fail for the right reason and freezes them; an *implementer* (fresh context) makes them green without touching tests; the Verifier runs typecheck and the full suite; a *reviewer* checks the diff against the spec records and arbitrates test-versus-code disputes. Rework is routed to the most upstream owner (spec → architect → test-writer → implementer) with hard caps. Independent lanes run in parallel.
4. **Assembly.** Approved task branches are merged progressively into `integration`; the *assembler* runs `npm ci`, `tsc`, `vitest` and `sdd ready` (every approved record must be covered by a test) and routes any failure back to the owning lane. A cheap *triage* role classifies failures nobody owns.
5. **Publication.** The product tree plus `trace/` is copied to `hidden/<slug>/`, committed and pushed.

Everything is observable: `trace/trace.jsonl` (every bus event), `trace/trace.md` (time and cost per stage and per task), `trace/costs.json`, `trace/interventions.md` (every human step; the launch pre-authorisation is always line 1).

## Architecture

- **Bus.** Mozaik participants exchange typed `SemanticEvent`s over the Mozaik runtime. The event catalogue (`spec/bus.md`) validates every payload at publication; an unknown type or missing field throws. State lives in one `RunState` snapshot (`state.json`), rewritten atomically after every transition; replaying `trace.jsonl` through the pure transition function reproduces every snapshot.
- **Participants.** Every event producer is a joined Mozaik participant, and every event is sent by the participant it names (`spec/bus.md`, BEH-007). Deterministic roles (foreman, assembler, tracer) are Mozaik humans with situation handlers. LLM stage roles (spec-analyst, spec-critic, architect, verification-designer, planner, reviewer, triage) are Mozaik agents; each invocation runs as a `runLoop` with function tools, so `inference.*`, `function_call.*` and `model.answer` events come from Mozaik itself. The lane roles test-writer and implementer join as Mozaik agent participants per task for the lifetime of the lane and delegate their loop to a `claude --print` subprocess in a git worktree (the pattern of the organisers' Baro factory). The reviewer runs on a different vendor's model (`gpt-6.1-sol` through Mozaik's OpenAI provider) than the implementer, so the two share fewer blind spots. Architect and verification-designer run concurrently in the design stage; independent lanes run concurrently in the build stage and are visible as concurrent participants in the runtime roster.
- **Slices.** The factory's own code is organised by partition of its specification (`spec/*.md`): `bus`, `factory`, `trace`, `spec-stage`, `design-stage`, `build-stage`, `assembly-stage`. Each slice contributes transition rules (pure), effect handlers (I/O) and participants; the composition root wires them. The factory is built with the same methodology it applies: every approved record of `spec/` is covered by a test with an `@covers` marker, and `sdd ready` gates every commit.
- **Autonomy.** The factory detects its own mistakes through deterministic oracles (`sdd lint`, the red/green Verifier, `sdd ready`, the tasks.json validator) and recovers through typed rework routes with caps. When a cap is exhausted the run fails with a terminal report; the operator fixes the factory, never the product, and launches again.

## How to run

Requirements: Node ≥ 22, git, the `claude` CLI logged in (lanes run `claude --print`), `ANTHROPIC_API_KEY` (API roles) and `OPENAI_API_KEY` (the reviewer, see `models.reviewer` in `factory.config.json`). Preflight requires the key of every provider a configured model routes to and exits 3 before the run starts when one is missing.

```sh
npm ci
export ANTHROPIC_API_KEY=...
export OPENAI_API_KEY=...                   # reviewer model; drop it only after pointing models.reviewer at an Anthropic model
export FACTORY_OPERATOR=<your identity>     # owner of the pre-authorised approvals; never an agent name
npm run factory -- run specs/todo-cli.md    # output lands in hidden/todo-cli/
```

The same variables can live in a `.env` file at the repository root (git-ignored); `npm run factory` loads it when present. With `MOZAIK_API_KEY` set (from [app.jigjoy.ai](https://app.jigjoy.ai)) the run is mirrored live into Mozaik Cloud through `@mozaik-ai/cloud-sdk`: every bus and runtime event is forwarded after secret redaction, the session link is logged at start and written into `trace.md` as `cloud:`, and a failing mirror only adds a warning line, never fails the run.

Flags: `--operator <identity>`, `--no-push` (dry run), `--out <dir>`, `--max-parallel-lanes <1..8>`. Mid-run nudges are recorded, never required: `npm run factory -- nudge <runId> --note "..."`.

Exit codes: `0` published, `1` run failed (see the terminal report and `.factory/runs/<runId>/`), `2` usage error, `3` environment error.

`factory.config.json` (template: `factory.config.example.json`): rework caps, timeouts, models per role (`default`, `critic`, `triage`, `reviewer`, `lane`; `reviewer` falls back to `default` when absent), parallel lanes, and a price table (`pricing`) used to cost API roles; lanes report their own cost from `claude --print`. Any model id from Mozaik's supported list works per role; an unknown id or a provider without a key mapping is a configuration error (exit 2).

## Developing the factory

```sh
npm test            # vitest
npm run typecheck   # tsc --noEmit
npx sdd lint        # the factory's own spec
npx sdd ready --partition <bus|factory|trace|spec-stage|design-stage|build-stage|assembly-stage>
```

Prompts live in `prompts/<role>.md`; the handoff protocol every role must honour is `bus:CTR-007`.
