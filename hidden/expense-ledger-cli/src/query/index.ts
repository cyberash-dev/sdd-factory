import type { ListCommand, SummaryCommand } from "../domain/index.js";
import { formatAmountCents } from "../domain/index.js";
import type { CommandOutcome } from "../diagnostics/index.js";
import { unreadableStoreError } from "../diagnostics/index.js";
import { readLedger } from "../store/index.js";
import type { Expense } from "../store/index.js";

const MONTH_LENGTH = 7;

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

function withExpenses(ledgerPath: string, render: (expenses: readonly Expense[]) => readonly string[]): CommandOutcome {
  const result = readLedger(ledgerPath);
  if (!result.ok) {
    return { ok: false, error: unreadableStoreError(ledgerPath) };
  }
  return { ok: true, lines: render(result.ledger.expenses) };
}

function listLine(expense: Expense): string {
  const base = `#${expense.id} ${expense.date} ${formatAmountCents(expense.amountCents)} ${expense.category}`;
  return expense.note === undefined ? base : `${base} — ${expense.note}`;
}

export function runList(command: ListCommand, ledgerPath: string): CommandOutcome {
  return withExpenses(ledgerPath, (expenses) =>
    expenses
      .filter(
        (expense) =>
          (command.category === undefined || expense.category === command.category) &&
          (command.from === undefined || expense.date >= command.from) &&
          (command.to === undefined || expense.date <= command.to),
      )
      .sort((a, b) => compareText(a.date, b.date) || a.id - b.id)
      .map(listLine),
  );
}

export function runSummary(command: SummaryCommand, ledgerPath: string): CommandOutcome {
  return withExpenses(ledgerPath, (expenses) => {
    const totals = new Map<string, number>();
    let grand = 0;
    for (const expense of expenses) {
      if (command.month !== undefined && expense.date.slice(0, MONTH_LENGTH) !== command.month) continue;
      totals.set(expense.category, (totals.get(expense.category) ?? 0) + expense.amountCents);
      grand += expense.amountCents;
    }
    const categoryLines = [...totals.entries()]
      .sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]))
      .map(([category, cents]) => `${category} ${formatAmountCents(cents)}`);
    return [...categoryLines, `total ${formatAmountCents(grand)}`];
  });
}

function csvField(text: string): string {
  return /[,"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function runExport(ledgerPath: string): CommandOutcome {
  return withExpenses(ledgerPath, (expenses) => [
    "id,date,amount,category,note",
    ...[...expenses]
      .sort((a, b) => a.id - b.id)
      .map(
        (expense) =>
          `${expense.id},${expense.date},${formatAmountCents(expense.amountCents)},${expense.category},${csvField(expense.note ?? "")}`,
      ),
  ]);
}
