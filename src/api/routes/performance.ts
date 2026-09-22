import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/index.ts";
import { isMonth } from "../../domain/dates.ts";
import { toNumberSafe } from "../../domain/money.ts";
import { buildPerformance } from "../../services/performance.ts";

export function registerPerformanceRoutes(app: FastifyInstance, db: Db): void {
  app.get<{ Querystring: { from?: string; to?: string } }>("/api/performance", (request, reply) => {
    const { from, to } = request.query;
    if ((from !== undefined && !isMonth(from)) || (to !== undefined && !isMonth(to))) {
      return reply.code(400).send({ error: "from/to devem ser YYYY-MM" });
    }
    if (from !== undefined && to !== undefined && from > to) {
      return reply.code(400).send({ error: "from deve ser <= to" });
    }
    const result = buildPerformance(db, { from, to });
    return {
      from: result.from, to: result.to,
      months: result.months.map((month) => ({
        month: month.month, portfolioPct: month.portfolioPct, cdiPct: month.cdiPct, ipcaPct: month.ipcaPct,
        realPct: month.realPct,
        diffCdiPp: month.diffCdiPp,
        rendimentoCents: toNumberSafe(month.rendimentoCents),
        investedCents: toNumberSafe(month.investedCents),
        redeemedCents: toNumberSafe(month.redeemedCents),
      })),
      accumulated: result.accumulated,
      monthsBeaten: result.monthsBeaten, monthsTotal: result.monthsTotal,
      mwr: result.mwr,
    };
  });
}
