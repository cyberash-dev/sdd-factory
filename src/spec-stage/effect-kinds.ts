export const SPEC_EFFECT_KINDS = {
  draft: "spec.draft",
  review: "spec.review",
  approve: "spec.approve",
  assume: "spec.assume",
} as const;

export const DESIGN_EFFECT_KINDS = {
  architect: "design.architect",
  verification: "design.verification",
} as const;

export const SPEC_BLOCKED_REASONS = ["lint_cap", "critic_cap", "analyst_blocked"] as const;

export type SpecBlockedReason = (typeof SPEC_BLOCKED_REASONS)[number];
