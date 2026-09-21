import { useCallback, useEffect, useState } from "react";
import { ChartPie, Coins, WarningCircle } from "@phosphor-icons/react";
import {
  getAllocation, getHealth, getHistory, getPerformance, getPortfolio,
  type Allocation, type AllocationBy, type Health, type HistoryPoint, type Performance, type Portfolio, type PortfolioPosition,
} from "../api.ts";
import { formataBRL, formataCategoria, formataJanela, formataPercentualSinal, mesDeslocado } from "../format.ts";
import { EvolucaoChart } from "../components/EvolucaoChart.tsx";

type Periodo = "1a" | "5a" | "tudo";
const PERIODOS: Array<{ id: Periodo; rotulo: string }> = [
  { id: "1a", rotulo: "1 ano" }, { id: "5a", rotulo: "5 anos" }, { id: "tudo", rotulo: "Tudo" },
];
const ALOCACOES: Array<{ by: AllocationBy; rotulo: string }> = [
  { by: "category", rotulo: "Categoria" }, { by: "broker", rotulo: "Corretora" }, { by: "objective", rotulo: "Objetivo" },
];
const NOMES_KIND: Record<string, string> = { fixed_income: "Renda fixa", equity: "Renda variável", pension: "Previdência" };
const ORDEM_KIND: Array<PortfolioPosition["kind"]> = ["fixed_income", "equity", "pension"];

type Dados = { portfolio: Portfolio; history: HistoryPoint[]; performance: Performance; performance12m: Performance; allocation: Allocation; health: Health };

function inicioDoPeriodo(periodo: Periodo, mes: string): string {
  if (periodo === "1a") return mesDeslocado(mes, -11);
  if (periodo === "5a") return mesDeslocado(mes, -59);
  return "2000-01";
}

export function OverviewView({ reloadToken, onAbrirPosicoes, onAbrirFontes }: {
  reloadToken: number;
  onAbrirPosicoes: (kind: PortfolioPosition["kind"]) => void;
  onAbrirFontes: () => void;
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
      const [history, performance, performance12m, allocation, health] = await Promise.all([
        getHistory(from, mes, signal),
        getPerformance(from, mes, signal),
        getPerformance(mesDeslocado(mes, -11), mes, signal),
        getAllocation(alocacaoBy, signal),
        getHealth(signal),
      ]);
      setDados({ portfolio, history, performance, performance12m, allocation, health });
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
            <p className="page-sub">Patrimônio, evolução, alocação e fontes.</p>
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

  const { portfolio, history, performance, performance12m, allocation, health } = dados;
  const capital = portfolio.totals.investedCents - portfolio.totals.redeemedCents;
  const rendimento = portfolio.totals.marketValueCents - capital;
  const rendimentoPct = capital > 0 ? (rendimento / capital) * 100 : 0;
  const porKind = ORDEM_KIND.map((kind) => {
    const posicoes = portfolio.positions.filter((posicao) => posicao.kind === kind);
    const valor = posicoes.reduce((total, posicao) => total + (posicao.marketValueCents ?? 0), 0);
    return { kind, valor, quantidade: posicoes.length, pct: portfolio.totals.marketValueCents > 0 ? (valor / portfolio.totals.marketValueCents) * 100 : 0 };
  });
  const stale = health.sources.filter((source) => source.stale).length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Visão geral</h1>
          <p className="page-sub">Posição em {portfolio.asOf}, com a última cotação disponível de cada fonte.</p>
        </div>
        <div className="page-head-actions">
          <div className="chart-controles">
            {PERIODOS.map((item) => (
              <button key={item.id} type="button" className={periodo === item.id ? "chip active" : "chip"} onClick={() => setPeriodo(item.id)}>
                {item.rotulo}
              </button>
            ))}
          </div>
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
              <h2 className="section-title">Patrimônio</h2>
              <p className="section-hint">{formataJanela(performance.from, performance.to)}</p>
            </div>
            <p className="stat-value grande">{formataBRL(portfolio.totals.marketValueCents)}</p>
            <div className="rendimento-linha">
              <span className="stat-label">Rendimento</span>
              <span className="stat-value pequeno">{formataBRL(rendimento)}</span>
              <span className="stat-note">{formataPercentualSinal(rendimentoPct)} sobre o capital</span>
            </div>
          </section>

          <section className="card">
            <div className="section-head">
              <h2 className="section-title">Evolução</h2>
              <p className="section-hint">Janela: {formataJanela(performance.from, performance.to)}.</p>
            </div>
            <EvolucaoChart history={history} performance={performance} />
          </section>
        </div>

        <div className="stack">
          <section className="card">
            <div className="section-head"><h2 className="section-title">Onde está o dinheiro</h2></div>
            <ul className="alloc-list">
              {porKind.map((bloco) => (
                <li className="alloc-row" key={bloco.kind}>
                  <button type="button" className="alloc-line botao-linha" onClick={() => onAbrirPosicoes(bloco.kind)}>
                    <span className="alloc-name">{NOMES_KIND[bloco.kind] ?? bloco.kind}</span>
                    <span className="alloc-value">
                      <strong>{formataBRL(bloco.valor)}</strong>
                      <span className="valor-fraco">{bloco.pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</span>
                      <span className="valor-fraco">{bloco.quantidade} {bloco.quantidade === 1 ? "ativo" : "ativos"}</span>
                    </span>
                  </button>
                  <span className="alloc-bar"><span className="alloc-bar-fill" style={{ width: `${Math.min(100, bloco.pct)}%` }} /></span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <div className="section-head">
              <h2 className="section-title">Meu dinheiro rendeu</h2>
              <p className="section-hint">Cada aporte pesa pelo tempo investido (MWR).</p>
            </div>
            <div className="stats">
              <div className="stat">
                <span className="stat-label">No período</span>
                <span className="stat-value">{performance.mwr.periodPct === null ? "—" : formataPercentualSinal(performance.mwr.periodPct)}</span>
                <span className="stat-note">{formataJanela(performance.from, performance.to)}</span>
              </div>
              <div className="stat">
                <span className="stat-label">CDI</span>
                <span className="stat-value">{formataPercentualSinal(performance.accumulated.cdiPct)}</span>
              </div>
              <div className="stat">
                <span className="stat-label">IPCA</span>
                <span className="stat-value">{formataPercentualSinal(performance.accumulated.ipcaPct)}</span>
              </div>
              <div className="stat">
                <span className="stat-label">12 meses</span>
                <span className="stat-value">{performance12m.mwr.periodPct === null ? "—" : formataPercentualSinal(performance12m.mwr.periodPct)}</span>
              </div>
            </div>
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
                      <span className="alloc-value">
                        <strong>{formataBRL(grupo.marketValueCents)}</strong>
                        <span className="valor-fraco">{grupo.pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</span>
                      </span>
                    </div>
                    <span className="alloc-bar"><span className="alloc-bar-fill" style={{ width: `${Math.min(100, grupo.pct)}%` }} /></span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <div className="section-head"><h2 className="section-title">Fontes</h2></div>
            <p className="section-hint fontes-resumo">
              <Coins size={14} aria-hidden="true" />
              <span>{health.sources.length - stale} fontes ok</span>
              {stale > 0 && <span className="badge badge-warn">{stale} desatualizada{stale === 1 ? "" : "s"}</span>}
            </p>
            <button type="button" className="btn btn-secondary" onClick={onAbrirFontes}>Ver fontes</button>
          </section>
        </div>
      </div>
    </div>
  );
}
