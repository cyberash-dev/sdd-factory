import { readFile } from "node:fs/promises";
import { join } from "node:path";

export class PromptPlaceholderError extends Error {
  override readonly name = "PromptPlaceholderError";
}

export type PromptVariables = Readonly<Record<string, string>>;

export interface PromptLibrary {
  load(role: string): Promise<string>;
  render(template: string, variables: PromptVariables): string;
}

const PLACEHOLDER = /\{\{([a-z_]+)\}\}/g;

export function renderTemplate(template: string, variables: PromptVariables): string {
  const missing = new Set<string>();
  const rendered = template.replace(PLACEHOLDER, (whole, name: string) => {
    const value = variables[name];
    if (value === undefined) {
      missing.add(name);
      return whole;
    }
    return value;
  });
  if (missing.size > 0) {
    throw new PromptPlaceholderError(`unresolved placeholders: ${[...missing].sort().join(", ")}`);
  }
  return rendered;
}

export function createPromptLibrary(promptsDir: string): PromptLibrary {
  const cache = new Map<string, string>();
  return {
    async load(role) {
      const cached = cache.get(role);
      if (cached !== undefined) {
        return cached;
      }
      const text = await readFile(join(promptsDir, `${role}.md`), "utf8");
      cache.set(role, text);
      return text;
    },
    render: renderTemplate,
  };
}
