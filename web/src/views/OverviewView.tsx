import { useCallback, useEffect, useState } from "react";
import { ChartPie, Info, TrendDown, TrendUp, WarningCircle } from "@phosphor-icons/react";
import {
  getAllocation, getHistory, getPerformance, getPortfolio,
  type Allocation, type AllocationBy, type HistoryPoint, type Performance, type Portfolio,
} from "../api.ts";
import {
  formataBRL, formataCategoria, formataJanela, formataPercentualSinal, formataPontosPercentuais, mesDeslocado,
} from "../format.ts";
import { ORDEM_CLASSE, ROTULO_CLASSE, classeDe, type Classe } from "../classes.ts";
import { EvolucaoChart } from "../components/EvolucaoChart.tsx";

type Periodo = "1a" | "5a" | "tudo";
const PERIODOS: Array<{ id: Periodo; rotulo: string }> = [
  { id: "1a", rotulo: "1 ano" }, { id: "5a", rotulo: "5 anos" }, { id: "tudo", rotulo: "Tudo" },
];
const ALOCACOES: Array<{ by: AllocationBy; rotulo: string }> = [
  { by: "category", rotulo: "Categoria" }, { by: "broker", rotulo: "Corretora" }, { by: "objective", rotulo: "Objetivo" },
];
type Dados = { portfolio: Portfolio; history: HistoryPoint[]; performance: Performance; performance12m: Performance; allocation: Allocation };

function inicioDoPeriodo(periodo: Periodo, mes: string): string {
  if (periodo === "1a") return mesDeslocado(mes, -11);
  if (periodo === "5a") return mesDeslocado(mes, -59);
  return "2000-01";
}

export function OverviewView({ reloadToken, onAbrirPosicoes }: {
  reloadToken: number;
  onAbrirPosicoes: (classe: Classe) => void;
}) {
  const [periodo, setPeriodo] = useState<Periodo>("1a");
  const [alocacaoBy, setAlocacaoBy] = useState<AllocationBy>("category");
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async (signal: AbortSignal) => {
    try {
      const portfolio = await getPortfolio(signal);
      const mes = portfolio.asOf.slice(0, 7);
      const from = inicioDoPeriodo(periodo, mes);
      const [history, performance, performance12m, allocation] = await Promise.all([
        getHistory(from, mes, signal),
        getPerformance(from, mes, signal),
        getPerformance(mesDeslocado(mes, -11), mes, signal),
        getAllocation(alocacaoBy, signal),
      ]);
      setDados({ portfolio, history, performance, performance12m, allocation });
      setErro(null);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setErro(cause instanceof Error ? cause.message : String(cause));
    }
  }, [periodo, alocacaoBy]);

  useEffect(() => {
    const controller = new AbortController();
    void carregar(controller.signal);
    const id = setInterval(() => void carregar(controller.signal), 5 * 60 * 1000);
    return () => {
      controller.abort();
      clearInterval(id);
    };
  }, [carregar, reloadToken]);

  if (dados === null) {
    return (
      <div className="page">
        <div className="page-head">
          <div>
            <h1 className="page-title">Visão geral</h1>
          </div>
        </div>
        {erro !== null && (
          <div className="callout callout-error" role="alert">
            <WarningCircle size={17} aria-hidden="true" />
            <div><p className="callout-title">Não foi possível carregar</p><p>{erro}</p></div>
          </div>
        )}
      </div>
    );
  }

  const { portfolio, history, performance, performance12m, allocation } = dados;
  const capital = portfolio.totals.investedCents - portfolio.totals.redeemedCents;
  const rendimento = portfolio.totals.marketValueCents - capital;
  const rendimentoPct = capital > 0 ? (rendimento / capital) * 100 : 0;
  const porClasse = ORDEM_CLASSE.map((classe) => {
    const posicoes = portfolio.positions.filter((posicao) => classeDe(posicao) === classe);
    const valor = posicoes.reduce((total, posicao) => total + (posicao.marketValueCents ?? 0), 0);
    return { classe, valor, quantidade: posicoes.length, pct: portfolio.totals.marketValueCents > 0 ? (valor / portfolio.totals.marketValueCents) * 100 : 0 };
  });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Visão geral</h1>
        </div>
      </div>

      {erro !== null && (
        <div className="callout callout-error" role="alert">
          <WarningCircle size={17} aria-hidden="true" />
          <div><p className="callout-title">Falha ao atualizar</p><p>{erro}</p></div>
        </div>
      )}

      <div className="colunas">
        <div className="stack">
          <section className="card">
            <div className="section-head section-head-linha">
              <h2 className="section-title">Posição atual</h2>
              <span className="info">
                <button type="button" className="info-btn" aria-label="Como a posição atual foi calculada">
                  <Info size={16} aria-hidden="true" />
                </button>
                <span className="info-pop" role="tooltip">
                  <span className="info-pop-titulo">Cálculo do rendimento</span>
                  <span className="info-pop-item">
                    <span className="info-pop-rotulo">Capital (aportes − resgates)</span>
                    <span className="info-pop-valor">
                      {formataBRL(portfolio.totals.investedCents)} − {formataBRL(portfolio.totals.redeemedCents)} = {formataBRL(capital)}
                    </span>
                  </span>
                  <span className="info-pop-item">
                    <span className="info-pop-rotulo">Rendimento (patrimônio − capital)</span>
                    <span className="info-pop-valor">
                      {formataBRL(portfolio.totals.marketValueCents)} − {formataBRL(capital)} = {formataBRL(rendimento)}
                    </span>
                  </span>
                  <span className="info-pop-item">
                    <span className="info-pop-rotulo">Rendimento %</span>
                    <span className="info-pop-valor">
                      {formataBRL(rendimento)} ÷ {formataBRL(capital)} = {formataPercentualSinal(rendimentoPct)}
                    </span>
                  </span>
                  <span className="info-pop-nota">Acumulado desde o início da carteira. Para o retorno do período, com cada aporte pesado pelo tempo investido, veja Desempenho no período.</span>
                </span>
              </span>
            </div>
            <div className="delta-linha">
              <p className="stat-value grande">{formataBRL(portfolio.totals.marketValueCents)}</p>
              <span
                className={rendimentoPct >= 0 ? "delta delta-positivo" : "delta delta-negativo"}
                title={`Rendimento de ${formataBRL(rendimento)} desde o início`}
              >
                {rendimentoPct >= 0 ? <TrendUp size={13} aria-hidden="true" /> : <TrendDown size={13} aria-hidden="true" />}
                {formataPercentualSinal(rendimentoPct)} <span className="delta-contexto">desde o início</span>
              </span>
            </div>
          </section>

          <section className="card card-desempenho">
            <div className="section-head section-head-linha">
              <div>
                <h2 className="section-title">Desempenho no período</h2>
                <p className="section-hint">Janela {formataJanela(performance.from, performance.to)}.</p>
              </div>
              <div className="chart-controles">
                {PERIODOS.map((item) => (
                  <button key={item.id} type="button" className={periodo === item.id ? "chip active" : "chip"} onClick={() => setPeriodo(item.id)}>
                    {item.rotulo}
                  </button>
                ))}
              </div>
            </div>
            <div className="grafico-area">
              <EvolucaoChart history={history} performance={performance} altura="100%" resumo={false} />
            </div>
            <div className="sub-bloco">
              <div className="section-head">
                <h3 className="section-title">Meu dinheiro rendeu</h3>
                <p className="section-hint">Cada aporte pesa pelo tempo investido (MWR).</p>
              </div>
              <table className="tabela-comparativa">
                <tbody>
                  <tr>
                    <th scope="row">Carteira</th>
                    <td className="num">{formataPercentualSinal(performance.accumulated.portfolioPct)}</td>
                  </tr>
                  <tr>
                    <th scope="row">CDI</th>
                    <td className="num">{formataPercentualSinal(performance.accumulated.cdiPct)}</td>
                  </tr>
                  <tr>
                    <th scope="row">IPCA</th>
                    <td className="num">{formataPercentualSinal(performance.accumulated.ipcaPct)}</td>
                  </tr>
                  <tr className="linha-destaque">
                    <th scope="row">Diferença vs CDI</th>
                    <td className="num">{formataPontosPercentuais(performance.accumulated.diffCdiPp)}</td>
                  </tr>
                </tbody>
              </table>
              <div className="rodape-notas">
                <span>{performance.monthsBeaten} de {performance.monthsTotal} meses acima do CDI</span>
                <span>MWR {performance.mwr.periodPct === null ? "—" : formataPercentualSinal(performance.mwr.periodPct)}</span>
                <span>12 meses {performance12m.mwr.periodPct === null ? "—" : formataPercentualSinal(performance12m.mwr.periodPct)}</span>
              </div>
            </div>
          </section>
        </div>

        <div className="stack">
          <section className="card">
            <div className="section-head"><h2 className="section-title">Onde está o dinheiro</h2></div>
            <ul className="alloc-list">
              {porClasse.map((bloco) => (
                <li className="alloc-row" key={bloco.classe}>
                  <button type="button" className="alloc-line botao-linha" onClick={() => onAbrirPosicoes(bloco.classe)}>
                    <span className="alloc-name">
                      {ROTULO_CLASSE[bloco.classe]}
                      <span className="alloc-contagem">{bloco.quantidade} {bloco.quantidade === 1 ? "ativo" : "ativos"}</span>
                    </span>
                    <span className="alloc-valores">
                      <span className="alloc-pct">{bloco.pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</span>
                      <span className="alloc-absoluto">{formataBRL(bloco.valor)}</span>
                    </span>
                  </button>
                  <span className="alloc-bar"><span className="alloc-bar-fill" style={{ width: `${Math.min(100, bloco.pct)}%` }} /></span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <div className="section-head">
              <h2 className="section-title">Alocação</h2>
              <div className="chart-controles">
                {ALOCACOES.map((item) => (
                  <button key={item.by} type="button" className={alocacaoBy === item.by ? "chip active" : "chip"} onClick={() => setAlocacaoBy(item.by)}>
                    {item.rotulo}
                  </button>
                ))}
              </div>
            </div>
            {allocation.groups.length === 0 ? (
              <div className="empty"><ChartPie size={22} aria-hidden="true" /><p className="empty-hint">Sem dados de alocação.</p></div>
            ) : (
              <ul className="alloc-list">
                {allocation.groups.map((grupo) => (
                  <li className="alloc-row" key={grupo.key}>
                    <div className="alloc-line">
                      <span className="alloc-name">{alocacaoBy === "category" ? formataCategoria(grupo.key) : grupo.key}</span>
                      <span className="alloc-valores">
                        <span className="alloc-pct">{grupo.pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</span>
                        <span className="alloc-absoluto">{formataBRL(grupo.marketValueCents)}</span>
                      </span>
                    </div>
                    <span className="alloc-bar"><span className="alloc-bar-fill" style={{ width: `${Math.min(100, grupo.pct)}%` }} /></span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
