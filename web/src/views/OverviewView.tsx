import { useCallback, useEffect, useState } from "react";
import { ChartPie, WarningCircle } from "@phosphor-icons/react";
import {
  getAllocation, getHistory, getPerformance, getPortfolio,
  type Allocation, type AllocationBy, type HistoryPoint, type Performance, type Portfolio,
} from "../api.ts";
import {
  formataBRL, formataCategoria, formataJanela, formataMes, formataPercentualSinal, formataPontosPercentuais, mesDeslocado,
} from "../format.ts";
import { ORDEM_CLASSE, ROTULO_CLASSE, classeDe, type Classe } from "../classes.ts";
import { EvolucaoChart } from "../components/EvolucaoChart.tsx";
import { ExplicacaoRendimentos } from "../components/InfoPopover.tsx";
import { Modal } from "../components/Modal.tsx";

type Periodo = "1a" | "5a" | "tudo";
const PERIODOS: Array<{ id: Periodo; rotulo: string }> = [
  { id: "1a", rotulo: "1 ano" }, { id: "5a", rotulo: "5 anos" }, { id: "tudo", rotulo: "Tudo" },
];
const ALOCACOES: Array<{ by: AllocationBy; rotulo: string }> = [
  { by: "category", rotulo: "Categoria" }, { by: "broker", rotulo: "Corretora" }, { by: "objective", rotulo: "Objetivo" },
];
type Detalhe = "capital" | "twr" | "mwr";
const TITULOS: Record<Detalhe, string> = {
  capital: "Ganho sobre o capital",
  twr: "TWR — retorno ponderado pelo tempo",
  mwr: "MWR — retorno ponderado pelo dinheiro",
};
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
  const [detalhe, setDetalhe] = useState<Detalhe | null>(null);

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
  const mwrPct = performance.mwr.periodPct;
  const comparativo = [
    { rotulo: "Carteira (TWR)", valor: performance.accumulated.portfolioPct },
    { rotulo: "CDI", valor: performance.accumulated.cdiPct },
    { rotulo: "IPCA", valor: performance.accumulated.ipcaPct },
  ];
  const maiorAbs = Math.max(...comparativo.map((linha) => Math.abs(linha.valor)), 1);
  const metricas: Array<{ id: Detalhe; rotulo: string; valor: number | null; dica: string }> = [
    { id: "capital", rotulo: "Sobre o capital", valor: rendimentoPct, dica: "Ganho desde o início ÷ capital (aportes − resgates). Não considera o tempo de cada aporte." },
    { id: "twr", rotulo: "TWR (período)", valor: performance.accumulated.portfolioPct, dica: "Retorno ponderado pelo tempo: ignora aportes e resgates; comparável com CDI e IPCA." },
    { id: "mwr", rotulo: "MWR (período)", valor: mwrPct, dica: "Retorno ponderado pelo dinheiro: considera quando e quanto você aportou; é o ganho real do seu bolso." },
  ];
  const somaAportes = performance.months.reduce((total, mes) => total + mes.investedCents, 0);
  const somaResgates = performance.months.reduce((total, mes) => total + mes.redeemedCents, 0);

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
            <div className="section-head">
              <h2 className="section-title">Posição atual</h2>
            </div>
            <p className="stat-value grande">{formataBRL(portfolio.totals.marketValueCents)}</p>
            <div className="metricas">
              {metricas.map((metrica) => (
                <button key={metrica.id} type="button" className="metrica" title={metrica.dica} onClick={() => setDetalhe(metrica.id)}>
                  <span className="metrica-rotulo">{metrica.rotulo}</span>
                  <span className={metrica.valor === null ? "metrica-valor" : metrica.valor >= 0 ? "metrica-valor rendimento-positivo" : "metrica-valor rendimento-negativo"}>
                    {metrica.valor === null ? "—" : formataPercentualSinal(metrica.valor)}
                  </span>
                </button>
              ))}
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

      <section className="card card-rendimento">
        <div className="section-head section-head-linha">
          <div>
            <h2 className="section-title">Meu dinheiro rendeu</h2>
            <p className="section-hint">Janela {formataJanela(performance.from, performance.to)}.</p>
          </div>
          <ExplicacaoRendimentos />
        </div>

        <div className="rendimento-grid">
          <div className={mwrPct !== null && mwrPct < 0 ? "rendimento-real rendimento-real-negativo" : "rendimento-real"}>
            <span className="stat-label">Seu rendimento real (MWR)</span>
            <span className={mwrPct === null ? "stat-value" : mwrPct >= 0 ? "stat-value rendimento-positivo" : "stat-value rendimento-negativo"}>
              {mwrPct === null ? "—" : formataPercentualSinal(mwrPct)}
            </span>
            <span className="stat-note">considera quando e quanto você aportou ou resgatou</span>
          </div>

          <div className="comparativo">
            <span className="stat-label">Comparação com o mercado (TWR)</span>
            <span className="stat-note">ignora aportes e resgates — mede a estratégia</span>
            <table className="tabela-comparativa">
              <tbody>
                {comparativo.map((linha) => (
                  <tr key={linha.rotulo}>
                    <th scope="row">{linha.rotulo}</th>
                    <td className="barra">
                      <span className="comp-bar">
                        <span
                          className={linha.valor >= 0 ? "comp-bar-fill" : "comp-bar-fill negativa"}
                          style={{ width: `${(Math.abs(linha.valor) / maiorAbs) * 100}%` }}
                        />
                      </span>
                    </td>
                    <td className="num">{formataPercentualSinal(linha.valor)}</td>
                  </tr>
                ))}
                <tr className="linha-destaque">
                  <th scope="row">Diferença vs CDI</th>
                  <td className="barra" />
                  <td className="num">{formataPontosPercentuais(performance.accumulated.diffCdiPp)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="rodape-notas">
          <span>{performance.monthsBeaten} de {performance.monthsTotal} meses acima do CDI</span>
          {performance12m.from !== performance.from && (
            <span>MWR 12 meses {performance12m.mwr.periodPct === null ? "—" : formataPercentualSinal(performance12m.mwr.periodPct)}</span>
          )}
        </div>
      </section>

      <Modal aberto={detalhe !== null} titulo={detalhe === null ? "" : TITULOS[detalhe]} onFechar={() => setDetalhe(null)}>
        {detalhe === "capital" && (
          <div className="modal-conteudo">
            <p className="info-pop-texto">Desde o início da carteira até {portfolio.asOf}: quanto o total que você colocou cresceu. Não considera o tempo de cada aporte — um aporte recente pesa igual a um antigo, por isso não é comparável com CDI/IPCA.</p>
            <div className="info-pop-item">
              <span className="info-pop-rotulo">Capital (aportes − resgates)</span>
              <span className="info-pop-valor">
                {formataBRL(portfolio.totals.investedCents)} − {formataBRL(portfolio.totals.redeemedCents)} = {formataBRL(capital)}
              </span>
            </div>
            <div className="info-pop-item">
              <span className="info-pop-rotulo">Rendimento (patrimônio − capital)</span>
              <span className="info-pop-valor">
                {formataBRL(portfolio.totals.marketValueCents)} − {formataBRL(capital)} = {formataBRL(rendimento)}
              </span>
            </div>
            <div className="info-pop-item">
              <span className="info-pop-rotulo">Ganho sobre o capital</span>
              <span className="info-pop-valor">
                {formataBRL(rendimento)} ÷ {formataBRL(capital)} = {formataPercentualSinal(rendimentoPct)}
              </span>
            </div>
            <p className="info-pop-nota">Para saber se a estratégia foi bem (comparável a CDI/IPCA), use o TWR. Para o ganho real do seu bolso, use o MWR.</p>
          </div>
        )}

        {detalhe === "twr" && (
          <div className="modal-conteudo">
            <p className="info-pop-texto">Janela {formataJanela(performance.from, performance.to)}. Encadeia o retorno de cada mês (juros compostos) e ignora aportes e resgates. Mede a qualidade da estratégia e é o número justo para comparar com CDI, IPCA e outros fundos.</p>
            <div className="modal-numeros">
              <span>Carteira <strong>{formataPercentualSinal(performance.accumulated.portfolioPct)}</strong></span>
              <span>CDI <strong>{formataPercentualSinal(performance.accumulated.cdiPct)}</strong></span>
              <span>IPCA <strong>{formataPercentualSinal(performance.accumulated.ipcaPct)}</strong></span>
              <span>{performance.monthsBeaten} de {performance.monthsTotal} meses acima do CDI</span>
            </div>
            <table className="tabela-modal">
              <thead>
                <tr><th scope="col">Mês</th><th scope="col" className="num">Carteira</th><th scope="col" className="num">CDI</th></tr>
              </thead>
              <tbody>
                {performance.months.map((mes) => (
                  <tr key={mes.month}>
                    <td>{formataMes(mes.month)}</td>
                    <td className="num">{mes.portfolioPct === null ? "—" : formataPercentualSinal(mes.portfolioPct)}</td>
                    <td className="num">{mes.cdiPct === null ? "—" : formataPercentualSinal(mes.cdiPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {detalhe === "mwr" && (
          <div className="modal-conteudo">
            <p className="info-pop-texto">Janela {formataJanela(performance.from, performance.to)}. É a TIR (taxa interna de retorno) dos fluxos: cada aporte é uma saída de caixa, cada resgate uma entrada, e o patrimônio no fim é o valor de volta. Dá mais peso aos momentos em que você colocou mais dinheiro — é o ganho real do seu bolso.</p>
            <div className="info-pop-item">
              <span className="info-pop-rotulo">Aportes na janela</span>
              <span className="info-pop-valor">{formataBRL(somaAportes)}</span>
            </div>
            <div className="info-pop-item">
              <span className="info-pop-rotulo">Resgates na janela</span>
              <span className="info-pop-valor">{formataBRL(somaResgates)}</span>
            </div>
            <div className="info-pop-item">
              <span className="info-pop-rotulo">Patrimônio no fim da janela</span>
              <span className="info-pop-valor">{formataBRL(portfolio.totals.marketValueCents)}</span>
            </div>
            <div className="info-pop-item">
              <span className="info-pop-rotulo">MWR (TIR da janela)</span>
              <span className="info-pop-valor">{mwrPct === null ? "—" : `${formataPercentualSinal(mwrPct)} em ${performance.mwr.months} meses`}</span>
            </div>
            <p className="info-pop-nota">O TWR ({formataPercentualSinal(performance.accumulated.portfolioPct)}) mostra se a estratégia foi bem; o MWR mostra o que o seu dinheiro ganhou de fato.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
