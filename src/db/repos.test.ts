import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "./index.ts";
import { migrate } from "./migrate.ts";
import {
  clearImportedData, countTransactions, counts, deleteInstrument, deleteTransaction, earliestTradeDate,
  fundQuotaFrontier, getInstrument, getInstrumentByLegacyKey, getTransaction,
  hasQuoteFromSourceOnDate, indexFrontier, insertImportRun, insertInstrument, insertInstruments, insertLegacySnapshots,
  insertTransaction, insertTransactions, latestLegacyMonth, listAllFundQuotas, listAllIndexRates, listAllQuotes, listAllTransactions,
  listImportRuns, listLegacySnapshotByMonth, listSourceStatus, listTransactionsByInstrument,
  quoteFrontier, recordSourceAttempt, updateInstrument, updateInstrumentInvestor, updateTransaction,
  writeFundQuotas, writeIndexRates, writeQuotes,
} from "./repos.ts";
import type { FundQuotaRow, IndexRateRow, InstrumentRow, QuoteRow } from "./repos.ts";

function freshDb() {
  const db = openDb(":memory:");
  migrate(db);
  return db;
}

const cdb: InstrumentRow = {
  id: "cdb-teste-01-01-30", legacyKey: "CDB Teste:  01-01-30", name: "CDB Teste",
  kind: "fixed_income", category: "cdb", ticker: null, quoteSource: null, quoteSymbol: null,
  currency: "BRL", benchmark: "CDI", rateE6: 1060000n, maturityDate: "2030-01-01",
  liquidity: "Diário", broker: "PagBank", objective: "Reserva", investor: "Ana",
};

test("instrumentos e transações fazem roundtrip com inteiros escalonados", () => {
  const db = freshDb();
  insertInstruments(db, [cdb]);
  insertTransactions(db, [
    { instrumentId: cdb.id, tradeDate: "2025-04-23", kind: "BUY", quantityE8: null, grossCents: 227539n, feesCents: 0n, note: null, legacyRow: 2 },
    { instrumentId: cdb.id, tradeDate: "2026-07-01", kind: "SELL", quantityE8: null, grossCents: 273342n, feesCents: 9546n, note: null, legacyRow: 3 },
  ]);
  assert.equal(getInstrument(db, cdb.id)?.rateE6, 1060000n);
  assert.equal(getInstrumentByLegacyKey(db, cdb.legacyKey)?.id, cdb.id);
  const txs = listTransactionsByInstrument(db, cdb.id);
  assert.equal(txs.length, 2);
  assert.equal(txs[1]?.grossCents, 273342n);
  assert.equal(txs[1]?.quantityE8, null, "RF não tem cota");
});

test("histórico legado, runs e limpeza", () => {
  const db = freshDb();
  insertInstruments(db, [cdb]);
  insertLegacySnapshots(db, [
    { month: "2026-08-01", instrumentId: cdb.id, valueCents: 100000n, sharesE8: null },
    { month: "2026-09-01", instrumentId: cdb.id, valueCents: -3520n, sharesE8: null },
  ]);
  assert.equal(latestLegacyMonth(db), "2026-09-01");
  assert.equal(listLegacySnapshotByMonth(db, "2026-09-01")[0]?.valueCents, -3520n);
  insertImportRun(db, { source: "cli", instruments: 1, transactions: 0, historyRows: 2, status: "ok", message: null });
  assert.equal(listImportRuns(db, 10)[0]?.historyRows, 2);
  assert.deepEqual(counts(db), { instruments: 1, transactions: 0, legacySnapshots: 2, importRuns: 1 });
  clearImportedData(db);
  assert.deepEqual(counts(db), { instruments: 0, transactions: 0, legacySnapshots: 0, importRuns: 1 });
});

test("writeQuotes: fechado imutável, hoje sobrescreve, pendente finaliza", () => {
  const db = freshDb();
  const past: QuoteRow = { ticker: "WRLD11", date: "2026-09-17", closeCents: 1000n, source: "yahoo", settled: true };
  const today: QuoteRow = { ticker: "WRLD11", date: "2026-09-18", closeCents: 1050n, source: "yahoo", settled: false };
  assert.deepEqual(writeQuotes(db, [past, today], "2026-09-18"), { inserted: 2, updated: 0, skipped: 0 });
  assert.deepEqual(
    writeQuotes(db, [{ ...past, closeCents: 9999n }, { ...today, closeCents: 1060n }], "2026-09-18"),
    { inserted: 0, updated: 1, skipped: 1 },
  );
  const rows = listAllQuotes(db);
  assert.equal(rows.find((row) => row.date === "2026-09-17")?.closeCents, 1000n);
  assert.equal(rows.find((row) => row.date === "2026-09-18")?.closeCents, 1060n);
});

test("writeQuotes: fetch do dia seguinte finaliza o parcial (0→1)", () => {
  const db = freshDb();
  writeQuotes(db, [{ ticker: "WRLD11", date: "2026-09-18", closeCents: 1050n, source: "yahoo", settled: false }], "2026-09-18");
  assert.deepEqual(
    writeQuotes(db, [{ ticker: "WRLD11", date: "2026-09-18", closeCents: 1075n, source: "yahoo", settled: true }], "2026-09-19"),
    { inserted: 0, updated: 1, skipped: 0 },
  );
  assert.deepEqual(listAllQuotes(db)[0], { ticker: "WRLD11", date: "2026-09-18", closeCents: 1075n, source: "yahoo", settled: true });
});

test("writeIndexRates ignora reescrita e calcula fronteiras", () => {
  const db = freshDb();
  insertInstruments(db, [cdb]);
  insertTransactions(db, [{ instrumentId: cdb.id, tradeDate: "2025-04-23", kind: "BUY", quantityE8: null, grossCents: 1000n, feesCents: 0n, note: null, legacyRow: null }]);
  const rates: IndexRateRow[] = [
    { series: "CDI", date: "2025-04-23", valueE12: 500_000_000n },
    { series: "CDI", date: "2025-04-24", valueE12: 500_000_000n },
  ];
  assert.deepEqual(writeIndexRates(db, rates), { inserted: 2, skipped: 0 });
  assert.deepEqual(writeIndexRates(db, [{ ...rates[0]!, valueE12: 999n }]), { inserted: 0, skipped: 1 });
  assert.equal(listAllIndexRates(db)[0]?.valueE12, 500_000_000n);
  assert.equal(indexFrontier(db, "CDI"), "2025-04-24");
  assert.equal(indexFrontier(db, "SELIC"), null);
  assert.equal(earliestTradeDate(db), "2025-04-23");
  writeQuotes(db, [{ ticker: "WRLD11", date: "2026-09-17", closeCents: 1n, source: "yahoo", settled: true }], "2026-09-18");
  assert.equal(quoteFrontier(db, "WRLD11"), "2026-09-17");
  assert.equal(hasQuoteFromSourceOnDate(db, "WRLD11", "alphavantage", "2026-09-17"), false);
  assert.equal(hasQuoteFromSourceOnDate(db, "WRLD11", "yahoo", "2026-09-17"), true);
});

test("recordSourceAttempt e listSourceStatus guardam sucesso/erro", () => {
  const db = freshDb();
  recordSourceAttempt(db, "yahoo", { ok: true });
  assert.equal(listSourceStatus(db)[0]?.lastSuccessAt !== null, true);
  recordSourceAttempt(db, "yahoo", { ok: false, error: "HTTP 502" });
  const status = listSourceStatus(db)[0];
  assert.equal(status?.lastError, "HTTP 502");
  assert.equal(status?.lastErrorAt !== null && status.lastErrorAt > (status.lastSuccessAt ?? ""), true);
});

test("listAllTransactions devolve todos em ordem de ativo e data", () => {
  const db = freshDb();
  insertInstruments(db, [cdb]);
  insertTransactions(db, [
    { instrumentId: cdb.id, tradeDate: "2026-07-01", kind: "SELL", quantityE8: null, grossCents: 2n, feesCents: 0n, note: null, legacyRow: null },
    { instrumentId: cdb.id, tradeDate: "2025-04-23", kind: "BUY", quantityE8: null, grossCents: 1n, feesCents: 0n, note: null, legacyRow: null },
  ]);
  assert.deepEqual(listAllTransactions(db).map((t) => t.tradeDate), ["2025-04-23", "2026-07-01"]);
});

test("writeFundQuotas: fechado imutável, hoje sobrescreve e pendente finaliza", () => {
  const db = freshDb();
  const past: FundQuotaRow = { symbol: "253210", date: "2026-09-16", quotaE12: 1_217_429_617_864n, source: "cvm-swb", settled: true };
  const today: FundQuotaRow = { symbol: "253210", date: "2026-09-18", quotaE12: 1_220_696_672_715n, source: "cvm-swb", settled: false };
  assert.deepEqual(writeFundQuotas(db, [past, today], "2026-09-18"), { inserted: 2, updated: 0, skipped: 0 });
  assert.deepEqual(
    writeFundQuotas(db, [{ ...past, quotaE12: 1n }, { ...today, quotaE12: 1_221_000_000_000n }], "2026-09-18"),
    { inserted: 0, updated: 1, skipped: 1 },
  );
  assert.deepEqual(listAllFundQuotas(db), [
    { symbol: "253210", date: "2026-09-16", quotaE12: 1_217_429_617_864n, source: "cvm-swb", settled: true },
    { symbol: "253210", date: "2026-09-18", quotaE12: 1_221_000_000_000n, source: "cvm-swb", settled: false },
  ]);
  assert.equal(fundQuotaFrontier(db, "253210"), "2026-09-18");
  assert.equal(fundQuotaFrontier(db, "000000"), null);
});

test("writeFundQuotas: fetch do dia seguinte finaliza o parcial (0→1)", () => {
  const db = freshDb();
  writeFundQuotas(db, [{ symbol: "253210", date: "2026-09-18", quotaE12: 1n, source: "cvm-swb", settled: false }], "2026-09-18");
  assert.deepEqual(
    writeFundQuotas(db, [{ symbol: "253210", date: "2026-09-18", quotaE12: 2n, source: "cvm-swb", settled: true }], "2026-09-19"),
    { inserted: 0, updated: 1, skipped: 0 },
  );
  assert.deepEqual(listAllFundQuotas(db)[0], { symbol: "253210", date: "2026-09-18", quotaE12: 2n, source: "cvm-swb", settled: true });
});

test("updateInstrumentInvestor altera só o investidor e devolve o instrumento", () => {
  const db = freshDb();
  insertInstruments(db, [cdb]);
  const atualizado = updateInstrumentInvestor(db, cdb.id, "Beto");
  assert.equal(atualizado?.investor, "Beto");
  assert.equal(atualizado?.rateE6, 1060000n, "demais campos intactos");
  assert.equal(atualizado?.broker, "PagBank");
  assert.equal(updateInstrumentInvestor(db, "nao-existe", "Beto"), undefined);
});

test("CRUD de instrumento: insere, atualiza e exclui", () => {
  const db = freshDb();
  insertInstrument(db, { ...cdb, id: "ui-1", legacyKey: "ui:ui-1", name: "CDB da UI" });
  assert.equal(getInstrument(db, "ui-1")?.name, "CDB da UI");
  updateInstrument(db, { ...cdb, id: "ui-1", legacyKey: "ui:ui-1", name: "CDB renomeado", investor: "Beto" });
  const atualizado = getInstrument(db, "ui-1");
  assert.equal(atualizado?.name, "CDB renomeado");
  assert.equal(atualizado?.investor, "Beto");
  deleteInstrument(db, "ui-1");
  assert.equal(getInstrument(db, "ui-1"), undefined);
});

test("CRUD de transação: insere com id, atualiza, conta e exclui", () => {
  const db = freshDb();
  insertInstruments(db, [cdb]);
  const id = insertTransaction(db, {
    instrumentId: cdb.id, tradeDate: "2026-09-17", kind: "BUY", quantityE8: null,
    grossCents: 100_000n, feesCents: 0n, note: "aporte", legacyRow: null,
  });
  assert.ok(id > 0);
  assert.equal(getTransaction(db, id)?.note, "aporte");
  assert.equal(countTransactions(db, cdb.id), 1);
  assert.equal(listTransactionsByInstrument(db, cdb.id)[0]?.id, id);
  updateTransaction(db, id, {
    instrumentId: cdb.id, tradeDate: "2026-09-18", kind: "BUY", quantityE8: null,
    grossCents: 120_000n, feesCents: 0n, note: null, legacyRow: null,
  });
  assert.equal(getTransaction(db, id)?.grossCents, 120_000n);
  assert.equal(getTransaction(db, id)?.note, null);
  deleteTransaction(db, id);
  assert.equal(getTransaction(db, id), undefined);
  assert.equal(countTransactions(db, cdb.id), 0);
});
