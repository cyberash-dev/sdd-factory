import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { installTooling } from "../../src/design-stage/application/tooling-install.js";
import type { CommandRunner } from "../../src/design-stage/ports/outbound/command-runner.js";
import type { TechTooling } from "../../src/shared/design-files/tech-md.js";

const succeedingCommands: CommandRunner = {
  async run(request) {
    const isBranchQuery = request.file === "git" && request.args[0] === "rev-parse";
    return { exitCode: 0, stdout: isBranchQuery ? "integration\n" : "", stderr: "" };
  },
};

async function aScaffoldedProduct(): Promise<string> {
  const productDir = await mkdtemp(join(tmpdir(), "tooling-install-"));
  await writeFile(join(productDir, "package.json"), '{"name":"room-booking-api","type":"module","scripts":{"build":"tsc -p tsconfig.build.json"}}\n', "utf8");
  await writeFile(join(productDir, "tsconfig.json"), '{"compilerOptions":{"strict":false},"include":["src","tests"]}\n', "utf8");
  return productDir;
}

function toolingWith(devDependencies: readonly string[], tsconfig: Readonly<Record<string, unknown>>): TechTooling {
  return { node: "22", testCmd: "npx vitest run", typecheckCmd: "npx tsc --noEmit", dependencies: [], devDependencies, tsconfig };
}

async function installInto(productDir: string, tooling: TechTooling, log: string[] = []): Promise<void> {
  await installTooling({ commands: succeedingCommands, productDir, tooling, timeoutMs: 10_000, log: (line) => log.push(line) });
}

async function aProductWithNodeServer(): Promise<string> {
  const productDir = await aScaffoldedProduct();
  const factoryModules = resolve(import.meta.dirname, "..", "..", "node_modules");
  await mkdir(join(productDir, "node_modules", "@types"), { recursive: true });
  await symlink(join(factoryModules, "typescript"), join(productDir, "node_modules", "typescript"), "dir");
  await symlink(join(factoryModules, "@types", "node"), join(productDir, "node_modules", "@types", "node"), "dir");
  await writeFile(join(productDir, "tsconfig.build.json"), '{"extends":"./tsconfig.json","compilerOptions":{"noEmit":false,"rootDir":"src","outDir":"dist"},"include":["src"]}\n', "utf8");
  await mkdir(join(productDir, "src"));
  await writeFile(
    join(productDir, "src", "server.ts"),
    'import { createServer, type Server } from "node:http";\n\nexport function serve(): Server {\n  const banner = Buffer.from(process.env["BANNER"] ?? "ok");\n  return createServer((_request, response) => response.end(banner));\n}\n',
    "utf8",
  );
  return productDir;
}

async function writtenCompilerOptions(productDir: string): Promise<unknown> {
  const tsconfig: unknown = JSON.parse(await readFile(join(productDir, "tsconfig.json"), "utf8"));
  return typeof tsconfig === "object" && tsconfig !== null && "compilerOptions" in tsconfig ? tsconfig.compilerOptions : null;
}

describe("tooling install node types pin", () => {
  // @covers design-stage:DLT-011
  // @covers design-stage:BEH-003
  it("writes types node next to skipLibCheck and typeRoots when @types/node is among the dev dependencies", async () => {
    const productDir = await aScaffoldedProduct();

    await installInto(productDir, toolingWith(["@types/node@26.6.6", "typescript@7.0.2"], { strict: true }));

    expect(await writtenCompilerOptions(productDir)).toEqual({ strict: true, skipLibCheck: true, typeRoots: ["./node_modules/@types"], types: ["node"] });
  });

  // @covers design-stage:DLT-011
  // @covers design-stage:CTR-001
  it("keeps the architect's types in order and appends node after them", async () => {
    const productDir = await aScaffoldedProduct();

    await installInto(productDir, toolingWith(["@types/node@26.6.6"], { strict: true, types: ["vitest/globals"] }));

    expect(await writtenCompilerOptions(productDir)).toEqual({ strict: true, types: ["vitest/globals", "node"], skipLibCheck: true, typeRoots: ["./node_modules/@types"] });
  });

  // @covers design-stage:DLT-011
  it("does not add node a second time when the architect already lists it", async () => {
    const productDir = await aScaffoldedProduct();

    await installInto(productDir, toolingWith(["@types/node@26.6.6"], { types: ["node", "vitest/globals"] }));

    expect(await writtenCompilerOptions(productDir)).toEqual({ types: ["node", "vitest/globals"], skipLibCheck: true, typeRoots: ["./node_modules/@types"] });
  });

  // @covers design-stage:DLT-011
  // @covers design-stage:BEH-003
  it("adds no types key when @types/node is not among the dev dependencies", async () => {
    const productDir = await aScaffoldedProduct();

    await installInto(productDir, toolingWith(["typescript@7.0.2", "vitest@5.0.5"], { strict: true }));

    expect(await writtenCompilerOptions(productDir)).toEqual({ strict: true, skipLibCheck: true, typeRoots: ["./node_modules/@types"] });
  });

  // @covers design-stage:DLT-011
  it("names the types pin in the same log line as skipLibCheck and typeRoots", async () => {
    const productDir = await aScaffoldedProduct();
    const log: string[] = [];

    await installInto(productDir, toolingWith(["@types/node@26.6.6"], { types: ["vitest/globals"] }), log);

    expect(log.filter((line) => line.startsWith("design-stage: tsconfig"))).toEqual(["design-stage: tsconfig skipLibCheck, typeRoots and types vitest/globals,node pinned"]);
  });

  // @covers design-stage:DLT-011
  // @covers design-stage:BEH-003
  it("lets tsc -p tsconfig.build.json compile src that imports node:http and uses Buffer and process", async () => {
    const productDir = await aProductWithNodeServer();

    await installInto(productDir, toolingWith(["@types/node@26.6.6", "typescript@7.0.2"], { module: "NodeNext", moduleResolution: "NodeNext", target: "ES2022", strict: true, noEmit: true }));

    const build = spawnSync(process.execPath, [join(productDir, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.build.json"], { cwd: productDir, encoding: "utf8" });

    expect([build.status, build.stdout]).toEqual([0, ""]);
  });
});
