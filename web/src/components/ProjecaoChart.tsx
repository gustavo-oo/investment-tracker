import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Projection } from "../api.ts";
import { formataBRL, formataMes } from "../format.ts";
import { formataEixoRs } from "./graficoComum.tsx";

type LinhaProjecao = {
  rotulo: string; realCents: number | null; baseCents: number | null; faixaCents: [number, number] | null;
};

function visaoProjecao(projecao: Projection, horizonte: number): LinhaProjecao[] {
  const linhas: LinhaProjecao[] = projecao.history.map((ponto) => ({
    rotulo: formataMes(ponto.month), realCents: ponto.marketValueCents, baseCents: null, faixaCents: null,
  }));
  const juncao = linhas.at(-1);
  if (juncao !== undefined && projecao.premise !== null) {
    juncao.baseCents = projecao.premise.patrimonyCents;
    juncao.faixaCents = [projecao.premise.patrimonyCents, projecao.premise.patrimonyCents];
  }
  for (const ponto of projecao.projection.slice(0, horizonte)) {
    linhas.push({
      rotulo: formataMes(ponto.month), realCents: null, baseCents: ponto.baseCents,
      faixaCents: [ponto.pessimisticCents, ponto.optimisticCents],
    });
  }
  return linhas;
}

function TooltipProjecao({ active, payload }: { active?: boolean; payload?: Array<{ payload: LinhaProjecao }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const linha = payload[0]!.payload;
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-title">{linha.rotulo}{linha.realCents !== null && linha.baseCents !== null ? " · hoje" : ""}</p>
      {linha.realCents !== null && <p>Patrimônio: <strong>{formataBRL(linha.realCents)}</strong></p>}
      {linha.baseCents !== null && linha.faixaCents !== null && (
        <>
          <p>Projetado: <strong>{formataBRL(linha.baseCents)}</strong></p>
          <p>Faixa (±1σ): {formataBRL(linha.faixaCents[0])} – {formataBRL(linha.faixaCents[1])}</p>
        </>
      )}
    </div>
  );
}

export function ProjecaoChart({ projecao, horizonte, altura = 300 }: {
  projecao: Projection; horizonte: number; altura?: number;
}) {
  if (projecao.history.length === 0) return null;
  const linhas = visaoProjecao(projecao, horizonte);
  return (
    <ResponsiveContainer width="100%" height={altura}>
      <ComposedChart data={linhas} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="rotulo" tickLine={false} axisLine={false} fontSize={12} minTickGap={28} />
        <YAxis tickLine={false} axisLine={false} fontSize={12} width={76} tickFormatter={formataEixoRs} />
        <Tooltip content={<TooltipProjecao />} />
        <Legend />
        <Area dataKey="faixaCents" name="Faixa (±1σ)" type="monotone" stroke="none" fill="var(--accent-soft)" fillOpacity={0.9} isAnimationActive={false} />
        <Area dataKey="realCents" name="Patrimônio" type="monotone" stroke="var(--accent)" fill="var(--accent-soft)" strokeWidth={2} />
        <Line dataKey="baseCents" name="Projeção" type="monotone" stroke="var(--accent)" strokeWidth={2} strokeDasharray="5 4" dot={false} />
        <ReferenceLine x={formataMes(projecao.to)} stroke="var(--border-strong)" strokeDasharray="3 3" label={{ value: "hoje", position: "top", fontSize: 11 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
