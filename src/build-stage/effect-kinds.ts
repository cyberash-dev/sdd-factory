export const BUILD_EFFECT_KINDS = {
  schedule: "build.schedule",
  worktree: "build.worktree",
  testWriter: "build.test-writer",
  redCheck: "build.red-check",
  implementer: "build.implementer",
  greenCheck: "build.green-check",
  reviewer: "build.reviewer",
  integrate: "build.integrate",
  restartLane: "build.restart-lane",
  arbitrationFix: "build.arbitration-fix",
  terminateLanes: "build.terminate-lanes",
  reprovision: "build.reprovision",
} as const;

/* Effect kinds build-stage emits but other slices own. */
export const FOREIGN_EFFECT_KINDS = {
  specAssume: "spec.assume",
  assemblyStart: "assembly.start",
} as const;
