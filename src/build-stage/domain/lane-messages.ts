import type { TechModule } from "../../shared/design-files/tech-md.js";
import { renderTemplate, type PromptVariables } from "../../shared/prompts.js";

export interface LaneRecord {
  readonly id: string;
  readonly text: string;
}

export interface LaneMessageInput {
  readonly taskId: string;
  readonly slug: string;
  readonly worktree: string;
  readonly productDir: string;
  readonly handoffPath: string;
  readonly attempt: number;
  readonly specRecords: readonly LaneRecord[];
  readonly verificationBlocks: readonly LaneRecord[];
  readonly techExcerpt: string;
  readonly stubPaths: readonly string[];
  readonly taskEntryJson: string;
  readonly testCmd: string;
  readonly typecheckCmd: string;
  readonly reworkFinding: string | null;
}

export interface ImplementerMessageInput extends LaneMessageInput {
  readonly frozenTestFiles: readonly string[];
}

export interface ArbitrationFinding {
  readonly type: string;
  readonly specIds: readonly string[];
  readonly detail: string;
}

export interface ReviewerMessageInput extends LaneMessageInput {
  readonly mode: "review" | "arbitration";
  readonly implSha: string | null;
  readonly diff: string;
  readonly frozenTestFiles: readonly string[];
  readonly evidenceJson: string | null;
  readonly finding: ArbitrationFinding | null;
  readonly reportPath: string;
}

export const DESIGN_PATHS = { techMd: "design/tech.md", verificationMd: "design/verification.md", tasksJson: "design/tasks.json" } as const;

const NONE = "none";

function fenced(language: string, body: string): string {
  return `\`\`\`${language}\n${body.trimEnd()}\n\`\`\``;
}

function recordSections(records: readonly LaneRecord[], language: string): string {
  return records.length === 0 ? NONE : records.map((record) => `### ${record.id}\n\n${fenced(language, record.text)}`).join("\n\n");
}

function list(items: readonly string[]): string {
  return items.length === 0 ? NONE : items.map((item) => `- \`${item}\``).join("\n");
}

export function techExcerptOf(modules: readonly TechModule[]): string {
  if (modules.length === 0) {
    return NONE;
  }
  return modules
    .map((module) => {
      const header = `### ${module.id} ${module.name}\n\n${module.responsibility}\n\n- owns: ${module.owns.join(", ")}\n- entry: ${module.entry}\n- depends_on: ${module.dependsOn.length === 0 ? NONE : module.dependsOn.join(", ")}\n- covers: ${module.covers.join(", ")}`;
      const notes = module.notes.trim().length === 0 ? "" : `\n\n${module.notes.trim()}`;
      return `${header}\n\n${fenced("ts", module.interfaceSource)}${notes}`;
    })
    .join("\n\n");
}

export function instructionVariables(input: LaneMessageInput): PromptVariables {
  return {
    task_id: input.taskId,
    slug: input.slug,
    worktree: input.worktree,
    product_dir: input.productDir,
    handoff_path: input.handoffPath,
    attempt: String(input.attempt),
    spec_ids: input.specRecords.map((record) => record.id).join(", "),
    verification_md: DESIGN_PATHS.verificationMd,
    tech_md: DESIGN_PATHS.techMd,
    tasks_json: DESIGN_PATHS.tasksJson,
    test_cmd: input.testCmd,
    typecheck_cmd: input.typecheckCmd,
    rework_finding: input.reworkFinding === null ? NONE : "see the Rework finding section of the first message",
  };
}

const COMMON_HEAD = `# Task {{task_id}} — {{role}}, attempt {{attempt}}

Product \`{{slug}}\`. Worktree \`{{worktree}}\`. Write the handoff to \`{{handoff_path}}\`.
Commands: test \`{{test_cmd}}\`; typecheck \`{{typecheck_cmd}}\`.

## Task entry ({{tasks_json}})

{{task_entry}}

## Spec records ({{spec_ids}})

{{spec_records}}`;

const TEST_WRITER_TEMPLATE = `${COMMON_HEAD}

## Verification blocks ({{verification_md}})

{{verification_blocks}}

## Module interface ({{tech_md}} excerpt for this task)

Stub files already in the worktree, the only paths under src/ you may read:
{{stub_paths}}

{{tech_excerpt}}

## Rework finding

{{rework_finding}}
`;

const IMPLEMENTER_TEMPLATE = `${COMMON_HEAD}

## Frozen test files (read-only)

{{frozen_test_files}}

## Module interface ({{tech_md}} excerpt for this task)

{{tech_excerpt}}

## Rework finding

{{rework_finding}}
`;

const REVIEWER_TEMPLATE = `# Task {{task_id}} — reviewer, attempt {{attempt}}, mode {{mode}}

Product \`{{slug}}\`. Worktree \`{{worktree}}\` (tool root). Reviewed commit: {{impl_sha}}.
Write the report to \`{{report_path}}\` and the handoff to \`{{handoff_path}}\`.

## Task entry ({{tasks_json}})

{{task_entry}}

## Spec records ({{spec_ids}})

{{spec_records}}

## Module interface ({{tech_md}} excerpt for this task)

{{tech_excerpt}}

## Frozen test files

{{frozen_test_files}}

## Task diff

{{diff}}

## Verifier evidence (verifier.json)

{{evidence}}

## Implementer finding

{{finding}}
`;

function commonVariables(input: LaneMessageInput, role: string): PromptVariables {
  return {
    ...instructionVariables(input),
    role,
    task_entry: fenced("json", input.taskEntryJson),
    spec_records: recordSections(input.specRecords, "yaml"),
    tech_excerpt: input.techExcerpt,
    rework_finding: input.reworkFinding ?? NONE,
  };
}

export function testWriterMessage(input: LaneMessageInput): string {
  return renderTemplate(TEST_WRITER_TEMPLATE, {
    ...commonVariables(input, "test-writer"),
    verification_blocks: recordSections(input.verificationBlocks, "yaml"),
    stub_paths: list(input.stubPaths),
  });
}

export function implementerMessage(input: ImplementerMessageInput): string {
  return renderTemplate(IMPLEMENTER_TEMPLATE, { ...commonVariables(input, "implementer"), frozen_test_files: list(input.frozenTestFiles) });
}

function findingText(finding: ArbitrationFinding | null): string {
  return finding === null ? NONE : `type: ${finding.type}\nspec_ids: ${finding.specIds.join(", ")}\n\n${finding.detail}`;
}

export function reviewerMessage(input: ReviewerMessageInput): string {
  return renderTemplate(REVIEWER_TEMPLATE, {
    ...commonVariables(input, "reviewer"),
    mode: input.mode,
    impl_sha: input.implSha ?? "null (arbitration mode)",
    report_path: input.reportPath,
    frozen_test_files: list(input.frozenTestFiles),
    diff: input.diff.trim().length === 0 ? NONE : fenced("diff", input.diff),
    evidence: input.evidenceJson === null ? NONE : fenced("json", input.evidenceJson),
    finding: findingText(input.finding),
  });
}
