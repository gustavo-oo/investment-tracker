import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/index.ts";
import { saveRebalanceTargets } from "../../db/repos.ts";
import { toNumberSafe } from "../../domain/money.ts";
import { buildRebalance, type RebalanceView } from "../../services/rebalance.ts";

const META_MAX = 1_000_000n;

type Targets = { rfE6: bigint; rvE6: bigint };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function validateTargets(rfE6: bigint, rvE6: bigint): { ok: true; value: Targets } | { ok: false; error: string } {
  if (rfE6 < 0n || rfE6 > META_MAX || rvE6 < 0n || rvE6 > META_MAX) {
    return { ok: false, error: "metas devem ficar entre 0% e 100%" };
  }
  if (rfE6 + rvE6 !== META_MAX) return { ok: false, error: "as metas precisam somar 100%" };
  return { ok: true, value: { rfE6, rvE6 } };
}

function parseCentsParam(value: string | undefined): { ok: true; value: bigint | undefined } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (!/^\d{1,15}$/.test(value)) return { ok: false, error: "amountCents inválido" };
  return { ok: true, value: BigInt(value) };
}

function parseE6Param(value: string | undefined): { ok: true; value: bigint | undefined } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (!/^\d{1,7}$/.test(value)) return { ok: false, error: "metas inválidas" };
  return { ok: true, value: BigInt(value) };
}

function toApiRebalance(result: RebalanceView) {
  return {
    asOf: result.asOf,
    baseCents: toNumberSafe(result.baseCents),
    portfolioTotalCents: toNumberSafe(result.portfolioTotalCents),
    amountCents: toNumberSafe(result.amountCents),
    targets: { rfE6: toNumberSafe(result.targets.rfE6), rvE6: toNumberSafe(result.targets.rvE6) },
    groups: result.groups.map((group) => ({
      key: group.key,
      valueCents: toNumberSafe(group.valueCents),
      pctBefore: group.pctBefore,
      targetE6: toNumberSafe(group.targetE6),
      suggestedCents: toNumberSafe(group.suggestedCents),
      afterValueCents: toNumberSafe(group.afterValueCents),
      pctAfter: group.pctAfter,
      aboveTarget: group.aboveTarget,
    })),
    stale: result.stale,
  };
}

export function registerRebalanceRoutes(app: FastifyInstance, db: Db): void {
  app.get<{ Querystring: { amountCents?: string; rfE6?: string; rvE6?: string } }>("/api/rebalance", (request, reply) => {
    const rf = parseE6Param(request.query.rfE6);
    const rv = parseE6Param(request.query.rvE6);
    const amount = parseCentsParam(request.query.amountCents);
    if (!rf.ok) return reply.code(400).send({ error: rf.error });
    if (!rv.ok) return reply.code(400).send({ error: rv.error });
    if (!amount.ok) return reply.code(400).send({ error: amount.error });
    if ((rf.value === undefined) !== (rv.value === undefined)) {
      return reply.code(400).send({ error: "rfE6 e rvE6 devem vir juntos" });
    }
    let targets: Targets | undefined;
    if (rf.value !== undefined && rv.value !== undefined) {
      const parsed = validateTargets(rf.value, rv.value);
      if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
      targets = parsed.value;
    }
    return toApiRebalance(buildRebalance(db, { amountCents: amount.value, targetsE6: targets }));
  });

  app.put<{ Body: unknown }>("/api/rebalance", (request, reply) => {
    if (!isRecord(request.body)) return reply.code(400).send({ error: "corpo deve ser um objeto" });
    const { rfE6, rvE6 } = request.body;
    if (!Number.isSafeInteger(rfE6) || !Number.isSafeInteger(rvE6)) {
      return reply.code(400).send({ error: "metas devem ser inteiras" });
    }
    const targets = validateTargets(BigInt(rfE6 as number), BigInt(rvE6 as number));
    if (!targets.ok) return reply.code(400).send({ error: targets.error });
    const saved = saveRebalanceTargets(db, targets.value);
    return {
      rfE6: toNumberSafe(saved.rfE6),
      rvE6: toNumberSafe(saved.rvE6),
      updatedAt: saved.updatedAt,
    };
  });
}
