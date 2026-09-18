import { RATE_SCALE, divRoundHalfUp } from "./money.ts";
import type { RatePoint } from "./position.ts";

/** CDI acumulado do mês em % (4 casas); null se não há taxa no mês. */
export function cdiMonthPct(rates: RatePoint[], month: string): number | null {
  let factor = RATE_SCALE;
  let found = false;
  for (const rate of rates) {
    if (rate.date.slice(0, 7) !== month) continue;
    factor = divRoundHalfUp(factor * (RATE_SCALE + rate.valueE12), RATE_SCALE);
    found = true;
  }
  if (!found) return null;
  return Number(divRoundHalfUp((factor - RATE_SCALE) * 1_000_000n, RATE_SCALE)) / 10_000;
}

/** IPCA do mês em % (4 casas); null se não há taxa no mês. */
export function ipcaMonthPct(rates: RatePoint[], month: string): number | null {
  const rate = rates.find((point) => point.date.slice(0, 7) === month);
  if (!rate) return null;
  return Number(rate.valueE12) / 10_000_000_000;
}
