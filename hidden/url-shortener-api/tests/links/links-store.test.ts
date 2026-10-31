import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createCode, createLink, deleteLink, findLink, openStore } from "../../src/links/index.js";

const CODE_PATTERN = /^[a-zA-Z0-9]{6}$/;

describe("in-memory state (INV-001)", () => {
  // @covers url-shortener-api:INV-001
  it("a restarted store is empty so every previously issued code is unknown", () => {
    const before = openStore();
    const codes = [createLink(before, "https://example.com/a").link.code, createLink(before, "https://example.com/b").link.code];
    const after = openStore();
    for (const code of codes) {
      expect(findLink(after, code)).toBeUndefined();
    }
    expect(after.byCode.size).toBe(0);
    expect(after.byUrl.size).toBe(0);
  });

  it("a freshly opened store has no Link for an unknown code", () => {
    const store = openStore();
    expect(findLink(store, "unknowncode")).toBeUndefined();
    expect(store.byCode.size).toBe(0);
  });

  it("a restart after deleting a Link leaves every code unknown, deleted or not", () => {
    const before = openStore();
    const codes = ["https://example.com/1", "https://example.com/2", "https://example.com/3"].map(
      (url) => createLink(before, url).link.code,
    );
    expect(deleteLink(before, codes[1])).toBe(true);
    const after = openStore();
    for (const code of codes) {
      expect(findLink(after, code)).toBeUndefined();
    }
    expect(after.byCode.size).toBe(0);
  });

  it("a restarted store accepts a previously submitted url as a new Link", () => {
    const before = openStore();
    createLink(before, "https://example.com/again");
    const after = openStore();
    const outcome = createLink(after, "https://example.com/again");
    expect(outcome.created).toBe(true);
    expect(outcome.link.hits).toBe(0);
  });
});

describe("code format and uniqueness (INV-002)", () => {
  // @covers url-shortener-api:INV-002
  it("five Links for five distinct urls get five distinct 6-character alphanumeric codes", () => {
    const store = openStore();
    const codes = [1, 2, 3, 4, 5].map((n) => createLink(store, `https://example.com/${n}`).link.code);
    for (const code of codes) {
      expect(code).toMatch(CODE_PATTERN);
    }
    expect(new Set(codes).size).toBe(5);
  });

  it("the first Link of a freshly opened store has a code matching the format", () => {
    const store = openStore();
    expect(createLink(store, "https://example.com/first").link.code).toMatch(CODE_PATTERN);
  });

  it("200 Links created back to back have pairwise distinct codes and each resolves to its own url", () => {
    const store = openStore();
    const urls = Array.from({ length: 200 }, (_, i) => `https://example.com/item/${i}`);
    const codes = urls.map((url) => createLink(store, url).link.code);
    for (const code of codes) {
      expect(code).toMatch(CODE_PATTERN);
    }
    expect(new Set(codes).size).toBe(200);
    urls.forEach((url, i) => {
      expect(findLink(store, codes[i])?.url).toBe(url);
    });
  });

  it("createCode returns 6 characters from [a-zA-Z0-9] on every call", () => {
    for (let i = 0; i < 50; i++) {
      expect(createCode()).toMatch(CODE_PATTERN);
    }
  });
});

describe("no durable storage (CON-002)", () => {
  // @covers url-shortener-api:CON-002
  it("creating and deleting Links writes no file into the working directory", () => {
    const listing = () => readdirSync(process.cwd()).sort();
    const before = listing();
    const store = openStore();
    const first = createLink(store, "https://example.com/keep");
    const second = createLink(store, "https://example.com/drop");
    expect(deleteLink(store, second.link.code)).toBe(true);
    expect(findLink(store, first.link.code)?.url).toBe("https://example.com/keep");
    expect(listing()).toEqual(before);
  });
});
