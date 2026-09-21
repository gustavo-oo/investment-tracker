import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { insertInstruments, insertTransactions, listAllFundQuotas, listAllQuotes } from "../db/repos.ts";
import type { InstrumentRow } from "../db/repos.ts";
import type { FundQuotaSource, IndexSource, MonthlyQuoteSource, QuoteSource } from "../sources/types.ts";
import { RefreshBusyError, RefreshRequestError, refresh } from "./refresh.ts";

const cdbInstrument: InstrumentRow = {
  id: "cdb-1", legacyKey: "CDB 1", name: "CDB 1", kind: "fixed_income", category: "cdb",
  ticker: null, quoteSource: null, quoteSymbol: null, currency: "BRL", benchmark: "CDI",
  rateE6: 1_000_000n, maturityDate: null, liquidity: null, broker: "PagBank", objective: "Reserva", investor: "Ana",
};

const pgblInstrument: InstrumentRow = {
  id: "pgbl-1", legacyKey: "PGBL 1", name: "PGBL 1", kind: "pension", category: "pension_ipca",
  ticker: null, quoteSource: "cvm-swb", quoteSymbol: "253210", currency: "BRL", benchmark: null,
  rateE6: null, maturityDate: null, liquidity: null, broker: "BTG", objective: "Aposentadoria", investor: "Ana",
};

const etfInstrument: InstrumentRow = {
  id: "etf-1", legacyKey: "ETF 1", name: "ETF 1", kind: "equity", category: "etf_equity",
  ticker: "WRLD11", quoteSource: null, quoteSymbol: null, currency: "BRL", benchmark: null,
  rateE6: null, maturityDate: null, liquidity: null, broker: "XP", objective: "Reserva", investor: "Ana",
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

test("source cvm-swb roda só a previdência e usa o quote_symbol", async () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [pgblInstrument]);
  insertTransactions(db, [{ instrumentId: pgblInstrument.id, tradeDate: "2025-10-01", kind: "BUY", quantityE8: 930_14877553n, grossCents: 100_000n, feesCents: 0n, note: null, legacyRow: null }]);
  const symbols: string[] = [];
  const pensionSource: FundQuotaSource = {
    id: "cvm-swb",
    fetchDaily: async (requested, from, to) => {
      symbols.push(requested[0]!);
      assert.equal(from, "2025-10-01");
      assert.equal(to, "2026-09-18");
      return [{ symbol: requested[0]!, date: "2026-09-17", quotaE12: 1_220_696_672_715n }];
    },
  };
  const result = await refresh(db, { source: "cvm-swb" }, {
    quoteSources: [], indexSource: emptyIndexSource, pensionSource,
    now: () => new Date("2026-09-18T14:00:00-03:00"),
  });
  assert.deepEqual(result.sources.map((summary) => summary.id), ["cvm-swb"]);
  assert.deepEqual(symbols, ["253210"]);
  assert.equal(listAllFundQuotas(db)[0]?.quotaE12, 1_220_696_672_715n);
});

test("quotesOnly não busca previdência", async () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [pgblInstrument]);
  insertTransactions(db, [{ instrumentId: pgblInstrument.id, tradeDate: "2025-10-01", kind: "BUY", quantityE8: 930_14877553n, grossCents: 100_000n, feesCents: 0n, note: null, legacyRow: null }]);
  let pensionCalls = 0;
  const pensionSource: FundQuotaSource = { id: "cvm-swb", fetchDaily: async () => { pensionCalls++; return []; } };
  const result = await refresh(db, { quotesOnly: true }, { quoteSources: [emptyQuoteSource], indexSource: emptyIndexSource, pensionSource });
  assert.deepEqual(result.sources.map((summary) => summary.id), ["yahoo"]);
  assert.equal(pensionCalls, 0);
});

test("refresh roda o reparo depois das cotações e devolve repairs", async () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [etfInstrument]);
  insertTransactions(db, [{ instrumentId: etfInstrument.id, tradeDate: "2025-04-23", kind: "BUY", quantityE8: 10_00000000n, grossCents: 9_000n, feesCents: 0n, note: null, legacyRow: null }]);
  const quotes: QuoteSource = {
    id: "yahoo", available: async () => true,
    fetchDaily: async () => Array.from({ length: 8 }, (_, index) => ({ ticker: "WRLD11", date: `2025-04-${String(index + 1).padStart(2, "0")}`, closeCents: 1_000n })),
  };
  const monthly: MonthlyQuoteSource = {
    id: "alphavantage", available: async () => true,
    fetchMonthly: async () => [{ ticker: "WRLD11", date: "2025-04-30", closeCents: 1_100n }],
  };
  const result = await refresh(db, {}, {
    quoteSources: [quotes], indexSource: emptyIndexSource, monthlySource: monthly,
    now: () => new Date("2026-09-21T12:00:00-03:00"),
  });
  assert.deepEqual(result.repairs, [{ ticker: "WRLD11", from: "2025-04-01", to: "2025-04-08", deleted: 8, inserted: 1 }]);
  assert.deepEqual(listAllQuotes(db).map((quote) => [quote.date, quote.closeCents, quote.source]), [["2025-04-30", 1_100n, "alphavantage"]]);
});

test("source cvm-swb não roda o reparo", async () => {
  const db = openDb(":memory:");
  migrate(db);
  let calls = 0;
  const monthly: MonthlyQuoteSource = { id: "alphavantage", available: async () => { calls++; return true; }, fetchMonthly: async () => [] };
  const result = await refresh(db, { source: "cvm-swb" }, {
    quoteSources: [], indexSource: emptyIndexSource, pensionSource: { id: "cvm-swb", fetchDaily: async () => [] }, monthlySource: monthly,
  });
  assert.deepEqual(result.repairs, []);
  assert.equal(calls, 0);
});
