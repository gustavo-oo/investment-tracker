import { useCallback, useEffect, useState } from "react";
import { CaretDown, CaretUp } from "@phosphor-icons/react";
import { Bar, CartesianGrid, ComposedChart, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getHistory, getPerformance, type HistoryPoint, type Performance } from "../api.ts";
import { formataBRL, formataJanela, formataMes, formataPercentualSinal, formataPontosPercentuais, mesDeslocado } from "../format.ts";
import { EvolucaoChart } from "../components/EvolucaoChart.tsx";

type Periodo = "1a" | "5a" | "tudo";
const PERIODOS: Array<{ id: Periodo; rotulo: string }> = [
  { id: "1a", rotulo: "1 ano" }, { id: "5a", rotulo: "5 anos" }, { id: "tudo", rotulo: "Tudo" },
];

type LinhaCrescimento = { rotulo: string; aporteCents: number; rendimentoCents: number; resgateCents: number };

const mesCorrente = (): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()).slice(0, 7);

function inicioDoPeriodo(periodo: Periodo, mes: string): string {
  if (periodo === "1a") return mesDeslocado(mes, -11);
  if (periodo === "5a") return mesDeslocado(mes, -59);
  return "2000-01";
}

function TooltipCrescimento({ active, payload }: { active?: boolean; payload?: Array<{ payload: LinhaCrescimento }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const linha = payload[0]!.payload;
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-title">{linha.rotulo}</p>
      <p>Você aportou: {formataBRL(linha.aporteCents)}</p>
      <p>O mercado rendeu: {formataBRL(linha.rendimentoCents)}</p>
      <p>Você resgatou: {formataBRL(linha.resgateCents)}</p>
    </div>
  );
}

export function EvolutionView({ reloadToken }: { reloadToken: number }) {
  const [periodo, setPeriodo] = useState<Periodo>("1a");
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
  const crescimento: LinhaCrescimento[] = performance.months.map((mes) => ({
    rotulo: formataMes(mes.month), aporteCents: mes.investedCents, rendimentoCents: mes.rendimentoCents, resgateCents: -mes.redeemedCents,
  }));
  let acumulado = 1;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Evolução</h1>
          <p className="page-sub">Janela: {formataJanela(performance.from, performance.to)}.</p>
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

      {erro !== null && <div className="callout callout-error" role="alert"><p>{erro}</p></div>}

      <div className="stack">
        <section className="card">
          <EvolucaoChart history={history} performance={performance} altura={360} />
        </section>

        <section className="card">
          <div className="section-head"><h2 className="section-title">Mês a mês</h2></div>
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
                {performance.months.map((mes) => {
                  if (mes.portfolioPct !== null) acumulado *= 1 + mes.portfolioPct / 100;
                  const acumuladoPct = (acumulado - 1) * 100;
                  return (
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
                      <td className="num">{formataPercentualSinal(acumuladoPct)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="section-head">
            <h2 className="section-title">De onde veio o crescimento</h2>
            <p className="section-hint">Aporte na base, rendimento no topo, resgate abaixo do eixo.</p>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={crescimento} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="rotulo" tickLine={false} axisLine={false} fontSize={12} />
              <YAxis tickLine={false} axisLine={false} fontSize={12} width={64} tickFormatter={(valor: number) => formataBRL(valor)} />
              <ReferenceLine y={0} stroke="var(--border-strong)" />
              <Tooltip content={<TooltipCrescimento />} />
              <Legend />
              <Bar dataKey="aporteCents" name="Aporte" stackId="crescimento" fill="var(--sand)" />
              <Bar dataKey="rendimentoCents" name="Rendimento" stackId="crescimento" fill="var(--accent)" />
              <Bar dataKey="resgateCents" name="Resgate" fill="var(--danger)" />
            </ComposedChart>
          </ResponsiveContainer>
        </section>
      </div>
    </div>
  );
}
