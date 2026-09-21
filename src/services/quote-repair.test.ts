import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { insertInstruments, listAllQuotes, writeQuotes } from "../db/repos.ts";
import type { InstrumentRow, QuoteRow } from "../db/repos.ts";
import type { MonthlyQuoteSource, Quote } from "../sources/types.ts";
import { repairConstantRuns, repairWindow } from "./quote-repair.ts";

const etf: InstrumentRow = {
  id: "b5p211", legacyKey: "B5P211", name: "B5P211", kind: "equity", category: "etf_fixed",
  ticker: "B5P211", quoteSource: "yahoo", quoteSymbol: null, currency: "BRL", benchmark: null,
  rateE6: null, maturityDate: null, liquidity: null, broker: "XP", objective: "Longo prazo", investor: "Ana",
};

const TODAY = "2026-09-21";
const now = () => new Date("2026-09-21T12:00:00-03:00");

const flatQuotes = (count: number, month = "2025-04"): QuoteRow[] =>
  Array.from({ length: count }, (_, index) => ({
    ticker: "B5P211",
    date: `${month}-${String(index + 1).padStart(2, "0")}`,
    closeCents: 7125n,
    source: "yahoo",
    settled: true,
  }));

const fakeMonthly = (result: Quote[] | Error): MonthlyQuoteSource => ({
  id: "alphavantage",
  available: async () => true,
  fetchMonthly: async () => {
    if (result instanceof Error) throw result;
    return result;
  },
});

function freshDb() {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [etf]);
  return db;
}

test("repairConstantRuns substitui o trecho constante pela série mensal e é idempotente", async () => {
  const db = freshDb();
  writeQuotes(db, flatQuotes(8), TODAY);
  const results = await repairConstantRuns(db, {
    source: fakeMonthly([{ ticker: "B5P211", date: "2025-04-30", closeCents: 9_570n }]),
    now,
  });
  assert.deepEqual(results, [{ ticker: "B5P211", from: "2025-04-01", to: "2025-04-08", deleted: 8, inserted: 1 }]);
  assert.deepEqual(
    listAllQuotes(db).map((quote) => [quote.date, quote.closeCents, quote.source]),
    [["2025-04-30", 9_570n, "alphavantage"]],
  );
  assert.deepEqual(await repairConstantRuns(db, { source: fakeMonthly([]), now }), []);
});

test("reparo não apaga quando a AV não tem ponto na janela; erro não derruba nem altera", async () => {
  const db = freshDb();
  writeQuotes(db, flatQuotes(8), TODAY);
  const skipped = await repairConstantRuns(db, {
    source: fakeMonthly([{ ticker: "B5P211", date: "2025-03-31", closeCents: 1n }]),
    now,
  });
  assert.equal(skipped[0]?.skipped, true);
  assert.equal(listAllQuotes(db).length, 8, "nada foi apagado");

  const failed = await repairConstantRuns(db, { source: fakeMonthly(new Error("av fora do ar")), now });
  assert.match(failed[0]?.error ?? "", /av fora do ar/);
  assert.equal(listAllQuotes(db).length, 8, "nada mudou");
});

test("trecho no mês corrente é pulado sem consultar a fonte e nada é apagado", async () => {
  const db = freshDb();
  writeQuotes(db, flatQuotes(8, "2026-09"), TODAY);
  let fetches = 0;
  const source: MonthlyQuoteSource = {
    id: "alphavantage",
    available: async () => true,
    fetchMonthly: async () => {
      fetches += 1;
      return [{ ticker: "B5P211", date: "2026-09-18", closeCents: 9_570n }];
    },
  };
  assert.deepEqual(await repairConstantRuns(db, { source, now }), []);
  assert.equal(fetches, 0, "não consulta a fonte para trecho do mês corrente");
  assert.equal(listAllQuotes(db).length, 8, "as 8 linhas continuam lá");
  assert.deepEqual(listAllQuotes(db).map((quote) => quote.source), Array(8).fill("yahoo"));
});

test("trecho que começa em mês fechado e cruza o mês corrente segue reparando", async () => {
  const db = freshDb();
  writeQuotes(db, [
    ...["25", "26", "27", "28", "29"].map((day) => ({
      ticker: "B5P211", date: `2026-08-${day}`, closeCents: 7125n, source: "yahoo", settled: true,
    })),
    ...["01", "02", "03"].map((day) => ({
      ticker: "B5P211", date: `2026-09-${day}`, closeCents: 7125n, source: "yahoo", settled: true,
    })),
  ], TODAY);
  const results = await repairConstantRuns(db, {
    source: fakeMonthly([{ ticker: "B5P211", date: "2026-08-31", closeCents: 9_570n }]),
    now,
  });
  assert.deepEqual(results, [{ ticker: "B5P211", from: "2026-08-25", to: "2026-09-03", deleted: 8, inserted: 1 }]);
  assert.deepEqual(
    listAllQuotes(db).map((quote) => [quote.date, quote.closeCents, quote.source]),
    [["2026-08-31", 9_570n, "alphavantage"]],
  );
});

test("repairWindow força a janela mesmo sem trecho constante", async () => {
  const db = freshDb();
  writeQuotes(db, [{ ticker: "B5P211", date: "2025-04-01", closeCents: 1n, source: "yahoo", settled: true }], TODAY);
  const result = await repairWindow(db, {
    source: fakeMonthly([{ ticker: "B5P211", date: "2025-04-30", closeCents: 9_570n }]),
    ticker: "B5P211", from: "2025-04-01", to: "2025-04-30", today: TODAY,
  });
  assert.deepEqual(result, { ticker: "B5P211", from: "2025-04-01", to: "2025-04-30", deleted: 1, inserted: 1 });
});

test("fonte indisponível não consulta nem toca o banco", async () => {
  const db = freshDb();
  writeQuotes(db, flatQuotes(8), TODAY);
  const unavailable: MonthlyQuoteSource = {
    id: "alphavantage", available: async () => false,
    fetchMonthly: async () => { throw new Error("não deve chamar"); },
  };
  assert.deepEqual(await repairConstantRuns(db, { source: unavailable, now }), []);
  assert.equal(listAllQuotes(db).length, 8);
});
