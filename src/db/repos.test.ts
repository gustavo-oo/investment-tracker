import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "./index.ts";
import { migrate } from "./migrate.ts";
import {
  clearImportedData, counts, getInstrument, getInstrumentByLegacyKey, insertImportRun,
  insertInstruments, insertLegacySnapshots, insertTransactions, latestLegacyMonth,
  listImportRuns, listLegacySnapshotByMonth, listTransactionsByInstrument,
} from "./repos.ts";
import type { InstrumentRow } from "./repos.ts";

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
