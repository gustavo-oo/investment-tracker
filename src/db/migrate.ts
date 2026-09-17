import { readdirSync, readFileSync } from "node:fs";
import type { Db } from "./index.ts";

const MIGRATIONS_DIR = new URL("./migrations/", import.meta.url);

export function migrate(db: Db): number {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const appliedRows = db.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: bigint }>;
  const applied = new Set(appliedRows.map((row) => Number(row.version)));
  const files = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql")).sort();
  let count = 0;
  for (const file of files) {
    const version = Number(file.slice(0, 3));
    if (applied.has(version)) continue;
    const sql = readFileSync(new URL(file, MIGRATIONS_DIR), "utf8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(version);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    count++;
  }
  return count;
}
