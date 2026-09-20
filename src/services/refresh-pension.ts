import type { Db } from "../db/index.ts";
import { earliestTradeDate, fundQuotaFrontier, listInstruments, recordSourceAttempt, writeFundQuotas } from "../db/repos.ts";
import { toBrDate } from "../domain/dates.ts";
import type { FundQuotaSource } from "../sources/types.ts";
import { emptySummary, type RefreshSourceSummary } from "./refresh-summary.ts";

export type PensionRefreshDeps = { source: FundQuotaSource; now?: () => Date; full?: boolean };

export async function refreshPension(db: Db, deps: PensionRefreshDeps): Promise<RefreshSourceSummary> {
  const now = deps.now ?? (() => new Date());
  const today = toBrDate(now());
  const floor = earliestTradeDate(db);
  const summary = emptySummary(deps.source.id);
  const symbols = listInstruments(db)
    .filter((instrument) => instrument.kind === "pension" && instrument.quoteSymbol !== null)
    .map((instrument) => instrument.quoteSymbol as string);
  let attempted = false;
  for (const symbol of symbols) {
    const from = deps.full ? floor : (fundQuotaFrontier(db, symbol) ?? floor);
    if (from === null) continue;
    attempted = true;
    try {
      const quotas = await deps.source.fetchDaily([symbol], from, today);
      const valid = quotas.filter((quota) => quota.date <= today && quota.quotaE12 > 0n);
      const written = writeFundQuotas(db, valid.map((quota) => ({
        symbol: quota.symbol, date: quota.date, quotaE12: quota.quotaE12, source: deps.source.id, settled: quota.date < today,
      })), today);
      summary.fetched += valid.length;
      summary.inserted += written.inserted;
      summary.updated += written.updated;
      summary.skipped += written.skipped;
    } catch (error) {
      summary.errors.push(`${symbol}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (attempted) {
    recordSourceAttempt(db, deps.source.id, summary.errors.length === 0 ? { ok: true } : { ok: false, error: summary.errors[0]! });
  }
  return summary;
}
