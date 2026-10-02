# Desempenho no período — polimento do gráfico (R$ e %) — Plano de Implementação

> **Para agentes:** sub-skill obrigatória: `superpowers:executing-plans` (execução inline, padrão bento) com TDD task a task. Passos usam checkbox (`- [ ]`). Backend primeiro, depois web.

**Goal:** aba **R$** com aporte/resgate em **coluna única** (aporte sobe, resgate desce, eixo de fluxos simétrico com zero no meio, sem linha de capital); aba **%** com sub-abas **Mês a mês**/**Acumulado** só em linhas (3 séries) e **Líquido (Carteira − IPCA)** no tooltip; controles em **dois grupos** sem reflow; **rótulos finais** com anti-colisão.

**Architecture:** `services/performance.ts` passa a expor `realPct` por mês (reusa `realReturnPct` do domínio); a rota `/api/performance` inclui o campo. No web, `EvolucaoChart.tsx` troca as barras do % por linhas, sobrepõe as barras do R$ (`barGap` negativo — Recharts 3 não tem stack divergente), formata negativos no eixo, agrupa os chips e desloca rótulos finais próximos. `styles.css` ganha as classes dos grupos/divisor.

**Tech Stack:** Node 22 + TypeScript (type-stripping), Fastify 5, better-sqlite3, `node:test`; web Vite + React 19 + Recharts 3.

**Spec:** `docs/superpowers/specs/2026-09-22-desempenho-periodo-design.md`

## Global Constraints

- Node ≥ 22.18, ESM, imports `.ts` explícitos; backend sem build (type-stripping). `node:test`; nenhum teste com rede.
- Zero `float` em dado persistido/cálculo: BigInt escalonado até a divisão final; `Number` só em percentuais de apresentação (4 casas).
- Nenhum número de cálculo muda (TWR/MWR/capital/reconciliação 2026-09 = `<valor>`); a etapa é de apresentação + um campo novo derivado no mês.
- Não há linha de capital acumulado no R$ (decisão de 2026-09-22); tooltip do R$ mostra Patrimônio, Capital acumulado, Aporte e Resgate — sem "Rendimento acumulado".
- Empilhamento não é usado: as barras do R$ ficam **sobrepostas** na mesma coluna via `barSize` fixo + `barGap` negativo.
- Camadas: `domain` sem I/O; services calculam; rotas finas; web consome. **≤ 400 linhas / ≤ 10 arquivos por layer**; cada task = 1 commit; `package-lock.json` não muda.
- Artefatos e commits em pt-BR; conventional commits imperativos sem acento no assunto; checkbox por passo.
- Os arquivos de mock (`web/mock-opcoes.html`, `web/src/mock-opcoes.tsx`) e o dev server da porta 5180 são **scratch**: existem só até a Task 5, que os remove. Não commitar.
- No homelab há um container servindo a `main` na porta 3000 (execução concorrente do usuário): **não rodar `docker compose up`** — a verificação usa servidor local na porta 3100 + `docker compose build` (sem recriar o container).
- Aceite numérico/visual (1 ano, out/2025–set/2026): rótulos finais sem colisão (carteira +13,91% vs CDI +14,07%); líquido abr/2026 no tooltip do acumulado = +4,31% (conferir contra `(1+carteira)÷(1+IPCA)−1`).
- Verificação final: `npm test && npm run typecheck && npm run build:web` + servidor :3100 (DB copiado da `main`) + browser nas duas abas + `docker compose build`.

---

## Estrutura de arquivos

```
src/services/performance.ts          # realPct por mês no PerformanceMonth (T1)
src/services/performance.test.ts     # teste do líquido mensal (T1)
src/api/routes/performance.ts        # realPct no shape da resposta (T1)
src/api/app.test.ts                  # shape do mês com realPct (T1)
web/src/api.ts                       # tipo PerformanceMonth.realPct (T2)
web/src/components/EvolucaoChart.tsx # % em linhas + líquido (T2); R$ coluna única (T3); controles + rótulos (T4)
web/src/styles.css                   # grupos de chips + divisor (T4)
ROADMAP.md                           # fechamento da etapa + itens de backlog (T5)
```

---

### Task 1: API — `realPct` por mês

**Files:**
- Modify: `src/services/performance.ts`, `src/services/performance.test.ts`
- Modify: `src/api/routes/performance.ts`, `src/api/app.test.ts`

**Interfaces:**
- Consumes: `realReturnPct(nominalPct: number, inflationPct: number): number` (`src/domain/performance.ts`, já importado no service).
- Produces: `PerformanceMonth.realPct: number | null` (4 casas; `null` se `portfolioPct` ou `ipcaPct` for `null`); campo `realPct` em `months[]` de `GET /api/performance`.

- [ ] **Step 1: Escrever o teste que falha**

Em `src/services/performance.test.ts`, adicionar ao fim do arquivo:

```ts
test("buildPerformance expõe o líquido (Carteira − IPCA) por mês", () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [cdb]);
  insertTransactions(db, [buy("2026-04-23", 100_000n)]);
  writeIndexRates(db, [
    { series: "CDI", date: "2026-05-02", valueE12: 10_000_000_000n },
    { series: "IPCA", date: "2026-05-01", valueE12: 3_000_000_000n },
  ]);

  const result = buildPerformance(db, { from: "2026-05", to: "2026-06" }, { now });
  // maio: carteira +1,0000% e IPCA +0,3000% → (1,01 ÷ 1,003) − 1 = 0,6979%
  assert.equal(result.months[0]?.realPct, 0.6979);
  // junho: sem IPCA no mês → null
  assert.equal(result.months[1]?.realPct, null);
});
```

Em `src/api/app.test.ts`, no teste `GET /api/performance valida a janela e devolve números`, adicionar após a linha `assert.equal(typeof body.mwr.months, "number");`:

```ts
  assert.ok("realPct" in body.months[1], "líquido por mês no shape");
```

- [ ] **Step 2: Rodar os testes para ver falhar**

Run: `npm test`
Expected: falhas em `buildPerformance expõe o líquido` (esperado `0.6979`, recebido `undefined`) e na rota (assertiva `realPct in body.months[1]` falsa). O resto passa.

- [ ] **Step 3: Implementar o mínimo**

Em `src/services/performance.ts`, no tipo `PerformanceMonth`, incluir o campo:

```ts
export type PerformanceMonth = {
  month: string; portfolioPct: number | null; cdiPct: number | null; ipcaPct: number | null; realPct: number | null;
  diffCdiPp: number | null; rendimentoCents: bigint; investedCents: bigint; redeemedCents: bigint;
};
```

E no `months.push({ ... })` do `buildPerformance`:

```ts
    months.push({
      month: point.month, portfolioPct, cdiPct: point.cdiPct, ipcaPct: point.ipcaPct,
      realPct: portfolioPct === null || point.ipcaPct === null ? null : realReturnPct(portfolioPct, point.ipcaPct),
      diffCdiPp: portfolioPct === null || point.cdiPct === null ? null : gapPp(portfolioPct, point.cdiPct),
      rendimentoCents: point.marketValueCents - previous.marketValueCents - point.investedCents + point.redeemedCents,
      investedCents: point.investedCents, redeemedCents: point.redeemedCents,
    });
```

Em `src/api/routes/performance.ts`, no map dos meses, adicionar o campo:

```ts
        month: month.month, portfolioPct: month.portfolioPct, cdiPct: month.cdiPct, ipcaPct: month.ipcaPct,
        realPct: month.realPct,
        diffCdiPp: month.diffCdiPp,
```

- [ ] **Step 4: Rodar os testes para ver passar**

Run: `npm test`
Expected: todos os testes verdes (a suíte fecha sem falhas; o novo teste passa com `0.6979` e `null`).

- [ ] **Step 5: Commit**

```bash
git add src/services/performance.ts src/services/performance.test.ts src/api/routes/performance.ts src/api/app.test.ts
git commit -m "feat: expoe o retorno liquido por mes na api de performance"
```

---

### Task 2: Web — aba % só com linhas + líquido no tooltip

**Files:**
- Modify: `web/src/api.ts`, `web/src/components/EvolucaoChart.tsx`

**Interfaces:**
- Consumes: `PerformanceMonth.realPct` (T1).
- Produces: `LinhaPct.real`/`LinhaAcumulada.real` (número ou `null` mensal; composto no acumulado); `TooltipPct` com a linha "Líquido (Carteira − IPCA)"; aba % sem barras.

- [ ] **Step 1: Atualizar o tipo da API no web**

Em `web/src/api.ts`, no `PerformanceMonth`:

```ts
export type PerformanceMonth = {
  month: string; portfolioPct: number | null; cdiPct: number | null; ipcaPct: number | null; realPct: number | null;
  diffCdiPp: number | null; rendimentoCents: number; investedCents: number; redeemedCents: number;
};
```

- [ ] **Step 2: Reescrever as visões e tooltips do %**

Em `web/src/components/EvolucaoChart.tsx`:

2a. Remover `Cell` do import do Recharts (fica: `Area, Bar, CartesianGrid, ComposedChart, LabelList, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis`).

2b. Atualizar os tipos:

```ts
type LinhaPct = { rotulo: string; carteira: number | null; cdi: number | null; ipca: number | null; real: number | null };
type LinhaAcumulada = { rotulo: string; carteira: number; cdi: number; ipca: number; real: number };
```

2c. `visaoPct` passa a expor `real`:

```ts
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
```

2d. `visaoAcumulada` acumula o líquido:

```ts
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
```

2e. `TooltipPct` ganha o líquido (aceita as duas linhas):

```tsx
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
```

2f. No render, trocar o bloco `subAba === "mes"` (ComposedChart com `Bar`/`Cell`) por um `LineChart` de 3 linhas:

```tsx
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
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build:web`
Expected: ambos sem saída de erro (typecheck limpo; build ok).

- [ ] **Step 4: Verificar no browser**

Subir o servidor local (DB real copiado da `main`):

```bash
mkdir -p data
node --input-type=module -e "import Database from 'better-sqlite3'; const db = new Database('./data/investments.db', { readonly: true }); await db.backup('data/investments.db'); db.close();"
PORT=3100 npm start > /tmp/server-3100.log 2>&1 &
```

Com `agent-browser`: abrir `http://localhost:3100`, ir ao card **Desempenho no período**, clicar no chip **%** e na sub-aba **Acumulado**; conferir: nenhuma barra, 3 linhas (Carteira/CDI/IPCA), e no hover o tooltip mostra **Líquido (Carteira − IPCA)** com valor (ex. abr/2026 = +4,31%). Alternar para **Mês a mês**: 3 linhas com pontos; hover mostra o mesmo bloco de tooltip. Screenshot: `.superpowers/mocks/t2-pct-acumulado.png` e `.superpowers/mocks/t2-pct-mes.png`.

- [ ] **Step 5: Commit**

```bash
git add web/src/api.ts web/src/components/EvolucaoChart.tsx
git commit -m "feat: aba percentual do grafico so com linhas e liquido no tooltip"
```

---

### Task 3: Web — R$ com barras em coluna única e eixo simétrico

**Files:**
- Modify: `web/src/components/EvolucaoChart.tsx`

**Interfaces:**
- Consumes: `LinhaRs` da task anterior (campo `variacaoCents` permanece; `rendimentoCents` sai).
- Produces: `resgateNegCents` (resgate com sinal negativo) e `capitalCents` (acumulado, só para o tooltip); formatação de eixo com negativo (`−R$ <valor> mil`).

- [ ] **Step 1: Trocar os tipos e a visão do R$**

Em `web/src/components/EvolucaoChart.tsx`:

3a. Tipos:

```ts
type LinhaRsBase = { rotulo: string; patrimonioCents: number; aporteCents: number; resgateCents: number; variacaoCents: number };
type LinhaRs = LinhaRsBase & { resgateNegCents: number; capitalCents: number };
```

3b. `visaoRs` (agrupamento trimestral extraído e capital acumulado no fim):

```ts
function visaoRs(meses: Mes[], trimestral: boolean): LinhaRs[] {
  const linhas: LinhaRsBase[] = meses.map((mes) => ({
    rotulo: formataMes(mes.month), patrimonioCents: mes.patrimonioCents,
    aporteCents: mes.investedCents, resgateCents: mes.redeemedCents,
    variacaoCents: mes.rendimentoCents + mes.investedCents - mes.redeemedCents,
  }));
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
```

3c. `TooltipRs` (sem "Rendimento acumulado"; com "Capital acumulado"):

```tsx
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
```

3d. `formataEixoRs` com negativo limpo:

```ts
const formataEixoRs = (cents: number): string => {
  const reais = cents / 100;
  const sinal = reais < 0 ? "−" : "";
  const abs = Math.abs(reais);
  if (abs >= 1_000_000) return `${sinal}R$ ${(abs / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (abs >= 1_000) return `${sinal}R$ ${Math.round(abs / 1_000).toLocaleString("pt-BR")} mil`;
  return `${sinal}R$ ${abs.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
};
```

- [ ] **Step 2: Trocar o render do R$ (coluna única)**

3e. No componente, depois de `const linhasRs = visaoRs(meses, trimestral);`:

```ts
  const maxFluxo = Math.max(1, ...linhasRs.map((linha) => Math.max(linha.aporteCents, linha.resgateCents)));
```

3f. Substituir o bloco `aba === "rs"` por:

```tsx
        {aba === "rs" ? (
          <ComposedChart data={linhasRs} barGap={-16} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="rotulo" tickLine={false} axisLine={false} fontSize={12} />
            <YAxis yAxisId="valor" tickLine={false} axisLine={false} fontSize={12} width={76} tickFormatter={formataEixoRs} />
            <YAxis yAxisId="fluxo" orientation="right" tickLine={false} axisLine={false} fontSize={11} width={68}
              tickFormatter={formataEixoRs} domain={[-maxFluxo, maxFluxo]} />
            <ReferenceLine yAxisId="fluxo" y={0} stroke="var(--border-strong)" />
            <Tooltip content={<TooltipRs />} />
            <Legend />
            <Area yAxisId="valor" type="monotone" dataKey="patrimonioCents" name="Patrimônio" stroke="var(--accent)" fill="var(--accent-soft)" strokeWidth={2} />
            <Bar yAxisId="fluxo" dataKey="aporteCents" name="Aporte" fill="var(--sand)" barSize={16} />
            <Bar yAxisId="fluxo" dataKey="resgateNegCents" name="Resgate" fill="var(--danger)" barSize={16} />
          </ComposedChart>
        ) : subAba === "mes" ? (
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build:web`
Expected: sem erros.

- [ ] **Step 4: Verificar no browser**

Com o servidor :3100 já rodando (se necessário, reiniciar: `kill %2 2>/dev/null; PORT=3100 npm start > /tmp/server-3100.log 2>&1 &`), abrir `http://localhost:3100`, chip **R$**: conferir aporte (areia) para cima e resgate (vermelho) para baixo **na mesma coluna** por mês, zero dos fluxos no meio do gráfico com linha de referência, sem linha de capital, sem barras lado a lado. Hover: tooltip com Patrimônio, Capital acumulado, Aporte e Resgate (sem "Rendimento acumulado"). Screenshot: `.superpowers/mocks/t3-rs.png`.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/EvolucaoChart.tsx
git commit -m "feat: barras de aporte e resgate em coluna unica no grafico em reais"
```

---

### Task 4: Web — controles em dois grupos + rótulos finais sem colisão

**Files:**
- Modify: `web/src/components/EvolucaoChart.tsx`, `web/src/styles.css`

**Interfaces:**
- Consumes: `linhasAcumuladas` (T2), `RotuloFinal` existente.
- Produces: `deslocamentosRotulos(valores: number[], limitePp?: number, passo?: number): number[]`; classes `.chart-controles-grafico`, `.chart-grupo`, `.chart-grupo.invisivel`, `.chart-divisor`.

- [ ] **Step 1: Adicionar o helper de deslocamento e o `dy` no rótulo**

4a. Antes do componente `EvolucaoChart` (junto dos outros helpers):

```ts
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
```

4b. `RotuloFinal` ganha `dy`:

```tsx
function RotuloFinal(props: { index?: number; x?: number | string; y?: number | string; value?: number | string | boolean | null; ultimo: number; dy?: number }) {
  if (props.index !== props.ultimo) return null;
  return (
    <text x={Number(props.x) + 6} y={Number(props.y) + (props.dy ?? 0)} fontSize={11} fill="var(--text-2)">
      {formataPercentual(Number(props.value))}
    </text>
  );
}
```

4c. No componente, antes do `return` (depois de `const linhasAcumuladas = visaoAcumulada(meses);`):

```ts
  const ultimos = linhasAcumuladas.at(-1);
  const desviosRotulos = ultimos === undefined ? [0, 0, 0] : deslocamentosRotulos([ultimos.carteira, ultimos.cdi, ultimos.ipca]);
```

4d. No gráfico acumulado, passar o desvio em cada `LabelList` (mantendo o resto):

```tsx
        <Line type="monotone" dataKey="carteira" name="Carteira" stroke="var(--accent)" strokeWidth={2} dot={false}>
          <LabelList dataKey="carteira" content={(props) => <RotuloFinal {...props} ultimo={linhasAcumuladas.length - 1} dy={desviosRotulos[0]} />} />
        </Line>
        <Line type="monotone" dataKey="cdi" name="CDI" stroke="var(--sand)" strokeWidth={1.5} dot={false}>
          <LabelList dataKey="cdi" content={(props) => <RotuloFinal {...props} ultimo={linhasAcumuladas.length - 1} dy={desviosRotulos[1]} />} />
        </Line>
        <Line type="monotone" dataKey="ipca" name="IPCA" stroke="var(--olive)" strokeWidth={1.5} dot={false}>
          <LabelList dataKey="ipca" content={(props) => <RotuloFinal {...props} ultimo={linhasAcumuladas.length - 1} dy={desviosRotulos[2]} />} />
        </Line>
```

- [ ] **Step 2: Controles em dois grupos com espaço reservado**

4e. Substituir o bloco `<div className="chart-controles">…</div>` por:

```tsx
      <div className="chart-controles-grafico">
        <div className="chart-grupo">
          <button type="button" className={aba === "rs" ? "chip active" : "chip"} onClick={() => setAba("rs")}>R$</button>
          <button type="button" className={aba === "pct" ? "chip active" : "chip"} onClick={() => setAba("pct")}>%</button>
        </div>
        <span className="chart-divisor" aria-hidden="true" />
        <div className={aba === "pct" ? "chart-grupo" : "chart-grupo invisivel"}>
          <button type="button" className={subAba === "mes" ? "chip active" : "chip"} onClick={() => setSubAba("mes")}>Mês a mês</button>
          <button type="button" className={subAba === "acumulado" ? "chip active" : "chip"} onClick={() => setSubAba("acumulado")}>Acumulado</button>
        </div>
        {trimestral && <span className="section-hint">por trimestre</span>}
      </div>
```

4f. Em `web/src/styles.css`, logo depois de `.chart-controles { ... }`:

```css
.chart-controles-grafico { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
.chart-grupo { display: flex; gap: 6px; align-items: center; }
.chart-grupo.invisivel { visibility: hidden; }
.chart-divisor { width: 1px; height: 20px; background: var(--border); }
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build:web`
Expected: sem erros.

- [ ] **Step 4: Verificar no browser**

Com o servidor :3100: (a) alternar **R$** ↔ **%** e conferir que a linha de controles não desloca (mesma posição dos chips; o grupo de granularidade ocupa espaço mas fica invisível no R$); (b) sub-aba **Acumulado** na janela **1 ano**: rótulos finais de Carteira (+13,91%) e CDI (+14,07%) empilhados sem sobreposição; **Tudo**: rótulos separados naturalmente; (c) conferir por teclado que o grupo invisível não recebe foco (Tab passa de % direto para o próximo elemento). Screenshot: `.superpowers/mocks/t4-rotulos-1ano.png`, `.superpowers/mocks/t4-controles.png`.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/EvolucaoChart.tsx web/src/styles.css
git commit -m "feat: controles em grupos sem reflow e rotulos finais sem colisao"
```

---

### Task 5: Fechamento — ROADMAP, limpeza do mock e verificação completa

**Files:**
- Modify: `ROADMAP.md`
- Delete: `web/mock-opcoes.html`, `web/src/mock-opcoes.tsx` (scratch)

**Interfaces:**
- Consumes: tudo das tasks anteriores.
- Produces: etapa registrada no ROADMAP; evidências em `.superpowers/sdd/`.

- [ ] **Step 1: Remover o mock e parar o dev server da porta 5180**

```bash
rm -f web/mock-opcoes.html web/src/mock-opcoes.tsx
pkill -f "vite --port 5180" || true
```

- [ ] **Step 2: Atualizar o ROADMAP**

5a. Na tabela `## Estado atual (2026-09-22)`, adicionar uma linha depois da linha do TWR/MWR:

```markdown
| Desempenho no período — gráfico R$ e % | concluída — branch `desempenho-periodo` |
```

5b. No `## Backlog v2+`, substituir os três bullets do gráfico (linhas "acumulado na aba R$", "aba % só com linhas" e "controles dos chips") por:

```markdown
- ~~Gráfico "Desempenho no período"~~ — concluído em 2026-09-22 (R$ com aporte/resgate em coluna única, % só com linhas + líquido no tooltip, controles em grupos sem reflow). A linha de capital acumulado no R$ foi descartada pelo usuário na revisão.
```

5c. Em `## Próxima ação`, trocar o primeiro parágrafo por:

```markdown
Etapa **Desempenho no período (gráfico)** concluída na branch `desempenho-periodo` (2026-09-22); números de TWR/MWR/reconciliação inalterados (`referenceCents <valor>`, `unexplained 0`). Etapa atual: **vencimento de títulos RF** — spec em `docs/superpowers/specs/2026-09-22-vencimento-titulos-rf-design.md`; próxima: plano de implementação. Depois: v2 (CRUD); **imposto líquido × líquido fica para a v3**.
```

5d. Nos "Itens herdados em aberto", remover o trecho `rótulos finais do gráfico acumulado se sobrepõem quando carteira ≈ CDI; ` (fica só o lazy-load e a revisão de minors).

5e. Na seção `Evidências locais`, adicionar ao fim:

```markdown
- Desempenho no período (2026-09-22, branch `desempenho-periodo`): R$ com aporte/resgate em coluna única (aporte sobe, resgate desce; eixo de fluxos simétrico com zero no meio) e sem linha de capital; % com sub-abas Mês a mês/Acumulado só em linhas (3 séries) e líquido (Carteira − IPCA) no tooltip; controles em dois grupos (R$ · % | Mês a mês · Acumulado) sem reflow; rótulos finais com anti-colisão. API ganhou `realPct` por mês (TWR/MWR/capital inalterados). `npm test` (160 testes), typecheck e `build:web` verdes; screenshots `.superpowers/sdd/grafico-0*.png`.
```

- [ ] **Step 3: Verificação completa**

```bash
npm test
npm run typecheck
npm run build:web
```

Expected: testes todos verdes (número exato aparece no resumo); typecheck limpo; build ok.

```bash
docker compose build
```
Expected: imagem construída sem erro **sem** recriar o container em execução.

Com o servidor :3100 (reconstruído com o novo `web/dist`), conferir no browser as duas abas nas janelas **1 ano** e **Tudo**; salvar as evidências em `./.superpowers/sdd/`:

```bash
mkdir -p ./.superpowers/sdd
# screenshots via agent-browser: grafico-01-rs.png, grafico-02-pct-mes.png, grafico-03-pct-acumulado.png, grafico-04-rotulos.png
```

- [ ] **Step 4: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: fecha a etapa do grafico Desempenho no periodo no roadmap"
```

- [ ] **Step 5: Merge local (após aprovação do usuário)**

```bash
git -C . checkout main
git -C . merge --ff-only desempenho-periodo
git -C . worktree remove .worktrees/desempenho-periodo
```
Expected: fast-forward; worktree removido. (Só executar com o usuário confirmando; o container do homelab segue rodando a `main` até `docker compose up -d --build` ser rodado por ele.)

---

## Autoverificação do plano

- **Cobertura da spec:** API `realPct` (T1); % só linhas + líquido (T2); R$ coluna única + zero simétrico + formatação negativa (T3); controles em grupos + reserva + rótulos (T4); ROADMAP + evidências (T5). Sem linha de capital (decidido fora) e sem mexer em números.
- **Sem placeholders:** todo passo tem código/comando exato.
- **Tipos consistentes:** `LinhaRsBase`/`LinhaRs` definidos na T3 e usados no render da T3; `LinhaPct`/`LinhaAcumulada` com `real` definidos na T2; `deslocamentosRotulos` definido e usado na T4.
