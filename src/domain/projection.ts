import { divRoundHalfUp } from "./money.ts";

/** Mínimo de retornos mensais válidos para estimar a projeção. */
export const MIN_MONTHS = 6;

export type ProjectionPremise = {
  monthsUsed: number;
  monthlyRatePct: number;
  bandPp: number;
  contributionCents: bigint;
  pessimisticMonthlyPct: number;
  optimisticMonthlyPct: number;
};

/** Padrão recente: média geométrica do retorno mensal, desvio-padrão amostral e aporte líquido médio. */
export function projectionPremise(
  returnsPct: Array<number | null>,
  netContributionsCents: bigint[],
): ProjectionPremise | null {
  const valid = returnsPct.filter((pct): pct is number => pct !== null);
  if (valid.length < MIN_MONTHS || netContributionsCents.length === 0) return null;
  let factor = 1;
  for (const pct of valid) factor *= 1 + pct / 100;
  const monthlyRatePct = round4((factor ** (1 / valid.length) - 1) * 100);
  const mean = valid.reduce((total, pct) => total + pct, 0) / valid.length;
  const variance = valid.reduce((total, pct) => total + (pct - mean) ** 2, 0) / (valid.length - 1);
  const bandPp = round4(Math.sqrt(variance));
  return {
    monthsUsed: valid.length,
    monthlyRatePct,
    bandPp,
    contributionCents: divRoundHalfUp(
      netContributionsCents.reduce((total, cents) => total + cents, 0n),
      BigInt(netContributionsCents.length),
    ),
    pessimisticMonthlyPct: round4(Math.max(monthlyRatePct - bandPp, -99)),
    optimisticMonthlyPct: round4(monthlyRatePct + bandPp),
  };
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export type ProjectionPoint = { baseCents: bigint; pessimisticCents: bigint; optimisticCents: bigint };

/** Recorrência mensal (Vₙ₊₁ = (Vₙ + aporte) × (1 + taxa)) para base, pessimista e otimista. */
export function projectPatrimony(
  patrimonyCents: bigint,
  premise: Pick<ProjectionPremise, "contributionCents" | "monthlyRatePct" | "pessimisticMonthlyPct" | "optimisticMonthlyPct">,
  months: number,
): ProjectionPoint[] {
  const rates = [premise.monthlyRatePct, premise.pessimisticMonthlyPct, premise.optimisticMonthlyPct];
  let values = [patrimonyCents, patrimonyCents, patrimonyCents];
  const points: ProjectionPoint[] = [];
  for (let index = 0; index < months; index++) {
    values = values.map((value, scenario) => divRoundHalfUp((value + premise.contributionCents) * factorE6(rates[scenario]!), 1_000_000n));
    points.push({ baseCents: values[0]!, pessimisticCents: values[1]!, optimisticCents: values[2]! });
  }
  return points;
}

/** Fator mensal em e6: 1,0307% → 1_010_307n (1e6 = 1,0). */
function factorE6(ratePct: number): bigint {
  return 1_000_000n + BigInt(Math.round(ratePct * 10_000));
}
