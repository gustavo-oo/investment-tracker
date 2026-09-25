import type { HistoryPoint, Performance, PerformanceMonth } from "../api.ts";

export type Mes = PerformanceMonth & { patrimonioCents: number };

export function mesesDe(history: HistoryPoint[], performance: Performance): Mes[] {
  const patrimonioPorMes = new Map(history.map((ponto) => [ponto.month, ponto.marketValueCents]));
  return performance.months.map((mes) => ({ ...mes, patrimonioCents: patrimonioPorMes.get(mes.month) ?? 0 }));
}

export const rotuloTrimestre = (mes: string): string => {
  const [ano = "0000", mesNumero = "01"] = mes.split("-");
  return `T${Math.ceil(Number(mesNumero) / 3)}/${ano.slice(2)}`;
};

export const formataEixoRs = (cents: number): string => {
  const reais = cents / 100;
  const sinal = reais < 0 ? "−" : "";
  const abs = Math.abs(reais);
  if (abs >= 1_000_000) return `${sinal}R$ ${(abs / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (abs >= 1_000) return `${sinal}R$ ${Math.round(abs / 1_000).toLocaleString("pt-BR")} mil`;
  return `${sinal}R$ ${abs.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
};

export const formataEixoPct = (valor: number): string =>
  `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

export const acumula = (pcts: Array<number | null>): number => {
  let fator = 1;
  for (const pct of pcts) if (pct !== null) fator *= 1 + pct / 100;
  return Math.round((fator - 1) * 1_000_000) / 10_000;
};

/** Desvios verticais (px) para rótulos finais próximos: agrupa valores a menos de 1,5 p.p. e empilha cada grupo com passo de 14 px. */
export function deslocamentosRotulos(valores: number[], limitePp = 1.5, passo = 14): number[] {
  const ordem = valores.map((valor, indice) => ({ valor, indice })).sort((a, b) => b.valor - a.valor);
  const desvios = valores.map(() => 0);
  let inicio = 0;
  while (inicio < ordem.length) {
    let fim = inicio + 1;
    while (fim < ordem.length && ordem[fim - 1]!.valor - ordem[fim]!.valor < limitePp) fim++;
    const tamanho = fim - inicio;
    for (let posicao = 0; posicao < tamanho; posicao++) {
      desvios[ordem[inicio + posicao]!.indice] = (posicao - (tamanho - 1) / 2) * passo;
    }
    inicio = fim;
  }
  return desvios;
}

export function SemHistorico() {
  return (
    <div className="empty">
      <p className="empty-title">Sem histórico suficiente</p>
      <p className="empty-hint">A evolução aparece quando houver cotações e índices no período.</p>
    </div>
  );
}
