import { describe, expect, it } from "vitest";
import { costOf } from "./pricing.js";

describe("costOf", () => {
  it("prices input and output tokens per million from the table", () => {
    const usd = costOf({ m: { inputPerMillion: 3, outputPerMillion: 15 } }, "m", { inputTokens: 1_000_000, outputTokens: 200_000 });

    expect(usd).toBe(6);
  });

  it("returns null for a model absent from the table", () => {
    expect(costOf({}, "m", { inputTokens: 10, outputTokens: 10 })).toBeNull();
  });

  it("returns null when the model is unknown", () => {
    expect(costOf({ m: { inputPerMillion: 1, outputPerMillion: 1 } }, null, { inputTokens: 10, outputTokens: 10 })).toBeNull();
  });
});
