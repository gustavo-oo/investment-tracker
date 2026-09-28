import type { Db } from "../db/index.ts";
import { getRebalanceTargets } from "../db/repos.ts";
import { rebalance, type RebalanceGroup, type RebalanceGroupKey } from "../domain/rebalance.ts";
import { buildPortfolio } from "./portfolio.ts";

const OBJETIVO_RESERVA = "Reserva";

export type RebalanceView = {
  asOf: string;
  baseCents: bigint;
  amountCents: bigint;
  targets: { rfE6: bigint; rvE6: bigint };
  groups: RebalanceGroup[];
  stale: boolean;
};

function grupoDe(position: { kind: string; category: string }): RebalanceGroupKey {
  return position.kind === "fixed_income" || position.kind === "pension" || position.category === "etf_fixed"
    ? "rf"
    : "rv";
}

export function buildRebalance(
  db: Db,
  deps: { now?: () => Date; amountCents?: bigint; targetsE6?: { rfE6: bigint; rvE6: bigint } } = {},
): RebalanceView {
  const portfolio = buildPortfolio(db, { now: deps.now });
  const stored = getRebalanceTargets(db);
  const targets = deps.targetsE6 ?? { rfE6: stored.rfE6, rvE6: stored.rvE6 };
  const amountCents = deps.amountCents ?? stored.amountCents;
  const consideradas = portfolio.positions.filter(
    (position) => position.objective !== OBJETIVO_RESERVA && position.marketValueCents !== null,
  );
  const values: Record<RebalanceGroupKey, bigint> = { rf: 0n, rv: 0n };
  for (const position of consideradas) {
    values[grupoDe(position)] += position.marketValueCents ?? 0n;
  }
  const result = rebalance({
    valuesCents: values,
    targetsE6: { rf: targets.rfE6, rv: targets.rvE6 },
    amountCents,
  });
  return {
    asOf: portfolio.asOf,
    baseCents: result.baseCents,
    amountCents: result.amountCents,
    targets,
    groups: result.groups,
    stale: consideradas.some((position) => position.stale),
  };
}
