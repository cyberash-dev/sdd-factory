import { describe, expect, it } from "vitest";
import { globMatches } from "./glob.js";

describe("globMatches", () => {
  it.each([
    ["src/cli/**", "src/cli/parse.ts", true],
    ["src/cli/**", "src/cli/deep/nested.ts", true],
    ["src/cli/**", "src/store/x.ts", false],
    ["src/**", "src/cli/**", true],
    ["src/*.ts", "src/index.ts", true],
    ["src/*.ts", "src/cli/index.ts", false],
    ["**/*.test.ts", "tests/cli/parse.test.ts", true],
    ["**/*.test.ts", "parse.test.ts", true],
    ["package.json", "package.json", true],
    ["package.json", "package.json.bak", false],
    ["src/a.ts", "src/a.ts", true],
  ])("glob %s against %s is %s", (glob, path, expected) => {
    expect(globMatches(glob, path)).toBe(expected);
  });
});
