import { Bar, CartesianGrid, ComposedChart, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formataBRL, formataBRLSinal, formataMes } from "../format.ts";
import { SemHistorico, formataEixoRs, rotuloTrimestre, type Mes } from "./graficoComum.tsx";

type LinhaFluxos = { rotulo: string; aporteCents: number; resgateCents: number; resgateNegCents: number; liquidoCents: number };
type FluxoBase = Omit<LinhaFluxos, "resgateNegCents" | "liquidoCents">;

function visaoFluxos(meses: Mes[], trimestral: boolean): LinhaFluxos[] {
  const mensais: FluxoBase[] = meses.map((mes) => ({
    rotulo: formataMes(mes.month), aporteCents: mes.investedCents, resgateCents: mes.redeemedCents,
  }));
  const linhas: FluxoBase[] = [];
  if (trimestral) {
    for (let inicio = 0; inicio < mensais.length; inicio += 3) {
      const grupo = mensais.slice(inicio, inicio + 3);
      linhas.push({
        rotulo: rotuloTrimestre(meses[inicio]!.month),
        aporteCents: grupo.reduce((total, linha) => total + linha.aporteCents, 0),
        resgateCents: grupo.reduce((total, linha) => total + linha.resgateCents, 0),
      });
    }
  } else {
    linhas.push(...mensais);
  }
  return linhas.map((linha) => ({
    ...linha, resgateNegCents: -linha.resgateCents, liquidoCents: linha.aporteCents - linha.resgateCents,
  }));
}

function TooltipFluxos({ active, payload }: { active?: boolean; payload?: Array<{ payload: LinhaFluxos }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const linha = payload[0]!.payload;
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-title">{linha.rotulo}</p>
      <p>Aporte: <strong>{formataBRL(linha.aporteCents)}</strong></p>
      <p>Resgate: {formataBRL(linha.resgateCents)}</p>
      <p>Líquido: {formataBRLSinal(linha.liquidoCents)}</p>
    </div>
  );
}

export function FluxosChart({ meses, altura = 300 }: { meses: Mes[]; altura?: number }) {
  if (meses.length === 0) return <SemHistorico />;
  const linhas = visaoFluxos(meses, meses.length > 24);
  const maxFluxo = Math.max(1, ...linhas.map((linha) => Math.max(linha.aporteCents, linha.resgateCents)));
  return (
    <ResponsiveContainer width="100%" height={altura}>
      <ComposedChart data={linhas} barGap={-16} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="rotulo" tickLine={false} axisLine={false} fontSize={12} />
        <YAxis tickLine={false} axisLine={false} fontSize={12} width={76} tickFormatter={formataEixoRs} domain={[-maxFluxo, maxFluxo]} />
        <ReferenceLine y={0} stroke="var(--border-strong)" />
        <Tooltip content={<TooltipFluxos />} />
        <Legend />
        <Bar dataKey="aporteCents" name="Aporte" fill="var(--sand)" barSize={16} />
        <Bar dataKey="resgateNegCents" name="Resgate" fill="var(--danger)" barSize={16} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
