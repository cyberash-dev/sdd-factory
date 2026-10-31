import { describe, expect, it } from "vitest";
import type { HttpRequest } from "../../src/core/index.js";
import { cancelEvent, createEvent, getEvent, getEventReport, listEvents } from "../../src/events/index.js";
import { createStore } from "../../src/store/index.js";
import type { Event, Role, Store } from "../../src/store/index.js";

type Any = Record<string, any>;
type TierIn = { name: string; priceCents: number; quantity: number };

let counter = 0;

function setup() {
  const store = createStore({ holdSeconds: 600 });
  const account = (role: Role) => {
    counter += 1;
    return store.createAccount({ email: `user${counter}@example.com`, password: "password1", name: `User ${counter}`, role });
  };
  return { store, account };
}

function mkEvent(
  store: Store,
  organizerId: string,
  over: { title?: string; venue?: string; startsAt?: string; tiers?: TierIn[] } = {},
): Event {
  return store.createEvent({
    title: over.title ?? "Night Jazz",
    venue: over.venue ?? "Blue Hall",
    startsAt: over.startsAt ?? "2099-01-01T10:00:00.000Z",
    organizerId,
    tiers: over.tiers ?? [{ name: "Balcony", priceCents: 1000, quantity: 10 }],
  });
}

function req(method: string, path: string, over: Partial<HttpRequest> = {}): HttpRequest {
  return { method, path, params: {}, query: new URLSearchParams(), body: undefined, caller: null, ...over };
}

function post(callerId: string, body: unknown): HttpRequest {
  return req("POST", "/events", { body, caller: { id: callerId } });
}

function byId(method: string, suffix: string, id: string, callerId: string | null): HttpRequest {
  return req(method, `/events/${id}${suffix}`, { params: { id }, caller: callerId ? { id: callerId } : null });
}

function errorOf(fn: () => unknown): Any | undefined {
  try {
    fn();
  } catch (e) {
    return e as Any;
  }
  return undefined;
}

function list(store: Store, query: string) {
  const res = listEvents(req("GET", "/events", { query: new URLSearchParams(query) }), store);
  return res.body as Any;
}

const ms = (offset: number) => new Date(Date.now() + offset).toISOString();

function validBody(over: Any = {}): Any {
  return {
    title: "Night Jazz",
    venue: "Blue Hall",
    startsAt: ms(86_400_000),
    tiers: [{ name: "Balcony", priceCents: 1500, quantity: 5 }],
    ...over,
  };
}

describe("events: createEvent", () => {
  // @covers box-office:BEH-007
  it("creates an on_sale Event with the organizer as organizerId and available equal to quantity", () => {
    const { store, account } = setup();
    const org = account("organizer");
    const res = createEvent(
      post(org.id, {
        title: "Night Jazz",
        venue: "Blue Hall",
        startsAt: "2099-03-01T18:00:00Z",
        tiers: [{ name: "Balcony", priceCents: 1500, quantity: 10 }],
      }),
      store,
    );
    const body = res.body as Any;
    expect(res.status).toBe(201);
    expect(body.status).toBe("on_sale");
    expect(body.organizerId).toBe(org.id);
    expect(body.title).toBe("Night Jazz");
    expect(body.venue).toBe("Blue Hall");
    expect(body.startsAt).toBe("2099-03-01T18:00:00.000Z");
    expect(body.tiers).toHaveLength(1);
    expect(typeof body.tiers[0].id).toBe("string");
    expect(body.tiers[0].id).not.toBe("");
    expect(body.tiers[0]).toMatchObject({ name: "Balcony", priceCents: 1500, quantity: 10, available: 10 });
    expect(store.getEvent(body.id)?.status).toBe("on_sale");
  });

  // @covers box-office:CTR-004
  it("creates five Tiers in submitted order, each with id, name, priceCents, quantity and available", () => {
    const { store, account } = setup();
    const org = account("organizer");
    const names = ["A", "B", "C", "D", "E"];
    const res = createEvent(
      post(org.id, validBody({ tiers: names.map((name) => ({ name, priceCents: 0, quantity: 1 })) })),
      store,
    );
    const body = res.body as Any;
    expect(res.status).toBe(201);
    expect(body.status).toBe("on_sale");
    expect(body.tiers.map((t: Any) => t.name)).toEqual(names);
    expect(new Set(body.tiers.map((t: Any) => t.id)).size).toBe(5);
    for (const t of body.tiers) {
      expect(Object.keys(t).sort()).toEqual(["available", "id", "name", "priceCents", "quantity"]);
      expect(t.available).toBe(t.quantity);
    }
  });

  it("accepts quantity 10000, startsAt one hour ahead, and tier names differing only in case", () => {
    const { store, account } = setup();
    const org = account("organizer");
    const big = createEvent(
      post(org.id, validBody({ startsAt: ms(3_600_000), tiers: [{ name: "GA", priceCents: 0, quantity: 10000 }] })),
      store,
    );
    expect(big.status).toBe(201);
    expect((big.body as Any).tiers[0]).toMatchObject({ quantity: 10000, available: 10000, priceCents: 0 });
    const cased = createEvent(
      post(org.id, validBody({ tiers: [{ name: "Balcony", priceCents: 1, quantity: 1 }, { name: "balcony", priceCents: 1, quantity: 1 }] })),
      store,
    );
    expect(cased.status).toBe(201);
  });

  it.each([
    ["title of 1 character", { title: "x" }],
    ["title of 100 characters", { title: "x".repeat(100) }],
    ["venue of 100 characters", { venue: "v".repeat(100) }],
    ["quantity 1", { tiers: [{ name: "T", priceCents: 1500, quantity: 1 }] }],
  ])("accepts a boundary Event with %s", (_label, over) => {
    const { store, account } = setup();
    const org = account("organizer");
    const res = createEvent(post(org.id, validBody(over)), store);
    expect(res.status).toBe(201);
    expect((res.body as Any).status).toBe("on_sale");
  });

  // @covers box-office:BEH-008
  it("rejects every out-of-rule field with 400 E_INVALID_INPUT and creates no Event", () => {
    const { store, account } = setup();
    const org = account("organizer");
    const tier = (over: Any = {}) => ({ name: "T", priceCents: 1500, quantity: 5, ...over });
    const cases: [string, Any][] = [
      ["title empty", { title: "" }],
      ["title 101", { title: "x".repeat(101) }],
      ["venue empty", { venue: "" }],
      ["venue 101", { venue: "v".repeat(101) }],
      ["startsAt past", { startsAt: ms(-3_600_000) }],
      ["startsAt unreadable", { startsAt: "next tuesday-ish" }],
      ["zero tiers", { tiers: [] }],
      ["six tiers", { tiers: ["A", "B", "C", "D", "E", "F"].map((name) => tier({ name })) }],
      ["repeated tier name", { tiers: [tier({ name: "Balcony" }), tier({ name: "Balcony" })] }],
      ["quantity 0", { tiers: [tier({ quantity: 0 })] }],
      ["quantity 10001", { tiers: [tier({ quantity: 10001 })] }],
      ["quantity 2.5", { tiers: [tier({ quantity: 2.5 })] }],
      ["priceCents 15.5", { tiers: [tier({ priceCents: 15.5 })] }],
      ["priceCents -1", { tiers: [tier({ priceCents: -1 })] }],
    ];
    for (const [label, over] of cases) {
      const err = errorOf(() => createEvent(post(org.id, validBody(over)), store));
      expect(err, label).toMatchObject({ code: "E_INVALID_INPUT", status: 400 });
      expect(store.listEvents({ page: 1, pageSize: 50 }).total, label).toBe(0);
    }
    const ok = createEvent(post(org.id, validBody()), store);
    expect(ok.status).toBe(201);
  });
});

describe("events: listEvents", () => {
  // @covers box-office:BEH-009
  it("lists only on_sale Events ordered by startsAt then title with page 1 and pageSize 10", () => {
    const { store, account } = setup();
    const org = account("organizer");
    const a = mkEvent(store, org.id, { title: "Charlie", startsAt: "2099-01-03T10:00:00.000Z" });
    const b = mkEvent(store, org.id, { title: "Zulu", startsAt: "2099-01-01T10:00:00.000Z" });
    const c = mkEvent(store, org.id, { title: "Alpha", startsAt: "2099-01-01T10:00:00.000Z" });
    const d = mkEvent(store, org.id, { title: "Bravo", startsAt: "2099-01-02T10:00:00.000Z" });
    store.cancelEvent(d.id);
    const res = listEvents(req("GET", "/events"), store);
    const body = res.body as Any;
    expect(res.status).toBe(200);
    expect(body.items.map((e: Any) => e.id)).toEqual([c.id, b.id, a.id]);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(10);
    expect(body.total).toBe(3);
    for (const e of body.items) {
      expect(e.status).toBe("on_sale");
      expect(Object.keys(e).sort()).toEqual(["id", "organizerId", "startsAt", "status", "tiers", "title", "venue"]);
    }
  });

  it("answers an empty page for no Events and counts 11 Events as total 11 with 10 items", () => {
    const { store, account } = setup();
    const org = account("organizer");
    expect(listEvents(req("GET", "/events"), store).body).toEqual({ items: [], page: 1, pageSize: 10, total: 0 });
    for (let i = 0; i < 11; i++) {
      mkEvent(store, org.id, { title: `E${i}`, startsAt: `2099-01-${String(i + 1).padStart(2, "0")}T10:00:00.000Z` });
    }
    const body = listEvents(req("GET", "/events"), store).body as Any;
    expect(body.total).toBe(11);
    expect(body.items).toHaveLength(10);
  });

  // @covers box-office:BEH-010
  it("narrows items by q, from, to, page and pageSize while total counts every match", () => {
    const { store, account } = setup();
    const org = account("organizer");
    const x = mkEvent(store, org.id, { title: "night jazz", venue: "Blue Hall", startsAt: "2099-01-01T10:00:00.000Z" });
    const y = mkEvent(store, org.id, { title: "Rock Show", venue: "Arena", startsAt: "2099-01-02T10:00:00.000Z" });
    const z = mkEvent(store, org.id, { title: "Opera", venue: "Dome", startsAt: "2099-01-03T10:00:00.000Z" });
    const ids = (b: Any) => b.items.map((e: Any) => e.id);

    let b = list(store, "q=JAZZ");
    expect(ids(b)).toEqual([x.id]);
    expect(b.total).toBe(1);
    b = list(store, "q=blue");
    expect(ids(b)).toEqual([x.id]);
    expect(b.total).toBe(1);
    b = list(store, new URLSearchParams({ from: y.startsAt }).toString());
    expect(ids(b)).toEqual([y.id, z.id]);
    expect(b.total).toBe(2);
    b = list(store, new URLSearchParams({ to: y.startsAt }).toString());
    expect(ids(b)).toEqual([x.id, y.id]);
    b = list(store, new URLSearchParams({ from: y.startsAt, to: y.startsAt }).toString());
    expect(ids(b)).toEqual([y.id]);
    b = list(store, "pageSize=1");
    expect(b.pageSize).toBe(1);
    expect(ids(b)).toEqual([x.id]);
    expect(b.total).toBe(3);
    b = list(store, "page=2&pageSize=1");
    expect(b.page).toBe(2);
    expect(ids(b)).toEqual([y.id]);
    expect(b.total).toBe(3);
    b = list(store, "pageSize=50");
    expect(b.pageSize).toBe(50);
    expect(b.items).toHaveLength(3);
  });

  // @covers box-office:CTR-005
  it("answers 200 with exactly items, page, pageSize and total, and 400 E_INVALID_QUERY for each out-of-rule query", () => {
    const { store, account } = setup();
    const org = account("organizer");
    mkEvent(store, org.id);
    const ok = listEvents(req("GET", "/events", { query: new URLSearchParams("pageSize=50") }), store);
    expect(ok.status).toBe(200);
    expect(Object.keys(ok.body as Any).sort()).toEqual(["items", "page", "pageSize", "total"]);
    expect((ok.body as Any).pageSize).toBe(50);
    expect(list(store, "q=HALL").total).toBe(1);

    for (const q of ["pageSize=51", "pageSize=0", "pageSize=abc", "page=0", "page=abc", "page=1.5", "from=midnightish", "to=not-a-time"]) {
      const err = errorOf(() => listEvents(req("GET", "/events", { query: new URLSearchParams(q) }), store));
      expect(err, q).toMatchObject({ code: "E_INVALID_QUERY", status: 400 });
    }
  });
});

describe("events: getEvent", () => {
  // @covers box-office:BEH-011
  it("answers 200 with an on_sale or cancelled Event and 404 E_NOT_FOUND for an unknown id", () => {
    const { store, account } = setup();
    const org = account("organizer");
    const open = mkEvent(store, org.id);
    const gone = mkEvent(store, org.id, { title: "Gone" });
    store.cancelEvent(gone.id);
    const r1 = getEvent(byId("GET", "", open.id, null), store);
    expect(r1.status).toBe(200);
    expect((r1.body as Any).id).toBe(open.id);
    expect((r1.body as Any).status).toBe("on_sale");
    const r2 = getEvent(byId("GET", "", gone.id, org.id), store);
    expect(r2.status).toBe(200);
    expect((r2.body as Any).status).toBe("cancelled");
    expect((r2.body as Any).title).toBe("Gone");
    const err = errorOf(() => getEvent(byId("GET", "", "no-such-event", null), store));
    expect(err).toMatchObject({ code: "E_NOT_FOUND", status: 404 });
  });

  // @covers box-office:CTR-006
  it("returns the Event with exactly id, title, venue, startsAt, status, organizerId and tiers", () => {
    const { store, account } = setup();
    const org = account("organizer");
    const ev = mkEvent(store, org.id);
    const res = getEvent(byId("GET", "", ev.id, null), store);
    const body = res.body as Any;
    expect(res.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(["id", "organizerId", "startsAt", "status", "tiers", "title", "venue"]);
    expect(Object.keys(body.tiers[0]).sort()).toEqual(["available", "id", "name", "priceCents", "quantity"]);
    expect(body.tiers[0]).toMatchObject({ name: "Balcony", priceCents: 1000, quantity: 10, available: 10 });
  });
});

describe("events: cancelEvent", () => {
  function withOrders() {
    const { store, account } = setup();
    const org = account("organizer");
    const c1 = account("customer");
    const c2 = account("customer");
    const c3 = account("customer");
    const c4 = account("customer");
    const ev = mkEvent(store, org.id, { tiers: [{ name: "GA", priceCents: 1500, quantity: 2 }] });
    const tierId = ev.tiers[0]!.id;
    const paid = store.holdOrder({ eventId: ev.id, customerId: c1.id, items: [{ tierId, quantity: 1 }], discountCode: null });
    store.markPaid(paid.id);
    const held = store.holdOrder({ eventId: ev.id, customerId: c2.id, items: [{ tierId, quantity: 1 }], discountCode: null });
    store.joinWaitlist({ eventId: ev.id, tierId, customerId: c3.id, quantity: 1 });
    store.joinWaitlist({ eventId: ev.id, tierId, customerId: c4.id, quantity: 1 });
    return { store, org, c3, c4, ev, paid, held };
  }

  // @covers box-office:BEH-012
  it("moves paid Orders to refunded, held Orders to cancelled and frees every ticket", () => {
    const { store, org, ev, paid, held } = withOrders();
    const res = cancelEvent(byId("POST", "/cancel", ev.id, org.id), store);
    expect(res.status).toBe(200);
    expect((res.body as Any).status).toBe("cancelled");
    expect(store.getOrder(paid.id)?.status).toBe("refunded");
    expect(store.getOrder(held.id)?.status).toBe("cancelled");
    expect(store.getEvent(ev.id)?.tiers[0]?.available).toBe(2);

    const s2 = setup();
    const o2 = s2.account("organizer");
    const empty = mkEvent(s2.store, o2.id);
    const r2 = cancelEvent(byId("POST", "/cancel", empty.id, o2.id), s2.store);
    expect(r2.status).toBe(200);
    expect((r2.body as Any).status).toBe("cancelled");
    expect((r2.body as Any).tiers[0].available).toBe(10);
  });

  // @covers box-office:SCN-003
  it("settles every Order and Waitlist entry of a cancelled Event and reports the refund", () => {
    const { store, org, c3, c4, ev, paid, held } = withOrders();
    const res = cancelEvent(byId("POST", "/cancel", ev.id, org.id), store);
    expect(res.status).toBe(200);
    expect((res.body as Any).status).toBe("cancelled");

    const page = listEvents(req("GET", "/events"), store).body as Any;
    expect(page.items.map((e: Any) => e.id)).not.toContain(ev.id);
    const again = getEvent(byId("GET", "", ev.id, null), store);
    expect(again.status).toBe(200);
    expect((again.body as Any).status).toBe("cancelled");

    expect(store.getOrder(paid.id)?.status).toBe("refunded");
    expect(store.getOrder(held.id)?.status).toBe("cancelled");
    expect(store.listWaitlistByCustomer(c3.id)).toEqual([]);
    expect(store.listWaitlistByCustomer(c4.id)).toEqual([]);
    expect(store.listOrdersByCustomer(c3.id)).toEqual([]);
    expect(store.listOrdersByCustomer(c4.id)).toEqual([]);

    const report = getEventReport(byId("GET", "/report", ev.id, org.id), store).body as Any;
    expect(report.refundedCents).toBe(1500);
    expect(report.tiers[0].held).toBe(0);

    const err = errorOf(() => cancelEvent(byId("POST", "/cancel", ev.id, org.id), store));
    expect(err).toMatchObject({ code: "E_EVENT_CANCELLED", status: 409 });
  });

  it("cancels an Event with only held Orders and restores every tier's available", () => {
    const { store, account } = setup();
    const org = account("organizer");
    const c1 = account("customer");
    const ev = mkEvent(store, org.id);
    const held = store.holdOrder({ eventId: ev.id, customerId: c1.id, items: [{ tierId: ev.tiers[0]!.id, quantity: 3 }], discountCode: null });
    const res = cancelEvent(byId("POST", "/cancel", ev.id, org.id), store);
    expect(res.status).toBe(200);
    expect(store.getOrder(held.id)?.status).toBe("cancelled");
    expect(store.getEvent(ev.id)?.tiers[0]?.available).toBe(10);
  });

  // @covers box-office:BEH-013
  it("answers 404 for an unknown id before ownership, 403 for another organizer or a customer, 409 for a cancelled Event", () => {
    const { store, account } = setup();
    const owner = account("organizer");
    const other = account("organizer");
    const cust = account("customer");
    const ev = mkEvent(store, owner.id);

    expect(errorOf(() => cancelEvent(byId("POST", "/cancel", "no-such-event", owner.id), store))).toMatchObject({ code: "E_NOT_FOUND", status: 404 });
    expect(errorOf(() => cancelEvent(byId("POST", "/cancel", "no-such-event", other.id), store))).toMatchObject({ code: "E_NOT_FOUND", status: 404 });
    expect(errorOf(() => cancelEvent(byId("POST", "/cancel", ev.id, other.id), store))).toMatchObject({ code: "E_FORBIDDEN", status: 403 });
    expect(errorOf(() => cancelEvent(byId("POST", "/cancel", ev.id, cust.id), store))).toMatchObject({ code: "E_FORBIDDEN", status: 403 });
    expect(store.getEvent(ev.id)?.status).toBe("on_sale");

    expect(cancelEvent(byId("POST", "/cancel", ev.id, owner.id), store).status).toBe(200);
    expect(errorOf(() => cancelEvent(byId("POST", "/cancel", ev.id, owner.id), store))).toMatchObject({ code: "E_EVENT_CANCELLED", status: 409 });
    expect(errorOf(() => cancelEvent(byId("POST", "/cancel", ev.id, other.id), store))).toMatchObject({ code: "E_FORBIDDEN", status: 403 });
  });

  // @covers box-office:CTR-007
  it("returns the cancelled Event with its id and tiers unchanged", () => {
    const { store, account } = setup();
    const org = account("organizer");
    const ev = mkEvent(store, org.id);
    const res = cancelEvent(byId("POST", "/cancel", ev.id, org.id), store);
    const body = res.body as Any;
    expect(res.status).toBe(200);
    expect(body.status).toBe("cancelled");
    expect(body.id).toBe(ev.id);
    expect(body.tiers).toEqual(ev.tiers);
  });
});

describe("events: getEventReport", () => {
  function reportFixture() {
    const { store, account } = setup();
    const org = account("organizer");
    const c1 = account("customer");
    const c2 = account("customer");
    const ev = mkEvent(store, org.id, {
      tiers: [
        { name: "A", priceCents: 1000, quantity: 10 },
        { name: "B", priceCents: 500, quantity: 10 },
      ],
    });
    return { store, org, c1, c2, ev, a: ev.tiers[0]!.id, b: ev.tiers[1]!.id, account };
  }

  // @covers box-office:BEH-029
  it("counts sold in paid Orders only and sums a discounted paid Order into gross, discount and net", () => {
    const { store, org, c1, c2, ev, a, b } = reportFixture();
    store.createDiscountCode(ev.id, { code: "SAVE20", percentOff: 20, amountOffCents: null, maxUses: null, expiresAtMs: null });
    const paid = store.holdOrder({ eventId: ev.id, customerId: c1.id, items: [{ tierId: a, quantity: 2 }], discountCode: "SAVE20" });
    store.markPaid(paid.id);
    store.holdOrder({ eventId: ev.id, customerId: c2.id, items: [{ tierId: b, quantity: 1 }], discountCode: null });
    const res = getEventReport(byId("GET", "/report", ev.id, org.id), store);
    const body = res.body as Any;
    expect(res.status).toBe(200);
    expect(body.eventId).toBe(ev.id);
    expect(body.tiers).toEqual([
      { tierId: a, name: "A", sold: 2, held: 0, available: 8 },
      { tierId: b, name: "B", sold: 0, held: 1, available: 9 },
    ]);
    expect(body.grossCents).toBe(2000);
    expect(body.discountCents).toBe(400);
    expect(body.netCents).toBe(1600);
    expect(body.refundedCents).toBe(0);
  });

  it("counts a held Order of 3 tickets as held and not sold, with all sums 0", () => {
    const { store, org, c1, ev, a } = reportFixture();
    store.holdOrder({ eventId: ev.id, customerId: c1.id, items: [{ tierId: a, quantity: 3 }], discountCode: null });
    const body = getEventReport(byId("GET", "/report", ev.id, org.id), store).body as Any;
    expect(body.tiers[0]).toEqual({ tierId: a, name: "A", sold: 0, held: 3, available: 7 });
    expect([body.grossCents, body.discountCents, body.refundedCents, body.netCents]).toEqual([0, 0, 0, 0]);
  });

  // @covers box-office:CTR-015
  it("keeps refunded Orders out of grossCents and netCents and sums them in refundedCents", () => {
    const { store, org, c1, c2, ev, a, account } = reportFixture();
    const c3 = account("customer");
    const paid = store.holdOrder({ eventId: ev.id, customerId: c1.id, items: [{ tierId: a, quantity: 1 }], discountCode: null });
    store.markPaid(paid.id);
    const refunded = store.holdOrder({ eventId: ev.id, customerId: c2.id, items: [{ tierId: a, quantity: 1 }], discountCode: null });
    store.markPaid(refunded.id);
    store.releaseOrder(refunded.id, "refunded");
    store.holdOrder({ eventId: ev.id, customerId: c3.id, items: [{ tierId: a, quantity: 1 }], discountCode: null });
    const res = getEventReport(byId("GET", "/report", ev.id, org.id), store);
    const body = res.body as Any;
    expect(res.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(["discountCents", "eventId", "grossCents", "netCents", "refundedCents", "tiers"]);
    expect(Object.keys(body.tiers[0]).sort()).toEqual(["available", "held", "name", "sold", "tierId"]);
    expect(body.tiers[0]).toMatchObject({ sold: 1, held: 1, available: 8 });
    expect(body.grossCents).toBe(1000);
    expect(body.discountCents).toBe(0);
    expect(body.refundedCents).toBe(1000);
    expect(body.netCents).toBe(1000);
  });

  it("answers 404 for an unknown Event and 403 for another organizer or a customer", () => {
    const { store, org, c1, ev, account } = reportFixture();
    const other = account("organizer");
    expect(errorOf(() => getEventReport(byId("GET", "/report", "no-such-event", org.id), store))).toMatchObject({ code: "E_NOT_FOUND", status: 404 });
    expect(errorOf(() => getEventReport(byId("GET", "/report", "no-such-event", other.id), store))).toMatchObject({ code: "E_NOT_FOUND", status: 404 });
    expect(errorOf(() => getEventReport(byId("GET", "/report", ev.id, other.id), store))).toMatchObject({ code: "E_FORBIDDEN", status: 403 });
    expect(errorOf(() => getEventReport(byId("GET", "/report", ev.id, c1.id), store))).toMatchObject({ code: "E_FORBIDDEN", status: 403 });
  });
});

describe("events: money as integer cents", () => {
  // @covers box-office:INV-002
  it("returns priceCents 0 and an empty report as integers and rejects priceCents 15.5", () => {
    const { store, account } = setup();
    const org = account("organizer");
    const created = createEvent(
      post(org.id, validBody({ tiers: [{ name: "Free", priceCents: 0, quantity: 3 }] })),
      store,
    );
    expect(created.status).toBe(201);
    const ev = created.body as Any;
    expect(ev.tiers[0].priceCents).toBe(0);
    expect(Number.isInteger(ev.tiers[0].priceCents)).toBe(true);
    expect(Number.isInteger(ev.tiers[0].available)).toBe(true);
    const fetched = getEvent(byId("GET", "", ev.id, null), store).body as Any;
    expect(fetched.tiers[0].priceCents).toBe(0);

    const report = getEventReport(byId("GET", "/report", ev.id, org.id), store).body as Any;
    for (const k of ["grossCents", "discountCents", "refundedCents", "netCents"]) {
      expect(report[k]).toBe(0);
      expect(Number.isInteger(report[k])).toBe(true);
    }

    const err = errorOf(() =>
      createEvent(post(org.id, validBody({ tiers: [{ name: "Frac", priceCents: 15.5, quantity: 1 }] })), store),
    );
    expect(err).toMatchObject({ code: "E_INVALID_INPUT", status: 400 });
  });
});
