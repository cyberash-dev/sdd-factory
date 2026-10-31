import { randomUUID } from "node:crypto";

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

const MAX_TICKETS_PER_EVENT = 6;

interface TierRecord {
  id: string;
  name: string;
  priceCents: number;
  quantity: number;
}

interface EventRecord {
  id: string;
  title: string;
  venue: string;
  startsAt: string;
  status: "on_sale" | "cancelled";
  organizerId: string;
  tiers: TierRecord[];
}

interface OrderRecord {
  id: string;
  eventId: string;
  customerId: string;
  status: Order["status"];
  items: OrderItem[];
  subtotalCents: number;
  discountCode: string | null;
  discountCents: number;
  totalCents: number;
  createdAtMs: number;
  expiresAtMs: number;
  paidAtMs: number | null;
}

interface DiscountRecord {
  code: string;
  percentOff: number | null;
  amountOffCents: number | null;
  maxUses: number | null;
  expiresAtMs: number | null;
}

interface WaitlistRecord {
  id: string;
  eventId: string;
  tierId: string;
  customerId: string;
  quantity: number;
}

interface AccountRecord extends Account {
  readonly password: string;
}

function orderQuantity(order: OrderRecord, tierId?: string): number {
  return order.items.reduce((n, i) => (tierId === undefined || i.tierId === tierId ? n + i.quantity : n), 0);
}

export function createStore(options: { holdSeconds: number; now?: () => number }): Store {
  const clock = options.now ?? Date.now;
  let counter = 0;
  const mint = (prefix: string): string => {
    counter += 1;
    return `${prefix}_${counter}`;
  };

  const accounts = new Map<string, AccountRecord>();
  const tokens = new Map<string, string>();
  const events = new Map<string, EventRecord>();
  const orders = new Map<string, OrderRecord>();
  const discounts = new Map<string, DiscountRecord>();
  const waitlist: WaitlistRecord[] = [];

  const discountKey = (eventId: string, code: string): string => `${eventId}:${code.toUpperCase()}`;

  const publicAccount = (a: AccountRecord): Account => ({ id: a.id, email: a.email, name: a.name, role: a.role });

  const ticketsInStatus = (eventId: string, tierId: string, status: Order["status"]): number => {
    let n = 0;
    for (const o of orders.values()) {
      if (o.eventId === eventId && o.status === status) n += orderQuantity(o, tierId);
    }
    return n;
  };

  const availableOf = (eventId: string, tier: TierRecord): number =>
    tier.quantity - ticketsInStatus(eventId, tier.id, "held") - ticketsInStatus(eventId, tier.id, "paid");

  const publicEvent = (e: EventRecord): Event => ({
    id: e.id,
    title: e.title,
    venue: e.venue,
    startsAt: e.startsAt,
    status: e.status,
    organizerId: e.organizerId,
    tiers: e.tiers.map((t) => ({
      id: t.id,
      name: t.name,
      priceCents: t.priceCents,
      quantity: t.quantity,
      available: availableOf(e.id, t),
    })),
  });

  const publicOrder = (o: OrderRecord): Order => ({
    id: o.id,
    eventId: o.eventId,
    customerId: o.customerId,
    status: o.status,
    items: o.items.map((i) => ({ ...i })),
    subtotalCents: o.subtotalCents,
    discountCode: o.discountCode,
    discountCents: o.discountCents,
    totalCents: o.totalCents,
    createdAt: new Date(o.createdAtMs).toISOString(),
    expiresAt: new Date(o.expiresAtMs).toISOString(),
    paidAt: o.paidAtMs === null ? null : new Date(o.paidAtMs).toISOString(),
  });

  const usesOf = (eventId: string, code: string): number => {
    let n = 0;
    for (const o of orders.values()) {
      if (o.eventId === eventId && o.discountCode === code && (o.status === "held" || o.status === "paid")) n += 1;
    }
    return n;
  };

  const publicDiscount = (eventId: string, d: DiscountRecord): DiscountCode => ({
    code: d.code,
    percentOff: d.percentOff,
    amountOffCents: d.amountOffCents,
    maxUses: d.maxUses,
    expiresAt: d.expiresAtMs === null ? null : new Date(d.expiresAtMs).toISOString(),
    uses: usesOf(eventId, d.code),
  });

  const queueOf = (tierId: string): WaitlistRecord[] => waitlist.filter((w) => w.tierId === tierId);

  const publicEntry = (w: WaitlistRecord): WaitlistEntry => ({
    id: w.id,
    eventId: w.eventId,
    tierId: w.tierId,
    quantity: w.quantity,
    position: queueOf(w.tierId).indexOf(w) + 1,
  });

  const tierTicketsHeldOrPaid = (customerId: string, eventId: string): number => {
    let n = 0;
    for (const o of orders.values()) {
      if (o.customerId === customerId && o.eventId === eventId && (o.status === "held" || o.status === "paid")) {
        n += orderQuantity(o);
      }
    }
    return n;
  };

  const removeEntry = (entry: WaitlistRecord): void => {
    const index = waitlist.indexOf(entry);
    if (index >= 0) waitlist.splice(index, 1);
  };

  const serveTier = (eventId: string, tierId: string, nowMs: number): void => {
    const event = events.get(eventId);
    const tier = event?.tiers.find((t) => t.id === tierId);
    if (event === undefined || tier === undefined || event.status !== "on_sale") return;
    for (;;) {
      const first = queueOf(tierId)[0];
      if (first === undefined) return;
      if (tierTicketsHeldOrPaid(first.customerId, eventId) + first.quantity > MAX_TICKETS_PER_EVENT) {
        removeEntry(first);
        continue;
      }
      if (first.quantity > availableOf(eventId, tier)) return;
      const subtotal = first.quantity * tier.priceCents;
      const id = mint("ord");
      orders.set(id, {
        id,
        eventId,
        customerId: first.customerId,
        status: "held",
        items: [{ tierId, quantity: first.quantity, unitPriceCents: tier.priceCents }],
        subtotalCents: subtotal,
        discountCode: null,
        discountCents: 0,
        totalCents: subtotal,
        createdAtMs: nowMs,
        expiresAtMs: nowMs + options.holdSeconds * 1000,
        paidAtMs: null,
      });
      removeEntry(first);
    }
  };

  const reconcile = (nowMs?: number): void => {
    const at = nowMs ?? clock();
    const affected = new Map<string, { eventId: string; tierId: string }>();
    for (const o of orders.values()) {
      if (o.status === "held" && o.expiresAtMs < at) {
        o.status = "expired";
        for (const i of o.items) affected.set(i.tierId, { eventId: o.eventId, tierId: i.tierId });
      }
    }
    for (const { eventId, tierId } of affected.values()) serveTier(eventId, tierId, at);
  };

  const requireOrder = (orderId: string): OrderRecord => {
    const o = orders.get(orderId);
    if (o === undefined) throw new Error(`unknown order ${orderId}`);
    return o;
  };

  const requireEvent = (eventId: string): EventRecord => {
    const e = events.get(eventId);
    if (e === undefined) throw new Error(`unknown event ${eventId}`);
    return e;
  };

  return {
    reconcile,

    createAccount(input) {
      const record: AccountRecord = { id: mint("usr"), ...input };
      accounts.set(record.id, record);
      return publicAccount(record);
    },
    findAccountByEmail(email) {
      for (const a of accounts.values()) if (a.email === email) return publicAccount(a);
      return undefined;
    },
    findAccountById(id) {
      const a = accounts.get(id);
      return a === undefined ? undefined : publicAccount(a);
    },
    verifyCredentials(email, password) {
      for (const a of accounts.values()) {
        if (a.email === email && a.password === password) return publicAccount(a);
      }
      return undefined;
    },
    issueToken(accountId) {
      const token = `tok_${randomUUID()}`;
      tokens.set(token, accountId);
      return token;
    },
    resolveToken(token) {
      const id = tokens.get(token);
      const a = id === undefined ? undefined : accounts.get(id);
      return a === undefined ? undefined : publicAccount(a);
    },

    createEvent(input) {
      const record: EventRecord = {
        id: mint("evt"),
        title: input.title,
        venue: input.venue,
        startsAt: input.startsAt,
        status: "on_sale",
        organizerId: input.organizerId,
        tiers: input.tiers.map((t) => ({
          id: mint("tir"),
          name: t.name,
          priceCents: t.priceCents,
          quantity: t.quantity,
        })),
      };
      events.set(record.id, record);
      reconcile();
      return publicEvent(record);
    },
    listEvents(filter) {
      reconcile();
      const q = filter.q?.toLowerCase();
      const matching = [...events.values()]
        .filter((e) => e.status === "on_sale")
        .filter((e) => {
          const ms = Date.parse(e.startsAt);
          if (filter.fromMs !== undefined && ms < filter.fromMs) return false;
          if (filter.toMs !== undefined && ms > filter.toMs) return false;
          if (q !== undefined && !e.title.toLowerCase().includes(q) && !e.venue.toLowerCase().includes(q)) return false;
          return true;
        })
        .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
      const start = (filter.page - 1) * filter.pageSize;
      return {
        items: matching.slice(start, start + filter.pageSize).map(publicEvent),
        page: filter.page,
        pageSize: filter.pageSize,
        total: matching.length,
      };
    },
    getEvent(eventId) {
      reconcile();
      const e = events.get(eventId);
      return e === undefined ? undefined : publicEvent(e);
    },
    cancelEvent(eventId) {
      reconcile();
      const event = requireEvent(eventId);
      event.status = "cancelled";
      for (const o of orders.values()) {
        if (o.eventId !== eventId) continue;
        if (o.status === "paid") o.status = "refunded";
        else if (o.status === "held") o.status = "cancelled";
      }
      for (const w of waitlist.filter((entry) => entry.eventId === eventId)) removeEntry(w);
      return publicEvent(event);
    },
    getReport(eventId) {
      reconcile();
      const event = requireEvent(eventId);
      let gross = 0;
      let discount = 0;
      let refunded = 0;
      let net = 0;
      for (const o of orders.values()) {
        if (o.eventId !== eventId) continue;
        if (o.status === "paid") {
          gross += o.subtotalCents;
          discount += o.discountCents;
          net += o.totalCents;
        } else if (o.status === "refunded") {
          refunded += o.totalCents;
        }
      }
      return {
        eventId,
        tiers: event.tiers.map((t) => ({
          tierId: t.id,
          name: t.name,
          sold: ticketsInStatus(eventId, t.id, "paid"),
          held: ticketsInStatus(eventId, t.id, "held"),
          available: availableOf(eventId, t),
        })),
        grossCents: gross,
        discountCents: discount,
        refundedCents: refunded,
        netCents: net,
      };
    },

    createDiscountCode(eventId, input) {
      const record: DiscountRecord = {
        code: input.code.toUpperCase(),
        percentOff: input.percentOff,
        amountOffCents: input.amountOffCents,
        maxUses: input.maxUses,
        expiresAtMs: input.expiresAtMs,
      };
      discounts.set(discountKey(eventId, record.code), record);
      reconcile();
      return publicDiscount(eventId, record);
    },
    findDiscountCode(eventId, code) {
      reconcile();
      const d = discounts.get(discountKey(eventId, code));
      return d === undefined ? undefined : publicDiscount(eventId, d);
    },

    availableTickets(eventId, tierId) {
      reconcile();
      const tier = events.get(eventId)?.tiers.find((t) => t.id === tierId);
      return tier === undefined ? 0 : availableOf(eventId, tier);
    },
    ticketsHeldOrPaid(customerId, eventId) {
      reconcile();
      return tierTicketsHeldOrPaid(customerId, eventId);
    },

    holdOrder(input) {
      const nowMs = clock();
      reconcile(nowMs);
      const event = requireEvent(input.eventId);
      const items: OrderItem[] = input.items.map((item) => {
        const tier = event.tiers.find((t) => t.id === item.tierId);
        if (tier === undefined) throw new Error(`unknown tier ${item.tierId}`);
        return { tierId: tier.id, quantity: item.quantity, unitPriceCents: tier.priceCents };
      });
      const subtotal = items.reduce((n, i) => n + i.quantity * i.unitPriceCents, 0);
      let code: string | null = null;
      let discountCents = 0;
      if (input.discountCode !== null) {
        const d = discounts.get(discountKey(input.eventId, input.discountCode));
        if (d === undefined) throw new Error(`unknown discount code ${input.discountCode}`);
        code = d.code;
        discountCents =
          d.percentOff !== null
            ? Math.floor((subtotal * d.percentOff) / 100)
            : Math.min(d.amountOffCents ?? 0, subtotal);
      }
      const id = mint("ord");
      const record: OrderRecord = {
        id,
        eventId: input.eventId,
        customerId: input.customerId,
        status: "held",
        items,
        subtotalCents: subtotal,
        discountCode: code,
        discountCents,
        totalCents: subtotal - discountCents,
        createdAtMs: nowMs,
        expiresAtMs: nowMs + options.holdSeconds * 1000,
        paidAtMs: null,
      };
      orders.set(id, record);
      return publicOrder(record);
    },
    getOrder(orderId) {
      reconcile();
      const o = orders.get(orderId);
      return o === undefined ? undefined : publicOrder(o);
    },
    listOrdersByCustomer(customerId) {
      reconcile();
      return [...orders.values()].filter((o) => o.customerId === customerId).map(publicOrder);
    },
    markPaid(orderId) {
      const nowMs = clock();
      reconcile(nowMs);
      const o = requireOrder(orderId);
      o.status = "paid";
      o.paidAtMs = nowMs;
      return publicOrder(o);
    },
    releaseOrder(orderId, status) {
      const nowMs = clock();
      reconcile(nowMs);
      const o = requireOrder(orderId);
      o.status = status;
      for (const i of o.items) serveTier(o.eventId, i.tierId, nowMs);
      return publicOrder(o);
    },

    joinWaitlist(input) {
      reconcile();
      const record: WaitlistRecord = { id: mint("wat"), ...input };
      waitlist.push(record);
      return publicEntry(record);
    },
    findWaitlistEntry(customerId, tierId) {
      reconcile();
      const w = waitlist.find((entry) => entry.customerId === customerId && entry.tierId === tierId);
      return w === undefined ? undefined : publicEntry(w);
    },
    listWaitlistByCustomer(customerId) {
      reconcile();
      return waitlist.filter((w) => w.customerId === customerId).map(publicEntry);
    },
  };
}
