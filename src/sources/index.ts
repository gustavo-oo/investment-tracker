import { createAlphaVantageSource } from "./alphavantage.ts";
import { createBcbSource } from "./bcb.ts";
import { createCvmSwbSource } from "./cvm-swb.ts";
import { createYahooSource } from "./yahoo.ts";
import type { FetchLike, FundQuotaSource, IndexSource, QuoteSource } from "./types.ts";

export type SourceDeps = { fetchImpl?: FetchLike; alphaVantageApiKey?: string };

/** Fontes de preço em ordem de prioridade: Yahoo; Alpha Vantage só com chave. */
export function createQuoteSources(deps: SourceDeps = {}): QuoteSource[] {
  const sources: QuoteSource[] = [createYahooSource(deps)];
  const apiKey = deps.alphaVantageApiKey ?? "";
  if (apiKey.trim() !== "") sources.push(createAlphaVantageSource({ apiKey, fetchImpl: deps.fetchImpl }));
  return sources;
}

export function createIndexSource(deps: SourceDeps = {}): IndexSource {
  return createBcbSource(deps);
}

let defaultFundQuotaSource: FundQuotaSource | undefined;

/** Sem deps injetadas, devolve o singleton do processo — o cache de 6h precisa sobreviver entre refreshes. */
export function createFundQuotaSource(deps: SourceDeps = {}): FundQuotaSource {
  if (deps.fetchImpl !== undefined) return createCvmSwbSource(deps);
  return (defaultFundQuotaSource ??= createCvmSwbSource(deps));
}
