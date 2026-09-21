import type { Db } from "../db/index.ts";
import { createFundQuotaSource, createIndexSource, createMonthlyQuoteSource, createQuoteSources } from "../sources/index.ts";
import type { FundQuotaSource, IndexSource, MonthlyQuoteSource, QuoteSource } from "../sources/types.ts";
import { repairConstantRuns, type QuoteRepairResult } from "./quote-repair.ts";
import { refreshIndices } from "./refresh-indices.ts";
import { refreshPension } from "./refresh-pension.ts";
import { refreshQuotes } from "./refresh-quotes.ts";
import type { RefreshSourceSummary } from "./refresh-summary.ts";

export class RefreshBusyError extends Error {
  constructor() {
    super("refresh em andamento");
    this.name = "RefreshBusyError";
  }
}

export class RefreshRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefreshRequestError";
  }
}

export type RefreshOptions = {
  full?: boolean;
  source?: string;
  /** Interno: usado apenas pelo scheduler de 10 min para rodar só as cotações, sem tocar no BCB. Não faz parte da API HTTP. */
  quotesOnly?: boolean;
};
export type RefreshResult = { sources: RefreshSourceSummary[]; repairs: QuoteRepairResult[] };
export type RefreshDeps = {
  quoteSources?: QuoteSource[];
  indexSource?: IndexSource;
  pensionSource?: FundQuotaSource;
  monthlySource?: MonthlyQuoteSource;
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
    const pensionSource = deps.pensionSource ?? createFundQuotaSource(sourceDeps);
    const monthlySource = deps.monthlySource ?? createMonthlyQuoteSource(sourceDeps);
    const wanted = options.source;
    const wantsQuotes = wanted === undefined || wanted === "yahoo" || wanted === "alphavantage";
    const wantsIndices = wanted === undefined ? options.quotesOnly !== true : wanted === "bcb";
    const wantsPension = wanted === undefined ? options.quotesOnly !== true : wanted === "cvm-swb";
    if (!wantsQuotes && !wantsIndices && !wantsPension) throw new RefreshRequestError(`fonte desconhecida: ${wanted}`);

    const summaries: RefreshSourceSummary[] = [];
    let repairs: QuoteRepairResult[] = [];
    if (wantsQuotes) {
      let sources = quoteSources;
      if (wanted === "alphavantage") {
        const alphaVantage = quoteSources.find((source) => source.id === "alphavantage");
        if (!alphaVantage) throw new RefreshRequestError("alphavantage não configurado (ALPHAVANTAGE_API_KEY ausente)");
        sources = [alphaVantage];
      } else if (wanted === "yahoo") {
        sources = quoteSources.filter((source) => source.id === "yahoo");
      }
      summaries.push(...(await refreshQuotes(db, { sources, now: deps.now, full: options.full, fallbackAttempts: deps.fallbackAttempts })));
      repairs = await repairConstantRuns(db, { source: monthlySource, now: deps.now });
    }
    if (wantsIndices) summaries.push(await refreshIndices(db, { source: indexSource, now: deps.now }, options.full));
    if (wantsPension) summaries.push(await refreshPension(db, { source: pensionSource, now: deps.now, full: options.full }));
    return { sources: summaries, repairs };
  } finally {
    running = false;
  }
}
