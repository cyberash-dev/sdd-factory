import { randomInt } from "node:crypto";

export interface Link {
  readonly code: string;
  readonly url: string;
  readonly hits: number;
  readonly createdAt: Date;
}

export interface LinkStats {
  readonly code: string;
  readonly url: string;
  readonly hits: number;
  readonly createdAt: string;
}

export interface CreateLinkOutcome {
  readonly created: boolean;
  readonly link: Link;
}

export interface LinkStore {
  readonly byCode: Map<string, Link>;
  readonly byUrl: Map<string, string>;
}

const CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CODE_LENGTH = 6;

export function openStore(): LinkStore {
  return { byCode: new Map(), byUrl: new Map() };
}

export function isValidOriginalUrl(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function createCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

export function createLink(store: LinkStore, url: string): CreateLinkOutcome {
  const existingCode = store.byUrl.get(url);
  const existing = existingCode === undefined ? undefined : store.byCode.get(existingCode);
  if (existing !== undefined) {
    return { created: false, link: existing };
  }
  let code = createCode();
  while (store.byCode.has(code)) {
    code = createCode();
  }
  const link: Link = { code, url, hits: 0, createdAt: new Date() };
  store.byCode.set(code, link);
  store.byUrl.set(url, code);
  return { created: true, link };
}

export function findLink(store: LinkStore, code: string): Link | undefined {
  return store.byCode.get(code);
}

export function recordHit(store: LinkStore, code: string): Link | undefined {
  const link = store.byCode.get(code);
  if (link === undefined) {
    return undefined;
  }
  const updated: Link = { ...link, hits: link.hits + 1 };
  store.byCode.set(code, updated);
  return updated;
}

export function deleteLink(store: LinkStore, code: string): boolean {
  const link = store.byCode.get(code);
  if (link === undefined) {
    return false;
  }
  store.byCode.delete(code);
  store.byUrl.delete(link.url);
  return true;
}

export function toStats(link: Link): LinkStats {
  return {
    code: link.code,
    url: link.url,
    hits: link.hits,
    createdAt: link.createdAt.toISOString(),
  };
}
