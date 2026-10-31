import { ApiError, isPlainObject } from "../core/index.js";
import type { ApiResponse, HttpRequest } from "../core/index.js";
import type { Role, Store } from "../store/index.js";

const MIN_PASSWORD_LENGTH = 8;
const MAX_NAME_LENGTH = 100;

function isRole(value: unknown): value is Role {
  return value === "organizer" || value === "customer";
}

function hasAtThenDot(email: string): boolean {
  const at = email.indexOf("@");
  return at >= 0 && email.indexOf(".", at) >= 0;
}

export function createAccount(req: HttpRequest, store: Store): ApiResponse {
  const body = req.body;
  if (!isPlainObject(body)) {
    throw new ApiError("E_INVALID_INPUT", "body must be a JSON object");
  }
  const { email, password, name, role } = body;
  if (typeof email !== "string" || !hasAtThenDot(email)) {
    throw new ApiError("E_INVALID_INPUT", "email must contain @ followed later by .");
  }
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    throw new ApiError("E_INVALID_INPUT", "secret must have at least 8 characters");
  }
  if (typeof name !== "string" || name.length < 1 || name.length > MAX_NAME_LENGTH) {
    throw new ApiError("E_INVALID_INPUT", "name must have 1 to 100 characters");
  }
  if (!isRole(role)) {
    throw new ApiError("E_INVALID_INPUT", "role must be organizer or customer");
  }
  const canonicalEmail = email.toLowerCase();
  if (store.findAccountByEmail(canonicalEmail) !== undefined) {
    throw new ApiError("E_EMAIL_TAKEN", "email is already registered");
  }
  const account = store.createAccount({ email: canonicalEmail, password, name, role });
  return { status: 201, body: account };
}

export function createSession(req: HttpRequest, store: Store): ApiResponse {
  const body = req.body;
  if (!isPlainObject(body)) {
    throw new ApiError("E_INVALID_INPUT", "body must be a JSON object");
  }
  const { email, password } = body;
  if (typeof email !== "string" || typeof password !== "string") {
    throw new ApiError("E_INVALID_INPUT", "email and secret are required strings");
  }
  const account = store.verifyCredentials(email.toLowerCase(), password);
  if (account === undefined) {
    throw new ApiError("E_UNAUTHENTICATED", "credentials match no account");
  }
  return { status: 200, body: { token: store.issueToken(account.id) } };
}

export function getMe(req: HttpRequest, store: Store): ApiResponse {
  const account = req.caller === null ? undefined : store.findAccountById(req.caller.id);
  if (account === undefined) {
    throw new ApiError("E_UNAUTHENTICATED", "a valid token is required");
  }
  return { status: 200, body: account };
}
