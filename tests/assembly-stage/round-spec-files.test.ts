import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { publishEffect } from "../../src/assembly-stage/application/publish.js";
import { verifyEffect } from "../../src/assembly-stage/application/verify.js";
import type { PendingEvent } from "../../src/bus/domain/transition.js";
import { writeTextAtomic } from "../../src/shared/fs/text.js";
import { baselineSpec, collectingContext, commandLine, failed, fakeCommandRunner, git, initRepo, ok, registerTracer, runState, sddReadyReport, sliceContext, SLUG, taskState, tempDir, tokenEnvelope, vitestReport, writeFiles, type CommandScript } from "./support.js";

const SURFACE_LISTING_CONTRACT = "```yaml\n---\nid: todo-cli:SUR-001\ntype: Surface\nlifecycle: {status: approved}\npartition_id: todo-cli\nmembers: [todo-cli:CTR-001]\nversion: \"0.1.0\"\n---\n```\n";
const CONTRACT = "```yaml\n---\nid: todo-cli:CTR-001\ntype: Contract\nlifecycle: {status: approved}\npartition_id: todo-cli\nsurface_ref: todo-cli:SUR-001\n---\n```\n";
const BEHAVIOR_ON_SURFACE = "```yaml\n---\nid: todo-cli:BEH-001\ntype: Behavior\nlifecycle: {status: approved}\npartition_id: todo-cli\nsurface_ref: todo-cli:SUR-001\n---\n```\n";

async function productRepo(specText: string): Promise<{ readonly root: string; readonly productDir: string; readonly baseSha: string }> {
  const root = await tempDir("assembly-round-spec");
  const productDir = join(root, "product");
  const baseSha = await initRepo(productDir, "integration", {
    "package.json": '{"name":"todo-cli","version":"0.0.0","private":true}\n',
    "spec/spec.md": specText,
    "design/tasks.json": "[]\n",
    "design/tech.md": "# tech\n",
    "src/a.js": "export const a = 1;\n",
  });
  return { root, productDir, baseSha };
}

function greenSequence(onReady: () => Promise<void>): CommandScript {
  return async (invocation) => {
    const line = commandLine(invocation);
    if (line.startsWith("npm ci") || line.startsWith("npx tsc")) {
      return ok();
    }
    if (line.startsWith("npx vitest")) {
      const outputFile = invocation.argv.find((argument) => argument.startsWith("--outputFile="))?.slice("--outputFile=".length) ?? "";
      await writeTextAtomic(outputFile, vitestReport({ passing: ["x"] }));
      return ok();
    }
    if (line.startsWith("npx sdd token")) {
      return ok(tokenEnvelope("b".repeat(64), "a".repeat(40)));
    }
    if (line.startsWith("npx sdd ready")) {
      await onReady();
      return ok(sddReadyReport([]));
    }
    return line.startsWith("npx") ? failed(127, `unexpected ${line}`) : undefined;
  };
}

async function verifyRound(root: string, script: CommandScript, implSha: string): Promise<void> {
  const context = collectingContext(runState({ status: "assembling", assemblyRounds: 1, tasks: { "T-001": taskState({ implSha }) } }));
  await verifyEffect(fakeCommandRunner(script))({ kind: "assembly.verify", round: 1, taskOrder: ["T-001"] }, context, sliceContext({ root }));
}

async function publishAfterRound(root: string): Promise<readonly PendingEvent[]> {
  await initRepo(join(root, "team"), "main", { "README.md": "team repo\n" });
  await writeFiles(join(root, "run", "trace"), { "trace.jsonl": "", "trace.md": "# trace\n", "interventions.md": "# interventions\n" });
  registerTracer(sliceContext({ root }));
  const context = collectingContext(runState({ status: "publishing", assemblyRounds: 1, tasks: {} }));
  await publishEffect(fakeCommandRunner(() => undefined))({ kind: "assembly.publish" }, context, sliceContext({ root, push: false }));
  return context.published;
}

describe("assembly round surface membership", () => {
  // @covers assembly-stage:DLT-003
  // @covers assembly-stage:BEH-003
  it("adds a behavior whose surface_ref names the surface to its members and commits it before sdd ready runs", async () => {
    const fixture = await productRepo(baselineSpec(SLUG, "0".repeat(40), "0".repeat(64)) + SURFACE_LISTING_CONTRACT + CONTRACT + BEHAVIOR_ON_SURFACE);
    let committedSpecAtReady = "";

    await verifyRound(fixture.root, greenSequence(async () => {
      committedSpecAtReady = await git(fixture.productDir, "show", "HEAD:spec/spec.md");
    }), fixture.baseSha);

    expect(committedSpecAtReady.includes("members:\n  - todo-cli:CTR-001\n  - todo-cli:BEH-001\nversion:")).toBe(true);
  });

  // @covers assembly-stage:DLT-003
  it("makes no membership commit when the surface already lists every record that names it", async () => {
    const fixture = await productRepo(baselineSpec(SLUG, "0".repeat(40), "0".repeat(64)) + SURFACE_LISTING_CONTRACT + CONTRACT);

    await verifyRound(fixture.root, greenSequence(async () => undefined), fixture.baseSha);

    expect(await git(fixture.productDir, "log", "--format=%s")).toBe("assembly report round 1\nspec: baseline refresh\nbase");
  });
});

describe("assembly round role-written files", () => {
  // @covers assembly-stage:DLT-004
  // @covers assembly-stage:BEH-003
  it("commits an uncommitted design/tech.md edit before the verification sequence starts", async () => {
    const fixture = await productRepo(baselineSpec(SLUG, "0".repeat(40), "0".repeat(64)));
    await writeFiles(fixture.productDir, { "design/tech.md": "# tech\nrepaired by the architect\n" });
    let treeAtInstall = "";
    const script = greenSequence(async () => undefined);

    await verifyRound(fixture.root, async (invocation) => {
      if (commandLine(invocation).startsWith("npm ci")) {
        treeAtInstall = `${await git(fixture.productDir, "status", "--porcelain")}|${await git(fixture.productDir, "log", "-1", "--format=%s", "--", "design/tech.md")}`;
      }
      return script(invocation);
    }, fixture.baseSha);

    expect(treeAtInstall).toBe("|assembly: role-written design and spec files");
  });

  // @covers assembly-stage:DLT-004
  // @covers assembly-stage:BEH-008
  it("publishes after a green round over an uncommitted role-written design file", async () => {
    const fixture = await productRepo(baselineSpec(SLUG, "0".repeat(40), "0".repeat(64)));
    await writeFiles(fixture.productDir, { "design/tech.md": "# tech\nrepaired by the architect\n" });
    await verifyRound(fixture.root, greenSequence(async () => undefined), fixture.baseSha);

    const published = await publishAfterRound(fixture.root);

    expect(published.map((event) => event.type)).toEqual(["run.published"]);
  });

  // @covers assembly-stage:DLT-004
  // @covers assembly-stage:INV-001
  it("keeps a staged change outside design/ and spec/ out of the role-written commit", async () => {
    const fixture = await productRepo(baselineSpec(SLUG, "0".repeat(40), "0".repeat(64)));
    await writeFiles(fixture.productDir, { "design/tech.md": "# tech\nrepaired by the architect\n", "src/a.js": "export const a = 2;\n" });
    await git(fixture.productDir, "add", "--", "src/a.js");
    let treeAtInstall = "";
    const script = greenSequence(async () => undefined);

    await verifyRound(fixture.root, async (invocation) => {
      if (commandLine(invocation).startsWith("npm ci")) {
        treeAtInstall = `${await git(fixture.productDir, "status", "--porcelain")}|${await git(fixture.productDir, "show", "--name-only", "--format=", "HEAD")}`;
      }
      return script(invocation);
    }, fixture.baseSha);

    expect(treeAtInstall).toBe("M  src/a.js|design/tech.md");
  });
});
