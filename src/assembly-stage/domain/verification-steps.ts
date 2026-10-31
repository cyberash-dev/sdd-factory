import { join } from "node:path";
import type { ASSEMBLY_STEPS } from "../../bus/domain/catalogue.js";
import type { Argv } from "../ports/outbound/command-runner.js";

export type AssemblyStep = (typeof ASSEMBLY_STEPS)[number];

export const VERIFICATION_SEQUENCE: readonly AssemblyStep[] = ["install", "typecheck", "test", "sdd_ready"];
const BUILD_VERIFICATION_SEQUENCE: readonly AssemblyStep[] = ["install", "typecheck", "build", "test", "sdd_ready"];

export const INSTALL_ARGV: Argv = ["npm", "ci", "--prefer-offline", "--no-audit", "--no-fund"];
export const OFFLINE_INSTALL_ARGV: Argv = ["npm", "ci", "--offline", "--no-audit", "--no-fund"];
export const NETWORK_FAILURE = /ENOTFOUND|ECONNRESET|ETIMEDOUT/;

export const VITEST_REPORT_FILE = "vitest.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function definesBuildScript(packageJson: string | null): boolean {
  if (packageJson === null) {
    return false;
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(packageJson);
  } catch (error) {
    /* an unparseable package.json fails npm ci first; the sequence is chosen again after a fix */
    if (error instanceof SyntaxError) {
      return false;
    }
    throw error;
  }
  const scripts = isRecord(manifest) ? manifest["scripts"] : undefined;
  return isRecord(scripts) && typeof scripts["build"] === "string";
}

export function verificationSequence(hasBuildScript: boolean): readonly AssemblyStep[] {
  return hasBuildScript ? BUILD_VERIFICATION_SEQUENCE : VERIFICATION_SEQUENCE;
}

export function stepArgv(step: AssemblyStep, evidenceDir: string): Argv {
  switch (step) {
    case "install":
      return INSTALL_ARGV;
    case "typecheck":
      return ["npx", "tsc", "--noEmit"];
    case "build":
      return ["npm", "run", "build"];
    case "test":
      return ["npx", "vitest", "run", "--reporter=json", `--outputFile=${join(evidenceDir, VITEST_REPORT_FILE)}`];
    case "sdd_ready":
      return ["npx", "sdd", "ready", "--format=json"];
  }
}
