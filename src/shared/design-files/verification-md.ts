export type Feasibility = "feasible" | "infeasible_candidate";

export interface VerificationBlock {
  readonly id: string;
  readonly template: string;
  readonly feasibility: Feasibility;
  readonly yamlSource: string;
}

export interface VerificationDesign {
  readonly blocks: readonly VerificationBlock[];
  readonly infeasibleCandidates: readonly { readonly id: string; readonly reason: string }[];
}

export class VerificationMdParseError extends Error {
  override readonly name = "VerificationMdParseError";
}

/* Implemented by the design-stage slice owner; the signature is the contract build-stage relies on. */
export function parseVerificationMd(_markdown: string): VerificationDesign {
  throw new VerificationMdParseError("parseVerificationMd is not implemented yet");
}
