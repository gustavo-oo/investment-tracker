import { CENTS, parseDecimal } from "../domain/money.ts";
import type { FetchLike, MonthlyQuoteSource, Quote, QuoteSource } from "./types.ts";

const BASE = "https://www.alphavantage.co/query";

export type AlphaVantageDeps = { apiKey: string; fetchImpl?: FetchLike };

type AlphaVantageResponse = {
  "Time Series (Daily)"?: Record<string, { "4. close"?: string }>;
  "Monthly Time Series"?: Record<string, { "4. close"?: string }>;
  Note?: string;
  Information?: string;
  "Error Message"?: string;
};

const SERIES = {
  daily: { fn: "TIME_SERIES_DAILY", key: "Time Series (Daily)", extra: "&outputsize=full", missing: "sem série" },
  monthly: { fn: "TIME_SERIES_MONTHLY", key: "Monthly Time Series", extra: "", missing: "sem série mensal" },
} as const;

type SeriesKind = keyof typeof SERIES;

export function createAlphaVantageSource(deps: AlphaVantageDeps): QuoteSource & MonthlyQuoteSource {
  const fetchImpl: FetchLike = deps.fetchImpl ?? fetch;
  const configured = () => deps.apiKey.trim() !== "";
  const refusalOf = (payload: AlphaVantageResponse): string | undefined =>
    payload.Note ?? payload.Information ?? payload["Error Message"];

  async function fetchSeries(kind: SeriesKind, ticker: string, from: string, to: string): Promise<Quote[]> {
    if (!configured()) throw new Error("alphavantage sem chave configurada");
    const spec = SERIES[kind];
    const symbol = `${ticker}.SAO`;
    const url = `${BASE}?function=${spec.fn}&symbol=${encodeURIComponent(symbol)}${spec.extra}&apikey=${encodeURIComponent(deps.apiKey)}`;
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error(`alphavantage HTTP ${response.status} para ${ticker}`);
    const payload = (await response.json()) as AlphaVantageResponse;
    const refusal = refusalOf(payload);
    if (refusal) throw new Error(`alphavantage recusou ${ticker}: ${refusal.slice(0, 80)}`);
    const series = payload[spec.key];
    if (!series) throw new Error(`alphavantage ${spec.missing} para ${ticker}`);
    const quotes: Quote[] = [];
    for (const [date, values] of Object.entries(series)) {
      if (date < from || date > to) continue;
      const close = values["4. close"];
      if (close === undefined) continue;
      quotes.push({ ticker, date, closeCents: parseDecimal(close, CENTS) });
    }
    return quotes;
  }

  return {
    id: "alphavantage",
    available: async () => configured(),
    async fetchDaily(symbols, from, to) {
      const quotes: Quote[] = [];
      for (const ticker of symbols) quotes.push(...(await fetchSeries("daily", ticker, from, to)));
      return quotes;
    },
    async fetchMonthly(symbols, from, to) {
      const quotes: Quote[] = [];
      for (const ticker of symbols) quotes.push(...(await fetchSeries("monthly", ticker, from, to)));
      return quotes;
    },
  };
}
