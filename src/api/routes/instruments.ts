import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/index.ts";
import type { InstrumentRow } from "../../db/repos.ts";
import { listInstruments, listTransactionsByInstrument, updateInstrumentInvestor } from "../../db/repos.ts";
import { toNumberSafe } from "../../domain/money.ts";

const INVESTORS = ["Ana", "Beto"] as const;

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

export function registerInstrumentsRoutes(app: FastifyInstance, db: Db): void {
  app.get("/api/instruments", () => listInstruments(db).map(toApiInstrument));

  app.patch<{ Params: { id: string }; Body: unknown }>("/api/instruments/:id", (request, reply) => {
    const body = request.body;
    if (body === null || body === undefined || typeof body !== "object" || Array.isArray(body)) {
      return reply.code(400).send({ error: "corpo deve ser { investor }" });
    }
    const keys = Object.keys(body);
    if (keys.length !== 1 || keys[0] !== "investor") {
      return reply.code(400).send({ error: "corpo deve conter apenas investor" });
    }
    const investor = (body as { investor?: unknown }).investor;
    if (typeof investor !== "string" || !(INVESTORS as readonly string[]).includes(investor)) {
      return reply.code(400).send({ error: "investor deve ser Ana ou Beto" });
    }
    const updated = updateInstrumentInvestor(db, request.params.id, investor);
    if (updated === undefined) {
      return reply.code(404).send({ error: "instrumento não encontrado" });
    }
    return toApiInstrument(updated);
  });

  app.get<{ Params: { id: string } }>("/api/instruments/:id/transactions", (request) =>
    listTransactionsByInstrument(db, request.params.id).map((transaction) => ({
      tradeDate: transaction.tradeDate, kind: transaction.kind,
      quantityE8: transaction.quantityE8 === null ? null : toNumberSafe(transaction.quantityE8),
      grossCents: toNumberSafe(transaction.grossCents),
      feesCents: toNumberSafe(transaction.feesCents),
      note: transaction.note, legacyRow: transaction.legacyRow,
    })));
}
