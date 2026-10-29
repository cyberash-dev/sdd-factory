import { describe, expect, it } from "vitest";
import { runIdOf, slugOf } from "./run-id.js";

describe("slug and run id", () => {
  // @covers factory:BEH-001
  it.each([
    ["specs/Todo CLI.md", "todo-cli"],
    ["./hidden_specs/url-shortener_api.md", "url-shortener-api"],
    ["Weather.API.v2.md", "weather-api-v2"],
  ])("derives the partition slug %s -> %s", (path, slug) => {
    expect(slugOf(path)).toBe(slug);
  });

  it("rejects a file name that leaves no slug characters", () => {
    expect(() => slugOf("specs/___.md")).toThrow("cannot derive a partition slug from specs/___.md");
  });

  it("rejects a slug starting with a digit", () => {
    expect(() => slugOf("specs/2fast.md")).toThrow("cannot derive a partition slug");
  });

  it("builds the run id from the slug and the UTC timestamp", () => {
    expect(runIdOf("todo-cli", new Date("2026-10-31T18:05:09.000Z"))).toBe("todo-cli-20261031-180509");
  });
});
