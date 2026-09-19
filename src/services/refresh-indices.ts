import type { Db } from "../db/index.ts";
import { earliestTradeDate, indexFrontier, recordSourceAttempt, writeIndexRates } from "../db/repos.ts";
import { toBrDate } from "../domain/dates.ts";
import type { IndexSeries, IndexSource } from "../sources/types.ts";
import { emptySummary, type RefreshSourceSummary } from "./refresh-summary.ts";

const SERIES: IndexSeries[] = ["CDI", "SELIC", "IPCA"];

export type IndexRefreshDeps = { source: IndexSource; now?: () => Date };

export async function refreshIndices(db: Db, deps: IndexRefreshDeps, full = false): Promise<RefreshSourceSummary> {
  const now = deps.now ?? (() => new Date());
  const today = toBrDate(now());
  const floor = earliestTradeDate(db);
  const summary = emptySummary(deps.source.id);
  for (const series of SERIES) {
    const from = full ? floor : (indexFrontier(db, series) ?? floor);
    if (from === null) continue;
    try {
      const rates = await deps.source.fetchSeries(series, from, today);
      const valid = rates.filter((rate) => rate.date <= today && rate.valueE12 > 0n);
      const written = writeIndexRates(db, valid);
      summary.fetched += valid.length;
      summary.inserted += written.inserted;
      summary.skipped += written.skipped;
    } catch (error) {
      summary.errors.push(`${series}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  recordSourceAttempt(db, deps.source.id, summary.errors.length === 0 ? { ok: true } : { ok: false, error: summary.errors[0]! });
  return summary;
}
