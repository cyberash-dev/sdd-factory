import { execFile } from "node:child_process";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@x", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@x" };

export async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", [...args], { cwd, env: GIT_ENV });
  return stdout.trim();
}

export const PRODUCT_TSCONFIG = JSON.stringify(
  { compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true, skipLibCheck: true, types: ["node"] }, include: ["src", "tests"] },
  null,
  2,
);

export async function writeProductFile(root: string, path: string, content: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content, "utf8");
}

export async function aProductRepo(files: Readonly<Record<string, string>> = {}): Promise<string> {
  const productDir = await mkdtemp(join(tmpdir(), "sdd-product-"));
  await writeProductFile(productDir, "package.json", `${JSON.stringify({ name: "greeter", type: "module", private: true }, null, 2)}\n`);
  await writeProductFile(productDir, "tsconfig.json", `${PRODUCT_TSCONFIG}\n`);
  await writeProductFile(productDir, ".gitignore", "node_modules/\n");
  for (const [path, content] of Object.entries(files)) {
    await writeProductFile(productDir, path, content);
  }
  await symlink(join(REPO_ROOT, "node_modules"), join(productDir, "node_modules"), "dir");
  await git(productDir, ["init", "-q", "-b", "integration"]);
  await git(productDir, ["add", "-A"]);
  await git(productDir, ["commit", "-q", "-m", "scaffold product"]);
  return productDir;
}
