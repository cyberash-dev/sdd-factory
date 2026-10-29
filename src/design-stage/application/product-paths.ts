import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

async function entriesOrNone(directory: string): Promise<readonly Dirent[]> {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function walk(root: string, relativeDir: string, into: string[]): Promise<void> {
  for (const entry of await entriesOrNone(join(root, relativeDir))) {
    const relativePath = relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) {
      await walk(root, relativePath, into);
    } else {
      into.push(relativePath);
    }
  }
}

/* Top-level files plus every file under src/ and tests/, as posix paths relative to the product root. */
export async function productPaths(productDir: string): Promise<readonly string[]> {
  const paths: string[] = [];
  const top = await readdir(productDir, { withFileTypes: true });
  for (const entry of top) {
    if (!entry.isDirectory()) {
      paths.push(entry.name);
    }
  }
  await walk(productDir, "src", paths);
  await walk(productDir, "tests", paths);
  return paths.sort();
}
