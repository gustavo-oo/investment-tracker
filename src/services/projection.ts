import type { Db } from "../db/index.ts";
import { addMonths, toBrDate } from "../domain/dates.ts";
import { projectPatrimony, projectionPremise, type ProjectionPremise } from "../domain/projection.ts";
import { buildHistory, resolveHistoryWindow } from "./history.ts";
import { buildPerformance } from "./performance.ts";

const PROJECTION_MONTHS = 24;

export type ProjectionResult = {
  from: string;
  to: string;
  premise: (ProjectionPremise & { patrimonyCents: bigint }) | null;
  history: Array<{ month: string; marketValueCents: bigint }>;
  projection: Array<{ month: string; baseCents: bigint; pessimisticCents: bigint; optimisticCents: bigint }>;
};

/** Projeção do patrimônio pelos últimos 12 meses (TWR datado + aporte líquido). */
export function buildProjection(db: Db, deps: { now?: () => Date } = {}): ProjectionResult {
  const today = toBrDate((deps.now ?? (() => new Date()))());
  const to = today.slice(0, 7);
  const window = resolveHistoryWindow(db, { from: addMonths(to, -11), to }, deps);
  const performance = buildPerformance(db, { from: window.from, to: window.to }, deps);
  const history = buildHistory(db, { from: window.from, to: window.to }, deps);
  const premise = projectionPremise(
    performance.months.map((month) => month.portfolioPct),
    performance.months.map((month) => month.investedCents - month.redeemedCents),
  );
  const last = history.at(-1);
  if (premise === null || last === undefined) {
    return { from: window.from, to: window.to, premise: null, history: [], projection: [] };
  }
  return {
    from: window.from, to: window.to,
    premise: { ...premise, patrimonyCents: last.marketValueCents },
    history: history.map((point) => ({ month: point.month, marketValueCents: point.marketValueCents })),
    projection: projectPatrimony(last.marketValueCents, premise, PROJECTION_MONTHS).map((point, index) => ({
      month: addMonths(window.to, index + 1),
      ...point,
    })),
  };
}
