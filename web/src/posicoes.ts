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

export type GrupoPosicoes = {
  chave: string;
  nome: string;
  investidor: string | null;
  membros: PortfolioPosition[];
  valorCents: number;
  semValor: boolean;
  capitalCents: number;
  resultadoRealizadoCents: number;
  rendimentoCents: number | null;
  rendimentoPct: number | null;
  stale: boolean;
  pendente: boolean;
  brokers: string[];
  objetivos: string[];
};

/** Chave de agrupamento: nome normalizado + investidor (nulos/vazios agrupam juntos). */
export function chaveDoGrupo(posicao: Pick<PortfolioPosition, "name" | "investor">): string {
  return `${posicao.name.trim().toLowerCase()}|${posicao.investor ?? ""}`;
}

/** Agrupa posições por nome + investidor; membros em valor ↓ dentro do grupo. */
export function agruparPosicoes(posicoes: PortfolioPosition[]): GrupoPosicoes[] {
  const mapa = new Map<string, PortfolioPosition[]>();
  for (const posicao of posicoes) {
    const chave = chaveDoGrupo(posicao);
    const membros = mapa.get(chave);
    if (membros === undefined) mapa.set(chave, [posicao]);
    else membros.push(posicao);
  }
  return [...mapa.entries()].map(([chave, membros]) => agregarGrupo(chave, membros));
}

function agregarGrupo(chave: string, membros: PortfolioPosition[]): GrupoPosicoes {
  const ordenados = [...membros].sort((a, b) => (b.marketValueCents ?? 0) - (a.marketValueCents ?? 0));
  const semValor = ordenados.every((posicao) => posicao.marketValueCents === null);
  const valorCents = ordenados.reduce((soma, posicao) => soma + (posicao.marketValueCents ?? 0), 0);
  const capitalCents = ordenados.reduce((soma, posicao) => soma + capitalDe(posicao), 0);
  const resultadoRealizadoCents = ordenados.reduce((soma, posicao) => soma + resultadoRealizadoDe(posicao), 0);
  const rendimentoCents = semValor
    ? null
    : ordenados.reduce((soma, posicao) => soma + (rendimentoDe(posicao).cents ?? 0), 0);
  const rendimentoPct = rendimentoCents === null || capitalCents <= 0 ? null : (rendimentoCents / capitalCents) * 100;
  const distintos = (valores: Array<string | null>): string[] =>
    [...new Set(valores.filter((valor): valor is string => valor !== null && valor !== ""))].sort();
  return {
    chave,
    nome: ordenados[0].name,
    investidor: ordenados[0].investor,
    membros: ordenados,
    valorCents,
    semValor,
    capitalCents,
    resultadoRealizadoCents,
    rendimentoCents,
    rendimentoPct,
    stale: ordenados.some((posicao) => posicao.stale),
    pendente: ordenados.some((posicao) => posicao.pendingRedemption),
    brokers: distintos(ordenados.map((posicao) => posicao.broker)),
    objetivos: distintos(ordenados.map((posicao) => posicao.objective)),
  };
}
