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

/** Investidor normalizado; nulo ou vazio vira "sem investidor". */
export function investidorDe(posicao: Pick<PortfolioPosition, "investor">): string {
  const valor = (posicao.investor ?? "").trim();
  return valor === "" ? "sem investidor" : valor;
}

export type GrupoPosicoes = {
  chave: string;
  nome: string;
  investidores: string[];
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

/** Chave de agrupamento: nome normalizado (investidor fica no detalhamento). */
export function chaveDoGrupo(posicao: Pick<PortfolioPosition, "name">): string {
  return posicao.name.trim().toLowerCase();
}

/** Ordena por vencimento, do mais recente para o mais antigo (sem vencimento ao final). */
function porVencimentoDesc(a: PortfolioPosition, b: PortfolioPosition): number {
  if (a.maturityDate === b.maturityDate) return 0;
  if (a.maturityDate === null) return 1;
  if (b.maturityDate === null) return -1;
  return a.maturityDate < b.maturityDate ? 1 : -1;
}

/** Agrupa posições por nome; membros pelo vencimento mais recente primeiro. */
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

/** Data de vencimento comum a todos os membros com data; null se não houver ou se houver mais de uma. */
export function vencimentoComum(membros: PortfolioPosition[]): string | null {
  const datas = [...new Set(membros.map((membro) => membro.maturityDate).filter((data): data is string => data !== null))];
  return datas.length === 1 ? datas[0] : null;
}

type SomatorioMembros = {
  valorCents: number;
  semValor: boolean;
  capitalCents: number;
  resultadoRealizadoCents: number;
  rendimentoCents: number | null;
  rendimentoPct: number | null;
};

function somarMembros(membros: PortfolioPosition[]): SomatorioMembros {
  const semValor = membros.every((posicao) => posicao.marketValueCents === null);
  const valorCents = membros.reduce((soma, posicao) => soma + (posicao.marketValueCents ?? 0), 0);
  const capitalCents = membros.reduce((soma, posicao) => soma + capitalDe(posicao), 0);
  const resultadoRealizadoCents = membros.reduce((soma, posicao) => soma + resultadoRealizadoDe(posicao), 0);
  const rendimentoCents = semValor
    ? null
    : membros.reduce((soma, posicao) => soma + (rendimentoDe(posicao).cents ?? 0), 0);
  const rendimentoPct = rendimentoCents === null || capitalCents <= 0 ? null : (rendimentoCents / capitalCents) * 100;
  return { valorCents, semValor, capitalCents, resultadoRealizadoCents, rendimentoCents, rendimentoPct };
}

const distintos = (valores: Array<string | null>): string[] =>
  [...new Set(valores.filter((valor): valor is string => valor !== null && valor !== ""))].sort();

function agregarGrupo(chave: string, membros: PortfolioPosition[]): GrupoPosicoes {
  const ordenados = [...membros].sort(porVencimentoDesc);
  return {
    chave,
    nome: ordenados[0].name,
    investidores: distintos(ordenados.map(investidorDe)),
    membros: ordenados,
    ...somarMembros(ordenados),
    stale: ordenados.some((posicao) => posicao.stale),
    pendente: ordenados.some((posicao) => posicao.pendingRedemption),
    brokers: distintos(ordenados.map((posicao) => posicao.broker)),
    objetivos: distintos(ordenados.map((posicao) => posicao.objective)),
  };
}

export type SecaoInvestidor = SomatorioMembros & {
  investidor: string;
  membros: PortfolioPosition[];
};

/** Seções por investidor (valor ↓, nome como desempate); nulos/vazios em "sem investidor". */
export function secoesPorInvestidor(membros: PortfolioPosition[]): SecaoInvestidor[] {
  const mapa = new Map<string, PortfolioPosition[]>();
  for (const posicao of membros) {
    const investidor = investidorDe(posicao);
    const daSecao = mapa.get(investidor);
    if (daSecao === undefined) mapa.set(investidor, [posicao]);
    else daSecao.push(posicao);
  }
  return [...mapa.entries()]
    .map(([investidor, doInvestidor]) => ({
      investidor,
      membros: [...doInvestidor].sort(porVencimentoDesc),
      ...somarMembros(doInvestidor),
    }))
    .sort((a, b) => b.valorCents - a.valorCents || a.investidor.localeCompare(b.investidor, "pt-BR"));
}
