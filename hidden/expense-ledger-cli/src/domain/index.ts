export interface AddCommand {
  readonly kind: "add";
  readonly amountCents: number;
  readonly category: string;
  readonly date?: string;
  readonly note?: string;
}

export interface ListCommand {
  readonly kind: "list";
  readonly category?: string;
  readonly from?: string;
  readonly to?: string;
}

export interface SummaryCommand {
  readonly kind: "summary";
  readonly month?: string;
}

export interface RmCommand {
  readonly kind: "rm";
  readonly id: number;
}

export type Command =
  | AddCommand
  | ListCommand
  | SummaryCommand
  | RmCommand
  | { readonly kind: "export" }
  | { readonly kind: "help" };

const AMOUNT_PATTERN = /^(\d+)(?:\.(\d{1,2}))?$/;
const CATEGORY_PATTERN = /^[a-z0-9-]{1,20}$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function parseAmountToCents(text: string): number | null {
  const match = AMOUNT_PATTERN.exec(text);
  if (match === null) {
    return null;
  }
  const whole = match[1] ?? "";
  const fraction = (match[2] ?? "").padEnd(2, "0");
  const cents = Number(whole) * 100 + Number(fraction);
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    return null;
  }
  return cents;
}

export function formatAmountCents(cents: number): string {
  const whole = Math.floor(cents / 100);
  const fraction = String(cents % 100).padStart(2, "0");
  return `${whole}.${fraction}`;
}

export function isCategory(text: string): boolean {
  return CATEGORY_PATTERN.test(text);
}

export function isCalendarDate(text: string): boolean {
  const match = DATE_PATTERN.exec(text);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  probe.setUTCFullYear(year);
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

export function isMonth(text: string): boolean {
  return MONTH_PATTERN.test(text);
}

export function utcDayOf(now: Date): string {
  return now.toISOString().slice(0, 10);
}
