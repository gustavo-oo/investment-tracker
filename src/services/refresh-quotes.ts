import type { Db } from "../db/index.ts";
import {
  earliestTradeDate, listInstruments, quoteFrontier, recordSourceAttempt, writeQuotes,
} from "../db/repos.ts";
import { toBrDate } from "../domain/dates.ts";
import type { QuoteSource } from "../sources/types.ts";
import { emptySummary, type RefreshSourceSummary } from "./refresh-summary.ts";

export type QuoteRefreshDeps = {
  sources: QuoteSource[];
  now?: () => Date;
  full?: boolean;
  fallbackAttempts?: Map<string, string>;
};

const defaultAttempts = new Map<string, string>();

export async function refreshQuotes(db: Db, deps: QuoteRefreshDeps): Promise<RefreshSourceSummary[]> {
  const summaries = new Map<string, RefreshSourceSummary>(deps.sources.map((source) => [source.id, emptySummary(source.id)]));
  const attempted = new Set<string>();
  const [primary, fallback] = deps.sources;
  if (!primary) return [];
  const now = deps.now ?? (() => new Date());
  const today = toBrDate(now());
  const attempts = deps.fallbackAttempts ?? defaultAttempts;
  const floor = earliestTradeDate(db);
  const tickers = listInstruments(db)
    .filter((instrument) => instrument.kind === "equity" && instrument.ticker !== null)
    .map((instrument) => instrument.ticker as string);

  const trySource = async (source: QuoteSource, ticker: string, from: string): Promise<boolean> => {
    const summary = summaries.get(source.id)!;
    attempted.add(source.id);
    try {
      const quotes = await source.fetchDaily([ticker], from, today);
      const valid = quotes.filter((quote) => quote.date <= today && quote.closeCents > 0n);
      const written = writeQuotes(db, valid.map((quote) => ({ ...quote, source: source.id, settled: quote.date < today })), today);
      summary.fetched += valid.length;
      summary.inserted += written.inserted;
      summary.updated += written.updated;
      summary.skipped += written.skipped;
      return valid.length > 0;
    } catch (error) {
      summary.errors.push(`${ticker}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  };

  for (const ticker of tickers) {
    const from = deps.full ? floor : (quoteFrontier(db, ticker) ?? floor);
    if (from === null) continue;
    const primaryOk = await trySource(primary, ticker, from);
    if (primaryOk || !fallback) continue;
    const key = `${fallback.id}:${ticker}`;
    if (attempts.get(key) === today) continue;
    attempts.set(key, today);
    const fallbackOk = await trySource(fallback, ticker, from);
    if (!fallbackOk && summaries.get(fallback.id)!.errors.length === 0) {
      summaries.get(fallback.id)!.errors.push(`${ticker}: fallback não devolveu cotações`);
    }
  }

  for (const source of deps.sources) {
    if (!attempted.has(source.id)) continue;
    const summary = summaries.get(source.id)!;
    recordSourceAttempt(db, source.id, summary.errors.length === 0 ? { ok: true } : { ok: false, error: summary.errors[0]! });
  }
  return [...summaries.values()];
}
