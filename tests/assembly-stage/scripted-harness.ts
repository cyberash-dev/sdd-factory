import { join } from "node:path";
import { createAssemblySlice } from "../../src/assembly-stage/index.js";
import { allTasksApproved } from "../../src/assembly-stage/domain/task-order.js";
import type { CommandResult } from "../../src/assembly-stage/ports/outbound/command-runner.js";
import { createReactor } from "../../src/bus/adapters/mozaik/runtime.js";
import { RunEngine } from "../../src/bus/application/run-engine.js";
import { EVENT_TYPES, type EventType } from "../../src/bus/domain/catalogue.js";
import type { DeliveredEvent } from "../../src/bus/domain/envelope.js";
import type { TransitionRule } from "../../src/bus/domain/transition.js";
import type { ApiRoleRunner } from "../../src/shared/llm/api-role-runner.js";
import { composeEffectRunner, composeRules, type Slice } from "../../src/shared/slice.js";
import { writeTextAtomic } from "../../src/shared/fs/text.js";
import { commandLine, commitFiles, coversMarker, fakeCommandRunner, git, initRepo, ok, failed, runState, sddReadyReport, sliceContext, taskState, tempDir, writeFiles } from "./support.js";

export const PRODUCT_FILES = {
  "package.json": '{"name":"todo-cli","version":"0.0.0","private":true,"type":"module","scripts":{"test":"node --test tests/"}}\n',
  "package-lock.json": '{"name":"todo-cli","version":"0.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"todo-cli","version":"0.0.0"}}}\n',
  "tsconfig.json": '{"compilerOptions":{"allowJs":true,"noEmit":true}}\n',
  "spec/spec.md": "# todo-cli spec\n",
  "design/tasks.json": '[{"id":"T-001","covers":["todo:CTR-001"],"writes":["src/cli/**","tests/cli/**"],"dependsOn":[]},{"id":"T-002","covers":["todo:BEH-002"],"writes":["src/store/**","tests/store/**"],"dependsOn":["T-001"]},{"id":"T-003","covers":["todo:BEH-003"],"writes":["src/api/**","tests/api/**"],"dependsOn":["T-001"]}]\n',
};

const TASK_FILES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "T-001": {
    "src/cli/parse.js": "export const parse = (argv) => argv.slice(2);\n",
    "tests/cli/parse.test.mjs": coversMarker("todo:CTR-001") + "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { parse } from '../../src/cli/parse.js';\ntest('parses', () => { assert.deepEqual(parse(['node', 'cli', 'x']), ['x']); });\n",
  },
  "T-002": {
    "src/store/save.js": "export const save = (items) => items.length;\n",
    "tests/store/save.test.mjs": coversMarker("todo:BEH-002") + "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { save } from '../../src/store/save.js';\ntest('saves', () => { assert.equal(save([1]), 1); });\n",
  },
  "T-003": {
    "src/api/get.js": "export const get = () => 200;\n",
    "tests/api/get.test.mjs": coversMarker("todo:BEH-003") + "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { get } from '../../src/api/get.js';\ntest('gets', () => { assert.equal(get(), 200); });\n",
  },
};

export interface ScriptedOptions {
  readonly vitest: (run: number, productDir: string) => string;
  readonly tsc?: (run: number) => CommandResult;
  readonly apiRoles?: ApiRoleRunner;
}

export interface ScriptedAssembly {
  readonly root: string;
  readonly productDir: string;
  readonly teamDir: string;
  readonly trace: DeliveredEvent<EventType>[];
  readonly engine: RunEngine;
  readonly log: string[];
}

function laneSlice(productDir: string): Slice {
  const taskRework: TransitionRule = {
    name: "stub task.rework",
    eventType: "task.rework",
    acceptsRunStatus: ["building"],
    apply({ state, event }) {
      const taskId = String(event.payload["taskId"]);
      const task = state.tasks[taskId];
      if (task === undefined) {
        throw new Error("unknown task");
      }
      return { state: { ...state, tasks: { ...state.tasks, [taskId]: { ...task, status: "impl_pending", attempts: { ...task.attempts, implementer: task.attempts.implementer + 1 } } } }, emits: [], effects: [{ kind: "lane.rework", taskId }] };
    },
  };
  const taskApproved: TransitionRule = {
    name: "stub task.approved",
    eventType: "task.approved",
    apply({ state, event }) {
      const taskId = String(event.payload["taskId"]);
      const task = state.tasks[taskId];
      if (task === undefined) {
        throw new Error("unknown task");
      }
      const next = { ...state, tasks: { ...state.tasks, [taskId]: { ...task, status: "approved" as const, implSha: String(event.payload["implSha"]) } } };
      return { state: next, emits: [], effects: allTasksApproved(next) ? [{ kind: "assembly.start" }] : [] };
    },
  };
  const terminal = (eventType: EventType, status: "published" | "failed"): TransitionRule => ({ name: `stub ${eventType}`, eventType, apply: ({ state }) => ({ state: { ...state, status }, emits: [], effects: [] }) });
  return {
    name: "stub-lanes",
    rules: [taskRework, taskApproved, terminal("run.published", "published"), terminal("run.failed", "failed")],
    effects: {
      "lane.rework": async (effect, context) => {
        const taskId = String(effect["taskId"]);
        const implSha = await commitFiles(productDir, { "src/cli/parse.js": `export const parse = (argv) => argv.slice(2); // fixed in rework of ${taskId}\n` }, `${taskId} rework`);
        context.publish({ type: "task.verified", producer: "foreman", payload: { taskId, result: "green", evidencePath: "verifier.json", testsUnchanged: true, writeSetOk: true } });
        context.publish({ type: "task.reviewed", producer: "reviewer", payload: { taskId, decision: "approve", target: "none", reportPath: `reviews/${taskId}.md` } });
        context.publish({ type: "task.approved", producer: "foreman", payload: { taskId, implSha } });
      },
    },
    participants: () => [],
  };
}

export async function scriptedAssembly(options: ScriptedOptions): Promise<ScriptedAssembly> {
  const root = await tempDir("assembly-e2e");
  const productDir = join(root, "product");
  const teamDir = join(root, "team");
  await initRepo(productDir, "integration", PRODUCT_FILES);
  const shas: Record<string, string> = {};
  for (const [taskId, files] of Object.entries(TASK_FILES)) {
    shas[taskId] = await commitFiles(productDir, files, taskId);
  }
  await initRepo(teamDir, "main", { "README.md": "team\n" });
  await writeFiles(join(root, "run", "trace"), { "trace.jsonl": "", "trace.md": "# trace\n", "interventions.md": "# interventions\n" });
  let vitestRuns = 0;
  let tscRuns = 0;
  const runner = fakeCommandRunner(async (invocation) => {
    const line = commandLine(invocation);
    if (line.startsWith("npm ci")) {
      return ok();
    }
    if (line.startsWith("npx tsc")) {
      tscRuns += 1;
      return options.tsc === undefined ? ok() : options.tsc(tscRuns);
    }
    if (line.startsWith("npx vitest")) {
      vitestRuns += 1;
      const report = options.vitest(vitestRuns, productDir);
      const outputFile = invocation.argv.find((argument) => argument.startsWith("--outputFile="))?.slice("--outputFile=".length) ?? "";
      await writeTextAtomic(outputFile, report);
      return report.includes('"success":true') ? ok() : failed(1, "", "failed");
    }
    if (line.startsWith("npx sdd ready")) {
      return ok(sddReadyReport([]));
    }
    return undefined;
  });
  const log: string[] = [];
  const context = sliceContext({ root, log, ...(options.apiRoles === undefined ? {} : { apiRoles: options.apiRoles }) });
  const slices = [createAssemblySlice({ commandRunner: runner })(context), laneSlice(productDir)];
  const initial = runState({
    status: "building",
    tasks: {
      "T-001": taskState({ covers: ["todo:CTR-001"], writes: ["src/cli/**", "tests/cli/**"], implSha: shas["T-001"] ?? null }),
      "T-002": taskState({ covers: ["todo:BEH-002"], writes: ["src/store/**", "tests/store/**"], dependsOn: ["T-001"], implSha: shas["T-002"] ?? null }),
      "T-003": taskState({ status: "review_pending", covers: ["todo:BEH-003"], writes: ["src/api/**", "tests/api/**"], dependsOn: ["T-001"], implSha: null }),
    },
  });
  const trace: DeliveredEvent<EventType>[] = [];
  const engine = new RunEngine({ initialState: initial, rules: composeRules(slices), store: { write: async () => undefined }, publisher: context.runtime.publisher, effects: composeEffectRunner(slices, context), log: (line) => log.push(line) });
  const everyType = (handler: (event: DeliveredEvent<EventType>) => void) => Object.fromEntries(EVENT_TYPES.map((type) => [type, handler]));
  context.runtime.join(createReactor("foreman", everyType((event) => void engine.consume(event))));
  context.runtime.join(createReactor("tracer", everyType((event) => trace.push(event))));
  context.runtime.publisher.publish({ type: "task.approved", producer: "foreman", payload: { taskId: "T-003", implSha: shas["T-003"] ?? "" } });
  await settled(engine, 20000);
  return { root, productDir, teamDir, trace, engine, log };
}

async function settled(engine: RunEngine, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (engine.state.status !== "published" && engine.state.status !== "failed") {
    if (Date.now() > deadline) {
      throw new Error(`run did not settle: status ${engine.state.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
}

export function describeEvent(event: DeliveredEvent<EventType>): string {
  const payload = event.payload;
  const parts = [event.type, payload["stage"], payload["step"], payload["result"], payload["taskId"], payload["target"], payload["reason"], payload["round"]].filter((part) => part !== undefined && part !== null);
  return parts.map(String).join(" ");
}

export function integrationHead(productDir: string): Promise<string> {
  return git(productDir, "rev-parse", "HEAD");
}
