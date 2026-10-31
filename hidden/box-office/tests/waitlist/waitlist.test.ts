import type { HttpRequest } from "../../src/core/index.js";
import { describe, expect, it } from "vitest";
import { joinWaitlist } from "../../src/waitlist/index.js";
import { createStore } from "../../src/store/index.js";
import type { Store } from "../../src/store/index.js";

interface Outcome {
  status: number;
  code: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

function attempt(fn: () => { status: number; body: unknown }): Outcome {
  try {
    const r = fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = r.body as any;
    const code = r.status >= 400 && b && typeof b.error === "string" ? String(b.error).split(":")[0] : null;
    return { status: r.status, code, body: b };
  } catch (e) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = e as any;
    if (err && typeof err === "object" && typeof err.code === "string" && typeof err.status === "number") {
      return { status: err.status, code: err.code, body: null };
    }
    throw e;
  }
}

function join(store: Store, customerId: string, eventId: string, body: unknown): Outcome {
  const req: HttpRequest = {
    method: "POST",
    path: `/events/${eventId}/waitlist`,
    params: { id: eventId },
    query: new URLSearchParams(),
    body,
    caller: { id: customerId },
  };
  return attempt(() => joinWaitlist(req, store));
}

function setup(tierQuantity: number, sold: number) {
  const store = createStore({ holdSeconds: 600 });
  const org = store.createAccount({ email: "org@example.com", password: "password1", name: "Org", role: "organizer" });
  const c1 = store.createAccount({ email: "c1@example.com", password: "password1", name: "C1", role: "customer" });
  const c2 = store.createAccount({ email: "c2@example.com", password: "password1", name: "C2", role: "customer" });
  const filler = store.createAccount({ email: "f@example.com", password: "password1", name: "F", role: "customer" });
  const event = store.createEvent({
    title: "Show",
    venue: "Hall",
    startsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    organizerId: org.id,
    tiers: [{ name: "GA", priceCents: 1000, quantity: tierQuantity }],
  });
  const tierId = event.tiers[0]!.id;
  if (sold > 0) {
    store.holdOrder({ eventId: event.id, customerId: filler.id, items: [{ tierId, quantity: sold }], discountCode: null });
  }
  return { store, org, c1, c2, event, tierId };
}

describe("waitlist entry joining", () => {
  // @covers box-office:BEH-026
  it("queues a customer only on a shortfall, numbers positions from 1 and answers 409 for a second entry of the same tier", () => {
    const { store, c1, c2, event, tierId } = setup(3, 3);
    const first = join(store, c1.id, event.id, { tierId, quantity: 2 });
    expect(first.status).toBe(201);
    expect(Object.keys(first.body).sort()).toEqual(["eventId", "id", "position", "quantity", "tierId"]);
    expect(first.body.eventId).toBe(event.id);
    expect(first.body.tierId).toBe(tierId);
    expect(first.body.quantity).toBe(2);
    expect(first.body.position).toBe(1);
    expect(typeof first.body.id).toBe("string");

    const second = join(store, c2.id, event.id, { tierId, quantity: 1 });
    expect(second.status).toBe(201);
    expect(second.body.position).toBe(2);

    const again = join(store, c1.id, event.id, { tierId, quantity: 1 });
    expect(again.status).toBe(409);
    expect(again.code).toBe("E_ALREADY_WAITING");

    expect(store.getEvent(event.id)!.tiers[0]!.available).toBe(0);
  });

  it.each([1, 6])("accepts the boundary quantity %i on a tier with available 0", (quantity) => {
    const { store, c1, event, tierId } = setup(10, 10);
    const r = join(store, c1.id, event.id, { tierId, quantity });
    expect(r.status).toBe(201);
    expect(r.body.quantity).toBe(quantity);
    expect(r.body.position).toBe(1);
  });

  it("accepts quantity 2 on a tier with available 1, one below the quantity", () => {
    const { store, c1, event, tierId } = setup(3, 2);
    const r = join(store, c1.id, event.id, { tierId, quantity: 2 });
    expect(r.status).toBe(201);
    expect(r.body.position).toBe(1);
    expect(store.getEvent(event.id)!.tiers[0]!.available).toBe(1);
  });

  it.each([
    ["7", 7],
    ["0", 0],
    ["-1", -1],
    ["1.5", 1.5],
    ["a string", "2"],
    ["null", null],
  ])("answers 400 E_INVALID_INPUT for quantity %s", (_label, quantity) => {
    const { store, c1, event, tierId } = setup(10, 10);
    const r = join(store, c1.id, event.id, { tierId, quantity });
    expect(r.status).toBe(400);
    expect(r.code).toBe("E_INVALID_INPUT");
  });

  it("answers 400 E_INVALID_INPUT when tierId is missing", () => {
    const { store, c1, event } = setup(10, 10);
    const r = join(store, c1.id, event.id, { quantity: 1 });
    expect(r.status).toBe(400);
    expect(r.code).toBe("E_INVALID_INPUT");
  });

  it.each([
    ["available equal to the quantity", 4, 2, 2],
    ["available above the quantity", 10, 0, 2],
  ])("answers 409 E_TICKETS_AVAILABLE with %s", (_label, tierQuantity, sold, quantity) => {
    const { store, c1, event, tierId } = setup(tierQuantity, sold);
    const r = join(store, c1.id, event.id, { tierId, quantity });
    expect(r.status).toBe(409);
    expect(r.code).toBe("E_TICKETS_AVAILABLE");
  });

  it("answers 404 E_NOT_FOUND for an unknown event", () => {
    const { store, c1, tierId } = setup(10, 10);
    const r = join(store, c1.id, "no-such-event", { tierId, quantity: 1 });
    expect(r.status).toBe(404);
    expect(r.code).toBe("E_NOT_FOUND");
  });

  it("answers 400 E_INVALID_TIER for a tierId of another event", () => {
    const a = setup(10, 10);
    const org2 = a.store.createAccount({ email: "o2@example.com", password: "password1", name: "O2", role: "organizer" });
    const other = a.store.createEvent({
      title: "Other",
      venue: "Hall",
      startsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      organizerId: org2.id,
      tiers: [{ name: "GA", priceCents: 500, quantity: 5 }],
    });
    const r = join(a.store, a.c1.id, a.event.id, { tierId: other.tiers[0]!.id, quantity: 1 });
    expect(r.status).toBe(400);
    expect(r.code).toBe("E_INVALID_TIER");
  });
});
