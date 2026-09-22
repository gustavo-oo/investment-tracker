import { useState } from "react";
import {
  Area, Bar, CartesianGrid, ComposedChart, LabelList, Legend, Line, LineChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { HistoryPoint, Performance, PerformanceMonth } from "../api.ts";
import { formataBRL, formataMes, formataPercentual, formataPercentualSinal, formataPontosPercentuais } from "../format.ts";
import { PERIODOS, type Periodo } from "../periodos.ts";

type Aba = "rs" | "pct";
type SubAba = "mes" | "acumulado";

type Mes = PerformanceMonth & { patrimonioCents: number };
type LinhaRsBase = { rotulo: string; patrimonioCents: number; aporteCents: number; resgateCents: number; variacaoCents: number };
type LinhaRs = LinhaRsBase & { resgateNegCents: number; capitalCents: number };
type LinhaPct = { rotulo: string; carteira: number | null; cdi: number | null; ipca: number | null; real: number | null };
type LinhaAcumulada = { rotulo: string; carteira: number; cdi: number; ipca: number; real: number };

const acumula = (pcts: Array<number | null>): number => {
  let fator = 1;
  for (const pct of pcts) if (pct !== null) fator *= 1 + pct / 100;
  return Math.round((fator - 1) * 1_000_000) / 10_000;
};

const rotuloTrimestre = (mes: string): string => {
  const [ano = "0000", mesNumero = "01"] = mes.split("-");
  return `T${Math.ceil(Number(mesNumero) / 3)}/${ano.slice(2)}`;
};

const formataEixoRs = (cents: number): string => {
  const reais = cents / 100;
  const sinal = reais < 0 ? "−" : "";
  const abs = Math.abs(reais);
  if (abs >= 1_000_000) return `${sinal}R$ ${(abs / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (abs >= 1_000) return `${sinal}R$ ${Math.round(abs / 1_000).toLocaleString("pt-BR")} mil`;
  return `${sinal}R$ ${abs.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
};

const formataEixoPct = (valor: number): string =>
  `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

function visaoRs(meses: Mes[], trimestral: boolean): LinhaRs[] {
  const linhas: LinhaRsBase[] = meses.map((mes) => ({
    rotulo: formataMes(mes.month), patrimonioCents: mes.patrimonioCents,
    aporteCents: mes.investedCents, resgateCents: mes.redeemedCents,
    variacaoCents: mes.rendimentoCents + mes.investedCents - mes.redeemedCents,
  }));
  if (linhas.length === 0) return [];
  const agregadas = trimestral ? agrupaTrimestresRs(linhas, meses) : linhas;
  // capital acumulado (só tooltip, sem linha): base da janela + aportes − resgates desde a primeira barra
  const base = linhas[0]!.patrimonioCents - linhas[0]!.variacaoCents;
  let capital = base;
  return agregadas.map((linha) => {
    capital += linha.aporteCents - linha.resgateCents;
    return { ...linha, resgateNegCents: -linha.resgateCents, capitalCents: capital };
  });
}

function agrupaTrimestresRs(linhas: LinhaRsBase[], meses: Mes[]): LinhaRsBase[] {
  const grupos: LinhaRsBase[] = [];
  for (let inicio = 0; inicio < linhas.length; inicio += 3) {
    const grupo = linhas.slice(inicio, inicio + 3);
    // patrimônio imediatamente antes do grupo: o do mês anterior ou, no primeiro, o valor inicial derivado da variação
    const anterior = inicio === 0
      ? linhas[0]!.patrimonioCents - linhas[0]!.variacaoCents
      : linhas[inicio - 1]!.patrimonioCents;
    grupos.push({
      rotulo: rotuloTrimestre(meses[inicio]!.month), patrimonioCents: grupo.at(-1)!.patrimonioCents,
      aporteCents: grupo.reduce((total, linha) => total + linha.aporteCents, 0),
      resgateCents: grupo.reduce((total, linha) => total + linha.resgateCents, 0),
      variacaoCents: grupo.at(-1)!.patrimonioCents - anterior,
    });
  }
  return grupos;
}

function visaoPct(meses: Mes[], trimestral: boolean): LinhaPct[] {
  if (!trimestral) {
    return meses.map((mes) => ({
      rotulo: formataMes(mes.month), carteira: mes.portfolioPct, cdi: mes.cdiPct, ipca: mes.ipcaPct, real: mes.realPct,
    }));
  }
  const linhas: LinhaPct[] = [];
  for (let inicio = 0; inicio < meses.length; inicio += 3) {
    const grupo = meses.slice(inicio, inicio + 3);
    linhas.push({
      rotulo: rotuloTrimestre(grupo[0]!.month),
      carteira: acumula(grupo.map((mes) => mes.portfolioPct)),
      cdi: acumula(grupo.map((mes) => mes.cdiPct)),
      ipca: acumula(grupo.map((mes) => mes.ipcaPct)),
      real: acumula(grupo.map((mes) => mes.realPct)),
    });
  }
  return linhas;
}

function visaoAcumulada(meses: Mes[]): LinhaAcumulada[] {
  const linhas: LinhaAcumulada[] = [];
  let carteira = 1, cdi = 1, ipca = 1, real = 1;
  for (const mes of meses) {
    if (mes.portfolioPct !== null) carteira *= 1 + mes.portfolioPct / 100;
    if (mes.cdiPct !== null) cdi *= 1 + mes.cdiPct / 100;
    if (mes.ipcaPct !== null) ipca *= 1 + mes.ipcaPct / 100;
    if (mes.realPct !== null) real *= 1 + mes.realPct / 100;
    linhas.push({
      rotulo: formataMes(mes.month), carteira: (carteira - 1) * 100, cdi: (cdi - 1) * 100,
      ipca: (ipca - 1) * 100, real: (real - 1) * 100,
    });
  }
  return linhas;
}

/** Desvios verticais (px) para rótulos finais próximos: agrupa valores a menos de 1,5 p.p. e empilha cada grupo com passo de 14 px. */
function deslocamentosRotulos(valores: number[], limitePp = 1.5, passo = 14): number[] {
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

function TooltipRs({ active, payload }: { active?: boolean; payload?: Array<{ payload: LinhaRs }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const linha = payload[0]!.payload;
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-title">{linha.rotulo}</p>
      <p>Patrimônio: <strong>{formataBRL(linha.patrimonioCents)}</strong></p>
      <p>Capital acumulado: {formataBRL(linha.capitalCents)}</p>
      <p>Aporte: {formataBRL(linha.aporteCents)}</p>
      <p>Resgate: {formataBRL(linha.resgateCents)}</p>
    </div>
  );
}

function TooltipPct({ active, payload }: { active?: boolean; payload?: Array<{ payload: LinhaPct | LinhaAcumulada }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const linha = payload[0]!.payload;
  const mostra = (valor: number | null): string => (valor === null ? "—" : formataPercentualSinal(valor));
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-title">{linha.rotulo}</p>
      <p>Carteira: {mostra(linha.carteira)}</p>
      <p>CDI: {mostra(linha.cdi)}</p>
      <p>IPCA: {mostra(linha.ipca)}</p>
      <p>Líquido (Carteira − IPCA): <strong>{mostra(linha.real)}</strong></p>
    </div>
  );
}

export function EvolucaoChart({ history, performance, altura = 280, resumo = true, periodo, onPeriodo }: {
  history: HistoryPoint[]; performance: Performance; altura?: number | `${number}%`; resumo?: boolean;
  periodo?: Periodo; onPeriodo?: (periodo: Periodo) => void;
}) {
  const [aba, setAba] = useState<Aba>("rs");
  const [subAba, setSubAba] = useState<SubAba>("mes");
  const patrimonioPorMes = new Map(history.map((point) => [point.month, point.marketValueCents]));
  const meses: Mes[] = performance.months.map((mes) => ({ ...mes, patrimonioCents: patrimonioPorMes.get(mes.month) ?? 0 }));
  const trimestral = meses.length > 24;
  const linhasRs = visaoRs(meses, trimestral);
  const maxFluxo = Math.max(1, ...linhasRs.map((linha) => Math.max(linha.aporteCents, linha.resgateCents)));
  const linhasPct = visaoPct(meses, trimestral);
  const linhasAcumuladas = visaoAcumulada(meses);
  const ultimos = linhasAcumuladas.at(-1);
  const desviosRotulos = ultimos === undefined ? [0, 0, 0] : deslocamentosRotulos([ultimos.carteira, ultimos.cdi, ultimos.ipca]);

  if (meses.length === 0) {
    return (
      <div className="empty">
        <p className="empty-title">Sem histórico suficiente</p>
        <p className="empty-hint">A evolução aparece quando houver cotações e índices no período.</p>
      </div>
    );
  }

  const flexivel = typeof altura === "string";

  return (
    <div className={flexivel ? "chart-flex" : undefined}>
      <div className="chart-controles-grafico">
        <div className="chart-grupo" role="group" aria-label="Visão">
          <button type="button" className={aba === "rs" ? "chip active" : "chip"} aria-pressed={aba === "rs"} onClick={() => setAba("rs")}>R$</button>
          <button type="button" className={aba === "pct" ? "chip active" : "chip"} aria-pressed={aba === "pct"} onClick={() => setAba("pct")}>%</button>
        </div>
        <div className="chart-grupo" role="group" aria-label="Granularidade">
          <button type="button" className={subAba === "mes" ? "chip active" : "chip"} aria-pressed={subAba === "mes"} onClick={() => setSubAba("mes")}>Mês a mês</button>
          <button type="button" className={subAba === "acumulado" ? "chip active" : "chip"} aria-pressed={subAba === "acumulado"} onClick={() => setSubAba("acumulado")}>Acumulado</button>
        </div>
        {periodo !== undefined && onPeriodo !== undefined && (
          <div className="chart-grupo" role="group" aria-label="Período">
            {PERIODOS.map((item) => (
              <button key={item.id} type="button" className={periodo === item.id ? "chip active" : "chip"} aria-pressed={periodo === item.id} onClick={() => onPeriodo(item.id)}>
                {item.rotulo}
              </button>
            ))}
          </div>
        )}
        {trimestral && <span className="section-hint">por trimestre</span>}
      </div>

      <div className={flexivel ? "chart-canvas" : undefined}>
        <ResponsiveContainer width="100%" height={altura}>
        {aba === "rs" ? (
          subAba === "mes" ? (
            <ComposedChart data={linhasRs} barGap={-16} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="rotulo" tickLine={false} axisLine={false} fontSize={12} />
              <YAxis tickLine={false} axisLine={false} fontSize={12} width={76} tickFormatter={formataEixoRs}
                domain={[-maxFluxo, maxFluxo]} />
              <ReferenceLine y={0} stroke="var(--border-strong)" />
              <Tooltip content={<TooltipRs />} />
              <Legend />
              <Bar dataKey="aporteCents" name="Aporte" fill="var(--sand)" barSize={16} />
              <Bar dataKey="resgateNegCents" name="Resgate" fill="var(--danger)" barSize={16} />
            </ComposedChart>
          ) : (
            <ComposedChart data={linhasRs} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="rotulo" tickLine={false} axisLine={false} fontSize={12} />
              <YAxis tickLine={false} axisLine={false} fontSize={12} width={76} tickFormatter={formataEixoRs} />
              <Tooltip content={<TooltipRs />} />
              <Legend />
              <Area type="monotone" dataKey="patrimonioCents" name="Patrimônio" stroke="var(--accent)" fill="var(--accent-soft)" strokeWidth={2} />
            </ComposedChart>
          )
        ) : subAba === "mes" ? (
          <LineChart data={linhasPct} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="rotulo" tickLine={false} axisLine={false} fontSize={12} />
            <YAxis tickLine={false} axisLine={false} fontSize={12} width={52} tickFormatter={formataEixoPct} />
            <ReferenceLine y={0} stroke="var(--border-strong)" />
            <Tooltip content={<TooltipPct />} />
            <Legend />
            <Line type="monotone" dataKey="carteira" name="Carteira" stroke="var(--accent)" strokeWidth={2} dot={{ r: 2 }} />
            <Line type="monotone" dataKey="cdi" name="CDI" stroke="var(--sand)" strokeWidth={1.5} dot={{ r: 2 }} />
            <Line type="monotone" dataKey="ipca" name="IPCA" stroke="var(--olive)" strokeWidth={1.5} dot={{ r: 2 }} />
          </LineChart>
        ) : (
          <LineChart data={linhasAcumuladas} margin={{ top: 8, right: 44, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="rotulo" tickLine={false} axisLine={false} fontSize={12} />
            <YAxis tickLine={false} axisLine={false} fontSize={12} width={52} tickFormatter={formataEixoPct} />
            <ReferenceLine y={0} stroke="var(--border-strong)" strokeDasharray="3 3" />
            <Tooltip content={<TooltipPct />} />
            <Legend />
            <Line type="monotone" dataKey="carteira" name="Carteira" stroke="var(--accent)" strokeWidth={2} dot={false}>
              <LabelList dataKey="carteira" content={(props) => <RotuloFinal {...props} ultimo={linhasAcumuladas.length - 1} dy={desviosRotulos[0]} />} />
            </Line>
            <Line type="monotone" dataKey="cdi" name="CDI" stroke="var(--sand)" strokeWidth={1.5} dot={false}>
              <LabelList dataKey="cdi" content={(props) => <RotuloFinal {...props} ultimo={linhasAcumuladas.length - 1} dy={desviosRotulos[1]} />} />
            </Line>
            <Line type="monotone" dataKey="ipca" name="IPCA" stroke="var(--olive)" strokeWidth={1.5} dot={false}>
              <LabelList dataKey="ipca" content={(props) => <RotuloFinal {...props} ultimo={linhasAcumuladas.length - 1} dy={desviosRotulos[2]} />} />
            </Line>
          </LineChart>
        )}
      </ResponsiveContainer>
      </div>

      {resumo && (
        <div className="chart-foot">
          <span>carteira <strong>{formataPercentualSinal(performance.accumulated.portfolioPct)}</strong></span>
          <span>CDI {formataPercentualSinal(performance.accumulated.cdiPct)}</span>
          <span>IPCA {formataPercentualSinal(performance.accumulated.ipcaPct)}</span>
          <span>diferença vs CDI: {formataPontosPercentuais(performance.accumulated.diffCdiPp)}</span>
          <span>bateu o CDI em {performance.monthsBeaten} de {performance.monthsTotal} meses</span>
        </div>
      )}
    </div>
  );
}

function RotuloFinal(props: { index?: number; x?: number | string; y?: number | string; value?: number | string | boolean | null; ultimo: number; dy?: number }) {
  if (props.index !== props.ultimo) return null;
  return (
    <text x={Number(props.x) + 6} y={Number(props.y) + (props.dy ?? 0)} fontSize={11} fill="var(--text-2)">
      {formataPercentual(Number(props.value))}
    </text>
  );
}
