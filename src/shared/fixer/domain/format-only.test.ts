import { describe, expect, it } from "vitest";
import { formatOnlyViolations } from "./format-only.js";

describe("format-only check", () => {
  // @covers factory:BEH-012
  it("passes when every record that parsed before parses to identical data after and a broken record became parseable", () => {
    const before = new Map([["app:BEH-001", '{"title":"greets"}']]);
    const after = new Map([
      ["app:BEH-001", '{"title":"greets"}'],
      ["app:BEH-002", '{"title":"was broken"}'],
    ]);

    expect(formatOnlyViolations(before, after)).toEqual([]);
  });

  // @covers factory:BEH-012
  it("reports a changed field value of a record that parsed before", () => {
    const before = new Map([["app:BEH-001", '{"title":"greets"}']]);
    const after = new Map([["app:BEH-001", '{"title":"greets loudly"}']]);

    expect(formatOnlyViolations(before, after)).toEqual([{ id: "app:BEH-001", kind: "changed" }]);
  });

  it("reports a record id that disappeared", () => {
    const before = new Map([
      ["app:BEH-001", "{}"],
      ["app:BEH-002", "{}"],
    ]);
    const after = new Map([["app:BEH-001", "{}"]]);

    expect(formatOnlyViolations(before, after)).toEqual([{ id: "app:BEH-002", kind: "missing" }]);
  });
});
