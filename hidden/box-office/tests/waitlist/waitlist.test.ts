import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app/index.js";
import { createStore } from "../../src/store/index.js";

const FUTURE = "2099-01-01T00:00:00.000Z";

interface Res {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}
type Call = (method: string, path: string, o?: { token?: string; json?: unknown; raw?: string }) => Promise<Res>;

interface World {
  call: Call;
  account: (role: "organizer" | "customer") => Promise<string>;
  event: (token: string, quantities: number[]) => Promise<{ id: string; tierIds: string[] }>;
  drain: (customer: string, ev: { id: string; tierIds: string[] }, tier: number, quantity: number) => Promise<void>;
  available: (eventId: string) => Promise<number[]>;
}

async function withApp(fn: (w: World) => Promise<void>): Promise<void> {
  const server = createApp(createStore({ holdSeconds: 600 }));
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let n = 0;
  const call: Call = async (method, path, o = {}) => {
    const headers: Record<string, string> = {};
    if (o.token !== undefined) headers["Authorization"] = `Bearer ${o.token}`;
    const body = o.raw !== undefined ? o.raw : o.json !== undefined ? JSON.stringify(o.json) : undefined;
    const r = await fetch(base + path, { method, headers, body });
    const text = await r.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    return { status: r.status, body: parsed };
  };
  const account = async (role: "organizer" | "customer"): Promise<string> => {
    n += 1;
    const email = `user${n}@example.com`;
    expect((await call("POST", "/users", { json: { email, password: "password1", name: "Ada", role } })).status).toBe(201);
    const s = await call("POST", "/sessions", { json: { email, password: "password1" } });
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
  const drain: World["drain"] = async (customer, ev, tier, quantity) => {
    const r = await call("POST", "/orders", {
      token: customer,
      json: { eventId: ev.id, items: [{ tierId: ev.tierIds[tier], quantity }] },
    });
    expect(r.status).toBe(201);
  };
  const available = async (eventId: string) => {
    const r = await call("GET", `/events/${eventId}`);
    return (r.body.tiers as { available: number }[]).map((t) => t.available);
  };
  try {
    await fn({ call, account, event, drain, available });
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

async function soldOut(w: World, quantity = 1) {
  const org = await w.account("organizer");
  const holder = await w.account("customer");
  const ev = await w.event(org, [quantity]);
  await w.drain(holder, ev, 0, quantity);
  return { org, ev };
}

describe("waitlist join", () => {
  // @covers box-office:CTR-014
  it("answers 201 with id, eventId, tierId, quantity and position for a shortfall and leaves available unchanged", async () => {
    await withApp(async (w) => {
      const { ev } = await soldOut(w, 2);
      const cust = await w.account("customer");
      const r = await w.call("POST", `/events/${ev.id}/waitlist`, { token: cust, json: { tierId: ev.tierIds[0], quantity: 2 } });
      expect(r.status).toBe(201);
      expect(Object.keys(r.body).sort()).toEqual(["eventId", "id", "position", "quantity", "tierId"]);
      expect(typeof r.body.id).toBe("string");
      expect(r.body.eventId).toBe(ev.id);
      expect(r.body.tierId).toBe(ev.tierIds[0]);
      expect(r.body.quantity).toBe(2);
      expect(r.body.position).toBe(1);
      expect(await w.available(ev.id)).toEqual([0]);
    });
  });

  // @covers box-office:BEH-026
  it("queues a second customer at position 2 and refuses a second entry of the same customer for the tier", async () => {
    await withApp(async (w) => {
      const { ev } = await soldOut(w, 1);
      const first = await w.account("customer");
      const second = await w.account("customer");
      const path = `/events/${ev.id}/waitlist`;
      const a = await w.call("POST", path, { token: first, json: { tierId: ev.tierIds[0], quantity: 2 } });
      expect(a.status).toBe(201);
      expect(a.body.position).toBe(1);
      const b = await w.call("POST", path, { token: second, json: { tierId: ev.tierIds[0], quantity: 1 } });
      expect(b.status).toBe(201);
      expect(b.body.position).toBe(2);
      const dup = await w.call("POST", path, { token: first, json: { tierId: ev.tierIds[0], quantity: 1 } });
      expectFailure(dup, 409, "E_ALREADY_WAITING");
      expect(dup.body.position).toBeUndefined();
      expect(await w.available(ev.id)).toEqual([0]);
    });
  });

  it.each([1, 6])("accepts quantity %d on a tier with available 0", async (quantity) => {
    await withApp(async (w) => {
      const { ev } = await soldOut(w, 1);
      const cust = await w.account("customer");
      const r = await w.call("POST", `/events/${ev.id}/waitlist`, { token: cust, json: { tierId: ev.tierIds[0], quantity } });
      expect(r.status).toBe(201);
      expect(r.body.quantity).toBe(quantity);
      expect(r.body.position).toBe(1);
    });
  });

  it("joins with quantity 2 when available is one below it, and answers 409 E_TICKETS_AVAILABLE when available equals it", async () => {
    await withApp(async (w) => {
      const org = await w.account("organizer");
      const holder = await w.account("customer");
      const cust = await w.account("customer");
      const ev = await w.event(org, [2, 2]);
      await w.drain(holder, ev, 0, 1);
      const below = await w.call("POST", `/events/${ev.id}/waitlist`, { token: cust, json: { tierId: ev.tierIds[0], quantity: 2 } });
      expect(below.status).toBe(201);
      expect(below.body.position).toBe(1);
      const equal = await w.call("POST", `/events/${ev.id}/waitlist`, { token: cust, json: { tierId: ev.tierIds[1], quantity: 2 } });
      expectFailure(equal, 409, "E_TICKETS_AVAILABLE");
      expect(equal.body.position).toBeUndefined();
      expect(await w.available(ev.id)).toEqual([1, 2]);
    });
  });

  it.each([
    ["quantity 7", { quantity: 7 }],
    ["quantity 0", { quantity: 0 }],
    ["a fractional quantity", { quantity: 1.5 }],
    ["a string quantity", { quantity: "2" }],
    ["a missing quantity", {}],
    ["a missing tierId", { quantity: 1, omitTier: true }],
  ])("answers 400 E_INVALID_INPUT for %s", async (_n, extra) => {
    await withApp(async (w) => {
      const { ev } = await soldOut(w, 1);
      const cust = await w.account("customer");
      const { omitTier, ...rest } = extra as { omitTier?: boolean; quantity?: unknown };
      const json = omitTier ? rest : { tierId: ev.tierIds[0], ...rest };
      const r = await w.call("POST", `/events/${ev.id}/waitlist`, { token: cust, json });
      expectFailure(r, 400, "E_INVALID_INPUT");
      expect(await w.available(ev.id)).toEqual([0]);
    });
  });

  it("answers 400 E_INVALID_INPUT for a body that is a JSON array", async () => {
    await withApp(async (w) => {
      const { ev } = await soldOut(w, 1);
      const cust = await w.account("customer");
      expectFailure(await w.call("POST", `/events/${ev.id}/waitlist`, { token: cust, json: [] }), 400, "E_INVALID_INPUT");
    });
  });

  it("answers 400 E_MALFORMED_JSON for a body that is not valid JSON", async () => {
    await withApp(async (w) => {
      const { ev } = await soldOut(w, 1);
      const cust = await w.account("customer");
      expectFailure(await w.call("POST", `/events/${ev.id}/waitlist`, { token: cust, raw: "{oops" }), 400, "E_MALFORMED_JSON");
    });
  });

  it("answers 401 E_UNAUTHENTICATED without a token and 403 E_FORBIDDEN for an organizer", async () => {
    await withApp(async (w) => {
      const { org, ev } = await soldOut(w, 1);
      const json = { tierId: ev.tierIds[0], quantity: 1 };
      expectFailure(await w.call("POST", `/events/${ev.id}/waitlist`, { json }), 401, "E_UNAUTHENTICATED");
      expectFailure(await w.call("POST", `/events/${ev.id}/waitlist`, { token: org, json }), 403, "E_FORBIDDEN");
    });
  });

  it("answers 404 E_NOT_FOUND for an unknown event and 400 E_INVALID_INPUT before it for quantity 7", async () => {
    await withApp(async (w) => {
      const { ev } = await soldOut(w, 1);
      const cust = await w.account("customer");
      const unknown = await w.call("POST", "/events/no-such-event/waitlist", { token: cust, json: { tierId: ev.tierIds[0], quantity: 1 } });
      expectFailure(unknown, 404, "E_NOT_FOUND");
      const both = await w.call("POST", "/events/no-such-event/waitlist", { token: cust, json: { tierId: ev.tierIds[0], quantity: 7 } });
      expectFailure(both, 400, "E_INVALID_INPUT");
    });
  });

  it("answers 400 E_INVALID_TIER for a tierId of another event", async () => {
    await withApp(async (w) => {
      const org = await w.account("organizer");
      const holder = await w.account("customer");
      const cust = await w.account("customer");
      const a = await w.event(org, [1]);
      const b = await w.event(org, [1]);
      await w.drain(holder, a, 0, 1);
      const r = await w.call("POST", `/events/${a.id}/waitlist`, { token: cust, json: { tierId: b.tierIds[0], quantity: 1 } });
      expectFailure(r, 400, "E_INVALID_TIER");
      expect(r.body.position).toBeUndefined();
    });
  });

  it("answers 409 E_TICKETS_AVAILABLE for quantity 2 on a tier with available 2", async () => {
    await withApp(async (w) => {
      const org = await w.account("organizer");
      const cust = await w.account("customer");
      const ev = await w.event(org, [2]);
      const r = await w.call("POST", `/events/${ev.id}/waitlist`, { token: cust, json: { tierId: ev.tierIds[0], quantity: 2 } });
      expectFailure(r, 409, "E_TICKETS_AVAILABLE");
      expect(await w.available(ev.id)).toEqual([2]);
    });
  });
});
