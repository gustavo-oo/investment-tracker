import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { listImportRuns } from "../db/repos.ts";
import { workbookToImportInput } from "./xlsx.ts";
import { runImportFromWorkbook } from "./run.ts";

const workbookBase64 = () => readFileSync("data/Investimentos.xlsx").toString("base64");

test("workbook do Sheets vira ImportInput com as 3 abas", async () => {
  const input = await workbookToImportInput(workbookBase64());
  assert.match(input.assetsCsv, /^ID,Nome do Ativo/);
  assert.match(input.transactionsCsv, /^Ativo,Tipo de Operação/);
  assert.match(input.historyCsv, /^Mês\/Ano,/);
});

test("import via workbook reproduz os números do legado (dry-run)", async () => {
  const db = openDb(":memory:");
  migrate(db);
  const summary = await runImportFromWorkbook(db, workbookBase64(), { dryRun: true, source: "api" });
  assert.deepEqual(summary.errors, []);
  assert.deepEqual(summary.warnings, []);
  assert.equal(summary.instruments, 48);
  assert.equal(summary.transactions, 119);
  assert.equal(summary.historyRows, 847);
  assert.equal(summary.latestMonth, "2026-09-01");
  assert.equal(summary.latestTotalCents, <valor>);
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

test("célula com erro (#N/A) vira erro, não importação silenciosa", async () => {
  const db = openDb(":memory:");
  migrate(db);
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Lista de Ativos");
  sheet.addRow(["ID", "Nome do Ativo"]);
  const row = sheet.addRow([]);
  row.getCell(1).value = { error: "#N/A" } as never;
  const buffer = await workbook.xlsx.writeBuffer();
  const summary = await runImportFromWorkbook(db, Buffer.from(buffer).toString("base64"), { dryRun: true, source: "api" });
  assert.ok(summary.errors.some((error) => /célula com erro/.test(error)));
});
