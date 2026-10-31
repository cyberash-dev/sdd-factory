import { describe, it, expect, vi } from "vitest";

const D = "2026-11-02T";

async function setup() {
  vi.resetModules();
  const state = await import("../../../src/state/index.js");
  const read = await import("../../../src/bookings/read/index.js");
  return { state, read };
}

const q = (s: string) => new URLSearchParams(s);
const err = (code: string, status: number) => ({ status, body: { error: code } });

type Setup = Awaited<ReturnType<typeof setup>>;

function twoAdjacent(s: Setup) {
  s.state.addRoom("Aurora", 8);
  const b1 = s.state.addBooking("r1", "first", `${D}09:00:00Z`, `${D}10:00:00Z`, 2);
  const b2 = s.state.addBooking("r1", "second", `${D}10:00:00Z`, `${D}11:00:00Z`, 3);
  return { b1, b2 };
}

describe("booking list order and fields", () => {
  // @covers room-booking-api:BEH-013
  it("lists the Bookings of a Room by start, not by creation order, with exactly the Booking fields", async () => {
    const s = await setup();
    s.state.addRoom("Aurora", 8);
    s.state.addBooking("r1", "late", `${D}11:00:00Z`, `${D}12:00:00Z`, 2);
    s.state.addBooking("r1", "early", `${D}09:00:00Z`, `${D}10:00:00Z`, 3);
    s.state.addBooking("r1", "last", `${D}13:00:00Z`, `${D}14:00:00Z`, 4);
    const result = s.read.listBookings("r1", q(""));
    expect(result).toEqual({
      bookings: [
        { id: "b2", roomId: "r1", title: "early", start: `${D}09:00:00Z`, end: `${D}10:00:00Z`, attendees: 3 },
        { id: "b1", roomId: "r1", title: "late", start: `${D}11:00:00Z`, end: `${D}12:00:00Z`, attendees: 2 },
        { id: "b3", roomId: "r1", title: "last", start: `${D}13:00:00Z`, end: `${D}14:00:00Z`, attendees: 4 },
      ],
    });
    expect(Object.keys(result)).toEqual(["bookings"]);
    const first = (result as { bookings: object[] }).bookings[0];
    expect(Object.keys(first).sort()).toEqual(["attendees", "end", "id", "roomId", "start", "title"]);
  });

  it("answers 200-shaped empty list for an existing Room without Bookings", async () => {
    const s = await setup();
    s.state.addRoom("Aurora", 8);
    s.state.addRoom("Borealis", 4);
    s.state.addBooking("r1", "x", `${D}09:00:00Z`, `${D}10:00:00Z`, 1);
    expect(s.read.listBookings("r2", q(""))).toEqual({ bookings: [] });
  });

  it("puts the 09:00 Booking before the adjacent 10:00 Booking created first", async () => {
    const s = await setup();
    s.state.addRoom("Aurora", 8);
    s.state.addBooking("r1", "ten", `${D}10:00:00Z`, `${D}11:00:00Z`, 1);
    s.state.addBooking("r1", "nine", `${D}09:00:00Z`, `${D}10:00:00Z`, 1);
    const result = s.read.listBookings("r1", q("")) as { bookings: { title: string }[] };
    expect(result.bookings.map((b) => b.title)).toEqual(["nine", "ten"]);
  });

  it("returns start and end strings character for character in the short time spelling", async () => {
    const s = await setup();
    s.state.addRoom("Aurora", 8);
    s.state.addBooking("r1", "short", `${D}09:30Z`, `${D}10:00:00Z`, 1);
    const result = s.read.listBookings("r1", q("")) as { bookings: { start: string; end: string }[] };
    expect(result.bookings[0].start).toBe("2026-11-02T09:30Z");
    expect(result.bookings[0].end).toBe("2026-11-02T10:00:00Z");
  });
});

describe("booking list window filter", () => {
  // @covers room-booking-api:BEH-014
  it("returns only the Booking overlapping [from, to) when the next Booking starts exactly at to", async () => {
    const s = await setup();
    const { b1 } = twoAdjacent(s);
    expect(s.read.listBookings("r1", q(`from=${D}09:30:00Z&to=${D}10:00:00Z`))).toEqual({ bookings: [b1] });
  });

  it("returns the Booking starting exactly at from", async () => {
    const s = await setup();
    const { b2 } = twoAdjacent(s);
    expect(s.read.listBookings("r1", q(`from=${D}10:00:00Z&to=${D}11:00:00Z`))).toEqual({ bookings: [b2] });
  });

  it("excludes the Booking that starts exactly at to, window beginning at the first Booking start", async () => {
    const s = await setup();
    const { b1 } = twoAdjacent(s);
    expect(s.read.listBookings("r1", q(`from=${D}09:00:00Z&to=${D}10:00:00Z`))).toEqual({ bookings: [b1] });
  });

  it("excludes a Booking ending exactly at from", async () => {
    const s = await setup();
    const { b2 } = twoAdjacent(s);
    expect(s.read.listBookings("r1", q(`from=${D}10:00:00Z&to=${D}10:30:00Z`))).toEqual({ bookings: [b2] });
  });

  it("returns the Booking when the window lies inside it", async () => {
    const s = await setup();
    const { b1 } = twoAdjacent(s);
    expect(s.read.listBookings("r1", q(`from=${D}09:15:00Z&to=${D}09:45:00Z`))).toEqual({ bookings: [b1] });
  });

  it("accepts the short time spelling in the query", async () => {
    const s = await setup();
    const { b1 } = twoAdjacent(s);
    expect(s.read.listBookings("r1", q(`from=${D}09:30Z&to=${D}10:00:00Z`))).toEqual({ bookings: [b1] });
  });

  it("returns every Booking in start order when the query is absent", async () => {
    const s = await setup();
    const { b1, b2 } = twoAdjacent(s);
    expect(s.read.listBookings("r1", q(""))).toEqual({ bookings: [b1, b2] });
  });

  it("keeps the start-then-id order in a window covering both Bookings", async () => {
    const s = await setup();
    s.state.addRoom("Aurora", 8);
    const late = s.state.addBooking("r1", "late", `${D}10:00:00Z`, `${D}11:00:00Z`, 1);
    const early = s.state.addBooking("r1", "early", `${D}09:00:00Z`, `${D}10:00:00Z`, 1);
    expect(s.read.listBookings("r1", q(`from=${D}08:00:00Z&to=${D}12:00:00Z`))).toEqual({ bookings: [early, late] });
  });

  it("rejects only from with invalid_query, not a filter on one bound", async () => {
    const s = await setup();
    twoAdjacent(s);
    expect(s.read.listBookings("r1", q(`from=${D}09:30:00Z`))).toEqual(err("invalid_query", 400));
  });

  it("rejects from equal to to with invalid_query, not an empty list", async () => {
    const s = await setup();
    twoAdjacent(s);
    expect(s.read.listBookings("r1", q(`from=${D}09:00:00Z&to=${D}09:00:00Z`))).toEqual(err("invalid_query", 400));
  });
});

describe("booking list invalid query", () => {
  // @covers room-booking-api:BEH-015
  it("rejects a query holding only to with invalid_query", async () => {
    const s = await setup();
    twoAdjacent(s);
    expect(s.read.listBookings("r1", q(`to=${D}10:00:00Z`))).toEqual(err("invalid_query", 400));
  });

  it.each([
    ["only from", `from=${D}09:00:00Z`],
    ["unparseable times", "from=yesterday&to=tomorrow"],
    ["a from not on a whole minute", `from=${D}09:00:30Z&to=${D}10:00:00Z`],
    ["a to not on a whole minute", `from=${D}09:00:00Z&to=${D}10:00:30Z`],
    ["inverted bounds", `from=${D}10:00:00Z&to=${D}09:00:00Z`],
    ["a time without a date", "from=09:00:00Z&to=10:00:00Z"],
  ])("rejects %s with invalid_query", async (_name, query) => {
    const s = await setup();
    twoAdjacent(s);
    expect(s.read.listBookings("r1", q(query))).toEqual(err("invalid_query", 400));
  });

  it("answers an accepted pair with the overlapping Bookings, not invalid_query", async () => {
    const s = await setup();
    const { b1 } = twoAdjacent(s);
    expect(s.read.listBookings("r1", q(`from=${D}09:00:00Z&to=${D}09:30:00Z`))).toEqual({ bookings: [b1] });
  });
});

describe("booking list unknown Room", () => {
  // @covers room-booking-api:BEH-016
  it("rejects an unknown roomId without a query with room_not_found", async () => {
    const s = await setup();
    twoAdjacent(s);
    expect(s.read.listBookings("r99", q(""))).toEqual(err("room_not_found", 404));
  });

  it("decides invalid_query before room_not_found for an unknown roomId", async () => {
    const s = await setup();
    twoAdjacent(s);
    expect(s.read.listBookings("r99", q(`from=${D}09:00:00Z`))).toEqual(err("invalid_query", 400));
  });

  it("rejects an unknown roomId with a valid window with room_not_found", async () => {
    const s = await setup();
    twoAdjacent(s);
    expect(s.read.listBookings("r99", q(`from=${D}09:00:00Z&to=${D}10:00:00Z`))).toEqual(err("room_not_found", 404));
  });

  it("lists the Booking of an existing Room, not room_not_found", async () => {
    const s = await setup();
    s.state.addRoom("Aurora", 8);
    const b = s.state.addBooking("r1", "only", `${D}09:00:00Z`, `${D}10:00:00Z`, 1);
    expect(s.read.listBookings("r1", q(""))).toEqual({ bookings: [b] });
  });
});

describe("list-bookings contract", () => {
  // @covers room-booking-api:CTR-004
  it("answers a window with an object holding the single key bookings and only the overlapping Booking", async () => {
    const s = await setup();
    const { b1 } = twoAdjacent(s);
    const result = s.read.listBookings("r1", q(`from=${D}09:30:00Z&to=${D}10:00:00Z`));
    expect(Object.keys(result)).toEqual(["bookings"]);
    expect(result).toEqual({ bookings: [b1] });
  });

  it.each([
    ["half window", "r1", `from=${D}09:30:00Z`, err("invalid_query", 400)],
    ["unknown room", "r99", "", err("room_not_found", 404)],
  ])("answers a %s with its documented status and error body", async (_name, roomId, query, expected) => {
    const s = await setup();
    twoAdjacent(s);
    expect(s.read.listBookings(roomId, q(query))).toEqual(expected);
  });
});
