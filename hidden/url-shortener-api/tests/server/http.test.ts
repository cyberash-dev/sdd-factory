import { describe, expect, it } from "vitest";
import { resolvePort, startServer } from "../../src/index.js";

const HOST = "127.0.0.1";

async function withServer(fn: (base: string, port: number) => Promise<void>): Promise<void> {
  const handle = await startServer({ port: 0, host: HOST });
  try {
    await fn(`http://${HOST}:${handle.port}`, handle.port);
  } finally {
    await handle.close();
  }
}

async function send(base: string, method: string, path: string, body?: string): Promise<Response> {
  return fetch(base + path, {
    method,
    redirect: "manual",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body,
  });
}

async function expectNotFound(res: Response): Promise<void> {
  expect(res.status).toBe(404);
  expect(res.headers.get("location")).toBeNull();
  expect(await res.json()).toEqual({ error: "not_found" });
}

describe("composition root unmatched requests", () => {
  // @covers url-shortener-api:CTR-005
  it("answers 404 not_found for an unmatched path and method and stores no Link", async () => {
    await withServer(async (base) => {
      await expectNotFound(await send(base, "GET", "/a/b/c/d"));
      await expectNotFound(await send(base, "GET", "/engine"));
      await expectNotFound(await send(base, "PUT", "/links", '{"url":"https://example.com/u"}'));
      const created = await send(base, "POST", "/links", '{"url":"https://example.com/u"}');
      expect(created.status).toBe(201);
    });
  });

  // @covers url-shortener-api:BEH-011
  it("answers 404 not_found for a path no surface member serves", async () => {
    await withServer(async (base) => {
      const cases: Array<[string, string]> = [
        ["GET", "/a/b/c/d"],
        ["GET", "/links/"],
        ["POST", "/links/abc123"],
        ["GET", "/links/abc/extra"],
      ];
      for (const [method, path] of cases) {
        const res = await send(base, method, path);
        expect(res.status, `${method} ${path}`).toBe(404);
        expect(res.headers.get("location")).toBeNull();
        expect(await res.json()).toEqual({ error: "not_found" });
      }
    });
  });

  // @covers url-shortener-api:BEH-012
  it("answers 404 not_found for an unsupported method and keeps the in-memory state unchanged", async () => {
    await withServer(async (base) => {
      await expectNotFound(await send(base, "PUT", "/links", '{"url":"https://example.com/m"}'));
      await expectNotFound(await send(base, "POST", "/engine", ""));
      await expectNotFound(await send(base, "DELETE", "/links"));
      const created = await send(base, "POST", "/links", '{"url":"https://example.com/m"}');
      expect(created.status).toBe(201);
      await expectNotFound(await send(base, "GET", "/zzzzzz-nothing"));
    });
  });
});

describe("port resolution", () => {
  // @covers url-shortener-api:CTR-006
  it("listens on the resolved port and carries it unchanged in shortUrl", async () => {
    expect(resolvePort({ PORT: "4123" })).toEqual({ ok: true, port: 4123 });
    expect(resolvePort({})).toEqual({ ok: true, port: 3000 });
    expect(resolvePort({ PORT: "abc" })).toEqual({ ok: false, error: "invalid_port" });
    await withServer(async (base, port) => {
      expect(port).toBeGreaterThan(0);
      const res = await send(base, "POST", "/links", '{"url":"https://example.com/p"}');
      expect(res.status).toBe(201);
      const body = (await res.json()) as { code: string; shortUrl: string };
      expect(body.shortUrl).toBe(`http://localhost:${port}/${body.code}`);
    });
  });

  // @covers url-shortener-api:ED-001
  it("reads PORT as absent, present or invalid", () => {
    expect(resolvePort({ PORT: undefined })).toEqual({ ok: true, port: 3000 });
    expect(resolvePort({ PORT: "" })).toEqual({ ok: true, port: 3000 });
    expect(resolvePort({ PORT: "4123" })).toEqual({ ok: true, port: 4123 });
    expect(resolvePort({ PORT: "abc" })).toEqual({ ok: false, error: "invalid_port" });
  });

  it.each([
    ["1", 1],
    ["3000", 3000],
    ["65535", 65535],
  ])("accepts PORT=%s as a valid port number", (value, port) => {
    expect(resolvePort({ PORT: value })).toEqual({ ok: true, port });
  });

  it.each(["abc", "70000", "65536", "0", "-1", "1.5", "12ab", " "])(
    "rejects PORT=%j with invalid_port",
    (value) => {
      expect(resolvePort({ PORT: value })).toEqual({ ok: false, error: "invalid_port" });
    },
  );
});

describe("Link scenarios", () => {
  // @covers url-shortener-api:SCN-001
  it("runs the Link lifecycle from creation to deletion", async () => {
    await withServer(async (base) => {
      const target = "https://example.com/lifecycle";
      const created = await send(base, "POST", "/links", JSON.stringify({ url: target }));
      expect(created.status).toBe(201);
      const { code } = (await created.json()) as { code: string };
      for (let i = 0; i < 2; i++) {
        const redirect = await send(base, "GET", `/${code}`);
        expect(redirect.status).toBe(302);
        expect(redirect.headers.get("location")).toBe(target);
      }
      const stats = await send(base, "GET", `/links/${code}`);
      expect(stats.status).toBe(200);
      expect(((await stats.json()) as { hits: number }).hits).toBe(2);
      const deleted = await send(base, "DELETE", `/links/${code}`);
      expect(deleted.status).toBe(204);
      expect(await deleted.text()).toBe("");
      for (const path of [`/${code}`, `/links/${code}`]) {
        const res = await send(base, "GET", path);
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: "not_found" });
      }
    });
  });

  // @covers url-shortener-api:SCN-002
  it("keeps one Link when the same url is shortened three times", async () => {
    await withServer(async (base) => {
      const payload = '{"url":"https://example.com/dup"}';
      const first = await send(base, "POST", "/links", payload);
      expect(first.status).toBe(201);
      const { code } = (await first.json()) as { code: string };
      expect((await send(base, "GET", `/${code}`)).status).toBe(302);
      for (let i = 0; i < 2; i++) {
        const again = await send(base, "POST", "/links", payload);
        expect(again.status).toBe(200);
        expect(((await again.json()) as { code: string }).code).toBe(code);
        const stats = await send(base, "GET", `/links/${code}`);
        expect(stats.status).toBe(200);
        expect(((await stats.json()) as { hits: number }).hits).toBe(1);
      }
    });
  });
});
