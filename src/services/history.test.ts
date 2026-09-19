import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { insertInstruments, insertTransactions, writeIndexRates } from "../db/repos.ts";
import type { InstrumentRow } from "../db/repos.ts";
import { buildHistory } from "./history.ts";

const cdb: InstrumentRow = {
  id: "cdb-1", legacyKey: "CDB 1", name: "CDB 1", kind: "fixed_income", category: "cdb",
  ticker: null, quoteSource: null, quoteSymbol: null, currency: "BRL", benchmark: "CDI",
  rateE6: 1_000_000n, maturityDate: null, liquidity: null, broker: "PagBank",
  objective: "Reserva", investor: "Ana",
};

test("history devolve 12 meses com total, aportes e índices do mês", () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [cdb]);
  insertTransactions(db, [
    { instrumentId: cdb.id, tradeDate: "2026-01-02", kind: "BUY", quantityE8: null, grossCents: 100_000n, feesCents: 5_000n, note: null, legacyRow: null },
    { instrumentId: cdb.id, tradeDate: "2026-02-10", kind: "SELL", quantityE8: null, grossCents: 20_000n, feesCents: 0n, note: null, legacyRow: null },
  ]);
  writeIndexRates(db, [
    { series: "CDI", date: "2026-01-02", valueE12: 1_000_000_000n },
    { series: "IPCA", date: "2026-01-01", valueE12: 4_200_000_000n },
  ]);
  const now = () => new Date("2026-09-18T12:00:00-03:00");
  const points = buildHistory(db, {}, { now });
  assert.equal(points.length, 12);
  assert.equal(points[0]?.month, "2025-10");
  const jan = points.find((point) => point.month === "2026-01");
  assert.equal(jan?.investedCents, 105_000n);
  assert.equal(jan?.marketValueCents, 100_100n);
  assert.equal(jan?.cdiPct, 0.1);
  assert.equal(jan?.ipcaPct, 0.42);
  const feb = points.find((point) => point.month === "2026-02");
  assert.equal(feb?.marketValueCents, 80_100n, "resgate de 20_000 sai do saldo capitalizado");
  assert.equal(feb?.redeemedCents, 20_000n);
  const sep = points.find((point) => point.month === "2026-09");
  assert.equal(sep?.marketValueCents, 80_100n, "mês corrente usa hoje como asOf");
});
