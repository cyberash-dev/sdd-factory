import { createHash } from "node:crypto";
import { readTextOrNull } from "../../shared/fs/text.js";

export async function sha256OrNull(path: string): Promise<string | null> {
  const text = await readTextOrNull(path);
  return text === null ? null : createHash("sha256").update(text).digest("hex");
}
