import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/index.ts";
import { toNumberSafe } from "../../domain/money.ts";
import { buildProjection } from "../../services/projection.ts";

export function registerProjectionRoutes(app: FastifyInstance, db: Db): void {
  app.get("/api/projection", () => {
    const result = buildProjection(db);
    return {
      from: result.from,
      to: result.to,
      premise: result.premise === null ? null : {
        monthsUsed: result.premise.monthsUsed,
        monthlyRatePct: result.premise.monthlyRatePct,
        bandPp: result.premise.bandPp,
        contributionCents: toNumberSafe(result.premise.contributionCents),
        pessimisticMonthlyPct: result.premise.pessimisticMonthlyPct,
        optimisticMonthlyPct: result.premise.optimisticMonthlyPct,
        patrimonyCents: toNumberSafe(result.premise.patrimonyCents),
      },
      history: result.history.map((point) => ({ month: point.month, marketValueCents: toNumberSafe(point.marketValueCents) })),
      projection: result.projection.map((point) => ({
        month: point.month,
        baseCents: toNumberSafe(point.baseCents),
        pessimisticCents: toNumberSafe(point.pessimisticCents),
        optimisticCents: toNumberSafe(point.optimisticCents),
      })),
    };
  });
}
