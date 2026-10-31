import { describe, expect, it } from "vitest";
import {
  formatAmountCents,
  isCalendarDate,
  isCategory,
  parseAmountToCents,
  utcDayOf,
} from "../../src/domain/index.js";

describe("amount in integer cents", () => {
  // @covers expense-ledger-cli:INV-002
  it("parses whole, one-decimal and two-decimal amounts to integer cents and renders two decimals", () => {
    expect(parseAmountToCents("12")).toBe(1200);
    expect(parseAmountToCents("12.5")).toBe(1250);
    expect(parseAmountToCents("12.50")).toBe(1250);
    expect(formatAmountCents(1200)).toBe("12.00");
    expect(formatAmountCents(1250)).toBe("12.50");
  });

  it("renders amounts below one unit with two decimals", () => {
    expect(formatAmountCents(5)).toBe("0.05");
  });

  it("round-trips an accepted amount to the same rendered value", () => {
    const cents = parseAmountToCents("12.5");
    expect(cents).toBe(1250);
    expect(Number.isInteger(cents)).toBe(true);
    expect(formatAmountCents(cents as number)).toBe("12.50");
  });

  it("reports invalid amounts as null", () => {
    for (const text of ["abc", "", "0", "-5", "12.505"]) {
      expect(parseAmountToCents(text), text).toBeNull();
    }
  });
});

describe("calendar day in UTC", () => {
  // @covers expense-ledger-cli:INV-003
  it("accepts a leap day and a month end, and takes the default from the UTC day of the given instant", () => {
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(isCalendarDate("2026-02-28")).toBe(true);
    expect(utcDayOf(new Date("2026-10-31T23:59:59.999Z"))).toBe("2026-10-31");
  });

  it("rejects non-existent days and non-YYYY-MM-DD formats", () => {
    for (const text of ["2026-02-30", "2026-02-29", "2026-13-01", "2026-2-3", "2026-02-28T00:00:00Z", "abc"]) {
      expect(isCalendarDate(text), text).toBe(false);
    }
  });

  it("names the UTC day at the day boundaries", () => {
    expect(utcDayOf(new Date("2026-10-31T00:00:00.000Z"))).toBe("2026-10-31");
    expect(utcDayOf(new Date("2026-11-01T00:00:00.000Z"))).toBe("2026-11-01");
    expect(utcDayOf(new Date("2028-02-29T12:00:00.000Z"))).toBe("2028-02-29");
  });
});

describe("category rule", () => {
  // @covers expense-ledger-cli:INV-008
  it("accepts categories of 1 and 20 characters from lowercase letters, digits and hyphen", () => {
    expect(isCategory("a")).toBe(true);
    expect(isCategory("abcdefghij0123456789")).toBe(true);
    expect(isCategory("a-1")).toBe(true);
  });

  it("rejects 21 characters, uppercase, underscore, empty and other characters", () => {
    for (const text of ["abcdefghij01234567890", "123456789012345678901", "Coffee", "food_2", "", "caf é", "a b"]) {
      expect(isCategory(text), text).toBe(false);
    }
  });
});
