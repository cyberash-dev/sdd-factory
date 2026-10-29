export const SECRET_NAME_PATTERN = /KEY|TOKEN|SECRET|PASSWORD/i;
export const MIN_SECRET_LENGTH = 8;
export const REDACTED = "[REDACTED]";

export type Environment = Readonly<Record<string, string | undefined>>;

export function secretValuesOf(env: Environment): readonly string[] {
  const values = new Set<string>();
  for (const [name, value] of Object.entries(env)) {
    if (SECRET_NAME_PATTERN.test(name) && value !== undefined && value.length >= MIN_SECRET_LENGTH) {
      values.add(value);
    }
  }
  return [...values].sort((left, right) => right.length - left.length);
}

export interface Redactor {
  text(value: string): string;
}

/* A secret inside a JSON string may appear in its escaped form, so both spellings are needles. */
export function createRedactor(secrets: readonly string[]): Redactor {
  const needles = [...new Set(secrets.flatMap((secret) => [secret, JSON.stringify(secret).slice(1, -1)]))].sort((left, right) => right.length - left.length);
  return {
    text(value: string): string {
      let result = value;
      for (const needle of needles) {
        result = result.split(needle).join(REDACTED);
      }
      return result;
    },
  };
}
