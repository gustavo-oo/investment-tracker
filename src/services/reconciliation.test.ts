import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { insertInstruments, insertLegacySnapshots, insertTransactions, writeIndexRates, writeQuotes } from "../db/repos.ts";
import type { InstrumentRow } from "../db/repos.ts";
import { buildReconciliation, classifyDivergence } from "./reconciliation.ts";

const base = {
  currency: "BRL", quoteSource: null, quoteSymbol: null, maturityDate: null,
  liquidity: null, broker: "PagBank", objective: "Reserva", investor: "Ana",
} as const;

const cdi: InstrumentRow = {
  ...base, id: "cdb-1", legacyKey: "CDB 1", name: "CDB 1", kind: "fixed_income", category: "cdb",
  ticker: null, benchmark: "CDI", rateE6: 1_000_000n,
};
const etf: InstrumentRow = {
  ...base, id: "etf-1", legacyKey: "ETF 1", name: "ETF 1", kind: "equity", category: "etf_equity",
  ticker: "WRLD11", benchmark: null, rateE6: null,
};

const classify = (overrides: Partial<Parameters<typeof classifyDivergence>[0]>) =>
  classifyDivergence({
    instrument: cdi, month: "2026-09", legacyCents: 100n, ourCents: 200n, diffCents: 100n,
    transactionAfterAsOf: false, ...overrides,
  });

test("classifyDivergence segue a ordem das regras", () => {
  assert.equal(classify({ ourCents: 0n, legacyCents: -10n, diffCents: 10n }), "residuo-zerado");
  assert.equal(classify({ transactionAfterAsOf: true }), "transacao-fora-da-janela");
  assert.equal(classify({ instrument: { ...cdi, id: "cdb-di-01-12-28" } }), "legado-snapshot-maio-2025");
  assert.equal(classify({ month: "2026-05" }), "legado-sem-cdi-maio-2026");
  assert.equal(classify({ instrument: { ...cdi, benchmark: "SELIC" }, month: "2026-06" }), "legado-sem-selic-junho-2026");
  assert.equal(classify({ instrument: { ...etf, ticker: "B5P211" }, month: "2025-09" }), "fonte-yahoo-corrompida");
  assert.equal(
    classify({ month: "2024-12", legacyCents: 100_000n, ourCents: 100_100n, diffCents: 100n }),
    "data-de-referencia",
  );
  assert.equal(
    classify({ month: "2024-12", legacyCents: 100_000n, ourCents: 200_000n, diffCents: 100_000n }),
    "nao-explicada",
  );
});

test("buildReconciliation soma referência com negativos zerados, classifica e conta não explicadas", () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [cdi, etf]);
  insertTransactions(db, [
    { instrumentId: cdi.id, tradeDate: "2026-09-01", kind: "BUY", quantityE8: null, grossCents: 100_000n, feesCents: 0n, note: null, legacyRow: null },
    { instrumentId: etf.id, tradeDate: "2026-09-01", kind: "BUY", quantityE8: 10_00000000n, grossCents: 9_000n, feesCents: 0n, note: null, legacyRow: null },
  ]);
  writeIndexRates(db, [{ series: "CDI", date: "2026-09-01", valueE12: 1_000_000_000n }]);
  writeQuotes(db, [{ ticker: "WRLD11", date: "2026-09-30", closeCents: 1_000n, source: "yahoo", settled: true }], "2026-10-01");
  insertLegacySnapshots(db, [
    { month: "2026-09-01", instrumentId: cdi.id, valueCents: -3_520n, sharesE8: null },
    { month: "2026-09-01", instrumentId: etf.id, valueCents: 10_000n, sharesE8: null },
  ]);

  const result = buildReconciliation(db, { month: "2026-09", asOf: "2026-09-30" });
  assert.deepEqual(result.totals, {
    legacyCents: 6_480n, referenceCents: 10_000n, ourCents: 110_100n, diffCents: 103_620n,
  });
  assert.deepEqual(result.divergences.map((divergence) => [divergence.instrumentId, divergence.cause]), [
    ["cdb-1", "legado-sem-cdi-maio-2026"],
  ]);
  assert.equal(result.unexplained, 0);
  assert.equal(result.asOf, "2026-09-30");
});

test("buildReconciliation resolve asOf default e devolve vazio sem dados", () => {
  const db = openDb(":memory:");
  migrate(db);
  const now = () => new Date("2026-09-21T12:00:00-03:00");
  assert.equal(buildReconciliation(db, { month: "2026-09" }, { now }).asOf, "2026-09-21");
  assert.equal(buildReconciliation(db, { month: "2026-08" }, { now }).asOf, "2026-08-31");
  assert.deepEqual(buildReconciliation(db, { month: "2026-08" }, { now }).totals, {
    legacyCents: 0n, referenceCents: 0n, ourCents: 0n, diffCents: 0n,
  });
});
