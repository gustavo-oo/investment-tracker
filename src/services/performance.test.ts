import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { insertInstruments, insertTransactions, writeIndexRates } from "../db/repos.ts";
import type { InstrumentRow } from "../db/repos.ts";
import { buildPerformance } from "./performance.ts";

const cdb: InstrumentRow = {
  id: "cdb-1", legacyKey: "CDB 1", name: "CDB 1", kind: "fixed_income", category: "cdb",
  ticker: null, quoteSource: null, quoteSymbol: null, currency: "BRL", benchmark: "CDI",
  rateE6: 1_000_000n, maturityDate: null, liquidity: null, broker: "PagBank",
  objective: "Reserva", investor: "Ana",
};
const now = () => new Date("2026-09-18T12:00:00-03:00");
const buy = (tradeDate: string, grossCents: bigint) =>
  ({ instrumentId: cdb.id, tradeDate, kind: "BUY" as const, quantityE8: null, grossCents, feesCents: 0n, note: null, legacyRow: null });

test("buildPerformance calcula meses, acumulado e MWR com fluxos datados", () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [cdb]);
  insertTransactions(db, [buy("2026-04-23", 100_000n), buy("2026-06-10", 50_000n)]);
  writeIndexRates(db, [
    { series: "CDI", date: "2026-05-02", valueE12: 10_000_000_000n },
    { series: "CDI", date: "2026-06-02", valueE12: 10_000_000_000n },
    { series: "IPCA", date: "2026-04-01", valueE12: 3_000_000_000n },
  ]);

  const result = buildPerformance(db, { from: "2026-05", to: "2026-06" }, { now });
  assert.deepEqual({ from: result.from, to: result.to }, { from: "2026-05", to: "2026-06" });
  assert.equal(result.monthsTotal, 2);
  assert.deepEqual(result.months.map((month) => [month.month, month.portfolioPct, month.cdiPct]), [
    ["2026-05", 1, 1],        // 101000 sobre 100000
    ["2026-06", 0.7519, 1],   // 1010 ÷ (101000 + 50000 × 20/30)
  ]);
  assert.equal(result.months[1]?.rendimentoCents, 1_010n);
  assert.deepEqual(result.months.map((month) => month.baseCents), [100_000n, 134_333n]);
  assert.equal(result.months[1]?.investedCents, 50_000n);
  assert.deepEqual(result.accumulated, { portfolioPct: 1.7594, cdiPct: 2.01, ipcaPct: 0, diffCdiPp: -0.2506, diffIpcaPp: 1.7594, realPct: 1.7594 });
  assert.equal(result.monthsBeaten, 0);
  assert.deepEqual(result.mwr, { periodPct: 1.7283, months: 2 });
});

test("buildPerformance clampa a janela e MWR fica abaixo do TWR com aporte grande", () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [cdb]);
  insertTransactions(db, [buy("2026-04-23", 100_000n), buy("2026-07-10", 500_000n)]);
  writeIndexRates(db, [
    { series: "CDI", date: "2026-05-02", valueE12: 10_000_000_000n },
    { series: "CDI", date: "2026-06-02", valueE12: 10_000_000_000n },
  ]);

  const result = buildPerformance(db, { from: "2000-01", to: "2026-09" }, { now });
  assert.deepEqual({ from: result.from, to: result.to }, { from: "2026-05", to: "2026-09" });
  assert.equal(result.monthsTotal, 5);
  assert.equal(result.accumulated.portfolioPct, 2.01);
  assert.ok(result.mwr.periodPct !== null && result.mwr.periodPct < result.accumulated.portfolioPct);
  assert.ok(result.mwr.periodPct !== null && result.mwr.periodPct > 0);
});

test("buildPerformance sem dados devolve meses nulos e MWR nulo", () => {
  const db = openDb(":memory:");
  migrate(db);
  const result = buildPerformance(db, { from: "2026-08", to: "2026-09" }, { now });
  assert.equal(result.monthsTotal, 2);
  assert.equal(result.months[0]?.portfolioPct, null);
  assert.equal(result.months[0]?.baseCents, null);
  assert.equal(result.months[0]?.realPct, null);
  assert.equal(result.accumulated.portfolioPct, 0);
  assert.equal(result.mwr.periodPct, null);
});

test("buildPerformance expõe o líquido (Carteira − IPCA) por mês", () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [cdb]);
  insertTransactions(db, [buy("2026-04-23", 100_000n)]);
  writeIndexRates(db, [
    { series: "CDI", date: "2026-05-02", valueE12: 10_000_000_000n },
    { series: "IPCA", date: "2026-05-01", valueE12: 3_000_000_000n },
  ]);

  const result = buildPerformance(db, { from: "2026-05", to: "2026-06" }, { now });
  // maio: carteira +1,0000% e IPCA +0,3000% → (1,01 ÷ 1,003) − 1 = 0,6979%
  assert.equal(result.months[0]?.realPct, 0.6979);
  // junho: sem IPCA no mês → null
  assert.equal(result.months[1]?.realPct, null);
});
