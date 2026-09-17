import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { counts, listImportRuns, listTransactionsByInstrument } from "../db/repos.ts";
import { runImport, runImportFromDir, type ImportInput } from "./run.ts";

const gzip = (obj: unknown) => gzipSync(Buffer.from(JSON.stringify(obj))).toString("base64");

function input(): ImportInput {
  return {
    assetsCsv:
      "ID,Nome do Ativo,Tipo,Subtipo,Código (Ticker/ISIN),Corretora,Vencimento,Indicador,Rentabilidade,Liquidez,Quem investiu?,Objetivo,Total investido\n" +
      "CDB Teste:  01-01-30,CDB Teste,Renda Fixa,CDB,-,PagBank,2030-01-01 00:00:00,CDI,1.06,Diário,Ana,Reserva,0\n",
    transactionsCsv:
      "Ativo,Tipo de Operação,Data,Custo total da Operação,Taxas + Impostos,Resultado,Quantidade de Cotas\n" +
      "CDB Teste:  01-01-30,Compra,2025-04-23 00:00:00,1000.00,0.0,1000.00,1.0\n" +
      "CDB Teste:  01-01-30,Resgate,2026-07-01 00:00:00,1100.00,5.50,1100.00,1.0\n",
    historyCsv:
      "Mês/Ano,Investimentos acumulados (GZIP + Base64)\n" +
      `2026-09-01 00:00:00,"${gzip([{ id: "CDB Teste:  01-01-30", value: 1100.55 }])}"\n`,
  };
}

test("runImport dry-run não escreve e resume os dados", () => {
  const db = openDb(":memory:");
  migrate(db);
  const summary = runImport(db, input(), { dryRun: true, source: "cli" });
  assert.deepEqual(summary, {
    dryRun: true, instruments: 1, transactions: 2, historyRows: 1,
    latestMonth: "2026-09-01", latestTotalCents: 110055, warnings: [], errors: [],
  });
  assert.equal(counts(db).instruments, 0, "dry-run não escreve");
});

test("runImport grava, audita e é idempotente", () => {
  const db = openDb(":memory:");
  migrate(db);
  const first = runImport(db, input(), { dryRun: false, source: "api" });
  assert.equal(first.errors.length, 0);
  const second = runImport(db, input(), { dryRun: false, source: "api" });
  assert.equal(second.errors.length, 0);
  assert.equal(counts(db).instruments, 1);
  assert.equal(counts(db).transactions, 2, "reimportar não duplica");
  assert.equal(listImportRuns(db, 10).length, 2);
  assert.equal(listTransactionsByInstrument(db, "cdb-teste-01-01-30")[1]?.grossCents, 110000n);
});

test("runImport aponta erro de ativo desconhecido sem escrever", () => {
  const db = openDb(":memory:");
  migrate(db);
  const bad = input();
  bad.transactionsCsv += "CDB Fantasma,Compra,2026-01-01 00:00:00,10.00,0.0,10.00,1.0\n";
  const summary = runImport(db, bad, { dryRun: false, source: "cli" });
  assert.equal(summary.errors.length, 1);
  assert.match(summary.errors[0] ?? "", /CDB Fantasma/);
  assert.equal(counts(db).instruments, 0, "erro não escreve nada");
});

test("runImport devolve erro (não crash) para histórico corrompido e audita a falha", () => {
  const db = openDb(":memory:");
  migrate(db);
  const bad = input();
  bad.historyCsv = `Mês/Ano,Investimentos acumulados (GZIP + Base64)\n2026-09-01 00:00:00,"isto-nao-e-gzip"\n`;
  const summary = runImport(db, bad, { dryRun: false, source: "api" });
  assert.equal(summary.errors.length, 1);
  assert.match(summary.errors[0] ?? "", /histórico inválido/);
  assert.equal(counts(db).instruments, 0);
  const runs = listImportRuns(db, 10);
  assert.equal(runs.length, 1, "falha também é auditada");
  assert.equal(runs[0]?.status, "error");
  assert.match(runs[0]?.message ?? "", /histórico inválido/);
});

test("dry-run e import real concordam sobre benchmark inválido (sem SqliteError)", () => {
  const db = openDb(":memory:");
  migrate(db);
  const bad = input();
  bad.assetsCsv = bad.assetsCsv.replace("CDI", "Prefixado");
  const dry = runImport(db, bad, { dryRun: true, source: "cli" });
  assert.equal(dry.errors.length, 3, "1 benchmark inválido + 2 transações órfãs do ativo rejeitado");
  assert.ok(dry.errors.some((error) => /benchmark desconhecido/.test(error)));
  const real = runImport(db, bad, { dryRun: false, source: "cli" });
  assert.equal(real.errors.length, 3);
  assert.equal(counts(db).instruments, 0);
});

test("runImport rejeita ids que colidem após normalização", () => {
  const db = openDb(":memory:");
  migrate(db);
  const bad = input();
  bad.assetsCsv = bad.assetsCsv.replace(
    "CDB Teste:  01-01-30,CDB Teste,Renda Fixa,CDB,-,PagBank,2030-01-01 00:00:00,CDI,1.06,Diário,Ana,Reserva,0",
    "A B,Ativo A B,Renda Fixa,CDB,-,PagBank,2030-01-01 00:00:00,CDI,1.06,Diário,Ana,Reserva,0\n" +
    "A-B,Ativo A-B,Renda Fixa,CDB,-,PagBank,2030-01-01 00:00:00,CDI,1.06,Diário,Ana,Reserva,0",
  );
  bad.transactionsCsv = "Ativo,Tipo de Operação,Data,Custo total da Operação,Taxas + Impostos,Resultado,Quantidade de Cotas\n";
  bad.historyCsv = "Mês/Ano,Investimentos acumulados (GZIP + Base64)\n";
  const summary = runImport(db, bad, { dryRun: false, source: "cli" });
  assert.ok(summary.errors.some((error) => /colidem/.test(error)));
  assert.equal(counts(db).instruments, 0, "colisão não escreve");
});

test("runImport não lança para CSV com aspas abertas: erros + auditoria", () => {
  for (const field of ["assetsCsv", "transactionsCsv", "historyCsv"] as const) {
    const db = openDb(":memory:");
    migrate(db);
    const bad = input();
    bad[field] = 'ID,Nome\n"sem-fim,1\n';
    const summary = runImport(db, bad, { dryRun: false, source: "api" });
    assert.ok(summary.errors.length >= 1, `${field} devolve erro`);
    assert.equal(counts(db).instruments, 0, `${field}: nada é escrito`);
    assert.equal(listImportRuns(db, 10)[0]?.status, "error", `${field}: falha auditada`);
  }
});

test("runImportFromDir audita diretório de CSVs ausente", () => {
  const db = openDb(":memory:");
  migrate(db);
  const summary = runImportFromDir(db, "/nao-existe-csv", { dryRun: false, source: "cli" });
  assert.equal(summary.errors.length, 1);
  assert.match(summary.errors[0] ?? "", /falha ao ler CSVs/);
  assert.equal(listImportRuns(db, 10)[0]?.status, "error");
});
