import { describe, expect, it } from "vitest";
import { createAccount, createSession, getMe } from "../../src/accounts/index.js";
import { ApiError } from "../../src/core/index.js";
import type { ApiResponse, HttpRequest } from "../../src/core/index.js";
import { createStore } from "../../src/store/index.js";
import type { Store } from "../../src/store/index.js";

interface Outcome {
  status: number | undefined;
  code: string | undefined;
  body: unknown;
  text: string;
}

function call(fn: () => ApiResponse): Outcome {
  try {
    const r = fn();
    const b = r.body as Record<string, unknown> | null;
    const msg = b !== null && typeof b === "object" && typeof b.error === "string" ? b.error : undefined;
    const code = msg === undefined ? undefined : /^(E_[A-Z_]+)/.exec(msg)?.[1];
    return { status: r.status, code, body: r.body, text: JSON.stringify(r.body) };
  } catch (e) {
    if (e instanceof ApiError) {
      return { status: e.status, code: e.code, body: { error: e.message }, text: e.message };
    }
    return { status: undefined, code: undefined, body: { error: String(e) }, text: String(e) };
  }
}

function req(method: string, path: string, body: unknown, callerId: string | null = null): HttpRequest {
  return {
    method,
    path,
    params: {},
    query: new URLSearchParams(),
    body,
    caller: callerId === null ? null : { id: callerId },
  };
}

function newStore(): Store {
  return createStore({ holdSeconds: 600 });
}

const ADA = { email: "ada@example.com", password: "correct-horse", name: "Ada", role: "organizer" };
const BO = { email: "bo@example.com", password: "12345678", name: "Bo", role: "customer" };

function register(store: Store, body: unknown): Outcome {
  return call(() => createAccount(req("POST", "/users", body), store));
}

function login(store: Store, email: unknown, password: unknown): Outcome {
  return call(() => createSession(req("POST", "/sessions", { email, password }), store));
}

function me(store: Store, token: string): Outcome {
  const account = store.resolveToken(token);
  return call(() => getMe(req("GET", "/me", undefined, account?.id ?? null), store));
}

function keysOf(body: unknown): string[] {
  return Object.keys(body as object).sort();
}

describe("registration", () => {
  // @covers box-office:CTR-001
  it("a public registration of a customer Account answers 201 with exactly id, email, name and role", () => {
    const store = newStore();
    const out = register(store, BO);
    expect(out.status).toBe(201);
    expect(keysOf(out.body)).toEqual(["email", "id", "name", "role"]);
    expect(out.body).toMatchObject({ email: "bo@example.com", name: "Bo", role: "customer" });
    expect(out.text).not.toContain("12345678");
  });

  // @covers box-office:BEH-001
  it("a valid organizer registration returns the submitted values, no password, and GET /me returns the same Account", () => {
    const store = newStore();
    const out = register(store, ADA);
    expect(out.status).toBe(201);
    expect(keysOf(out.body)).toEqual(["email", "id", "name", "role"]);
    const acc = out.body as { id: unknown; email: string; name: string; role: string };
    expect(typeof acc.id).toBe("string");
    expect((acc.id as string).length).toBeGreaterThan(0);
    expect(acc.email).toBe("ada@example.com");
    expect(acc.name).toBe("Ada");
    expect(acc.role).toBe("organizer");
    expect(out.text).not.toContain("correct-horse");
    const session = login(store, "ada@example.com", "correct-horse");
    expect(session.status).toBe(200);
    const mine = me(store, (session.body as { token: string }).token);
    expect(mine.status).toBe(200);
    expect(mine.body).toEqual(out.body);
  });

  it("a name of 101 characters is E_INVALID_INPUT and creates no Account", () => {
    const store = newStore();
    const out = register(store, { ...ADA, name: "n".repeat(101) });
    expect(out.status).toBe(400);
    expect(out.code).toBe("E_INVALID_INPUT");
    expect(store.findAccountByEmail("ada@example.com")).toBeUndefined();
  });

  it("a body that is not an object is E_INVALID_INPUT without a token requirement", () => {
    const store = newStore();
    for (const body of [[], "not-json-at-all", null, 7]) {
      const out = register(store, body);
      expect(out.status).toBe(400);
      expect(out.code).toBe("E_INVALID_INPUT");
    }
  });

  // @covers box-office:BEH-002
  it("each field outside its stated rule yields 400 E_INVALID_INPUT and creates no Account", () => {
    const cases: Record<string, unknown>[] = [
      { ...ADA, password: "1234567" },
      { ...ADA, name: "n".repeat(101) },
      { ...ADA, name: "" },
      { ...ADA, email: "ada@exampleco" },
      { ...ADA, email: "adaexample.com" },
      { ...ADA, email: "a.b@cd" },
      { ...ADA, role: "admin" },
      { ...ADA, password: 12345678 },
      { ...ADA, name: 5 },
      {},
    ];
    for (const body of cases) {
      const store = newStore();
      const out = register(store, body);
      expect(out.status).toBe(400);
      expect(out.code).toBe("E_INVALID_INPUT");
      expect(out.text).not.toContain("\"id\"");
      expect(store.findAccountByEmail("ada@example.com")).toBeUndefined();
      expect(register(store, ADA).status).toBe(201);
    }
  });

  it.each([
    ["password of 8 characters", { ...ADA, password: "12345678" }],
    ["name of 100 characters", { ...ADA, name: "n".repeat(100) }],
    ["name of 1 character", { ...ADA, name: "A" }],
    ["email a@b.co", { ...ADA, email: "a@b.co", password: "12345678" }],
  ])("a registration with %s is accepted with 201", (_label, body) => {
    const out = register(newStore(), body);
    expect(out.status).toBe(201);
    expect(keysOf(out.body)).toEqual(["email", "id", "name", "role"]);
  });

  // @covers box-office:BEH-003
  it("a case-different duplicate email is 409 E_EMAIL_TAKEN and leaves the first Account and no second one", () => {
    const store = newStore();
    const first = register(store, ADA);
    expect(first.status).toBe(201);
    const dup = register(store, { ...ADA, email: "Ada@Example.com", password: "another-pass" });
    expect(dup.status).toBe(409);
    expect(dup.code).toBe("E_EMAIL_TAKEN");
    expect(dup.text).not.toContain("\"role\"");
    expect(login(store, "ada@example.com", "correct-horse").status).toBe(200);
    const rejected = login(store, "Ada@Example.com", "another-pass");
    expect(rejected.status).toBe(401);
    expect(rejected.code).toBe("E_UNAUTHENTICATED");
    expect(store.findAccountByEmail("ada@example.com")?.id).toBe((first.body as { id: string }).id);
  });

  it.each([
    ["identical email", "ada@example.com"],
    ["upper-case email", "ADA@EXAMPLE.COM"],
  ])("a registration with the %s is 409 E_EMAIL_TAKEN", (_label, email) => {
    const store = newStore();
    expect(register(store, ADA).status).toBe(201);
    const dup = register(store, { ...ADA, email });
    expect(dup.status).toBe(409);
    expect(dup.code).toBe("E_EMAIL_TAKEN");
  });

  it("a different email is registered with 201 and its own id", () => {
    const store = newStore();
    const a = register(store, ADA);
    const b = register(store, { ...ADA, email: "bob@example.com" });
    expect(b.status).toBe(201);
    expect((b.body as { id: string }).id).not.toBe((a.body as { id: string }).id);
  });
});

describe("session", () => {
  // @covers box-office:CTR-002
  it("correct credentials answer 200 with a token and a wrong-case password answers 401 E_UNAUTHENTICATED", () => {
    const store = newStore();
    register(store, ADA);
    const ok = login(store, "ada@example.com", "correct-horse");
    expect(ok.status).toBe(200);
    expect(typeof (ok.body as { token: unknown }).token).toBe("string");
    const bad = login(store, "ada@example.com", "Correct-Horse");
    expect(bad.status).toBe(401);
    expect(bad.code).toBe("E_UNAUTHENTICATED");
    expect(bad.text).not.toContain("token");
  });

  // @covers box-office:BEH-004
  it("a matching pair answers 200 with only a non-empty token that GET /me accepts", () => {
    const store = newStore();
    const reg = register(store, ADA);
    const ok = login(store, "ada@example.com", "correct-horse");
    expect(ok.status).toBe(200);
    expect(keysOf(ok.body)).toEqual(["token"]);
    const token = (ok.body as { token: string }).token;
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
    const mine = me(store, token);
    expect(mine.status).toBe(200);
    expect(mine.body).toEqual(reg.body);
  });

  it.each([
    ["wrong password", "ada@example.com", "wrong-horse"],
    ["unregistered email", "nobody@example.com", "correct-horse"],
  ])("%s answers 401 E_UNAUTHENTICATED with no token and no account field", (_label, email, password) => {
    const store = newStore();
    register(store, ADA);
    const out = login(store, email, password);
    expect(out.status).toBe(401);
    expect(out.code).toBe("E_UNAUTHENTICATED");
    expect(out.text).not.toContain("token");
    expect(out.text).not.toContain("\"email\"");
  });

  it.each([
    ["missing email", { password: "correct-horse" }],
    ["missing password", { email: "ada@example.com" }],
    ["empty object", {}],
    ["array body", []],
    ["string body", "not-json-at-all"],
  ])("a session body with %s is 400 E_INVALID_INPUT and not 401", (_label, body) => {
    const store = newStore();
    register(store, ADA);
    const out = call(() => createSession(req("POST", "/sessions", body), store));
    expect(out.status).toBe(400);
    expect(out.code).toBe("E_INVALID_INPUT");
    expect(out.text).not.toContain("token");
  });
});

describe("caller account", () => {
  // @covers box-office:CTR-003
  it("GET /me names the Account of the token for an organizer and for a customer", () => {
    const store = newStore();
    const a = register(store, ADA);
    const b = register(store, BO);
    const ta = (login(store, "ada@example.com", "correct-horse").body as { token: string }).token;
    const tb = (login(store, "bo@example.com", "12345678").body as { token: string }).token;
    const ma = me(store, ta);
    const mb = me(store, tb);
    expect(ma.status).toBe(200);
    expect(mb.status).toBe(200);
    expect(ma.body).toEqual(a.body);
    expect(mb.body).toEqual(b.body);
    expect((ma.body as { id: string }).id).not.toBe((mb.body as { id: string }).id);
  });

  // @covers box-office:BEH-006
  it("GET /me answers exactly id, email, name and role of the customer and no password", () => {
    const store = newStore();
    register(store, ADA);
    const b = register(store, BO);
    const tb = (login(store, "bo@example.com", "12345678").body as { token: string }).token;
    const out = me(store, tb);
    expect(out.status).toBe(200);
    expect(keysOf(out.body)).toEqual(["email", "id", "name", "role"]);
    expect(out.body).toMatchObject({ email: "bo@example.com", name: "Bo", role: "customer" });
    expect((out.body as { id: string }).id).toBe((b.body as { id: string }).id);
    expect(out.text).not.toContain("12345678");
  });

  it("GET /me without an authenticated caller is 401 E_UNAUTHENTICATED with no account field", () => {
    const store = newStore();
    register(store, ADA);
    const out = call(() => getMe(req("GET", "/me", undefined, null), store));
    expect(out.status).toBe(401);
    expect(out.code).toBe("E_UNAUTHENTICATED");
    expect(out.text).not.toContain("ada@example.com");
    expect(out.text).not.toContain("organizer");
  });
});

describe("password secrecy", () => {
  // @covers box-office:INV-001
  it("no response of registration, duplicate, session, GET /me or rejection contains the password", () => {
    const store = newStore();
    const reg = register(store, ADA);
    const dup = register(store, { ...ADA, email: "Ada@Example.com" });
    const bad = register(store, { ...ADA, email: "x@example.com", role: "admin" });
    const sess = login(store, "ada@example.com", "correct-horse");
    const wrong = login(store, "ada@example.com", "wrong-horse");
    const mine = me(store, (sess.body as { token: string }).token);
    const anon = call(() => getMe(req("GET", "/me", undefined, null), store));
    expect(reg.status).toBe(201);
    expect(dup.status).toBe(409);
    expect(bad.status).toBe(400);
    expect(sess.status).toBe(200);
    expect(wrong.status).toBe(401);
    expect(mine.status).toBe(200);
    expect(anon.status).toBe(401);
    for (const out of [reg, dup, bad, sess, wrong, mine, anon]) {
      expect(out.text).not.toContain("correct-horse");
      expect(out.text.toLowerCase()).not.toContain("password");
    }
    expect(keysOf(sess.body)).toEqual(["token"]);
    expect(keysOf(mine.body)).toEqual(["email", "id", "name", "role"]);
  });
});
