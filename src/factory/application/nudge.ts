import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readTextOrNull } from "../../shared/fs/text.js";

export class NudgeError extends Error {
  override readonly name = "NudgeError";
}

export async function recordNudge(repoRoot: string, runId: string, note: string, actor: string, now: Date): Promise<string> {
  const runDir = join(repoRoot, ".factory", "runs", runId);
  const manifest = await readTextOrNull(join(runDir, "run.json"));
  if (manifest === null) {
    throw new NudgeError(`unknown run ${runId}`);
  }
  try {
    JSON.parse(manifest);
  } catch {
    throw new NudgeError("run_manifest_invalid");
  }
  const nudgesDir = join(runDir, "nudges");
  await mkdir(nudgesDir, { recursive: true });
  const path = join(nudgesDir, `${now.toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(path, `${JSON.stringify({ note, actor, at: now.toISOString() })}\n`, "utf8");
  return path;
}
