import { apiError } from "../errors/index.js";
import type { ApiError } from "../errors/index.js";

export type RouteName = "rooms" | "roomBookings" | "booking" | "availability";

export interface RouteMatch {
  name: RouteName;
  method: "GET" | "POST" | "DELETE";
  params: Readonly<Record<string, string>>;
}

type RouteMethod = RouteMatch["method"];

interface PathMatch {
  name: RouteName;
  params: Readonly<Record<string, string>>;
  methods: readonly RouteMethod[];
}

function isRouteMethod(value: string, allowed: readonly RouteMethod[]): value is RouteMethod {
  return allowed.some((candidate) => candidate === value);
}

function matchPath(path: string): PathMatch | undefined {
  const queryStart = path.indexOf("?");
  const pathname = queryStart === -1 ? path : path.slice(0, queryStart);
  const segments = pathname.split("/");
  if (segments[0] !== "") return undefined;
  const [, first, second, third, ...rest] = segments;
  if (rest.length > 0) return undefined;

  if (first === "rooms" && second === undefined) {
    return { name: "rooms", params: {}, methods: ["GET", "POST"] };
  }
  if (first === "rooms" && second !== undefined && second !== "" && third === "bookings") {
    return { name: "roomBookings", params: { roomId: second }, methods: ["GET", "POST"] };
  }
  if (first === "bookings" && second !== undefined && second !== "" && third === undefined) {
    return { name: "booking", params: { bookingId: second }, methods: ["DELETE"] };
  }
  if (first === "availability" && second === undefined) {
    return { name: "availability", params: {}, methods: ["GET"] };
  }
  return undefined;
}

export function matchRoute(method: string, path: string): RouteMatch | ApiError {
  const matched = matchPath(path);
  if (matched === undefined) return apiError("not_found");
  const upper = method.toUpperCase();
  if (!isRouteMethod(upper, matched.methods)) return apiError("method_not_allowed");
  return { name: matched.name, method: upper, params: matched.params };
}
