import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { insertInstruments, insertTransactions, listAllIndexRates, listSourceStatus } from "../db/repos.ts";
import type { InstrumentRow } from "../db/repos.ts";
import type { IndexSeries, IndexSource } from "../sources/types.ts";
import { refreshIndices } from "./refresh-indices.ts";

const cdb: InstrumentRow = {
  id: "cdb-1", legacyKey: "CDB 1", name: "CDB 1", kind: "fixed_income", category: "cdb",
  ticker: null, quoteSource: null, quoteSymbol: null, currency: "BRL", benchmark: "CDI",
  rateE6: 1_000_000n, maturityDate: null, liquidity: null, broker: "PagBank", objective: "Reserva", investor: "Ana",
};

test("refresh de índices persiste valor negativo (IPCA em deflação)", async () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [cdb]);
  insertTransactions(db, [{ instrumentId: cdb.id, tradeDate: "2025-04-23", kind: "BUY", quantityE8: null, grossCents: 1000n, feesCents: 0n, note: null, legacyRow: null }]);
  const bcb: IndexSource = {
    id: "bcb",
    fetchSeries: async (series) => [{ series, date: "2025-08-01", valueE12: -1_100_000_000n }],
  };
  const now = () => new Date("2026-09-18T07:00:00-03:00");
  const summary = await refreshIndices(db, { source: bcb, now });
  assert.equal(summary.inserted, 3);
  const ipca = listAllIndexRates(db).find((rate) => rate.series === "IPCA" && rate.date === "2025-08-01");
  assert.equal(ipca?.valueE12, -1_100_000_000n);
});

test("refresh de índices grava uma vez, ignora reescrita e registra a fonte", async () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [cdb]);
  insertTransactions(db, [{ instrumentId: cdb.id, tradeDate: "2025-04-23", kind: "BUY", quantityE8: null, grossCents: 1000n, feesCents: 0n, note: null, legacyRow: null }]);
  const seen: IndexSeries[] = [];
  const bcb: IndexSource = {
    id: "bcb",
    fetchSeries: async (series) => {
      seen.push(series);
      return [{ series, date: "2025-04-23", valueE12: 500_000_000n }];
    },
  };
  const now = () => new Date("2026-09-18T07:00:00-03:00");
  const first = await refreshIndices(db, { source: bcb, now });
  assert.deepEqual(seen, ["CDI", "SELIC", "IPCA"]);
  assert.equal(first.inserted, 3);
  const second = await refreshIndices(db, { source: bcb, now });
  assert.equal(second.skipped, 3);
  assert.equal(listAllIndexRates(db).length, 3);
  assert.equal(listSourceStatus(db)[0]?.lastError, null);
});
