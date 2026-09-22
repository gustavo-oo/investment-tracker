import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import {
  insertInstruments, insertTransactions, recordSourceAttempt, writeFundQuotas, writeIndexRates, writeQuotes,
} from "../db/repos.ts";
import type { InstrumentRow } from "../db/repos.ts";
import { buildPortfolio } from "./portfolio.ts";

const base = {
  currency: "BRL", quoteSource: null, quoteSymbol: null, maturityDate: null,
  liquidity: null, broker: "PagBank", objective: "Reserva", investor: "Ana",
} as const;

const cdb: InstrumentRow = { ...base, id: "cdb-1", legacyKey: "CDB 1", name: "CDB 1", kind: "fixed_income", category: "cdb", ticker: null, benchmark: "CDI", rateE6: 1_000_000n };
const etf: InstrumentRow = { ...base, id: "etf-1", legacyKey: "ETF 1", name: "ETF 1", kind: "equity", category: "etf_equity", ticker: "WRLD11", benchmark: null, rateE6: null };
const pgbl: InstrumentRow = { ...base, id: "pgbl-1", legacyKey: "PGBL 1", name: "PGBL 1", kind: "pension", category: "pension_ipca", ticker: null, quoteSource: "cvm-swb", quoteSymbol: "253210", benchmark: null, rateE6: null };

const NOW = () => new Date("2026-09-18T12:00:00-03:00");

test("portfolio calcula RF, RV e PGBL, e marca stale por fonte", () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [cdb, etf, pgbl]);
  insertTransactions(db, [
    { instrumentId: cdb.id, tradeDate: "2026-09-17", kind: "BUY", quantityE8: null, grossCents: 100_000n, feesCents: 0n, note: null, legacyRow: null },
    { instrumentId: etf.id, tradeDate: "2026-09-17", kind: "BUY", quantityE8: 10_00000000n, grossCents: 9_000n, feesCents: 100n, note: null, legacyRow: null },
    { instrumentId: pgbl.id, tradeDate: "2026-09-17", kind: "BUY", quantityE8: 5_00000000n, grossCents: 50_000n, feesCents: 0n, note: null, legacyRow: null },
  ]);
  writeIndexRates(db, [{ series: "CDI", date: "2026-09-17", valueE12: 1_000_000_000n }]);
  writeQuotes(db, [{ ticker: "WRLD11", date: "2026-09-17", closeCents: 1_000n, source: "yahoo", settled: true }], "2026-09-18");
  writeFundQuotas(db, [{ symbol: "253210", date: "2026-09-17", quotaE12: 1_220_696_672_715n, source: "cvm-swb", settled: true }], "2026-09-18");
  recordSourceAttempt(db, "bcb", { ok: true });
  recordSourceAttempt(db, "yahoo", { ok: false, error: "HTTP 502" });
  recordSourceAttempt(db, "cvm-swb", { ok: true });

  const portfolio = buildPortfolio(db, { now: NOW });
  assert.equal(portfolio.asOf, "2026-09-18");
  const [rf, equity, pension] = portfolio.positions;
  assert.equal(rf?.marketValueCents, 100_100n); // 0,1% CDI no dia 17
  assert.equal(rf?.priceSource, "bcb");
  assert.equal(rf?.stale, false);
  assert.equal(equity?.marketValueCents, 10_000n); // 10 cotas × R$ 10,00
  assert.equal(equity?.priceDate, "2026-09-17");
  assert.equal(equity?.stale, true); // yahoo com erro
  assert.equal(pension?.marketValueCents, 610n); // 5 cotas × R$ 1,220696672715
  assert.equal(pension?.priceCents, 122n);
  assert.equal(pension?.priceDate, "2026-09-17");
  assert.equal(pension?.priceSource, "cvm-swb");
  assert.equal(pension?.stale, false);
  assert.deepEqual(portfolio.totals, { investedCents: 159_100n, redeemedCents: 0n, feesCents: 100n, marketValueCents: 110_710n });
  assert.equal(portfolio.sources.find((source) => source.id === "yahoo")?.stale, true);
});

test("buildPortfolio aceita asOf explícito (reconciliação)", () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [etf]);
  insertTransactions(db, [{ instrumentId: etf.id, tradeDate: "2026-09-01", kind: "BUY", quantityE8: 10_00000000n, grossCents: 9_000n, feesCents: 0n, note: null, legacyRow: null }]);
  writeQuotes(db, [
    { ticker: "WRLD11", date: "2026-09-15", closeCents: 1_000n, source: "yahoo", settled: true },
    { ticker: "WRLD11", date: "2026-09-20", closeCents: 2_000n, source: "yahoo", settled: true },
  ], "2026-09-21");
  assert.equal(buildPortfolio(db, { asOf: "2026-09-15" }).positions[0]?.marketValueCents, 10_000n);
  assert.equal(buildPortfolio(db, { asOf: "2026-09-20" }).positions[0]?.marketValueCents, 20_000n);
});

const cdbVencido: InstrumentRow = { ...cdb, id: "cdb-vencido", legacyKey: "CDB Vencido", name: "CDB Vencido", maturityDate: "2026-09-17" };

test("portfolio congela título vencido e expõe pendingRedemption", () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [cdbVencido]);
  insertTransactions(db, [{ instrumentId: cdbVencido.id, tradeDate: "2026-09-15", kind: "BUY", quantityE8: null, grossCents: 100_000n, feesCents: 0n, note: null, legacyRow: null }]);
  writeIndexRates(db, [
    { series: "CDI", date: "2026-09-15", valueE12: 1_000_000_000n },
    { series: "CDI", date: "2026-09-16", valueE12: 1_000_000_000n },
    { series: "CDI", date: "2026-09-17", valueE12: 1_000_000_000n },
    { series: "CDI", date: "2026-09-18", valueE12: 1_000_000_000n },
  ]);
  const portfolio = buildPortfolio(db, { now: NOW }); // NOW = 2026-09-18
  const posicao = portfolio.positions[0];
  assert.equal(posicao?.marketValueCents, 100_200n); // 15 e 16/09; o dia do vencimento não entra
  assert.equal(posicao?.priceDate, "2026-09-16");
  assert.equal(posicao?.maturityDate, "2026-09-17");
  assert.equal(posicao?.pendingRedemption, true);
});

test("PGBL sem cota fica null + stale", () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [pgbl]);
  insertTransactions(db, [{ instrumentId: pgbl.id, tradeDate: "2026-09-17", kind: "BUY", quantityE8: 5_00000000n, grossCents: 50_000n, feesCents: 0n, note: null, legacyRow: null }]);
  const portfolio = buildPortfolio(db, { now: NOW });
  const pension = portfolio.positions[0];
  assert.equal(pension?.marketValueCents, null);
  assert.equal(pension?.priceSource, null);
  assert.equal(pension?.stale, true);
});
