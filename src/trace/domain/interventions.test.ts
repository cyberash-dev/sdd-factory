import { describe, expect, it } from "vitest";
import { interventionLine, midRunCountLine } from "./interventions.js";

describe("intervention lines", () => {
  it("formats occurredAt, kind, actor and the quoted note on one LF-terminated line", () => {
    expect(interventionLine("2026-10-29T12:00:00.000Z", "launch", "cyberash", "pre-authorized")).toBe('2026-10-29T12:00:00.000Z launch actor=cyberash note="pre-authorized"\n');
  });

  it('escapes a double quote inside the note as \\"', () => {
    expect(interventionLine("2026-10-29T12:00:00.000Z", "mid_run_nudge", "cyberash", 'use "vitest"')).toBe('2026-10-29T12:00:00.000Z mid_run_nudge actor=cyberash note="use \\"vitest\\""\n');
  });

  it("folds a line break inside the note into a space so the entry stays one line", () => {
    expect(interventionLine("2026-10-29T12:00:00.000Z", "mid_run_nudge", "cyberash", "first\nsecond")).toBe('2026-10-29T12:00:00.000Z mid_run_nudge actor=cyberash note="first second"\n');
  });

  it("writes the final count line with the literal prefix", () => {
    expect(midRunCountLine(2)).toBe("mid-run interventions: 2\n");
  });
});
