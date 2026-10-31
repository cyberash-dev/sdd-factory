import { describe, expect, it } from "vitest";
import { npmScriptsNamedIn } from "../../src/assembly-stage/domain/npm-scripts.js";

describe("npm scripts named by the source spec", () => {
  // @covers assembly-stage:DLT-006
  it.each([
    ["- Start it with `npm start` after `npm run build`.", ["build", "start"]],
    ["`npm run build` compiles, `npm test` passes, then npm run test:e2e.", ["build", "test", "test:e2e"]],
    ["Run npm start, and npm start again.", ["start"]],
    ["Install with `npm ci` or `npm install`; pnpm start is not ours.", []],
    ["A CLI that counts its arguments.", []],
  ] as const)("collects the scripts of %j", (markdown, expected) => {
    expect(npmScriptsNamedIn(markdown)).toEqual(expected);
  });
});
