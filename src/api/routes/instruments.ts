import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/index.ts";
import { listInstruments, listTransactionsByInstrument } from "../../db/repos.ts";
import { toNumberSafe } from "../../domain/money.ts";

export function registerInstrumentsRoutes(app: FastifyInstance, db: Db): void {
  app.get("/api/instruments", () => listInstruments(db).map((instrument) => ({
    id: instrument.id, name: instrument.name, kind: instrument.kind, category: instrument.category,
    ticker: instrument.ticker, quoteSource: instrument.quoteSource, quoteSymbol: instrument.quoteSymbol,
    currency: instrument.currency, benchmark: instrument.benchmark,
    rateE6: instrument.rateE6 === null ? null : toNumberSafe(instrument.rateE6),
    maturityDate: instrument.maturityDate, liquidity: instrument.liquidity,
    broker: instrument.broker, objective: instrument.objective, investor: instrument.investor,
  })));

  app.get<{ Params: { id: string } }>("/api/instruments/:id/transactions", (request) =>
    listTransactionsByInstrument(db, request.params.id).map((transaction) => ({
      tradeDate: transaction.tradeDate, kind: transaction.kind,
      quantityE8: transaction.quantityE8 === null ? null : toNumberSafe(transaction.quantityE8),
      grossCents: toNumberSafe(transaction.grossCents),
      feesCents: toNumberSafe(transaction.feesCents),
      note: transaction.note, legacyRow: transaction.legacyRow,
    })));
}
