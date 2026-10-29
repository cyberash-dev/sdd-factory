import { access, constants } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { resolveOperator } from "../domain/operator.js";
import { slugOf } from "../domain/run-id.js";

export interface PreflightInput {
  readonly specPath: string;
  readonly operatorFlag: string | null;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly nodeMajor: number;
  readonly fileExists: (path: string) => Promise<boolean>;
}

export interface PreflightResult {
  readonly slug: string;
  readonly operator: string;
}

export class PreflightError extends Error {
  override readonly name = "PreflightError";

  constructor(
    readonly exitCode: 2 | 3,
    message: string,
  ) {
    super(message);
  }
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function onPath(binary: string, env: Readonly<Record<string, string | undefined>>, exists: (path: string) => Promise<boolean>): Promise<boolean> {
  const entries = (env["PATH"] ?? "").split(delimiter).filter((entry) => entry.length > 0);
  for (const entry of entries) {
    if (await exists(join(entry, binary))) {
      return true;
    }
  }
  return false;
}

export async function preflight(input: PreflightInput): Promise<PreflightResult> {
  if (!(await input.fileExists(input.specPath))) {
    throw new PreflightError(2, `spec file not readable: ${input.specPath}`);
  }
  let slug: string;
  try {
    slug = slugOf(input.specPath);
  } catch (error) {
    throw new PreflightError(2, error instanceof Error ? error.message : String(error));
  }
  let operator: string;
  try {
    operator = resolveOperator(input.operatorFlag, input.env["FACTORY_OPERATOR"]);
  } catch (error) {
    throw new PreflightError(2, error instanceof Error ? error.message : String(error));
  }
  if (input.nodeMajor < 22) {
    throw new PreflightError(3, `node >= 22 required, running ${input.nodeMajor}`);
  }
  const apiKey = input.env["ANTHROPIC_API_KEY"];
  if (apiKey === undefined || apiKey.length === 0) {
    throw new PreflightError(3, "ANTHROPIC_API_KEY is not set");
  }
  for (const binary of ["claude", "git"]) {
    if (!(await onPath(binary, input.env, input.fileExists))) {
      throw new PreflightError(3, `${binary} not found on PATH`);
    }
  }
  return { slug, operator };
}
