import { useCallback, useEffect, useState } from "react";
import { CaretDown, CaretUp } from "@phosphor-icons/react";
import { getHistory, getPerformance, type HistoryPoint, type Performance } from "../api.ts";
import { formataBRL, formataJanela, formataMes, formataPercentualSinal, formataPontosPercentuais, mesDeslocado } from "../format.ts";
import { type Periodo } from "../periodos.ts";
import { ControleGranularidade, ControlePeriodo, type SubAba } from "../components/ControlesGrafico.tsx";
import { FluxosChart } from "../components/FluxosChart.tsx";
import { PatrimonioChart } from "../components/PatrimonioChart.tsx";
import { RendimentoChart } from "../components/RendimentoChart.tsx";
import { mesesDe } from "../components/graficoComum.tsx";
import { ExplicacaoRendimentos } from "../components/InfoPopover.tsx";

const mesCorrente = (): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()).slice(0, 7);

function inicioDoPeriodo(periodo: Periodo, mes: string): string {
  if (periodo === "1a") return mesDeslocado(mes, -11);
  if (periodo === "5a") return mesDeslocado(mes, -59);
  return "2000-01";
}

export function EvolutionView({ reloadToken }: { reloadToken: number }) {
  const [periodo, setPeriodo] = useState<Periodo>("1a");
  const [subAba, setSubAba] = useState<SubAba>("mes");
  const [history, setHistory] = useState<HistoryPoint[] | null>(null);
  const [performance, setPerformance] = useState<Performance | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async (signal: AbortSignal) => {
    try {
      const portfolioMes = mesCorrente();
      const from = inicioDoPeriodo(periodo, portfolioMes);
      const [pontos, resultado] = await Promise.all([getHistory(from, portfolioMes, signal), getPerformance(from, portfolioMes, signal)]);
      setHistory(pontos);
      setPerformance(resultado);
      setErro(null);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setErro(cause instanceof Error ? cause.message : String(cause));
    }
  }, [periodo]);

  useEffect(() => {
    const controller = new AbortController();
    void carregar(controller.signal);
    return () => controller.abort();
  }, [carregar, reloadToken]);

  if (history === null || performance === null) {
    return (
      <div className="page">
        <div className="page-head"><div><h1 className="page-title">Evolução</h1><p className="page-sub">Evolução mensal da carteira contra CDI e IPCA.</p></div></div>
        {erro !== null && <div className="callout callout-error" role="alert"><p>{erro}</p></div>}
      </div>
    );
  }

  const patrimonioPorMes = new Map(history.map((ponto) => [ponto.month, ponto.marketValueCents]));
  const meses = mesesDe(history, performance);
  const acumuladoPorMes = new Map<string, number>();
  let acumulado = 1;
  for (const mes of performance.months) {
    if (mes.portfolioPct !== null) acumulado *= 1 + mes.portfolioPct / 100;
    acumuladoPorMes.set(mes.month, (acumulado - 1) * 100);
  }
  const mesesRecentesPrimeiro = [...performance.months].reverse();

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Evolução</h1>
          <p className="page-sub">Evolução mensal da carteira contra CDI e IPCA.</p>
        </div>
        <div className="page-head-actions">
          <ControlePeriodo periodo={periodo} onPeriodo={setPeriodo} trimestral={performance.months.length > 24} />
        </div>
      </div>

      {erro !== null && <div className="callout callout-error" role="alert"><p>{erro}</p></div>}

      <div className="stack">
        <section className="card">
          <div className="section-head">
            <h2 className="section-title">Evolução do patrimônio</h2>
            <p className="section-hint">
              <span className="hint-janela">{formataJanela(performance.from, performance.to)}</span> Quanto você tinha em cada mês.
            </p>
          </div>
          <PatrimonioChart meses={meses} altura={360} />
        </section>

        <section className="card">
          <div className="section-head">
            <h2 className="section-title">Aportes e resgates</h2>
            <p className="section-hint">
              <span className="hint-janela">{formataJanela(performance.from, performance.to)}</span> O que entrou e saiu da carteira em cada mês.
            </p>
          </div>
          <FluxosChart meses={meses} altura={320} />
        </section>

        <section className="card">
          <div className="section-head section-head-linha">
            <div>
              <h2 className="section-title">Rendimento vs CDI e IPCA</h2>
              <p className="section-hint">
                <span className="hint-janela">{formataJanela(performance.from, performance.to)}</span> Carteira em TWR (sem o efeito dos aportes), contra CDI e IPCA.
              </p>
            </div>
            <div className="controles-cabecalho">
              <ExplicacaoRendimentos />
              <ControleGranularidade subAba={subAba} onSubAba={setSubAba} />
            </div>
          </div>
          <RendimentoChart meses={meses} performance={performance} subAba={subAba} altura={360} resumo />
        </section>

        <section className="card">
          <div className="section-head">
            <h2 className="section-title">Mês a mês</h2>
            <p className="section-hint">Rendimento do mês em R$ e variação da carteira (TWR) contra CDI e IPCA.</p>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Mês</th><th scope="col" className="num">Patrimônio</th><th scope="col" className="num">Aportes</th>
                  <th scope="col" className="num">Resgates</th><th scope="col" className="num">Rendimento</th>
                  <th scope="col" className="num">CDI</th><th scope="col" className="num">IPCA</th>
                  <th scope="col" className="num">vs CDI</th><th scope="col" className="num">Acumulado</th>
                </tr>
              </thead>
              <tbody>
                {mesesRecentesPrimeiro.map((mes) => (
                  <tr key={mes.month}>
                    <td>{formataMes(mes.month)}</td>
                    <td className="num">{formataBRL(patrimonioPorMes.get(mes.month) ?? 0)}</td>
                    <td className="num">{formataBRL(mes.investedCents)}</td>
                    <td className="num">{formataBRL(mes.redeemedCents)}</td>
                    <td className={`num ${mes.rendimentoCents >= 0 ? "rendimento-positivo" : "rendimento-negativo"}`}>
                      <span className="valores">
                        <span className="delta-inline">
                          {mes.rendimentoCents >= 0 ? <CaretUp size={11} aria-hidden="true" /> : <CaretDown size={11} aria-hidden="true" />}
                          {formataBRL(mes.rendimentoCents)}
                        </span>
                        {mes.portfolioPct !== null && <span className="valor-fraco">{formataPercentualSinal(mes.portfolioPct)}</span>}
                      </span>
                    </td>
                    <td className="num">{mes.cdiPct === null ? "—" : formataPercentualSinal(mes.cdiPct)}</td>
                    <td className="num">{mes.ipcaPct === null ? "—" : formataPercentualSinal(mes.ipcaPct)}</td>
                    <td className="num">{mes.diffCdiPp === null ? "—" : formataPontosPercentuais(mes.diffCdiPp)}</td>
                    <td className="num">{formataPercentualSinal(acumuladoPorMes.get(mes.month) ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
