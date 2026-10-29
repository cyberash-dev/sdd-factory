const SECRET_KEY = /KEY|TOKEN|SECRET|PASSWORD/i;
const MIN_SECRET_LENGTH = 8;

export function secretValuesOf(env: Readonly<Record<string, string | undefined>>): readonly string[] {
  return Object.entries(env)
    .filter(([key, value]) => SECRET_KEY.test(key) && value !== undefined && value.length >= MIN_SECRET_LENGTH)
    .map(([, value]) => value ?? "");
}

export function redactSecrets(text: string, secrets: readonly string[]): string {
  return secrets.reduce((redacted, secret) => redacted.split(secret).join("[REDACTED]"), text);
}
