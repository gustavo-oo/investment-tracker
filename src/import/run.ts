import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "../db/index.ts";
import {
  clearImportedData, insertImportRun, insertInstruments, insertLegacySnapshots, insertTransactions,
  type InstrumentRow, type LegacySnapshotRow, type TransactionRow,
} from "../db/repos.ts";
import { parseCsv } from "./csv.ts";
import { normalizeLegacyId } from "./catalog.ts";
import { mapInstrumentRow, mapTransactionRow } from "./map.ts";
import { parseLegacyHistory } from "./snapshots.ts";

export type ImportInput = { assetsCsv: string; transactionsCsv: string; historyCsv: string };

export type ImportSummary = {
  dryRun: boolean;
  instruments: number;
  transactions: number;
  historyRows: number;
  latestMonth: string | null;
  latestTotalCents: number;
  warnings: string[];
  errors: string[];
};

export function buildImportInputFromDir(csvDir: string): ImportInput {
  return {
    assetsCsv: readFileSync(join(csvDir, "Lista de Ativos.csv"), "utf8"),
    transactionsCsv: readFileSync(join(csvDir, "Investimentos.csv"), "utf8"),
    historyCsv: readFileSync(join(csvDir, "Evolução.csv"), "utf8"),
  };
}

export function runImport(db: Db, input: ImportInput, opts: { dryRun: boolean; source: "ui" | "cli" | "api" }): ImportSummary {
  const errors: string[] = [];
  const warnings: string[] = [];
  const instruments: InstrumentRow[] = [];
  const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

  let assetRows: string[][] = [];
  try {
    assetRows = parseCsv(input.assetsCsv).slice(1);
  } catch (error) {
    errors.push(`csv de ativos inválido: ${message(error)}`);
  }

  for (const row of assetRows) {
    if ((row[0] ?? "").trim() === "") continue;
    try {
      instruments.push(mapInstrumentRow(row));
    } catch (error) {
      errors.push(`ativo inválido: ${message(error)}`);
    }
  }

  const byLegacyKey = new Map<string, InstrumentRow>();
  for (const instrument of instruments) {
    if (byLegacyKey.has(instrument.legacyKey)) {
      errors.push(`ativo duplicado: ${instrument.legacyKey}`);
      continue;
    }
    byLegacyKey.set(instrument.legacyKey, instrument);
  }

  const bySlug = new Map<string, InstrumentRow>();
  for (const instrument of instruments) {
    const existing = bySlug.get(instrument.id);
    if (existing !== undefined) {
      errors.push(`ids colidem após normalização: ${existing.legacyKey} e ${instrument.legacyKey}`);
      continue;
    }
    bySlug.set(instrument.id, instrument);
  }

  const transactions: TransactionRow[] = [];
  let transactionRows: string[][] = [];
  try {
    transactionRows = parseCsv(input.transactionsCsv).slice(1);
  } catch (error) {
    errors.push(`csv de transações inválido: ${message(error)}`);
  }

  transactionRows.forEach((row, index) => {
    if ((row[0] ?? "").trim() === "") return;
    const instrument = byLegacyKey.get(normalizeLegacyId(row[0] ?? ""));
    if (!instrument) {
      errors.push(`transação referencia ativo desconhecido: ${row[0]}`);
      return;
    }
    try {
      transactions.push(mapTransactionRow(row, instrument.kind, index + 2));
    } catch (error) {
      errors.push(`transação inválida: ${message(error)}`);
    }
  });

  const history: LegacySnapshotRow[] = [];
  const historyResult = parseLegacyHistory(input.historyCsv);
  errors.push(...historyResult.errors);
  for (const item of historyResult.items) {
    const instrument = byLegacyKey.get(item.legacyKey);
    if (!instrument) {
      warnings.push(`histórico sem cadastro (ignorado): ${item.legacyKey}`);
      continue;
    }
    history.push({ month: item.month, instrumentId: instrument.id, valueCents: item.valueCents, sharesE8: item.sharesE8 });
  }

  const latestMonth = history.reduce<string | null>((max, row) => (max === null || row.month > max ? row.month : max), null);
  const latestTotalCents = history
    .filter((row) => row.month === latestMonth)
    .reduce((acc, row) => acc + row.valueCents, 0n);

  const summary: ImportSummary = {
    dryRun: opts.dryRun,
    instruments: instruments.length,
    transactions: transactions.length,
    historyRows: history.length,
    latestMonth,
    latestTotalCents: Number(latestTotalCents),
    warnings,
    errors,
  };

  if (!opts.dryRun) {
    if (errors.length === 0) {
      db.transaction(() => {
        clearImportedData(db);
        insertInstruments(db, instruments);
        insertTransactions(db, transactions);
        insertLegacySnapshots(db, history);
        insertImportRun(db, {
          source: opts.source,
          instruments: instruments.length,
          transactions: transactions.length,
          historyRows: history.length,
          status: "ok",
          message: null,
        });
      })();
    } else {
      insertImportRun(db, {
        source: opts.source,
        instruments: instruments.length,
        transactions: transactions.length,
        historyRows: history.length,
        status: "error",
        message: errors.slice(0, 5).join("; "),
      });
    }
  }

  return summary;
}
