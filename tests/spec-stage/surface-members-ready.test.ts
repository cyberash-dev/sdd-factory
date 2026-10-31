import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { parseLintEnvelope, parseReadyEnvelope } from "../../src/shared/sdd/envelope.js";
import { repairSurfaceMembers } from "../../src/shared/sdd/surface-members.js";

const execFileAsync = promisify(execFile);
const SDD_BIN = join(process.cwd(), "node_modules", ".bin", "sdd");
const SDD_CONFIG = {
  spec_file: "spec/spec.md",
  baseline_id: "todo-cli:BL-001",
  discovery_scope: ["src"],
  mechanism: "git_tree_hash_v1",
  lint: { spec_files: ["spec/spec.md"] },
  partitions: { "todo-cli": { spec_paths: ["spec/spec.md"], test_paths: ["tests/**/*.test.ts"] } },
};

function approved(id: string, type: string, body: string): string {
  const lifecycle = "lifecycle:\n  status: approved\n  approval_record:\n    owner_role: product-owner\n    approver_identity: cyberash\n    timestamp: 2026-10-30T21:59:38.482Z\n    change_request: run\n    scope: first-time-approval";
  return `\`\`\`yaml\n---\nid: ${id}\ntype: ${type}\n${lifecycle}\npartition_id: todo-cli\n${body}\n---\n\`\`\`\n`;
}

function sddReadyStdout(cwd: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(SDD_BIN, ["ready", "--format=json"], { cwd }, (_exitError, stdout) => resolve(stdout));
  });
}

function sddLintStdout(cwd: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(SDD_BIN, ["lint", "--format=json"], { cwd }, (_exitError, stdout) => resolve(stdout));
  });
}

async function productDirWithSpec(specText: string): Promise<string> {
  const productDir = await mkdtemp(join(tmpdir(), "surface-members-ready-"));
  await mkdir(join(productDir, "spec"));
  await mkdir(join(productDir, ".sdd"));
  await writeFile(join(productDir, ".sdd", "config.json"), JSON.stringify(SDD_CONFIG), "utf8");
  await writeFile(join(productDir, "spec", "spec.md"), specText, "utf8");
  return productDir;
}

async function lintErrorsReportedBySddLint(specText: string): Promise<readonly string[]> {
  const productDir = await productDirWithSpec(specText);
  return parseLintEnvelope(await sddLintStdout(productDir)).diagnostics.filter((diagnostic) => diagnostic.severity === "error").map((diagnostic) => diagnostic.message);
}

async function memberDriftReportedBySddReady(specText: string): Promise<readonly string[]> {
  const productDir = await productDirWithSpec(specText);
  await execFileAsync("git", ["init", "-q"], { cwd: productDir });
  await execFileAsync("git", ["add", "-A"], { cwd: productDir });
  await execFileAsync("git", ["-c", "user.email=factory@example.test", "-c", "user.name=factory", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "spec"], { cwd: productDir });
  return parseReadyEnvelope(await sddReadyStdout(productDir)).violations.filter((violation) => violation.kind === "surface_member_drift").map((violation) => violation.remediation);
}

describe("surface membership repair against sdd ready", () => {
  // @covers spec-stage:DLT-007
  it("leaves no surface_member_drift for the records whose surface_ref names the surface", async () => {
    const boundaryFields = "policy_refs: {not_applicable: local cli}\napplicability: {invariant_to_all_axes: true}\nconcurrency_model: {not_applicable: single process}\ndata_scope: {not_applicable: no persistent state}";
    const spec = [
      approved("todo-cli:SUR-001", "Surface", 'name: todo\nboundary_type: cli\nmembers: [todo-cli:CTR-001]\nversion: "0.1.0"'),
      approved("todo-cli:CTR-001", "Contract", "title: todo add\nsurface_ref: todo-cli:SUR-001"),
      approved("todo-cli:BEH-001", "Behavior", `title: add\nsurface_ref: todo-cli:SUR-001\n${boundaryFields}`),
      approved("todo-cli:SCN-001", "Scenario", `title: add then list\nsurface_ref: todo-cli:SUR-001\n${boundaryFields}`),
    ].join("\n");

    const repair = repairSurfaceMembers(spec);
    const repaired = repair?.text ?? spec;

    expect([repair?.added, await memberDriftReportedBySddReady(spec), await memberDriftReportedBySddReady(repaired)]).toEqual([
      ["todo-cli:BEH-001", "todo-cli:SCN-001"],
      [
        "record todo-cli:BEH-001 declares surface_ref todo-cli:SUR-001 but is absent from its members; finalise the Delta that adds it",
        "record todo-cli:SCN-001 declares surface_ref todo-cli:SUR-001 but is absent from its members; finalise the Delta that adds it",
      ],
      [],
    ]);
  });

  // @covers spec-stage:DLT-008
  it("leaves a lint-clean spec when a binding with a surface_ref lacks the boundary fields", async () => {
    const boundaryFields = "policy_refs: {not_applicable: local cli}\napplicability: {invariant_to_all_axes: true}\nconcurrency_model: {not_applicable: single process}\ndata_scope: {not_applicable: no persistent state}\ntest_obligation: {predicate: the todo is stored, test_template: unit}";
    const spec = [
      approved("todo-cli:SUR-001", "Surface", 'name: todo\nboundary_type: cli\nmembers: [todo-cli:CTR-001]\nversion: "0.1.0"'),
      approved("todo-cli:CTR-001", "Contract", `title: todo add\nsurface_ref: todo-cli:SUR-001\n${boundaryFields}`),
      approved("todo-cli:BEH-001", "Behavior", `title: add\nsurface_ref: todo-cli:SUR-001\n${boundaryFields}`),
      approved("todo-cli:IB-001", "ImplementationBinding", "binding: dist/cli.js\nsurface_ref: todo-cli:SUR-001\nboundary_classes: [cli entry]\ntest_obligation: {not_applicable: a binding has no behaviour of its own}\nnotes: CLI entry bound to dist/cli.js"),
    ].join("\n");

    const repaired = repairSurfaceMembers(spec)?.text ?? spec;

    expect(await lintErrorsReportedBySddLint(repaired)).toEqual([]);
  });
});
