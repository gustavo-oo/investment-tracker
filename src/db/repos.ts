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

export type TransactionWithId = TransactionRow & { id: number };

type TransactionDbRow = {
  id: bigint; instrument_id: string; trade_date: string; kind: TransactionKind;
  quantity_e8: bigint | null; gross_cents: bigint; fees_cents: bigint; note: string | null; legacy_row: bigint | null;
};

const toTransaction = (row: TransactionDbRow): TransactionWithId => ({
  id: Number(row.id), instrumentId: row.instrument_id, tradeDate: row.trade_date, kind: row.kind,
  quantityE8: row.quantity_e8, grossCents: row.gross_cents, feesCents: row.fees_cents,
  note: row.note, legacyRow: row.legacy_row === null ? null : Number(row.legacy_row),
});

export type LegacySnapshotRow = { month: string; instrumentId: string; valueCents: bigint; sharesE8: bigint | null };

export type ImportRunRow = {
  id: number; importedAt: string; source: "ui" | "cli" | "api";
  instruments: number; transactions: number; historyRows: number;
  status: "ok" | "error"; message: string | null;
};

export type QuoteRow = { ticker: string; date: string; closeCents: bigint; source: string; settled: boolean };
export type IndexRateRow = { series: string; date: string; valueE12: bigint };
export type SourceStatusRow = {
  source: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
};

export type FundQuotaRow = { symbol: string; date: string; quotaE12: bigint; source: string; settled: boolean };

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

export function updateInstrumentInvestor(db: Db, id: string, investor: string): InstrumentRow | undefined {
  db.prepare("UPDATE instruments SET investor = ? WHERE id = ?").run(investor, id);
  return getInstrument(db, id);
}

export function insertInstrument(db: Db, row: InstrumentRow): void {
  db.prepare(`INSERT INTO instruments
    (id, legacy_key, name, kind, category, ticker, quote_source, quote_symbol, currency,
     benchmark, rate_e6, maturity_date, liquidity, broker, objective, investor)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(row.id, row.legacyKey, row.name, row.kind, row.category, row.ticker, row.quoteSource, row.quoteSymbol,
      row.currency, row.benchmark, row.rateE6, row.maturityDate, row.liquidity, row.broker, row.objective, row.investor);
}

export function updateInstrument(db: Db, row: InstrumentRow): void {
  db.prepare(`UPDATE instruments SET legacy_key = ?, name = ?, kind = ?, category = ?, ticker = ?,
    quote_source = ?, quote_symbol = ?, currency = ?, benchmark = ?, rate_e6 = ?, maturity_date = ?,
    liquidity = ?, broker = ?, objective = ?, investor = ? WHERE id = ?`)
    .run(row.legacyKey, row.name, row.kind, row.category, row.ticker, row.quoteSource, row.quoteSymbol,
      row.currency, row.benchmark, row.rateE6, row.maturityDate, row.liquidity, row.broker, row.objective, row.investor, row.id);
}

export function deleteInstrument(db: Db, id: string): void {
  db.prepare("DELETE FROM instruments WHERE id = ?").run(id);
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

export function listTransactionsByInstrument(db: Db, instrumentId: string): TransactionWithId[] {
  const rows = db.prepare("SELECT * FROM transactions WHERE instrument_id = ? ORDER BY trade_date, id")
    .all(instrumentId) as TransactionDbRow[];
  return rows.map(toTransaction);
}

export function getTransaction(db: Db, id: number): TransactionWithId | undefined {
  const row = db.prepare("SELECT * FROM transactions WHERE id = ?").get(id) as TransactionDbRow | undefined;
  return row ? toTransaction(row) : undefined;
}

export function insertTransaction(db: Db, row: TransactionRow): number {
  const result = db.prepare(`INSERT INTO transactions
    (instrument_id, trade_date, kind, quantity_e8, gross_cents, fees_cents, note, legacy_row)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(row.instrumentId, row.tradeDate, row.kind, row.quantityE8, row.grossCents, row.feesCents, row.note, row.legacyRow);
  return Number(result.lastInsertRowid);
}

export function updateTransaction(db: Db, id: number, row: TransactionRow): void {
  db.prepare(`UPDATE transactions SET instrument_id = ?, trade_date = ?, kind = ?, quantity_e8 = ?,
    gross_cents = ?, fees_cents = ?, note = ?, legacy_row = ? WHERE id = ?`)
    .run(row.instrumentId, row.tradeDate, row.kind, row.quantityE8, row.grossCents, row.feesCents, row.note, row.legacyRow, id);
}

export function deleteTransaction(db: Db, id: number): void {
  db.prepare("DELETE FROM transactions WHERE id = ?").run(id);
}

export function countTransactions(db: Db, instrumentId: string): number {
  const row = db.prepare("SELECT COUNT(*) AS total FROM transactions WHERE instrument_id = ?").get(instrumentId) as { total: bigint };
  return Number(row.total);
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

export function writeQuotes(db: Db, rows: QuoteRow[], today: string): { inserted: number; updated: number; skipped: number } {
  const writeClosed = db.prepare(`INSERT INTO quotes (ticker, date, close_cents, source, settled)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(ticker, date) DO UPDATE SET
      close_cents = excluded.close_cents, source = excluded.source, settled = 1, fetched_at = datetime('now')
    WHERE quotes.settled = 0`);
  const writeToday = db.prepare(`INSERT INTO quotes (ticker, date, close_cents, source, settled)
    VALUES (?, ?, ?, ?, 0)
    ON CONFLICT(ticker, date) DO UPDATE SET
      close_cents = excluded.close_cents, source = excluded.source, fetched_at = datetime('now')
    WHERE quotes.settled = 0`);
  const find = db.prepare("SELECT settled FROM quotes WHERE ticker = ? AND date = ?");
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const run = db.transaction((items: QuoteRow[]) => {
    for (const quote of items) {
      const before = find.get(quote.ticker, quote.date) as { settled: bigint } | undefined;
      const result = (quote.date < today ? writeClosed : writeToday).run(quote.ticker, quote.date, quote.closeCents, quote.source);
      if (Number(result.changes) === 0) skipped++;
      else if (before) updated++;
      else inserted++;
    }
  });
  run(rows);
  return { inserted, updated, skipped };
}

export function writeIndexRates(db: Db, rows: IndexRateRow[]): { inserted: number; skipped: number } {
  const stmt = db.prepare("INSERT OR IGNORE INTO index_rates (series, date, value_e12) VALUES (?, ?, ?)");
  let inserted = 0;
  let skipped = 0;
  const run = db.transaction((items: IndexRateRow[]) => {
    for (const rate of items) {
      const result = stmt.run(rate.series, rate.date, rate.valueE12);
      if (Number(result.changes) === 0) skipped++;
      else inserted++;
    }
  });
  run(rows);
  return { inserted, skipped };
}

export function quoteFrontier(db: Db, ticker: string): string | null {
  const row = db.prepare("SELECT MAX(date) AS date FROM quotes WHERE ticker = ?").get(ticker) as { date: string | null };
  return row.date;
}

export function indexFrontier(db: Db, series: string): string | null {
  const row = db.prepare("SELECT MAX(date) AS date FROM index_rates WHERE series = ?").get(series) as { date: string | null };
  return row.date;
}

export function earliestTradeDate(db: Db): string | null {
  const row = db.prepare("SELECT MIN(trade_date) AS date FROM transactions").get() as { date: string | null };
  return row.date;
}

export function hasQuoteFromSourceOnDate(db: Db, ticker: string, source: string, date: string): boolean {
  return db.prepare("SELECT 1 AS found FROM quotes WHERE ticker = ? AND source = ? AND date = ?").get(ticker, source, date) !== undefined;
}

let lastSourceStatusStamp = 0;

function nextSourceStatusStamp(): string {
  lastSourceStatusStamp = Math.max(Date.now(), lastSourceStatusStamp + 1);
  return new Date(lastSourceStatusStamp).toISOString();
}

export function recordSourceAttempt(db: Db, source: string, result: { ok: true } | { ok: false; error: string }): void {
  const stamp = nextSourceStatusStamp();
  if (result.ok) {
    db.prepare(`INSERT INTO source_status (source, last_attempt_at, last_success_at)
      VALUES (?, ?, ?)
      ON CONFLICT(source) DO UPDATE SET
        last_attempt_at = excluded.last_attempt_at, last_success_at = excluded.last_success_at`).run(source, stamp, stamp);
    return;
  }
  db.prepare(`INSERT INTO source_status (source, last_attempt_at, last_error_at, last_error)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(source) DO UPDATE SET
      last_attempt_at = excluded.last_attempt_at, last_error_at = excluded.last_error_at, last_error = excluded.last_error`)
    .run(source, stamp, stamp, result.error.slice(0, 500));
}

export function listSourceStatus(db: Db): SourceStatusRow[] {
  const rows = db.prepare("SELECT * FROM source_status ORDER BY source").all() as Array<{
    source: string; last_attempt_at: string | null; last_success_at: string | null; last_error_at: string | null; last_error: string | null;
  }>;
  return rows.map((row) => ({
    source: row.source, lastAttemptAt: row.last_attempt_at, lastSuccessAt: row.last_success_at,
    lastErrorAt: row.last_error_at, lastError: row.last_error,
  }));
}

export function listAllQuotes(db: Db): QuoteRow[] {
  const rows = db.prepare("SELECT ticker, date, close_cents, source, settled FROM quotes ORDER BY ticker, date").all() as Array<{
    ticker: string; date: string; close_cents: bigint; source: string; settled: bigint;
  }>;
  return rows.map((row) => ({
    ticker: row.ticker, date: row.date, closeCents: row.close_cents, source: row.source, settled: Number(row.settled) === 1,
  }));
}

export function listAllIndexRates(db: Db): IndexRateRow[] {
  const rows = db.prepare("SELECT series, date, value_e12 FROM index_rates ORDER BY series, date").all() as Array<{
    series: string; date: string; value_e12: bigint;
  }>;
  return rows.map((row) => ({ series: row.series, date: row.date, valueE12: row.value_e12 }));
}

export function listAllTransactions(db: Db): TransactionRow[] {
  const rows = db.prepare("SELECT * FROM transactions ORDER BY instrument_id, trade_date, id").all() as Array<{
    instrument_id: string; trade_date: string; kind: TransactionKind;
    quantity_e8: bigint | null; gross_cents: bigint; fees_cents: bigint; note: string | null; legacy_row: bigint | null;
  }>;
  return rows.map((row) => ({
    instrumentId: row.instrument_id, tradeDate: row.trade_date, kind: row.kind,
    quantityE8: row.quantity_e8, grossCents: row.gross_cents, feesCents: row.fees_cents,
    note: row.note, legacyRow: row.legacy_row === null ? null : Number(row.legacy_row),
  }));
}

export function writeFundQuotas(db: Db, rows: FundQuotaRow[], today: string): { inserted: number; updated: number; skipped: number } {
  const writeClosed = db.prepare(`INSERT INTO fund_quotas (symbol, date, quota_e12, source, settled)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(symbol, date) DO UPDATE SET
      quota_e12 = excluded.quota_e12, source = excluded.source, settled = 1, fetched_at = datetime('now')
    WHERE fund_quotas.settled = 0`);
  const writeToday = db.prepare(`INSERT INTO fund_quotas (symbol, date, quota_e12, source, settled)
    VALUES (?, ?, ?, ?, 0)
    ON CONFLICT(symbol, date) DO UPDATE SET
      quota_e12 = excluded.quota_e12, source = excluded.source, fetched_at = datetime('now')
    WHERE fund_quotas.settled = 0`);
  const find = db.prepare("SELECT settled FROM fund_quotas WHERE symbol = ? AND date = ?");
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const run = db.transaction((items: FundQuotaRow[]) => {
    for (const quota of items) {
      const before = find.get(quota.symbol, quota.date) as { settled: bigint } | undefined;
      const result = (quota.date < today ? writeClosed : writeToday).run(quota.symbol, quota.date, quota.quotaE12, quota.source);
      if (Number(result.changes) === 0) skipped++;
      else if (before) updated++;
      else inserted++;
    }
  });
  run(rows);
  return { inserted, updated, skipped };
}

export function fundQuotaFrontier(db: Db, symbol: string): string | null {
  const row = db.prepare("SELECT MAX(date) AS date FROM fund_quotas WHERE symbol = ?").get(symbol) as { date: string | null };
  return row.date;
}

export function listAllFundQuotas(db: Db): FundQuotaRow[] {
  const rows = db.prepare("SELECT symbol, date, quota_e12, source, settled FROM fund_quotas ORDER BY symbol, date").all() as Array<{
    symbol: string; date: string; quota_e12: bigint; source: string; settled: bigint;
  }>;
  return rows.map((row) => ({
    symbol: row.symbol, date: row.date, quotaE12: row.quota_e12, source: row.source, settled: Number(row.settled) === 1,
  }));
}
