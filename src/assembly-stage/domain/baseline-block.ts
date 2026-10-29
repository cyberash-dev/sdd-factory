export class BaselineBlockError extends Error {
  override readonly name = "BaselineBlockError";
}

export interface BaselineFreshness {
  readonly token: string;
  readonly commitSha: string;
}

const BLOCK_START = "type: BrownfieldBaseline";
const LINE_REWRITES: readonly { readonly pattern: RegExp; readonly render: (freshness: BaselineFreshness, indent: string) => string }[] = [
  { pattern: /^(\s+)reference: \S+$/, render: (freshness, indent) => `${indent}reference: ${freshness.commitSha}` },
  { pattern: /^()freshness_token: \S+$/, render: (freshness) => `freshness_token: ${freshness.token}` },
  { pattern: /^()baseline_commit_sha: \S+$/, render: (freshness) => `baseline_commit_sha: ${freshness.commitSha}` },
];

export function refreshBaselineBlock(specText: string, freshness: BaselineFreshness): string {
  const lines = specText.split("\n");
  const start = lines.findIndex((line) => line === BLOCK_START);
  if (start === -1) {
    throw new BaselineBlockError("spec/spec.md has no BrownfieldBaseline record");
  }
  const end = lines.findIndex((line, index) => index > start && line === "---");
  const rewritten = new Set<number>();
  const refreshed = lines.map((line, index) => {
    if (index <= start || (end !== -1 && index >= end)) {
      return line;
    }
    const rewrite = LINE_REWRITES.findIndex((candidate) => candidate.pattern.test(line));
    if (rewrite === -1 || rewritten.has(rewrite)) {
      return line;
    }
    rewritten.add(rewrite);
    const match = LINE_REWRITES[rewrite]?.pattern.exec(line);
    return LINE_REWRITES[rewrite]?.render(freshness, match?.[1] ?? "") ?? line;
  });
  if (rewritten.size !== LINE_REWRITES.length) {
    throw new BaselineBlockError("BrownfieldBaseline record lacks reference, freshness_token or baseline_commit_sha");
  }
  return refreshed.join("\n");
}
