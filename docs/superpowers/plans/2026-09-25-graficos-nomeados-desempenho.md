# Gráficos nomeados de desempenho (Visão geral e Evolução) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** substituir o gráfico único "Desempenho no período" (abas R$/% + sub-abas) por gráficos nomeados: um card com seletor nomeado na Visão geral e três cards na Evolução — sem mudança de API/banco.

**Architecture:** `web/src/components/EvolucaoChart.tsx` (261 linhas, 4 visões atrás de abas) é dividido em três componentes (`PatrimonioChart`, `FluxosChart`, `RendimentoChart`) + helpers comuns (`graficoComum.tsx`); `ControlesGrafico.tsx` vira três controles (visão, período, granularidade). A Visão geral compõe os três num card com seletor nomeado; a Evolução compõe três cards e move o período para o cabeçalho da página. Spec: `docs/superpowers/specs/2026-09-25-graficos-nomeados-desempenho-design.md`.

**Tech Stack:** React 19 + TypeScript, Vite 8 (config na raiz, `root: "web"`), Recharts, CSS puro em `web/src/styles.css`.

**Branch sugerida:** `graficos-nomeados` (worktree isolado, padrão do projeto).

## Global Constraints

- Web não tem runner de testes: nenhum teste automatizado novo — verificação por `npm run typecheck`, `npm run build:web` e browser com dados reais (precedente: S7, reserva de emergência).
- `npm test` (backend) deve seguir com **204 verdes**; nenhuma mudança em API, banco ou domínio.
- Zero `float` em dado persistido/cálculo: os gráficos só formatam centavos inteiros; `Number` só na borda de apresentação.
- Cada task/layer ≤ 400 linhas e ≤ 10 arquivos (regra do projeto); `package-lock.json` não muda nesta branch.
- Artefatos e commits em pt-BR; commits convencionais sem acento (`feat:`, `docs:`).
- Texto de UI em pt-BR; não introduzir `·`/`→` como separador.

---

### Task 1: Componentes de gráfico nomeados (novos arquivos)

**Files:**
- Modify: `web/src/format.ts` (nova função `formataBRLSinal`, depois de `formataBRL`, ~linha 3)
- Create: `web/src/components/graficoComum.tsx`
- Create: `web/src/components/PatrimonioChart.tsx`
- Create: `web/src/components/FluxosChart.tsx`
- Create: `web/src/components/RendimentoChart.tsx`

**Interfaces:**
- Consumes: `HistoryPoint`, `Performance`, `PerformanceMonth` de `web/src/api.ts`; `formataBRL`, `formataMes`, `formataPercentual`, `formataPercentualSinal`, `formataPontosPercentuais` de `web/src/format.ts`; `SubAba` de `web/src/components/ControlesGrafico.tsx` (existe hoje e continua existindo na Task 2).
- Produces: `type Mes`; `mesesDe(history, performance): Mes[]`; `SemHistorico()`; `formataEixoRs`, `formataEixoPct`, `acumula`, `rotuloTrimestre`, `deslocamentosRotulos`; `PatrimonioChart({ meses, altura? })`; `FluxosChart({ meses, altura? })`; `RendimentoChart({ meses, performance, subAba, altura?, resumo? })`; `formataBRLSinal(cents)`.

- [ ] **Step 1: Adicionar `formataBRLSinal` ao format.ts**

Em `web/src/format.ts`, logo depois de `formataBRL`:

```ts
export function formataBRLSinal(cents: number): string {
  return `${cents > 0 ? "+" : ""}${formataBRL(cents)}`;
}
```

- [ ] **Step 2: Criar `web/src/components/graficoComum.tsx`**

```tsx
import type { HistoryPoint, Performance, PerformanceMonth } from "../api.ts";

export type Mes = PerformanceMonth & { patrimonioCents: number };

export function mesesDe(history: HistoryPoint[], performance: Performance): Mes[] {
  const patrimonioPorMes = new Map(history.map((ponto) => [ponto.month, ponto.marketValueCents]));
  return performance.months.map((mes) => ({ ...mes, patrimonioCents: patrimonioPorMes.get(mes.month) ?? 0 }));
}

export const rotuloTrimestre = (mes: string): string => {
  const [ano = "0000", mesNumero = "01"] = mes.split("-");
  return `T${Math.ceil(Number(mesNumero) / 3)}/${ano.slice(2)}`;
};

export const formataEixoRs = (cents: number): string => {
  const reais = cents / 100;
  const sinal = reais < 0 ? "−" : "";
  const abs = Math.abs(reais);
  if (abs >= 1_000_000) return `${sinal}R$ ${(abs / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (abs >= 1_000) return `${sinal}R$ ${Math.round(abs / 1_000).toLocaleString("pt-BR")} mil`;
  return `${sinal}R$ ${abs.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
};

export const formataEixoPct = (valor: number): string =>
  `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

export const acumula = (pcts: Array<number | null>): number => {
  let fator = 1;
  for (const pct of pcts) if (pct !== null) fator *= 1 + pct / 100;
  return Math.round((fator - 1) * 1_000_000) / 10_000;
};

/** Desvios verticais (px) para rótulos finais próximos: agrupa valores a menos de 1,5 p.p. e empilha cada grupo com passo de 14 px. */
export function deslocamentosRotulos(valores: number[], limitePp = 1.5, passo = 14): number[] {
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

export function SemHistorico() {
  return (
    <div className="empty">
      <p className="empty-title">Sem histórico suficiente</p>
      <p className="empty-hint">A evolução aparece quando houver cotações e índices no período.</p>
    </div>
  );
}
```

- [ ] **Step 3: Criar `web/src/components/PatrimonioChart.tsx`**

```tsx
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

function TooltipPatrimonio({ active, payload }: { active?: boolean; payload?: Array<{ payload: LinhaPatrimonio }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const linha = payload[0]!.payload;
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-title">{linha.rotulo}</p>
      <p>Patrimônio: <strong>{formataBRL(linha.patrimonioCents)}</strong></p>
      <p>Variação no mês: {formataBRLSinal(linha.variacaoCents)}</p>
    </div>
  );
}

export function PatrimonioChart({ meses, altura = 300 }: { meses: Mes[]; altura?: number }) {
  if (meses.length === 0) return <SemHistorico />;
  const linhas = visaoPatrimonio(meses, meses.length > 24);
  return (
    <ResponsiveContainer width="100%" height={altura}>
      <ComposedChart data={linhas} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="rotulo" tickLine={false} axisLine={false} fontSize={12} />
        <YAxis tickLine={false} axisLine={false} fontSize={12} width={76} tickFormatter={formataEixoRs} />
        <Tooltip content={<TooltipPatrimonio />} />
        <Legend />
        <Area type="monotone" dataKey="patrimonioCents" name="Patrimônio" stroke="var(--accent)" fill="var(--accent-soft)" strokeWidth={2} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 4: Criar `web/src/components/FluxosChart.tsx`**

```tsx
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
```

- [ ] **Step 5: Criar `web/src/components/RendimentoChart.tsx`**

```tsx
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
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: sem erros (o typecheck cobre os componentes novos mesmo sem uso).

- [ ] **Step 7: Build do web**

Run: `npm run build:web`
Expected: build ok (warning conhecido de chunk > 500 kB é aceitável).

- [ ] **Step 8: Testes do backend inalterados**

Run: `npm test`
Expected: `# tests 204` / `# pass 204` / `# fail 0`.

- [ ] **Step 9: Commit**

```bash
git add web/src/format.ts web/src/components/graficoComum.tsx web/src/components/PatrimonioChart.tsx web/src/components/FluxosChart.tsx web/src/components/RendimentoChart.tsx
git commit -m "feat: componentes de grafico nomeados de desempenho"
```

---

### Task 2: Swap — controles, Visão geral, Evolução e remoção do EvolucaoChart

**Files:**
- Modify: `web/src/components/ControlesGrafico.tsx` (reescrito)
- Modify: `web/src/views/OverviewView.tsx`
- Modify: `web/src/views/EvolutionView.tsx`
- Delete: `web/src/components/EvolucaoChart.tsx`
- Modify: `web/src/styles.css`

**Interfaces:**
- Consumes: tudo da Task 1; `Periodo`/`PERIODOS` de `web/src/periodos.ts`; `ExplicacaoRendimentos` de `web/src/components/InfoPopover.tsx`.
- Produces: `type Visao = "patrimonio" | "fluxos" | "rendimento"`; `type SubAba` (mantido); `SeletorVisao({ visao, onVisao })`; `ControlePeriodo({ periodo, onPeriodo, trimestral? })`; `ControleGranularidade({ subAba, onSubAba })`.

- [ ] **Step 1: Reescrever `web/src/components/ControlesGrafico.tsx`**

Conteúdo completo (substitui o arquivo):

```tsx
import { PERIODOS, type Periodo } from "../periodos.ts";

export type Visao = "patrimonio" | "fluxos" | "rendimento";
export type SubAba = "mes" | "acumulado";

const VISOES: Array<{ id: Visao; rotulo: string }> = [
  { id: "patrimonio", rotulo: "Evolução do patrimônio" },
  { id: "fluxos", rotulo: "Aportes e resgates" },
  { id: "rendimento", rotulo: "Rendimento vs CDI e IPCA" },
];

export function SeletorVisao({ visao, onVisao }: { visao: Visao; onVisao: (visao: Visao) => void }) {
  return (
    <div className="chart-grupo" role="group" aria-label="Gráfico">
      {VISOES.map((item) => (
        <button key={item.id} type="button" className={visao === item.id ? "chip active" : "chip"} aria-pressed={visao === item.id} onClick={() => onVisao(item.id)}>
          {item.rotulo}
        </button>
      ))}
    </div>
  );
}

export function ControlePeriodo({ periodo, onPeriodo, trimestral }: {
  periodo: Periodo; onPeriodo: (periodo: Periodo) => void; trimestral?: boolean;
}) {
  return (
    <>
      <div className="chart-grupo" role="group" aria-label="Período">
        {PERIODOS.map((item) => (
          <button key={item.id} type="button" className={periodo === item.id ? "chip active" : "chip"} aria-pressed={periodo === item.id} onClick={() => onPeriodo(item.id)}>
            {item.rotulo}
          </button>
        ))}
      </div>
      {trimestral === true && <span className="section-hint">por trimestre</span>}
    </>
  );
}

export function ControleGranularidade({ subAba, onSubAba }: { subAba: SubAba; onSubAba: (subAba: SubAba) => void }) {
  return (
    <div className="chart-grupo" role="group" aria-label="Granularidade">
      <button type="button" className={subAba === "mes" ? "chip active" : "chip"} aria-pressed={subAba === "mes"} onClick={() => onSubAba("mes")}>Mês a mês</button>
      <button type="button" className={subAba === "acumulado" ? "chip active" : "chip"} aria-pressed={subAba === "acumulado"} onClick={() => onSubAba("acumulado")}>Acumulado</button>
    </div>
  );
}
```

- [ ] **Step 2: Atualizar os imports da `OverviewView`**

Em `web/src/views/OverviewView.tsx`, trocar as linhas 12–13:

```tsx
import { EvolucaoChart } from "../components/EvolucaoChart.tsx";
import { ControlesGrafico, type Aba, type SubAba } from "../components/ControlesGrafico.tsx";
```

por:

```tsx
import { ControleGranularidade, ControlePeriodo, SeletorVisao, type SubAba, type Visao } from "../components/ControlesGrafico.tsx";
import { FluxosChart } from "../components/FluxosChart.tsx";
import { PatrimonioChart } from "../components/PatrimonioChart.tsx";
import { RendimentoChart } from "../components/RendimentoChart.tsx";
import { mesesDe } from "../components/graficoComum.tsx";
```

- [ ] **Step 3: Trocar o estado `aba` por `visao` e adicionar os hints**

No bloco de estado (~linha 45), trocar:

```tsx
  const [aba, setAba] = useState<Aba>("rs");
```

por:

```tsx
  const [visao, setVisao] = useState<Visao>("patrimonio");
```

Junto das constantes do módulo (perto de `INICIO_TUDO`/`OBJETIVO_RESERVA`, ~linha 31), adicionar:

```tsx
const HINTS: Record<Visao, string> = {
  patrimonio: "Quanto você tinha em cada mês.",
  fluxos: "O que entrou e saiu da carteira em cada mês.",
  rendimento: "Carteira em TWR (sem o efeito dos aportes), contra CDI e IPCA.",
};
```

- [ ] **Step 4: Calcular `meses` na `OverviewView`**

Depois do destructure `const { portfolio, history, performance, performanceTudo, allocation } = dados;` (~linha 99):

```tsx
  const meses = mesesDe(history, performance);
```

- [ ] **Step 5: Substituir o card "Desempenho no período" pelo card com seletor**

Em `web/src/views/OverviewView.tsx` (~linhas 182–194), trocar o `<section className="card card-desempenho">…</section>` inteiro por:

```tsx
          <section className="card">
            <div className="section-head section-head-linha">
              <SeletorVisao visao={visao} onVisao={setVisao} />
              <div className="controles-cabecalho">
                <ControlePeriodo periodo={periodo} onPeriodo={setPeriodo} trimestral={performance.months.length > 24} />
                {visao === "rendimento" && <ControleGranularidade subAba={subAba} onSubAba={setSubAba} />}
              </div>
            </div>
            <p className="section-hint hint-grafico">
              <span className="hint-janela">{formataJanela(performance.from, performance.to)}</span> {HINTS[visao]}
            </p>
            {visao === "patrimonio" && <PatrimonioChart meses={meses} />}
            {visao === "fluxos" && <FluxosChart meses={meses} />}
            {visao === "rendimento" && <RendimentoChart meses={meses} performance={performance} subAba={subAba} />}
          </section>
```

- [ ] **Step 6: Atualizar os imports da `EvolutionView`**

Em `web/src/views/EvolutionView.tsx`, trocar o topo (linhas 1–9) por:

```tsx
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
```

(O import do Recharts sai inteiro; `LinhaCrescimento` e `TooltipCrescimento` saem.)

- [ ] **Step 7: Remover `aba` e `crescimento` da `EvolutionView`**

Trocar:

```tsx
  const [aba, setAba] = useState<Aba>("rs");
  const [subAba, setSubAba] = useState<SubAba>("mes");
```

por:

```tsx
  const [subAba, setSubAba] = useState<SubAba>("mes");
```

Trocar:

```tsx
  const patrimonioPorMes = new Map(history.map((ponto) => [ponto.month, ponto.marketValueCents]));
  const crescimento: LinhaCrescimento[] = performance.months.map((mes) => ({
    rotulo: formataMes(mes.month), aporteCents: mes.investedCents, rendimentoCents: mes.rendimentoCents, resgateCents: -mes.redeemedCents,
  }));
  let acumulado = 1;
```

por:

```tsx
  const patrimonioPorMes = new Map(history.map((ponto) => [ponto.month, ponto.marketValueCents]));
  const meses = mesesDe(history, performance);
  let acumulado = 1;
```

Remover o tipo `LinhaCrescimento` (linha 11) e a função `TooltipCrescimento` (linhas 22–33).

- [ ] **Step 8: Período no cabeçalho e três cards na `EvolutionView`**

Trocar o `page-head` do estado carregado:

```tsx
      <div className="page-head">
        <div>
          <h1 className="page-title">Evolução</h1>
          <p className="page-sub">Janela: {formataJanela(performance.from, performance.to)}.</p>
        </div>
      </div>
```

por:

```tsx
      <div className="page-head">
        <div>
          <h1 className="page-title">Evolução</h1>
          <p className="page-sub">Evolução mensal da carteira contra CDI e IPCA.</p>
        </div>
        <div className="page-head-actions">
          <ControlePeriodo periodo={periodo} onPeriodo={setPeriodo} trimestral={performance.months.length > 24} />
        </div>
      </div>
```

Trocar o primeiro `<section className="card">` (o card "Evolução da carteira" com `<EvolucaoChart … />`) por três cards:

```tsx
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
```

Remover o último `<section className="card">` ("De onde veio o crescimento", com `ResponsiveContainer`/`ComposedChart`/`TooltipCrescimento`).

- [ ] **Step 9: Remover o EvolucaoChart**

```bash
git rm web/src/components/EvolucaoChart.tsx
```

- [ ] **Step 10: Ajustar o `styles.css`**

Adicionar junto do bloco `.section-hint` (~linha 153):

```css
.hint-janela {
  color: var(--text-3);
}

.hint-grafico {
  margin-top: 0;
  margin-bottom: 12px;
}
```

Remover as regras que ficaram sem uso:

```css
.chart-controles-grafico { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
```

```css
.section-head-linha > .chart-controles-grafico { margin-left: auto; }
```

```css
.card-desempenho {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
}
```

```css
.grafico-area {
  display: flex;
  flex: 1 1 auto;
  min-height: 320px;
}

.grafico-area > * {
  flex: 1 1 auto;
  min-width: 0;
}

.chart-flex {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.chart-canvas {
  flex: 1;
  min-height: 0;
}
```

Conferir que não sobrou uso:

```bash
grep -rn "chart-controles-grafico\|card-desempenho\|grafico-area\|chart-flex\|chart-canvas" web/src || echo "sem usos"
```

Expected: `sem usos`.

- [ ] **Step 11: Typecheck + build + testes**

Run: `npm run typecheck && npm run build:web`
Expected: ambos sem erro.

Run: `npm test`
Expected: 204 verdes.

- [ ] **Step 12: Smoke no browser**

Na worktree, com o container de pé em `localhost:3000` (API real):

```bash
npm run dev:web > /tmp/dev-web.log 2>&1 &
```

Abrir `http://localhost:5173` com o `agent-browser` e conferir:

1. Visão geral: card com os chips "Evolução do patrimônio" (ativo), "Aportes e resgates" e "Rendimento vs CDI e IPCA" + período "1 ano" (ativo).
2. Clicar em "Aportes e resgates" → barras (aporte acima, resgate abaixo do zero).
3. Clicar em "Rendimento vs CDI e IPCA" → 3 linhas + chips "Mês a mês"/"Acumulado"; "Acumulado" → 3 linhas com rótulos no fim.
4. Evolução: três cards + tabela, período no topo, sem "De onde veio o crescimento".
5. Console sem erro de React.

Screenshot de fumaça: `.superpowers/sdd/graficos-nomeados-00-smoke.png`.

- [ ] **Step 13: Commit**

```bash
git add web/src/components/ControlesGrafico.tsx web/src/views/OverviewView.tsx web/src/views/EvolutionView.tsx web/src/styles.css
git commit -m "feat: visao geral com seletor nomeado e evolucao em tres cards"
```

---

### Task 3: Aceite com dados reais, ROADMAP e verificação final

**Files:**
- Modify: `ROADMAP.md` (linha na tabela §Estado atual + evidência; §Próxima ação)
- Screenshots em `.superpowers/sdd/`

**Interfaces:**
- Consumes: Vite dev na worktree (`npm run dev:web`, 5173, proxy `/api` → 3000) + container com dados reais; `curl localhost:3000/api/...`.
- Produces: evidência de aceite (screenshots + valores conferidos) e ROADMAP atualizado.

- [ ] **Step 1: Conferir os números da API real**

Com o servidor dev de pé (Task 2, Step 12):

```bash
curl -s "localhost:3000/api/performance?from=2025-10&to=2026-09" | python3 -c "
import json,sys
d=json.load(sys.stdin)
a=d['accumulated']
print('carteira',a['portfolioPct'],'cdi',a['cdiPct'],'ipca',a['ipcaPct'],'diff',a['diffCdiPp'],d['monthsBeaten'],'/',d['monthsTotal'])
for m in d['months']:
    if m['month']=='2026-04': print('abr/2026',m['investedCents'],m['redeemedCents'])
"
```

Expected: valores vivos (referência de 2026-09-22: carteira +13,89% · CDI +14,07% · IPCA +3,73% · −0,18 p.p. · 6/12; abr/2026 aportes <valor> · resgates <valor>). O critério é a tela bater com a API **no momento da conferência**.

- [ ] **Step 2: Conferir a Visão geral contra a API**

No browser (1280), com "1 ano" selecionado:

1. "Evolução do patrimônio": último ponto da área = último mês de `/api/history?from=2025-10&to=2026-09` (`marketValueCents`); hover mostra "Patrimônio" e "Variação no mês".
2. "Aportes e resgates": hover em abr/2026 mostra Aporte `R$ <valor>`, Resgate `R$ <valor>` e Líquido `+R$ <valor>` (ou os valores vivos da API).
3. "Rendimento vs CDI e IPCA": "Acumulado" termina com os valores de `accumulated`; "Mês a mês" bate com os meses da API; chips de granularidade só aparecem nessa visão.

- [ ] **Step 3: Conferir a Evolução e a responsividade**

1. Evolução: os três cards com os mesmos números + tabela; período no topo muda os três e a tabela; sem "De onde veio o crescimento".
2. Em 1280 e 1024 de largura:

```js
document.documentElement.scrollWidth === window.innerWidth
```

Expected: `true` nas duas; sem overflow horizontal.

- [ ] **Step 4: Screenshots**

Salvar em `.superpowers/sdd/`:

- `graficos-nomeados-01-visao-geral.png` (patrimônio)
- `graficos-nomeados-02-fluxos.png`
- `graficos-nomeados-03-rendimento-acumulado.png`
- `graficos-nomeados-04-evolucao.png`
- `graficos-nomeados-05-1024.png`

- [ ] **Step 5: Atualizar o ROADMAP**

Na tabela §Estado atual, adicionar a linha:

```markdown
| Gráficos nomeados de desempenho (Visão geral + Evolução) | concluída — merge local na main (branch `graficos-nomeados`) |
```

Em §Estado atual, adicionar a evidência (com os valores medidos na conferência):

```markdown
- Gráficos nomeados (2026-09-25, branch `graficos-nomeados`): o "Desempenho no período" vira **seletor nomeado** na Visão geral (chips Evolução do patrimônio · Aportes e resgates · Rendimento vs CDI e IPCA, um gráfico por vez, período na mesma linha, granularidade só no rendimento) e **três cards** na Evolução (patrimônio 360, fluxos 320, rendimento 360, período no topo, sem "De onde veio o crescimento"); abas R$/% e as sub-abas dentro do R$ somem; `EvolucaoChart` dividido em `PatrimonioChart`/`FluxosChart`/`RendimentoChart` + `graficoComum`; sem mudança de API/banco. Verificação: 204 testes, typecheck e `build:web` verdes; browser com dados reais em 1280/1024 sem overflow; screenshots `.superpowers/sdd/graficos-nomeados-0*.png`.
```

Em §Próxima ação, manter o texto das abas auxiliares (projeção/rebalanceamento) como próxima etapa.

- [ ] **Step 6: Verificação final da branch**

```bash
npm test && npm run typecheck && npm run build:web
```

Expected: 204 testes verdes, typecheck limpo, build ok.

- [ ] **Step 7: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: evidencia dos graficos nomeados no roadmap"
```

- [ ] **Step 8 (após o merge, no checkout principal): Docker**

Run (no checkout principal, não na worktree — a porta 3000 já está em uso): `docker compose up -d --build` e `curl localhost:3000/api/health`.
Expected: container `healthy`, health sem erro de fonte.

---

## Autoverificação do plano

1. **Cobertura da spec:** divisão em 3 gráficos nomeados (T1/T2); seletor nomeado com chips (T2, Steps 1/5); período compartilhado na linha do seletor (T2, Step 5) e no topo da Evolução (T2, Step 8); granularidade só no rendimento (T2, Steps 1/5/8); Evolução com 3 cards + tabela e sem "De onde veio" (T2, Step 8); rodapé de resumo no card de rendimento (T1, `resumo`); tooltips (T1, Steps 3–5); trimestral acima de 24 meses com "por trimestre" (T1 + `ControlePeriodo`); aceite com dados reais, 1280/1024 e screenshots (T3); sem mudança de API/banco (Global Constraints).
2. **Placeholders:** nenhum "TBD/TODO"; os únicos valores "a preencher" são os medidos na conferência (T3), explicitamente valores vivos.
3. **Consistência de tipos:** `Visao`/`SubAba` exportados pela Task 2 e importados pelas views; `mesesDe`/`Mes` exportados pela Task 1 e usados nas duas views; `PatrimonioChart`/`FluxosChart`/`RendimentoChart` com as assinaturas usadas nos Steps 5/8; `formataBRLSinal` definido no Step 1 da Task 1 e usado nos tooltips dos Steps 3/4.
