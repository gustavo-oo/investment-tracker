import ExcelJS from "exceljs";
import { toCsv } from "./csv.ts";

const SHEETS = {
  assets: "Lista de Ativos",
  transactions: "Investimentos",
  history: "Evolução",
} as const;

type CellValue =
  | string | number | boolean | Date | null | undefined
  | { richText?: { text: string }[]; result?: unknown; text?: string };

function cellToString(value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("");
    if ("result" in value) return cellToString(value.result as CellValue);
    if (typeof value.text === "string") return value.text;
    return "";
  }
  return String(value);
}

function sheetToCsv(workbook: ExcelJS.Workbook, name: string): string {
  const sheet = workbook.getWorksheet(name);
  if (!sheet) throw new Error(`aba não encontrada: ${JSON.stringify(name)}`);
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    rows.push(values.map((value) => cellToString(value as CellValue)));
  });
  return toCsv(rows);
}

export async function workbookToImportInput(base64: string): Promise<{ assetsCsv: string; transactionsCsv: string; historyCsv: string }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(base64, "base64") as unknown as ExcelJS.Buffer);
  return {
    assetsCsv: sheetToCsv(workbook, SHEETS.assets),
    transactionsCsv: sheetToCsv(workbook, SHEETS.transactions),
    historyCsv: sheetToCsv(workbook, SHEETS.history),
  };
}
