import { gunzipSync } from "node:zlib";
import { CENTS, SHARES_SCALE, parseDecimal } from "../domain/money.ts";
import { parseCsv } from "./csv.ts";
import { normalizeLegacyId } from "./catalog.ts";

export type LegacySnapshotItem = { id: string | number; value: number; nShares?: number };
export type LegacySnapshotRaw = { month: string; legacyKey: string; valueCents: bigint; sharesE8: bigint | null };

export function decodeLegacySnapshot(base64: string): LegacySnapshotItem[] {
  const trimmed = base64.trim();
  if (trimmed === "") return [];
  const json = gunzipSync(Buffer.from(trimmed, "base64")).toString("utf8");
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error("snapshot legado não é uma lista");
  return parsed as LegacySnapshotItem[];
}

export type HistoryParseResult = { items: LegacySnapshotRaw[]; errors: string[] };

export function parseLegacyHistory(csvText: string): HistoryParseResult {
  const items: LegacySnapshotRaw[] = [];
  const errors: string[] = [];
  let rows: string[][] = [];
  try {
    rows = parseCsv(csvText).slice(1);
  } catch (error) {
    return { items, errors: [`csv de histórico inválido: ${error instanceof Error ? error.message : String(error)}`] };
  }
  for (const row of rows) {
    const month = (row[0] ?? "").trim();
    const gzipCell = (row[1] ?? "").trim();
    if (month === "" || gzipCell === "") continue;
    const isoMonth = month.slice(0, 10);
    try {
      for (const item of decodeLegacySnapshot(gzipCell)) {
        items.push({
          month: isoMonth,
          legacyKey: normalizeLegacyId(item.id),
          valueCents: parseDecimal(String(item.value), CENTS),
          sharesE8: item.nShares == null ? null : parseDecimal(String(item.nShares), SHARES_SCALE),
        });
      }
    } catch (error) {
      errors.push(`histórico inválido em ${isoMonth}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { items, errors };
}
