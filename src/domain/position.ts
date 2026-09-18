import { MULTIPLIER_SCALE, RATE_SCALE, SHARES_SCALE, divRoundHalfUp, mulScaled } from "./money.ts";
import type { InstrumentKind, TransactionKind } from "./model.ts";

export type RatePoint = { date: string; valueE12: bigint };
export type QuotePoint = { date: string; closeCents: bigint };

export type PositionTransaction = {
  tradeDate: string;
  kind: TransactionKind;
  quantityE8: bigint | null;
  grossCents: bigint;
  feesCents: bigint;
};

export type PositionInput = {
  kind: InstrumentKind;
  benchmark: string | null;
  rateE6: bigint | null;
  transactions: PositionTransaction[];
  quotes: QuotePoint[];
  rates: RatePoint[];
};

export type PositionValue = {
  marketValueCents: bigint | null;
  priceCents: bigint | null;
  priceDate: string | null;
  quantityE8: bigint | null;
  investedCents: bigint;
  redeemedCents: bigint;
  feesCents: bigint;
};

/** Fator diário (1 + taxa × multiplicador) em escala e12. */
export function rfDailyFactorE12(valueE12: bigint, multiplierE6: bigint): bigint {
  return RATE_SCALE + divRoundHalfUp(valueE12 * multiplierE6, MULTIPLIER_SCALE);
}

/** Saldo RF: cada operação capitaliza da 1ª taxa com date ≥ data da operação até asOf; arredonda 1× no fim. */
export function rfValueCents(
  operations: Array<{ date: string; grossCents: bigint }>,
  rates: RatePoint[],
  multiplierE6: bigint,
  asOf: string,
): { valueCents: bigint; lastRateDate: string | null } {
  let accumulated = 0n;
  let lastRateDate: string | null = null;
  for (const operation of operations) {
    if (operation.date > asOf) continue;
    let factor = RATE_SCALE;
    for (const rate of rates) {
      if (rate.date > asOf) break;
      if (rate.date < operation.date) continue;
      factor = divRoundHalfUp(factor * rfDailyFactorE12(rate.valueE12, multiplierE6), RATE_SCALE);
      if (lastRateDate === null || rate.date > lastRateDate) lastRateDate = rate.date;
    }
    accumulated += operation.grossCents * factor;
  }
  return { valueCents: divRoundHalfUp(accumulated, RATE_SCALE), lastRateDate };
}

/** Valor RV/PGBL: cotas × último fechamento ≤ asOf. */
export function equityValueCents(
  quantityE8: bigint,
  quotes: QuotePoint[],
  asOf: string,
): { valueCents: bigint | null; priceCents: bigint | null; priceDate: string | null } {
  let priceCents: bigint | null = null;
  let priceDate: string | null = null;
  for (const quote of quotes) {
    if (quote.date > asOf) break;
    priceCents = quote.closeCents;
    priceDate = quote.date;
  }
  if (priceCents === null) return { valueCents: null, priceCents: null, priceDate: null };
  return { valueCents: mulScaled(quantityE8, priceCents, SHARES_SCALE), priceCents, priceDate };
}

/** Posição de um ativo em `asOf`, com investido/resgatado/taxas acumulados até a data. */
export function instrumentValue(input: PositionInput, asOf: string): PositionValue {
  let investedCents = 0n;
  let redeemedCents = 0n;
  let feesCents = 0n;
  let quantityE8: bigint | null = null;
  const operations: Array<{ date: string; grossCents: bigint }> = [];
  for (const transaction of input.transactions) {
    if (transaction.tradeDate > asOf) continue;
    if (transaction.kind === "BUY") {
      investedCents += transaction.grossCents + transaction.feesCents;
      feesCents += transaction.feesCents;
    }
    if (transaction.kind === "SELL") redeemedCents += transaction.grossCents;
    operations.push({ date: transaction.tradeDate, grossCents: transaction.kind === "SELL" ? -transaction.grossCents : transaction.grossCents });
    if (transaction.quantityE8 !== null) quantityE8 = (quantityE8 ?? 0n) + transaction.quantityE8;
  }
  if (input.kind === "fixed_income") {
    const multiplierE6 = input.rateE6 ?? 1_000_000n;
    const { valueCents, lastRateDate } = rfValueCents(operations, input.rates, multiplierE6, asOf);
    return { marketValueCents: valueCents, priceCents: null, priceDate: lastRateDate, quantityE8: null, investedCents, redeemedCents, feesCents };
  }
  if (input.kind === "pension") {
    return { marketValueCents: null, priceCents: null, priceDate: null, quantityE8, investedCents, redeemedCents, feesCents };
  }
  const equity = equityValueCents(quantityE8 ?? 0n, input.quotes, asOf);
  return { marketValueCents: equity.valueCents, priceCents: equity.priceCents, priceDate: equity.priceDate, quantityE8, investedCents, redeemedCents, feesCents };
}
