import type { Db } from "../db/index.ts";
import { listAllIndexRates, listAllQuotes, listAllTransactions, listInstruments } from "../db/repos.ts";
import { addMonths, monthEnd, monthRange, toBrDate } from "../domain/dates.ts";
import { cdiMonthPct, ipcaMonthPct } from "../domain/evolution.ts";
import { instrumentValue } from "../domain/position.ts";
import type { TransactionRow } from "../db/repos.ts";

export type HistoryPoint = {
  month: string;
  marketValueCents: bigint;
  investedCents: bigint;
  redeemedCents: bigint;
  cdiPct: number | null;
  ipcaPct: number | null;
};

export type HistoryOptions = { from?: string; to?: string };

function sumMonth(transactions: TransactionRow[], month: string, kind: "BUY" | "SELL"): bigint {
  return transactions
    .filter((transaction) => transaction.kind === kind && transaction.tradeDate.slice(0, 7) === month)
    .reduce((total, transaction) => total + transaction.grossCents + (kind === "BUY" ? transaction.feesCents : 0n), 0n);
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
  const cdiRates = rates.filter((rate) => rate.series === "CDI");
  const ipcaRates = rates.filter((rate) => rate.series === "IPCA");

  return monthRange(from, to).map((month) => {
    const asOf = month === currentMonth ? today : monthEnd(month);
    let marketValueCents = 0n;
    let investedCents = 0n;
    let redeemedCents = 0n;
    for (const instrument of instruments) {
      const instrumentTransactions = transactions.filter((transaction) => transaction.instrumentId === instrument.id);
      const instrumentQuotes = instrument.ticker === null ? [] : quotes.filter((quote) => quote.ticker === instrument.ticker);
      const series = instrument.benchmark === "SELIC" ? "SELIC" : instrument.benchmark === "CDI" ? "CDI" : null;
      const instrumentRates = series === null ? [] : rates.filter((rate) => rate.series === series);
      const value = instrumentValue({
        kind: instrument.kind, benchmark: instrument.benchmark, rateE6: instrument.rateE6,
        transactions: instrumentTransactions, quotes: instrumentQuotes, rates: instrumentRates,
      }, asOf);
      marketValueCents += value.marketValueCents ?? 0n;
      investedCents += sumMonth(instrumentTransactions, month, "BUY");
      redeemedCents += sumMonth(instrumentTransactions, month, "SELL");
    }
    return { month, marketValueCents, investedCents, redeemedCents, cdiPct: cdiMonthPct(cdiRates, month), ipcaPct: ipcaMonthPct(ipcaRates, month) };
  });
}
