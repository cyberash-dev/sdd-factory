import { describe, expect, it } from "vitest";
import { changedFilesOutside, fixScopeOf } from "./fix-scope.js";

describe("simple-fixer allowed paths", () => {
  // @covers factory:BEH-012
  it.each([
    [{ trigger: "spec_yaml_invalid" }, { allowed: ["spec/spec.md", "spec/assumptions.md"], forbidden: [] }],
    [{ trigger: "design_file_invalid", file: "design/tech.md" }, { allowed: ["design/tech.md"], forbidden: [] }],
    [{ trigger: "red_suite_error", writes: ["src/greet/**", "tests/greet/**"] }, { allowed: ["src/greet/**", "tests/greet/**"], forbidden: [] }],
    [{ trigger: "green_typecheck", writes: ["src/greet/**", "tests/greet/**"] }, { allowed: ["src/greet/**", "tests/greet/**"], forbidden: ["tests/**"] }],
    [{ trigger: "green_load_failure", writes: ["src/greet/**"] }, { allowed: ["src/greet/**"], forbidden: ["tests/**"] }],
    [{ trigger: "assembly_typecheck" }, { allowed: ["**"], forbidden: ["tests/**", "spec/**"] }],
  ] as const)("scopes %o to %o", (input, scope) => {
    expect(fixScopeOf(input)).toEqual(scope);
  });

  // @covers factory:BEH-012
  it("reports a test file changed on a green trigger as outside the allowed paths", () => {
    const scope = fixScopeOf({ trigger: "green_typecheck", writes: ["src/greet/**", "tests/greet/**"] });

    expect(changedFilesOutside(scope, ["src/greet/index.ts", "tests/greet/greet.test.ts"])).toEqual(["tests/greet/greet.test.ts"]);
  });

  it("reports package.json changed inside a lane as outside the task write-set", () => {
    const scope = fixScopeOf({ trigger: "red_suite_error", writes: ["src/greet/**", "tests/greet/**"] });

    expect(changedFilesOutside(scope, ["package.json", "src/greet/index.ts"])).toEqual(["package.json"]);
  });

  it("lets an assembly fix touch dotfiles and nested source but not spec or tests", () => {
    const scope = fixScopeOf({ trigger: "assembly_install" });

    expect(changedFilesOutside(scope, [".npmrc", "src/cli/.hidden/a.ts", "spec/spec.md", "tests/a.test.ts", "tsconfig.json"])).toEqual(["spec/spec.md", "tests/a.test.ts"]);
  });

  it("accepts an exact-path allowance for a file name with glob characters", () => {
    expect(changedFilesOutside({ allowed: ["design/[draft].md"], forbidden: [] }, ["design/[draft].md"])).toEqual([]);
  });
});
