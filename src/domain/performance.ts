import { daysBetween } from "./dates.ts";
import { divRoundHalfUp } from "./money.ts";

/** Retorno do período em % (4 casas) com fluxos ponderados pelos dias investidos (Modified Dietz); null sem base/período. */
export function monthlyPortfolioPct(
  prevValueCents: bigint,
  prevDate: string,
  valueCents: bigint,
  valueDate: string,
  flows: DatedFlow[],
): number | null {
  if (prevValueCents <= 0n) return null;
  const periodDays = daysBetween(prevDate, valueDate);
  if (periodDays <= 0) return null;
  let totalFlow = 0n;
  let weightedFlow = 0n;
  for (const flow of flows) {
    totalFlow += flow.cents;
    const investedDays = Math.min(Math.max(daysBetween(flow.date, valueDate), 0), periodDays);
    weightedFlow += flow.cents * BigInt(investedDays);
  }
  const denominator = prevValueCents * BigInt(periodDays) + weightedFlow;
  if (denominator <= 0n) return null;
  const delta = valueCents - prevValueCents - totalFlow;
  return Number(divRoundHalfUp(delta * 1_000_000n * BigInt(periodDays), denominator)) / 10_000;
}

/** Acumula percentuais compostos em % (4 casas); ignora null; 0 se vazio. */
export function accumulatePct(pcts: Array<number | null>): number {
  let factor = 1;
  for (const pct of pcts) {
    if (pct !== null) factor *= 1 + pct / 100;
  }
  return Math.round((factor - 1) * 1_000_000) / 10_000;
}

/** Diferença em pontos percentuais (a − b), 4 casas. */
export function gapPp(a: number, b: number): number {
  return Math.round((a - b) * 10_000) / 10_000;
}

/** Quantos meses da série bateram o CDI (empate não conta). */
export function monthsBeaten(rows: Array<{ portfolioPct: number | null; cdiPct: number | null }>): number {
  return rows.filter((row) => row.portfolioPct !== null && row.cdiPct !== null && row.portfolioPct > row.cdiPct).length;
}

/** Fluxo datado na perspectiva da carteira: aporte > 0, resgate < 0. */
export type DatedFlow = { date: string; cents: bigint };

const YEAR_DAYS = 365;
const XIRR_MIN_RATE = -0.9;
const XIRR_MAX_RATE = 10;

/** TIR anual (ACT/365) em % (4 casas); null se nada foi investido ou sem troca de sinal no intervalo. */
export function xirrPct(
  startCents: bigint,
  startDate: string,
  flows: DatedFlow[],
  endCents: bigint,
  endDate: string,
): number | null {
  const invested = flows.reduce((total, flow) => total + (flow.cents < 0n ? -flow.cents : flow.cents), startCents);
  if (invested === 0n) return null;
  const elapsedDays = [0, ...flows.map((flow) => daysBetween(startDate, flow.date)), daysBetween(startDate, endDate)];
  const cents = [-startCents, ...flows.map((flow) => -flow.cents), endCents];
  const npv = (rate: number): number => {
    let total = 0;
    for (let index = 0; index < cents.length; index++) {
      total += Number(cents[index]!) / (1 + rate) ** (elapsedDays[index]! / YEAR_DAYS);
    }
    return total;
  };
  if (npv(XIRR_MIN_RATE) * npv(XIRR_MAX_RATE) > 0) return null;
  let low = XIRR_MIN_RATE;
  let high = XIRR_MAX_RATE;
  for (let iteration = 0; iteration < 300; iteration++) {
    const mid = (low + high) / 2;
    if (npv(low) * npv(mid) <= 0) high = mid;
    else low = mid;
  }
  return Math.round(((low + high) / 2) * 1_000_000) / 10_000;
}
