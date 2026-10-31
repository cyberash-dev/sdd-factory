import { join, relative } from "node:path";
import type { ParsedHandoff } from "../../bus/domain/handoff.js";
import type { Effect, PendingEvent } from "../../bus/domain/transition.js";
import type { EffectContext } from "../../bus/ports/outbound/effect-runner.js";
import { readTextOrNull } from "../../shared/fs/text.js";
import type { ToolTraceEntry } from "../../shared/llm/tools.js";
import type { SliceContext } from "../../shared/slice.js";
import { fileTools, sddTool } from "../adapters/role-tools.js";
import { isRecord } from "../domain/guards.js";
import { parseSpecRecords } from "../domain/spec-records.js";
import { effectInteger, effectStringOrNull } from "./effect-fields.js";
import { invokeRole, promptBody, type HandoffVerdict } from "./role-invocation.js";
import { concludeStage, outputTail, specBlocked, type StageDeps } from "./stage-deps.js";
import { hasYamlInvalidRecords, lintProductSpecWithFix } from "./spec-lint.js";

const ANALYST_MESSAGE = `Draft attempt {{attempt}} of the product spec for "{{slug}}".
Source spec: {{spec_source_path}}
Product directory: {{product_dir}}
Run directory: {{run_dir}}
Handoff to write as your last action: {{handoff_path}}
Critic findings to apply (none on attempt 1): {{rework_finding}}
Relative paths given to read_file, write_file and list_dir resolve against the product directory; absolute paths are accepted.`;

const ANALYST_MAX_OUTPUT_TOKENS = 32000;

const RECORD_COUNT_KEYS = ["behaviors", "contracts", "invariants", "scenarios", "constraints", "policies", "open_questions", "assumptions"] as const;

const RECORD_TYPE_BY_COUNT_KEY: Readonly<Record<(typeof RECORD_COUNT_KEYS)[number], string>> = {
  behaviors: "Behavior",
  contracts: "Contract",
  invariants: "Invariant",
  scenarios: "Scenario",
  constraints: "Constraint",
  policies: "Policy",
  open_questions: "Open-Q",
  assumptions: "ASSUMPTION",
};

type RecordCounts = Readonly<Record<string, number>>;

interface BlockedDraft {
  readonly kind: "blocked";
  readonly blockedReason: string;
  readonly recordCounts: RecordCounts | null;
}

type DraftResult = { readonly kind: "complete"; readonly recordCounts: RecordCounts } | BlockedDraft;

function recordCountsOf(raw: unknown): RecordCounts | string {
  if (!isRecord(raw)) {
    return "records must be a mapping of integer counts";
  }
  const counts: Record<string, number> = {};
  for (const key of RECORD_COUNT_KEYS) {
    const value = raw[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      return `records.${key} must be a non-negative integer`;
    }
    counts[key] = value;
  }
  return counts;
}

async function verifyAnalystHandoff(handoff: ParsedHandoff): Promise<HandoffVerdict<DraftResult>> {
  const frontmatter = handoff.frontmatter;
  if (frontmatter["status"] === "blocked") {
    const blockedReason = frontmatter["blocked_reason"];
    if (typeof blockedReason !== "string") {
      return { kind: "retry", error: "blocked_reason must be text" };
    }
    const recordCounts = recordCountsOf(frontmatter["records"]);
    return { kind: "ok", value: { kind: "blocked", blockedReason, recordCounts: typeof recordCounts === "string" ? null : recordCounts } };
  }
  const lintExit = frontmatter["lint_exit"];
  if (typeof lintExit !== "number" || !Number.isInteger(lintExit)) {
    return { kind: "retry", error: "lint_exit must be an integer" };
  }
  if (lintExit !== 0) {
    return { kind: "abort", error: `handoff status complete with lint_exit ${lintExit}` };
  }
  const recordCounts = recordCountsOf(frontmatter["records"]);
  return typeof recordCounts === "string" ? { kind: "retry", error: recordCounts } : { kind: "ok", value: { kind: "complete", recordCounts } };
}

async function specRecordCounts(productDir: string): Promise<RecordCounts> {
  const records = parseSpecRecords((await readTextOrNull(join(productDir, "spec", "spec.md"))) ?? "");
  return Object.fromEntries(RECORD_COUNT_KEYS.map((key) => [key, records.filter((record) => record.type === RECORD_TYPE_BY_COUNT_KEY[key]).length]));
}

function specDrafted(attempt: number, recordCounts: RecordCounts): PendingEvent {
  return { type: "spec.drafted", producer: "spec-analyst", payload: { attempt, lintExit: 0, recordCounts } };
}

/* spec-stage:DLT-006, spec-stage:DLT-012: a lint_cap handoff over a spec the foreman's lint passes, as written or after the simple-fixer repairs a yaml_invalid fence, continues as a draft. */
async function concludeBlockedHandoff(context: EffectContext, slice: SliceContext, deps: StageDeps, attempt: number, blocked: BlockedDraft): Promise<void> {
  const isLintCap = blocked.blockedReason.startsWith("lint_cap");
  if (isLintCap) {
    const productDir = slice.paths.productDir;
    const hadYamlInvalidRecords = await hasYamlInvalidRecords(productDir);
    const lint = await lintProductSpecWithFix(slice, deps, context);
    if (lint.exitCode === 0) {
      slice.log(`spec-analyst attempt ${attempt}: lint cap reached on a clean spec, draft accepted`);
      context.publish(specDrafted(attempt, hadYamlInvalidRecords || blocked.recordCounts === null ? await specRecordCounts(productDir) : blocked.recordCounts));
      return;
    }
  }
  concludeStage(deps, context, specBlocked("spec-analyst", isLintCap ? "lint_cap" : "analyst_blocked", blocked.blockedReason));
}

function assertSourceInsideRepo(slice: SliceContext): void {
  const rel = relative(slice.paths.repoRoot, slice.paths.specSourcePath);
  if (rel.startsWith("..")) {
    throw new Error(`source spec ${slice.paths.specSourcePath} must live inside the repository root ${slice.paths.repoRoot}`);
  }
}

export async function runDraft(effect: Effect, context: EffectContext, slice: SliceContext, deps: StageDeps): Promise<void> {
  const attempt = effectInteger(effect, "attempt");
  const reworkFinding = effectStringOrNull(effect, "reworkFinding");
  assertSourceInsideRepo(slice);
  if (attempt === 1) {
    deps.clock.start(slice.config.timeouts.specStageMs, () => {
      context.publish(specBlocked("foreman", "analyst_blocked", `stage_timeout: spec stage exceeded ${slice.config.timeouts.specStageMs} ms`));
    });
  }
  const { productDir, runDir, handoffsDir, specSourcePath, repoRoot } = slice.paths;
  const handoffPath = join(handoffsDir, "spec-analyst", "handoff.md");
  const variables = {
    slug: slice.slug,
    spec_source_path: specSourcePath,
    product_dir: productDir,
    run_dir: runDir,
    handoff_path: handoffPath,
    attempt: String(attempt),
    rework_finding: reworkFinding ?? "none",
  };
  const trace: ToolTraceEntry[] = [];
  const sdd = sddTool(deps.commands, productDir, slice.config.caps.lintCycles, (entry) => trace.push(entry));
  const tools = [
    ...fileTools({
      repoRoot,
      productDir,
      reads: [specSourcePath, join(productDir, "spec"), join(runDir, "tmp")],
      writes: [join(productDir, "spec", "spec.md"), join(runDir, "tmp"), join(handoffsDir, "spec-analyst")],
      lists: [productDir, join(runDir, "tmp")],
      trace: (entry) => trace.push(entry),
    }),
    sdd.tool,
  ];
  const outcome = await invokeRole(slice, {
    role: "spec-analyst",
    instruction: slice.prompts.render(promptBody(await slice.prompts.load("spec-analyst")), variables),
    message: slice.prompts.render(ANALYST_MESSAGE, variables),
    model: slice.config.models.default,
    tools,
    maxOutputTokens: ANALYST_MAX_OUTPUT_TOKENS,
    handoffPath,
    verify: verifyAnalystHandoff,
  });
  slice.log(`spec-analyst attempt ${attempt}: ${sdd.lintRuns()} lint runs, ${trace.length} tool calls, outcome ${outcome.kind}`);
  if (outcome.kind === "aborted") {
    concludeStage(deps, context, specBlocked("spec-analyst", "analyst_blocked", outcome.error));
    return;
  }
  if (outcome.kind === "unparseable") {
    concludeStage(deps, context, specBlocked("spec-analyst", "analyst_blocked", `unparseable_handoff: ${outcome.error}`));
    return;
  }
  if (outcome.value.kind === "blocked") {
    await concludeBlockedHandoff(context, slice, deps, attempt, outcome.value);
    return;
  }
  const lint = await lintProductSpecWithFix(slice, deps, context);
  if (lint.exitCode !== 0) {
    concludeStage(deps, context, specBlocked("spec-analyst", "analyst_blocked", `lint_failed: ${outputTail(lint)}`));
    return;
  }
  context.publish(specDrafted(attempt, outcome.value.recordCounts));
}
