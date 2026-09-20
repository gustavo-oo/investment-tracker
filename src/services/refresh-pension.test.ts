import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { insertInstruments, insertTransactions, listAllFundQuotas, listSourceStatus } from "../db/repos.ts";
import type { InstrumentRow } from "../db/repos.ts";
import type { FundQuota, FundQuotaSource } from "../sources/types.ts";
import { refreshPension } from "./refresh-pension.ts";

const pgbl: InstrumentRow = {
  id: "pgbl-1", legacyKey: "PGBL 1", name: "PGBL 1", kind: "pension", category: "pension_ipca",
  ticker: null, quoteSource: "cvm-swb", quoteSymbol: "253210", currency: "BRL", benchmark: null,
  rateE6: null, maturityDate: null, liquidity: null, broker: "BTG", objective: "Aposentadoria", investor: "Ana",
};

const NOW = () => new Date("2026-09-18T14:00:00-03:00");

function freshDb() {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [pgbl]);
  insertTransactions(db, [{ instrumentId: pgbl.id, tradeDate: "2025-10-01", kind: "BUY", quantityE8: 930_14877553n, grossCents: 100_000n, feesCents: 0n, note: null, legacyRow: null }]);
  return db;
}

const fakeSource = (resolver: (symbol: string, from: string, to: string) => FundQuota[] | Promise<FundQuota[]>): FundQuotaSource => ({
  id: "cvm-swb",
  fetchDaily: async (symbols, from, to) => resolver(symbols[0]!, from, to),
});

test("refreshPension grava fechado imutável e avança a fronteira", async () => {
  const db = freshDb();
  const froms: string[] = [];
  const source = fakeSource((symbol, from) => {
    froms.push(from);
    return [
      { symbol, date: "2026-09-16", quotaE12: 1_217_429_617_864n },
      { symbol, date: "2026-09-17", quotaE12: 1_220_696_672_715n },
    ];
  });
  const first = await refreshPension(db, { source, now: NOW });
  assert.deepEqual(first, { id: "cvm-swb", fetched: 2, inserted: 2, updated: 0, skipped: 0, errors: [] });
  assert.deepEqual(froms, ["2025-10-01"]);

  const second = await refreshPension(db, { source: fakeSource((symbol) => [{ symbol, date: "2026-09-17", quotaE12: 9n }]), now: NOW });
  assert.deepEqual(second, { id: "cvm-swb", fetched: 1, inserted: 0, updated: 0, skipped: 1, errors: [] });
  assert.equal(listAllFundQuotas(db)[1]?.quotaE12, 1_220_696_672_715n, "fechado não é sobrescrito");
  assert.ok(listSourceStatus(db).find((row) => row.source === "cvm-swb")?.lastSuccessAt);
});

test("refreshPension full volta à 1ª transação e falha mantém último valor + stale", async () => {
  const db = freshDb();
  const froms: string[] = [];
  const source = fakeSource((symbol, from) => {
    froms.push(from);
    return [{ symbol, date: "2026-09-17", quotaE12: 1_220_696_672_715n }];
  });
  await refreshPension(db, { source, now: NOW });
  await refreshPension(db, { source, now: NOW });
  await refreshPension(db, { source, now: NOW, full: true });
  assert.deepEqual(froms, ["2025-10-01", "2026-09-17", "2025-10-01"]);

  const result = await refreshPension(db, { source: fakeSource(() => { throw new Error("cvm fora do ar"); }), now: NOW });
  assert.match(result.errors[0] ?? "", /cvm fora do ar/);
  assert.equal(listAllFundQuotas(db).at(-1)?.quotaE12, 1_220_696_672_715n, "último valor é mantido");
  const status = listSourceStatus(db).find((row) => row.source === "cvm-swb");
  assert.equal(status?.lastError, "253210: cvm fora do ar");
  assert.ok((status?.lastErrorAt ?? "") > (status?.lastSuccessAt ?? ""));
});

test("sem instrumento de previdência não consulta a fonte", async () => {
  const db = openDb(":memory:");
  migrate(db);
  let calls = 0;
  const source: FundQuotaSource = { id: "cvm-swb", fetchDaily: async () => { calls++; return []; } };
  const result = await refreshPension(db, { source, now: NOW });
  assert.deepEqual(result, { id: "cvm-swb", fetched: 0, inserted: 0, updated: 0, skipped: 0, errors: [] });
  assert.equal(calls, 0);
  assert.deepEqual(listSourceStatus(db), []);
});
