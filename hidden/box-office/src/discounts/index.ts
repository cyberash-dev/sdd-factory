import { ApiError, isInteger, isPlainObject, parseTime } from "../core/index.js";
import type { ApiResponse, HttpRequest } from "../core/index.js";
import type { Store } from "../store/index.js";

const CODE_PATTERN = /^[A-Za-z0-9]{3,20}$/;

interface DiscountDefinition {
  code: string;
  percentOff: number | null;
  amountOffCents: number | null;
  maxUses: number | null;
  expiresAtMs: number | null;
}

function invalid(detail: string): ApiError {
  return new ApiError("E_INVALID_INPUT", detail);
}

function parseDefinition(body: unknown): DiscountDefinition {
  if (!isPlainObject(body)) {
    throw invalid("body must be a JSON object");
  }
  const { code, percentOff, amountOffCents, maxUses, expiresAt } = body;
  if (typeof code !== "string" || !CODE_PATTERN.test(code)) {
    throw invalid("code must be 3-20 letters and digits");
  }
  const hasPercent = percentOff !== undefined;
  const hasAmount = amountOffCents !== undefined;
  if (hasPercent === hasAmount) {
    throw invalid("exactly one of percentOff and amountOffCents is required");
  }
  if (hasPercent && (!isInteger(percentOff) || percentOff < 1 || percentOff > 100)) {
    throw invalid("percentOff must be an integer in 1-100");
  }
  if (hasAmount && (!isInteger(amountOffCents) || amountOffCents < 1)) {
    throw invalid("amountOffCents must be an integer of at least 1");
  }
  let uses: number | null = null;
  if (maxUses !== undefined) {
    if (!isInteger(maxUses) || maxUses < 1) {
      throw invalid("maxUses must be an integer of at least 1");
    }
    uses = maxUses;
  }
  let expiresAtMs: number | null = null;
  if (expiresAt !== undefined) {
    const ms = parseTime(expiresAt);
    if (ms === undefined) {
      throw invalid("expiresAt must be readable as a time");
    }
    expiresAtMs = ms;
  }
  return {
    code: code.toUpperCase(),
    percentOff: hasPercent && isInteger(percentOff) ? percentOff : null,
    amountOffCents: hasAmount && isInteger(amountOffCents) ? amountOffCents : null,
    maxUses: uses,
    expiresAtMs,
  };
}

export function createDiscountCode(req: HttpRequest, store: Store): ApiResponse {
  const definition = parseDefinition(req.body);
  const event = store.getEvent(req.params["id"] ?? "");
  if (event === undefined) {
    throw new ApiError("E_NOT_FOUND", "no event carries the id");
  }
  if (req.caller === null || req.caller.id !== event.organizerId) {
    throw new ApiError("E_FORBIDDEN", "the caller did not create the event");
  }
  if (store.findDiscountCode(event.id, definition.code) !== undefined) {
    throw new ApiError("E_CODE_TAKEN", "the event already has that code");
  }
  return { status: 201, body: store.createDiscountCode(event.id, definition) };
}
