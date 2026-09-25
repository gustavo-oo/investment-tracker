import { Area, CartesianGrid, ComposedChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formataBRL, formataBRLSinal, formataMes } from "../format.ts";
import { SemHistorico, formataEixoRs, rotuloTrimestre, type Mes } from "./graficoComum.tsx";

type LinhaPatrimonio = { rotulo: string; patrimonioCents: number; variacaoCents: number };

function visaoPatrimonio(meses: Mes[], trimestral: boolean): LinhaPatrimonio[] {
  const linhas: LinhaPatrimonio[] = meses.map((mes) => ({
    rotulo: formataMes(mes.month),
    patrimonioCents: mes.patrimonioCents,
    variacaoCents: mes.rendimentoCents + mes.investedCents - mes.redeemedCents,
  }));
  if (!trimestral) return linhas;
  const grupos: LinhaPatrimonio[] = [];
  for (let inicio = 0; inicio < linhas.length; inicio += 3) {
    const grupo = linhas.slice(inicio, inicio + 3);
    grupos.push({
      rotulo: rotuloTrimestre(meses[inicio]!.month),
      patrimonioCents: grupo.at(-1)!.patrimonioCents,
      variacaoCents: grupo.reduce((total, linha) => total + linha.variacaoCents, 0),
    });
  }
  return grupos;
}

function TooltipPatrimonio({ active, payload, trimestral }: { active?: boolean; payload?: Array<{ payload: LinhaPatrimonio }>; trimestral: boolean }) {
  if (!active || !payload || payload.length === 0) return null;
  const linha = payload[0]!.payload;
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-title">{linha.rotulo}</p>
      <p>Patrimônio: <strong>{formataBRL(linha.patrimonioCents)}</strong></p>
      <p>{trimestral ? "Variação no trimestre" : "Variação no mês"}: {formataBRLSinal(linha.variacaoCents)}</p>
    </div>
  );
}

export function PatrimonioChart({ meses, altura = 300 }: { meses: Mes[]; altura?: number }) {
  if (meses.length === 0) return <SemHistorico />;
  const trimestral = meses.length > 24;
  const linhas = visaoPatrimonio(meses, trimestral);
  return (
    <ResponsiveContainer width="100%" height={altura}>
      <ComposedChart data={linhas} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="rotulo" tickLine={false} axisLine={false} fontSize={12} />
        <YAxis tickLine={false} axisLine={false} fontSize={12} width={76} tickFormatter={formataEixoRs} />
        <Tooltip content={<TooltipPatrimonio trimestral={trimestral} />} />
        <Legend />
        <Area type="monotone" dataKey="patrimonioCents" name="Patrimônio" stroke="var(--accent)" fill="var(--accent-soft)" strokeWidth={2} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
