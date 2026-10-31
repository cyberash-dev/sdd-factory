import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createApp, readConfig } from "../../src/app/index.js";
import { createStore } from "../../src/store/index.js";
import type { Store } from "../../src/store/index.js";

interface Res {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
  text: string;
  contentType: string | null;
}

async function call(
  base: string,
  method: string,
  path: string,
  opts: { token?: string; authorization?: string; body?: unknown; raw?: string } = {},
): Promise<Res> {
  const headers: Record<string, string> = {};
  const auth = opts.authorization ?? (opts.token !== undefined ? `Bearer ${opts.token}` : undefined);
  if (auth !== undefined) headers["Authorization"] = auth;
  let body: string | undefined;
  if (opts.raw !== undefined) body = opts.raw;
  else if (opts.body !== undefined) body = JSON.stringify(opts.body);
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const r = await fetch(base + path, { method, headers, body });
  const text = await r.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: r.status, json, text, contentType: r.headers.get("content-type") };
}

function world() {
  const store: Store = createStore({ holdSeconds: 600 });
  const org = store.createAccount({ email: "org@example.com", password: "password1", name: "Org", role: "organizer" });
  const org2 = store.createAccount({ email: "org2@example.com", password: "password1", name: "Org2", role: "organizer" });
  const cus = store.createAccount({ email: "cus@example.com", password: "password1", name: "Cus", role: "customer" });
  const cus2 = store.createAccount({ email: "cus2@example.com", password: "password1", name: "Cus2", role: "customer" });
  const startsAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const event = store.createEvent({
    title: "Show",
    venue: "Hall",
    startsAt,
    organizerId: org.id,
    tiers: [
      { name: "GA", priceCents: 1000, quantity: 10 },
      { name: "VIP", priceCents: 5000, quantity: 3 },
    ],
  });
  return {
    store,
    event,
    gaId: event.tiers[0]!.id,
    vipId: event.tiers[1]!.id,
    orgToken: store.issueToken(org.id),
    org2Token: store.issueToken(org2.id),
    cusToken: store.issueToken(cus.id),
    cus2Token: store.issueToken(cus2.id),
    cusId: cus.id,
    cus2Id: cus2.id,
    startsAt,
  };
}
type World = ReturnType<typeof world>;

async function withApp(store: Store, fn: (base: string) => Promise<void>): Promise<void> {
  const server = createApp(store);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function expectFailure(r: Res, status: number, code: string): void {
  expect(r.status).toBe(status);
  expect(r.json).not.toBeNull();
  expect(typeof r.json.error).toBe("string");
  expect(String(r.json.error).startsWith(`${code}:`)).toBe(true);
}

const NEW_EVENT = (startsAt: string) => ({
  title: "T",
  venue: "V",
  startsAt,
  tiers: [{ name: "GA", priceCents: 100, quantity: 5 }],
});

async function freePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const s = createNetServer();
    s.once("error", reject);
    s.listen(0, () => {
      const p = (s.address() as AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

function build(): void {
  const b = spawnSync("npm", ["run", "build"], { cwd: process.cwd(), encoding: "utf8" });
  expect(b.status).toBe(0);
}

async function waitForOk(base: string, child: ChildProcess): Promise<Res> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}`);
    try {
      return await call(base, "GET", "/events");
    } catch {
      if (Date.now() > deadline) throw new Error("server never answered");
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGKILL");
  });
}

describe("request pipeline: token and role checks", () => {
  // @covers box-office:BEH-005
  it("answers 400 for a malformed body before the token check and 401 for a missing token before the input check", async () => {
    const w = world();
    await withApp(w.store, async (base) => {
      const malformed = await call(base, "POST", "/events", { raw: "{not json" });
      expectFailure(malformed, 400, "E_MALFORMED_JSON");

      const noHeader = await call(base, "POST", "/events", { body: NEW_EVENT(w.startsAt) });
      expectFailure(noHeader, 401, "E_UNAUTHENTICATED");

      const noHeaderBadFields = await call(base, "POST", "/events", { body: { tiers: [] } });
      expectFailure(noHeaderBadFields, 401, "E_UNAUTHENTICATED");

      const customer = await call(base, "POST", "/events", { token: w.cusToken, body: NEW_EVENT(w.startsAt) });
      expectFailure(customer, 403, "E_FORBIDDEN");
      expect(customer.json.id).toBeUndefined();

      const me = await call(base, "GET", "/me", { token: w.cusToken });
      expect(me.status).toBe(200);
      expect(me.json.id).toBe(w.cusId);
      expect(me.json.email).toBe("cus@example.com");
      expect(me.json.name).toBe("Cus");
      expect(me.json.role).toBe("customer");
    });
  });

  it.each([
    ["an unissued token", { token: "never-issued-value" }],
    ["a Token scheme instead of Bearer", { authorization: "Token abc123" }],
  ])("answers 401 E_UNAUTHENTICATED for %s", async (_label, auth) => {
    const w = world();
    await withApp(w.store, async (base) => {
      const r = await call(base, "POST", "/events", { ...auth, body: NEW_EVENT(w.startsAt) });
      expectFailure(r, 401, "E_UNAUTHENTICATED");
    });
  });

  it.each([
    ["GET", "/me", undefined],
    ["GET", "/me/orders", undefined],
    ["GET", "/me/waitlist", undefined],
    ["POST", "/events", {}],
    ["POST", "/events/x/cancel", {}],
    ["POST", "/events/x/discounts", {}],
    ["POST", "/events/x/waitlist", {}],
    ["GET", "/events/x/report", undefined],
    ["POST", "/orders", {}],
    ["POST", "/orders/x/pay", {}],
    ["POST", "/orders/x/cancel", {}],
    ["GET", "/orders/x", undefined],
  ])("answers 401 E_UNAUTHENTICATED to %s %s without a token", async (method, path, body) => {
    const w = world();
    await withApp(w.store, async (base) => {
      const r = await call(base, method, path, { body });
      expectFailure(r, 401, "E_UNAUTHENTICATED");
    });
  });

  it.each([
    ["customer", "POST", "/events"],
    ["organizer", "GET", "/me/orders"],
    ["organizer", "POST", "/orders"],
    ["organizer", "POST", "/events/x/waitlist"],
    ["customer", "POST", "/events/no-such-event/cancel"],
  ])("answers 403 E_FORBIDDEN for the %s on %s %s before any resource check", async (role, method, path) => {
    const w = world();
    await withApp(w.store, async (base) => {
      const token = role === "customer" ? w.cusToken : w.orgToken;
      const r = await call(base, method, path, { token, body: method === "POST" ? {} : undefined });
      expectFailure(r, 403, "E_FORBIDDEN");
    });
  });
});

describe("request pipeline: first failing check decides the status", () => {
  // @covers box-office:BEH-030
  it("answers the status of the first failing check in the stated order", async () => {
    const w = world();
    await withApp(w.store, async (base) => {
      expectFailure(await call(base, "GET", "/nope"), 404, "E_NOT_FOUND");
      expectFailure(await call(base, "GET", "/nope", { token: w.orgToken }), 404, "E_NOT_FOUND");
      expectFailure(await call(base, "PUT", "/events", { token: w.orgToken, body: NEW_EVENT(w.startsAt) }), 404, "E_NOT_FOUND");
      expectFailure(await call(base, "POST", "/events", { raw: "{oops" }), 400, "E_MALFORMED_JSON");
      expectFailure(await call(base, "POST", "/events", { body: { tiers: [] } }), 401, "E_UNAUTHENTICATED");
      expectFailure(await call(base, "POST", "/events", { token: w.cusToken, body: { tiers: [] } }), 403, "E_FORBIDDEN");
      expectFailure(await call(base, "POST", "/events", { token: w.orgToken, body: { tiers: [] } }), 400, "E_INVALID_INPUT");
      expectFailure(await call(base, "POST", "/events", { token: w.orgToken, body: [1, 2] }), 400, "E_INVALID_INPUT");
      expectFailure(await call(base, "POST", "/events/no-such-event/cancel", { token: w.org2Token }), 404, "E_NOT_FOUND");
      expectFailure(
        await call(base, "POST", "/orders", {
          token: w.cusToken,
          body: { eventId: "no-such-event", items: [{ tierId: w.gaId, quantity: 1 }] },
        }),
        404,
        "E_NOT_FOUND",
      );
      const page = await call(base, "GET", "/events");
      expect(page.status).toBe(200);
      expect(Array.isArray(page.json.items)).toBe(true);
    });
  });

  it("answers 403 E_FORBIDDEN, not 409, for another organizer cancelling an already cancelled event", async () => {
    const w = world();
    w.store.cancelEvent(w.event.id);
    await withApp(w.store, async (base) => {
      const r = await call(base, "POST", `/events/${w.event.id}/cancel`, { token: w.org2Token });
      expectFailure(r, 403, "E_FORBIDDEN");
    });
  });

  it("answers 409 E_EVENT_NOT_ON_SALE, not 422, for a cancelled event and seven tickets", async () => {
    const w = world();
    w.store.cancelEvent(w.event.id);
    await withApp(w.store, async (base) => {
      const r = await call(base, "POST", "/orders", {
        token: w.cusToken,
        body: { eventId: w.event.id, items: [{ tierId: w.gaId, quantity: 7 }] },
      });
      expectFailure(r, 409, "E_EVENT_NOT_ON_SALE");
    });
  });

  // @covers box-office:INV-011
  it("decides route and method, then body syntax, then token, role, input, resource, ownership, state and limit in that order", async () => {
    const w = world();
    await withApp(w.store, async (base) => {
      // route and method before everything
      expectFailure(await call(base, "GET", "/nope"), 404, "E_NOT_FOUND");
      expectFailure(await call(base, "PUT", "/events", { token: w.orgToken, body: NEW_EVENT(w.startsAt) }), 404, "E_NOT_FOUND");
      expectFailure(await call(base, "DELETE", "/events/x/waitlist", { raw: "{bad" }), 404, "E_NOT_FOUND");
      // body syntax before token
      expectFailure(await call(base, "POST", "/events", { raw: "{bad" }), 400, "E_MALFORMED_JSON");
      expectFailure(await call(base, "POST", "/orders", { raw: "{bad" }), 400, "E_MALFORMED_JSON");
      // token before input, role before input
      expectFailure(await call(base, "POST", "/events", { body: { tiers: [] } }), 401, "E_UNAUTHENTICATED");
      expectFailure(await call(base, "POST", "/events", { token: w.cusToken, body: { tiers: [] } }), 403, "E_FORBIDDEN");
      // input before resource
      expectFailure(await call(base, "POST", "/orders", { token: w.cusToken, body: { eventId: "no-such-event" } }), 400, "E_INVALID_INPUT");
      // resource before ownership
      expectFailure(await call(base, "POST", "/events/no-such-event/cancel", { token: w.org2Token }), 404, "E_NOT_FOUND");
      // ownership before state
      w.store.cancelEvent(w.event.id);
      expectFailure(await call(base, "POST", `/events/${w.event.id}/cancel`, { token: w.org2Token }), 403, "E_FORBIDDEN");
      // state before limit
      expectFailure(
        await call(base, "POST", "/orders", { token: w.cusToken, body: { eventId: w.event.id, items: [{ tierId: w.gaId, quantity: 7 }] } }),
        409,
        "E_EVENT_NOT_ON_SALE",
      );
    });
  });
});

describe("failure bodies and process continuity", () => {
  // @covers box-office:BEH-031
  it("answers every failure with a JSON error body and keeps serving the next request", async () => {
    const w = world();
    await withApp(w.store, async (base) => {
      const unknown = await call(base, "GET", "/nope");
      expectFailure(unknown, 404, "E_NOT_FOUND");
      expect(Object.keys(unknown.json)).toEqual(["error"]);
      expect(unknown.contentType).toBe("application/json; charset=utf-8");

      expectFailure(await call(base, "GET", "/nope", { token: w.orgToken }), 404, "E_NOT_FOUND");
      expectFailure(await call(base, "DELETE", "/users", { token: w.cusToken }), 404, "E_NOT_FOUND");

      const bad = await call(base, "POST", "/users", { raw: "{bad json" });
      expectFailure(bad, 400, "E_MALFORMED_JSON");
      expect(Object.keys(bad.json)).toEqual(["error"]);
      expectFailure(await call(base, "POST", "/events", { raw: "{bad json" }), 400, "E_MALFORMED_JSON");

      const ok = await call(base, "GET", "/events");
      expect(ok.status).toBe(200);
      expect(Array.isArray(ok.json.items)).toBe(true);
    });
  });

  it("answers 422 E_TICKET_LIMIT with an error body for an order that passes 6 tickets", async () => {
    const w = world();
    await withApp(w.store, async (base) => {
      const r = await call(base, "POST", "/orders", {
        token: w.cusToken,
        body: { eventId: w.event.id, items: [{ tierId: w.gaId, quantity: 7 }] },
      });
      expectFailure(r, 422, "E_TICKET_LIMIT");
      expect(Object.keys(r.json)).toEqual(["error"]);
    });
  });

  it.each([
    ["an empty body", ""],
    ["a JSON array", "[1]"],
    ["a JSON string", '"text"'],
    ["a JSON null", "null"],
  ])("answers a body-reading route with %s by 400 and an error body", async (label, raw) => {
    const w = world();
    await withApp(w.store, async (base) => {
      const r = await call(base, "POST", "/users", { raw });
      expectFailure(r, 400, label === "an empty body" ? "E_MALFORMED_JSON" : "E_INVALID_INPUT");
    });
  });
});

describe("waitlist endpoint POST /events/:id/waitlist", () => {
  async function exhaust(w: World, tierId: string, qty: number): Promise<void> {
    w.store.holdOrder({ eventId: w.event.id, customerId: w.cus2Id, items: [{ tierId, quantity: qty }], discountCode: null });
  }

  // @covers box-office:CTR-014
  it("answers 201 with a position on a shortfall and 409 for a duplicate entry or when tickets suffice", async () => {
    const w = world();
    await exhaust(w, w.vipId, 3);
    await withApp(w.store, async (base) => {
      const path = `/events/${w.event.id}/waitlist`;
      const joined = await call(base, "POST", path, { token: w.cusToken, body: { tierId: w.vipId, quantity: 2 } });
      expect(joined.status).toBe(201);
      expect(Object.keys(joined.json).sort()).toEqual(["eventId", "id", "position", "quantity", "tierId"]);
      expect(joined.json.eventId).toBe(w.event.id);
      expect(joined.json.tierId).toBe(w.vipId);
      expect(joined.json.quantity).toBe(2);
      expect(joined.json.position).toBe(1);

      const second = await call(base, "POST", path, { token: w.cusToken, body: { tierId: w.vipId, quantity: 1 } });
      expectFailure(second, 409, "E_ALREADY_WAITING");

      const suffice = await call(base, "POST", path, { token: w.cusToken, body: { tierId: w.gaId, quantity: 2 } });
      expectFailure(suffice, 409, "E_TICKETS_AVAILABLE");

      const ev = await call(base, "GET", `/events/${w.event.id}`);
      expect(ev.json.tiers.find((t: { id: string }) => t.id === w.vipId).available).toBe(0);
      expect(ev.json.tiers.find((t: { id: string }) => t.id === w.gaId).available).toBe(10);
    });
  });

  it("answers 201 with quantity 6 on a tier with available 0", async () => {
    const w = world();
    await exhaust(w, w.gaId, 10);
    await withApp(w.store, async (base) => {
      const r = await call(base, "POST", `/events/${w.event.id}/waitlist`, { token: w.cusToken, body: { tierId: w.gaId, quantity: 6 } });
      expect(r.status).toBe(201);
      expect(r.json.quantity).toBe(6);
    });
  });

  it.each([
    ["quantity 7", { quantity: 7 }],
    ["quantity 0", { quantity: 0 }],
    ["a missing tierId", { quantity: 1, omitTier: true }],
  ])("answers 400 E_INVALID_INPUT for %s", async (_label, spec) => {
    const w = world();
    await exhaust(w, w.gaId, 10);
    await withApp(w.store, async (base) => {
      const body = "omitTier" in spec ? { quantity: spec.quantity } : { tierId: w.gaId, quantity: spec.quantity };
      const r = await call(base, "POST", `/events/${w.event.id}/waitlist`, { token: w.cusToken, body });
      expectFailure(r, 400, "E_INVALID_INPUT");
    });
  });

  it("answers 404 E_NOT_FOUND for an unknown event", async () => {
    const w = world();
    await withApp(w.store, async (base) => {
      const r = await call(base, "POST", "/events/no-such-event/waitlist", { token: w.cusToken, body: { tierId: w.gaId, quantity: 1 } });
      expectFailure(r, 404, "E_NOT_FOUND");
    });
  });

  it("answers 400 E_INVALID_TIER for a tier of another event", async () => {
    const w = world();
    const other = w.store.createEvent({
      title: "Other",
      venue: "Hall",
      startsAt: w.startsAt,
      organizerId: w.event.organizerId,
      tiers: [{ name: "GA", priceCents: 100, quantity: 5 }],
    });
    await withApp(w.store, async (base) => {
      const r = await call(base, "POST", `/events/${w.event.id}/waitlist`, {
        token: w.cusToken,
        body: { tierId: other.tiers[0]!.id, quantity: 1 },
      });
      expectFailure(r, 400, "E_INVALID_TIER");
    });
  });

  it("answers 403 E_FORBIDDEN for an organizer", async () => {
    const w = world();
    await exhaust(w, w.gaId, 10);
    await withApp(w.store, async (base) => {
      const r = await call(base, "POST", `/events/${w.event.id}/waitlist`, { token: w.orgToken, body: { tierId: w.gaId, quantity: 1 } });
      expectFailure(r, 403, "E_FORBIDDEN");
    });
  });
});

describe("configuration and process start", () => {
  it.each([
    [{ PORT: "8123" }, 8123],
    [{ PORT: "0" }, 0],
    [{}, 3000],
    [{ PORT: "abc" }, 3000],
    [{ PORT: "-1" }, 3000],
    [{ PORT: "65536" }, 3000],
  ])("reads PORT from %j as %i", (env, port) => {
    expect(readConfig(env).port).toBe(port);
  });

  it.each([
    [{ HOLD_SECONDS: "0" }, 0],
    [{ HOLD_SECONDS: "12" }, 12],
    [{}, 600],
    [{ HOLD_SECONDS: "abc" }, 600],
    [{ HOLD_SECONDS: "-5" }, 600],
    [{ HOLD_SECONDS: "1.5" }, 600],
  ])("reads HOLD_SECONDS from %j as %i", (env, seconds) => {
    expect(readConfig(env).holdSeconds).toBe(seconds);
  });

  // @covers box-office:CST-003
  it("npm run build then npm start serves on the port named by PORT", { timeout: 120000 }, async () => {
    build();
    const port = await freePort();
    const child = spawn("npm", ["start"], { cwd: process.cwd(), env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
    try {
      const r = await waitForOk(`http://127.0.0.1:${port}`, child);
      expect(r.status).toBe(200);
    } finally {
      await stop(child);
    }
  });

  it("with PORT 0 npm start binds an ephemeral port reported on its one readiness line", { timeout: 120000 }, async () => {
    build();
    const child = spawn("npm", ["start"], { cwd: process.cwd(), env: { ...process.env, PORT: "0" }, stdio: ["ignore", "pipe", "ignore"] });
    try {
      let out = "";
      child.stdout!.on("data", (d: Buffer) => {
        out += d.toString();
      });
      const deadline = Date.now() + 60_000;
      while (!/box-office listening on \d+\n/.test(out)) {
        if (Date.now() > deadline || child.exitCode !== null) throw new Error(`no readiness line: ${out}`);
        await new Promise((r) => setTimeout(r, 100));
      }
      const m = /box-office listening on (\d+)\n/.exec(out)!;
      expect(Number(m[1])).toBeGreaterThan(0);
      const r = await call(`http://127.0.0.1:${m[1]}`, "GET", "/events");
      expect(r.status).toBe(200);
    } finally {
      await stop(child);
    }
  });

  // @covers box-office:CST-005
  it("serves the API after build and start with an empty runtime dependency set", { timeout: 120000 }, async () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
    build();
    const port = await freePort();
    const child = spawn("npm", ["start"], { cwd: process.cwd(), env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
    try {
      const r = await waitForOk(`http://127.0.0.1:${port}`, child);
      expect(r.status).toBe(200);
      expect(Array.isArray(r.json.items)).toBe(true);
    } finally {
      await stop(child);
    }
  });
});

describe("outbound networking", () => {
  // @covers box-office:CST-002
  it("completes registration and checkout against the loopback-only server", async () => {
    const w = world();
    await withApp(w.store, async (base) => {
      const reg = await call(base, "POST", "/users", {
        body: { email: "new@example.com", password: "password1", name: "New", role: "customer" },
      });
      expect(reg.status).toBe(201);
      expect(reg.json.email).toBe("new@example.com");
      expect(reg.json.password).toBeUndefined();

      const order = await call(base, "POST", "/orders", {
        token: w.cusToken,
        body: { eventId: w.event.id, items: [{ tierId: w.gaId, quantity: 2 }] },
      });
      expect(order.status).toBe(201);
      expect(order.json.eventId).toBe(w.event.id);
      expect(order.json.status).toBe("held");
    });
  });
});
