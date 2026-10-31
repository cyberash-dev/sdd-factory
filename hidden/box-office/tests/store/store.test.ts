import { describe, expect, it } from "vitest";
import { createStore } from "../../src/store/index.js";
import type { Event, Order, Store } from "../../src/store/index.js";

const T0 = Date.parse("2026-01-01T00:00:00.000Z");

function setup(holdSeconds = 600) {
  let t = T0;
  const s = createStore({ holdSeconds, now: () => t });
  const advance = (ms: number) => {
    t += ms;
    s.reconcile();
  };
  return { s, advance };
}

function organizer(s: Store) {
  return s.createAccount({ email: "org@example.com", password: "password1", name: "Org", role: "organizer" });
}

function customer(s: Store, n: number) {
  return s.createAccount({ email: `c${n}@example.com`, password: "password1", name: `C${n}`, role: "customer" });
}

function makeEvent(s: Store, tiers: { name: string; priceCents: number; quantity: number }[]): Event {
  const org = s.findAccountByEmail("org@example.com") ?? organizer(s);
  return s.createEvent({
    title: "Show",
    venue: "Hall",
    startsAt: "2030-01-01T20:00:00.000Z",
    organizerId: org.id,
    tiers,
  });
}

function hold(s: Store, ev: Event, customerId: string, quantity: number, discountCode: string | null = null, tierIndex = 0): Order {
  return s.holdOrder({
    eventId: ev.id,
    customerId,
    items: [{ tierId: ev.tiers[tierIndex]!.id, quantity }],
    discountCode,
  });
}

function available(s: Store, ev: Event, tierIndex = 0): number {
  return s.getEvent(ev.id)!.tiers[tierIndex]!.available;
}

function ticketsOf(orders: Order[], status: Order["status"]): number {
  return orders
    .filter((o) => o.status === status)
    .reduce((n, o) => n + o.items.reduce((m, i) => m + i.quantity, 0), 0);
}

describe("in-memory state", () => {
  // @covers box-office:CST-001
  it("an Account and an Event created in one call are visible to the next call of the same store", () => {
    const { s } = setup();
    const org = organizer(s);
    const ev = makeEvent(s, [{ name: "GA", priceCents: 1000, quantity: 5 }]);
    expect(s.findAccountById(org.id)).toEqual(org);
    expect(s.findAccountByEmail("org@example.com")).toEqual(org);
    expect(s.getEvent(ev.id)).toEqual(ev);
    expect(s.getEvent(ev.id)!.title).toBe("Show");
  });

  it("a second store of the same process starts empty", () => {
    const a = setup();
    const ev = makeEvent(a.s, [{ name: "GA", priceCents: 1000, quantity: 5 }]);
    const b = setup();
    expect(b.s.getEvent(ev.id)).toBeUndefined();
    expect(b.s.findAccountByEmail("org@example.com")).toBeUndefined();
  });
});

describe("hold lifetime", () => {
  // @covers box-office:CST-004
  it.each([
    [600, 600_000],
    [2, 2_000],
    [0, 0],
  ])("HOLD_SECONDS %i sets expiresAt to createdAt plus %i ms", (holdSeconds, ms) => {
    const { s } = setup(holdSeconds);
    const c = customer(s, 1);
    const ev = makeEvent(s, [{ name: "GA", priceCents: 1000, quantity: 5 }]);
    const o = hold(s, ev, c.id, 1);
    expect(Date.parse(o.expiresAt) - Date.parse(o.createdAt)).toBe(ms);
  });
});

describe("ids", () => {
  // @covers box-office:INV-003
  it("ids of Accounts, Events, Tiers, Orders and Waitlist entries are distinct strings", () => {
    const { s } = setup();
    const c1 = customer(s, 1);
    const c2 = customer(s, 2);
    const org = organizer(s);
    const e1 = makeEvent(s, [
      { name: "A", priceCents: 1000, quantity: 1 },
      { name: "B", priceCents: 2000, quantity: 3 },
    ]);
    const e2 = makeEvent(s, [
      { name: "A", priceCents: 1000, quantity: 3 },
      { name: "B", priceCents: 2000, quantity: 3 },
    ]);
    const o = hold(s, e1, c1.id, 1);
    const w = s.joinWaitlist({ eventId: e1.id, tierId: e1.tiers[0]!.id, customerId: c2.id, quantity: 1 });
    const ids = [
      c1.id, c2.id, org.id, e1.id, e2.id,
      ...e1.tiers.map((t) => t.id),
      ...e2.tiers.map((t) => t.id),
      o.id, w.id,
    ];
    for (const id of ids) expect(typeof id).toBe("string");
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(11);
  });

  it("a single Event with one Tier hands out string ids", () => {
    const { s } = setup();
    const ev = makeEvent(s, [{ name: "GA", priceCents: 1000, quantity: 1 }]);
    expect(typeof ev.id).toBe("string");
    expect(typeof ev.tiers[0]!.id).toBe("string");
    expect(ev.id).not.toBe(ev.tiers[0]!.id);
  });
});

describe("available", () => {
  // @covers box-office:INV-005
  it("available equals quantity minus held and paid tickets after every state change", () => {
    const { s } = setup();
    const c1 = customer(s, 1);
    const ev = makeEvent(s, [
      { name: "A", priceCents: 1000, quantity: 10 },
      { name: "B", priceCents: 2000, quantity: 4 },
      { name: "C", priceCents: 3000, quantity: 6 },
    ]);
    expect(ev.tiers.map((t) => t.available)).toEqual([10, 4, 6]);
    const o1 = hold(s, ev, c1.id, 3);
    expect(available(s, ev)).toBe(7);
    expect(s.availableTickets(ev.id, ev.tiers[0]!.id)).toBe(7);
    const o2 = hold(s, ev, c1.id, 2);
    expect(available(s, ev)).toBe(5);
    s.markPaid(o1.id);
    expect(available(s, ev)).toBe(5);
    s.releaseOrder(o1.id, "refunded");
    expect(available(s, ev)).toBe(8);
    s.releaseOrder(o2.id, "cancelled");
    expect(available(s, ev)).toBe(10);
    expect(available(s, ev, 1)).toBe(4);
  });

  it("a fully held Tier reports available 0", () => {
    const { s } = setup();
    const c1 = customer(s, 1);
    const ev = makeEvent(s, [{ name: "A", priceCents: 1000, quantity: 4 }]);
    hold(s, ev, c1.id, 4);
    expect(available(s, ev)).toBe(0);
    expect(s.availableTickets(ev.id, ev.tiers[0]!.id)).toBe(0);
  });

  it("a paid Order keeps its tickets out of available", () => {
    const { s } = setup();
    const c1 = customer(s, 1);
    const ev = makeEvent(s, [{ name: "A", priceCents: 1000, quantity: 4 }]);
    const o = hold(s, ev, c1.id, 3);
    const paid = s.markPaid(o.id);
    expect(paid.status).toBe("paid");
    expect(available(s, ev)).toBe(1);
  });

  it("a refunded Order is counted in neither held nor paid", () => {
    const { s } = setup();
    const c1 = customer(s, 1);
    const ev = makeEvent(s, [{ name: "A", priceCents: 1000, quantity: 4 }]);
    const o = hold(s, ev, c1.id, 3);
    s.markPaid(o.id);
    const r = s.releaseOrder(o.id, "refunded");
    expect(r.status).toBe("refunded");
    expect(available(s, ev)).toBe(4);
  });

  it("freed tickets read available 0 while a waitlist Order holds them", () => {
    const { s, advance } = setup(5);
    const c1 = customer(s, 1);
    const c2 = customer(s, 2);
    const ev = makeEvent(s, [{ name: "A", priceCents: 1000, quantity: 3 }]);
    hold(s, ev, c1.id, 3);
    s.joinWaitlist({ eventId: ev.id, tierId: ev.tiers[0]!.id, customerId: c2.id, quantity: 3 });
    advance(6_000);
    expect(available(s, ev)).toBe(0);
    expect(ticketsOf(s.listOrdersByCustomer(c2.id), "held")).toBe(3);
  });
});

describe("expired holds", () => {
  // @covers box-office:INV-007
  it("an Order past expiresAt reads expired on every surface and a paid Order stays paid", () => {
    const { s, advance } = setup(5);
    const c1 = customer(s, 1);
    const ev = makeEvent(s, [{ name: "A", priceCents: 1000, quantity: 4 }]);
    const heldOne = hold(s, ev, c1.id, 1);
    const toPay = hold(s, ev, c1.id, 2);
    s.markPaid(toPay.id);
    advance(4_000);
    expect(s.getOrder(heldOne.id)!.status).toBe("held");
    advance(2_000);
    expect(s.getOrder(heldOne.id)!.status).toBe("expired");
    expect(s.listOrdersByCustomer(c1.id).find((o) => o.id === heldOne.id)!.status).toBe("expired");
    expect(s.getOrder(toPay.id)!.status).toBe("paid");
    expect(s.listOrdersByCustomer(c1.id).find((o) => o.id === toPay.id)!.status).toBe("paid");
    expect(available(s, ev)).toBe(2);
  });

  it("an expired Order whose tickets a waitlist entry takes is counted once", () => {
    const { s, advance } = setup(1);
    const c1 = customer(s, 1);
    const c2 = customer(s, 2);
    const ev = makeEvent(s, [{ name: "A", priceCents: 1000, quantity: 1 }]);
    const o = hold(s, ev, c1.id, 1);
    s.joinWaitlist({ eventId: ev.id, tierId: ev.tiers[0]!.id, customerId: c2.id, quantity: 1 });
    advance(2_000);
    expect(s.getOrder(o.id)!.status).toBe("expired");
    expect(ticketsOf(s.listOrdersByCustomer(c2.id), "held")).toBe(1);
    expect(available(s, ev)).toBe(0);
  });
});

describe("expiry reads", () => {
  // @covers box-office:BEH-018
  it("a held Order one second past expiresAt is expired and its tickets are free", () => {
    const { s, advance } = setup(5);
    const c1 = customer(s, 1);
    const ev = makeEvent(s, [{ name: "A", priceCents: 1000, quantity: 3 }]);
    const o = hold(s, ev, c1.id, 2);
    expect(available(s, ev)).toBe(1);
    advance(5_000 + 1_000);
    expect(s.getOrder(o.id)!.status).toBe("expired");
    expect(s.listOrdersByCustomer(c1.id)[0]!.status).toBe("expired");
    expect(available(s, ev)).toBe(3);
    expect(s.availableTickets(ev.id, ev.tiers[0]!.id)).toBe(3);
  });

  it("a held Order one second before expiresAt reads held", () => {
    const { s, advance } = setup(5);
    const c1 = customer(s, 1);
    const ev = makeEvent(s, [{ name: "A", priceCents: 1000, quantity: 3 }]);
    const o = hold(s, ev, c1.id, 2);
    advance(4_000);
    const read = s.getOrder(o.id)!;
    expect(read.status).toBe("held");
    expect(read.items).toEqual([{ tierId: ev.tiers[0]!.id, quantity: 2, unitPriceCents: 1000 }]);
    expect(available(s, ev)).toBe(1);
  });

  it("a paid Order past its former expiresAt reads paid", () => {
    const { s, advance } = setup(5);
    const c1 = customer(s, 1);
    const ev = makeEvent(s, [{ name: "A", priceCents: 1000, quantity: 3 }]);
    const o = hold(s, ev, c1.id, 2);
    s.markPaid(o.id);
    advance(60_000);
    expect(s.getOrder(o.id)!.status).toBe("paid");
    expect(s.listOrdersByCustomer(c1.id)[0]!.status).toBe("paid");
    expect(available(s, ev)).toBe(1);
  });

  it("an Event with no Orders reports every Tier available equal to quantity", () => {
    const { s, advance } = setup(5);
    const ev = makeEvent(s, [
      { name: "A", priceCents: 1000, quantity: 3 },
      { name: "B", priceCents: 1000, quantity: 7 },
    ]);
    advance(60_000);
    expect(s.getEvent(ev.id)!.tiers.map((t) => t.available)).toEqual([3, 7]);
  });
});

describe("waitlist serving", () => {
  // @covers box-office:BEH-027
  it("the first entry that fits receives a held Order at the Tier price with no discount code", () => {
    const { s, advance } = setup(1);
    const c0 = customer(s, 0);
    const c1 = customer(s, 1);
    const ev = makeEvent(s, [{ name: "A", priceCents: 1200, quantity: 1 }]);
    hold(s, ev, c0.id, 1);
    s.joinWaitlist({ eventId: ev.id, tierId: ev.tiers[0]!.id, customerId: c1.id, quantity: 1 });
    advance(2_000);
    const orders = s.listOrdersByCustomer(c1.id);
    expect(orders).toHaveLength(1);
    const o = orders[0]!;
    expect(o.status).toBe("held");
    expect(o.items).toEqual([{ tierId: ev.tiers[0]!.id, quantity: 1, unitPriceCents: 1200 }]);
    expect(o.discountCode).toBeNull();
    expect(o.discountCents).toBe(0);
    expect(o.totalCents).toBe(1200);
    expect(o.paidAt).toBeNull();
    expect(Date.parse(o.expiresAt) - Date.parse(o.createdAt)).toBe(1_000);
    expect(s.listWaitlistByCustomer(c1.id)).toEqual([]);
    expect(s.findWaitlistEntry(c1.id, ev.tiers[0]!.id)).toBeUndefined();
    expect(available(s, ev)).toBe(0);
  });

  it("a later entry is never served while the first entry does not fit", () => {
    const { s } = setup();
    const big = customer(s, 1);
    const small = customer(s, 2);
    const c1 = customer(s, 3);
    const c2 = customer(s, 4);
    const ev = makeEvent(s, [{ name: "A", priceCents: 1000, quantity: 4 }]);
    const tierId = ev.tiers[0]!.id;
    hold(s, ev, big.id, 3);
    const smallOrder = hold(s, ev, small.id, 1);
    s.joinWaitlist({ eventId: ev.id, tierId, customerId: c1.id, quantity: 3 });
    s.joinWaitlist({ eventId: ev.id, tierId, customerId: c2.id, quantity: 1 });
    s.releaseOrder(smallOrder.id, "cancelled");
    expect(available(s, ev)).toBe(1);
    expect(s.listOrdersByCustomer(c1.id)).toEqual([]);
    expect(s.listOrdersByCustomer(c2.id)).toEqual([]);
    expect(s.listWaitlistByCustomer(c1.id)).toHaveLength(1);
    expect(s.listWaitlistByCustomer(c2.id)).toHaveLength(1);
  });

  it("several entries that fit in sequence are served in queue order", () => {
    const { s } = setup();
    const c0 = customer(s, 0);
    const [c1, c2, c3] = [customer(s, 1), customer(s, 2), customer(s, 3)];
    const ev = makeEvent(s, [{ name: "A", priceCents: 1000, quantity: 4 }]);
    const tierId = ev.tiers[0]!.id;
    const o = hold(s, ev, c0.id, 4);
    s.joinWaitlist({ eventId: ev.id, tierId, customerId: c1.id, quantity: 1 });
    s.joinWaitlist({ eventId: ev.id, tierId, customerId: c2.id, quantity: 2 });
    s.joinWaitlist({ eventId: ev.id, tierId, customerId: c3.id, quantity: 2 });
    s.releaseOrder(o.id, "cancelled");
    expect(ticketsOf(s.listOrdersByCustomer(c1.id), "held")).toBe(1);
    expect(ticketsOf(s.listOrdersByCustomer(c2.id), "held")).toBe(2);
    expect(s.listOrdersByCustomer(c3.id)).toEqual([]);
    expect(s.listWaitlistByCustomer(c3.id)).toHaveLength(1);
    expect(available(s, ev)).toBe(1);
  });

  it("a refund frees tickets for the first entry", () => {
    const { s } = setup();
    const c0 = customer(s, 0);
    const c1 = customer(s, 1);
    const ev = makeEvent(s, [{ name: "A", priceCents: 1000, quantity: 2 }]);
    const o = hold(s, ev, c0.id, 2);
    s.markPaid(o.id);
    s.joinWaitlist({ eventId: ev.id, tierId: ev.tiers[0]!.id, customerId: c1.id, quantity: 2 });
    s.releaseOrder(o.id, "refunded");
    expect(ticketsOf(s.listOrdersByCustomer(c1.id), "held")).toBe(2);
    expect(available(s, ev)).toBe(0);
  });

  it("no Order is created when no tickets were freed", () => {
    const { s, advance } = setup();
    const c0 = customer(s, 0);
    const c1 = customer(s, 1);
    const ev = makeEvent(s, [{ name: "A", priceCents: 1000, quantity: 2 }]);
    hold(s, ev, c0.id, 2);
    s.joinWaitlist({ eventId: ev.id, tierId: ev.tiers[0]!.id, customerId: c1.id, quantity: 1 });
    advance(1_000);
    expect(s.listOrdersByCustomer(c1.id)).toEqual([]);
    expect(available(s, ev)).toBe(0);
    expect(s.listWaitlistByCustomer(c1.id)).toHaveLength(1);
  });
});

describe("ticket limit in serving", () => {
  // @covers box-office:BEH-028
  it("an entry that would pass six tickets is removed without an Order and the next entry is served", () => {
    const { s } = setup();
    const c0 = customer(s, 0);
    const c1 = customer(s, 1);
    const c2 = customer(s, 2);
    const ev = makeEvent(s, [{ name: "A", priceCents: 1000, quantity: 7 }]);
    const tierId = ev.tiers[0]!.id;
    hold(s, ev, c1.id, 5);
    const other = hold(s, ev, c0.id, 2);
    s.joinWaitlist({ eventId: ev.id, tierId, customerId: c1.id, quantity: 2 });
    s.joinWaitlist({ eventId: ev.id, tierId, customerId: c2.id, quantity: 1 });
    s.releaseOrder(other.id, "cancelled");
    expect(s.ticketsHeldOrPaid(c1.id, ev.id)).toBe(5);
    expect(s.listOrdersByCustomer(c1.id)).toHaveLength(1);
    expect(s.listWaitlistByCustomer(c1.id)).toEqual([]);
    expect(ticketsOf(s.listOrdersByCustomer(c2.id), "held")).toBe(1);
    expect(available(s, ev)).toBe(1);
  });

  it("an over-limit only entry leaves the freed tickets available", () => {
    const { s } = setup();
    const c0 = customer(s, 0);
    const c1 = customer(s, 1);
    const ev = makeEvent(s, [{ name: "A", priceCents: 1000, quantity: 8 }]);
    hold(s, ev, c1.id, 6);
    const other = hold(s, ev, c0.id, 2);
    s.joinWaitlist({ eventId: ev.id, tierId: ev.tiers[0]!.id, customerId: c1.id, quantity: 1 });
    s.releaseOrder(other.id, "cancelled");
    expect(s.ticketsHeldOrPaid(c1.id, ev.id)).toBe(6);
    expect(s.listOrdersByCustomer(c0.id).every((o) => o.status !== "held")).toBe(true);
    expect(s.listWaitlistByCustomer(c1.id)).toEqual([]);
    expect(available(s, ev)).toBe(2);
  });

  it("an entry reaching exactly six tickets is served", () => {
    const { s } = setup();
    const c0 = customer(s, 0);
    const c1 = customer(s, 1);
    const ev = makeEvent(s, [{ name: "A", priceCents: 1000, quantity: 6 }]);
    hold(s, ev, c1.id, 4);
    const other = hold(s, ev, c0.id, 2);
    s.joinWaitlist({ eventId: ev.id, tierId: ev.tiers[0]!.id, customerId: c1.id, quantity: 2 });
    s.releaseOrder(other.id, "cancelled");
    expect(s.ticketsHeldOrPaid(c1.id, ev.id)).toBe(6);
    expect(ticketsOf(s.listOrdersByCustomer(c1.id), "held")).toBe(6);
    expect(available(s, ev)).toBe(0);
  });
});

describe("queue order", () => {
  // @covers box-office:INV-010
  it("the first entry is served before the second when both would fit", () => {
    const { s, advance } = setup(1);
    const c0 = customer(s, 0);
    const c1 = customer(s, 1);
    const c2 = customer(s, 2);
    const ev = makeEvent(s, [{ name: "A", priceCents: 1000, quantity: 2 }]);
    const tierId = ev.tiers[0]!.id;
    hold(s, ev, c0.id, 2);
    s.joinWaitlist({ eventId: ev.id, tierId, customerId: c1.id, quantity: 2 });
    s.joinWaitlist({ eventId: ev.id, tierId, customerId: c2.id, quantity: 1 });
    advance(2_000);
    expect(ticketsOf(s.listOrdersByCustomer(c1.id), "held")).toBe(2);
    expect(s.listOrdersByCustomer(c2.id)).toEqual([]);
    expect(available(s, ev)).toBe(0);
  });

  it("the queue keeps its order across serving rounds while the first entry does not fit", () => {
    const { s } = setup();
    const c0 = customer(s, 0);
    const c1 = customer(s, 1);
    const c2 = customer(s, 2);
    const ev = makeEvent(s, [{ name: "A", priceCents: 1000, quantity: 3 }]);
    const tierId = ev.tiers[0]!.id;
    const a = hold(s, ev, c0.id, 1);
    const b = hold(s, ev, c0.id, 2);
    s.joinWaitlist({ eventId: ev.id, tierId, customerId: c1.id, quantity: 3 });
    s.joinWaitlist({ eventId: ev.id, tierId, customerId: c2.id, quantity: 1 });
    s.releaseOrder(a.id, "cancelled");
    expect(s.listOrdersByCustomer(c2.id)).toEqual([]);
    s.releaseOrder(b.id, "cancelled");
    expect(ticketsOf(s.listOrdersByCustomer(c1.id), "held")).toBe(3);
    expect(s.listOrdersByCustomer(c2.id)).toEqual([]);
    expect(s.listWaitlistByCustomer(c2.id)).toHaveLength(1);
  });

  it("a Tier with no waitlist entry gains available equal to the expired quantity", () => {
    const { s, advance } = setup(1);
    const c0 = customer(s, 0);
    const ev = makeEvent(s, [{ name: "A", priceCents: 1000, quantity: 3 }]);
    hold(s, ev, c0.id, 2);
    advance(2_000);
    expect(available(s, ev)).toBe(3);
  });
});

describe("hold expiry serves the waitlist", () => {
  // @covers box-office:SCN-001
  it("an expired hold frees its tickets and the queue serves exactly one entry", () => {
    const { s, advance } = setup(2);
    const c1 = customer(s, 1);
    const c2 = customer(s, 2);
    const c3 = customer(s, 3);
    const ev = makeEvent(s, [{ name: "A", priceCents: 4500, quantity: 2 }]);
    const tierId = ev.tiers[0]!.id;
    const o1 = hold(s, ev, c1.id, 2);
    expect(available(s, ev)).toBe(0);
    s.joinWaitlist({ eventId: ev.id, tierId, customerId: c2.id, quantity: 2 });
    s.joinWaitlist({ eventId: ev.id, tierId, customerId: c3.id, quantity: 1 });
    advance(3_000);
    expect(s.getOrder(o1.id)!.status).toBe("expired");
    const served = s.listOrdersByCustomer(c2.id);
    expect(served).toHaveLength(1);
    const o = served[0]!;
    expect(o.status).toBe("held");
    expect(o.items).toEqual([{ tierId, quantity: 2, unitPriceCents: 4500 }]);
    expect(o.discountCode).toBeNull();
    expect(Date.parse(o.expiresAt) - Date.parse(o.createdAt)).toBe(2_000);
    expect(s.listWaitlistByCustomer(c2.id)).toEqual([]);
    expect(s.listOrdersByCustomer(c3.id)).toEqual([]);
    expect(s.listWaitlistByCustomer(c3.id)).toHaveLength(1);
    expect(available(s, ev)).toBe(0);
  });

  it("an expired hold with no waitlist entry returns the tickets and creates no Order", () => {
    const { s, advance } = setup(2);
    const c1 = customer(s, 1);
    const c2 = customer(s, 2);
    const ev = makeEvent(s, [{ name: "A", priceCents: 4500, quantity: 2 }]);
    const o1 = hold(s, ev, c1.id, 2);
    advance(3_000);
    expect(s.getOrder(o1.id)!.status).toBe("expired");
    expect(available(s, ev)).toBe(2);
    expect(s.listOrdersByCustomer(c2.id)).toEqual([]);
  });
});

describe("discount codes", () => {
  // @covers box-office:INV-009
  it("a code is stored upper case, matched case-insensitively and its uses tracks held and paid Orders", () => {
    const { s, advance } = setup(2);
    const c1 = customer(s, 1);
    const ev = makeEvent(s, [{ name: "A", priceCents: 1000, quantity: 10 }]);
    const created = s.createDiscountCode(ev.id, {
      code: "earlybird",
      percentOff: 10,
      amountOffCents: null,
      maxUses: 1,
      expiresAtMs: null,
    });
    expect(created.code).toBe("EARLYBIRD");
    expect(created.uses).toBe(0);
    expect(s.findDiscountCode(ev.id, "earlybird")!.code).toBe("EARLYBIRD");
    expect(s.findDiscountCode(ev.id, "EarlyBird")!.code).toBe("EARLYBIRD");
    const o = hold(s, ev, c1.id, 2, "EarlyBird");
    expect(o.discountCode).toBe("EARLYBIRD");
    expect(o.subtotalCents).toBe(2000);
    expect(o.discountCents).toBe(200);
    expect(o.totalCents).toBe(1800);
    expect(s.findDiscountCode(ev.id, "earlybird")!.uses).toBe(1);
    s.markPaid(o.id);
    advance(10_000);
    expect(s.findDiscountCode(ev.id, "earlybird")!.uses).toBe(1);
  });

  it("an expired Order gives its use back", () => {
    const { s, advance } = setup(1);
    const c1 = customer(s, 1);
    const ev = makeEvent(s, [{ name: "A", priceCents: 1000, quantity: 10 }]);
    s.createDiscountCode(ev.id, { code: "once", percentOff: 10, amountOffCents: null, maxUses: 1, expiresAtMs: null });
    hold(s, ev, c1.id, 1, "once");
    expect(s.findDiscountCode(ev.id, "ONCE")!.uses).toBe(1);
    advance(2_000);
    expect(s.findDiscountCode(ev.id, "ONCE")!.uses).toBe(0);
  });

  it.each(["cancelled", "refunded"] as const)("a %s Order gives its use back", (status) => {
    const { s } = setup();
    const c1 = customer(s, 1);
    const ev = makeEvent(s, [{ name: "A", priceCents: 1000, quantity: 10 }]);
    s.createDiscountCode(ev.id, { code: "once", percentOff: 10, amountOffCents: null, maxUses: 1, expiresAtMs: null });
    const o = hold(s, ev, c1.id, 1, "ONCE");
    if (status === "refunded") s.markPaid(o.id);
    expect(s.findDiscountCode(ev.id, "ONCE")!.uses).toBe(1);
    s.releaseOrder(o.id, status);
    expect(s.findDiscountCode(ev.id, "ONCE")!.uses).toBe(0);
  });

  it("an Order without a discount code carries none", () => {
    const { s } = setup();
    const c1 = customer(s, 1);
    const ev = makeEvent(s, [{ name: "A", priceCents: 1000, quantity: 10 }]);
    const o = hold(s, ev, c1.id, 2);
    expect(o.discountCode).toBeNull();
    expect(o.discountCents).toBe(0);
    expect(o.totalCents).toBe(o.subtotalCents);
    expect(o.subtotalCents).toBe(2000);
  });
});

describe("discount uses over the Order lifecycle", () => {
  // @covers box-office:SCN-004
  it("uses reaches maxUses while the Order is held and falls when it expires", () => {
    const { s, advance } = setup(2);
    const c1 = customer(s, 1);
    const ev = makeEvent(s, [{ name: "A", priceCents: 1000, quantity: 10 }]);
    s.createDiscountCode(ev.id, { code: "ONCE", percentOff: 10, amountOffCents: null, maxUses: 1, expiresAtMs: null });
    expect(s.findDiscountCode(ev.id, "ONCE")!.uses).toBe(0);
    const first = hold(s, ev, c1.id, 1, "ONCE");
    expect(first.discountCode).toBe("ONCE");
    expect(first.discountCents).toBe(100);
    const code = s.findDiscountCode(ev.id, "ONCE")!;
    expect(code.uses).toBe(1);
    expect(code.uses).toBe(code.maxUses);
    advance(3_000);
    expect(s.getOrder(first.id)!.status).toBe("expired");
    expect(s.findDiscountCode(ev.id, "ONCE")!.uses).toBe(0);
    const third = hold(s, ev, c1.id, 1, "once");
    expect(third.discountCode).toBe("ONCE");
    expect(s.findDiscountCode(ev.id, "ONCE")!.uses).toBe(1);
  });

  it("a code of maxUses 2 counts two held Orders", () => {
    const { s } = setup();
    const c1 = customer(s, 1);
    const c2 = customer(s, 2);
    const ev = makeEvent(s, [{ name: "A", priceCents: 1000, quantity: 10 }]);
    s.createDiscountCode(ev.id, { code: "TWICE", percentOff: 10, amountOffCents: null, maxUses: 2, expiresAtMs: null });
    hold(s, ev, c1.id, 1, "TWICE");
    expect(s.findDiscountCode(ev.id, "TWICE")!.uses).toBe(1);
    hold(s, ev, c2.id, 1, "twice");
    expect(s.findDiscountCode(ev.id, "TWICE")!.uses).toBe(2);
  });

  it("a cancelled Order frees the single use for a new Order", () => {
    const { s } = setup();
    const c1 = customer(s, 1);
    const ev = makeEvent(s, [{ name: "A", priceCents: 1000, quantity: 10 }]);
    s.createDiscountCode(ev.id, { code: "ONCE", percentOff: 10, amountOffCents: null, maxUses: 1, expiresAtMs: null });
    const first = hold(s, ev, c1.id, 1, "ONCE");
    const cancelled = s.releaseOrder(first.id, "cancelled");
    expect(cancelled.status).toBe("cancelled");
    expect(s.findDiscountCode(ev.id, "ONCE")!.uses).toBe(0);
    const again = hold(s, ev, c1.id, 1, "ONCE");
    expect(again.discountCode).toBe("ONCE");
    expect(s.findDiscountCode(ev.id, "ONCE")!.uses).toBe(1);
  });
});
