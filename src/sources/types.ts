export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

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

export type FundQuota = { symbol: string; date: string; quotaE12: bigint };

export type FundQuotaSource = {
  id: string;
  fetchDaily(symbols: string[], from: string, to: string): Promise<FundQuota[]>;
};

export type MonthlyQuoteSource = {
  id: string;
  available(): Promise<boolean>;
  fetchMonthly(symbols: string[], from: string, to: string): Promise<Quote[]>;
};
