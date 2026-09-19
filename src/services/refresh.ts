import type { Db } from "../db/index.ts";
import { createIndexSource, createQuoteSources } from "../sources/index.ts";
import type { IndexSource, QuoteSource } from "../sources/types.ts";
import { refreshIndices } from "./refresh-indices.ts";
import { refreshQuotes } from "./refresh-quotes.ts";
import type { RefreshSourceSummary } from "./refresh-summary.ts";

export class RefreshBusyError extends Error {
  constructor() {
    super("refresh em andamento");
    this.name = "RefreshBusyError";
  }
}

export type RefreshOptions = {
  full?: boolean;
  source?: string;
  /** Interno: usado apenas pelo scheduler de 10 min para rodar só as cotações, sem tocar no BCB. Não faz parte da API HTTP. */
  quotesOnly?: boolean;
};
export type RefreshResult = { sources: RefreshSourceSummary[] };
export type RefreshDeps = {
  quoteSources?: QuoteSource[];
  indexSource?: IndexSource;
  now?: () => Date;
  fallbackAttempts?: Map<string, string>;
};

let running = false;

export async function refresh(db: Db, options: RefreshOptions = {}, deps: RefreshDeps = {}): Promise<RefreshResult> {
  if (running) throw new RefreshBusyError();
  running = true;
  try {
    const sourceDeps = { alphaVantageApiKey: process.env.ALPHAVANTAGE_API_KEY ?? "" };
    const quoteSources = deps.quoteSources ?? createQuoteSources(sourceDeps);
    const indexSource = deps.indexSource ?? createIndexSource(sourceDeps);
    const wanted = options.source;
    const wantsQuotes = wanted === undefined || wanted === "yahoo" || wanted === "alphavantage";
    const wantsIndices = wanted === undefined ? options.quotesOnly !== true : wanted === "bcb";
    if (!wantsQuotes && !wantsIndices) throw new Error(`fonte desconhecida: ${wanted}`);

    const summaries: RefreshSourceSummary[] = [];
    if (wantsQuotes) {
      let sources = quoteSources;
      if (wanted === "alphavantage") {
        const alphaVantage = quoteSources.find((source) => source.id === "alphavantage");
        if (!alphaVantage) throw new Error("alphavantage não configurado (ALPHAVANTAGE_API_KEY ausente)");
        sources = [alphaVantage];
      } else if (wanted === "yahoo") {
        sources = quoteSources.filter((source) => source.id === "yahoo");
      }
      summaries.push(...(await refreshQuotes(db, { sources, now: deps.now, full: options.full, fallbackAttempts: deps.fallbackAttempts })));
    }
    if (wantsIndices) summaries.push(await refreshIndices(db, { source: indexSource, now: deps.now }, options.full));
    return { sources: summaries };
  } finally {
    running = false;
  }
}
