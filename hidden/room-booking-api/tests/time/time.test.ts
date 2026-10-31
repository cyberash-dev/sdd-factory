import { describe, expect, it } from "vitest";
import { formatUtcMinute, intervalOf, lengthMs, overlaps, parseUtcMinute } from "../../src/time/index.js";

const at = (h: number, m = 0) => Date.UTC(2026, 10, 2, h, m);

describe("UTC minute times", () => {
  // @covers room-booking-api:INV-006
  it("minute-precision Z-suffixed times round-trip unchanged", () => {
    expect(parseUtcMinute("2026-11-02T09:30:00Z")).toBe(at(9, 30));
    expect(parseUtcMinute("2026-11-02T10:15:00Z")).toBe(at(10, 15));
    expect(formatUtcMinute(at(9, 30))).toBe("2026-11-02T09:30:00Z");
    expect(formatUtcMinute(at(10, 15))).toBe("2026-11-02T10:15:00Z");
  });

  it.each([
    ["second precision", "2026-11-02T09:00:30Z"],
    ["offset time", "2026-11-02T09:00:00+01:00"],
    ["missing Z", "2026-11-02T09:00:00"],
    ["milliseconds", "2026-11-02T09:00:00.000Z"],
    ["impossible day", "2026-02-30T09:00:00Z"],
    ["impossible hour", "2026-11-02T25:00:00Z"],
    ["date only", "2026-11-02"],
    ["empty string", ""],
  ])("%s is rejected as undefined", (_name, value) => {
    expect(parseUtcMinute(value)).toBeUndefined();
  });

  it.each([[null], [undefined], [12345], [{}]])("non-string %j is rejected as undefined", (value) => {
    expect(parseUtcMinute(value)).toBeUndefined();
  });
});

describe("half-open intervals", () => {
  const b1 = () => intervalOf(at(9), at(10));

  // @covers room-booking-api:INV-005
  it("touching intervals never overlap and overlapping intervals always overlap", () => {
    expect(overlaps(b1(), intervalOf(at(10), at(11)))).toBe(false);
    expect(overlaps(intervalOf(at(10), at(11)), b1())).toBe(false);
    expect(overlaps(b1(), intervalOf(at(8), at(9)))).toBe(false);
    expect(overlaps(b1(), intervalOf(at(9, 59), at(10, 30)))).toBe(true);
    expect(overlaps(intervalOf(at(9, 59), at(10, 30)), b1())).toBe(true);
    expect(overlaps(b1(), intervalOf(at(9), at(10)))).toBe(true);
  });

  it("an interval containing another overlaps it", () => {
    expect(overlaps(intervalOf(at(8), at(12)), intervalOf(at(9), at(10)))).toBe(true);
    expect(overlaps(intervalOf(at(9), at(10)), intervalOf(at(8), at(12)))).toBe(true);
  });

  it("interval keeps its bounds and length is end minus start", () => {
    const i = intervalOf(at(9), at(10, 15));
    expect(i).toEqual({ startMs: at(9), endMs: at(10, 15) });
    expect(lengthMs(i)).toBe(4500000);
  });
});
