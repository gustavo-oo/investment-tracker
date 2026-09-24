import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/index.ts";
import { toNumberSafe } from "../../domain/money.ts";
import type { TransactionWithId } from "../../db/repos.ts";
import { addTransaction, editTransaction, removeTransaction, type TransactionInput } from "../../services/writes.ts";

const KEYS = ["tradeDate", "kind", "grossCents", "feesCents", "quantityE8", "note"];
const CENTS_KEYS = ["grossCents", "feesCents"] as const;

type Body = Record<string, unknown>;

const isRecord = (value: unknown): value is Body => value !== null && typeof value === "object" && !Array.isArray(value);

export function toApiTransaction(transaction: TransactionWithId) {
  return {
    id: transaction.id, tradeDate: transaction.tradeDate, kind: transaction.kind,
    quantityE8: transaction.quantityE8 === null ? null : toNumberSafe(transaction.quantityE8),
    grossCents: toNumberSafe(transaction.grossCents), feesCents: toNumberSafe(transaction.feesCents),
    note: transaction.note, legacyRow: transaction.legacyRow,
  };
}

function parseBody(body: Body, partial: boolean): { ok: true; patch: Partial<TransactionInput> } | { ok: false; error: string } {
  const unknown = Object.keys(body).filter((key) => !KEYS.includes(key));
  if (unknown.length > 0) return { ok: false, error: `campo desconhecido: ${unknown[0]}` };
  if (partial && Object.keys(body).length === 0) return { ok: false, error: "nada para atualizar" };
  const patch: Partial<TransactionInput> = {};
  if (body.tradeDate !== undefined) {
    if (typeof body.tradeDate !== "string") return { ok: false, error: "data inválida" };
    patch.tradeDate = body.tradeDate;
  }
  if (body.kind !== undefined) {
    if (body.kind !== "BUY" && body.kind !== "SELL") return { ok: false, error: "tipo deve ser Compra ou Resgate" };
    patch.kind = body.kind;
  }
  for (const key of CENTS_KEYS) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== "number" || !Number.isSafeInteger(body[key])) return { ok: false, error: `${key} deve ser inteiro em centavos` };
    patch[key] = BigInt(body[key]);
  }
  if (body.quantityE8 !== undefined) {
    if (body.quantityE8 === null) { patch.quantityE8 = null; }
    else if (typeof body.quantityE8 === "number" && Number.isSafeInteger(body.quantityE8)) { patch.quantityE8 = BigInt(body.quantityE8); }
    else return { ok: false, error: "quantidade deve ser inteiro escalonado (8 casas)" };
  }
  if (body.note !== undefined) {
    if (body.note === null) { patch.note = null; }
    else if (typeof body.note === "string") { patch.note = body.note.trim() === "" ? null : body.note.trim(); }
    else return { ok: false, error: "nota inválida" };
  }
  if (partial) return { ok: true, patch };
  for (const required of ["tradeDate", "kind", "grossCents"] as const) {
    if (patch[required] === undefined) return { ok: false, error: `${required} obrigatório` };
  }
  return { ok: true, patch: { feesCents: 0n, quantityE8: null, note: null, ...patch } };
}

export function registerTransactionsRoutes(app: FastifyInstance, db: Db): void {
  app.post<{ Params: { id: string }; Body: unknown }>("/api/instruments/:id/transactions", (request, reply) => {
    if (!isRecord(request.body)) return reply.code(400).send({ error: "corpo deve ser um objeto" });
    const parsed = parseBody(request.body, false);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    const result = addTransaction(db, request.params.id, parsed.patch as TransactionInput);
    if (!result.ok) return reply.code(result.failure.status).send({ error: result.failure.message });
    return reply.code(201).send(toApiTransaction(result.value));
  });

  app.patch<{ Params: { id: string }; Body: unknown }>("/api/transactions/:id", (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return reply.code(404).send({ error: "transação não encontrada" });
    if (!isRecord(request.body)) return reply.code(400).send({ error: "corpo deve ser um objeto" });
    const parsed = parseBody(request.body, true);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    const result = editTransaction(db, id, parsed.patch);
    if (!result.ok) return reply.code(result.failure.status).send({ error: result.failure.message });
    return toApiTransaction(result.value);
  });

  app.delete<{ Params: { id: string } }>("/api/transactions/:id", (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return reply.code(404).send({ error: "transação não encontrada" });
    const result = removeTransaction(db, id);
    if (!result.ok) return reply.code(result.failure.status).send({ error: result.failure.message });
    return reply.code(204).send();
  });
}
