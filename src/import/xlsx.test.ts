import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { listImportRuns } from "../db/repos.ts";
import { workbookToImportInput } from "./xlsx.ts";
import { runImportFromWorkbook } from "./run.ts";

const workbookWithSheets = async () => {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Lista de Ativos").addRow(["ID", "Nome do Ativo"]);
  workbook.addWorksheet("Investimentos").addRow(["Ativo", "Tipo de Operação"]);
  workbook.addWorksheet("Evolução").addRow(["Mês/Ano", "Investimentos acumulados (GZIP + Base64)"]);
  return Buffer.from(await workbook.xlsx.writeBuffer()).toString("base64");
};

test("workbook com as 3 abas vira ImportInput", async () => {
  const input = await workbookToImportInput(await workbookWithSheets());
  assert.match(input.assetsCsv, /^ID,Nome do Ativo/);
  assert.match(input.transactionsCsv, /^Ativo,Tipo de Operação/);
  assert.match(input.historyCsv, /^Mês\/Ano,/);
});

test("workbook inválido vira erro auditado", async () => {
  const db = openDb(":memory:");
  migrate(db);
  const summary = await runImportFromWorkbook(db, "nao-e-xlsx", { dryRun: false, source: "api" });
  assert.equal(summary.errors.length, 1);
  assert.match(summary.errors[0] ?? "", /falha ao ler o workbook/);
  assert.equal(listImportRuns(db, 10)[0]?.status, "error");
});

test("aba ausente vira erro claro", async () => {
  const db = openDb(":memory:");
  migrate(db);
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Outra");
  const buffer = await workbook.xlsx.writeBuffer();
  const summary = await runImportFromWorkbook(db, Buffer.from(buffer).toString("base64"), { dryRun: true, source: "api" });
  assert.match(summary.errors[0] ?? "", /aba não encontrada/);
});

test("célula com erro (#N/A) em coluna usada vira erro, não importação silenciosa", async () => {
  const db = openDb(":memory:");
  migrate(db);
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Lista de Ativos");
  sheet.addRow(["ID", "Nome do Ativo", "Tipo", "Subtipo", "Código (Ticker/ISIN)", "Corretora", "Vencimento", "Indicador", "Rentabilidade", "Liquidez", "Quem investiu?", "Objetivo"]);
  const row = sheet.addRow([]);
  row.getCell(1).value = { error: "#N/A" } as never;
  workbook.addWorksheet("Investimentos").addRow(["Ativo", "Tipo de Operação", "Data", "Custo total da Operação", "Taxas + Impostos", "Resultado", "Quantidade de Cotas"]);
  workbook.addWorksheet("Evolução").addRow(["Mês/Ano", "Investimentos acumulados (GZIP + Base64)"]);
  const buffer = await workbook.xlsx.writeBuffer();
  const summary = await runImportFromWorkbook(db, Buffer.from(buffer).toString("base64"), { dryRun: true, source: "api" });
  assert.ok(summary.errors.some((error) => /célula com erro/.test(error)));
});

test("erro em coluna não usada não derruba o import", async () => {
  const db = openDb(":memory:");
  migrate(db);
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Lista de Ativos");
  sheet.addRow(["ID", "Nome do Ativo", "Tipo", "Subtipo", "Código (Ticker/ISIN)", "Corretora", "Vencimento", "Indicador", "Rentabilidade", "Liquidez", "Quem investiu?", "Objetivo", "Total investido"]);
  const row = sheet.addRow(["CDB X:  01-01-30", "CDB X", "Renda Fixa", "CDB", "-", "PagBank", "2030-01-01 00:00:00", "CDI", "1.06", "Diário", "Investidor", "Reserva", "0"]);
  row.getCell(20).value = { error: "#N/A" } as never;
  workbook.addWorksheet("Investimentos").addRow(["Ativo", "Tipo de Operação", "Data", "Custo total da Operação", "Taxas + Impostos", "Resultado", "Quantidade de Cotas"]);
  workbook.addWorksheet("Evolução").addRow(["Mês/Ano", "Investimentos acumulados (GZIP + Base64)"]);
  const buffer = await workbook.xlsx.writeBuffer();
  const summary = await runImportFromWorkbook(db, Buffer.from(buffer).toString("base64"), { dryRun: true, source: "api" });
  assert.deepEqual(summary.errors, []);
  assert.equal(summary.instruments, 1);
});
