import type { ModelPricing } from "../config.js";

export interface TokenCounts {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export function costOf(pricing: Readonly<Record<string, ModelPricing>>, model: string | null, tokens: TokenCounts): number | null {
  if (model === null) {
    return null;
  }
  const price = pricing[model];
  if (price === undefined) {
    return null;
  }
  const usd = (tokens.inputTokens * price.inputPerMillion + tokens.outputTokens * price.outputPerMillion) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}
