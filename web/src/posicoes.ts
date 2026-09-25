import type { PortfolioPosition } from "./api.ts";

/** Capital aportado (compras − resgates) em centavos. */
export function capitalDe(posicao: Pick<PortfolioPosition, "investedCents" | "redeemedCents">): number {
  return posicao.investedCents - posicao.redeemedCents;
}

/** Rendimento da posição: valor de mercado − capital; null quando não há cotação ou capital ≤ 0. */
export function rendimentoDe(posicao: PortfolioPosition): { cents: number | null; pct: number | null } {
  if (posicao.marketValueCents === null) return { cents: null, pct: null };
  const capital = capitalDe(posicao);
  const cents = posicao.marketValueCents - capital;
  return { cents, pct: capital > 0 ? (cents / capital) * 100 : null };
}

/** Resultado realizado de posição encerrada: resgates − aportes (pode ser negativo). */
export function resultadoRealizadoDe(posicao: Pick<PortfolioPosition, "investedCents" | "redeemedCents">): number {
  return posicao.redeemedCents - posicao.investedCents;
}

/** Participação no total em %; null sem valor de mercado ou sem total. */
export function participacaoPct(valorCents: number | null, totalCents: number): number | null {
  if (valorCents === null || totalCents <= 0) return null;
  return (valorCents / totalCents) * 100;
}
