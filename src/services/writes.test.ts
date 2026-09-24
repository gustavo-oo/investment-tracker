import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { insertInstruments, writeIndexRates, type InstrumentRow } from "../db/repos.ts";
import {
  addTransaction, createInstrument, editTransaction, patchInstrument, removeInstrument, removeTransaction,
} from "./writes.ts";

const cdb: InstrumentRow = {
  id: "cdb-1", legacyKey: "CDB 1", name: "CDB 1", kind: "fixed_income", category: "cdb",
  ticker: null, quoteSource: null, quoteSymbol: null, currency: "BRL", benchmark: "CDI",
  rateE6: 1_000_000n, maturityDate: null, liquidity: null, broker: "PagBank", objective: "Reserva", investor: "Ana",
};

const etf: InstrumentRow = {
  ...cdb, id: "etf-1", legacyKey: "ETF 1", name: "ETF 1", kind: "equity", category: "etf_equity",
  ticker: "WRLD11", benchmark: null, rateE6: null,
};

function freshDb() {
  const db = openDb(":memory:");
  migrate(db);
  return db;
}

const HOJE = "2026-09-22";

test("createInstrument valida, gera id e legacy_key ui:", () => {
  const db = freshDb();
  const result = createInstrument(db, {
    name: "CDB Novo 2029", kind: "fixed_income", category: "cdb", ticker: null, quoteSymbol: null,
    benchmark: "CDI", rateE6: 1_050_000n, maturityDate: "2029-01-01", liquidity: "Diário",
    broker: "PagBank", objective: "Reserva", investor: "Ana",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.id, "cdb-novo-2029");
  assert.equal(result.value.legacyKey, "ui:cdb-novo-2029");
  assert.equal(result.value.quoteSource, null);
  const duplicado = createInstrument(db, {
    name: "CDB Novo 2029", kind: "fixed_income", category: "cdb", ticker: null, quoteSymbol: null,
    benchmark: "CDI", rateE6: 1_050_000n, maturityDate: null, liquidity: null, broker: null, objective: null, investor: null,
  });
  assert.equal(duplicado.ok, false);
  if (!duplicado.ok) assert.equal(duplicado.failure.status, 409);
});

test("createInstrument rejeita cadastro inconsistente", () => {
  const db = freshDb();
  const base = {
    name: "X", kind: "fixed_income" as const, category: "cdb" as const, ticker: null, quoteSymbol: null,
    benchmark: "CDI" as const, rateE6: 1_000_000n, maturityDate: null, liquidity: null, broker: null, objective: null, investor: null,
  };
  const semTaxa = createInstrument(db, { ...base, rateE6: null });
  assert.equal(semTaxa.ok, false);
  const categoriaErrada = createInstrument(db, { ...base, category: "etf_equity" });
  assert.equal(categoriaErrada.ok, false);
  const rvSemTicker = createInstrument(db, { ...base, kind: "equity", category: "etf_equity", benchmark: null, rateE6: null, ticker: null });
  assert.equal(rvSemTicker.ok, false);
});

test("patchInstrument não muda kind/category com transações", () => {
  const db = freshDb();
  insertInstruments(db, [cdb]);
  addTransaction(db, cdb.id, { tradeDate: "2026-09-17", kind: "BUY", grossCents: 100_000n, feesCents: 0n, quantityE8: null, note: null }, HOJE);
  const bloqueado = patchInstrument(db, cdb.id, { category: "lca" });
  assert.equal(bloqueado.ok, false);
  if (!bloqueado.ok) assert.equal(bloqueado.failure.status, 400);
  const ok = patchInstrument(db, cdb.id, { broker: "XP", investor: "Beto" });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.value.broker, "XP");
  assert.equal(patchInstrument(db, "nao-existe", { broker: "XP" }).ok, false);
});

test("patchInstrument de RF revalida a carteira ao mexer em taxa/índice", () => {
  const db = freshDb();
  insertInstruments(db, [cdb]);
  writeIndexRates(db, [{ series: "CDI", date: "2026-09-17", valueE12: 1_000_000_000n }]);
  const compra = addTransaction(db, cdb.id, { tradeDate: "2026-09-17", kind: "BUY", grossCents: 100_000n, feesCents: 0n, quantityE8: null, note: null }, HOJE);
  assert.equal(compra.ok, true);
  const resgate = addTransaction(db, cdb.id, { tradeDate: "2026-09-18", kind: "SELL", grossCents: 100_100n, feesCents: 0n, quantityE8: null, note: null }, HOJE);
  assert.equal(resgate.ok, true);

  const semTaxa = patchInstrument(db, cdb.id, { rateE6: null });
  assert.equal(semTaxa.ok, false);
  if (!semTaxa.ok) assert.equal(semTaxa.failure.status, 400);

  const comTaxa = patchInstrument(db, cdb.id, { rateE6: 1_000_000n });
  assert.equal(comTaxa.ok, true);

  const mesmoKind = patchInstrument(db, cdb.id, { kind: "fixed_income", category: "cdb", broker: "XP" });
  assert.equal(mesmoKind.ok, true);
  if (mesmoKind.ok) assert.equal(mesmoKind.value.broker, "XP");
  const outroKind = patchInstrument(db, cdb.id, { category: "lca" });
  assert.equal(outroKind.ok, false);
});

test("removeInstrument bloqueia com transações e libera sem", () => {
  const db = freshDb();
  insertInstruments(db, [cdb]);
  addTransaction(db, cdb.id, { tradeDate: "2026-09-17", kind: "BUY", grossCents: 100_000n, feesCents: 0n, quantityE8: null, note: null }, HOJE);
  const bloqueado = removeInstrument(db, cdb.id);
  assert.equal(bloqueado.ok, false);
  if (!bloqueado.ok) assert.equal(bloqueado.failure.status, 409);
  const semUso = createInstrument(db, {
    name: "LCA Vazia", kind: "fixed_income", category: "lca", ticker: null, quoteSymbol: null,
    benchmark: "CDI", rateE6: 1_000_000n, maturityDate: null, liquidity: null, broker: null, objective: null, investor: null,
  });
  assert.equal(semUso.ok, true);
  if (semUso.ok) assert.equal(removeInstrument(db, semUso.value.id).ok, true);
});

test("addTransaction grava SELL negativo, guarda e valida", () => {
  const db = freshDb();
  insertInstruments(db, [etf, cdb]);
  writeIndexRates(db, [{ series: "CDI", date: "2026-09-17", valueE12: 1_000_000_000n }]);

  const compra = addTransaction(db, etf.id, { tradeDate: "2026-09-17", kind: "BUY", grossCents: 9_000n, feesCents: 0n, quantityE8: 10_00000000n, note: null }, HOJE);
  assert.equal(compra.ok, true);
  const venda = addTransaction(db, etf.id, { tradeDate: "2026-09-18", kind: "SELL", grossCents: 9_500n, feesCents: 0n, quantityE8: 10_00000000n, note: null }, HOJE);
  assert.equal(venda.ok, true);
  if (venda.ok) assert.equal(venda.value.quantityE8, -10_00000000n);

  const oversell = addTransaction(db, etf.id, { tradeDate: "2026-09-19", kind: "SELL", grossCents: 1_000n, feesCents: 0n, quantityE8: 1_00000000n, note: null }, HOJE);
  assert.equal(oversell.ok, false);
  if (!oversell.ok) assert.equal(oversell.failure.status, 400);

  const rfComQuantidade = addTransaction(db, cdb.id, { tradeDate: "2026-09-17", kind: "BUY", grossCents: 100_000n, feesCents: 0n, quantityE8: 1_00000000n, note: null }, HOJE);
  assert.equal(rfComQuantidade.ok, false);

  const futura = addTransaction(db, cdb.id, { tradeDate: "2026-09-23", kind: "BUY", grossCents: 100_000n, feesCents: 0n, quantityE8: null, note: null }, HOJE);
  assert.equal(futura.ok, false);

  assert.equal(addTransaction(db, "nao-existe", { tradeDate: "2026-09-17", kind: "BUY", grossCents: 1n, feesCents: 0n, quantityE8: null, note: null }, HOJE).ok, false);
});

test("editTransaction e removeTransaction respeitam a guarda", () => {
  const db = freshDb();
  insertInstruments(db, [cdb]);
  writeIndexRates(db, [{ series: "CDI", date: "2026-09-17", valueE12: 1_000_000_000n }]);
  const compra = addTransaction(db, cdb.id, { tradeDate: "2026-09-17", kind: "BUY", grossCents: 100_000n, feesCents: 0n, quantityE8: null, note: null }, HOJE);
  assert.equal(compra.ok, true);
  if (!compra.ok) return;

  const editada = editTransaction(db, compra.value.id, { grossCents: 120_000n }, HOJE);
  assert.equal(editada.ok, true);
  if (editada.ok) assert.equal(editada.value.grossCents, 120_000n);

  const resgate = addTransaction(db, cdb.id, { tradeDate: "2026-09-18", kind: "SELL", grossCents: 120_120n, feesCents: 0n, quantityE8: null, note: null }, HOJE);
  assert.equal(resgate.ok, true);
  if (!resgate.ok) return;

  const compraMenor = editTransaction(db, compra.value.id, { grossCents: 100_000n }, HOJE);
  assert.equal(compraMenor.ok, false);
  if (!compraMenor.ok) assert.equal(compraMenor.failure.status, 400);

  const semCompra = removeTransaction(db, compra.value.id);
  assert.equal(semCompra.ok, false);
  assert.equal(removeTransaction(db, resgate.value.id).ok, true);
  assert.equal(removeTransaction(db, compra.value.id).ok, true);
});
