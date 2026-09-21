import { resolve } from "node:path";
import { openDb } from "./db/index.ts";
import { migrate } from "./db/migrate.ts";
import { repairWindow } from "./services/quote-repair.ts";
import { createMonthlyQuoteSource } from "./sources/index.ts";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const ticker = arg("ticker");
const from = arg("from");
const to = arg("to");
if (ticker === undefined || from === undefined || to === undefined) {
  console.error("uso: npm run backfill -- --ticker B5P211 --from 2025-04-23 --to 2026-01-07");
  process.exit(1);
}
const apiKey = process.env.ALPHAVANTAGE_API_KEY ?? "";
if (apiKey.trim() === "") {
  console.error("ALPHAVANTAGE_API_KEY ausente (coloque no .env)");
  process.exit(1);
}
const db = openDb(resolve(process.env.DB_PATH ?? "data/investments.db"));
migrate(db);
const result = await repairWindow(db, { source: createMonthlyQuoteSource({ alphaVantageApiKey: apiKey }), ticker, from, to });
if (result.skipped) console.log(`nada a reparar: alphavantage sem pontos em ${from}..${to}`);
else console.log(`reparo ${ticker} ${from}..${to}: ${result.deleted} linhas apagadas, ${result.inserted} pontos gravados`);
