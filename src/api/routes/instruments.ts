import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/index.ts";
import type { InstrumentRow } from "../../db/repos.ts";
import { listInstruments, listTransactionsByInstrument } from "../../db/repos.ts";
import type { InstrumentCategory, InstrumentKind } from "../../domain/model.ts";
import { toNumberSafe } from "../../domain/money.ts";
import { createInstrument, patchInstrument, removeInstrument, type InstrumentInput } from "../../services/writes.ts";
import { toApiTransaction } from "./transactions.ts";

const KINDS: InstrumentKind[] = ["fixed_income", "equity", "pension"];
const CATEGORIES: InstrumentCategory[] = ["cdb", "lca", "selic", "etf_fixed", "etf_equity", "pension_ipca"];
const TEXT_KEYS = ["ticker", "quoteSymbol", "benchmark", "maturityDate", "liquidity", "broker", "objective", "investor"] as const;
const KEYS: string[] = ["name", "kind", "category", "rateE6", ...TEXT_KEYS];

type Body = Record<string, unknown>;

const isRecord = (value: unknown): value is Body => value !== null && typeof value === "object" && !Array.isArray(value);

function toApiInstrument(instrument: InstrumentRow) {
  return {
    id: instrument.id, name: instrument.name, kind: instrument.kind, category: instrument.category,
    ticker: instrument.ticker, quoteSource: instrument.quoteSource, quoteSymbol: instrument.quoteSymbol,
    currency: instrument.currency, benchmark: instrument.benchmark,
    rateE6: instrument.rateE6 === null ? null : toNumberSafe(instrument.rateE6),
    maturityDate: instrument.maturityDate, liquidity: instrument.liquidity,
    broker: instrument.broker, objective: instrument.objective, investor: instrument.investor,
  };
}

function parseBody(body: Body, partial: boolean): { ok: true; patch: Partial<InstrumentInput> } | { ok: false; error: string } {
  const unknown = Object.keys(body).filter((key) => !KEYS.includes(key));
  if (unknown.length > 0) return { ok: false, error: `campo desconhecido: ${unknown[0]}` };
  if (partial && Object.keys(body).length === 0) return { ok: false, error: "nada para atualizar" };
  const patch: Partial<InstrumentInput> = {};
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.trim() === "") return { ok: false, error: "nome inválido" };
    patch.name = body.name;
  }
  if (body.kind !== undefined) {
    if (typeof body.kind !== "string" || !KINDS.includes(body.kind as InstrumentKind)) return { ok: false, error: "classe inválida" };
    patch.kind = body.kind as InstrumentKind;
  }
  if (body.category !== undefined) {
    if (typeof body.category !== "string" || !CATEGORIES.includes(body.category as InstrumentCategory)) return { ok: false, error: "categoria inválida" };
    patch.category = body.category as InstrumentCategory;
  }
  for (const key of TEXT_KEYS) {
    if (body[key] === undefined) continue;
    const value = body[key];
    if (value === null) { patch[key] = null; continue; }
    if (typeof value !== "string") return { ok: false, error: `${key} inválido` };
    if (value.trim() === "") {
      if (key === "investor") return { ok: false, error: "investor deve ser Ana ou Beto" };
      patch[key] = null;
      continue;
    }
    patch[key] = value;
  }
  if (body.rateE6 !== undefined) {
    if (body.rateE6 === null) { patch.rateE6 = null; }
    else if (typeof body.rateE6 === "number" && Number.isSafeInteger(body.rateE6)) { patch.rateE6 = BigInt(body.rateE6); }
    else return { ok: false, error: "rentabilidade inválida" };
  }
  if (partial) return { ok: true, patch };
  for (const required of ["name", "kind", "category"] as const) {
    if (patch[required] === undefined) return { ok: false, error: `${required} obrigatório` };
  }
  const defaults: Partial<InstrumentInput> = {
    ticker: null, quoteSymbol: null, benchmark: null, rateE6: null, maturityDate: null,
    liquidity: null, broker: null, objective: null, investor: null,
  };
  return { ok: true, patch: { ...defaults, ...patch } };
}

export function registerInstrumentsRoutes(app: FastifyInstance, db: Db): void {
  app.get("/api/instruments", () => listInstruments(db).map(toApiInstrument));

  app.post<{ Body: unknown }>("/api/instruments", (request, reply) => {
    if (!isRecord(request.body)) return reply.code(400).send({ error: "corpo deve ser um objeto" });
    const parsed = parseBody(request.body, false);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    const result = createInstrument(db, parsed.patch as InstrumentInput);
    if (!result.ok) return reply.code(result.failure.status).send({ error: result.failure.message });
    return reply.code(201).send(toApiInstrument(result.value));
  });

  app.patch<{ Params: { id: string }; Body: unknown }>("/api/instruments/:id", (request, reply) => {
    if (!isRecord(request.body)) return reply.code(400).send({ error: "corpo deve ser um objeto" });
    const parsed = parseBody(request.body, true);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    const result = patchInstrument(db, request.params.id, parsed.patch);
    if (!result.ok) return reply.code(result.failure.status).send({ error: result.failure.message });
    return toApiInstrument(result.value);
  });

  app.delete<{ Params: { id: string } }>("/api/instruments/:id", (request, reply) => {
    const result = removeInstrument(db, request.params.id);
    if (!result.ok) return reply.code(result.failure.status).send({ error: result.failure.message });
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string } }>("/api/instruments/:id/transactions", (request) =>
    listTransactionsByInstrument(db, request.params.id).map(toApiTransaction));
}
