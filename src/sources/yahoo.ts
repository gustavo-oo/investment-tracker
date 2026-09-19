import { CENTS, parseDecimal } from "../domain/money.ts";
import type { FetchLike, Quote, QuoteSource } from "./types.ts";

const BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const BRT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });

export type YahooChartResponse = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
    error?: { description?: string } | null;
  };
};

export type YahooDeps = { fetchImpl?: FetchLike };

const startOfDayUnix = (date: string): number => Math.floor(new Date(`${date}T00:00:00-03:00`).getTime() / 1000);
const endOfDayUnix = (date: string): number => Math.floor(new Date(`${date}T23:59:59-03:00`).getTime() / 1000);

export function createYahooSource(deps: YahooDeps = {}): QuoteSource {
  const fetchImpl: FetchLike = deps.fetchImpl ?? fetch;
  return {
    id: "yahoo",
    available: async () => true,
    async fetchDaily(symbols, from, to) {
      const quotes: Quote[] = [];
      for (const ticker of symbols) {
        const symbol = `${ticker}.SA`;
        const url = `${BASE}/${encodeURIComponent(symbol)}?period1=${startOfDayUnix(from)}&period2=${endOfDayUnix(to)}&interval=1d`;
        const response = await fetchImpl(url);
        if (!response.ok) throw new Error(`yahoo HTTP ${response.status} para ${ticker}`);
        const payload = (await response.json()) as YahooChartResponse;
        if (payload.chart?.error) throw new Error(`yahoo erro para ${ticker}: ${payload.chart.error.description ?? "desconhecido"}`);
        const result = payload.chart?.result?.[0];
        if (!result) throw new Error(`yahoo sem resultado para ${ticker}`);
        const timestamps = result.timestamp ?? [];
        const closes = result.indicators?.quote?.[0]?.close ?? [];
        for (let index = 0; index < timestamps.length; index++) {
          const close = closes[index];
          const timestamp = timestamps[index];
          if (typeof close !== "number" || close <= 0 || timestamp === undefined) continue;
          quotes.push({ ticker, date: BRT.format(new Date(timestamp * 1000)), closeCents: parseDecimal(close.toFixed(2), CENTS) });
        }
      }
      return quotes;
    },
  };
}
