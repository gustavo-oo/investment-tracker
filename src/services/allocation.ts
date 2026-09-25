import type { Db } from "../db/index.ts";
import { ALLOCATION_BY, groupAllocation, type AllocationBy } from "../domain/allocation.ts";
import { divRoundHalfUp } from "../domain/money.ts";
import { buildPortfolio } from "./portfolio.ts";

export { ALLOCATION_BY };
export type { AllocationBy };

export type AllocationResult = {
  by: AllocationBy;
  groups: Array<{ key: string; marketValueCents: bigint; pct: number }>;
};

export function buildAllocation(db: Db, by: AllocationBy, deps: { now?: () => Date } = {}): AllocationResult {
  const portfolio = buildPortfolio(db, deps);
  const total = portfolio.totals.marketValueCents;
  const groups = groupAllocation(portfolio.positions, by)
    .map((group) => ({
      ...group,
      pct: total === 0n ? 0 : Number(divRoundHalfUp(group.marketValueCents * 10_000n, total)) / 100,
    }))
    .filter((group) => group.marketValueCents !== 0n);
  return { by, groups };
}
