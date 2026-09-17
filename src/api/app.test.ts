import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { buildApp } from "../app.ts";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";

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
  assert.deepEqual(res.json(), { ok: true, counts: { instruments: 0, transactions: 0, legacySnapshots: 0, importRuns: 0 } });

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

test("import com ativo inválido responde 422 e não escreve", async () => {  const db = openDb(":memory:");
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
