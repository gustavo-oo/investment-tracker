import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import {
  insertInstruments, insertTransactions, listAllQuotes, listSourceStatus, writeQuotes,
} from "../db/repos.ts";
import type { InstrumentRow } from "../db/repos.ts";
import type { Quote, QuoteSource } from "../sources/types.ts";
import { refreshQuotes } from "./refresh-quotes.ts";

const equity: InstrumentRow = {
  id: "etf-1", legacyKey: "ETF 1", name: "ETF 1", kind: "equity", category: "etf_equity",
  ticker: "WRLD11", quoteSource: "yahoo", quoteSymbol: null, currency: "BRL",
  benchmark: null, rateE6: null, maturityDate: null, liquidity: null, broker: "XP",
  objective: "Aposentadoria", investor: "Ana",
};

function freshDb() {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [equity]);
  insertTransactions(db, [{ instrumentId: equity.id, tradeDate: "2025-04-23", kind: "BUY", quantityE8: 1_00000000n, grossCents: 1000n, feesCents: 0n, note: null, legacyRow: null }]);
  return db;
}

const fakeSource = (id: string, resolver: (ticker: string, from: string, to: string) => Quote[] | Promise<Quote[]>): QuoteSource => ({
  id,
  available: async () => true,
  fetchDaily: async (symbols, from, to) => resolver(symbols[0]!, from, to),
});

const NOW = () => new Date("2026-09-18T14:00:00-03:00");

test("refresh escreve fechado imutável e atualiza só o parcial de hoje", async () => {
  const db = freshDb();
  const calls: Array<{ from: string; to: string }> = [];
  const yahoo = fakeSource("yahoo", (_ticker, from, to) => {
    calls.push({ from, to });
    return [
      { ticker: "WRLD11", date: "2025-04-23", closeCents: 1000n },
      { ticker: "WRLD11", date: "2026-09-18", closeCents: 2000n },
    ];
  });
  const first = await refreshQuotes(db, { sources: [yahoo], now: NOW, fallbackAttempts: new Map() });
  assert.deepEqual(first[0], { id: "yahoo", fetched: 2, inserted: 2, updated: 0, skipped: 0, errors: [] });
  assert.equal(calls[0]?.from, "2025-04-23");

  const second = await refreshQuotes(db, {
    sources: [fakeSource("yahoo", (_ticker, from, to) => {
      calls.push({ from, to });
      return [
        { ticker: "WRLD11", date: "2025-04-23", closeCents: 9999n },
        { ticker: "WRLD11", date: "2026-09-18", closeCents: 2100n },
      ];
    })],
    now: NOW,
    fallbackAttempts: new Map(),
  });
  assert.deepEqual(second[0], { id: "yahoo", fetched: 2, inserted: 0, updated: 1, skipped: 1, errors: [] });
  assert.equal(calls[1]?.from, "2026-09-18");
  assert.deepEqual(listAllQuotes(db), [
    { ticker: "WRLD11", date: "2025-04-23", closeCents: 1000n, source: "yahoo", settled: true },
    { ticker: "WRLD11", date: "2026-09-18", closeCents: 2100n, source: "yahoo", settled: false },
  ]);
});

test("parcial de ontem finaliza no fetch do dia seguinte", async () => {
  const db = freshDb();
  await refreshQuotes(db, { sources: [fakeSource("yahoo", () => [{ ticker: "WRLD11", date: "2026-09-18", closeCents: 2000n }])], now: NOW, fallbackAttempts: new Map() });
  const nextDay = () => new Date("2026-09-19T10:00:00-03:00");
  const result = await refreshQuotes(db, { sources: [fakeSource("yahoo", () => [{ ticker: "WRLD11", date: "2026-09-18", closeCents: 2075n }])], now: nextDay, fallbackAttempts: new Map() });
  assert.deepEqual(result[0], { id: "yahoo", fetched: 1, inserted: 0, updated: 1, skipped: 0, errors: [] });
  assert.deepEqual(listAllQuotes(db)[0], { ticker: "WRLD11", date: "2026-09-18", closeCents: 2075n, source: "yahoo", settled: true });
});

test("fallback AV roda 1× no dia quando o Yahoo falha e registra erro do Yahoo", async () => {
  const db = freshDb();
  let avCalls = 0;
  const yahoo = fakeSource("yahoo", () => { throw new Error("yahoo fora do ar"); });
  const av = fakeSource("alphavantage", () => { avCalls++; return [{ ticker: "WRLD11", date: "2025-04-23", closeCents: 1234n }]; });
  const attempts = new Map<string, string>();
  const first = await refreshQuotes(db, { sources: [yahoo, av], now: NOW, fallbackAttempts: attempts });
  assert.equal(first[0]?.errors.length, 1);
  assert.match(first[0]?.errors[0] ?? "", /yahoo fora do ar/);
  assert.equal(first[1]?.inserted, 1);
  await refreshQuotes(db, { sources: [yahoo, av], now: NOW, fallbackAttempts: attempts });
  assert.equal(avCalls, 1, "segunda falha do Yahoo no mesmo dia não gasta cota do AV");
  assert.equal(listAllQuotes(db)[0]?.source, "alphavantage");
  const yahooStatus = listSourceStatus(db).find((status) => status.source === "yahoo");
  assert.equal(yahooStatus?.lastError !== null, true);
});

test("full ignora a fronteira e começa da 1ª transação", async () => {
  const db = freshDb();
  writeQuotes(db, [{ ticker: "WRLD11", date: "2026-09-17", closeCents: 1_000n, source: "yahoo", settled: true }], "2026-09-18");
  const froms: string[] = [];
  const source = fakeSource("yahoo", (_ticker, from) => { froms.push(from); return []; });
  await refreshQuotes(db, { sources: [source], now: NOW, fallbackAttempts: new Map() });
  await refreshQuotes(db, { sources: [source], now: NOW, full: true, fallbackAttempts: new Map() });
  assert.deepEqual(froms, ["2026-09-17", "2025-04-23"]);
});
