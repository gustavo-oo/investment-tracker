import { CartesianGrid, LabelList, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Performance } from "../api.ts";
import { formataMes, formataPercentual, formataPercentualSinal, formataPontosPercentuais } from "../format.ts";
import type { SubAba } from "./ControlesGrafico.tsx";
import { SemHistorico, acumula, deslocamentosRotulos, formataEixoPct, rotuloTrimestre, type Mes } from "./graficoComum.tsx";

type LinhaPct = { rotulo: string; carteira: number | null; cdi: number | null; ipca: number | null; real: number | null };
type LinhaAcumulada = { rotulo: string; carteira: number; cdi: number; ipca: number; real: number };

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

function RotuloFinal(props: { index?: number; x?: number | string; y?: number | string; value?: number | string | boolean | null; ultimo: number; dy?: number }) {
  if (props.index !== props.ultimo) return null;
  return (
    <text x={Number(props.x) + 6} y={Number(props.y) + (props.dy ?? 0)} fontSize={11} fill="var(--text-2)">
      {formataPercentual(Number(props.value))}
    </text>
  );
}

export function RendimentoChart({ meses, performance, subAba, altura = 300, resumo = false }: {
  meses: Mes[]; performance: Performance; subAba: SubAba; altura?: number; resumo?: boolean;
}) {
  if (meses.length === 0) return <SemHistorico />;
  const linhasPct = visaoPct(meses, meses.length > 24);
  const linhasAcumuladas = visaoAcumulada(meses);
  const ultimos = linhasAcumuladas.at(-1);
  const desviosRotulos = ultimos === undefined ? [0, 0, 0] : deslocamentosRotulos([ultimos.carteira, ultimos.cdi, ultimos.ipca]);
  return (
    <div>
      <ResponsiveContainer width="100%" height={altura}>
        {subAba === "mes" ? (
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
