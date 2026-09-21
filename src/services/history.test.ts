import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { insertInstruments, insertTransactions, writeFundQuotas, writeIndexRates } from "../db/repos.ts";
import type { InstrumentRow } from "../db/repos.ts";
import { buildHistory, resolveHistoryWindow } from "./history.ts";

const cdb: InstrumentRow = {
  id: "cdb-1", legacyKey: "CDB 1", name: "CDB 1", kind: "fixed_income", category: "cdb",
  ticker: null, quoteSource: null, quoteSymbol: null, currency: "BRL", benchmark: "CDI",
  rateE6: 1_000_000n, maturityDate: null, liquidity: null, broker: "PagBank",
  objective: "Reserva", investor: "Ana",
};

const pgbl: InstrumentRow = {
  id: "pgbl-1", legacyKey: "PGBL 1", name: "PGBL 1", kind: "pension", category: "pension_ipca",
  ticker: null, quoteSource: "cvm-swb", quoteSymbol: "253210", currency: "BRL", benchmark: null,
  rateE6: null, maturityDate: null, liquidity: null, broker: "BTG", objective: "Aposentadoria", investor: "Ana",
};

test("history inclui previdência com cota", () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [pgbl]);
  insertTransactions(db, [{ instrumentId: pgbl.id, tradeDate: "2026-09-17", kind: "BUY", quantityE8: 5_00000000n, grossCents: 50_000n, feesCents: 0n, note: null, legacyRow: null }]);
  writeFundQuotas(db, [{ symbol: "253210", date: "2026-09-17", quotaE12: 1_220_696_672_715n, source: "cvm-swb", settled: true }], "2026-09-18");
  const points = buildHistory(db, { from: "2026-09", to: "2026-09" }, { now: () => new Date("2026-09-18T12:00:00-03:00") });
  assert.equal(points[0]?.marketValueCents, 610n);
  assert.equal(points[0]?.investedCents, 50_000n);
});

test("history devolve 12 meses com total, aportes e índices do mês", () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [cdb]);
  insertTransactions(db, [
    { instrumentId: cdb.id, tradeDate: "2026-01-02", kind: "BUY", quantityE8: null, grossCents: 100_000n, feesCents: 5_000n, note: null, legacyRow: null },
    { instrumentId: cdb.id, tradeDate: "2026-02-10", kind: "SELL", quantityE8: null, grossCents: 20_000n, feesCents: 0n, note: null, legacyRow: null },
  ]);
  writeIndexRates(db, [
    { series: "CDI", date: "2026-01-02", valueE12: 1_000_000_000n },
    { series: "IPCA", date: "2026-01-01", valueE12: 4_200_000_000n },
  ]);
  const now = () => new Date("2026-09-18T12:00:00-03:00");
  const points = buildHistory(db, {}, { now });
  assert.equal(points.length, 12);
  assert.equal(points[0]?.month, "2025-10");
  const jan = points.find((point) => point.month === "2026-01");
  assert.equal(jan?.investedCents, 105_000n);
  assert.equal(jan?.marketValueCents, 100_100n);
  assert.equal(jan?.cdiPct, 0.1);
  assert.equal(jan?.ipcaPct, 0.42);
  const feb = points.find((point) => point.month === "2026-02");
  assert.equal(feb?.marketValueCents, 80_100n, "resgate de 20_000 sai do saldo capitalizado");
  assert.equal(feb?.redeemedCents, 20_000n);
  const sep = points.find((point) => point.month === "2026-09");
  assert.equal(sep?.marketValueCents, 80_100n, "mês corrente usa hoje como asOf");
});

test("resolveHistoryWindow clampa no primeiro mês com retorno", () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [cdb]);
  insertTransactions(db, [{ instrumentId: cdb.id, tradeDate: "2025-04-23", kind: "BUY", quantityE8: null, grossCents: 100_000n, feesCents: 0n, note: null, legacyRow: null }]);
  writeIndexRates(db, [{ series: "CDI", date: "2025-05-02", valueE12: 1_000_000_000n }]);
  const now = () => new Date("2026-09-18T12:00:00-03:00");

  // abr/2025 é atividade inicial; mai/2025 é o primeiro mês com mês anterior > 0
  assert.deepEqual(resolveHistoryWindow(db, { from: "2000-01", to: "2026-09" }, { now }), { from: "2025-05", to: "2026-09" });
  // pedido depois do clamp fica intacto
  assert.deepEqual(resolveHistoryWindow(db, { from: "2025-08", to: "2026-09" }, { now }), { from: "2025-08", to: "2026-09" });
  // default: to = mês corrente, from = to − 11
  assert.deepEqual(resolveHistoryWindow(db, {}, { now }), { from: "2025-10", to: "2026-09" });
});

test("resolveHistoryWindow sem transações mantém a janela pedida", () => {
  const db = openDb(":memory:");
  migrate(db);
  const now = () => new Date("2026-09-18T12:00:00-03:00");
  assert.deepEqual(resolveHistoryWindow(db, { from: "2000-01", to: "2026-09" }, { now }), { from: "2000-01", to: "2026-09" });
});
