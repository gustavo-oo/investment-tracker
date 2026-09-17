import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { counts, listLegacySnapshotByMonth, listTransactionsByInstrument } from "../db/repos.ts";
import { buildImportInputFromDir, runImport } from "./run.ts";

test("import dos dados reais reproduz os números do legado", () => {
  const db = openDb(":memory:");
  migrate(db);
  const summary = runImport(db, buildImportInputFromDir("data/csv"), { dryRun: false, source: "cli" });
  assert.deepEqual(summary.errors, []);
  assert.deepEqual(summary.warnings, []);
  assert.deepEqual(counts(db), { instruments: 48, transactions: 119, legacySnapshots: 847, importRuns: 1 });
  assert.equal(summary.latestMonth, "2026-09-01");
  assert.equal(summary.latestTotalCents, <valor>);
  assert.equal(listLegacySnapshotByMonth(db, "2026-09-01").length, 33);
  assert.equal(listTransactionsByInstrument(db, "cdb-pagbank-112-02-07-26")[1]?.grossCents, 273342n);
  assert.equal(listTransactionsByInstrument(db, "b5p211")[0]?.quantityE8, 4100000000n);
  assert.equal(listTransactionsByInstrument(db, "cdb-pagbank-112-02-07-26")[0]?.quantityE8, null);
});
