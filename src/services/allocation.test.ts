import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { insertInstruments, insertTransactions, writeQuotes } from "../db/repos.ts";
import type { InstrumentRow } from "../db/repos.ts";
import { buildAllocation } from "./allocation.ts";
import { buildPortfolio } from "./portfolio.ts";

const base = {
  currency: "BRL", quoteSource: null, quoteSymbol: null, maturityDate: null,
  liquidity: null, investor: "Ana",
} as const;

const etfA: InstrumentRow = { ...base, id: "a", legacyKey: "A", name: "A", kind: "equity", category: "etf_equity", ticker: "WRLD11", benchmark: null, rateE6: null, broker: "XP", objective: "Aposentadoria" };
const etfB: InstrumentRow = { ...base, id: "b", legacyKey: "B", name: "B", kind: "equity", category: "etf_fixed", ticker: "B5P211", benchmark: null, rateE6: null, broker: "XP", objective: "Reserva" };

test("allocation agrupa por categoria com percentual", () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [etfA, etfB]);
  insertTransactions(db, [
    { instrumentId: "a", tradeDate: "2026-09-17", kind: "BUY", quantityE8: 10_00000000n, grossCents: 1_000n, feesCents: 0n, note: null, legacyRow: null },
    { instrumentId: "b", tradeDate: "2026-09-17", kind: "BUY", quantityE8: 30_00000000n, grossCents: 1_000n, feesCents: 0n, note: null, legacyRow: null },
  ]);
  writeQuotes(db, [
    { ticker: "WRLD11", date: "2026-09-17", closeCents: 1_000n, source: "yahoo", settled: true },
    { ticker: "B5P211", date: "2026-09-17", closeCents: 1_000n, source: "yahoo", settled: true },
  ], "2026-09-18");
  const result = buildAllocation(db, "category", { now: () => new Date("2026-09-18T12:00:00-03:00") });
  assert.deepEqual(result.groups, [
    { key: "etf_fixed", marketValueCents: 30_000n, pct: 75 },
    { key: "etf_equity", marketValueCents: 10_000n, pct: 25 },
  ]);
});

test("allocation omite grupos sem valor (0%)", () => {
  const db = openDb(":memory:");
  migrate(db);
  const encerrado: InstrumentRow = { ...base, id: "c", legacyKey: "C", name: "C", kind: "equity", category: "etf_equity", ticker: null, benchmark: null, rateE6: null, broker: "PagBank", objective: "Reserva" };
  insertInstruments(db, [etfB, encerrado]);
  insertTransactions(db, [
    { instrumentId: "b", tradeDate: "2026-09-17", kind: "BUY", quantityE8: 30_00000000n, grossCents: 1_000n, feesCents: 0n, note: null, legacyRow: null },
    { instrumentId: "c", tradeDate: "2026-09-17", kind: "BUY", quantityE8: 10_00000000n, grossCents: 1_000n, feesCents: 0n, note: null, legacyRow: null },
    { instrumentId: "c", tradeDate: "2026-09-17", kind: "SELL", quantityE8: -10_00000000n, grossCents: 1_000n, feesCents: 0n, note: null, legacyRow: null },
  ]);
  writeQuotes(db, [{ ticker: "B5P211", date: "2026-09-17", closeCents: 1_000n, source: "yahoo", settled: true }], "2026-09-18");
  const result = buildAllocation(db, "broker", { now: () => new Date("2026-09-18T12:00:00-03:00") });
  assert.deepEqual(result.groups, [{ key: "XP", marketValueCents: 30_000n, pct: 100 }]);
});

test("allocation soma o total do portfólio", () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [etfA, etfB]);
  insertTransactions(db, [
    { instrumentId: "a", tradeDate: "2026-09-17", kind: "BUY", quantityE8: 10_00000000n, grossCents: 1_000n, feesCents: 0n, note: null, legacyRow: null },
    { instrumentId: "b", tradeDate: "2026-09-17", kind: "BUY", quantityE8: 30_00000000n, grossCents: 1_000n, feesCents: 0n, note: null, legacyRow: null },
  ]);
  writeQuotes(db, [
    { ticker: "WRLD11", date: "2026-09-17", closeCents: 1_000n, source: "yahoo", settled: true },
    { ticker: "B5P211", date: "2026-09-17", closeCents: 1_000n, source: "yahoo", settled: true },
  ], "2026-09-18");
  const deps = { now: () => new Date("2026-09-18T12:00:00-03:00") };
  const soma = buildAllocation(db, "category", deps).groups.reduce((acc, group) => acc + group.marketValueCents, 0n);
  assert.equal(soma, buildPortfolio(db, deps).totals.marketValueCents);
});
