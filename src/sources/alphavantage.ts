import { CENTS, parseDecimal } from "../domain/money.ts";
import type { FetchLike, Quote, QuoteSource } from "./types.ts";

const BASE = "https://www.alphavantage.co/query";

export type AlphaVantageDeps = { apiKey: string; fetchImpl?: FetchLike };

type DailyResponse = {
  "Time Series (Daily)"?: Record<string, { "4. close"?: string }>;
  Note?: string;
  Information?: string;
  "Error Message"?: string;
};

export function createAlphaVantageSource(deps: AlphaVantageDeps): QuoteSource {
  const fetchImpl: FetchLike = deps.fetchImpl ?? fetch;
  const configured = () => deps.apiKey.trim() !== "";
  return {
    id: "alphavantage",
    available: async () => configured(),
    async fetchDaily(symbols, from, to) {
      if (!configured()) throw new Error("alphavantage sem chave configurada");
      const quotes: Quote[] = [];
      for (const ticker of symbols) {
        const symbol = `${ticker}.SAO`;
        const url = `${BASE}?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}&outputsize=full&apikey=${encodeURIComponent(deps.apiKey)}`;
        const response = await fetchImpl(url);
        if (!response.ok) throw new Error(`alphavantage HTTP ${response.status} para ${ticker}`);
        const payload = (await response.json()) as DailyResponse;
        const refusal = payload.Note ?? payload.Information ?? payload["Error Message"];
        if (refusal) throw new Error(`alphavantage recusou ${ticker}: ${refusal.slice(0, 80)}`);
        const series = payload["Time Series (Daily)"];
        if (!series) throw new Error(`alphavantage sem série para ${ticker}`);
        for (const [date, values] of Object.entries(series)) {
          if (date < from || date > to) continue;
          const close = values["4. close"];
          if (close === undefined) continue;
          quotes.push({ ticker, date, closeCents: parseDecimal(close, CENTS) });
        }
      }
      return quotes;
    },
  };
}
