export const AGENT_APPROVER_BLOCKLIST = [
  "agent",
  "claude",
  "claude-code",
  "code-gen-agent",
  "codex",
  "pipeline-driver",
  "spec-author-bot",
  "spec-lint",
  "sdd-cli",
] as const;

export function isBlockedOperator(identity: string): boolean {
  const lower = identity.toLowerCase();
  return (AGENT_APPROVER_BLOCKLIST as readonly string[]).includes(lower) || identity.startsWith("bot:");
}

export class OperatorError extends Error {
  override readonly name = "OperatorError";
}

export function resolveOperator(flag: string | null, environment: string | undefined): string {
  const identity = flag ?? environment ?? null;
  if (identity === null || identity.trim().length === 0) {
    throw new OperatorError("operator identity is required: pass --operator <identity> or set FACTORY_OPERATOR");
  }
  if (isBlockedOperator(identity)) {
    throw new OperatorError(`operator "${identity}" is an agent identity and cannot pre-authorise approvals`);
  }
  return identity;
}
