import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { productPackageJson, productTsconfig } from "../../src/factory/application/product-scaffold.js";

const repoFile = (name: string): URL => new URL(`../../${name}`, import.meta.url);

describe("toolchain constraints", () => {
  // @covers factory:CST-001
  it("requires node 22 in the factory and in generated products", async () => {
    const factory: { engines: { node: string } } = JSON.parse(await readFile(repoFile("package.json"), "utf8"));
    const product: { engines: { node: string } } = JSON.parse(productPackageJson("x", { typescript: "7.0.2", vitest: "5.0.5", typesNode: "26.6.6", agentSdd: "2.1.1" }));

    expect([factory.engines.node, product.engines.node]).toEqual([">=22", ">=22"]);
  });

  // @covers factory:CST-002
  it("uses strict NodeNext TypeScript and vitest in the factory and in generated products", async () => {
    const factory: { compilerOptions: { strict: boolean; module: string } } = JSON.parse(await readFile(repoFile("tsconfig.json"), "utf8"));
    const factoryScripts: { scripts: { test: string } } = JSON.parse(await readFile(repoFile("package.json"), "utf8"));
    const product: { compilerOptions: { strict: boolean; module: string } } = JSON.parse(productTsconfig());
    const productScripts: { scripts: { test: string } } = JSON.parse(productPackageJson("x", { typescript: "7.0.2", vitest: "5.0.5", typesNode: "26.6.6", agentSdd: "2.1.1" }));

    expect([factory.compilerOptions.strict, factory.compilerOptions.module, factoryScripts.scripts.test, product.compilerOptions.strict, product.compilerOptions.module, productScripts.scripts.test]).toEqual([true, "NodeNext", "vitest run", true, "NodeNext", "vitest run"]);
  });

  // @covers factory:CST-003
  it("pins agent-sdd to exactly 2.1.1 in both package manifests", async () => {
    const factory: { devDependencies: Record<string, string> } = JSON.parse(await readFile(repoFile("package.json"), "utf8"));
    const product: { devDependencies: Record<string, string> } = JSON.parse(productPackageJson("x", { typescript: "7.0.2", vitest: "5.0.5", typesNode: "26.6.6", agentSdd: "2.1.1" }));

    expect([factory.devDependencies["agent-sdd"], product.devDependencies["agent-sdd"]]).toEqual(["2.1.1", "2.1.1"]);
  });
});
