import type { Db } from "./index.ts";
import type { InstrumentCategory, InstrumentKind, TransactionKind } from "../domain/model.ts";

export type InstrumentRow = {
  id: string; legacyKey: string; name: string; kind: InstrumentKind; category: InstrumentCategory;
  ticker: string | null; quoteSource: string | null; quoteSymbol: string | null; currency: string;
  benchmark: string | null; rateE6: bigint | null; maturityDate: string | null;
  liquidity: string | null; broker: string | null; objective: string | null; investor: string | null;
};

export type TransactionRow = {
  instrumentId: string; tradeDate: string; kind: TransactionKind;
  quantityE8: bigint | null; grossCents: bigint; feesCents: bigint;
  note: string | null; legacyRow: number | null;
};

export type LegacySnapshotRow = { month: string; instrumentId: string; valueCents: bigint; sharesE8: bigint | null };

export type ImportRunRow = {
  id: number; importedAt: string; source: "ui" | "cli" | "api";
  instruments: number; transactions: number; historyRows: number;
  status: "ok" | "error"; message: string | null;
};

type InstrumentDbRow = {
  id: string; legacy_key: string; name: string; kind: InstrumentKind; category: InstrumentCategory;
  ticker: string | null; quote_source: string | null; quote_symbol: string | null; currency: string;
  benchmark: string | null; rate_e6: bigint | null; maturity_date: string | null;
  liquidity: string | null; broker: string | null; objective: string | null; investor: string | null;
};

const toInstrument = (row: InstrumentDbRow): InstrumentRow => ({
  id: row.id, legacyKey: row.legacy_key, name: row.name, kind: row.kind, category: row.category,
  ticker: row.ticker, quoteSource: row.quote_source, quoteSymbol: row.quote_symbol, currency: row.currency,
  benchmark: row.benchmark, rateE6: row.rate_e6, maturityDate: row.maturity_date,
  liquidity: row.liquidity, broker: row.broker, objective: row.objective, investor: row.investor,
});

export function insertInstruments(db: Db, rows: InstrumentRow[]): void {
  const stmt = db.prepare(`INSERT OR REPLACE INTO instruments
    (id, legacy_key, name, kind, category, ticker, quote_source, quote_symbol, currency,
     benchmark, rate_e6, maturity_date, liquidity, broker, objective, investor)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const run = db.transaction((items: InstrumentRow[]) => {
    for (const i of items) {
      stmt.run(i.id, i.legacyKey, i.name, i.kind, i.category, i.ticker, i.quoteSource, i.quoteSymbol,
        i.currency, i.benchmark, i.rateE6, i.maturityDate, i.liquidity, i.broker, i.objective, i.investor);
    }
  });
  run(rows);
}

export function listInstruments(db: Db): InstrumentRow[] {
  return (db.prepare("SELECT * FROM instruments ORDER BY id").all() as InstrumentDbRow[]).map(toInstrument);
}

export function getInstrument(db: Db, id: string): InstrumentRow | undefined {
  const row = db.prepare("SELECT * FROM instruments WHERE id = ?").get(id) as InstrumentDbRow | undefined;
  return row ? toInstrument(row) : undefined;
}

export function getInstrumentByLegacyKey(db: Db, legacyKey: string): InstrumentRow | undefined {
  const row = db.prepare("SELECT * FROM instruments WHERE legacy_key = ?").get(legacyKey) as InstrumentDbRow | undefined;
  return row ? toInstrument(row) : undefined;
}

export function insertTransactions(db: Db, rows: TransactionRow[]): void {
  const stmt = db.prepare(`INSERT INTO transactions
    (instrument_id, trade_date, kind, quantity_e8, gross_cents, fees_cents, note, legacy_row)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const run = db.transaction((items: TransactionRow[]) => {
    for (const t of items) {
      stmt.run(t.instrumentId, t.tradeDate, t.kind, t.quantityE8, t.grossCents, t.feesCents, t.note, t.legacyRow);
    }
  });
  run(rows);
}

export function listTransactionsByInstrument(db: Db, instrumentId: string): TransactionRow[] {
  const rows = db.prepare("SELECT * FROM transactions WHERE instrument_id = ? ORDER BY trade_date, id")
    .all(instrumentId) as Array<{
      instrument_id: string; trade_date: string; kind: TransactionKind;
      quantity_e8: bigint | null; gross_cents: bigint; fees_cents: bigint; note: string | null; legacy_row: bigint | null;
    }>;
  return rows.map((row) => ({
    instrumentId: row.instrument_id, tradeDate: row.trade_date, kind: row.kind,
    quantityE8: row.quantity_e8, grossCents: row.gross_cents, feesCents: row.fees_cents,
    note: row.note, legacyRow: row.legacy_row === null ? null : Number(row.legacy_row),
  }));
}

export function insertLegacySnapshots(db: Db, rows: LegacySnapshotRow[]): void {
  const stmt = db.prepare("INSERT OR REPLACE INTO legacy_snapshots (month, instrument_id, value_cents, shares_e8) VALUES (?, ?, ?, ?)");
  const run = db.transaction((items: LegacySnapshotRow[]) => {
    for (const s of items) stmt.run(s.month, s.instrumentId, s.valueCents, s.sharesE8);
  });
  run(rows);
}

export function latestLegacyMonth(db: Db): string | null {
  const row = db.prepare("SELECT MAX(month) AS month FROM legacy_snapshots").get() as { month: string | null };
  return row.month;
}

export function listLegacySnapshotByMonth(db: Db, month: string): LegacySnapshotRow[] {
  const rows = db.prepare("SELECT * FROM legacy_snapshots WHERE month = ? ORDER BY instrument_id").all(month) as Array<{
    month: string; instrument_id: string; value_cents: bigint; shares_e8: bigint | null;
  }>;
  return rows.map((row) => ({
    month: row.month, instrumentId: row.instrument_id, valueCents: row.value_cents, sharesE8: row.shares_e8,
  }));
}

export function insertImportRun(db: Db, run: Omit<ImportRunRow, "id" | "importedAt">): void {
  db.prepare("INSERT INTO import_runs (source, instruments, transactions, history_rows, status, message) VALUES (?, ?, ?, ?, ?, ?)")
    .run(run.source, run.instruments, run.transactions, run.historyRows, run.status, run.message);
}

export function listImportRuns(db: Db, limit = 20): ImportRunRow[] {
  const rows = db.prepare("SELECT * FROM import_runs ORDER BY id DESC LIMIT ?").all(limit) as Array<{
    id: bigint; imported_at: string; source: "ui" | "cli" | "api";
    instruments: bigint; transactions: bigint; history_rows: bigint; status: "ok" | "error"; message: string | null;
  }>;
  return rows.map((row) => ({
    id: Number(row.id), importedAt: row.imported_at, source: row.source,
    instruments: Number(row.instruments), transactions: Number(row.transactions),
    historyRows: Number(row.history_rows), status: row.status, message: row.message,
  }));
}

export function clearImportedData(db: Db): void {
  db.exec("DELETE FROM transactions; DELETE FROM legacy_snapshots; DELETE FROM valuations; DELETE FROM instruments;");
}

export function counts(db: Db): { instruments: number; transactions: number; legacySnapshots: number; importRuns: number } {
  const one = (sql: string): number => Number((db.prepare(sql).get() as { total: bigint }).total);
  return {
    instruments: one("SELECT COUNT(*) AS total FROM instruments"),
    transactions: one("SELECT COUNT(*) AS total FROM transactions"),
    legacySnapshots: one("SELECT COUNT(*) AS total FROM legacy_snapshots"),
    importRuns: one("SELECT COUNT(*) AS total FROM import_runs"),
  };
}
