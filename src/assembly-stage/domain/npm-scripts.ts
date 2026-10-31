const NAMED_SCRIPT = /\bnpm\s+(?:(start|test)\b|run\s+([\w:-]+))/g;

export interface NpmScripts {
  readonly defined: readonly string[];
  readonly named: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function npmScriptsNamedIn(markdown: string): readonly string[] {
  const names = [...markdown.matchAll(NAMED_SCRIPT)].map((match) => match[1] ?? match[2] ?? "");
  return [...new Set(names)].sort();
}

export function scriptNamesOf(packageJson: string | null): readonly string[] {
  if (packageJson === null) {
    return [];
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(packageJson);
  } catch (error) {
    /* an unparseable package.json fails npm ci first; the scripts are read again after a fix */
    if (error instanceof SyntaxError) {
      return [];
    }
    throw error;
  }
  const scripts = isRecord(manifest) ? manifest["scripts"] : undefined;
  return isRecord(scripts) ? Object.keys(scripts).filter((name) => typeof scripts[name] === "string") : [];
}

export function missingScripts(scripts: NpmScripts): readonly string[] {
  return scripts.named.filter((name) => !scripts.defined.includes(name));
}

/* assembly-stage:DLT-006: the scripts check runs as the build step even for a product without scripts.build. */
export function hasBuildStep(scripts: NpmScripts): boolean {
  return scripts.defined.includes("build") || scripts.named.length > 0;
}

export function npmScriptsEvidence(scripts: NpmScripts): string {
  return `${JSON.stringify({ named: scripts.named, missing: missingScripts(scripts) })}\n`;
}

/* assembly-stage:DLT-006: evidence of any other build failure (the npm run build log) names no missing script. */
export function missingScriptsIn(evidence: string): readonly string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(evidence);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return [];
    }
    throw error;
  }
  const missing = isRecord(parsed) ? parsed["missing"] : undefined;
  return Array.isArray(missing) ? missing.filter((name): name is string => typeof name === "string") : [];
}
