import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function readTextOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

let counter = 0;

export async function writeTextAtomic(path: string, text: string): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  counter += 1;
  const temporary = join(directory, `.${process.pid}.${counter}.tmp`);
  await writeFile(temporary, text, "utf8");
  await rename(temporary, path);
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}
