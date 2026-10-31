import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createApp, readConfig } from "../../src/app/index.js";
import { createStore } from "../../src/store/index.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FUTURE = "2099-01-01T00:00:00.000Z";

interface Res {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  text: string;
}
interface CallOpts {
  token?: string;
  auth?: string;
  json?: unknown;
  raw?: string;
}
type Call = (method: string, path: string, o?: CallOpts) => Promise<Res>;

async function request(base: string, method: string, path: string, o: CallOpts = {}): Promise<Res> {
  const headers: Record<string, string> = {};
  if (o.token !== undefined) headers["Authorization"] = `Bearer ${o.token}`;
  if (o.auth !== undefined) headers["Authorization"] = o.auth;
  let body: string | undefined;
  if (o.raw !== undefined) body = o.raw;
  else if (o.json !== undefined) body = JSON.stringify(o.json);
  const r = await fetch(base + path, { method, headers, body });
  const text = await r.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  return { status: r.status, body: parsed, text };
}

interface World {
  call: Call;
  account: (role: "organizer" | "customer") => Promise<string>;
  event: (token: string, quantities: number[]) => Promise<{ id: string; tierIds: string[] }>;
}

async function withApp(fn: (w: World) => Promise<void>): Promise<void> {
  const server = createApp(createStore({ holdSeconds: 600 }));
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let n = 0;
  const call: Call = (m, p, o) => request(base, m, p, o);
  const account = async (role: "organizer" | "customer"): Promise<string> => {
    n += 1;
    const email = `user${n}@example.com`;
    const made = await call("POST", "/users", { json: { email, password: "password1", name: "Ada", role } });
    expect(made.status).toBe(201);
    const s = await call("POST", "/sessions", { json: { email, password: "password1" } });
    expect(s.status).toBe(200);
    return s.body.token as string;
  };
  const event = async (token: string, quantities: number[]) => {
    const r = await call("POST", "/events", {
      token,
      json: {
        title: "Show",
        venue: "Hall",
        startsAt: FUTURE,
        tiers: quantities.map((q, i) => ({ name: `Tier${i}`, priceCents: 1000, quantity: q })),
      },
    });
    expect(r.status).toBe(201);
    return { id: r.body.id as string, tierIds: (r.body.tiers as { id: string }[]).map((t) => t.id) };
  };
  try {
    await fn({ call, account, event });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
}

function expectFailure(r: Res, status: number, code: string): void {
  expect(r.status).toBe(status);
  expect(typeof r.body?.error).toBe("string");
  expect((r.body.error as string).startsWith(`${code}:`)).toBe(true);
}

function runCmd(args: string[]): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    const c = spawn("npm", args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    c.stdout.on("data", (d: Buffer) => (out += d.toString()));
    c.stderr.on("data", (d: Buffer) => (out += d.toString()));
    c.on("error", reject);
    c.on("close", (code) => resolve({ code, out }));
  });
}

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, r));
  const p = (s.address() as AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return p;
}

async function buildAndStart(port: string, fn: (base: string) => Promise<void>): Promise<void> {
  const built = await runCmd(["run", "build"]);
  if (built.code !== 0) throw new Error(`npm run build failed: ${built.out}`);
  const child = spawn("npm", ["start"], {
    cwd: ROOT,
    env: { ...process.env, PORT: port },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let exited = false;
  child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
  child.stderr?.on("data", (d: Buffer) => (out += d.toString()));
  child.on("exit", () => (exited = true));
  try {
    const deadline = Date.now() + 60_000;
    let base = "";
    while (Date.now() < deadline) {
      if (exited) throw new Error(`server exited before answering: ${out}`);
      const bound = port === "0" ? /box-office listening on (\d+)/.exec(out)?.[1] : port;
      if (bound !== undefined) {
        try {
          const r = await fetch(`http://127.0.0.1:${bound}/events`);
          if (r.status === 200) {
            base = `http://127.0.0.1:${bound}`;
            break;
          }
        } catch {
          // not listening yet
        }
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    if (base === "") throw new Error(`server never answered: ${out}`);
    await fn(base);
  } finally {
    try {
      process.kill(-(child.pid as number), "SIGKILL");
    } catch {
      // already gone
    }
  }
}

const PROTECTED: { method: string; path: string; json?: unknown }[] = [
  { method: "GET", path: "/me" },
  { method: "GET", path: "/me/orders" },
  { method: "GET", path: "/me/waitlist" },
  { method: "POST", path: "/events", json: {} },
  { method: "POST", path: "/events/evt_1/cancel" },
  { method: "POST", path: "/events/evt_1/discounts", json: {} },
  { method: "POST", path: "/events/evt_1/waitlist", json: {} },
  { method: "GET", path: "/events/evt_1/report" },
  { method: "POST", path: "/orders", json: {} },
  { method: "POST", path: "/orders/ord_1/pay" },
  { method: "POST", path: "/orders/ord_1/cancel" },
  { method: "GET", path: "/orders/ord_1" },
];

describe("protected endpoints", () => {
  // @covers box-office:BEH-005
  it("answers 401 for a missing token before the input check, 403 for a wrong role, 400 for a malformed body without a token, 200 for the accepted role", async () => {
    await withApp(async ({ call, account }) => {
      const customer = await account("customer");
      const me = await call("GET", "/me", { token: customer });
      expect(me.status).toBe(200);
      expect(Object.keys(me.body).sort()).toEqual(["email", "id", "name", "role"]);
      expect(me.body.role).toBe("customer");

      const noHeader = await call("POST", "/events", { json: { venue: "" } });
      expectFailure(noHeader, 401, "E_UNAUTHENTICATED");

      const wrongRole = await call("POST", "/events", { token: customer, json: { tiers: [] } });
      expectFailure(wrongRole, 403, "E_FORBIDDEN");

      const malformed = await call("POST", "/events", { raw: "{not json" });
      expectFailure(malformed, 400, "E_MALFORMED_JSON");
    });
  });

  it.each([
    ["no header", {}],
    ["a token the server never issued", { token: "never-issued-value" }],
    ["a scheme other than Bearer", { auth: "Token abc123" }],
  ])("answers 401 E_UNAUTHENTICATED for %s on POST /events", async (_n, auth) => {
    await withApp(async ({ call }) => {
      const r = await call("POST", "/events", { ...auth, json: { title: "x" } });
      expectFailure(r, 401, "E_UNAUTHENTICATED");
      expect(Object.keys(r.body)).toEqual(["error"]);
    });
  });

  it("answers 401 E_UNAUTHENTICATED without a token on every protected endpoint", async () => {
    await withApp(async ({ call }) => {
      for (const p of PROTECTED) {
        const r = await call(p.method, p.path, p.json === undefined ? {} : { json: p.json });
        expectFailure(r, 401, "E_UNAUTHENTICATED");
      }
    });
  });

  it("answers 403 E_FORBIDDEN for an organizer on customer routes and a customer on organizer routes", async () => {
    await withApp(async ({ call, account }) => {
      const org = await account("organizer");
      const cust = await account("customer");
      expectFailure(await call("GET", "/me/orders", { token: org }), 403, "E_FORBIDDEN");
      expectFailure(await call("POST", "/orders", { token: org, json: {} }), 403, "E_FORBIDDEN");
      expectFailure(await call("GET", "/events/evt_1/report", { token: cust }), 403, "E_FORBIDDEN");
      expectFailure(await call("POST", "/events/evt_1/cancel", { token: cust }), 403, "E_FORBIDDEN");
    });
  });
});

describe("check order and failure bodies", () => {
  // @covers box-office:BEH-030
  it("lets the first failing check decide the status", async () => {
    await withApp(async ({ call, account, event }) => {
      const org = await account("organizer");
      const other = await account("organizer");
      const cust = await account("customer");

      expectFailure(await call("GET", "/nope"), 404, "E_NOT_FOUND");
      expectFailure(await call("GET", "/nope", { token: org }), 404, "E_NOT_FOUND");
      expectFailure(await call("PUT", "/events", { token: org, json: { title: "x" } }), 404, "E_NOT_FOUND");
      expectFailure(await call("POST", "/events", { raw: "{oops" }), 400, "E_MALFORMED_JSON");
      expectFailure(await call("POST", "/events", { json: { tiers: [] } }), 401, "E_UNAUTHENTICATED");
      expectFailure(await call("POST", "/events", { token: cust, json: { tiers: [] } }), 403, "E_FORBIDDEN");
      expectFailure(await call("POST", "/events", { token: org, json: { tiers: [] } }), 400, "E_INVALID_INPUT");
      expectFailure(await call("POST", "/events", { token: org, json: [1] }), 400, "E_INVALID_INPUT");
      expectFailure(await call("POST", "/events/no-such-event/cancel", { token: other }), 404, "E_NOT_FOUND");

      const ev = await event(org, [5]);
      expectFailure(
        await call("POST", "/orders", {
          token: cust,
          json: { eventId: "no-such-event", items: [{ tierId: ev.tierIds[0], quantity: 1 }] },
        }),
        404,
        "E_NOT_FOUND",
      );

      expect((await call("POST", `/events/${ev.id}/cancel`, { token: org })).status).toBe(200);
      expectFailure(await call("POST", `/events/${ev.id}/cancel`, { token: other }), 403, "E_FORBIDDEN");

      const ok = await call("GET", "/events");
      expect(ok.status).toBe(200);
      expect(Array.isArray(ok.body.items)).toBe(true);
    });
  });

  // @covers box-office:INV-011
  it("decides route, method and body syntax before the token, and the token before every later check", async () => {
    await withApp(async ({ call, account, event }) => {
      const org = await account("organizer");
      const other = await account("organizer");
      const cust = await account("customer");

      expectFailure(await call("GET", "/nope"), 404, "E_NOT_FOUND");
      expectFailure(await call("DELETE", "/users", { token: cust }), 404, "E_NOT_FOUND");
      expectFailure(await call("POST", "/nope", { raw: "{oops" }), 404, "E_NOT_FOUND");
      expectFailure(await call("POST", "/events", { raw: "{oops" }), 400, "E_MALFORMED_JSON");
      expectFailure(await call("POST", "/events", { raw: "" }), 400, "E_MALFORMED_JSON");
      expectFailure(await call("POST", "/events", { json: { tiers: [] } }), 401, "E_UNAUTHENTICATED");
      expectFailure(await call("POST", "/events", { token: cust, json: { tiers: [] } }), 403, "E_FORBIDDEN");
      expectFailure(await call("POST", "/events/no-such-event/cancel", { token: org }), 404, "E_NOT_FOUND");

      const ev = await event(org, [10]);
      expect((await call("POST", `/events/${ev.id}/cancel`, { token: org })).status).toBe(200);
      expectFailure(await call("POST", `/events/${ev.id}/cancel`, { token: other }), 403, "E_FORBIDDEN");
      expectFailure(await call("POST", `/events/${ev.id}/cancel`, { token: org }), 409, "E_EVENT_CANCELLED");
      expectFailure(
        await call("POST", "/orders", {
          token: cust,
          json: { eventId: ev.id, items: [{ tierId: ev.tierIds[0], quantity: 7 }] },
        }),
        409,
        "E_EVENT_NOT_ON_SALE",
      );
    });
  });

  // @covers box-office:BEH-031
  it("answers every failure with a JSON error body and keeps serving the next request", async () => {
    await withApp(async ({ call, account, event }) => {
      const org = await account("organizer");
      const cust = await account("customer");
      const ev = await event(org, [10]);

      const nope = await call("GET", "/nope");
      expectFailure(nope, 404, "E_NOT_FOUND");
      expect(Object.keys(nope.body)).toEqual(["error"]);
      const bad = await call("POST", "/users", { raw: "{oops" });
      expectFailure(bad, 400, "E_MALFORMED_JSON");
      expect(Object.keys(bad.body)).toEqual(["error"]);
      const page = await call("GET", "/events");
      expect(page.status).toBe(200);
      expect(page.body.total).toBe(1);

      expectFailure(await call("GET", "/nope", { token: org }), 404, "E_NOT_FOUND");
      expectFailure(await call("DELETE", "/users", { token: cust }), 404, "E_NOT_FOUND");

      const limit = await call("POST", "/orders", {
        token: cust,
        json: { eventId: ev.id, items: [{ tierId: ev.tierIds[0], quantity: 7 }] },
      });
      expectFailure(limit, 422, "E_TICKET_LIMIT");
      expect(Object.keys(limit.body)).toEqual(["error"]);
      expect((await call("GET", "/events")).status).toBe(200);
    });
  });

  it("answers 400 E_INVALID_INPUT for a JSON array body on POST /events with an organizer token", async () => {
    await withApp(async ({ call, account }) => {
      const org = await account("organizer");
      expectFailure(await call("POST", "/events", { token: org, json: [] }), 400, "E_INVALID_INPUT");
    });
  });

  it("answers 200 with a page body for GET /events with no token", async () => {
    await withApp(async ({ call }) => {
      const r = await call("GET", "/events");
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
    });
  });
});

describe("process configuration", () => {
  it.each([
    [{ PORT: "8123" }, 8123],
    [{ PORT: "0" }, 0],
    [{ PORT: "65535" }, 65535],
    [{}, 3000],
    [{ PORT: "abc" }, 3000],
    [{ PORT: "-1" }, 3000],
    [{ PORT: "65536" }, 3000],
  ])("reads the port from PORT %j as %d", (env, port) => {
    expect(readConfig(env).port).toBe(port);
  });

  it.each([
    [{}, 600],
    [{ HOLD_SECONDS: "0" }, 0],
    [{ HOLD_SECONDS: "30" }, 30],
    [{ HOLD_SECONDS: "-5" }, 600],
    [{ HOLD_SECONDS: "1.5" }, 600],
    [{ HOLD_SECONDS: "x" }, 600],
  ])("reads the hold lifetime from %j as %d seconds", (env, secs) => {
    expect(readConfig(env).holdSeconds).toBe(secs);
  });
});

describe("started process", () => {
  // @covers box-office:CST-003
  it("answers on the free port named by PORT after npm run build and npm start", { timeout: 120000 }, async () => {
    const port = await freePort();
    await buildAndStart(String(port), async (base) => {
      const r = await request(base, "GET", "/events");
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
    });
  });

  it("answers on the ephemeral port reported on the readiness line when PORT is 0", { timeout: 120000 }, async () => {
    await buildAndStart("0", async (base) => {
      expect((await request(base, "GET", "/events")).status).toBe(200);
    });
  });

  // @covers box-office:CST-005
  it("serves the API after build and start with an empty runtime dependency set", { timeout: 120000 }, async () => {
    const pkg = JSON.parse(readFileSync(`${ROOT}package.json`, "utf8")) as { dependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
    const port = await freePort();
    await buildAndStart(String(port), async (base) => {
      const made = await request(base, "POST", "/users", {
        json: { email: "a@b.co", password: "12345678", name: "Ada", role: "customer" },
      });
      expect(made.status).toBe(201);
    });
  });
});

describe("outbound networking", () => {
  // @covers box-office:CST-002
  it("completes registration and checkout with every request served on loopback alone", async () => {
    const saved = { ...process.env };
    process.env["HTTP_PROXY"] = "http://127.0.0.1:1";
    process.env["HTTPS_PROXY"] = "http://127.0.0.1:1";
    try {
      await withApp(async ({ call, account, event }) => {
        const org = await account("organizer");
        const cust = await account("customer");
        const ev = await event(org, [3]);
        const order = await call("POST", "/orders", {
          token: cust,
          json: { eventId: ev.id, items: [{ tierId: ev.tierIds[0], quantity: 1 }] },
        });
        expect(order.status).toBe(201);
        expect(order.body.status).toBe("held");
      });
    } finally {
      process.env = saved;
    }
  });
});
