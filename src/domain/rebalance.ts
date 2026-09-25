import { divRoundHalfUp, MULTIPLIER_SCALE } from "./money.ts";

export type RebalanceGroupKey = "rf" | "rv";

export type RebalanceInput = {
  valuesCents: Record<RebalanceGroupKey, bigint>;
  targetsE6: Record<RebalanceGroupKey, bigint>;
  amountCents: bigint;
};

export type RebalanceGroup = {
  key: RebalanceGroupKey;
  valueCents: bigint;
  targetE6: bigint;
  pctBefore: number;
  suggestedCents: bigint;
  afterValueCents: bigint;
  pctAfter: number;
  aboveTarget: boolean;
};

export type RebalanceResult = {
  baseCents: bigint;
  amountCents: bigint;
  totalCents: bigint;
  groups: RebalanceGroup[];
};

function pctOf(valueCents: bigint, totalCents: bigint): number {
  if (totalCents === 0n) return 0;
  return Number(divRoundHalfUp(valueCents * 10_000n, totalCents)) / 100;
}

/**
 * Water-filling do legado (max(D - tau, 0)) para 2 grupos: com ambos abaixo da
 * meta, cada um recebe a propria demanda; com um acima, ele recebe zero e o
 * aporte inteiro vai para o outro. Sem vender, nunca ultrapassa a meta.
 */
export function rebalance(input: RebalanceInput): RebalanceResult {
  const baseCents = input.valuesCents.rf + input.valuesCents.rv;
  const totalCents = baseCents + input.amountCents;
  const rfTargetCents = divRoundHalfUp(input.targetsE6.rf * totalCents, MULTIPLIER_SCALE);
  const rvTargetCents = totalCents - rfTargetCents;
  const demand: Record<RebalanceGroupKey, bigint> = {
    rf: rfTargetCents - input.valuesCents.rf,
    rv: rvTargetCents - input.valuesCents.rv,
  };
  const suggested: Record<RebalanceGroupKey, bigint> = { rf: 0n, rv: 0n };
  if (demand.rf >= 0n && demand.rv >= 0n) {
    suggested.rf = demand.rf;
    suggested.rv = demand.rv;
  } else if (demand.rf < 0n) {
    suggested.rv = input.amountCents;
  } else {
    suggested.rf = input.amountCents;
  }
  const groups = (["rf", "rv"] as const).map((key): RebalanceGroup => {
    const afterValueCents = input.valuesCents[key] + suggested[key];
    return {
      key,
      valueCents: input.valuesCents[key],
      targetE6: input.targetsE6[key],
      pctBefore: pctOf(input.valuesCents[key], baseCents),
      suggestedCents: suggested[key],
      afterValueCents,
      pctAfter: pctOf(afterValueCents, totalCents),
      aboveTarget: demand[key] < 0n,
    };
  });
  return { baseCents, amountCents: input.amountCents, totalCents, groups };
}
