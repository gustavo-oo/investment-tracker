import type { Db } from "../db/index.ts";
import { addMonths, daysBetween } from "../domain/dates.ts";
import { accumulatePct, gapPp, monthlyPortfolioPct, monthsBeaten, realReturnPct, xirrPct, type DatedFlow } from "../domain/performance.ts";
import { buildHistory, resolveHistoryWindow, type HistoryOptions } from "./history.ts";

export type PerformanceMonth = {
  month: string; portfolioPct: number | null; cdiPct: number | null; ipcaPct: number | null; realPct: number | null;
  diffCdiPp: number | null; rendimentoCents: bigint; investedCents: bigint; redeemedCents: bigint;
};

export type PerformanceResult = {
  from: string; to: string; months: PerformanceMonth[];
  accumulated: { portfolioPct: number; cdiPct: number; ipcaPct: number; diffCdiPp: number; diffIpcaPp: number; realPct: number };
  monthsBeaten: number; monthsTotal: number;
  mwr: { periodPct: number | null; months: number };
};

export function buildPerformance(db: Db, options: HistoryOptions = {}, deps: { now?: () => Date } = {}): PerformanceResult {
  const window = resolveHistoryWindow(db, options, deps);
  const points = buildHistory(db, { from: addMonths(window.from, -1), to: window.to }, deps);
  const base = points[0];
  const months: PerformanceMonth[] = [];
  let previous = base;
  for (const point of points.slice(1)) {
    if (!previous) break;
    const portfolioPct = monthlyPortfolioPct(previous.marketValueCents, previous.asOf, point.marketValueCents, point.asOf, point.flows);
    months.push({
      month: point.month, portfolioPct, cdiPct: point.cdiPct, ipcaPct: point.ipcaPct,
      realPct: portfolioPct === null || point.ipcaPct === null ? null : realReturnPct(portfolioPct, point.ipcaPct),
      diffCdiPp: portfolioPct === null || point.cdiPct === null ? null : gapPp(portfolioPct, point.cdiPct),
      rendimentoCents: point.marketValueCents - previous.marketValueCents - point.investedCents + point.redeemedCents,
      investedCents: point.investedCents, redeemedCents: point.redeemedCents,
    });
    previous = point;
  }

  const accumulated = {
    portfolioPct: accumulatePct(months.map((month) => month.portfolioPct)),
    cdiPct: accumulatePct(months.map((month) => month.cdiPct)),
    ipcaPct: accumulatePct(months.map((month) => month.ipcaPct)),
    diffCdiPp: 0, diffIpcaPp: 0, realPct: 0,
  };
  accumulated.diffCdiPp = gapPp(accumulated.portfolioPct, accumulated.cdiPct);
  accumulated.diffIpcaPp = gapPp(accumulated.portfolioPct, accumulated.ipcaPct);
  accumulated.realPct = realReturnPct(accumulated.portfolioPct, accumulated.ipcaPct);

  const lastPoint = points.at(-1);
  const datedFlows: DatedFlow[] = points.slice(1).flatMap((point) => point.flows);
  let mwr: PerformanceResult["mwr"] = { periodPct: null, months: months.length };
  if (base && lastPoint && months.length > 0) {
    const annual = xirrPct(base.marketValueCents, base.asOf, datedFlows, lastPoint.marketValueCents, lastPoint.asOf);
    if (annual !== null) {
      mwr = {
        periodPct: Math.round(((1 + annual / 100) ** (daysBetween(base.asOf, lastPoint.asOf) / 365) - 1) * 1_000_000) / 10_000,
        months: months.length,
      };
    }
  }

  return { from: window.from, to: window.to, months, accumulated, monthsBeaten: monthsBeaten(months), monthsTotal: months.length, mwr };
}
