import { resolve } from "node:path";
import { buildApp } from "./app.ts";
import { openDb } from "./db/index.ts";
import { migrate } from "./db/migrate.ts";
import { startScheduler } from "./jobs/scheduler.ts";

const dbPath = resolve(process.env.DB_PATH ?? "data/investments.db");
const csvDir = resolve(process.env.CSV_DIR ?? "data/csv");
const webDir = resolve(process.env.WEB_DIR ?? "web/dist");
const port = Number(process.env.PORT ?? 3000);

const db = openDb(dbPath);
const applied = migrate(db);
const app = buildApp({ db, csvDir, logger: true, webDir });

app.listen({ port, host: "0.0.0.0" })
  .then((address) => {
    console.log(`migrations: ${applied}; servindo em ${address}`);
    const scheduler = startScheduler(db, {
      onError: (error) => { app.log.error({ err: error }, "refresh falhou"); },
    });
    scheduler.runNow();
  })
  .catch((error) => { console.error(error); process.exit(1); });
