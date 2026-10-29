import { join } from "node:path";
import type { ASSEMBLY_STEPS } from "../../bus/domain/catalogue.js";
import type { Argv } from "../ports/outbound/command-runner.js";

export type AssemblyStep = (typeof ASSEMBLY_STEPS)[number];

export const VERIFICATION_SEQUENCE: readonly AssemblyStep[] = ["install", "typecheck", "test", "sdd_ready"];

export const INSTALL_ARGV: Argv = ["npm", "ci", "--prefer-offline", "--no-audit", "--no-fund"];
export const OFFLINE_INSTALL_ARGV: Argv = ["npm", "ci", "--offline", "--no-audit", "--no-fund"];
export const NETWORK_FAILURE = /ENOTFOUND|ECONNRESET|ETIMEDOUT/;

export const VITEST_REPORT_FILE = "vitest.json";

export function stepArgv(step: AssemblyStep, evidenceDir: string): Argv {
  switch (step) {
    case "install":
      return INSTALL_ARGV;
    case "typecheck":
      return ["npx", "tsc", "--noEmit"];
    case "test":
      return ["npx", "vitest", "run", "--reporter=json", `--outputFile=${join(evidenceDir, VITEST_REPORT_FILE)}`];
    case "sdd_ready":
      return ["npx", "sdd", "ready", "--format=json"];
  }
}
