import { afterEach, describe, expect, it, vi } from "vitest";
import type { HttpRequest, HttpResponse } from "../../../src/errors/index.js";
import type { Link, LinkStore } from "../../../src/links/index.js";
import { routeRedirect } from "../../../src/routes/redirect/index.js";

// Fixtures write the store maps directly so no stub of another module is called.
function storeWith(entries: ReadonlyArray<readonly [string, string]>): LinkStore {
  const byCode = new Map<string, Link>();
  const byUrl = new Map<string, string>();
  for (const [code, url] of entries) {
    byCode.set(code, { code, url, hits: 0, createdAt: new Date("2026-10-31T00:00:00.000Z") });
    byUrl.set(url, code);
  }
  return { byCode, byUrl };
}

function get(path: string): HttpRequest {
  return { method: "GET", path, body: "" };
}

function header(response: HttpResponse, name: string): string | undefined {
  const key = Object.keys(response.headers).find((k) => k.toLowerCase() === name);
  return key === undefined ? undefined : response.headers[key];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("redirect of a known code (CTR-002, BEH-005)", () => {
  // @covers url-shortener-api:CTR-002
  it("answers 302 with Location equal to the original url and no JSON body", () => {
    const store = storeWith([["aB3xY9", "https://example.com/g1"]]);
    const response = routeRedirect(get("/aB3xY9"), { store });
    expect(response).toBeDefined();
    expect(response?.status).toBe(302);
    expect(response && header(response, "location")).toBe("https://example.com/g1");
    expect(response?.body ?? "").toBe("");
    expect(response && header(response, "content-type")).toBeUndefined();
  });

  // @covers url-shortener-api:BEH-005
  it("first redirect of a Link just created counts exactly one hit", () => {
    const store = storeWith([["Fi4st1", "http://example.com/first"]]);
    const response = routeRedirect(get("/Fi4st1"), { store });
    expect(response?.status).toBe(302);
    expect(response && header(response, "location")).toBe("http://example.com/first");
    expect(store.byCode.get("Fi4st1")?.hits).toBe(1);
  });

  it.each([
    ["http", "http://example.com/h"],
    ["https", "https://example.com/r"],
    ["url with query and fragment", "https://example.com/p?a=1&b=%20x#frag"],
  ])("redirects a code created from an %s url with Location exactly as submitted", (_name, url) => {
    const store = storeWith([["Cd0001", url]]);
    const response = routeRedirect(get("/Cd0001"), { store });
    expect(response?.status).toBe(302);
    expect(response && header(response, "location")).toBe(url);
    expect(response?.body ?? "").toBe("");
  });

  it("second redirect of the same code keeps the Location and reports hits equal to 2", () => {
    const store = storeWith([["Tw0Rds", "https://example.com/twice"]]);
    const first = routeRedirect(get("/Tw0Rds"), { store });
    const second = routeRedirect(get("/Tw0Rds"), { store });
    expect(first?.status).toBe(302);
    expect(second?.status).toBe(302);
    expect(second && header(second, "location")).toBe("https://example.com/twice");
    expect(store.byCode.get("Tw0Rds")?.hits).toBe(2);
  });

  it("a redirect leaves the hit counter of other Links unchanged", () => {
    const store = storeWith([
      ["Aaaaaa", "https://example.com/a"],
      ["Bbbbbb", "https://example.com/b"],
    ]);
    routeRedirect(get("/Aaaaaa"), { store });
    expect(store.byCode.get("Aaaaaa")?.hits).toBe(1);
    expect(store.byCode.get("Bbbbbb")?.hits).toBe(0);
  });

  it("code lookup is case-sensitive so a differently cased code answers 404 not_found", () => {
    const store = storeWith([["AbCdEf", "https://example.com/case"]]);
    const response = routeRedirect(get("/abcdef"), { store });
    expect(response?.status).toBe(404);
    expect(response?.body).toBe('{"error":"not_found"}');
    expect(store.byCode.get("AbCdEf")?.hits).toBe(0);
  });
});

describe("redirect of an unknown code (CTR-002, BEH-006)", () => {
  // @covers url-shortener-api:BEH-006
  it.each([
    ["never-issued 6-character code", "/Zq9x2B"],
    ["code shorter than 6 characters", "/abc12"],
  ])("answers 404 not_found for a %s with no Location header", (_name, path) => {
    const store = storeWith([["Known1", "https://example.com/known"]]);
    const response = routeRedirect(get(path), { store });
    expect(response).toBeDefined();
    expect(response?.status).toBe(404);
    expect(response && header(response, "location")).toBeUndefined();
    expect(JSON.parse(response?.body ?? "null")).toEqual({ error: "not_found" });
    expect(response && header(response, "content-type")).toContain("application/json");
  });

  it("answers 404 not_found for a code deleted earlier and counts no hit", () => {
    const store = storeWith([["Del3te", "https://example.com/del"]]);
    store.byCode.delete("Del3te");
    store.byUrl.delete("https://example.com/del");
    const response = routeRedirect(get("/Del3te"), { store });
    expect(response?.status).toBe(404);
    expect(response && header(response, "location")).toBeUndefined();
    expect(JSON.parse(response?.body ?? "null")).toEqual({ error: "not_found" });
  });

  it("the 404 body holds no code, url or hits field", () => {
    const response = routeRedirect(get("/Zq9x2B"), { store: storeWith([]) });
    expect(response?.status).toBe(404);
    const body = JSON.parse(response?.body ?? "null") as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["error"]);
  });
});

describe("requests outside GET on a single non-empty path segment (M-04)", () => {
  it.each([
    ["POST", "/Known1"],
    ["DELETE", "/Known1"],
    ["GET", "/"],
    ["GET", "/links/Known1"],
    ["GET", "/Known1/extra"],
  ])("%s %s is not handled and returns undefined", (method, path) => {
    const store = storeWith([["Known1", "https://example.com/known"]]);
    const response = routeRedirect({ method, path, body: "" }, { store });
    expect(response).toBeUndefined();
    expect(store.byCode.get("Known1")?.hits).toBe(0);
  });
});

describe("redirect never fetches the original url (CON-003)", () => {
  // @covers url-shortener-api:CON-003
  it.each([
    ["an https url", "https://example.com/secure"],
    ["a url pointing at an unreachable host", "http://unreachable.invalid:9/never"],
  ])("redirect of %s answers 302 and issues no outbound request", (_name, url) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("outbound request issued"));
    const store = storeWith([["Out0ne", url]]);
    const response = routeRedirect(get("/Out0ne"), { store });
    expect(response?.status).toBe(302);
    expect(response && header(response, "location")).toBe(url);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
