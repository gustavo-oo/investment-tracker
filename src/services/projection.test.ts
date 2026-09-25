import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { insertInstruments, insertTransactions, writeQuotes } from "../db/repos.ts";
import type { InstrumentRow } from "../db/repos.ts";
import { buildPerformance } from "./performance.ts";
import { buildProjection } from "./projection.ts";

const etf: InstrumentRow = {
  id: "etf-1", legacyKey: "ETF 1", name: "ETF 1", kind: "equity", category: "etf_equity",
  ticker: "WRLD11", quoteSource: null, quoteSymbol: null, currency: "BRL", benchmark: null,
  rateE6: null, maturityDate: null, liquidity: null, broker: "XP", objective: null, investor: "Ana",
};
const now = () => new Date("2026-09-18T12:00:00-03:00");
const cotas = [
  { date: "2026-03-31", closeCents: 1_000n }, { date: "2026-04-30", closeCents: 1_010n },
  { date: "2026-05-31", closeCents: 1_020n }, { date: "2026-06-30", closeCents: 1_030n },
  { date: "2026-07-31", closeCents: 1_040n }, { date: "2026-08-31", closeCents: 1_050n },
  { date: "2026-09-17", closeCents: 1_060n },
];

function seed(db: ReturnType<typeof openDb>, quotes: Array<{ date: string; closeCents: bigint }>): void {
  insertInstruments(db, [etf]);
  insertTransactions(db, [{ instrumentId: etf.id, tradeDate: "2026-03-02", kind: "BUY", quantityE8: 100_00000000n, grossCents: 100_000n, feesCents: 0n, note: null, legacyRow: null }]);
  writeQuotes(db, quotes.map((quote) => ({ ticker: "WRLD11", date: quote.date, closeCents: quote.closeCents, source: "yahoo", settled: true })), "2026-09-18");
}

test("buildProjection usa a janela de 12 meses, o último patrimônio e 24 pontos", () => {
  const db = openDb(":memory:");
  migrate(db);
  seed(db, cotas);

  const result = buildProjection(db, { now });
  assert.deepEqual({ from: result.from, to: result.to }, { from: "2026-04", to: "2026-09" });
  assert.deepEqual(result.history.map((ponto) => [ponto.month, ponto.marketValueCents]), [
    ["2026-04", 101_000n], ["2026-05", 102_000n], ["2026-06", 103_000n],
    ["2026-07", 104_000n], ["2026-08", 105_000n], ["2026-09", 106_000n],
  ]);
  assert.ok(result.premise !== null);
  assert.deepEqual(result.premise, {
    monthsUsed: 6, monthlyRatePct: 0.9759, bandPp: 0.0178, contributionCents: 0n,
    pessimisticMonthlyPct: 0.9581, optimisticMonthlyPct: 0.9937, patrimonyCents: 106_000n,
  });
  assert.equal(result.projection.length, 24);
  assert.deepEqual(result.projection[0], { month: "2026-10", baseCents: 107_034n, pessimisticCents: 107_016n, optimisticCents: 107_053n });
  assert.equal(result.projection.at(-1)?.month, "2028-09");
});

test("buildProjection mantém paridade com o acumulado de buildPerformance", () => {
  const db = openDb(":memory:");
  migrate(db);
  seed(db, cotas);

  const result = buildProjection(db, { now });
  const performance = buildPerformance(db, { from: result.from, to: result.to }, { now });
  assert.ok(result.premise !== null);
  const composto = (1 + result.premise.monthlyRatePct / 100) ** result.premise.monthsUsed - 1;
  assert.ok(Math.abs(composto - performance.accumulated.portfolioPct / 100) < 0.0005);
});

test("buildProjection devolve premissa nula com histórico curto ou banco vazio", () => {
  const curto = openDb(":memory:");
  migrate(curto);
  seed(curto, [{ date: "2026-08-31", closeCents: 1_000n }, { date: "2026-09-17", closeCents: 1_000n }]);
  const semMeses = buildProjection(curto, { now });
  assert.equal(semMeses.premise, null);
  assert.deepEqual(semMeses.history, []);
  assert.deepEqual(semMeses.projection, []);

  const vazio = openDb(":memory:");
  migrate(vazio);
  const semDados = buildProjection(vazio, { now });
  assert.equal(semDados.premise, null);
  assert.deepEqual(semDados.projection, []);
});
