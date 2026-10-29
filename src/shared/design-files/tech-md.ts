export interface TechExport {
  readonly name: string;
  readonly kind: "function" | "class" | "const" | "type" | "interface";
  readonly signature: string;
}

export interface TechModule {
  readonly id: string;
  readonly name: string;
  readonly responsibility: string;
  readonly covers: readonly string[];
  readonly owns: readonly string[];
  readonly entry: string;
  readonly dependsOn: readonly string[];
  readonly interfaceSource: string;
  readonly exports: readonly TechExport[];
  readonly notes: string;
}

export interface TechTooling {
  readonly node: string;
  readonly testCmd: string;
  readonly typecheckCmd: string;
  readonly dependencies: readonly string[];
  readonly devDependencies: readonly string[];
  readonly tsconfig: Readonly<Record<string, unknown>> | null;
}

export interface TraceabilityRow {
  readonly specId: string;
  readonly moduleId: string;
}

export interface TechDesign {
  readonly modules: readonly TechModule[];
  readonly tooling: TechTooling;
  readonly traceability: readonly TraceabilityRow[];
}

export class TechMdParseError extends Error {
  override readonly name = "TechMdParseError";
}

/* Implemented by the design-stage slice owner; the signature is the contract build-stage relies on. */
export function parseTechMd(_markdown: string): TechDesign {
  throw new TechMdParseError("parseTechMd is not implemented yet");
}
