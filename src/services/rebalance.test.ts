import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import {
  insertInstruments, insertTransactions, recordSourceAttempt, writeFundQuotas, writeIndexRates, writeQuotes,
} from "../db/repos.ts";
import type { InstrumentRow } from "../db/repos.ts";
import { buildRebalance } from "./rebalance.ts";

const base = {
  currency: "BRL", quoteSource: null, quoteSymbol: null, maturityDate: null,
  liquidity: null, broker: "PagBank", objective: "Aposentadoria", investor: "Ana",
} as const;

const cdb: InstrumentRow = { ...base, id: "cdb-1", legacyKey: "CDB 1", name: "CDB 1", kind: "fixed_income", category: "cdb", ticker: null, benchmark: "CDI", rateE6: 1_000_000n };
const etfRf: InstrumentRow = { ...base, id: "etf-rf-1", legacyKey: "ETF RF 1", name: "ETF RF 1", kind: "equity", category: "etf_fixed", ticker: "B5P211", benchmark: null, rateE6: null };
const etfRv: InstrumentRow = { ...base, id: "etf-rv-1", legacyKey: "ETF RV 1", name: "ETF RV 1", kind: "equity", category: "etf_equity", ticker: "WRLD11", benchmark: null, rateE6: null };
const pgbl: InstrumentRow = { ...base, id: "pgbl-1", legacyKey: "PGBL 1", name: "PGBL 1", kind: "pension", category: "pension_ipca", ticker: null, quoteSource: "cvm-swb", quoteSymbol: "253210", benchmark: null, rateE6: null };
const reservaCdb: InstrumentRow = { ...cdb, id: "reserva-1", legacyKey: "Reserva 1", name: "Reserva 1", objective: "Reserva" };
const pgblSemCota: InstrumentRow = { ...pgbl, id: "pgbl-2", legacyKey: "PGBL 2", name: "PGBL 2", quoteSymbol: "999999" };

const NOW = () => new Date("2026-09-18T12:00:00-03:00");

function seed(db: ReturnType<typeof openDb>) {
  insertInstruments(db, [cdb, etfRf, etfRv, pgbl, reservaCdb, pgblSemCota]);
  insertTransactions(db, [
    { instrumentId: cdb.id, tradeDate: "2026-09-17", kind: "BUY", quantityE8: null, grossCents: 100_000n, feesCents: 0n, note: null, legacyRow: null },
    { instrumentId: etfRf.id, tradeDate: "2026-09-17", kind: "BUY", quantityE8: 10_00000000n, grossCents: 9_000n, feesCents: 0n, note: null, legacyRow: null },
    { instrumentId: etfRv.id, tradeDate: "2026-09-17", kind: "BUY", quantityE8: 10_00000000n, grossCents: 9_000n, feesCents: 0n, note: null, legacyRow: null },
    { instrumentId: pgbl.id, tradeDate: "2026-09-17", kind: "BUY", quantityE8: 5_00000000n, grossCents: 50_000n, feesCents: 0n, note: null, legacyRow: null },
    { instrumentId: reservaCdb.id, tradeDate: "2026-09-17", kind: "BUY", quantityE8: null, grossCents: 100_000n, feesCents: 0n, note: null, legacyRow: null },
    { instrumentId: pgblSemCota.id, tradeDate: "2026-09-17", kind: "BUY", quantityE8: 5_00000000n, grossCents: 50_000n, feesCents: 0n, note: null, legacyRow: null },
  ]);
  writeIndexRates(db, [{ series: "CDI", date: "2026-09-17", valueE12: 1_000_000_000n }]);
  writeQuotes(db, [
    { ticker: "B5P211", date: "2026-09-17", closeCents: 1_000n, source: "yahoo", settled: true },
    { ticker: "WRLD11", date: "2026-09-17", closeCents: 1_000n, source: "yahoo", settled: true },
  ], "2026-09-18");
  writeFundQuotas(db, [{ symbol: "253210", date: "2026-09-17", quotaE12: 1_220_696_672_715n, source: "cvm-swb", settled: true }], "2026-09-18");
  recordSourceAttempt(db, "bcb", { ok: true });
  recordSourceAttempt(db, "yahoo", { ok: true });
  recordSourceAttempt(db, "cvm-swb", { ok: true });
}

test("agrupa RF (inclusive previdencia e ETF RF), exclui reserva e posicao sem valor", () => {
  const db = openDb(":memory:");
  migrate(db);
  seed(db);
  const result = buildRebalance(db, { now: NOW, amountCents: 65_000n, targetsE6: { rfE6: 900_000n, rvE6: 100_000n } });
  assert.equal(result.asOf, "2026-09-18");
  assert.equal(result.baseCents, 120_710n);
  assert.equal(result.stale, false);
  assert.equal(result.portfolioTotalCents, 220_810n); // inclui a reserva (100.100) e o CDB sem reserva
  const [rf, rv] = result.groups;
  assert.equal(rf?.valueCents, 110_710n); // CDB 100.100 + ETF RF 10.000 + PGBL 610
  assert.equal(rv?.valueCents, 10_000n);
  assert.equal(rf?.suggestedCents, 56_429n);
  assert.equal(rv?.suggestedCents, 8_571n);
  assert.equal(rf?.afterValueCents, 167_139n);
  assert.equal(rv?.afterValueCents, 18_571n);
  assert.equal(rf?.pctAfter, 90);
  assert.equal(rv?.pctAfter, 10);
  assert.equal(rf?.aboveTarget, false);
  assert.equal(rv?.aboveTarget, false);
});

test("usa as metas do banco (seed 80/20) e nao persiste aporte", () => {
  const db = openDb(":memory:");
  migrate(db);
  seed(db);
  const result = buildRebalance(db, { now: NOW });
  assert.deepEqual(result.targets, { rfE6: 800_000n, rvE6: 200_000n });
  assert.equal(result.amountCents, 0n);
  assert.equal(result.baseCents, 120_710n);
  assert.equal(result.portfolioTotalCents, 220_810n);
  const [rf, rv] = result.groups;
  assert.equal(rf?.aboveTarget, true); // 91,72% > 80%
  assert.equal(rv?.aboveTarget, false);
  assert.equal(rf?.suggestedCents, 0n);
  assert.equal(rv?.suggestedCents, 0n);
});

test("marca stale quando uma posicao considerada esta desatualizada", () => {
  const db = openDb(":memory:");
  migrate(db);
  seed(db);
  recordSourceAttempt(db, "yahoo", { ok: false, error: "HTTP 502" });
  const result = buildRebalance(db, { now: NOW });
  assert.equal(result.stale, true);
  assert.equal(result.baseCents, 120_710n); // ultimo valor conhecido continua valendo
  assert.equal(result.portfolioTotalCents, 220_810n);
});

test("stale do total considera tambem a reserva", () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [
    { ...cdb, id: "cdb-b", legacyKey: "CDB B", name: "CDB B" },
    { ...reservaCdb, id: "reserva-etf", legacyKey: "Reserva ETF", name: "Reserva ETF", kind: "equity", category: "etf_equity", ticker: "B5P211" },
  ]);
  insertTransactions(db, [
    { instrumentId: "cdb-b", tradeDate: "2026-09-17", kind: "BUY", quantityE8: null, grossCents: 100_000n, feesCents: 0n, note: null, legacyRow: null },
    { instrumentId: "reserva-etf", tradeDate: "2026-09-17", kind: "BUY", quantityE8: 10_00000000n, grossCents: 9_000n, feesCents: 0n, note: null, legacyRow: null },
  ]);
  writeIndexRates(db, [{ series: "CDI", date: "2026-09-17", valueE12: 1_000_000_000n }]);
  writeQuotes(db, [{ ticker: "B5P211", date: "2026-09-17", closeCents: 1_000n, source: "yahoo", settled: true }], "2026-09-18");
  recordSourceAttempt(db, "bcb", { ok: true });
  const result = buildRebalance(db, { now: NOW });
  assert.equal(result.stale, true); // a reserva esta stale e o total a inclui
  assert.equal(result.baseCents, 100_100n); // so o CDB fora da reserva entra na base
  assert.equal(result.portfolioTotalCents, 110_100n);
});
