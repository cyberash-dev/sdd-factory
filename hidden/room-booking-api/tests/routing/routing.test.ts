import { describe, expect, it } from "vitest";
import { matchRoute } from "../../src/routing/index.js";

const NOT_FOUND = { status: 404, body: { error: "not_found" } };
const NOT_ALLOWED = { status: 405, body: { error: "method_not_allowed" } };

const unmatched: Array<[string, string]> = [
  ["GET", "/nope"],
  ["GET", "/"],
  ["GET", "/rooms/r1"],
  ["PUT", "/nope"],
  ["GET", "/rooms/r1/bookings/b1"],
  ["GET", "/bookings"],
  ["DELETE", "/availability/x"],
];

const unsupported: Array<[string, string]> = [
  ["DELETE", "/rooms"],
  ["PUT", "/rooms"],
  ["PUT", "/rooms/r1/bookings"],
  ["DELETE", "/rooms/r1/bookings"],
  ["GET", "/bookings/b1"],
  ["POST", "/bookings/b1"],
  ["POST", "/availability"],
  ["DELETE", "/availability"],
];

describe("routing", () => {
  // @covers room-booking-api:CTR-008
  it("answers not_found for an unmatched path and method_not_allowed for an unsupported method on a known path", () => {
    expect(matchRoute("GET", "/nope")).toEqual(NOT_FOUND);
    expect(matchRoute("GET", "/rooms/r1")).toEqual(NOT_FOUND);
    expect(matchRoute("DELETE", "/rooms")).toEqual(NOT_ALLOWED);
    expect(matchRoute("PUT", "/rooms/r1/bookings")).toEqual(NOT_ALLOWED);
    expect(matchRoute("GET", "/bookings/b1")).toEqual(NOT_ALLOWED);
    expect(matchRoute("POST", "/availability")).toEqual(NOT_ALLOWED);
  });

  // @covers room-booking-api:BEH-022
  it("answers 404 not_found for every unmatched path, never 405", () => {
    expect.assertions(unmatched.length);
    for (const [method, path] of unmatched) {
      expect(matchRoute(method, path), `${method} ${path}`).toEqual(NOT_FOUND);
    }
  });

  // @covers room-booking-api:BEH-023
  it("answers 405 method_not_allowed for every unsupported method on a known path, never 404", () => {
    expect.assertions(unsupported.length);
    for (const [method, path] of unsupported) {
      expect(matchRoute(method, path), `${method} ${path}`).toEqual(NOT_ALLOWED);
    }
  });

  it.each([
    ["GET", "/rooms", "rooms", {}],
    ["POST", "/rooms", "rooms", {}],
    ["GET", "/rooms/r1/bookings", "roomBookings", { roomId: "r1" }],
    ["POST", "/rooms/r99/bookings", "roomBookings", { roomId: "r99" }],
    ["DELETE", "/bookings/b1", "booking", { bookingId: "b1" }],
    ["GET", "/availability", "availability", {}],
  ])("matches the supported %s %s as route %s", (method, path, name, params) => {
    expect(matchRoute(method, path)).toEqual({ name, method, params });
  });

  it("treats a path that matches a route pattern as a route even for an unknown room", () => {
    expect(matchRoute("GET", "/rooms/r99/bookings")).toEqual({
      name: "roomBookings",
      method: "GET",
      params: { roomId: "r99" },
    });
  });

  it("ignores the query string when comparing the path", () => {
    expect(matchRoute("GET", "/availability?start=a&end=b&attendees=2")).toEqual({
      name: "availability",
      method: "GET",
      params: {},
    });
    expect(matchRoute("GET", "/nope?x=1")).toEqual(NOT_FOUND);
  });

  it("compares the upper-cased request method", () => {
    expect(matchRoute("get", "/rooms")).toEqual({ name: "rooms", method: "GET", params: {} });
    expect(matchRoute("delete", "/rooms")).toEqual(NOT_ALLOWED);
  });
});
