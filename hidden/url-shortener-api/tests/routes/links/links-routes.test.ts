import { describe, expect, it } from "vitest";
import { findLink, openStore, recordHit } from "../../../src/links/index.js";
import type { LinkStore } from "../../../src/links/index.js";
import { routeLinks } from "../../../src/routes/links/index.js";
import type { HttpResponse } from "../../../src/errors/index.js";

const PORT = 4321;
const CODE_PATTERN = /^[a-zA-Z0-9]{6}$/;

function send(store: LinkStore, method: string, path: string, body = "") {
  return routeLinks({ method, path, body }, { store, port: PORT });
}

function post(store: LinkStore, payload: unknown) {
  return send(store, "POST", "/links", typeof payload === "string" ? payload : JSON.stringify(payload));
}

function json(response: HttpResponse | undefined): Record<string, unknown> {
  return JSON.parse(response?.body ?? "null") as Record<string, unknown>;
}

describe("POST /links creates a Link", () => {
  // @covers url-shortener-api:BEH-001
  it("a new http or https original URL answers 201 with a six-character code, echoed url and one stored Link with hit counter 0", () => {
    for (const url of ["https://example.com/a", "http://example.com/plain"]) {
      const store = openStore();
      const response = post(store, { url });
      expect(response?.status).toBe(201);
      const body = json(response);
      expect(body.code).toMatch(CODE_PATTERN);
      expect(body.url).toBe(url);
      expect(body.shortUrl).toBe(`http://localhost:${PORT}/${String(body.code)}`);
      expect(store.byCode.size).toBe(1);
      expect(findLink(store, String(body.code))?.hits).toBe(0);
    }
  });

  // @covers url-shortener-api:CTR-001
  it("answers 201 and 200 with exactly code, url and shortUrl, and 400 bodies holding exactly a documented error code", () => {
    const store = openStore();
    const first = post(store, { url: "https://example.com/c1" });
    expect(first?.status).toBe(201);
    const created = json(first);
    expect(Object.keys(created).sort()).toEqual(["code", "shortUrl", "url"]);
    expect(created.code).toMatch(CODE_PATTERN);
    expect(created.shortUrl).toBe(`http://localhost:${PORT}/${String(created.code)}`);

    const repeat = post(store, { url: "https://example.com/c1" });
    expect(repeat?.status).toBe(200);
    expect(json(repeat)).toEqual(created);

    const badUrl = post(store, { url: "example.com/no-scheme" });
    expect(badUrl?.status).toBe(400);
    expect(json(badUrl)).toEqual({ error: "invalid_url" });
    const badJson = post(store, "not-json");
    expect(badJson?.status).toBe(400);
    expect(json(badJson)).toEqual({ error: "invalid_json" });
  });

  // @covers url-shortener-api:BEH-002
  it("reshortening an existing original URL answers 200 with the same code, one Link and an unchanged hit counter", () => {
    const store = openStore();
    const first = post(store, { url: "https://example.com/b3" });
    expect(first?.status).toBe(201);
    const code = String(json(first).code);
    recordHit(store, code);
    recordHit(store, code);
    for (let i = 0; i < 2; i++) {
      const repeat = post(store, { url: "https://example.com/b3" });
      expect(repeat?.status).toBe(200);
      expect(json(repeat).code).toBe(code);
    }
    expect(store.byCode.size).toBe(1);
    expect(json(send(store, "GET", `/links/${code}`)).hits).toBe(2);
  });

  // @covers url-shortener-api:BEH-003
  it("a missing, empty, non-string, relative or non-http url answers 400 invalid_url and leaves the in-memory state unchanged", () => {
    const store = openStore();
    post(store, { url: "https://example.com/seed" });
    const bodies: unknown[] = [
      { target: "https://example.com/a" },
      { url: "" },
      { url: "/a/b" },
      { url: "ftp://example.com/f" },
      { url: 123 },
    ];
    for (const payload of bodies) {
      const response = post(store, payload);
      expect(response?.status).toBe(400);
      expect(json(response)).toEqual({ error: "invalid_url" });
      expect(response?.headers.location).toBeUndefined();
      expect(store.byCode.size).toBe(1);
    }
    const valid = post(store, { url: "https://example.com/valid" });
    expect(valid?.status).toBe(201);
    expect(store.byCode.size).toBe(2);
  });

  // @covers url-shortener-api:BEH-004
  it("a body that is not JSON answers 400 invalid_json, leaves the in-memory state unchanged and a following valid request is served", () => {
    const store = openStore();
    post(store, { url: "https://example.com/seed" });
    for (const raw of ["not-json", "", '{"url":"https://example.com/x"']) {
      const response = post(store, raw);
      expect(response?.status).toBe(400);
      expect(json(response)).toEqual({ error: "invalid_json" });
      expect(store.byCode.size).toBe(1);
    }
    const after = post(store, { url: "https://example.com/after" });
    expect(after?.status).toBe(201);
    expect(json(after).code).toMatch(CODE_PATTERN);
  });
});

describe("GET /links/:code returns Link statistics", () => {
  // @covers url-shortener-api:BEH-007
  it("a known code answers 200 with code, url, hits equal to the redirect count and an ISO-8601 createdAt", () => {
    const store = openStore();
    const code = String(json(post(store, { url: "https://example.com/s" })).code);
    const fresh = send(store, "GET", `/links/${code}`);
    expect(fresh?.status).toBe(200);
    const stats = json(fresh);
    expect(stats.code).toBe(code);
    expect(stats.url).toBe("https://example.com/s");
    expect(stats.hits).toBe(0);
    expect(String(stats.createdAt)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    expect(Number.isNaN(Date.parse(String(stats.createdAt)))).toBe(false);

    recordHit(store, code);
    recordHit(store, code);
    const later = json(send(store, "GET", `/links/${code}`));
    expect(later.hits).toBe(2);
    expect(later.createdAt).toBe(stats.createdAt);
  });

  // @covers url-shortener-api:CTR-003
  it("answers 200 with exactly code, url, hits and createdAt and 404 with exactly error not_found for an unknown code", () => {
    const store = openStore();
    const code = String(json(post(store, { url: "https://example.com/s1" })).code);
    const ok = send(store, "GET", `/links/${code}`);
    expect(ok?.status).toBe(200);
    const stats = json(ok);
    expect(Object.keys(stats).sort()).toEqual(["code", "createdAt", "hits", "url"]);
    expect(Number.isInteger(stats.hits)).toBe(true);
    expect(stats.hits as number).toBeGreaterThanOrEqual(0);
    expect(typeof stats.createdAt).toBe("string");

    const missing = send(store, "GET", "/links/Zq9x2B");
    expect(missing?.status).toBe(404);
    expect(json(missing)).toEqual({ error: "not_found" });
  });

  // @covers url-shortener-api:BEH-008
  it("an unknown or deleted code answers 404 with exactly error not_found and serves no statistics", () => {
    const store = openStore();
    const never = send(store, "GET", "/links/first0");
    expect(never?.status).toBe(404);
    expect(json(never)).toEqual({ error: "not_found" });

    const code = String(json(post(store, { url: "https://example.com/gone" })).code);
    expect(send(store, "DELETE", `/links/${code}`)?.status).toBe(204);
    const deleted = send(store, "GET", `/links/${code}`);
    expect(deleted?.status).toBe(404);
    expect(json(deleted)).toEqual({ error: "not_found" });
  });
});

describe("DELETE /links/:code forgets a Link", () => {
  // @covers url-shortener-api:BEH-009
  it("a known code answers 204 without a JSON body and the Link is forgotten so it can no longer redirect", () => {
    const store = openStore();
    const code = String(json(post(store, { url: "https://example.com/d" })).code);
    const response = send(store, "DELETE", `/links/${code}`);
    expect(response?.status).toBe(204);
    expect(response?.body ?? "").toBe("");
    expect(response?.headers["content-type"]).toBeUndefined();
    expect(findLink(store, code)).toBeUndefined();
    expect(recordHit(store, code)).toBeUndefined();
    expect(store.byCode.size).toBe(0);
    const stats = send(store, "GET", `/links/${code}`);
    expect(stats?.status).toBe(404);
    expect(json(stats)).toEqual({ error: "not_found" });
  });

  // @covers url-shortener-api:CTR-004
  it("answers 204 with an empty body for a known code and 404 with exactly error not_found for an unknown code", () => {
    const store = openStore();
    const code = String(json(post(store, { url: "https://example.com/c4" })).code);
    const ok = send(store, "DELETE", `/links/${code}`);
    expect(ok?.status).toBe(204);
    expect(ok?.body ?? "").toBe("");
    const missing = send(store, "DELETE", "/links/Zq9x2B");
    expect(missing?.status).toBe(404);
    expect(json(missing)).toEqual({ error: "not_found" });
  });

  // @covers url-shortener-api:BEH-010
  it("an unknown code and a repeated deletion answer 404 with exactly error not_found", () => {
    const store = openStore();
    const never = send(store, "DELETE", "/links/first0");
    expect(never?.status).toBe(404);
    expect(json(never)).toEqual({ error: "not_found" });

    const code = String(json(post(store, { url: "https://example.com/twice" })).code);
    expect(send(store, "DELETE", `/links/${code}`)?.status).toBe(204);
    const again = send(store, "DELETE", `/links/${code}`);
    expect(again?.status).toBe(404);
    expect(json(again)).toEqual({ error: "not_found" });
    expect(send(store, "GET", "/links/Zq9x2B")?.status).toBe(404);
  });
});

describe("boundary validation never crashes the process", () => {
  // @covers url-shortener-api:POL-002
  it("after a malformed body, an invalid url, an unmatched route or an unsupported method a following valid request is answered and the in-memory state is unchanged", () => {
    const store = openStore();
    expect(post(store, "not-json")?.status).toBe(400);
    expect(post(store, { url: "https://example.com/ok" })?.status).toBe(201);
    expect(post(store, "")?.status).toBe(400);
    expect(send(store, "GET", "/links/unknowncode")?.status).toBe(404);
    expect(post(store, { url: "ftp://example.com/f" })?.status).toBe(400);
    expect(post(store, { url: "https://example.com/after" })?.status).toBe(201);
    expect(store.byCode.size).toBe(2);

    expect(send(store, "GET", "/a/b/c/d")).toBeUndefined();
    expect(send(store, "PUT", "/links", '{"url":"https://example.com/state"}')).toBeUndefined();
    expect(store.byCode.size).toBe(2);
    expect(store.byUrl.has("https://example.com/state")).toBe(false);
    const missing = send(store, "GET", "/links/unknowncode");
    expect(missing?.status).toBe(404);
    expect(json(missing)).toEqual({ error: "not_found" });
  });
});
