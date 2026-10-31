import { describe, expect, it } from "vitest";
import { createStore } from "../../../src/core/index.js";
import type { Store } from "../../../src/core/index.js";
import { handleAvailability } from "../../../src/routes/availability/index.js";
import type { ParsedBody } from "../../../src/core/index.js";

const EMPTY: ParsedBody = { kind: "empty" };
const INVALID: ParsedBody = { kind: "invalid" };

const MS_0900 = 1793610000000;
const MS_1100 = 1793617200000;

function seeded(): Store {
  const store = createStore();
  store.addRoom("Alpha", 10);
  store.addRoom("Beta", 20);
  store.addRoom("Gamma", 10);
  store.addBooking({
    roomId: "r2",
    title: "Sync",
    start: "2026-11-02T09:00:00Z",
    end: "2026-11-02T11:00:00Z",
    startMs: MS_0900,
    endMs: MS_1100,
    attendees: 2,
  });
  return store;
}

function q(start: string | null, end: string | null, attendees: string | null): URLSearchParams {
  const p = new URLSearchParams();
  if (start !== null) p.set("start", start);
  if (end !== null) p.set("end", end);
  if (attendees !== null) p.set("attendees", attendees);
  return p;
}

const T10 = "2026-11-02T10:00:00Z";
const T11 = "2026-11-02T11:00:00Z";
const T12 = "2026-11-02T12:00:00Z";

function ids(body: unknown): string[] {
  return (body as { rooms: { id: string }[] }).rooms.map((r) => r.id);
}

describe("availability list (BEH-018)", () => {
  // @covers room-booking-api:BEH-018
  it("lists free rooms r1 and r3 in order and omits r2 whose booking overlaps the availability window", () => {
    const res = handleAvailability(seeded(), q(T10, T11, "10"), EMPTY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      rooms: [
        { id: "r1", name: "Alpha", capacity: 10 },
        { id: "r3", name: "Gamma", capacity: 10 },
      ],
    });
  });

  it("treats a room as free when the availability window starts exactly at its booking end", () => {
    const res = handleAvailability(seeded(), q(T11, T12, "10"), EMPTY);
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual(["r1", "r3", "r2"]);
  });

  it("keeps a room whose capacity equals attendees", () => {
    const res = handleAvailability(seeded(), q(T11, T12, "20"), EMPTY);
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual(["r2"]);
  });

  it("answers an empty rooms array when attendees exceed every capacity", () => {
    const res = handleAvailability(seeded(), q(T10, T11, "21"), EMPTY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ rooms: [] });
  });

  it("orders by capacity ascending then id suffix, not by insertion or lexical id", () => {
    const store = createStore();
    for (let i = 0; i < 9; i++) store.addRoom(`Big ${i}`, 30);
    store.addRoom("Small", 5);
    store.addRoom("Mid", 5);
    const res = handleAvailability(store, q(T10, T11, "1"), EMPTY);
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual(["r10", "r11", "r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9"]);
  });

  it("rejects a missing end with invalid_query and no rooms array", () => {
    const res = handleAvailability(seeded(), q(T10, null, "10"), EMPTY);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_query" });
  });
});

describe("availability parameter validation (BEH-019)", () => {
  it("answers 200 with a rooms array for a complete and valid query", () => {
    const res = handleAvailability(seeded(), q(T10, T11, "2"), EMPTY);
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual(["r1", "r3"]);
  });

  // @covers room-booking-api:BEH-019
  it.each([
    ["start missing", null, T11, "2"],
    ["end missing", T10, null, "2"],
    ["attendees missing", T10, T11, null],
    ["unparseable time", "banana", T11, "2"],
    ["unparseable end", T10, "banana", "2"],
    ["time with 45 seconds", "2026-11-02T10:00:45Z", T11, "2"],
    ["end equal to start", T10, T10, "2"],
    ["end before start", T11, T10, "2"],
    ["attendees 1.5", T10, T11, "1.5"],
    ["attendees not numeric", T10, T11, "abc"],
    ["attendees empty", T10, T11, ""],
  ])("rejects %s with invalid_query and no rooms array", (_name, start, end, attendees) => {
    const res = handleAvailability(seeded(), q(start, end, attendees), EMPTY);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_query" });
  });
});

describe("GET /availability contract (CTR-006)", () => {
  it("answers 200 with rooms r1 and r2 ordered by capacity when no booking exists", () => {
    const store = createStore();
    store.addRoom("Small", 4);
    store.addRoom("Large", 10);
    const res = handleAvailability(store, q(T10, T11, "4"), EMPTY);
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual(["r1", "r2"]);
  });

  // @covers room-booking-api:CTR-006
  it("answers invalid_json for a valid query whose body is not valid JSON", () => {
    const res = handleAvailability(seeded(), q(T10, T11, "4"), INVALID);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_json" });
  });

  it("answers invalid_query before invalid_json when both apply", () => {
    const res = handleAvailability(seeded(), q(T10, null, "4"), INVALID);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_query" });
  });

  it("ignores a valid JSON body and answers 200 with a body", () => {
    const res = handleAvailability(seeded(), q(T10, T11, "10"), { kind: "value", value: { x: 1 } });
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual(["r1", "r3"]);
  });
});
