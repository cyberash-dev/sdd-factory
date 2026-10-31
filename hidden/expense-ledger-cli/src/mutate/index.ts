import { formatAmountCents, utcDayOf } from "../domain/index.js";
import type { AddCommand, RmCommand } from "../domain/index.js";
import { noExpenseError, unreadableStoreError } from "../diagnostics/index.js";
import type { CommandOutcome } from "../diagnostics/index.js";
import { addExpense, readLedger, removeExpense, writeLedger } from "../store/index.js";

export function runAdd(command: AddCommand, ledgerPath: string, now: Date): CommandOutcome {
  const read = readLedger(ledgerPath);
  if (!read.ok) {
    return { ok: false, error: unreadableStoreError(ledgerPath) };
  }
  const date = command.date ?? utcDayOf(now);
  const draft =
    command.note === undefined
      ? { amountCents: command.amountCents, category: command.category, date }
      : { amountCents: command.amountCents, category: command.category, date, note: command.note };
  const added = addExpense(read.ledger, draft);
  if (!writeLedger(ledgerPath, added.ledger).ok) {
    return { ok: false, error: unreadableStoreError(ledgerPath) };
  }
  const line = `#${added.id} ${formatAmountCents(command.amountCents)} ${command.category} ${date}`;
  return { ok: true, lines: [line] };
}

export function runRm(command: RmCommand, ledgerPath: string): CommandOutcome {
  const read = readLedger(ledgerPath);
  if (!read.ok) {
    return { ok: false, error: unreadableStoreError(ledgerPath) };
  }
  const remaining = removeExpense(read.ledger, command.id);
  if (remaining === null) {
    return { ok: false, error: noExpenseError(command.id) };
  }
  if (!writeLedger(ledgerPath, remaining).ok) {
    return { ok: false, error: unreadableStoreError(ledgerPath) };
  }
  return { ok: true, lines: [`#${command.id} removed`] };
}
