import * as fs from "node:fs";
import * as nodePath from "node:path";
import * as nodeProcess from "node:process";

export interface ExpenseDraft {
  readonly amountCents: number;
  readonly category: string;
  readonly date: string;
  readonly note?: string;
}

export interface Expense extends ExpenseDraft {
  readonly id: number;
}

export interface Ledger {
  readonly nextId: number;
  readonly expenses: readonly Expense[];
}

export type ReadLedgerResult =
  | { readonly ok: true; readonly ledger: Ledger; readonly exists: boolean }
  | { readonly ok: false; readonly path: string };

export type WriteLedgerResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly path: string };

const CATEGORY_PATTERN = /^[a-z0-9-]{1,20}$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCalendarDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

function parseExpense(value: unknown): Expense | null {
  if (!isRecord(value)) return null;
  const { id, amount_cents: amountCents, category, date, note } = value;
  if (typeof id !== "number" || !Number.isInteger(id) || id < 1) return null;
  if (typeof amountCents !== "number" || !Number.isInteger(amountCents)) return null;
  if (typeof category !== "string" || !CATEGORY_PATTERN.test(category)) return null;
  if (typeof date !== "string" || !isCalendarDate(date)) return null;
  if (note === undefined) return { id, amountCents, category, date };
  if (typeof note !== "string") return null;
  return { id, amountCents, category, date, note };
}

function parseExpenses(value: unknown): Expense[] | null {
  if (!Array.isArray(value)) return null;
  const expenses: Expense[] = [];
  const seen = new Set<number>();
  for (const item of value) {
    const candidate: unknown = item;
    const expense = parseExpense(candidate);
    if (expense === null || seen.has(expense.id)) return null;
    seen.add(expense.id);
    expenses.push(expense);
  }
  return expenses;
}

function aboveHighest(expenses: readonly Expense[]): number {
  return expenses.reduce((highest, expense) => Math.max(highest, expense.id), 0) + 1;
}

function parseLedger(document: unknown): Ledger | null {
  if (Array.isArray(document)) {
    const expenses = parseExpenses(document);
    return expenses === null ? null : { nextId: aboveHighest(expenses), expenses };
  }
  if (!isRecord(document)) return null;
  const nextId = document["next_id"];
  if (typeof nextId !== "number" || !Number.isInteger(nextId) || nextId < 1) return null;
  const expenses = parseExpenses(document["expenses"]);
  if (expenses === null) return null;
  return { nextId: Math.max(nextId, aboveHighest(expenses)), expenses };
}

function toDocumentExpense(expense: Expense): Record<string, unknown> {
  const base = { id: expense.id, amount_cents: expense.amountCents, category: expense.category, date: expense.date };
  return expense.note === undefined ? base : { ...base, note: expense.note };
}

export function resolveLedgerPath(env: Record<string, string | undefined>): string {
  const configured = env["LEDGER_FILE"];
  if (configured !== undefined && configured !== "") return configured;
  return nodePath.join(nodeProcess.cwd(), "ledger.json");
}

export function readLedger(path: string): ReadLedgerResult {
  let text: string;
  try {
    text = fs.readFileSync(path, "utf8");
  } catch (error) {
    if (isRecord(error) && error["code"] === "ENOENT") {
      return { ok: true, exists: false, ledger: { nextId: 1, expenses: [] } };
    }
    return { ok: false, path };
  }
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return { ok: false, path };
  }
  const ledger = parseLedger(document);
  return ledger === null ? { ok: false, path } : { ok: true, exists: true, ledger };
}

export function writeLedger(path: string, ledger: Ledger): WriteLedgerResult {
  const document = { next_id: ledger.nextId, expenses: ledger.expenses.map(toDocumentExpense) };
  try {
    fs.writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  } catch {
    return { ok: false, path };
  }
  return { ok: true };
}

export function addExpense(ledger: Ledger, draft: ExpenseDraft): { readonly ledger: Ledger; readonly id: number } {
  const id = Math.max(ledger.nextId, aboveHighest(ledger.expenses));
  const expense: Expense = { id, ...draft };
  return { id, ledger: { nextId: id + 1, expenses: [...ledger.expenses, expense] } };
}

export function removeExpense(ledger: Ledger, id: number): Ledger | null {
  if (!ledger.expenses.some((expense) => expense.id === id)) return null;
  return { nextId: ledger.nextId, expenses: ledger.expenses.filter((expense) => expense.id !== id) };
}
