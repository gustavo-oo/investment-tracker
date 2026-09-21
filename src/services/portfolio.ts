import type { Db } from "../db/index.ts";
import {
  listAllFundQuotas, listAllIndexRates, listAllQuotes, listAllTransactions, listInstruments, listSourceStatus,
} from "../db/repos.ts";
import { toBrDate } from "../domain/dates.ts";
import type { InstrumentCategory, InstrumentKind } from "../domain/model.ts";
import { instrumentValue, type PositionValue } from "../domain/position.ts";
import { sourceSummary, type SourceSummary } from "./status.ts";

export type PortfolioPosition = PositionValue & {
  instrumentId: string;
  name: string;
  kind: InstrumentKind;
  category: InstrumentCategory;
  broker: string | null;
  objective: string | null;
  benchmark: string | null;
  rateE6: bigint | null;
  priceSource: string | null;
  stale: boolean;
};

export type PortfolioTotals = {
  investedCents: bigint;
  redeemedCents: bigint;
  feesCents: bigint;
  marketValueCents: bigint;
};

export type PortfolioResult = {
  asOf: string;
  totals: PortfolioTotals;
  positions: PortfolioPosition[];
  sources: SourceSummary[];
};

export function buildPortfolio(db: Db, deps: { now?: () => Date; asOf?: string } = {}): PortfolioResult {
  const now = deps.now ?? (() => new Date());
  const asOf = deps.asOf ?? toBrDate(now());
  const instruments = listInstruments(db);
  const transactions = listAllTransactions(db);
  const quotes = listAllQuotes(db);
  const rates = listAllIndexRates(db);
  const fundQuotas = listAllFundQuotas(db);
  const statuses = new Map(listSourceStatus(db).map((row) => [row.source, sourceSummary(row)]));
  const staleOf = (source: string | null): boolean => source === null || (statuses.get(source)?.stale ?? true);

  const positions: PortfolioPosition[] = instruments.map((instrument) => {
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
    const priceSource = instrument.kind === "equity"
      ? (instrumentQuotes.filter((quote) => quote.date <= asOf).at(-1)?.source ?? null)
      : instrument.kind === "pension"
        ? (instrumentFundQuotas.filter((quota) => quota.date <= asOf).at(-1)?.source ?? null)
        : instrument.kind === "fixed_income" ? "bcb" : null;
    const stale = value.marketValueCents === null || (instrument.kind === "fixed_income" && value.priceDate === null) || staleOf(priceSource);
    return {
      ...value, instrumentId: instrument.id, name: instrument.name, kind: instrument.kind, category: instrument.category,
      broker: instrument.broker, objective: instrument.objective, benchmark: instrument.benchmark, rateE6: instrument.rateE6,
      priceSource, stale,
    };
  });

  const totals = positions.reduce<PortfolioTotals>((acc, position) => ({
    investedCents: acc.investedCents + position.investedCents,
    redeemedCents: acc.redeemedCents + position.redeemedCents,
    feesCents: acc.feesCents + position.feesCents,
    marketValueCents: acc.marketValueCents + (position.marketValueCents ?? 0n),
  }), { investedCents: 0n, redeemedCents: 0n, feesCents: 0n, marketValueCents: 0n });

  return { asOf, totals, positions, sources: [...statuses.values()] };
}
