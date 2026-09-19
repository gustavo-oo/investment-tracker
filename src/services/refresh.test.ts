import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { insertInstruments, insertTransactions } from "../db/repos.ts";
import type { InstrumentRow } from "../db/repos.ts";
import type { IndexSource, QuoteSource } from "../sources/types.ts";
import { RefreshBusyError, RefreshRequestError, refresh } from "./refresh.ts";

const cdbInstrument: InstrumentRow = {
  id: "cdb-1", legacyKey: "CDB 1", name: "CDB 1", kind: "fixed_income", category: "cdb",
  ticker: null, quoteSource: null, quoteSymbol: null, currency: "BRL", benchmark: "CDI",
  rateE6: 1_000_000n, maturityDate: null, liquidity: null, broker: "PagBank", objective: "Reserva", investor: "Ana",
};

const emptyQuoteSource: QuoteSource = { id: "yahoo", available: async () => true, fetchDaily: async () => [] };
const emptyIndexSource: IndexSource = { id: "bcb", fetchSeries: async () => [] };

test("fonte desconhecida e alphavantage sem chave falham com erro claro", async () => {
  const db = openDb(":memory:");
  migrate(db);
  await assert.rejects(() => refresh(db, { source: "xpto" }, { quoteSources: [emptyQuoteSource], indexSource: emptyIndexSource }), (error: unknown) => {
    assert.ok(error instanceof RefreshRequestError);
    assert.match(error.message, /fonte desconhecida: xpto/);
    return true;
  });
  await assert.rejects(() => refresh(db, { source: "alphavantage" }, { quoteSources: [emptyQuoteSource], indexSource: emptyIndexSource }), (error: unknown) => {
    assert.ok(error instanceof RefreshRequestError);
    assert.match(error.message, /alphavantage não configurado/);
    return true;
  });
});

test("quotesOnly roda só as cotações e não chama o BCB", async () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [cdbInstrument]);
  insertTransactions(db, [{ instrumentId: cdbInstrument.id, tradeDate: "2025-04-23", kind: "BUY", quantityE8: null, grossCents: 1000n, feesCents: 0n, note: null, legacyRow: null }]);
  let indexCalls = 0;
  const indexSource: IndexSource = {
    id: "bcb",
    fetchSeries: async (series) => { indexCalls++; return [{ series, date: "2026-09-17", valueE12: 1n }]; },
  };
  const quoteSource: QuoteSource = { id: "yahoo", available: async () => true, fetchDaily: async () => [] };
  const result = await refresh(db, { quotesOnly: true }, { quoteSources: [quoteSource], indexSource });
  assert.equal(indexCalls, 0);
  assert.deepEqual(result.sources.map((summary) => summary.id), ["yahoo"]);
});

test("mutex barra refresh concorrente", async () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [cdbInstrument]);
  insertTransactions(db, [{ instrumentId: cdbInstrument.id, tradeDate: "2025-04-23", kind: "BUY", quantityE8: null, grossCents: 1000n, feesCents: 0n, note: null, legacyRow: null }]);
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const blocked: IndexSource = {
    id: "bcb",
    fetchSeries: async (series) => { await gate; return [{ series, date: "2026-09-17", valueE12: 1n }]; },
  };
  const first = refresh(db, { source: "bcb" }, { quoteSources: [], indexSource: blocked });
  await assert.rejects(() => refresh(db, { source: "bcb" }, { quoteSources: [], indexSource: blocked }), RefreshBusyError);
  release();
  const result = await first;
  assert.equal(result.sources[0]?.id, "bcb");
});
