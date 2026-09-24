import { formatCents, MULTIPLIER_SCALE } from "./money.ts";
import type { InstrumentKind } from "./model.ts";
import { rfValueCents, type PositionTransaction, type RatePoint } from "./position.ts";

export type GuardTransaction = PositionTransaction & { id: number };

export type GuardChange =
  | { action: "create"; transaction: PositionTransaction }
  | { action: "update"; transactionId: number; transaction: PositionTransaction }
  | { action: "delete"; transactionId: number }
  | { action: "none" };

export type GuardInput = {
  kind: InstrumentKind;
  rateE6: bigint | null;
  maturityDate: string | null;
  transactions: GuardTransaction[];
  rates: RatePoint[];
};

function applyChange(transactions: GuardTransaction[], change: GuardChange): GuardTransaction[] | null {
  if (change.action === "none") return [...transactions];
  if (change.action === "create") return [...transactions, { id: Number.MAX_SAFE_INTEGER, ...change.transaction }];
  const index = transactions.findIndex((transaction) => transaction.id === change.transactionId);
  if (index === -1) return null;
  if (change.action === "update") {
    return transactions.map((transaction, i) => (i === index ? { id: transaction.id, ...change.transaction } : transaction));
  }
  return transactions.filter((_, i) => i !== index);
}

function validateQuantity(ordered: GuardTransaction[]): string | null {
  let quantity = 0n;
  for (const transaction of ordered) {
    quantity += transaction.quantityE8 ?? 0n;
    if (quantity < 0n) return `resgate deixa a posição negativa em ${transaction.tradeDate}`;
  }
  return null;
}

function validateFixedIncome(input: GuardInput, ordered: GuardTransaction[]): string | null {
  const multiplierE6 = input.rateE6 ?? MULTIPLIER_SCALE;
  const maturityDate = input.maturityDate;
  const rates = maturityDate === null ? input.rates : input.rates.filter((rate) => rate.date < maturityDate);
  const operations: Array<{ date: string; grossCents: bigint }> = [];
  for (const transaction of ordered) {
    if (transaction.kind !== "SELL") {
      operations.push({ date: transaction.tradeDate, grossCents: transaction.grossCents });
      continue;
    }
    const { valueCents } = rfValueCents(operations, rates, multiplierE6, transaction.tradeDate);
    if (transaction.grossCents > valueCents + 1n) {
      const saldo = valueCents > 0n ? valueCents : 0n;
      return `resgate de ${formatCents(transaction.grossCents)} maior que o saldo de ${formatCents(saldo)} em ${transaction.tradeDate}`;
    }
    operations.push({ date: transaction.tradeDate, grossCents: -transaction.grossCents });
  }
  return null;
}

/** Simula a carteira com a mudança aplicada; devolve a mensagem do bloqueio ou null. */
export function validateChange(input: GuardInput, change: GuardChange): string | null {
  const updated = applyChange(input.transactions, change);
  if (updated === null) return "transação não encontrada";
  const ordered = [...updated].sort((a, b) =>
    a.tradeDate === b.tradeDate ? a.id - b.id : a.tradeDate < b.tradeDate ? -1 : 1);
  if (input.kind === "fixed_income") return validateFixedIncome(input, ordered);
  return validateQuantity(ordered);
}
