const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD/i;
const MIN_SECRET_LENGTH = 8;

export function secretValuesOf(env: NodeJS.ProcessEnv): readonly string[] {
  return Object.entries(env)
    .filter(([name, value]) => SECRET_NAME.test(name) && value !== undefined && value.length >= MIN_SECRET_LENGTH)
    .map(([, value]) => value ?? "");
}

export function redactSecrets(text: string, secrets: readonly string[]): string {
  return secrets.reduce((redacted, secret) => redacted.replaceAll(secret, "[REDACTED]"), text);
}
