import { basename, extname } from "node:path";

export const SLUG_PATTERN = /^[a-z][a-z0-9-]*$/;

export class SlugError extends Error {
  override readonly name = "SlugError";
}

export function slugOf(specPath: string): string {
  const stem = basename(specPath, extname(specPath));
  const slug = stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!SLUG_PATTERN.test(slug)) {
    throw new SlugError(`cannot derive a partition slug from ${specPath}`);
  }
  return slug;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function runIdOf(slug: string, now: Date): string {
  const date = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const time = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `${slug}-${date}-${time}`;
}
