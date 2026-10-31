import { describe, expect, it } from "vitest";
import { createDiscountCode } from "../../src/discounts/index.js";
import { createStore } from "../../src/store/index.js";
import type { HttpRequest } from "../../src/core/index.js";

function setup() {
  const store = createStore({ holdSeconds: 600 });
  const org = store.createAccount({ email: "org@example.com", password: "password1", name: "Org", role: "organizer" });
  const other = store.createAccount({ email: "other@example.com", password: "password1", name: "Other", role: "organizer" });
  const event = store.createEvent({
    title: "Show",
    venue: "Hall",
    startsAt: "2030-01-01T20:00:00.000Z",
    organizerId: org.id,
    tiers: [{ name: "GA", priceCents: 1000, quantity: 10 }],
  });
  return { store, org, other, event };
}

function req(eventId: string, callerId: string, body: unknown): HttpRequest {
  return {
    method: "POST",
    path: `/events/${eventId}/discounts`,
    params: { id: eventId },
    query: new URLSearchParams(),
    body,
    caller: { id: callerId },
  };
}

function failure(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

function expectRejected(fn: () => unknown, code: string, status: number) {
  const err = failure(fn);
  expect(err).toMatchObject({ code, status });
}

describe("discount code creation for an Event", () => {
  // @covers box-office:CTR-013
  it("a valid definition answers 201 upper-cased with uses 0 and a repeat in any case answers 409 E_CODE_TAKEN", () => {
    const { store, org, event } = setup();
    const res = createDiscountCode(req(event.id, org.id, { code: "earlybird", percentOff: 25 }), store);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      code: "EARLYBIRD",
      percentOff: 25,
      amountOffCents: null,
      maxUses: null,
      expiresAt: null,
      uses: 0,
    });
    expectRejected(
      () => createDiscountCode(req(event.id, org.id, { code: "EarlyBird", percentOff: 5 }), store),
      "E_CODE_TAKEN",
      409,
    );
  });

  it("an amountOffCents code echoes maxUses and expiresAt in the millisecond Z-terminated form", () => {
    const { store, org, event } = setup();
    const res = createDiscountCode(
      req(event.id, org.id, { code: "FIVEOFF", amountOffCents: 500, maxUses: 3, expiresAt: "2027-01-01T00:00:00Z" }),
      store,
    );
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      code: "FIVEOFF",
      percentOff: null,
      amountOffCents: 500,
      maxUses: 3,
      expiresAt: "2027-01-01T00:00:00.000Z",
      uses: 0,
    });
  });

  it.each([
    ["abc", "ABC"],
    ["abcdefghij0123456789", "ABCDEFGHIJ0123456789"],
  ])("a code of %s is accepted at the length boundary and answered as %s", (code, upper) => {
    const { store, org, event } = setup();
    const res = createDiscountCode(req(event.id, org.id, { code, percentOff: 10 }), store);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ code: upper });
  });

  it("a code is stored in upper case and is found by its upper-case form", () => {
    const { store, org, event } = setup();
    createDiscountCode(req(event.id, org.id, { code: "earlybird", percentOff: 25 }), store);
    expect(store.findDiscountCode(event.id, "EARLYBIRD")?.code).toBe("EARLYBIRD");
  });

  it("the same code on a different Event is accepted", () => {
    const { store, org, event } = setup();
    const ev2 = store.createEvent({
      title: "Show 2",
      venue: "Hall",
      startsAt: "2030-02-01T20:00:00.000Z",
      organizerId: org.id,
      tiers: [{ name: "GA", priceCents: 1000, quantity: 10 }],
    });
    createDiscountCode(req(event.id, org.id, { code: "SHARED", percentOff: 5 }), store);
    const res = createDiscountCode(req(ev2.id, org.id, { code: "shared", percentOff: 5 }), store);
    expect(res.status).toBe(201);
  });

  it.each([
    [1, 201],
    [50, 201],
    [100, 201],
  ])("percentOff %i is accepted at the boundary and keeps its value", (percentOff, status) => {
    const { store, org, event } = setup();
    const res = createDiscountCode(req(event.id, org.id, { code: "HALF", percentOff }), store);
    expect(res.status).toBe(status);
    expect(res.body).toMatchObject({ percentOff, uses: 0 });
  });

  // @covers box-office:BEH-023
  it("a percentOff code with lower-case letters answers EARLYBIRD with absent optional fields null and uses 0", () => {
    const { store, org, event } = setup();
    const res = createDiscountCode(req(event.id, org.id, { code: "earlybird", percentOff: 25 }), store);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      code: "EARLYBIRD",
      percentOff: 25,
      amountOffCents: null,
      maxUses: null,
      expiresAt: null,
      uses: 0,
    });
  });

  it("an organizer who did not create the Event is answered 403 E_FORBIDDEN and nothing is stored", () => {
    const { store, other, event } = setup();
    expectRejected(
      () => createDiscountCode(req(event.id, other.id, { code: "EARLYBIRD", percentOff: 25 }), store),
      "E_FORBIDDEN",
      403,
    );
    expect(store.findDiscountCode(event.id, "EARLYBIRD")).toBeUndefined();
  });

  // @covers box-office:BEH-024
  it("both percentOff and amountOffCents answer 400 E_INVALID_INPUT and nothing is stored", () => {
    const { store, org, event } = setup();
    expectRejected(
      () => createDiscountCode(req(event.id, org.id, { code: "BOTH", percentOff: 10, amountOffCents: 500 }), store),
      "E_INVALID_INPUT",
      400,
    );
    expect(store.findDiscountCode(event.id, "BOTH")).toBeUndefined();
  });

  it.each<[string, unknown]>([
    ["neither discount field", { code: "NONE" }],
    ["percentOff 0", { code: "ZERO", percentOff: 0 }],
    ["percentOff 101", { code: "OVER", percentOff: 101 }],
    ["percentOff non-integer", { code: "FRAC", percentOff: 10.5 }],
    ["percentOff string", { code: "STR", percentOff: "10" }],
    ["amountOffCents 0", { code: "ZERO", amountOffCents: 0 }],
    ["amountOffCents non-integer", { code: "FRAC", amountOffCents: 1.5 }],
    ["code of 2 characters", { code: "ab", percentOff: 10 }],
    ["code of 21 characters", { code: "abcdefghij0123456789x", percentOff: 10 }],
    ["code with a hyphen", { code: "ab-cd", percentOff: 10 }],
    ["code missing", { percentOff: 10 }],
    ["code not a string", { code: 123, percentOff: 10 }],
    ["maxUses 0", { code: "MAXZ", percentOff: 10, maxUses: 0 }],
    ["maxUses non-integer", { code: "MAXF", percentOff: 10, maxUses: 1.5 }],
    ["expiresAt unreadable", { code: "EXPB", percentOff: 10, expiresAt: "not a time" }],
    ["body an array", [1, 2]],
    ["body a string", "text"],
  ])("%s answers 400 E_INVALID_INPUT and nothing is stored", (_name, body) => {
    const { store, org, event } = setup();
    expectRejected(() => createDiscountCode(req(event.id, org.id, body), store), "E_INVALID_INPUT", 400);
    for (const c of ["NONE", "ZERO", "OVER", "FRAC", "STR", "AB", "MAXZ", "MAXF", "EXPB", "AB-CD"]) {
      expect(store.findDiscountCode(event.id, c)).toBeUndefined();
    }
  });

  it("an unknown Event id answers 404 E_NOT_FOUND", () => {
    const { store, org } = setup();
    expectRejected(
      () => createDiscountCode(req("no-such-event", org.id, { code: "EARLYBIRD", percentOff: 25 }), store),
      "E_NOT_FOUND",
      404,
    );
  });

  it("an unknown Event id with an invalid field answers 400 E_INVALID_INPUT before 404", () => {
    const { store, org } = setup();
    expectRejected(
      () => createDiscountCode(req("no-such-event", org.id, { code: "ab", percentOff: 25 }), store),
      "E_INVALID_INPUT",
      400,
    );
  });
});

