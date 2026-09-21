import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/index.ts";
import { toBrDate } from "../../domain/dates.ts";
import { toNumberSafe } from "../../domain/money.ts";
import { buildReconciliation } from "../../services/reconciliation.ts";

const isMonth = (value: unknown): value is string => typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const isDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(value);

export function registerReconciliationRoutes(app: FastifyInstance, db: Db): void {
  app.get<{ Querystring: { month?: string; asOf?: string } }>("/api/reconciliation", (request, reply) => {
    const { month, asOf } = request.query;
    if (month !== undefined && !isMonth(month)) return reply.code(400).send({ error: "month deve ser YYYY-MM" });
    if (asOf !== undefined && !isDate(asOf)) return reply.code(400).send({ error: "asOf deve ser YYYY-MM-DD" });
    const resolvedMonth = month ?? toBrDate(new Date()).slice(0, 7);
    if (asOf !== undefined && asOf.slice(0, 7) !== resolvedMonth) {
      return reply.code(400).send({ error: "asOf deve estar dentro do mês" });
    }
    const result = buildReconciliation(db, { month: resolvedMonth, asOf });
    return {
      month: result.month,
      asOf: result.asOf,
      totals: {
        legacyCents: toNumberSafe(result.totals.legacyCents),
        referenceCents: toNumberSafe(result.totals.referenceCents),
        ourCents: toNumberSafe(result.totals.ourCents),
        diffCents: toNumberSafe(result.totals.diffCents),
      },
      divergences: result.divergences.map((divergence) => ({
        instrumentId: divergence.instrumentId, name: divergence.name, kind: divergence.kind, benchmark: divergence.benchmark,
        legacyCents: toNumberSafe(divergence.legacyCents), ourCents: toNumberSafe(divergence.ourCents),
        diffCents: toNumberSafe(divergence.diffCents), cause: divergence.cause,
      })),
      unexplained: result.unexplained,
    };
  });
}
