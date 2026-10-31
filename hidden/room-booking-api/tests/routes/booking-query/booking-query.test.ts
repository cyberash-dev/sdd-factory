import { describe, expect, it } from "vitest";
import { createStore } from "../../../src/core/index.js";
import type { Booking, ParsedBody, Store } from "../../../src/core/index.js";
import { handleDeleteBooking, handleListBookings } from "../../../src/routes/booking-query/index.js";

const NO_BODY: ParsedBody = { kind: "empty" };
const BAD_BODY: ParsedBody = { kind: "invalid" };

function book(store: Store, roomId: string, start: string, end: string): Booking {
  return store.addBooking({
    roomId,
    title: "Sync",
    start,
    end,
    startMs: Date.parse(start),
    endMs: Date.parse(end),
    attendees: 1,
  });
}

function list(store: Store, roomId: string, search: string, body: ParsedBody = NO_BODY) {
  return handleListBookings(store, roomId, new URLSearchParams(search), body);
}

function ids(res: { body?: unknown }): string[] {
  return (res.body as { bookings: Booking[] }).bookings.map((b) => b.id);
}

const D = "2026-11-02T";

describe("handleListBookings: ordering", () => {
  // @covers room-booking-api:BEH-013
  it("returns the bookings of a room ordered by start then booking id", () => {
    const store = createStore();
    store.addRoom("Lab", 10);
    book(store, "r1", `${D}10:00:00Z`, `${D}11:00:00Z`);
    book(store, "r1", `${D}09:00:00Z`, `${D}09:30:00Z`);
    book(store, "r1", "2026-11-03T09:00:00Z", "2026-11-03T10:00:00Z");
    const res = list(store, "r1", "");
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual(["b2", "b1", "b3"]);
  });

  it("returns an empty bookings array for a room without bookings", () => {
    const store = createStore();
    store.addRoom("Lab", 10);
    expect(list(store, "r1", "")).toEqual({ status: 200, body: { bookings: [] } });
  });

  it("returns a single booking of the room", () => {
    const store = createStore();
    store.addRoom("Lab", 10);
    book(store, "r1", `${D}09:00:00Z`, `${D}10:00:00Z`);
    const res = list(store, "r1", "");
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual(["b1"]);
  });

  it("returns twelve hourly bookings in ascending start order from b1 to b12", () => {
    const store = createStore();
    store.addRoom("Lab", 10);
    const hours = ["08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19"];
    for (const h of hours) {
      const next = String(Number(h) + 1).padStart(2, "0");
      book(store, "r1", `${D}${h}:00:00Z`, `${D}${next}:00:00Z`);
    }
    const res = list(store, "r1", "");
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual(["b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8", "b9", "b10", "b11", "b12"]);
  });

  it("orders equal starts by the numeric booking id", () => {
    const store = createStore();
    store.addRoom("Lab", 10);
    book(store, "r1", `${D}10:00:00Z`, `${D}11:00:00Z`);
    book(store, "r1", `${D}10:00:00Z`, `${D}10:30:00Z`);
    expect(ids(list(store, "r1", ""))).toEqual(["b1", "b2"]);
  });

  it("leaves out the bookings of another room", () => {
    const store = createStore();
    store.addRoom("Lab", 10);
    store.addRoom("Hall", 20);
    book(store, "r1", `${D}09:00:00Z`, `${D}10:00:00Z`);
    book(store, "r2", `${D}09:00:00Z`, `${D}10:00:00Z`);
    expect(ids(list(store, "r1", ""))).toEqual(["b1"]);
  });
});

describe("handleListBookings: window", () => {
  function twoBookings(): Store {
    const store = createStore();
    store.addRoom("Lab", 10);
    book(store, "r1", `${D}09:00:00Z`, `${D}10:00:00Z`);
    book(store, "r1", `${D}10:00:00Z`, `${D}11:00:00Z`);
    return store;
  }

  // @covers room-booking-api:BEH-014
  it("keeps only the bookings overlapping the half-open from and to window", () => {
    const res = list(twoBookings(), "r1", `from=${D}10:00:00Z&to=${D}12:00:00Z`);
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual(["b2"]);
  });

  it.each([
    ["window before every booking", `from=${D}06:00:00Z&to=${D}08:00:00Z`, []],
    ["window ending at a booking start", `from=${D}08:00:00Z&to=${D}09:00:00Z`, []],
    ["window starting at a booking end", `from=${D}10:00:00Z&to=${D}11:00:00Z`, ["b2"]],
    ["window equal to a booking", `from=${D}09:00:00Z&to=${D}10:00:00Z`, ["b1"]],
    ["window spanning both bookings", `from=${D}09:30:00Z&to=${D}10:30:00Z`, ["b1", "b2"]],
  ])("answers %s", (_name, search, expected) => {
    const res = list(twoBookings(), "r1", search);
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual(expected);
  });

  it.each([
    ["only from", `from=${D}09:00:00Z`],
    ["only to", `to=${D}10:00:00Z`],
    ["to equal to from", `from=${D}10:00:00Z&to=${D}10:00:00Z`],
    ["to before from", `from=${D}11:00:00Z&to=${D}10:00:00Z`],
    ["from carrying 45 seconds", `from=${D}10:00:45Z&to=${D}12:00:00Z`],
    ["unparseable from", `from=banana&to=${D}12:00:00Z`],
  ])("answers invalid_query for a window with %s", (_name, search) => {
    expect(list(twoBookings(), "r1", search)).toEqual({ status: 400, body: { error: "invalid_query" } });
  });
});

describe("handleListBookings: unknown room", () => {
  // @covers room-booking-api:BEH-015
  it("answers room_not_found for an unknown room without a query", () => {
    const store = createStore();
    store.addRoom("Lab", 10);
    expect(list(store, "r9", "")).toEqual({ status: 404, body: { error: "room_not_found" } });
  });

  it("answers invalid_query for a malformed window on an unknown room", () => {
    const store = createStore();
    expect(list(store, "r9", `from=banana&to=${D}12:00:00Z`)).toEqual({
      status: 400,
      body: { error: "invalid_query" },
    });
  });

  it("answers invalid_query for only from on an unknown room", () => {
    const store = createStore();
    expect(list(store, "r9", `from=${D}09:00:00Z`)).toEqual({ status: 400, body: { error: "invalid_query" } });
  });

  it("answers 200 with a bookings array for the existing room", () => {
    const store = createStore();
    store.addRoom("Lab", 10);
    book(store, "r1", `${D}09:00:00Z`, `${D}10:00:00Z`);
    const res = list(store, "r1", "");
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual(["b1"]);
  });
});

describe("handleListBookings: contract", () => {
  // @covers room-booking-api:CTR-004
  it("answers invalid_json for a body that is not valid JSON on an existing room", () => {
    const store = createStore();
    store.addRoom("Lab", 10);
    book(store, "r1", `${D}09:00:00Z`, `${D}10:00:00Z`);
    expect(list(store, "r1", "", BAD_BODY)).toEqual({ status: 400, body: { error: "invalid_json" } });
  });

  it("answers room_not_found before invalid_json for an unknown room", () => {
    const store = createStore();
    expect(list(store, "r9", "", BAD_BODY)).toEqual({ status: 404, body: { error: "room_not_found" } });
  });

  it("answers invalid_query before invalid_json", () => {
    const store = createStore();
    store.addRoom("Lab", 10);
    expect(list(store, "r1", `from=${D}09:00:00Z`, BAD_BODY)).toEqual({
      status: 400,
      body: { error: "invalid_query" },
    });
  });

  it("answers 200 with the booking for a complete window on an existing room", () => {
    const store = createStore();
    store.addRoom("Lab", 10);
    book(store, "r1", `${D}09:00:00Z`, `${D}10:00:00Z`);
    const res = list(store, "r1", `from=${D}09:00:00Z&to=${D}10:00:00Z`);
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual(["b1"]);
  });
});

describe("handleDeleteBooking", () => {
  // @covers room-booking-api:BEH-016
  it("answers 204 without a body and frees the interval of a known booking", () => {
    const store = createStore();
    store.addRoom("Lab", 10);
    book(store, "r1", `${D}09:00:00Z`, `${D}10:00:00Z`);
    const res = handleDeleteBooking(store, "b1", NO_BODY);
    expect(res.status).toBe(204);
    expect(res.body).toBeUndefined();
    expect(ids(list(store, "r1", ""))).toEqual([]);
    expect(
      store.earliestConflict("r1", { startMs: Date.parse(`${D}09:00:00Z`), endMs: Date.parse(`${D}10:00:00Z`) }),
    ).toBeNull();
  });

  it("removes only the deleted booking of two", () => {
    const store = createStore();
    store.addRoom("Lab", 10);
    book(store, "r1", `${D}09:00:00Z`, `${D}10:00:00Z`);
    book(store, "r1", `${D}10:00:00Z`, `${D}11:00:00Z`);
    expect(handleDeleteBooking(store, "b1", NO_BODY).status).toBe(204);
    expect(ids(list(store, "r1", ""))).toEqual(["b2"]);
  });

  it("answers booking_not_found when the same booking is deleted twice", () => {
    const store = createStore();
    store.addRoom("Lab", 10);
    book(store, "r1", `${D}09:00:00Z`, `${D}10:00:00Z`);
    expect(handleDeleteBooking(store, "b1", NO_BODY).status).toBe(204);
    expect(handleDeleteBooking(store, "b1", NO_BODY)).toEqual({ status: 404, body: { error: "booking_not_found" } });
  });

  // @covers room-booking-api:BEH-017
  it("answers booking_not_found for an unknown booking and changes no state", () => {
    const store = createStore();
    store.addRoom("Lab", 10);
    book(store, "r1", `${D}09:00:00Z`, `${D}10:00:00Z`);
    expect(handleDeleteBooking(store, "b7", NO_BODY)).toEqual({ status: 404, body: { error: "booking_not_found" } });
    expect(ids(list(store, "r1", ""))).toEqual(["b1"]);
  });

  it("answers invalid_json for an invalid body and keeps the booking", () => {
    const store = createStore();
    store.addRoom("Lab", 10);
    book(store, "r1", `${D}09:00:00Z`, `${D}10:00:00Z`);
    expect(handleDeleteBooking(store, "b1", BAD_BODY)).toEqual({ status: 400, body: { error: "invalid_json" } });
    expect(ids(list(store, "r1", ""))).toEqual(["b1"]);
  });

  it("answers booking_not_found before invalid_json for an unknown booking", () => {
    const store = createStore();
    expect(handleDeleteBooking(store, "b7", BAD_BODY)).toEqual({ status: 404, body: { error: "booking_not_found" } });
  });

  // @covers room-booking-api:CTR-005
  it("answers 204 with no body for a known booking and nothing else on success", () => {
    const store = createStore();
    store.addRoom("Lab", 10);
    book(store, "r1", `${D}09:00:00Z`, `${D}10:00:00Z`);
    expect(handleDeleteBooking(store, "b1", NO_BODY)).toEqual({ status: 204 });
  });
});

describe("delete frees the interval scenario", () => {
  // @covers room-booking-api:SCN-001
  it("rebooks the freed interval and hands out booking id b2", () => {
    const store = createStore();
    const room = store.addRoom("Lab", 10);
    expect(room.id).toBe("r1");
    const start = `${D}09:00:00Z`;
    const end = `${D}10:00:00Z`;
    const window = { startMs: Date.parse(start), endMs: Date.parse(end) };
    expect(book(store, "r1", start, end).id).toBe("b1");
    expect(
      store.availableRooms({ startMs: Date.parse(start), endMs: Date.parse(`${D}09:30:00Z`) }, 5),
    ).toEqual([]);
    expect(store.earliestConflict("r1", window)?.id).toBe("b1");
    expect(handleDeleteBooking(store, "b1", NO_BODY)).toEqual({ status: 204 });
    expect(ids(list(store, "r1", ""))).toEqual([]);
    expect(store.earliestConflict("r1", window)).toBeNull();
    expect(book(store, "r1", start, end).id).toBe("b2");
  });
});
