import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "./index.ts";
import { migrate } from "./migrate.ts";

test("migrate aplica 001 a 004 e é idempotente", () => {
  const db = openDb(":memory:");
  assert.equal(migrate(db), 4);
  assert.equal(migrate(db), 0);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => (row as { name: string }).name);
  for (const table of ["instruments", "transactions", "quotes", "index_rates", "valuations", "legacy_snapshots", "import_runs", "source_status", "fund_quotas", "rebalance_targets"]) {
    assert.ok(tables.includes(table), `tabela ${table} existe`);
  }
});

test("schema rejeita kind inválido em transaction", () => {
  const db = openDb(":memory:");
  migrate(db);
  db.prepare(`INSERT INTO instruments (id, legacy_key, name, kind, category) VALUES (?, ?, ?, ?, ?)`)
    .run("x", "X", "X", "fixed_income", "cdb");
  assert.throws(() => {
    db.prepare(`INSERT INTO transactions (instrument_id, trade_date, kind, gross_cents) VALUES (?, ?, ?, ?)`)
      .run("x", "2026-01-01", "DOACAO", 100n);
  });
});
