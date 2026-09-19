export type FetchLike = (url: string) => Promise<Response>;

export type Quote = { ticker: string; date: string; closeCents: bigint };

export type QuoteSource = {
  id: string;
  available(): Promise<boolean>;
  fetchDaily(symbols: string[], from: string, to: string): Promise<Quote[]>;
};

export type IndexSeries = "CDI" | "SELIC" | "IPCA";
export type IndexRate = { series: IndexSeries; date: string; valueE12: bigint };

export type IndexSource = {
  id: string;
  fetchSeries(series: IndexSeries, from: string, to: string): Promise<IndexRate[]>;
};
