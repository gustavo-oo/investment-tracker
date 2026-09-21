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
    transactionAfterAsOf: false, currentMonth: "2026-09", ...overrides,
  });

test("classifyDivergence segue a ordem das regras", () => {
  assert.equal(classify({ ourCents: 0n, legacyCents: -10n, diffCents: 10n }), "residuo-zerado");
  assert.equal(classify({ ourCents: 0n, legacyCents: 1n, diffCents: -1n }), "residuo-zerado");
  assert.equal(classify({ ourCents: 0n, legacyCents: 500n, diffCents: -500n }), "nao-explicada");
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

test("classifyDivergence: cotação de RV/PGBL no mês corrente tem causa própria", () => {
  const etfAberto = { ...etf, id: "etf-2" };
  assert.equal(
    classify({ instrument: etfAberto, month: "2026-09", currentMonth: "2026-09", legacyCents: 100_000n, ourCents: 101_340n, diffCents: 1_340n }),
    "cotacao-fora-da-janela",
  );
  // fora do mês corrente e acima de 0,5% → não explicada
  assert.equal(
    classify({ instrument: etfAberto, month: "2026-08", currentMonth: "2026-09", legacyCents: 100_000n, ourCents: 101_340n, diffCents: 1_340n }),
    "nao-explicada",
  );
  // acima de 5% no mês corrente → não explicada
  assert.equal(
    classify({ instrument: etfAberto, month: "2026-09", currentMonth: "2026-09", legacyCents: 100_000n, ourCents: 120_000n, diffCents: 20_000n }),
    "nao-explicada",
  );
  // RF no mês corrente não usa a regra de cotação (benchmark fora de CDI/SELIC para não casar as regras do legado)
  assert.equal(
    classify({ instrument: { ...cdi, benchmark: "IPCA" }, month: "2026-09", currentMonth: "2026-09", legacyCents: 100_000n, ourCents: 101_340n, diffCents: 1_340n }),
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

const pgbl: InstrumentRow = {
  ...base, id: "pgbl-1", legacyKey: "PGBL 1", name: "PGBL 1", kind: "pension", category: "pension_ipca",
  ticker: null, benchmark: null, rateE6: null,
};

const buyPension = (instrumentId: string) => ({
  instrumentId, tradeDate: "2026-09-01", kind: "BUY" as const,
  quantityE8: 10_00000000n, grossCents: 100_000n, feesCents: 0n, note: null, legacyRow: null,
});

test("buildReconciliation: posição sem cotação com legado não zero vira não explicada", () => {
  const db = openDb(":memory:");
  migrate(db);
  const pgblNeg = { ...pgbl, id: "pgbl-neg", legacyKey: "PGBL NEG", name: "PGBL NEG" };
  const pgblUm = { ...pgbl, id: "pgbl-um", legacyKey: "PGBL UM", name: "PGBL UM" };
  insertInstruments(db, [pgblNeg, pgblUm]);
  insertTransactions(db, [buyPension(pgblNeg.id), buyPension(pgblUm.id)]);
  insertLegacySnapshots(db, [
    { month: "2026-09-01", instrumentId: pgblNeg.id, valueCents: -3_520n, sharesE8: null },
    { month: "2026-09-01", instrumentId: pgblUm.id, valueCents: 1n, sharesE8: null },
  ]);

  const result = buildReconciliation(db, { month: "2026-09", asOf: "2026-09-30" });
  assert.deepEqual(
    result.divergences.map((divergence) => [divergence.instrumentId, divergence.cause, divergence.ourCents, divergence.diffCents]),
    [
      ["pgbl-neg", "nao-explicada", 0n, 3_520n],
      ["pgbl-um", "nao-explicada", 0n, -1n],
    ],
  );
  assert.equal(result.unexplained, 2);
  assert.equal(result.totals.ourCents, 0n);
});

test("buildReconciliation: posição sem cotação com legado zero não gera divergência", () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [pgbl]);
  insertTransactions(db, [buyPension(pgbl.id)]);
  insertLegacySnapshots(db, [{ month: "2026-09-01", instrumentId: pgbl.id, valueCents: 0n, sharesE8: null }]);

  const result = buildReconciliation(db, { month: "2026-09", asOf: "2026-09-30" });
  assert.deepEqual(result.divergences, []);
  assert.equal(result.unexplained, 0);
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
