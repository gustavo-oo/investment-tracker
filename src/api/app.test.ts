import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { buildApp } from "../app.ts";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { insertInstruments, insertTransactions, writeIndexRates, writeQuotes } from "../db/repos.ts";
import type { InstrumentRow } from "../db/repos.ts";
import type { IndexSource, QuoteSource } from "../sources/types.ts";

const gzip = (obj: unknown) => gzipSync(Buffer.from(JSON.stringify(obj))).toString("base64");

function csvDirFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "api-"));
  writeFileSync(join(dir, "Lista de Ativos.csv"),
    "ID,Nome do Ativo,Tipo,Subtipo,Código (Ticker/ISIN),Corretora,Vencimento,Indicador,Rentabilidade,Liquidez,Quem investiu?,Objetivo,Total investido\n" +
    "CDB X:  01-01-30,CDB X,Renda Fixa,CDB,-,PagBank,2030-01-01 00:00:00,CDI,1.06,Diário,Ana,Reserva,0\n");
  writeFileSync(join(dir, "Investimentos.csv"),
    "Ativo,Tipo de Operação,Data,Custo total da Operação,Taxas + Impostos,Resultado,Quantidade de Cotas\n" +
    "CDB X:  01-01-30,Compra,2025-04-23 00:00:00,1000.00,0.0,1000.00,1.0\n");
  writeFileSync(join(dir, "Evolução.csv"),
    "Mês/Ano,Investimentos acumulados (GZIP + Base64)\n" +
    `2026-09-01 00:00:00,"${gzip([{ id: "CDB X:  01-01-30", value: 1100.55 }])}"\n`);
  return dir;
}

test("health, import (dry-run e real), instruments e runs", async () => {
  const db = openDb(":memory:");
  migrate(db);
  const app = buildApp({ db, csvDir: csvDirFixture(), logger: false });

  let res = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true, counts: { instruments: 0, transactions: 0, legacySnapshots: 0, importRuns: 0 }, sources: [] });

  res = await app.inject({ method: "POST", url: "/api/import", payload: { dryRun: true } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().dryRun, true);
  assert.equal(res.json().latestTotalCents, 110055);
  assert.equal((db.prepare("SELECT COUNT(*) AS total FROM instruments").get() as { total: bigint }).total, 0n);

  res = await app.inject({ method: "POST", url: "/api/import", payload: {} });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().instruments, 1);
  assert.equal(res.json().errors.length, 0);

  res = await app.inject({ method: "GET", url: "/api/instruments" });
  const instruments = res.json();
  assert.equal(instruments[0].id, "cdb-x-01-01-30");
  assert.equal(instruments[0].rateE6, 1060000);

  res = await app.inject({ method: "GET", url: `/api/instruments/${encodeURIComponent("cdb-x-01-01-30")}/transactions` });
  assert.equal(res.json()[0].grossCents, 100000);
  assert.equal(res.json()[0].quantityE8, null);

  res = await app.inject({ method: "GET", url: "/api/import/runs" });
  assert.equal(res.json()[0].instruments, 1);

  await app.close();
});

test("dryRun como string não dispara import real", async () => {
  const db = openDb(":memory:");
  migrate(db);
  const app = buildApp({ db, csvDir: csvDirFixture(), logger: false });
  const res = await app.inject({ method: "POST", url: "/api/import", payload: { dryRun: "true" } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().dryRun, true);
  assert.equal((db.prepare("SELECT COUNT(*) AS total FROM instruments").get() as { total: bigint }).total, 0n);
  await app.close();
});

test("import com ativo inválido responde 422 e não escreve", async () => {
  const db = openDb(":memory:");
  migrate(db);
  const app = buildApp({ db, csvDir: csvDirFixture(), logger: false });
  const res = await app.inject({
    method: "POST",
    url: "/api/import",
    payload: {
      assetsCsv: "ID,Nome do Ativo,Tipo,Subtipo\nCripto X,Cripto X,Cripto,Ouro\n",
      transactionsCsv: "Ativo,Tipo de Operação,Data,Custo total da Operação,Taxas + Impostos,Resultado,Quantidade de Cotas\n",
      historyCsv: "Mês/Ano,Investimentos acumulados (GZIP + Base64)\n",
    },
  });
  assert.equal(res.statusCode, 422);
  assert.equal(res.json().errors.length, 1);
  assert.equal((db.prepare("SELECT COUNT(*) AS total FROM instruments").get() as { total: bigint }).total, 0n);
  await app.close();
});

test("POST /api/import com CSV malformado responde 422 e audita", async () => {
  const db = openDb(":memory:");
  migrate(db);
  const app = buildApp({ db, csvDir: csvDirFixture(), logger: false });
  const res = await app.inject({
    method: "POST",
    url: "/api/import",
    payload: { assetsCsv: 'ID,Nome\n"sem-fim,1\n', transactionsCsv: "x\n", historyCsv: "y\n" },
  });
  assert.equal(res.statusCode, 422);
  assert.ok(res.json().errors.length >= 1);
  const runs = (await app.inject({ method: "GET", url: "/api/import/runs" })).json();
  assert.equal(runs[0]?.status, "error");
  await app.close();
});

test("POST /api/import sem body com CSV_DIR ausente responde 422 e audita", async () => {
  const db = openDb(":memory:");
  migrate(db);
  const app = buildApp({ db, csvDir: "/nao-existe-csv", logger: false });
  const res = await app.inject({ method: "POST", url: "/api/import", payload: {} });
  assert.equal(res.statusCode, 422);
  assert.match(res.json().errors[0] ?? "", /falha ao ler CSVs/);
  const runs = (await app.inject({ method: "GET", url: "/api/import/runs" })).json();
  assert.equal(runs[0]?.status, "error");
  await app.close();
});

test("POST /api/import com workbook inválido responde 422 e audita", async () => {
  const db = openDb(":memory:");
  migrate(db);
  const app = buildApp({ db, csvDir: csvDirFixture(), logger: false });
  const res = await app.inject({ method: "POST", url: "/api/import", payload: { workbookBase64: "nao-e-xlsx" } });
  assert.equal(res.statusCode, 422);
  assert.match(res.json().errors[0] ?? "", /falha ao ler o workbook/);
  await app.close();
});

test("POST /api/import com workbookBase64 vazio responde 422 (não cai para o dir)", async () => {
  const db = openDb(":memory:");
  migrate(db);
  const app = buildApp({ db, csvDir: csvDirFixture(), logger: false });
  const res = await app.inject({ method: "POST", url: "/api/import", payload: { workbookBase64: "" } });
  assert.equal(res.statusCode, 422);
  assert.match(res.json().errors[0] ?? "", /falha ao ler o workbook/);
  await app.close();
});

test("POST /api/import com CSVs parciais responde 422 (não cai para o dir)", async () => {
  const db = openDb(":memory:");
  migrate(db);
  const app = buildApp({ db, csvDir: csvDirFixture(), logger: false });
  const res = await app.inject({ method: "POST", url: "/api/import", payload: { assetsCsv: "" } });
  assert.equal(res.statusCode, 422);
  assert.match(res.json().errors[0] ?? "", /os 3 CSVs/);
  const runs = (await app.inject({ method: "GET", url: "/api/import/runs" })).json();
  assert.equal(runs[0]?.status, "error");
  await app.close();
});

test("CSV presente mas vazio não importa nem zera o banco", async () => {
  const db = openDb(":memory:");
  migrate(db);
  const app = buildApp({ db, csvDir: csvDirFixture(), logger: false });
  await app.inject({ method: "POST", url: "/api/import", payload: {} });
  assert.equal((db.prepare("SELECT COUNT(*) AS total FROM instruments").get() as { total: bigint }).total, 1n);

  const res = await app.inject({
    method: "POST",
    url: "/api/import",
    payload: {
      assetsCsv: "ID,Nome do Ativo,Tipo,Subtipo\nCDB X:  01-01-30,CDB X,Renda Fixa,CDB\n",
      transactionsCsv: "",
      historyCsv: "",
    },
  });
  assert.equal(res.statusCode, 422);
  assert.match(res.json().errors[0] ?? "", /os 3 CSVs/);
  assert.equal((db.prepare("SELECT COUNT(*) AS total FROM instruments").get() as { total: bigint }).total, 1n, "nada foi apagado");
  await app.close();
});

test("serve o build do web com fallback SPA", async () => {
  const dir = mkdtempSync(join(tmpdir(), "web-"));
  writeFileSync(join(dir, "index.html"), '<div id="root"></div>');
  const db = openDb(":memory:");
  migrate(db);
  const app = buildApp({ db, csvDir: csvDirFixture(), logger: false, webDir: dir });
  const home = await app.inject({ method: "GET", url: "/" });
  assert.equal(home.statusCode, 200);
  assert.match(home.body, /id="root"/);
  const spa = await app.inject({ method: "GET", url: "/qualquer-rota" });
  assert.equal(spa.statusCode, 200);
  const api404 = await app.inject({ method: "GET", url: "/api/nao-existe" });
  assert.equal(api404.statusCode, 404);
  await app.close();
});

const baseInstrument = {
  currency: "BRL", quoteSource: null, quoteSymbol: null, maturityDate: null,
  liquidity: null, broker: "PagBank", objective: "Reserva", investor: "Ana",
} as const;

const cdbInstrument: InstrumentRow = {
  ...baseInstrument, id: "cdb-1", legacyKey: "CDB 1", name: "CDB 1", kind: "fixed_income",
  category: "cdb", ticker: null, benchmark: "CDI", rateE6: 1_000_000n,
};

const etfInstrument: InstrumentRow = {
  ...baseInstrument, id: "etf-1", legacyKey: "ETF 1", name: "ETF 1", kind: "equity",
  category: "etf_equity", ticker: "WRLD11", benchmark: null, rateE6: null, broker: "XP",
};

function seedPortfolio(db: ReturnType<typeof openDb>) {
  insertInstruments(db, [cdbInstrument, etfInstrument]);
  insertTransactions(db, [
    { instrumentId: cdbInstrument.id, tradeDate: "2026-09-17", kind: "BUY", quantityE8: null, grossCents: 100_000n, feesCents: 0n, note: null, legacyRow: null },
    { instrumentId: etfInstrument.id, tradeDate: "2026-09-17", kind: "BUY", quantityE8: 10_00000000n, grossCents: 9_000n, feesCents: 0n, note: null, legacyRow: null },
  ]);
  writeIndexRates(db, [{ series: "CDI", date: "2026-09-17", valueE12: 1_000_000_000n }]);
  writeQuotes(db, [{ ticker: "WRLD11", date: "2026-09-17", closeCents: 1_000n, source: "yahoo", settled: true }], "2026-09-18");
}

test("rotas de portfolio, history e allocation respondem em centavos", async () => {
  const db = openDb(":memory:");
  migrate(db);
  seedPortfolio(db);
  const app = buildApp({ db, csvDir: csvDirFixture(), logger: false });

  let res = await app.inject({ method: "GET", url: "/api/portfolio" });
  assert.equal(res.statusCode, 200);
  const portfolio = res.json();
  assert.equal(portfolio.totals.marketValueCents, 110_100);
  assert.equal(portfolio.positions.length, 2);
  assert.equal(portfolio.positions[0].priceSource, "bcb");

  res = await app.inject({ method: "GET", url: "/api/history?from=2026-08&to=2026-09" });
  assert.equal(res.json().length, 2);
  assert.equal(res.json()[1].marketValueCents, 110_100);

  res = await app.inject({ method: "GET", url: "/api/history?from=26-08" });
  assert.equal(res.statusCode, 400);

  res = await app.inject({ method: "GET", url: "/api/history?from=2026-00" });
  assert.equal(res.statusCode, 400);

  res = await app.inject({ method: "GET", url: "/api/history?from=2026-13" });
  assert.equal(res.statusCode, 400);

  res = await app.inject({ method: "GET", url: "/api/allocation?by=broker" });
  assert.deepEqual(res.json().groups, [
    { key: "PagBank", marketValueCents: 100_100, pct: 90.92 },
    { key: "XP", marketValueCents: 10_000, pct: 9.08 },
  ]);

  res = await app.inject({ method: "GET", url: "/api/allocation?by=nada" });
  assert.equal(res.statusCode, 400);

  await app.close();
});

test("POST /api/refresh usa as fontes injetadas e atualiza o health", async () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [etfInstrument]);
  insertTransactions(db, [{ instrumentId: etfInstrument.id, tradeDate: "2025-04-23", kind: "BUY", quantityE8: 10_00000000n, grossCents: 9_000n, feesCents: 0n, note: null, legacyRow: null }]);
  const yahoo: QuoteSource = {
    id: "yahoo",
    available: async () => true,
    fetchDaily: async () => [{ ticker: "WRLD11", date: "2026-09-17", closeCents: 1_000n }],
  };
  const bcb: IndexSource = {
    id: "bcb",
    fetchSeries: async (series) => [{ series, date: "2026-09-17", valueE12: 1_000_000_000n }],
  };
  const app = buildApp({
    db, csvDir: csvDirFixture(), logger: false,
    refreshDeps: { quoteSources: [yahoo], indexSource: bcb, now: () => new Date("2026-09-18T12:00:00-03:00") },
  });

  const res = await app.inject({ method: "POST", url: "/api/refresh" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().sources.map((source: { id: string }) => source.id), ["yahoo", "bcb"]);

  const health = (await app.inject({ method: "GET", url: "/api/health" })).json();
  assert.deepEqual(health.sources.map((source: { id: string }) => source.id), ["bcb", "yahoo"]);
  assert.equal(health.sources.every((source: { stale: boolean }) => source.stale === false), true);

  const bad = await app.inject({ method: "POST", url: "/api/refresh?source=xpto" });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.json().error, /fonte desconhecida: xpto/);

  const av = await app.inject({ method: "POST", url: "/api/refresh?source=alphavantage" });
  assert.equal(av.statusCode, 400);
  assert.match(av.json().error, /alphavantage não configurado/);

  await app.close();
});
