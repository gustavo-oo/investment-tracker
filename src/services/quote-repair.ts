import type { Db } from "../db/index.ts";
import { listAllQuotes, listInstruments } from "../db/repos.ts";
import { monthEnd, toBrDate } from "../domain/dates.ts";
import { findConstantRuns } from "../domain/quote-runs.ts";
import type { MonthlyQuoteSource, Quote } from "../sources/types.ts";

export type QuoteRepairResult = {
  ticker: string; from: string; to: string; deleted: number; inserted: number; skipped?: boolean; error?: string;
};

export type QuoteRepairDeps = { source: MonthlyQuoteSource; now?: () => Date };

/** Substitui a janela pela série mensal; sem meses fechados que contêm a janela não apaga nada. */
export async function repairWindow(
  db: Db,
  deps: { source: MonthlyQuoteSource; ticker: string; from: string; to: string; today?: string },
): Promise<QuoteRepairResult> {
  const today = deps.today ?? toBrDate(new Date());
  const fetchFrom = `${deps.from.slice(0, 7)}-01`;
  const fetchTo = monthEnd(deps.to.slice(0, 7));
  const quotes = (await deps.source.fetchMonthly([deps.ticker], fetchFrom, fetchTo))
    .filter((quote) =>
      quote.date >= fetchFrom && quote.date <= fetchTo &&
      quote.date.slice(0, 7) < today.slice(0, 7) && quote.closeCents > 0n);
  if (quotes.length === 0) {
    return { ticker: deps.ticker, from: deps.from, to: deps.to, deleted: 0, inserted: 0, skipped: true };
  }
  const replace = db.transaction((items: Quote[]) => {
    const deleted = Number(db.prepare("DELETE FROM quotes WHERE ticker = ? AND date >= ? AND date <= ?")
      .run(deps.ticker, deps.from, deps.to).changes);
    const insert = db.prepare(`INSERT INTO quotes (ticker, date, close_cents, source, settled)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(ticker, date) DO UPDATE SET
        close_cents = excluded.close_cents, source = excluded.source, settled = 1, fetched_at = datetime('now')`);
    for (const quote of items) insert.run(quote.ticker, quote.date, quote.closeCents, deps.source.id);
    return { deleted, inserted: items.length };
  });
  return { ticker: deps.ticker, from: deps.from, to: deps.to, ...replace(quotes) };
}

export async function repairConstantRuns(db: Db, deps: QuoteRepairDeps): Promise<QuoteRepairResult[]> {
  if (!(await deps.source.available())) return [];
  const today = toBrDate((deps.now ?? (() => new Date()))());
  const currentMonth = today.slice(0, 7);
  const quotes = listAllQuotes(db);
  const tickers = listInstruments(db)
    .filter((instrument) => instrument.kind === "equity" && instrument.ticker !== null)
    .map((instrument) => instrument.ticker as string);
  const results: QuoteRepairResult[] = [];
  for (const ticker of tickers) {
    for (const run of findConstantRuns(quotes.filter((quote) => quote.ticker === ticker), { today })) {
      if (run.from.slice(0, 7) === currentMonth) continue;
      try {
        results.push(await repairWindow(db, { source: deps.source, ticker, from: run.from, to: run.to, today }));
      } catch (error) {
        results.push({
          ticker, from: run.from, to: run.to, deleted: 0, inserted: 0,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return results;
}
