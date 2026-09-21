import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/index.ts";
import { isMonth } from "../../domain/dates.ts";
import { toNumberSafe } from "../../domain/money.ts";
import { buildAllocation, ALLOCATION_BY } from "../../services/allocation.ts";
import { buildHistory } from "../../services/history.ts";
import { buildPortfolio } from "../../services/portfolio.ts";

export function registerPortfolioRoutes(app: FastifyInstance, db: Db): void {
  app.get("/api/portfolio", () => {
    const portfolio = buildPortfolio(db);
    return {
      asOf: portfolio.asOf,
      totals: {
        investedCents: toNumberSafe(portfolio.totals.investedCents),
        redeemedCents: toNumberSafe(portfolio.totals.redeemedCents),
        feesCents: toNumberSafe(portfolio.totals.feesCents),
        marketValueCents: toNumberSafe(portfolio.totals.marketValueCents),
      },
      positions: portfolio.positions.map((position) => ({
        instrumentId: position.instrumentId, name: position.name, kind: position.kind, category: position.category,
        broker: position.broker, objective: position.objective, benchmark: position.benchmark,
        rateE6: position.rateE6 === null ? null : toNumberSafe(position.rateE6),
        quantityE8: position.quantityE8 === null ? null : toNumberSafe(position.quantityE8),
        priceCents: position.priceCents === null ? null : toNumberSafe(position.priceCents),
        priceDate: position.priceDate, priceSource: position.priceSource,
        marketValueCents: position.marketValueCents === null ? null : toNumberSafe(position.marketValueCents),
        investedCents: toNumberSafe(position.investedCents), redeemedCents: toNumberSafe(position.redeemedCents),
        feesCents: toNumberSafe(position.feesCents), stale: position.stale,
      })),
      sources: portfolio.sources,
    };
  });

  app.get<{ Querystring: { from?: string; to?: string } }>("/api/history", (request, reply) => {
    const { from, to } = request.query;
    if ((from !== undefined && !isMonth(from)) || (to !== undefined && !isMonth(to))) {
      return reply.code(400).send({ error: "from/to devem ser YYYY-MM" });
    }
    return buildHistory(db, { from, to }).map((point) => ({
      month: point.month,
      marketValueCents: toNumberSafe(point.marketValueCents),
      investedCents: toNumberSafe(point.investedCents),
      redeemedCents: toNumberSafe(point.redeemedCents),
      cdiPct: point.cdiPct,
      ipcaPct: point.ipcaPct,
    }));
  });

  app.get<{ Querystring: { by?: string } }>("/api/allocation", (request, reply) => {
    const by = request.query.by ?? "category";
    if (!(ALLOCATION_BY as readonly string[]).includes(by)) {
      return reply.code(400).send({ error: "by deve ser category, broker ou objective" });
    }
    const allocation = buildAllocation(db, by as (typeof ALLOCATION_BY)[number]);
    return {
      by: allocation.by,
      groups: allocation.groups.map((group) => ({
        key: group.key, marketValueCents: toNumberSafe(group.marketValueCents), pct: group.pct,
      })),
    };
  });
}
