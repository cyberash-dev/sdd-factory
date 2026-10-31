# Technical design: box-office

## 1. Overview

box-office is one HTTP JSON API served by a single Node.js process; every account, event, tier, order, discount code and waitlist entry lives in that process's memory. Requests are handled synchronously against one in-memory store, so check-then-write sequences never interleave. The process listens on the port named by `PORT`, takes the hold lifetime from `HOLD_SECONDS`, and is started with `npm start` after `npm run build`. Every outcome is a status in 400, 401, 403, 404, 409 or 422 with the body `{"error": "<message>"}`, or the endpoint's documented 200/201 body. Eight modules make up the product: one error and HTTP-vocabulary module, one state store, five route modules and a composition root.

## 2. Module map

### M-01 core
- responsibility: Holds the shared HTTP vocabulary, the error codes with their statuses, and the validation helpers every route module uses.
- covers: [box-office:POL-001, box-office:POL-002, box-office:INV-004, box-office:INV-008]
- owns: src/core/**
- entry: src/core/index.ts
- depends_on: []
- public interface:
  ```ts
  export type ErrorCode =
    | "E_MALFORMED_JSON"
    | "E_INVALID_INPUT"
    | "E_INVALID_QUERY"
    | "E_INVALID_TIER"
    | "E_UNAUTHENTICATED"
    | "E_FORBIDDEN"
    | "E_NOT_FOUND"
    | "E_EMAIL_TAKEN"
    | "E_EVENT_CANCELLED"
    | "E_EVENT_NOT_ON_SALE"
    | "E_TICKETS_UNAVAILABLE"
    | "E_TICKETS_AVAILABLE"
    | "E_ALREADY_WAITING"
    | "E_CODE_TAKEN"
    | "E_ORDER_STATE"
    | "E_TICKET_LIMIT"
    | "E_DISCOUNT_UNUSABLE";
  export class ApiError extends Error {
    readonly code: ErrorCode;
    readonly status: number;
    constructor(code: ErrorCode, detail: string);
  }
  export interface Caller {
    readonly id: string;
  }
  export interface HttpRequest {
    readonly method: string;
    readonly path: string;
    readonly params: Readonly<Record<string, string>>;
    readonly query: URLSearchParams;
    readonly body: unknown;
    readonly caller: Caller | null;
  }
  export interface ApiResponse {
    readonly status: number;
    readonly body: unknown;
  }
  export function isPlainObject(value: unknown): value is Record<string, unknown>;
  export function isInteger(value: unknown): value is number;
  export function parseTime(value: unknown): number | undefined;
  export function toIsoString(ms: number): string;
  ```
- notes: raises nothing itself. `ApiError` carries the code-to-status mapping used by every other module: E_MALFORMED_JSON 400, E_INVALID_INPUT 400, E_INVALID_QUERY 400, E_INVALID_TIER 400, E_UNAUTHENTICATED 401, E_FORBIDDEN 403, E_NOT_FOUND 404, E_EMAIL_TAKEN 409, E_EVENT_CANCELLED 409, E_EVENT_NOT_ON_SALE 409, E_TICKETS_UNAVAILABLE 409, E_TICKETS_AVAILABLE 409, E_ALREADY_WAITING 409, E_CODE_TAKEN 409, E_ORDER_STATE 409, E_TICKET_LIMIT 422, E_DISCOUNT_UNUSABLE 422. The detail text is prefixed with the code when the body is rendered. `parseTime` returns `Date.parse` of a string that parses and `undefined` otherwise; `toIsoString` is `new Date(ms).toISOString()`.

### M-02 store
- responsibility: Holds every record in memory, derives tier availability and report figures, expires holds and serves waitlists.
- covers: [box-office:CST-001, box-office:CST-004, box-office:INV-003, box-office:INV-005, box-office:INV-007, box-office:INV-009, box-office:INV-010, box-office:BEH-018, box-office:BEH-027, box-office:BEH-028, box-office:SCN-001, box-office:SCN-004]
- owns: src/store/**
- entry: src/store/index.ts
- depends_on: []
- public interface:
  ```ts
  export type Role = "organizer" | "customer";
  export interface Account {
    readonly id: string;
    readonly email: string;
    readonly name: string;
    readonly role: Role;
  }
  export interface Tier {
    readonly id: string;
    readonly name: string;
    readonly priceCents: number;
    readonly quantity: number;
    readonly available: number;
  }
  export interface Event {
    readonly id: string;
    readonly title: string;
    readonly venue: string;
    readonly startsAt: string;
    readonly status: "on_sale" | "cancelled";
    readonly organizerId: string;
    readonly tiers: readonly Tier[];
  }
  export interface OrderItem {
    readonly tierId: string;
    readonly quantity: number;
    readonly unitPriceCents: number;
  }
  export interface Order {
    readonly id: string;
    readonly eventId: string;
    readonly customerId: string;
    readonly status: "held" | "paid" | "expired" | "cancelled" | "refunded";
    readonly items: readonly OrderItem[];
    readonly subtotalCents: number;
    readonly discountCode: string | null;
    readonly discountCents: number;
    readonly totalCents: number;
    readonly createdAt: string;
    readonly expiresAt: string;
    readonly paidAt: string | null;
  }
  export interface DiscountCode {
    readonly code: string;
    readonly percentOff: number | null;
    readonly amountOffCents: number | null;
    readonly maxUses: number | null;
    readonly expiresAt: string | null;
    readonly uses: number;
  }
  export interface WaitlistEntry {
    readonly id: string;
    readonly eventId: string;
    readonly tierId: string;
    readonly quantity: number;
    readonly position: number;
  }
  export interface Report {
    readonly eventId: string;
    readonly tiers: readonly {
      readonly tierId: string;
      readonly name: string;
      readonly sold: number;
      readonly held: number;
      readonly available: number;
    }[];
    readonly grossCents: number;
    readonly discountCents: number;
    readonly refundedCents: number;
    readonly netCents: number;
  }
  export interface Store {
    now(): number;
    reconcile(nowMs?: number): void;

    createAccount(input: { email: string; password: string; name: string; role: Role }): Account;
    findAccountByEmail(email: string): Account | undefined;
    findAccountById(id: string): Account | undefined;
    verifyCredentials(email: string, password: string): Account | undefined;
    issueToken(accountId: string): string;
    resolveToken(token: string): Account | undefined;

    createEvent(input: {
      title: string;
      venue: string;
      startsAt: string;
      organizerId: string;
      tiers: readonly { name: string; priceCents: number; quantity: number }[];
    }): Event;
    listEvents(filter: {
      fromMs?: number;
      toMs?: number;
      q?: string;
      page: number;
      pageSize: number;
    }): { items: Event[]; page: number; pageSize: number; total: number };
    getEvent(eventId: string): Event | undefined;
    cancelEvent(eventId: string): Event;
    getReport(eventId: string): Report;

    createDiscountCode(eventId: string, input: {
      code: string;
      percentOff: number | null;
      amountOffCents: number | null;
      maxUses: number | null;
      expiresAtMs: number | null;
    }): DiscountCode;
    findDiscountCode(eventId: string, code: string): DiscountCode | undefined;

    availableTickets(eventId: string, tierId: string): number;
    ticketsHeldOrPaid(customerId: string, eventId: string): number;

    holdOrder(input: {
      eventId: string;
      customerId: string;
      items: readonly { tierId: string; quantity: number }[];
      discountCode: string | null;
    }): Order;
    getOrder(orderId: string): Order | undefined;
    listOrdersByCustomer(customerId: string): Order[];
    markPaid(orderId: string): Order;
    releaseOrder(orderId: string, status: "cancelled" | "refunded"): Order;

    joinWaitlist(input: {
      eventId: string;
      tierId: string;
      customerId: string;
      quantity: number;
    }): WaitlistEntry;
    findWaitlistEntry(customerId: string, tierId: string): WaitlistEntry | undefined;
    listWaitlistByCustomer(customerId: string): WaitlistEntry[];
  }
  export function createStore(options: { holdSeconds: number; now?: () => number }): Store;
  ```
- notes: raises no error code and imports no other module; every precondition is checked by the calling route module before the mutation is made (DD-07). `now()` returns the store clock's current instant in milliseconds, the same clock `createStore` receives as `now` (default `Date.now`); every route module reads time through it and never through `Date.now` (DD-23). `available` is derived on every read from `quantity` minus tickets in held orders minus tickets in paid orders, so INV-005 holds by construction; `reconcile` moves held orders past `expiresAt` to `"expired"` and then serves the affected tiers' waitlists. `cancelEvent` sets the event `"cancelled"`, moves its paid orders to `"refunded"`, its held orders to `"cancelled"` and drops its waitlist entries. `holdOrder` prices items at the tier's `priceCents`, applies an optional code, sets `expiresAt` to `createdAt` plus `holdSeconds` and counts the code's use; `releaseOrder` gives the code's use back and serves the freed tickets. `createStore` defaults the clock to `Date.now`. Ids are minted from one counter as `<prefix>_<n>` with prefixes `usr`, `evt`, `tir`, `ord`, `wat` (DD-21); tokens are `tok_` plus `randomUUID()` from `node:crypto`.

### M-03 accounts
- responsibility: Serves registration, session issue and the caller's own account.
- covers: [box-office:CTR-001, box-office:CTR-002, box-office:CTR-003, box-office:BEH-001, box-office:BEH-002, box-office:BEH-003, box-office:BEH-004, box-office:BEH-006, box-office:INV-001]
- owns: src/accounts/**
- entry: src/accounts/index.ts
- depends_on: [M-01, M-02]
- public interface:
  ```ts
  import type { ApiResponse, HttpRequest } from "../core/index.js";
  import type { Store } from "../store/index.js";
  export function createAccount(req: HttpRequest, store: Store): ApiResponse;
  export function createSession(req: HttpRequest, store: Store): ApiResponse;
  export function getMe(req: HttpRequest, store: Store): ApiResponse;
  ```
- notes: raises E_INVALID_INPUT (email without `@` and a `.` after it, password under 8 characters, name outside 1-100, role outside the two values), E_EMAIL_TAKEN (case-insensitive comparison), E_UNAUTHENTICATED (no account carries the email, or the password differs). The 201 and 200 bodies are the `Account` record itself, which has no password field.

### M-04 events
- responsibility: Serves event creation, listing, reading, cancellation and the sales report.
- covers: [box-office:CTR-004, box-office:CTR-005, box-office:CTR-006, box-office:CTR-007, box-office:CTR-015, box-office:BEH-007, box-office:BEH-008, box-office:BEH-009, box-office:BEH-010, box-office:BEH-011, box-office:BEH-012, box-office:BEH-013, box-office:BEH-029, box-office:INV-002, box-office:SCN-003]
- owns: src/events/**
- entry: src/events/index.ts
- depends_on: [M-01, M-02]
- public interface:
  ```ts
  import type { ApiResponse, HttpRequest } from "../core/index.js";
  import type { Store } from "../store/index.js";
  export function createEvent(req: HttpRequest, store: Store): ApiResponse;
  export function listEvents(req: HttpRequest, store: Store): ApiResponse;
  export function getEvent(req: HttpRequest, store: Store): ApiResponse;
  export function cancelEvent(req: HttpRequest, store: Store): ApiResponse;
  export function getEventReport(req: HttpRequest, store: Store): ApiResponse;
  ```
- notes: raises E_INVALID_INPUT (title or venue outside 1-100, startsAt not in the future or unreadable, tier count outside 1-5, repeated tier name at the same case, priceCents not an integer at least 0, quantity not an integer in 1-10000), E_INVALID_QUERY (from or to unreadable, page not an integer at least 1, pageSize not an integer in 1-50), E_NOT_FOUND (unknown id), E_FORBIDDEN (an organizer who did not create the event), E_EVENT_CANCELLED (second cancel). Order of checks per INV-011: input 400, resource 404, ownership 403, state 409. The startsAt-in-the-future rule of `createEvent` compares the parsed instant with `store.now()`, never with `Date.now()` (DD-23).

### M-05 orders
- responsibility: Serves checkout, payment, cancellation, single-order reads and the caller's order list.
- covers: [box-office:CTR-008, box-office:CTR-009, box-office:CTR-010, box-office:CTR-011, box-office:CTR-012, box-office:BEH-014, box-office:BEH-015, box-office:BEH-016, box-office:BEH-017, box-office:BEH-019, box-office:BEH-020, box-office:BEH-021, box-office:BEH-022, box-office:BEH-025, box-office:INV-006, box-office:SCN-002]
- owns: src/orders/**
- entry: src/orders/index.ts
- depends_on: [M-01, M-02]
- public interface:
  ```ts
  import type { ApiResponse, HttpRequest } from "../core/index.js";
  import type { Store } from "../store/index.js";
  export function createOrder(req: HttpRequest, store: Store): ApiResponse;
  export function payOrder(req: HttpRequest, store: Store): ApiResponse;
  export function cancelOrder(req: HttpRequest, store: Store): ApiResponse;
  export function getOrder(req: HttpRequest, store: Store): ApiResponse;
  export function listMyOrders(req: HttpRequest, store: Store): ApiResponse;
  ```
- notes: raises E_INVALID_INPUT (items absent or empty, repeated tierId, quantity not an integer at least 1, eventId or items missing), E_NOT_FOUND (unknown event; unknown order; an order of another customer; an order the caller may not read), E_INVALID_TIER (a tierId outside the event), E_EVENT_NOT_ON_SALE (cancelled or already started), E_TICKETS_UNAVAILABLE (one tier short), E_TICKET_LIMIT (would pass 6 tickets for the event over held and paid orders), E_DISCOUNT_UNUSABLE (code unknown for the event, expired or used up), E_ORDER_STATE (paying anything but a held order; cancelling an expired, cancelled or refunded order; refunding inside the 24 hour window). Checkout order per INV-011: input 400, event 404, tier 400, event state 409, availability 409, ticket limit 422, discount 422 (DD-08, DD-09). Every time comparison in this module takes its current instant from `store.now()`, never from `Date.now()`: the event-started check of E_EVENT_NOT_ON_SALE compares `event.startsAt` with `store.now()`, the discount expiry compares `expiresAt` with `store.now()`, and the 24 hour refund window compares `event.startsAt - store.now()` (DD-23).

### M-06 discounts
- responsibility: Serves discount code creation for an event.
- covers: [box-office:CTR-013, box-office:BEH-023, box-office:BEH-024]
- owns: src/discounts/**
- entry: src/discounts/index.ts
- depends_on: [M-01, M-02]
- public interface:
  ```ts
  import type { ApiResponse, HttpRequest } from "../core/index.js";
  import type { Store } from "../store/index.js";
  export function createDiscountCode(req: HttpRequest, store: Store): ApiResponse;
  ```
- notes: raises E_INVALID_INPUT (neither or both of percentOff and amountOffCents, percentOff outside an integer 1-100, amountOffCents not an integer at least 1, code outside 3-20 letters and digits, maxUses given below 1 or not an integer, expiresAt present and unreadable), E_NOT_FOUND (unknown event), E_FORBIDDEN (an organizer who did not create the event), E_CODE_TAKEN (the event already carries the code at any case). The stored code is the upper-case submitted code; absent optional fields are null.

### M-07 waitlist
- responsibility: Serves joining a tier's waitlist and reading the caller's entries.
- covers: [box-office:CTR-014, box-office:BEH-026]
- owns: src/waitlist/**
- entry: src/waitlist/index.ts
- depends_on: [M-01, M-02]
- public interface:
  ```ts
  import type { ApiResponse, HttpRequest } from "../core/index.js";
  import type { Store } from "../store/index.js";
  export function joinWaitlist(req: HttpRequest, store: Store): ApiResponse;
  export function listMyWaitlist(req: HttpRequest, store: Store): ApiResponse;
  ```
- notes: raises E_INVALID_INPUT (quantity not an integer in 1-6, tierId missing), E_NOT_FOUND (unknown event; a tierId outside the event, per DD-10), E_TICKETS_AVAILABLE (at least quantity available), E_ALREADY_WAITING (the caller already waits for that tier). `listMyWaitlist` serves GET /me/waitlist from DD-11 and raises nothing beyond the token and role checks of the composition root.

### M-08 app
- responsibility: Wires every route, runs the shared request pipeline and starts the process.
- covers: [box-office:BEH-005, box-office:BEH-030, box-office:BEH-031, box-office:INV-011, box-office:CST-002, box-office:CST-003, box-office:CST-005]
- owns: src/app/**, src/index.ts
- entry: src/app/index.ts
- depends_on: [M-01, M-02, M-03, M-04, M-05, M-06, M-07]
- public interface:
  ```ts
  import type { Server } from "node:http";
  import { createServer } from "node:http";
  import { createAccount, createSession, getMe } from "../accounts/index.js";
  import { parseTime, toIsoString } from "../core/index.js";
  import { cancelEvent, createEvent, getEvent, getEventReport, listEvents } from "../events/index.js";
  import { createOrder, getOrder, listMyOrders, payOrder, cancelOrder } from "../orders/index.js";
  import { createDiscountCode } from "../discounts/index.js";
  import { joinWaitlist, listMyWaitlist } from "../waitlist/index.js";
  import type { Role, Store } from "../store/index.js";
  import { createStore } from "../store/index.js";
  export function createApp(store: Store): Server;
  export function readConfig(env: Readonly<Record<string, string | undefined>>): {
    port: number;
    holdSeconds: number;
  };
  export function startServer(): Server;
  ```
- notes: raises E_NOT_FOUND for an unknown path and for an unserved method on a known path, E_MALFORMED_JSON for a body that does not parse on a route that reads a body, E_INVALID_INPUT for a body that parses to a non-object on a route that reads a body, E_UNAUTHENTICATED for an absent or unknown token, E_FORBIDDEN for a caller whose role the route does not accept. Pipeline order per INV-011: route 404, method 404, body syntax 400, token 401, role 403, then the route module's own checks. Holds the route table, the token map lookup through `store.resolveToken`, and the error renderer that turns `ApiError` into `{ status, body }`. `startServer` builds the store from `readConfig(process.env)`, listens, prints one readiness line to stdout and installs a process-level guard that answers 500-free and keeps serving (POL-002). Also owns `package.json` scripts and `tsconfig.build.json` (DD-12).

## 3. Data shapes

All record shapes are declared in M-02 `src/store/index.ts`; the HTTP vocabulary shapes are declared in M-01 `src/core/index.ts`. Other modules import them with `import type { ... } from "../store/index.js"` and `"../core/index.js"` and never redeclare them.

```ts
// covers: box-office:CTR-001, box-office:INV-001
export type Role = "organizer" | "customer";
export interface Account {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: Role;
}
// the password is kept inside the store and is not part of any exported shape (DD-20)

// covers: box-office:CTR-004, box-office:INV-005
export interface Tier {
  readonly id: string;
  readonly name: string;
  readonly priceCents: number;
  readonly quantity: number;
  readonly available: number;
}

// covers: box-office:CTR-004, box-office:CTR-006, box-office:INV-004
export interface Event {
  readonly id: string;
  readonly title: string;
  readonly venue: string;
  readonly startsAt: string;
  readonly status: "on_sale" | "cancelled";
  readonly organizerId: string;
  readonly tiers: readonly Tier[];
}

// covers: box-office:CTR-008, box-office:INV-002
export interface OrderItem {
  readonly tierId: string;
  readonly quantity: number;
  readonly unitPriceCents: number;
}
export interface Order {
  readonly id: string;
  readonly eventId: string;
  readonly customerId: string;
  readonly status: "held" | "paid" | "expired" | "cancelled" | "refunded";
  readonly items: readonly OrderItem[];
  readonly subtotalCents: number;
  readonly discountCode: string | null;
  readonly discountCents: number;
  readonly totalCents: number;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly paidAt: string | null;
}

// covers: box-office:CTR-013, box-office:INV-009
export interface DiscountCode {
  readonly code: string;
  readonly percentOff: number | null;
  readonly amountOffCents: number | null;
  readonly maxUses: number | null;
  readonly expiresAt: string | null;
  readonly uses: number;
}

// covers: box-office:CTR-014, box-office:INV-010
export interface WaitlistEntry {
  readonly id: string;
  readonly eventId: string;
  readonly tierId: string;
  readonly quantity: number;
  readonly position: number;
}

// covers: box-office:CTR-015, box-office:BEH-029
export interface Report {
  readonly eventId: string;
  readonly tiers: readonly {
    readonly tierId: string;
    readonly name: string;
    readonly sold: number;
    readonly held: number;
    readonly available: number;
  }[];
  readonly grossCents: number;
  readonly discountCents: number;
  readonly refundedCents: number;
  readonly netCents: number;
}
```

```ts
// covers: box-office:POL-001, box-office:INV-008
export type ErrorCode =
  | "E_MALFORMED_JSON"
  | "E_INVALID_INPUT"
  | "E_INVALID_QUERY"
  | "E_INVALID_TIER"
  | "E_UNAUTHENTICATED"
  | "E_FORBIDDEN"
  | "E_NOT_FOUND"
  | "E_EMAIL_TAKEN"
  | "E_EVENT_CANCELLED"
  | "E_EVENT_NOT_ON_SALE"
  | "E_TICKETS_UNAVAILABLE"
  | "E_TICKETS_AVAILABLE"
  | "E_ALREADY_WAITING"
  | "E_CODE_TAKEN"
  | "E_ORDER_STATE"
  | "E_TICKET_LIMIT"
  | "E_DISCOUNT_UNUSABLE";
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  constructor(code: ErrorCode, detail: string);
}

// covers: box-office:POL-001
export interface ApiResponse {
  readonly status: number;
  readonly body: unknown;
}

// covers: box-office:BEH-005, box-office:INV-011
export interface Caller {
  readonly id: string;
}
export interface HttpRequest {
  readonly method: string;
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly body: unknown;
  readonly caller: Caller | null;
}
```

The list page of `GET /events` is the unnamed structural shape `{ items: Event[]; page: number; pageSize: number; total: number }`, declared inline in `Store.listEvents` (covers `box-office:CTR-005`). The problem details of the Open-Q `opt-json-first` reading and the `GA` assumptions are carried by DD-09 and DD-10.

## 4. Error mapping

The response body of every failure is the JSON object `{"error": "<message>"}`, where the message begins with the code and a colon and after it free text; §5 of `box-office:POL-001` makes that text no contract, so callers branch on status and on the code prefix only.

| code | status | raising module | trigger |
| --- | --- | --- | --- |
| E_NOT_FOUND | 404 | M-08 app | the path names no route, or the method is not one the path serves |
| E_MALFORMED_JSON | 400 | M-08 app | a route that reads a body received a body that does not parse as JSON |
| E_INVALID_INPUT | 400 | M-08 app | a route that reads a body received a JSON value that is not an object |
| E_UNAUTHENTICATED | 401 | M-08 app | no `Authorization` header, or a token the process never issued |
| E_FORBIDDEN | 403 | M-08 app | a valid token whose role the route does not accept |
| E_INVALID_INPUT | 400 | M-03 accounts | email, password, name or role outside its rule; a required field missing |
| E_EMAIL_TAKEN | 409 | M-03 accounts | the email is already registered, compared case-insensitively |
| E_UNAUTHENTICATED | 401 | M-03 accounts | no account carries the email, or the password does not match |
| E_INVALID_INPUT | 400 | M-04 events | title, venue, startsAt, tier count, tier name, priceCents or quantity outside its rule |
| E_INVALID_QUERY | 400 | M-04 events | from or to unreadable, page or pageSize outside its rule |
| E_NOT_FOUND | 404 | M-04 events | no event carries the path id |
| E_FORBIDDEN | 403 | M-04 events | the caller is an organizer who did not create the event |
| E_EVENT_CANCELLED | 409 | M-04 events | the event is already cancelled |
| E_INVALID_INPUT | 400 | M-05 orders | items absent or empty, a repeated tierId, a quantity below 1 or not an integer, eventId or items missing |
| E_NOT_FOUND | 404 | M-05 orders | no event carries eventId; no order carries the path id; the order belongs to another customer; the caller is neither the order's customer nor its event's organizer |
| E_INVALID_TIER | 400 | M-05 orders | a tierId is not one of the event's tiers |
| E_EVENT_NOT_ON_SALE | 409 | M-05 orders | the event is cancelled or its startsAt is not in the future |
| E_TICKETS_UNAVAILABLE | 409 | M-05 orders | one tier has fewer tickets available than its requested quantity |
| E_TICKET_LIMIT | 422 | M-05 orders | the order would take the customer past 6 tickets for the event over held and paid orders |
| E_DISCOUNT_UNUSABLE | 422 | M-05 orders | the code is unknown for the event, expired, or its uses reached maxUses |
| E_ORDER_STATE | 409 | M-05 orders | paying an order that is not held; cancelling one that is expired, cancelled or refunded; refunding a paid order inside the 24 hour window |
| E_INVALID_INPUT | 400 | M-06 discounts | the discount field pair, percentOff, amountOffCents, code, maxUses or expiresAt outside its rule |
| E_NOT_FOUND | 404 | M-06 discounts | no event carries the path id |
| E_FORBIDDEN | 403 | M-06 discounts | the caller is an organizer who did not create the event |
| E_CODE_TAKEN | 409 | M-06 discounts | the event already carries that code at any case |
| E_INVALID_INPUT | 400 | M-07 waitlist | quantity not an integer in 1-6, or tierId missing |
| E_NOT_FOUND | 404 | M-07 waitlist | no event carries the path id; the tierId is not one of the event's tiers |
| E_TICKETS_AVAILABLE | 409 | M-07 waitlist | the tier has at least quantity tickets available |
| E_ALREADY_WAITING | 409 | M-07 waitlist | the caller already waits for that tier |

Every code above appears in an approved `error_taxonomy` or `negative_cases` entry; no other code exists. The status numbers are DD-04.

## 5. Process and IO boundaries

- Transport: HTTP/1.1 over TCP, JSON only. The product has no argv, no stdin and no exit code of its own; it is started, it serves, and it ends when the process is signalled.
- Start: the harness runs `npm install`, then `npm run build`, then `npm start`. `npm run build` is `tsc -p tsconfig.build.json` emitting `dist/`; `npm start` is `node dist/index.js`; `src/index.ts` calls `startServer()` and nothing else (DD-12).
- `PORT`: the listen port. Unset, non-numeric, negative or above 65535 falls back to `3000`; `0` is honoured as an ephemeral port (DD-13). The server is created with `createServer` and started with `listen(port)`, with no host argument, so it accepts connections on every local interface over IPv4 and IPv6.
- Readiness: when listening, the process writes exactly one line to stdout, `box-office listening on <port>` with the bound port from `server.address()`. Nothing else is written to stdout during serving. Diagnostics go to stderr through `console.error`.
- `HOLD_SECONDS`: the hold lifetime in seconds. Unset, non-numeric, negative or fractional falls back to `600`; `0` is honoured (DD-14). `expiresAt` is `createdAt` plus `holdSeconds * 1000`.
- Body handling: for a route marked `readsBody`, the whole request stream is read as UTF-8 and passed to `JSON.parse`; a parse failure including an empty body, or a body larger than 1048576 bytes, answers 400 E_MALFORMED_JSON; a parsed value that is not a plain object answers 400 E_INVALID_INPUT. For every other route the body is discarded unread. The `Content-Type` header is ignored (DD-16).
- Query handling: parsed with `new URLSearchParams(url.slice(url.indexOf("?") + 1))`; a repeated parameter takes its first value; parameters the route does not list are ignored (DD-17).
- Path handling: the request target is split at `?` and on `/`; empty trailing segments are dropped; a route matches when its segment list has the same length and every non-`:` segment is equal; `:id` captures one segment verbatim and is not percent-decoded twice beyond the platform's own decode.
- Route table (`roles` is the role set the root enforces after the token check):

| method | path | roles | readsBody |
| --- | --- | --- | --- |
| POST | /users | public | yes |
| POST | /sessions | public | yes |
| GET | /me | organizer, customer | no |
| GET | /me/orders | customer | no |
| GET | /me/waitlist | customer | no |
| POST | /events | organizer | yes |
| GET | /events | public | no |
| GET | /events/:id | public | no |
| POST | /events/:id/cancel | organizer | no |
| POST | /events/:id/discounts | organizer | yes |
| POST | /events/:id/waitlist | customer | yes |
| GET | /events/:id/report | organizer | no |
| POST | /orders | customer | yes |
| POST | /orders/:id/pay | customer | no |
| POST | /orders/:id/cancel | customer | no |
| GET | /orders/:id | organizer, customer | no |

- Request pipeline order (INV-011): match the path against the table (miss answers 404 E_NOT_FOUND); match the method on the matched path (miss answers 404 E_NOT_FOUND); parse the body when the route reads one (400 E_MALFORMED_JSON or 400 E_INVALID_INPUT); resolve the token from `Authorization: Bearer <token>` (401 E_UNAUTHENTICATED); check the caller's role against the route's roles (403 E_FORBIDDEN); call the route module, which runs its own checks in the order input 400, named resource 404, ownership 403, state 409, limits 422.
- Response: status from `ApiResponse.status`, body serialized with `JSON.stringify`, header `Content-Type: application/json; charset=utf-8`, header `Content-Length` set to the byte length. A 200 with an empty array body is `[]`. No other headers, no CORS.
- State: one `Store` instance per process, created in `startServer` (`CST-001`). Request handling is synchronous from body parse to response write, so no two requests mutate the store at the same time (`SUR-001.concurrency_model`). No outbound sockets are opened and no file is written at runtime (`CST-002`); the process reads no environment variable other than `PORT` and `HOLD_SECONDS`.
- Failure containment: a thrown value the pipeline does not classify is answered 500 only for a defect outside the spec's taxonomy, is logged to stderr, and never ends the process (DD-15); every invalid request of every kind already answers one of the six documented statuses.

## 6. TD-TOOLING

```yaml
TD-TOOLING:
  node: "22"
  test_cmd: "npx vitest run"
  typecheck_cmd: "npx tsc --noEmit"
  dependencies: []
  dev_dependencies: ["typescript@5.6.3", "vitest@2.1.8", "@types/node@22.10.2"]
  tsconfig: { module: NodeNext, moduleResolution: NodeNext, target: ES2022, strict: true, noEmit: true }
```

## 7. Design decisions

### DD-01 One in-memory store and no persistence
- evidence: [box-office:CST-001, box-office:CST-005, box-office:SUR-001]
- decision: A single `Store` value created in `startServer` holds every record in plain arrays and maps; nothing is written to disk and no database client is imported.
- alternatives_rejected: a file-backed store or SQLite, both of which outlive the process and add a runtime package; a per-resource store object per route, which would scatter availability derivation across modules.
- consequence: state dies with the process, which the spec accepts; every route module receives the same `Store` instance as its second argument, and tests reach state only through the API.

### DD-02 Node built-ins only
- evidence: [box-office:CST-005, box-office:CST-002]
- decision: The HTTP server is `node:http`; uuid generation is `node:crypto`; all other work is plain TypeScript. `dependencies` stays empty in the tooling block.
- alternatives_rejected: Express, Fastify or Hono, each of which is a runtime dependency the source does not list and would break `CST-005`.
- consequence: routing, body reading and JSON serialization are written in `src/app`, with the route table of §5 as their contract.

### DD-03 Two bottom modules, no dependency between them
- evidence: [box-office:BEH-030, box-office:POL-002, box-office:INV-011]
- decision: `M-01 core` (error vocabulary, HTTP request and response types, validation helpers) and `M-02 store` (records and mutations) both depend on nothing. `Role` and `Account` live in the store; `Caller` holds only the account id, because role checking happens in the root, which resolves the token through the store.
- alternatives_rejected: a shared `types` module below both, which would give the chain root → route module → store → types four modules; a store that imports `ApiError`, which has the same effect.
- consequence: the longest chain is `M-08 app → M-05 orders → M-02 store`, three modules, so the planner has two build levels below the root and every route module is parallelisable.

### DD-04 Status numbers for every code
- evidence: [box-office:POL-001, box-office:INV-008, box-office:CTR-001, box-office:CTR-004, box-office:CTR-007, box-office:CTR-008, box-office:CTR-013, box-office:CTR-014]
- decision: E_MALFORMED_JSON, E_INVALID_INPUT, E_INVALID_QUERY and E_INVALID_TIER answer 400; E_UNAUTHENTICATED 401; E_FORBIDDEN 403; E_NOT_FOUND 404; E_EMAIL_TAKEN, E_EVENT_CANCELLED, E_EVENT_NOT_ON_SALE, E_TICKETS_UNAVAILABLE, E_TICKETS_AVAILABLE, E_ALREADY_WAITING, E_CODE_TAKEN and E_ORDER_STATE 409; E_TICKET_LIMIT and E_DISCOUNT_UNUSABLE 422. The single source of that mapping is the `ApiError` constructor.
- alternatives_rejected: 405 for an unserved method (the source never names it, and `ASM-002` reads it as 404); 400 for E_ORDER_STATE, which the contracts fix at 409.
- consequence: no module computes a status of its own; every failure is raised as an `ApiError` with a code.

### DD-05 The message text starts with the code
- evidence: [box-office:POL-001, box-office:INV-008, box-office:BEH-017]
- decision: The rendered body is `{"error": "<CODE>: <detail>"}`; the detail sentence is free text and no caller may depend on it. The body carries no other key.
- alternatives_rejected: a body `{"error": "...", "code": "..."}`, which `INV-008` and the `{"error": "<any message>"}` shape do not describe; a bare message, which leaves the two 422 outcomes indistinguishable in a log.
- consequence: the two codes that share 422 stay observable, while tests must still branch on status and scenario, not on text.

### DD-06 The check pipeline is split between the root and the route modules
- evidence: [box-office:INV-011, box-office:BEH-030, box-office:BEH-005, box-office:BEH-031]
- decision: The root owns route matching, method matching, body syntax, token and role in that order; each route module owns input, named resource, ownership, state and limits in that order. A route module therefore never sees a request with an unknown route, an unparsed body, no caller or a wrong role.
- alternatives_rejected: a declarative per-route check list evaluated by the root, which would force route-specific input rules into the root; each route module checking its own token, which repeats the logic twelve times and makes the 404-before-401 order easy to break.
- consequence: an unknown route answers 404 without a token, a malformed body on a served route answers 400 without a token, and a wrong role answers 403 before the endpoint's input checks.

### DD-07 The store performs no precondition checks and raises nothing
- evidence: [box-office:POL-002, box-office:BEH-030, box-office:BEH-018]
- decision: Store methods assume their preconditions hold and return values; a route module reads the store's views (`getEvent`, `availableTickets`, `ticketsHeldOrPaid`, `findDiscountCode`, `findWaitlistEntry`) and raises `ApiError` itself, then calls the mutation.
- alternatives_rejected: a result union per store method, which needs exported failure types and pushes the store past its symbol budget; a store that throws `ApiError`, which would make the store depend on `M-01` and lengthen the chain to four modules.
- consequence: check-then-act is safe because a request runs to completion synchronously between two awaits of the server; the ordering rules of `INV-011` live in one place per endpoint, in its route module.

### DD-08 Checkout checks run as: event, tier, event state, availability, ticket limit, discount
- evidence: [box-office:CTR-008, box-office:BEH-016, box-office:BEH-017, box-office:ASM-007]
- decision: `createOrder` runs its own checks in that order, so an unknown event is 404 before a foreign tier is 400, a cancelled or started event is 409 E_EVENT_NOT_ON_SALE before availability, and the ticket limit 422 is decided before the discount rule 422.
- alternatives_rejected: deciding the discount before the ticket limit, which `ASM-007` rejects; checking availability after the ticket limit, which would let a request report 422 for tickets a tier cannot supply.
- consequence: the reported code of a doubly broken checkout is fixed, and no tier's availability changes on any failure path because `holdOrder` is called only after every check passes.

### DD-09 Availability and report figures are derived, never stored
- evidence: [box-office:INV-005, box-office:INV-007, box-office:BEH-029, box-office:BEH-018]
- decision: `available` and every report figure are recomputed from the order list on each read: available is `quantity` minus tickets in held orders minus tickets in paid orders; grossCents, discountCents and netCents sum over paid orders, refundedCents over refunded ones.
- alternatives_rejected: a stored `available` counter mutated on every order transition, which has as many places to drift as there are transitions and would violate `INV-005` on any missed one.
- consequence: no transition can leave availability wrong; the cost is a scan of the event's orders per read, which the single-process in-memory model makes cheap.

### DD-10 A tierId outside the event is 404 E_NOT_FOUND on the waitlist
- evidence: [box-office:ASM-016, box-office:OQ-004, box-office:CTR-014, box-office:BEH-026]
- decision: `POST /events/:id/waitlist` answers 404 E_NOT_FOUND when the tierId is not one of that event's tiers, while `POST /orders` answers 400 E_INVALID_TIER for the same input class.
- alternatives_rejected: 400 E_INVALID_TIER on both endpoints, which is the plain reading of `CTR-014`; the approved assumption `box-office:ASM-016` records the opposite reading as in force, so the design follows it.
- consequence: the two checkout paths disagree on that input class by decision, and the error table of §4 records both rows.

### DD-11 GET /me/waitlist is served
- evidence: [box-office:ASM-012, box-office:CTR-014, box-office:INV-010]
- decision: `GET /me/waitlist` answers 200 with a JSON array of the caller's waitlist entries, each carrying its current 1-based `position` within its tier's queue, `[]` when the caller waits for nothing; roles: customer. Entries are ordered by tier and then position.
- alternatives_rejected: omitting the route, which `box-office:ASM-012` records as the reading taken and which would leave a customer unable to observe `position` after joining.
- consequence: M-07 exports `listMyWaitlist`; the route is added to the table of §5 and has no Contract record, so its test obligation is `ASM-012` plus `CTR-014`'s entry shape.

### DD-12 Build then start
- evidence: [box-office:CST-003, box-office:ASM-019, box-office:CST-005]
- decision: `npm run build` is `tsc -p tsconfig.build.json` with `noEmit: false`, `rootDir: "src"`, `outDir: "dist"`, `module`/`moduleResolution` NodeNext and `include: ["src"]`; `npm start` is `node dist/index.js`. That build config is a separate file, so the checked-in `tsconfig.json` keeps type-checking `src` and `tests` together with `noEmit: true`.
- alternatives_rejected: `npm start` running `tsx` or `node --experimental-strip-types`, which needs a dev package the tooling block does not list, or an unflagged runtime feature the pinned Node version does not guarantee; a `rootDir` in the main tsconfig, which breaks the type-check of `tests`.
- consequence: the emitted `dist` mirrors `src`, every relative import ends in `.js`, and the harness's build-then-start sequence produces a running server.

### DD-13 PORT default and listen call
- evidence: [box-office:CST-003, box-office:CTR-005]
- decision: `readConfig` reads `PORT`, accepts an integer in 0-65535 and falls back to 3000 otherwise; `startServer` calls `server.listen(port)` with no host argument.
- alternatives_rejected: binding `127.0.0.1`, which rejects a client that resolves the host as `::1`; failing to start on a bad `PORT`, which turns a configuration typo into a dead process.
- consequence: the readiness line reports the bound port, so a harness that passes 0 can still reach the server.

### DD-14 HOLD_SECONDS parsing and the 24 hour refund window
- evidence: [box-office:CST-004, box-office:BEH-014, box-office:BEH-020, box-office:CTR-010]
- decision: `HOLD_SECONDS` is an integer of at least 0, default 600, and anything else reads as 600; `expiresAt` is `createdAt` plus that many seconds. A paid order is refundable only while `startsAt - store.now() > 86_400_000`; at exactly 24 hours the answer is 409 E_ORDER_STATE, and the comparison uses the store clock's instant, not `Date.now()` (DD-23).
- alternatives_rejected: treating `HOLD_SECONDS 0` as unset, which `CST-004` boundary-classes as a real value; a `>=` comparison on the refund window, which contradicts `CTR-010`'s "24 hours or fewer".
- consequence: both boundaries are pinned and testable through the environment variable and the event start.

### DD-15 Failure containment and the 500
- evidence: [box-office:POL-002, box-office:BEH-031, box-office:INV-008]
- decision: The request handler wraps the whole pipeline; a thrown `ApiError` renders its status and body, any other thrown value is logged to stderr and answered 500 with `{"error": "internal error"}`, and the server keeps listening.
- alternatives_rejected: letting the exception escape, which would end the process and break `POL-002`; mapping every unexpected throw to 400, which would report a defect as a client error.
- consequence: `INV-008`'s six statuses describe every failure the spec names; the 500 exists only for a defect and no approved record may provoke it.

### DD-16 Content-Type ignored, body size capped
- evidence: [box-office:POL-002, box-office:BEH-002, box-office:BEH-031]
- decision: The body is parsed as JSON whatever `Content-Type` says, and a body above 1 MiB answers 400 E_MALFORMED_JSON without being buffered in full.
- alternatives_rejected: rejecting a missing or foreign `Content-Type` with 400, which adds an error the source never states; unbounded buffering, which lets one request exhaust the process's memory.
- consequence: a client that omits the header still works and the cap keeps the process serving.

### DD-17 Unlisted inputs are ignored
- evidence: [box-office:ASM-003, box-office:BEH-002, box-office:BEH-010]
- decision: Unknown body fields and unknown query parameters are ignored and never change a status; a repeated query parameter uses its first value; a repeated JSON key uses the last value `JSON.parse` keeps.
- alternatives_rejected: 400 for any unlisted key, which `ASM-003` rejects and which adds an error the source never states.
- consequence: no endpoint validates its key set, only the fields it names.

### DD-18 Missing required fields are 400 E_INVALID_INPUT
- evidence: [box-office:ASM-001, box-office:OQ-001, box-office:BEH-002, box-office:BEH-015]
- decision: A valid-JSON body that omits a field its endpoint lists answers 400 E_INVALID_INPUT and writes nothing, except that a `/users` or `/sessions` body missing a credential field answers the same 400 rather than 401.
- alternatives_rejected: 401 for a missing password, which `ASM-001` rejects and which would make the status depend on which field is missing.
- consequence: every missing field is an input failure, reported before any token or credential logic inside the route.

### DD-19 An empty body is malformed JSON
- evidence: [box-office:POL-002, box-office:BEH-031, box-office:CTR-001]
- decision: A route that reads a body and receives zero bytes answers 400 E_MALFORMED_JSON.
- alternatives_rejected: answering 400 E_INVALID_INPUT, which would require a second emptiness rule in every route module; answering as if the body were `{}`, which hides a client defect.
- consequence: one rule decides every unparseable body, including empty.

### DD-20 The password never leaves the store
- evidence: [box-office:INV-001, box-office:CTR-001, box-office:CTR-003, box-office:BEH-001]
- decision: The `Account` type exported by the store has no password field; the password lives in a record private to `src/store` and is compared only by `verifyCredentials`. Route modules therefore cannot serialize it.
- alternatives_rejected: an exported account type with a password and a `toPublicAccount` helper in every route, which is one forgotten call away from an `INV-001` breach.
- consequence: registration, `GET /me` and any other account serialization are safe by type.

### DD-21 Ids and tokens
- evidence: [box-office:INV-003, box-office:CTR-002, box-office:BEH-004, box-office:ASM-008]
- decision: Every record id is `<prefix>_<n>` with one process-wide counter and prefixes `usr`, `evt`, `tir`, `ord`, `wat`, so no two ids of any two records are equal; a discount code's identity is its upper-case code scoped to its event, and its letter-and-digit rule keeps it disjoint from every id because every id contains an underscore. A token is `tok_` plus `crypto.randomUUID()`, opaque, valid until the process ends.
- alternatives_rejected: per-kind counters, which let an event id equal a tier id and break `INV-003`; signed or expiring tokens, which `ASM-008` rules out.
- consequence: `INV-003` holds by construction and no endpoint has to compare ids across kinds.

### DD-22 Waitlist serving runs inside the store
- evidence: [box-office:BEH-027, box-office:BEH-028, box-office:INV-010, box-office:INV-006, box-office:SCN-001, box-office:ASM-014]
- decision: An internal routine runs after every transition that frees tickets (`reconcile` on expiry, `releaseOrder`, and the request-start `reconcile`) and per tier walks the queue from the head: while the head's quantity fits the tier's availability, either create a held order for that customer and tier with no discount code and an expiry from `HOLD_SECONDS`, or, when that order would take the customer past 6 tickets for the event, remove the entry and continue; stop at the first head that does not fit.
- alternatives_rejected: serving the first entry that fits, which `INV-010` and `ASM-014` reject; leaving expiry to a timer, which would make a read return stale availability and break `INV-007`.
- consequence: every observable response reflects expiry and serving, and the queue keeps its order because only the head is ever served or dropped.

### DD-23 Every time decision reads the store clock
- evidence: [box-office:INV-011, box-office:BEH-014, box-office:BEH-016, box-office:BEH-020, box-office:CTR-008, box-office:CTR-013, box-office:CST-004, box-office:BEH-018]
- decision: `Store` exports `now(): number`, which returns the clock instant of the `now` function `createStore` received, defaulting to `Date.now`. Every module that compares an instant reads the current instant from `store.now()` and never from `Date.now()`: `createEvent`'s startsAt-in-the-future rule (M-04), `createOrder`'s event-started check, discount expiry comparison and `createdAt`/`expiresAt` computation, and the 24 hour refund window of `cancelOrder` (M-05), plus `reconcile` inside M-02. `holdOrder` and `reconcile` already stamp from that same clock, so created, expired and compared instants are one timeline.
- alternatives_rejected: an ambient `Date.now()` in the route modules, which makes every time-sensitive status unreachable for a test that drives a fake clock through `createStore({ now })` and left `POST /orders` answering 422 instead of 409 past the sale start; a store method `isEventStarted(eventId)` instead of `now()`, which would need one accessor per comparison and cannot serve the 24 hour window without an event-specific signature.
- consequence: a test or the composition root sets one clock and every endpoint observes it; `store.now()` is the only time source in the product, and no module imports a clock of its own.

## 8. Traceability

| spec id | module |
| --- | --- |
| box-office:CTR-001 | M-03 |
| box-office:CTR-002 | M-03 |
| box-office:CTR-003 | M-03 |
| box-office:CTR-004 | M-04 |
| box-office:CTR-005 | M-04 |
| box-office:CTR-006 | M-04 |
| box-office:CTR-007 | M-04 |
| box-office:CTR-008 | M-05 |
| box-office:CTR-009 | M-05 |
| box-office:CTR-010 | M-05 |
| box-office:CTR-011 | M-05 |
| box-office:CTR-012 | M-05 |
| box-office:CTR-013 | M-06 |
| box-office:CTR-014 | M-07 |
| box-office:CTR-015 | M-04 |
| box-office:BEH-001 | M-03 |
| box-office:BEH-002 | M-03 |
| box-office:BEH-003 | M-03 |
| box-office:BEH-004 | M-03 |
| box-office:BEH-005 | M-08 |
| box-office:BEH-006 | M-03 |
| box-office:BEH-007 | M-04 |
| box-office:BEH-008 | M-04 |
| box-office:BEH-009 | M-04 |
| box-office:BEH-010 | M-04 |
| box-office:BEH-011 | M-04 |
| box-office:BEH-012 | M-04 |
| box-office:BEH-013 | M-04 |
| box-office:BEH-014 | M-05 |
| box-office:BEH-015 | M-05 |
| box-office:BEH-016 | M-05 |
| box-office:BEH-017 | M-05 |
| box-office:BEH-018 | M-02 |
| box-office:BEH-019 | M-05 |
| box-office:BEH-020 | M-05 |
| box-office:BEH-021 | M-05 |
| box-office:BEH-022 | M-05 |
| box-office:BEH-023 | M-06 |
| box-office:BEH-024 | M-06 |
| box-office:BEH-025 | M-05 |
| box-office:BEH-026 | M-07 |
| box-office:BEH-027 | M-02 |
| box-office:BEH-028 | M-02 |
| box-office:BEH-029 | M-04 |
| box-office:BEH-030 | M-08 |
| box-office:BEH-031 | M-08 |
| box-office:SCN-001 | M-02 |
| box-office:SCN-002 | M-05 |
| box-office:SCN-003 | M-04 |
| box-office:SCN-004 | M-02 |
| box-office:INV-001 | M-03 |
| box-office:INV-002 | M-04 |
| box-office:INV-003 | M-02 |
| box-office:INV-004 | M-01 |
| box-office:INV-005 | M-02 |
| box-office:INV-006 | M-05 |
| box-office:INV-007 | M-02 |
| box-office:INV-008 | M-01 |
| box-office:INV-009 | M-02 |
| box-office:INV-010 | M-02 |
| box-office:INV-011 | M-08 |
| box-office:POL-001 | M-01 |
| box-office:POL-002 | M-01 |
| box-office:CST-001 | M-02 |
| box-office:CST-002 | M-08 |
| box-office:CST-003 | M-08 |
| box-office:CST-004 | M-02 |
| box-office:CST-005 | M-08 |

## 9. Revisions

### Revision 1 — attempt 2
- trigger: `VD-INFEASIBLE` finding routed to architect: `tests/app/app.test.ts:139` (check-order test) drives the store clock through `createStore({ now })`, moves it forward 2 hours and expects 409 E_EVENT_NOT_ON_SALE from `POST /orders`, while `src/orders/index.ts` judged on-sale and expiry with `Date.now()` and the `Store` interface exposed no clock accessor.
- spec_ids: [box-office:INV-011]
- module: M-02 store (interface), M-04 events and M-05 orders (their time comparisons); M-01, M-03, M-06, M-07 and M-08 unchanged, and TD-TOOLING unchanged.
- change: `Store` gains `now(): number` returning the instant of the clock `createStore` receives; the notes of M-02, M-04 and M-05 state that every module reads the current instant from `store.now()` and never from `Date.now()`; DD-14's refund-window wording now names `store.now()`; new DD-23 records the decision and its evidence. No `owns` area, other exported symbol or traceability row changed.
- rationale: the obligation of `box-office:INV-011` must be observable at the public interface, so the time source a test or the composition root sets is the only clock the endpoints observe; an injected-clock test can then reach the 409 that a `Date.now()` comparison made unreachable.

