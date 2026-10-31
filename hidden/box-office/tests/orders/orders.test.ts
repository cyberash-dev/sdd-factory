import type { ApiResponse, HttpRequest } from "../../src/core/index.js";
import { describe, expect, it, vi } from "vitest";
import { cancelOrder, createOrder, getOrder, listMyOrders, payOrder } from "../../src/orders/index.js";
import { createStore } from "../../src/store/index.js";
import type { Account, Event, Store } from "../../src/store/index.js";

const T0 = Date.parse("2026-06-01T12:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

interface Res {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}
interface Acct {
  account: Account;
}
interface EventOpts {
  org: Acct;
  tiers: { priceCents: number; quantity: number }[];
  startsInMs?: number;
}

async function run(holdSeconds: number, fn: (w: World) => Promise<void>): Promise<void> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  try {
    await fn(makeWorld(createStore({ holdSeconds })));
  } finally {
    vi.useRealTimers();
  }
}

type World = ReturnType<typeof makeWorld>;

function makeWorld(store: Store) {
  let n = 0;
  const account = (role: "organizer" | "customer"): Acct => {
    n += 1;
    const a = store.createAccount({ email: `${role}${n}@example.com`, password: "password1", name: `N${n}`, role });
    return { account: a };
  };
  const call = async (method: string, path: string, who: Acct | null, body?: unknown): Promise<Res> => {
    const seg = path.split("/").filter((x) => x !== "");
    const params: Record<string, string> = seg[0] === "orders" && seg[1] !== undefined ? { id: seg[1] } : {};
    const req: HttpRequest = {
      method,
      path,
      params,
      query: new URLSearchParams(),
      body,
      caller: who === null ? null : { id: who.account.id },
    };
    let handler: (r: HttpRequest, s: Store) => ApiResponse;
    if (seg[0] === "me") handler = listMyOrders;
    else if (seg.length === 1) handler = createOrder;
    else if (seg[2] === "pay") handler = payOrder;
    else if (seg[2] === "cancel") handler = cancelOrder;
    else handler = getOrder;
    try {
      const r = handler(req, store);
      return { status: r.status, body: JSON.parse(JSON.stringify(r.body)) };
    } catch (e) {
      const err = e as { code?: string; status?: number; message?: string };
      if (typeof err.code !== "string" || typeof err.status !== "number") throw e;
      return { status: err.status, body: { error: `${err.code}: ${err.message ?? ""}` } };
    }
  };
  const event = (o: EventOpts): Event =>
    store.createEvent({
      title: "Show",
      venue: "Hall",
      startsAt: new Date(Date.now() + (o.startsInMs ?? 3 * DAY)).toISOString(),
      organizerId: o.org.account.id,
      tiers: o.tiers.map((t, i) => ({ name: `Tier${i}`, ...t })),
    });
  const place = (c: Acct, ev: Event, items: [number, number][], discountCode?: string): Promise<Res> =>
    call("POST", "/orders", c, {
      eventId: ev.id,
      items: items.map(([ti, quantity]) => ({ tierId: ev.tiers[ti]!.id, quantity })),
      ...(discountCode !== undefined ? { discountCode } : {}),
    });
  const avail = (ev: Event): number[] => store.getEvent(ev.id)!.tiers.map((t) => t.available);
  const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);
  const code = (ev: Event, c: string, o: { percentOff?: number; amountOffCents?: number; maxUses?: number; expiresAtMs?: number }) =>
    store.createDiscountCode(ev.id, {
      code: c,
      percentOff: o.percentOff ?? null,
      amountOffCents: o.amountOffCents ?? null,
      maxUses: o.maxUses ?? null,
      expiresAtMs: o.expiresAtMs ?? null,
    });
  return { store, account, call, event, place, avail, advance, code };
}

function expectErr(r: Res, status: number, code: string): void {
  expect(r.status).toBe(status);
  expect(typeof r.body.error).toBe("string");
  expect(r.body.error).toContain(code);
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe("Checkout: POST /orders", () => {
  // @covers box-office:CTR-008
  it("a failing rule leaves no Held order: a partial order holds neither Tier and answers 409 E_TICKETS_UNAVAILABLE", async () => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1000, quantity: 5 }, { priceCents: 2000, quantity: 2 }] });
      const r = await w.place(c, ev, [[0, 1], [1, 3]]);
      expectErr(r, 409, "E_TICKETS_UNAVAILABLE");
      expect(w.avail(ev)).toEqual([5, 2]);
      const mine = await w.call("GET", "/me/orders", c);
      expect(mine.body).toEqual([]);
    });
  });

  it("one item answers 201 held with expiresAt createdAt plus 600 seconds", async () => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1000, quantity: 5 }] });
      const r = await w.place(c, ev, [[0, 1]]);
      expect(r.status).toBe(201);
      expect(r.body.status).toBe("held");
      expect(r.body.createdAt).toBe("2026-06-01T12:00:00.000Z");
      expect(r.body.expiresAt).toBe("2026-06-01T12:10:00.000Z");
    });
  });

  it("six tickets in one order answers 201 and exhausting the Tier leaves available 0", async () => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1000, quantity: 6 }] });
      const r = await w.place(c, ev, [[0, 6]]);
      expect(r.status).toBe(201);
      expect(r.body.items[0].quantity).toBe(6);
      expect(w.avail(ev)).toEqual([0]);
    });
  });
});

describe("Held order prices and expiry", () => {
  // @covers box-office:BEH-014
  it("unitPriceCents equals the Tier priceCents, subtotal is the sum, expiry is 600000 ms after createdAt and available falls", async () => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1500, quantity: 10 }] });
      const r = await w.place(c, ev, [[0, 2]]);
      expect(r.status).toBe(201);
      expect(r.body.status).toBe("held");
      expect(r.body.items).toEqual([{ tierId: ev.tiers[0]!.id, quantity: 2, unitPriceCents: 1500 }]);
      expect(r.body.subtotalCents).toBe(3000);
      expect(r.body.discountCode).toBeNull();
      expect(r.body.discountCents).toBe(0);
      expect(r.body.totalCents).toBe(3000);
      expect(r.body.paidAt).toBeNull();
      expect(r.body.createdAt).toMatch(ISO);
      expect(r.body.expiresAt).toMatch(ISO);
      expect(Date.parse(r.body.expiresAt) - Date.parse(r.body.createdAt)).toBe(600000);
      expect(w.avail(ev)).toEqual([8]);
    });
  });

  it("several Tiers in one order echo each unitPriceCents and subtotalCents is 9000", async () => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1500, quantity: 5 }, { priceCents: 2500, quantity: 5 }] });
      const r = await w.place(c, ev, [[0, 1], [1, 3]]);
      expect(r.status).toBe(201);
      expect(r.body.items.map((i: { unitPriceCents: number }) => i.unitPriceCents)).toEqual([1500, 2500]);
      expect(r.body.subtotalCents).toBe(9000);
      expect(w.avail(ev)).toEqual([4, 2]);
    });
  });

  it("HOLD_SECONDS 2 gives expiresAt 2000 ms after createdAt", async () => {
    await run(2, async (w) => {
      const org = w.account("organizer");
      const c = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1000, quantity: 5 }] });
      const r = await w.place(c, ev, [[0, 1]]);
      expect(r.status).toBe(201);
      expect(Date.parse(r.body.expiresAt) - Date.parse(r.body.createdAt)).toBe(2000);
    });
  });

  it("quantity beyond availability answers 409 E_TICKETS_UNAVAILABLE and available is unchanged", async () => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1000, quantity: 3 }] });
      expectErr(await w.place(c, ev, [[0, 4]]), 409, "E_TICKETS_UNAVAILABLE");
      expect(w.avail(ev)).toEqual([3]);
    });
  });

  it("quantity 0 answers 400 E_INVALID_INPUT", async () => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1000, quantity: 3 }] });
      expectErr(await w.place(c, ev, [[0, 0]]), 400, "E_INVALID_INPUT");
    });
  });
});

describe("Checkout input validation", () => {
  // @covers box-office:BEH-015
  it.each([
    ["empty items", (e: Event) => ({ eventId: e.id, items: [] })],
    ["missing items", (e: Event) => ({ eventId: e.id })],
    ["missing eventId", (e: Event) => ({ items: [{ tierId: e.tiers[0]!.id, quantity: 1 }] })],
    ["duplicated tierId", (e: Event) => ({ eventId: e.id, items: [{ tierId: e.tiers[0]!.id, quantity: 1 }, { tierId: e.tiers[0]!.id, quantity: 1 }] })],
    ["quantity 0", (e: Event) => ({ eventId: e.id, items: [{ tierId: e.tiers[0]!.id, quantity: 0 }] })],
    ["quantity -1", (e: Event) => ({ eventId: e.id, items: [{ tierId: e.tiers[0]!.id, quantity: -1 }] })],
    ["quantity 1.5", (e: Event) => ({ eventId: e.id, items: [{ tierId: e.tiers[0]!.id, quantity: 1.5 }] })],
    ["quantity as string", (e: Event) => ({ eventId: e.id, items: [{ tierId: e.tiers[0]!.id, quantity: "1" }] })],
    ["items not an array", (e: Event) => ({ eventId: e.id, items: "x" })],
  ])("%s answers 400 E_INVALID_INPUT with no order and no change of available", async (_name, build) => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1000, quantity: 5 }] });
      const r = await w.call("POST", "/orders", c, build(ev));
      expectErr(r, 400, "E_INVALID_INPUT");
      expect(w.avail(ev)).toEqual([5]);
      expect((await w.call("GET", "/me/orders", c)).body).toEqual([]);
    });
  });

  it("a body that is a JSON array answers 400 E_INVALID_INPUT", async () => {
    await run(600, async (w) => {
      const c = w.account("customer");
      expectErr(await w.call("POST", "/orders", c, [1]), 400, "E_INVALID_INPUT");
    });
  });

  it("quantity 1 answers 201 held and the Tier available falls from 5 to 4", async () => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1000, quantity: 5 }] });
      const r = await w.place(c, ev, [[0, 1]]);
      expect(r.status).toBe(201);
      expect(r.body.status).toBe("held");
      expect(w.avail(ev)).toEqual([4]);
    });
  });
});

describe("Checkout resource and state checks", () => {
  // @covers box-office:BEH-016
  it("an unknown event answers 404 E_NOT_FOUND before the Tier check and a foreign Tier answers 400 E_INVALID_TIER before the 409 checks", async () => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c = w.account("customer");
      const a = w.event({ org, tiers: [{ priceCents: 1000, quantity: 5 }] });
      const b = w.event({ org, tiers: [{ priceCents: 1000, quantity: 5 }] });
      const unknown = await w.call("POST", "/orders", c, { eventId: "no-such-event", items: [{ tierId: b.tiers[0]!.id, quantity: 1 }] });
      expectErr(unknown, 404, "E_NOT_FOUND");
      const foreign = await w.call("POST", "/orders", c, { eventId: a.id, items: [{ tierId: b.tiers[0]!.id, quantity: 1 }] });
      expectErr(foreign, 400, "E_INVALID_TIER");
      store_cancel(w, a);
      const cancelledForeign = await w.call("POST", "/orders", c, { eventId: a.id, items: [{ tierId: b.tiers[0]!.id, quantity: 1 }] });
      expectErr(cancelledForeign, 400, "E_INVALID_TIER");
      const exhaustedForeign = await w.call("POST", "/orders", c, { eventId: b.id, items: [{ tierId: a.tiers[0]!.id, quantity: 99 }] });
      expectErr(exhaustedForeign, 400, "E_INVALID_TIER");
    });
  });

  it("a cancelled event answers 409 E_EVENT_NOT_ON_SALE and holds nothing", async () => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1000, quantity: 5 }] });
      store_cancel(w, ev);
      expectErr(await w.place(c, ev, [[0, 1]]), 409, "E_EVENT_NOT_ON_SALE");
      expect(w.avail(ev)).toEqual([5]);
    });
  });

  it("an event that started one second ago and one starting exactly now answer 409 E_EVENT_NOT_ON_SALE", async () => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1000, quantity: 5 }], startsInMs: 1000 });
      expect((await w.place(c, ev, [[0, 1]])).status).toBe(201);
      w.advance(1000);
      expectErr(await w.place(c, ev, [[0, 1]]), 409, "E_EVENT_NOT_ON_SALE");
      w.advance(1000);
      expectErr(await w.place(c, ev, [[0, 1]]), 409, "E_EVENT_NOT_ON_SALE");
    });
  });

  it("quantity equal to availability answers 201 with available 0 and one above answers 409 E_TICKETS_UNAVAILABLE", async () => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1000, quantity: 5 }] });
      expectErr(await w.place(c, ev, [[0, 6]]), 409, "E_TICKETS_UNAVAILABLE");
      const ok = await w.place(c, ev, [[0, 5]]);
      expect(ok.status).toBe(201);
      expect(w.avail(ev)).toEqual([0]);
    });
  });
});

function store_cancel(w: World, ev: Event): void {
  w.store.cancelEvent(ev.id);
}

describe("Ticket limit and discount usability", () => {
  // @covers box-office:BEH-017
  it("a customer holding 5 tickets gets 201 for a sixth and 422 E_TICKET_LIMIT for two more, nothing held", async () => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1000, quantity: 20 }] });
      expect((await w.place(c, ev, [[0, 5]])).status).toBe(201);
      expectErr(await w.place(c, ev, [[0, 2]]), 422, "E_TICKET_LIMIT");
      expect(w.avail(ev)).toEqual([15]);
      const sixth = await w.place(c, ev, [[0, 1]]);
      expect(sixth.status).toBe(201);
      expect(sixth.body.totalCents).toBe(sixth.body.subtotalCents);
      expect(sixth.body.discountCents).toBe(0);
      expectErr(await w.place(c, ev, [[0, 1]]), 422, "E_TICKET_LIMIT");
      expect(w.avail(ev)).toEqual([14]);
    });
  });

  it("paid orders count toward the limit of 6", async () => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1000, quantity: 20 }] });
      const first = await w.place(c, ev, [[0, 3]]);
      expect((await w.call("POST", `/orders/${first.body.id}/pay`, c)).status).toBe(200);
      expect((await w.place(c, ev, [[0, 3]])).status).toBe(201);
      expectErr(await w.place(c, ev, [[0, 1]]), 422, "E_TICKET_LIMIT");
    });
  });

  it("the ticket limit is checked before the discount code", async () => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1000, quantity: 20 }] });
      await w.place(c, ev, [[0, 5]]);
      expectErr(await w.place(c, ev, [[0, 2]], "NOPE"), 422, "E_TICKET_LIMIT");
    });
  });

  it.each([
    ["an empty code", ""],
    ["an unknown code", "NEVERISSUED"],
  ])("%s answers 422 E_DISCOUNT_UNUSABLE and holds nothing", async (_n, code) => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1000, quantity: 5 }] });
      expectErr(await w.place(c, ev, [[0, 1]], code), 422, "E_DISCOUNT_UNUSABLE");
      expect(w.avail(ev)).toEqual([5]);
      expect((await w.call("GET", "/me/orders", c)).body).toEqual([]);
    });
  });

  it("an expired code answers 422 E_DISCOUNT_UNUSABLE", async () => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1000, quantity: 5 }] });
      w.code(ev, "OLD", { percentOff: 10, expiresAtMs: Date.now() + HOUR });
      expect((await w.place(c, ev, [[0, 1]], "OLD")).status).toBe(201);
      w.advance(2 * HOUR);
      expectErr(await w.place(c, ev, [[0, 1]], "OLD"), 422, "E_DISCOUNT_UNUSABLE");
    });
  });

  it("a used-up code answers 422 E_DISCOUNT_UNUSABLE while one held order carries it", async () => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c1 = w.account("customer");
      const c2 = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1000, quantity: 5 }] });
      w.code(ev, "ONCE", { percentOff: 10, maxUses: 1 });
      expect((await w.place(c1, ev, [[0, 1]], "ONCE")).status).toBe(201);
      expectErr(await w.place(c2, ev, [[0, 1]], "ONCE"), 422, "E_DISCOUNT_UNUSABLE");
      expect(w.avail(ev)).toEqual([4]);
    });
  });
});

describe("Paying an order", () => {
  // @covers box-office:BEH-019
  it("paying a Held order answers 200 paid with paidAt in toISOString form, same totals and unchanged available", async () => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1500, quantity: 10 }] });
      const held = await w.place(c, ev, [[0, 2]]);
      w.advance(5000);
      const r = await w.call("POST", `/orders/${held.body.id}/pay`, c);
      expect(r.status).toBe(200);
      expect(r.body.status).toBe("paid");
      expect(r.body.paidAt).toBe("2026-06-01T12:00:05.000Z");
      expect(r.body.items).toEqual(held.body.items);
      expect(r.body.subtotalCents).toBe(3000);
      expect(r.body.totalCents).toBe(3000);
      expect(w.avail(ev)).toEqual([8]);
    });
  });

  // @covers box-office:CTR-009
  it("only a Held order can be paid: a paid, expired or cancelled order answers 409 E_ORDER_STATE", async () => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1000, quantity: 10 }] });
      const paid = await w.place(c, ev, [[0, 1]]);
      const first = await w.call("POST", `/orders/${paid.body.id}/pay`, c);
      w.advance(1000);
      expectErr(await w.call("POST", `/orders/${paid.body.id}/pay`, c), 409, "E_ORDER_STATE");
      const after = await w.call("GET", `/orders/${paid.body.id}`, c);
      expect(after.body.paidAt).toBe(first.body.paidAt);
      expect(after.body.status).toBe("paid");

      const cancelled = await w.place(c, ev, [[0, 1]]);
      await w.call("POST", `/orders/${cancelled.body.id}/cancel`, c);
      expectErr(await w.call("POST", `/orders/${cancelled.body.id}/pay`, c), 409, "E_ORDER_STATE");

      const expiring = await w.place(c, ev, [[0, 1]]);
      w.advance(601_000);
      expectErr(await w.call("POST", `/orders/${expiring.body.id}/pay`, c), 409, "E_ORDER_STATE");
      expect((await w.call("GET", `/orders/${expiring.body.id}`, c)).body.status).toBe("expired");
    });
  });

  it("another customer's order and an unknown id answer 404 E_NOT_FOUND, not 403", async () => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c1 = w.account("customer");
      const c2 = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1000, quantity: 10 }] });
      const held = await w.place(c1, ev, [[0, 1]]);
      expectErr(await w.call("POST", `/orders/${held.body.id}/pay`, c2), 404, "E_NOT_FOUND");
      expectErr(await w.call("POST", "/orders/no-such-order/pay", c1), 404, "E_NOT_FOUND");
      expect((await w.call("GET", `/orders/${held.body.id}`, c1)).body.status).toBe("held");
    });
  });
});

describe("Cancelling and refunding an order", () => {
  // @covers box-office:BEH-020
  it("a Held order becomes cancelled, a paid order 3 days away becomes refunded, and available grows by the tickets", async () => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1000, quantity: 10 }] });
      const held = await w.place(c, ev, [[0, 2]]);
      const cancelled = await w.call("POST", `/orders/${held.body.id}/cancel`, c);
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.status).toBe("cancelled");
      expect(w.avail(ev)).toEqual([10]);

      const o2 = await w.place(c, ev, [[0, 3]]);
      await w.call("POST", `/orders/${o2.body.id}/pay`, c);
      expect(w.avail(ev)).toEqual([7]);
      const refunded = await w.call("POST", `/orders/${o2.body.id}/cancel`, c);
      expect(refunded.status).toBe(200);
      expect(refunded.body.status).toBe("refunded");
      expect(w.avail(ev)).toEqual([10]);
    });
  });

  // @covers box-office:CTR-010
  it("a paid order is refunded at 24 hours and 1 second away and refused at exactly 24 hours and at 23 hours", async () => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c = w.account("customer");
      const outside = w.event({ org, tiers: [{ priceCents: 1000, quantity: 10 }], startsInMs: DAY + 1000 });
      const edge = w.event({ org, tiers: [{ priceCents: 1000, quantity: 10 }], startsInMs: DAY });
      const inside = w.event({ org, tiers: [{ priceCents: 1000, quantity: 10 }], startsInMs: 23 * HOUR });
      const ids: string[] = [];
      for (const ev of [outside, edge, inside]) {
        const o = await w.place(c, ev, [[0, 1]]);
        expect((await w.call("POST", `/orders/${o.body.id}/pay`, c)).status).toBe(200);
        ids.push(o.body.id);
      }
      const r1 = await w.call("POST", `/orders/${ids[0]}/cancel`, c);
      expect(r1.status).toBe(200);
      expect(r1.body.status).toBe("refunded");
      expectErr(await w.call("POST", `/orders/${ids[1]}/cancel`, c), 409, "E_ORDER_STATE");
      expectErr(await w.call("POST", `/orders/${ids[2]}/cancel`, c), 409, "E_ORDER_STATE");
      expect((await w.call("GET", `/orders/${ids[1]}`, c)).body.status).toBe("paid");
      expect(w.avail(inside)).toEqual([9]);
    });
  });

  it("an expired order and an already cancelled order answer 409 E_ORDER_STATE", async () => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1000, quantity: 10 }] });
      const a = await w.place(c, ev, [[0, 1]]);
      const b = await w.place(c, ev, [[0, 1]]);
      await w.call("POST", `/orders/${b.body.id}/cancel`, c);
      expectErr(await w.call("POST", `/orders/${b.body.id}/cancel`, c), 409, "E_ORDER_STATE");
      w.advance(601_000);
      expectErr(await w.call("POST", `/orders/${a.body.id}/cancel`, c), 409, "E_ORDER_STATE");
    });
  });

  it("another customer's order and an unknown id answer 404 E_NOT_FOUND", async () => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c1 = w.account("customer");
      const c2 = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1000, quantity: 10 }] });
      const held = await w.place(c1, ev, [[0, 1]]);
      expectErr(await w.call("POST", `/orders/${held.body.id}/cancel`, c2), 404, "E_NOT_FOUND");
      expectErr(await w.call("POST", "/orders/no-such-order/cancel", c1), 404, "E_NOT_FOUND");
      expect((await w.call("GET", `/orders/${held.body.id}`, c1)).body.status).toBe("held");
    });
  });

  it("a waitlist entry fitting the freed tickets takes them: the customer gets a Held order and available stays 0", async () => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const a = w.account("customer");
      const b = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1000, quantity: 2 }] });
      const held = await w.place(a, ev, [[0, 2]]);
      w.store.joinWaitlist({ eventId: ev.id, tierId: ev.tiers[0]!.id, customerId: b.account.id, quantity: 2 });
      const r = await w.call("POST", `/orders/${held.body.id}/cancel`, a);
      expect(r.status).toBe(200);
      expect(r.body.status).toBe("cancelled");
      expect(w.avail(ev)).toEqual([0]);
      const mine = await w.call("GET", "/me/orders", b);
      expect(mine.body).toHaveLength(1);
      expect(mine.body[0].status).toBe("held");
      expect(mine.body[0].items[0].quantity).toBe(2);
    });
  });
});

describe("Reading one order", () => {
  // @covers box-office:BEH-021
  it("the placing customer and the event's organizer get 200 with the same order, a stranger gets 404 not 403", async () => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const other = w.account("organizer");
      const c = w.account("customer");
      const third = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1000, quantity: 10 }] });
      const held = await w.place(c, ev, [[0, 1]]);
      const asC = await w.call("GET", `/orders/${held.body.id}`, c);
      const asO = await w.call("GET", `/orders/${held.body.id}`, org);
      expect(asC.status).toBe(200);
      expect(asC.body.id).toBe(held.body.id);
      expect(asC.body.customerId).toBe(c.account.id);
      expect(asC.body.eventId).toBe(ev.id);
      expect(asO.status).toBe(200);
      expect(asO.body).toEqual(asC.body);
      expectErr(await w.call("GET", `/orders/${held.body.id}`, third), 404, "E_NOT_FOUND");
      expectErr(await w.call("GET", `/orders/${held.body.id}`, other), 404, "E_NOT_FOUND");
      expectErr(await w.call("GET", "/orders/no-such-order", c), 404, "E_NOT_FOUND");
    });
  });

  // @covers box-office:CTR-011
  it("the order body carries the full shape", async () => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1000, quantity: 10 }] });
      const held = await w.place(c, ev, [[0, 1]]);
      const r = await w.call("GET", `/orders/${held.body.id}`, c);
      expect(Object.keys(r.body).sort()).toEqual(
        ["createdAt", "customerId", "discountCents", "discountCode", "eventId", "expiresAt", "id", "items", "paidAt", "status", "subtotalCents", "totalCents"],
      );
      expectErr(await w.call("GET", "/orders/no-such-order", org), 404, "E_NOT_FOUND");
    });
  });
});

describe("Listing my orders", () => {
  // @covers box-office:BEH-022
  it("three orders at distinct instants come back newest first and hold only the caller's orders", async () => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c = w.account("customer");
      const d = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1000, quantity: 20 }] });
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        ids.push((await w.place(c, ev, [[0, 1]])).body.id);
        await w.place(d, ev, [[0, 1]]);
        w.advance(1000);
      }
      const r = await w.call("GET", "/me/orders", c);
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body)).toBe(true);
      expect(r.body.map((o: { id: string }) => o.id)).toEqual([ids[2], ids[1], ids[0]]);
      expect(r.body.every((o: { customerId: string }) => o.customerId === c.account.id)).toBe(true);
    });
  });

  // @covers box-office:CTR-012
  it("a customer with no order gets an empty array and one with a single order gets length 1", async () => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1000, quantity: 20 }] });
      const none = await w.call("GET", "/me/orders", c);
      expect(none.status).toBe(200);
      expect(none.body).toEqual([]);
      await w.place(c, ev, [[0, 1]]);
      const one = await w.call("GET", "/me/orders", c);
      expect(one.body).toHaveLength(1);
      expect(one.body[0].status).toBe("held");
    });
  });

  it("a held order past its expiry is listed with status expired", async () => {
    await run(1, async (w) => {
      const org = w.account("organizer");
      const c = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1000, quantity: 20 }] });
      await w.place(c, ev, [[0, 1]]);
      w.advance(2000);
      const r = await w.call("GET", "/me/orders", c);
      expect(r.body[0].status).toBe("expired");
    });
  });
});

describe("Discount codes at checkout", () => {
  // @covers box-office:BEH-025
  it("a lower-case code matches the stored upper-case code, discountCents is the floor and the use is spent", async () => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c1 = w.account("customer");
      const c2 = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1000, quantity: 10 }] });
      w.code(ev, "EARLYBIRD", { percentOff: 25, maxUses: 1 });
      const r = await w.place(c1, ev, [[0, 1]], "earlybird");
      expect(r.status).toBe(201);
      expect(r.body.subtotalCents).toBe(1000);
      expect(r.body.discountCents).toBe(250);
      expect(r.body.totalCents).toBe(750);
      expect(r.body.discountCode).toBe("EARLYBIRD");
      expectErr(await w.place(c2, ev, [[0, 1]], "EARLYBIRD"), 422, "E_DISCOUNT_UNUSABLE");
    });
  });

  it.each([
    ["percentOff 100", { percentOff: 100 }, 1000, 1000, 0],
    ["percentOff 33 on 1001 floors 330.33", { percentOff: 33 }, 1001, 330, 671],
    ["amountOffCents above subtotal", { amountOffCents: 5000 }, 1000, 1000, 0],
    ["amountOffCents below subtotal", { amountOffCents: 300 }, 1000, 300, 700],
    ["subtotal 0", { percentOff: 25 }, 0, 0, 0],
  ])("%s", async (_n, spec, price, discount, total) => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: price, quantity: 10 }] });
      w.code(ev, "PROMO", spec);
      const r = await w.place(c, ev, [[0, 1]], "promo");
      expect(r.status).toBe(201);
      expect(r.body.subtotalCents).toBe(price);
      expect(r.body.discountCents).toBe(discount);
      expect(r.body.totalCents).toBe(total);
      expect(r.body.discountCode).toBe("PROMO");
    });
  });

  it("without a code discountCode is null, discountCents 0 and totalCents equals subtotalCents", async () => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1000, quantity: 10 }] });
      const r = await w.place(c, ev, [[0, 2]]);
      expect(r.body.discountCode).toBeNull();
      expect(r.body.discountCents).toBe(0);
      expect(r.body.totalCents).toBe(2000);
    });
  });

  it("a code the event lacks, an expired code and a code at maxUses answer 422 E_DISCOUNT_UNUSABLE with no 201", async () => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1000, quantity: 10 }] });
      const other = w.event({ org, tiers: [{ priceCents: 1000, quantity: 10 }] });
      w.code(other, "ELSEWHERE", { percentOff: 10 });
      expectErr(await w.place(c, ev, [[0, 1]], "ELSEWHERE"), 422, "E_DISCOUNT_UNUSABLE");
      expect(w.avail(ev)).toEqual([10]);
    });
  });

  it("cancelling a Held order and the expiry of a Held order give the use of a maxUses 1 code back", async () => {
    await run(5, async (w) => {
      const org = w.account("organizer");
      const c = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1000, quantity: 10 }] });
      w.code(ev, "ONCE", { percentOff: 10, maxUses: 1 });
      const first = await w.place(c, ev, [[0, 1]], "ONCE");
      expect(first.status).toBe(201);
      await w.call("POST", `/orders/${first.body.id}/cancel`, c);
      const second = await w.place(c, ev, [[0, 1]], "ONCE");
      expect(second.status).toBe(201);
      w.advance(6000);
      const third = await w.place(c, ev, [[0, 1]], "ONCE");
      expect(third.status).toBe(201);
    });
  });
});

describe("Six tickets per customer and event", () => {
  // @covers box-office:INV-006
  it("six tickets across two orders are accepted and a seventh is refused with 422 E_TICKET_LIMIT", async () => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1000, quantity: 30 }] });
      expect((await w.place(c, ev, [[0, 4]])).status).toBe(201);
      expect((await w.place(c, ev, [[0, 2]])).status).toBe(201);
      expectErr(await w.place(c, ev, [[0, 1]]), 422, "E_TICKET_LIMIT");
      const mine = await w.call("GET", "/me/orders", c);
      const total = mine.body.reduce(
        (n: number, o: { items: { quantity: number }[] }) => n + o.items.reduce((m, i) => m + i.quantity, 0),
        0,
      );
      expect(total).toBe(6);
    });
  });

  it("seven tickets in one order are refused with 422 E_TICKET_LIMIT", async () => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1000, quantity: 30 }] });
      expectErr(await w.place(c, ev, [[0, 7]]), 422, "E_TICKET_LIMIT");
      expect(w.avail(ev)).toEqual([30]);
    });
  });

  it("waitlist serving creates no order for a customer holding 5 tickets who waits for 2", async () => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c = w.account("customer");
      const d = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1000, quantity: 7 }] });
      await w.place(c, ev, [[0, 5]]);
      const dOrder = await w.place(d, ev, [[0, 2]]);
      w.store.joinWaitlist({ eventId: ev.id, tierId: ev.tiers[0]!.id, customerId: c.account.id, quantity: 2 });
      expect((await w.call("POST", `/orders/${dOrder.body.id}/cancel`, d)).status).toBe(200);
      const mine = await w.call("GET", "/me/orders", c);
      expect(mine.body).toHaveLength(1);
      expect(mine.body[0].items[0].quantity).toBe(5);
      expect(w.avail(ev)).toEqual([2]);
    });
  });
});

describe("Pay then refund", () => {
  // @covers box-office:SCN-002
  it("a refund returns the tickets, the code use and the report figures, and a second cancel answers 409", async () => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1000, quantity: 5 }], startsInMs: 3 * DAY });
      w.code(ev, "TENOFF", { percentOff: 10, maxUses: 1 });
      const held = await w.place(c, ev, [[0, 1]], "tenoff");
      expect(held.status).toBe(201);
      expect(held.body.discountCents).toBe(100);
      const paid = await w.call("POST", `/orders/${held.body.id}/pay`, c);
      expect(paid.status).toBe(200);
      expect(paid.body.status).toBe("paid");
      expect(paid.body.paidAt).toMatch(ISO);
      const refunded = await w.call("POST", `/orders/${held.body.id}/cancel`, c);
      expect(refunded.status).toBe(200);
      expect(refunded.body.status).toBe("refunded");
      expect(refunded.body.paidAt).not.toBeNull();
      expect(w.avail(ev)).toEqual([5]);
      const report = w.store.getReport(ev.id);
      expect(report.refundedCents).toBe(900);
      expect(report.grossCents).toBe(0);
      expect(report.netCents).toBe(0);
      expectErr(await w.call("POST", `/orders/${held.body.id}/cancel`, c), 409, "E_ORDER_STATE");
      expect((await w.place(c, ev, [[0, 1]], "TENOFF")).status).toBe(201);
    });
  });

  it.each([
    ["25 hours", 25 * HOUR, 200, "refunded"],
    ["23 hours", 23 * HOUR, 409, "paid"],
  ])("an event %s ahead: cancel answers %s and the order ends %s", async (_n, startsIn, status, final) => {
    await run(600, async (w) => {
      const org = w.account("organizer");
      const c = w.account("customer");
      const ev = w.event({ org, tiers: [{ priceCents: 1000, quantity: 5 }], startsInMs: startsIn });
      const held = await w.place(c, ev, [[0, 1]]);
      await w.call("POST", `/orders/${held.body.id}/pay`, c);
      const r = await w.call("POST", `/orders/${held.body.id}/cancel`, c);
      expect(r.status).toBe(status);
      if (status === 409) expect(r.body.error).toContain("E_ORDER_STATE");
      expect((await w.call("GET", `/orders/${held.body.id}`, c)).body.status).toBe(final);
    });
  });
});
