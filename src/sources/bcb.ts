import { RATE_SCALE, divRoundHalfUp, parseDecimal } from "../domain/money.ts";
import type { FetchLike, IndexRate, IndexSeries, IndexSource } from "./types.ts";

const BASE = "https://api.bcb.gov.br/dados/serie/bcdata.sgs";
const CODES: Record<IndexSeries, number> = { CDI: 12, SELIC: 11, IPCA: 433 };

export type BcbDeps = { fetchImpl?: FetchLike };

type SgsPoint = { data: string; valor: string };

const toBrDateParam = (date: string): string => {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
};

const toIsoDate = (date: string): string => {
  const [day, month, year] = date.split("/");
  return `${year}-${month}-${day}`;
};

export function createBcbSource(deps: BcbDeps = {}): IndexSource {
  const fetchImpl: FetchLike = deps.fetchImpl ?? fetch;
  return {
    id: "bcb",
    async fetchSeries(series, from, to) {
      const url = `${BASE}.${CODES[series]}/dados?formato=json&dataInicial=${toBrDateParam(from)}&dataFinal=${toBrDateParam(to)}`;
      const response = await fetchImpl(url);
      if (!response.ok) throw new Error(`bcb HTTP ${response.status} para ${series}`);
      const payload: unknown = await response.json();
      if (!Array.isArray(payload)) throw new Error(`bcb resposta inesperada para ${series}`);
      const rates: IndexRate[] = [];
      for (const point of payload as SgsPoint[]) {
        if (typeof point?.data !== "string" || typeof point?.valor !== "string") continue;
        rates.push({ series, date: toIsoDate(point.data), valueE12: divRoundHalfUp(parseDecimal(point.valor, RATE_SCALE), 100n) });
      }
      return rates;
    },
  };
}
