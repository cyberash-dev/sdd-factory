import { describe, expect, it, vi } from "vitest";

const S = "2026-11-02T09:00:00Z";
const E = "2026-11-02T10:00:00Z";
const INVALID = { status: 400, body: { error: "invalid_query" } };

async function load() {
  vi.resetModules();
  const state = await import("../../src/state/index.js");
  const availability = await import("../../src/availability/index.js");
  return { state, find: availability.findAvailableRooms };
}

async function seed(extra = false) {
  const { state, find } = await load();
  state.addRoom("Alpha", 4); // r1
  state.addRoom("Bravo", 8); // r2
  state.addRoom("Charlie", 4); // r3
  state.addRoom("Delta", 8); // r4
  state.addBooking("r1", "a", S, E, 2);
  state.addBooking("r4", "b", "2026-11-02T09:30:00Z", "2026-11-02T09:40:00Z", 2);
  if (extra) state.addRoom("Echo", 4); // r5
  return { state, find };
}

const q = (s: string) => new URLSearchParams(s);
const window = `start=${S}&end=${E}`;
const room = (id: string, name: string, capacity: number) => ({ id, name, capacity });
const r2 = room("r2", "Bravo", 8);
const r3 = room("r3", "Charlie", 4);
const r4 = room("r4", "Delta", 8);
const r5 = room("r5", "Echo", 4);

describe("availability: free rooms ordered by capacity then id", () => {
  // @covers room-booking-api:BEH-019
  it("returns free Rooms with capacity at least attendees ordered by capacity then id", async () => {
    const { find } = await seed();
    expect(find(q(`${window}&attendees=4`))).toEqual({ rooms: [r3, r2] });
  });

  it("returns an empty rooms array when no Room seats the attendees", async () => {
    const { find } = await seed();
    expect(find(q(`${window}&attendees=9`))).toEqual({ rooms: [] });
  });

  it("accepts a capacity exactly equal to attendees", async () => {
    const { find } = await seed();
    expect(find(q(`${window}&attendees=8`))).toEqual({ rooms: [r2] });
  });

  it("keeps a Room whose Booking only touches the window end", async () => {
    const { state, find } = await seed();
    state.addBooking("r2", "c", E, "2026-11-02T11:00:00Z", 2);
    expect(find(q(`${window}&attendees=4`))).toEqual({ rooms: [r3, r2] });
  });

  it("orders equal capacities by id", async () => {
    const { find } = await seed(true);
    expect(find(q(`${window}&attendees=4`))).toEqual({ rooms: [r3, r5, r2] });
  });

  it("excludes a Room with a Booking overlapping the window", async () => {
    const { find } = await seed();
    const result = find(q(`${window}&attendees=8`)) as { rooms: unknown[] };
    expect(result.rooms).not.toContainEqual(r4);
    expect(result).toEqual({ rooms: [r2] });
  });

  it("rejects inverted bounds with invalid_query instead of listing every Room", async () => {
    const { find } = await seed();
    expect(find(q(`start=${E}&end=${S}&attendees=4`))).toEqual(INVALID);
  });
});

describe("availability: invalid or missing parameters", () => {
  // @covers room-booking-api:BEH-020
  it("answers 400 invalid_query for each missing or invalid parameter", async () => {
    const { find } = await seed();
    const cases = [
      `end=${E}&attendees=2`,
      `start=${S}&attendees=2`,
      `${window}`,
      `${window}&attendees=`,
      `${window}&attendees=two`,
      `${window}&attendees=2.5`,
      `start=${E}&end=${S}&attendees=2`,
      `start=2026-11-02T09:00:30Z&end=${E}&attendees=2`,
      `start=${S}&end=${S}&attendees=2`,
      `start=&end=${E}&attendees=2`,
      `start=yesterday&end=${E}&attendees=2`,
      `start=2026-11-02T09:00:00%2B01:00&end=${E}&attendees=2`,
    ];
    expect.assertions(cases.length);
    for (const c of cases) expect(find(q(c))).toEqual(INVALID);
  });

  it("returns only the free Room for attendees 2", async () => {
    const { find } = await seed();
    expect(find(q(`${window}&attendees=2`))).toEqual({ rooms: [r3, r2] });
  });

  it("passes every capacity test for attendees 0 but still excludes busy Rooms", async () => {
    const { find } = await seed();
    expect(find(q(`${window}&attendees=0`))).toEqual({ rooms: [r3, r2] });
  });

  it("accepts a negative integer attendees", async () => {
    const { find } = await seed();
    expect(find(q(`${window}&attendees=-3`))).toEqual({ rooms: [r3, r2] });
  });

  it("keeps answering a valid query after an invalid one", async () => {
    const { find } = await seed();
    expect(find(q(`end=${E}&attendees=2`))).toEqual(INVALID);
    expect(find(q(`${window}&attendees=8`))).toEqual({ rooms: [r2] });
  });
});

describe("availability: contract GET /availability", () => {
  // @covers room-booking-api:CTR-006
  it("success body is an object with the single key rooms", async () => {
    const { find } = await seed();
    const result = find(q(`${window}&attendees=4`));
    expect(Object.keys(result)).toEqual(["rooms"]);
    expect(result).toEqual({ rooms: [r3, r2] });
  });

  it("accepts the minute-precision and millisecond spellings of time", async () => {
    const { find } = await seed();
    expect(find(q("start=2026-11-02T09:00Z&end=2026-11-02T10:00:00.000Z&attendees=8"))).toEqual({
      rooms: [r2],
    });
  });

  it("answers invalid_query with status 400 for a missing start", async () => {
    const { find } = await seed();
    expect(find(q(`end=${E}&attendees=4`))).toEqual({ status: 400, body: { error: "invalid_query" } });
  });

  it("answers invalid_query with status 400 for non-integer attendees four", async () => {
    const { find } = await seed();
    expect(find(q(`${window}&attendees=four`))).toEqual({ status: 400, body: { error: "invalid_query" } });
  });
});
