import type { Db } from "../db/index.ts";
import { earliestTradeDate, listAllFundQuotas, listAllIndexRates, listAllQuotes, listAllTransactions, listInstruments } from "../db/repos.ts";
import { addMonths, monthEnd, monthRange, toBrDate } from "../domain/dates.ts";
import { cdiMonthPct, ipcaMonthPct } from "../domain/evolution.ts";
import { instrumentValue } from "../domain/position.ts";
import type { DatedFlow } from "../domain/performance.ts";
import type { TransactionRow } from "../db/repos.ts";

export type HistoryPoint = {
  month: string;
  asOf: string;
  marketValueCents: bigint;
  investedCents: bigint;
  redeemedCents: bigint;
  flows: DatedFlow[];
  cdiPct: number | null;
  ipcaPct: number | null;
};

export type HistoryOptions = { from?: string; to?: string };

/** Início da série de retorno: abr–mai/2025 são lotes de migração de posições que já existiam, registrados pelo valor bruto do dia — não são aportes. */
const SERIES_START_MONTH = "2025-06";

function sumMonth(transactions: TransactionRow[], month: string, kind: "BUY" | "SELL"): bigint {
  return transactions
    .filter((transaction) => transaction.kind === kind && transaction.tradeDate.slice(0, 7) === month)
    .reduce((total, transaction) => total + transaction.grossCents + (kind === "BUY" ? transaction.feesCents : 0n), 0n);
}

/** Janela efetiva: defaults e clamp no primeiro mês com retorno (mês anterior com valor > 0). */
export function resolveHistoryWindow(
  db: Db,
  options: HistoryOptions = {},
  deps: { now?: () => Date } = {},
): { from: string; to: string } {
  const today = toBrDate((deps.now ?? (() => new Date()))());
  const to = options.to ?? today.slice(0, 7);
  const requestedFrom = options.from ?? addMonths(to, -11);
  const first = firstMonthWithReturn(db, to);
  const floor = first !== null && first > SERIES_START_MONTH ? first : SERIES_START_MONTH;
  const from = requestedFrom < floor ? floor : requestedFrom;
  // janela inteira antes do piso: clampa from em to para manter from <= to e devolver série vazia
  return from > to ? { from: to, to } : { from, to };
}

function firstMonthWithReturn(db: Db, limit: string): string | null {
  const earliest = earliestTradeDate(db);
  if (earliest === null) return null;
  const points = buildHistory(db, { from: earliest.slice(0, 7), to: limit });
  for (let index = 1; index < points.length; index++) {
    if (points[index - 1]!.marketValueCents > 0n) return points[index]!.month;
  }
  return null;
}

export function buildHistory(db: Db, options: HistoryOptions = {}, deps: { now?: () => Date } = {}): HistoryPoint[] {
  const now = deps.now ?? (() => new Date());
  const today = toBrDate(now());
  const currentMonth = today.slice(0, 7);
  const to = options.to ?? currentMonth;
  const from = options.from ?? addMonths(to, -11);
  const instruments = listInstruments(db);
  const transactions = listAllTransactions(db);
  const quotes = listAllQuotes(db);
  const rates = listAllIndexRates(db);
  const fundQuotas = listAllFundQuotas(db);
  const cdiRates = rates.filter((rate) => rate.series === "CDI");
  const ipcaRates = rates.filter((rate) => rate.series === "IPCA");

  return monthRange(from, to).map((month) => {
    const asOf = month === currentMonth ? today : monthEnd(month);
    let marketValueCents = 0n;
    let investedCents = 0n;
    let redeemedCents = 0n;
    const flows: DatedFlow[] = [];
    for (const instrument of instruments) {
      const instrumentTransactions = transactions.filter((transaction) => transaction.instrumentId === instrument.id);
      const instrumentQuotes = instrument.ticker === null ? [] : quotes.filter((quote) => quote.ticker === instrument.ticker);
      const instrumentFundQuotas = instrument.kind === "pension" && instrument.quoteSymbol !== null
        ? fundQuotas.filter((quota) => quota.symbol === instrument.quoteSymbol)
        : [];
      const series = instrument.benchmark === "SELIC" ? "SELIC" : instrument.benchmark === "CDI" ? "CDI" : null;
      const instrumentRates = series === null ? [] : rates.filter((rate) => rate.series === series);
      const value = instrumentValue({
        kind: instrument.kind, benchmark: instrument.benchmark, rateE6: instrument.rateE6,
        transactions: instrumentTransactions, quotes: instrumentQuotes, rates: instrumentRates,
        pensionQuotes: instrumentFundQuotas,
      }, asOf);
      marketValueCents += value.marketValueCents ?? 0n;
      investedCents += sumMonth(instrumentTransactions, month, "BUY");
      redeemedCents += sumMonth(instrumentTransactions, month, "SELL");
      for (const transaction of instrumentTransactions) {
        if (transaction.tradeDate.slice(0, 7) !== month) continue;
        if (transaction.kind === "BUY") {
          flows.push({ date: transaction.tradeDate, cents: transaction.grossCents + transaction.feesCents });
        } else if (transaction.kind === "SELL") {
          flows.push({ date: transaction.tradeDate, cents: -transaction.grossCents });
        }
      }
    }
    return { month, asOf, marketValueCents, investedCents, redeemedCents, flows, cdiPct: cdiMonthPct(cdiRates, month), ipcaPct: ipcaMonthPct(ipcaRates, month) };
  });
}
