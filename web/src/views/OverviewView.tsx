import { useCallback, useEffect, useState } from "react";
import { ChartPie, WarningCircle } from "@phosphor-icons/react";
import {
  getAllocation, getHistory, getPerformance, getPortfolio,
  type Allocation, type AllocationBy, type HistoryPoint, type Performance, type Portfolio,
} from "../api.ts";
import {
  formataBRL, formataCategoria, formataData, formataJanela, formataMes, formataPercentual, formataPercentualSinal, formataPontosPercentuais, mesDeslocado,
} from "../format.ts";
import { ORDEM_CLASSE, ROTULO_CLASSE, classeDe, type Classe } from "../classes.ts";
import { type Periodo } from "../periodos.ts";
import { EvolucaoChart } from "../components/EvolucaoChart.tsx";
import { ControlesGrafico, type Aba, type SubAba } from "../components/ControlesGrafico.tsx";
import { Modal } from "../components/Modal.tsx";

const ALOCACOES: Array<{ by: AllocationBy; rotulo: string }> = [
  { by: "category", rotulo: "Categoria" }, { by: "broker", rotulo: "Corretora" }, { by: "objective", rotulo: "Objetivo" },
];
type Detalhe = "capital" | "twr" | "mwr" | "real";
const TITULOS: Record<Detalhe, string> = {
  capital: "Ganho sobre o capital",
  twr: "TWR — retorno ponderado pelo tempo",
  mwr: "MWR — retorno ponderado pelo dinheiro",
  real: "Retorno acima da inflação",
};
type Dados = {
  portfolio: Portfolio; history: HistoryPoint[];
  performance: Performance; performanceTudo: Performance; allocation: Allocation;
};

const INICIO_TUDO = "2000-01";
const OBJETIVO_RESERVA = "Reserva";

function inicioDoPeriodo(periodo: Periodo, mes: string): string {
  if (periodo === "1a") return mesDeslocado(mes, -11);
  if (periodo === "5a") return mesDeslocado(mes, -59);
  return INICIO_TUDO;
}

export function OverviewView({ reloadToken, onAbrirPosicoes }: {
  reloadToken: number;
  onAbrirPosicoes: (classe: Classe | null) => void;
}) {
  const [periodo, setPeriodo] = useState<Periodo>("1a");
  const [aba, setAba] = useState<Aba>("rs");
  const [subAba, setSubAba] = useState<SubAba>("mes");
  const [alocacaoBy, setAlocacaoBy] = useState<AllocationBy>("category");
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<Detalhe | null>(null);

  const carregar = useCallback(async (signal: AbortSignal) => {
    try {
      const portfolio = await getPortfolio(signal);
      const mes = portfolio.asOf.slice(0, 7);
      const from = inicioDoPeriodo(periodo, mes);
      const [history, performance, performanceTudo, allocation] = await Promise.all([
        getHistory(from, mes, signal),
        getPerformance(from, mes, signal),
        getPerformance(INICIO_TUDO, mes, signal),
        getAllocation(alocacaoBy, signal),
      ]);
      setDados({ portfolio, history, performance, performanceTudo, allocation });
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

  const { portfolio, history, performance, performanceTudo, allocation } = dados;
  const capital = portfolio.totals.investedCents - portfolio.totals.redeemedCents;
  const rendimento = portfolio.totals.marketValueCents - capital;
  const rendimentoPct = capital > 0 ? (rendimento / capital) * 100 : 0;
  const porClasse = ORDEM_CLASSE.map((classe) => {
    const posicoes = portfolio.positions.filter((posicao) => classeDe(posicao) === classe);
    const valor = posicoes.reduce((total, posicao) => total + (posicao.marketValueCents ?? 0), 0);
    return { classe, valor, quantidade: posicoes.length, pct: portfolio.totals.marketValueCents > 0 ? (valor / portfolio.totals.marketValueCents) * 100 : 0 };
  });
  const posicoesReserva = portfolio.positions.filter((posicao) => posicao.objective === OBJETIVO_RESERVA);
  const reservaCents = posicoesReserva.reduce((total, posicao) => total + (posicao.marketValueCents ?? 0), 0);
  const reservaPct = portfolio.totals.marketValueCents > 0 ? (reservaCents / portfolio.totals.marketValueCents) * 100 : 0;
  const mwrPct = performanceTudo.mwr.periodPct;
  const ultimoMesIpca = [...performanceTudo.months].reverse().find((mes) => mes.ipcaPct !== null)?.month;
  const rotuloIpca = ultimoMesIpca === undefined ? "IPCA do período" : `IPCA do período (até ${formataMes(ultimoMesIpca)})`;
  const metricas: Array<{ id: Detalhe; rotulo: string; valor: number | null; dica: string }> = [
    { id: "capital", rotulo: "Sobre o capital", valor: rendimentoPct, dica: "Ganho desde o início ÷ capital (aportes − resgates). Não considera o tempo de cada aporte." },
    { id: "twr", rotulo: "TWR (desde o início)", valor: performanceTudo.accumulated.portfolioPct, dica: "Retorno ponderado pelo tempo desde o início: ignora aportes e resgates; comparável com CDI e IPCA." },
    { id: "mwr", rotulo: "MWR (desde o início)", valor: mwrPct, dica: "Retorno ponderado pelo dinheiro desde o início: considera quando e quanto você aportou; é o ganho real do seu bolso." },
    { id: "real", rotulo: "Acima da inflação", valor: performanceTudo.accumulated.realPct, dica: `Retorno real: o TWR descontada a inflação do período (${rotuloIpca.toLowerCase()}).` },
  ];
  const somaAportes = performanceTudo.months.reduce((total, mes) => total + mes.investedCents, 0);
  const somaResgates = performanceTudo.months.reduce((total, mes) => total + mes.redeemedCents, 0);

  const vencidos = portfolio.positions.filter((posicao) => posicao.pendingRedemption);
  const totalVencido = vencidos.reduce((soma, posicao) => soma + (posicao.marketValueCents ?? 0), 0);
  const vencimentoMaisAntigo = vencidos.reduce<string | null>((maisAntigo, posicao) => {
    if (posicao.maturityDate === null) return maisAntigo;
    return maisAntigo === null || posicao.maturityDate < maisAntigo ? posicao.maturityDate : maisAntigo;
  }, null);

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

      {vencidos.length > 0 && (
        <div className="callout callout-warn" role="status">
          <WarningCircle size={17} aria-hidden="true" />
          <div>
            <p className="callout-title">
              {vencidos.length === 1 ? "1 título vencido sem resgate lançado" : `${vencidos.length} títulos vencidos sem resgate lançado`}
            </p>
            <p>
              {formataBRL(totalVencido)} congelados desde {vencimentoMaisAntigo === null ? "o vencimento" : formataData(vencimentoMaisAntigo)}.
              Lance o resgate para zerar a posição.
            </p>
          </div>
          <button type="button" className="btn btn-secondary callout-acao" onClick={() => onAbrirPosicoes(null)}>
            Ver posições
          </button>
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
                <p className="section-hint">{formataJanela(performance.from, performance.to)}.</p>
              </div>
              <ControlesGrafico aba={aba} onAba={setAba} subAba={subAba} onSubAba={setSubAba}
                periodo={periodo} onPeriodo={setPeriodo} trimestral={performance.months.length > 24} />
            </div>
            <div className="grafico-area">
              <EvolucaoChart history={history} performance={performance} altura="100%" resumo={false} aba={aba} subAba={subAba} />
            </div>
          </section>
        </div>

        <div className="stack">
          {posicoesReserva.length > 0 && (
            <section className="card">
              <div className="section-head"><h2 className="section-title">Reserva de emergência</h2></div>
              <p className="reserva-valor">{formataBRL(reservaCents)}</p>
              <p className="reserva-sub">
                {reservaPct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% do patrimônio · {posicoesReserva.length} {posicoesReserva.length === 1 ? "ativo" : "ativos"}
              </p>
              <span className="alloc-bar"><span className="alloc-bar-fill" style={{ width: `${Math.min(100, reservaPct)}%` }} /></span>
            </section>
          )}

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
            <p className="info-pop-texto">Desde o início ({formataJanela(performanceTudo.from, performanceTudo.to)}). Encadeia o retorno de cada mês (juros compostos) e ignora aportes e resgates: cada aporte/resgate pesa pelos dias em que ficou investido no mês. Mede a qualidade da estratégia e é o número justo para comparar com CDI, IPCA e outros fundos.</p>
            <div className="modal-numeros">
              <span>Carteira <strong>{formataPercentualSinal(performanceTudo.accumulated.portfolioPct)}</strong></span>
              <span>CDI <strong>{formataPercentualSinal(performanceTudo.accumulated.cdiPct)}</strong></span>
              <span>IPCA <strong>{formataPercentualSinal(performanceTudo.accumulated.ipcaPct)}</strong></span>
              <span>{performanceTudo.monthsBeaten} de {performanceTudo.monthsTotal} meses acima do CDI</span>
            </div>
            <table className="tabela-modal">
              <thead>
                <tr><th scope="col">Mês</th><th scope="col" className="num">Carteira</th><th scope="col" className="num">CDI</th><th scope="col" className="num">IPCA</th></tr>
              </thead>
              <tbody>
                {[...performanceTudo.months].reverse().map((mes) => (
                  <tr key={mes.month}>
                    <td>{formataMes(mes.month)}</td>
                    <td className="num">{mes.portfolioPct === null ? "—" : formataPercentualSinal(mes.portfolioPct)}</td>
                    <td className="num">{mes.cdiPct === null ? "—" : formataPercentualSinal(mes.cdiPct)}</td>
                    <td className="num">{mes.ipcaPct === null ? "—" : formataPercentualSinal(mes.ipcaPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {detalhe === "mwr" && (
          <div className="modal-conteudo">
            <p className="info-pop-texto">Desde o início ({formataJanela(performanceTudo.from, performanceTudo.to)}). É a TIR (taxa interna de retorno) dos fluxos datados: cada aporte é uma saída de caixa e cada resgate uma entrada, na data em que aconteceram, e o patrimônio no fim é o valor de volta. Dá mais peso aos momentos em que você colocou mais dinheiro — é o ganho real do seu bolso.</p>
            <div className="info-pop-item">
              <span className="info-pop-rotulo">Aportes desde o início</span>
              <span className="info-pop-valor">{formataBRL(somaAportes)}</span>
            </div>
            <div className="info-pop-item">
              <span className="info-pop-rotulo">Resgates desde o início</span>
              <span className="info-pop-valor">{formataBRL(somaResgates)}</span>
            </div>
            <div className="info-pop-item">
              <span className="info-pop-rotulo">Patrimônio hoje</span>
              <span className="info-pop-valor">{formataBRL(portfolio.totals.marketValueCents)}</span>
            </div>
            <div className="info-pop-item">
              <span className="info-pop-rotulo">MWR (TIR desde o início)</span>
              <span className="info-pop-valor">{mwrPct === null ? "—" : `${formataPercentualSinal(mwrPct)} em ${performanceTudo.mwr.months} meses`}</span>
            </div>
            <p className="info-pop-nota">O TWR ({formataPercentualSinal(performanceTudo.accumulated.portfolioPct)}) mostra se a estratégia foi bem; o MWR mostra o que o seu dinheiro ganhou de fato.</p>
          </div>
        )}

        {detalhe === "real" && (
          <div className="modal-conteudo">
            <p className="info-pop-texto">Desde o início ({formataJanela(performanceTudo.from, performanceTudo.to)}). É o retorno real: o TWR (sem efeito dos aportes) descontada a inflação do período — quanto o dinheiro ganhou de poder de compra.</p>
            <div className="info-pop-item">
              <span className="info-pop-rotulo">TWR do período</span>
              <span className="info-pop-valor">{formataPercentualSinal(performanceTudo.accumulated.portfolioPct)}</span>
            </div>
            <div className="info-pop-item">
              <span className="info-pop-rotulo">{rotuloIpca}</span>
              <span className="info-pop-valor">{formataPercentualSinal(performanceTudo.accumulated.ipcaPct)}</span>
            </div>
            <div className="info-pop-item">
              <span className="info-pop-rotulo">Retorno acima da inflação</span>
              <span className="info-pop-valor">
                (1 + {formataPercentual(performanceTudo.accumulated.portfolioPct)}) ÷ (1 + {formataPercentual(performanceTudo.accumulated.ipcaPct)}) − 1 = {formataPercentualSinal(performanceTudo.accumulated.realPct)}
              </span>
            </div>
            <p className="info-pop-nota">Diferença em pontos percentuais: {formataPontosPercentuais(performanceTudo.accumulated.diffIpcaPp)} — o retorno real é menor porque a inflação incide sobre o valor já corrigido (juros compostos).</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
