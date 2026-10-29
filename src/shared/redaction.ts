export const SECRET_NAME_PATTERN = /KEY|TOKEN|SECRET|PASSWORD/i;
export const MIN_SECRET_LENGTH = 8;
export const REDACTED = "[REDACTED]";

export type Redactor = (text: string) => string;

export function secretValuesOf(env: Readonly<Record<string, string | undefined>>): readonly string[] {
  return Object.entries(env)
    .filter(([name, value]) => SECRET_NAME_PATTERN.test(name) && value !== undefined && value.length >= MIN_SECRET_LENGTH)
    .map(([, value]) => value ?? "")
    .sort((a, b) => b.length - a.length);
}

export function createRedactor(env: Readonly<Record<string, string | undefined>>): Redactor {
  const secrets = secretValuesOf(env);
  if (secrets.length === 0) {
    return (text) => text;
  }
  return (text) => secrets.reduce((redacted, secret) => redacted.split(secret).join(REDACTED), text);
}

export function redactDeep<T>(value: T, redact: Redactor): T {
  if (typeof value === "string") {
    return redact(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => redactDeep(item, redact)) as T;
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = redactDeep(item, redact);
    }
    return out as T;
  }
  return value;
}
