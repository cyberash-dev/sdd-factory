import type { DesignBundle } from "../../../src/build-stage/ports/outbound/design-source.js";
import type { TaskSpec } from "../../../src/shared/design-files/tasks-json.js";
import type { TechModule } from "../../../src/shared/design-files/tech-md.js";

export function aTaskSpec(overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id: "T-001",
    title: "greet",
    covers: ["greeter:BEH-001"],
    writes: ["src/greet.ts", "tests/greet.test.ts"],
    dependsOn: [],
    designRefs: ["M-01"],
    testBudget: { maxTests: 5 },
    reworkRoute: { onImplementationFailure: "implementer", onTestContractConflict: "reviewer" },
    ...overrides,
  };
}

export function aModule(overrides: Partial<TechModule> = {}): TechModule {
  return {
    id: "M-01",
    name: "greet",
    responsibility: "greets a person by name",
    covers: ["greeter:BEH-001"],
    owns: ["src/greet.ts"],
    entry: "src/greet.ts",
    dependsOn: [],
    interfaceSource: "export function greet(name: string): string;",
    exports: [{ name: "greet", kind: "function", signature: "greet(name: string): string" }],
    notes: "",
    ...overrides,
  };
}

export function greeterDesign(tasks: readonly TaskSpec[] = [aTaskSpec()], modules: readonly TechModule[] = [aModule()]): DesignBundle {
  return {
    tech: {
      modules,
      tooling: { node: "26", testCmd: "npx vitest run", typecheckCmd: "npx tsc --noEmit", dependencies: [], devDependencies: [], tsconfig: null },
      traceability: modules.flatMap((module) => module.covers.map((specId) => ({ specId, moduleId: module.id }))),
    },
    verification: {
      blocks: [{ id: "greeter:BEH-001", template: "Behavior", feasibility: "feasible", yamlSource: "id: greeter:BEH-001\ninput_classes:\n  - non-empty name\nnegative_oracle: empty name rejected" }],
      infeasibleCandidates: [],
    },
    tasks: { schemaVersion: 1, partition: "greeter", tasks },
  };
}
