import { resolve } from "node:path";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { counts } from "../db/repos.ts";
import { replaceGuardError } from "./replace-guard.ts";
import { runImportFromDir } from "./run.ts";

const csvDir = resolve(process.env.CSV_DIR ?? "data/csv");
const dbPath = resolve(process.env.DB_PATH ?? "data/investments.db");
const db = openDb(dbPath);
const applied = migrate(db);
const guard = replaceGuardError(process.argv.slice(2), counts(db));
if (guard !== null) {
  console.error(`erro: ${guard}`);
  db.close();
  process.exit(1);
}
const summary = runImportFromDir(db, csvDir, { dryRun: false, source: "cli" });

console.log(`migrations aplicadas: ${applied}`);
console.log(`importado: ${summary.instruments} instrumentos, ${summary.transactions} transações, ${summary.historyRows} linhas de histórico`);
console.log(`último mês: ${summary.latestMonth} (total ${summary.latestTotalCents} centavos)`);
for (const warning of summary.warnings) console.warn(`aviso: ${warning}`);
for (const error of summary.errors) console.error(`erro: ${error}`);
console.log(`banco: ${dbPath}`);
db.close();
process.exit(summary.errors.length > 0 ? 1 : 0);
