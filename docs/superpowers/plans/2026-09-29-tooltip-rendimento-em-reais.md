# Tooltip em R$ no Rendimento vs CDI e IPCA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o tooltip do gráfico "Rendimento vs CDI e IPCA" mostra, ao lado de cada %, o valor em reais (Carteira, CDI, IPCA e Líquido), mês a mês e acumulado.

**Architecture:** a API `/api/performance` passa a devolver `baseCents` (capital exposto do mês, base do Modified Dietz) calculado no domínio por uma nova `monthlyReturn`; o web converge as 3 taxas para centavos (`baseCents × taxa`, Carteira = `rendimentoCents`) e acumula/soma conforme a visão. Sem mudança nas fórmulas de TWR/MWR/CDI/IPCA.

**Tech Stack:** TypeScript + node:test no backend; React + Recharts no web; sem runner no web (padrão do projeto).

**Spec:** `docs/superpowers/specs/2026-09-29-tooltip-rendimento-em-reais-design.md`.

## Global Constraints

- Zero `float` em dado persistido/cálculo: centavos em `bigint` no domínio; `Number` só na borda de apresentação (`toNumberSafe`).
- Sem mudança de cálculo de TWR/MWR/CDI/IPCA — só exposição da base e apresentação.
- Artefatos e commits em pt-BR; commits convencionais sem acento.
- Cada layer: ≤ 400 linhas / ≤ 10 arquivos; sem dependência nova (lockfile intocado).
- API segue em centavos; único campo novo: `baseCents` (`number | null`).

---

### Task 1: Domínio — `monthlyReturn` com a base do TWR

**Files:**
- Modify: `src/domain/performance.ts:4-26`
- Test: `src/domain/performance.test.ts`

**Interfaces:**
- Produces: `monthlyReturn(prevValueCents: bigint, prevDate: string, valueCents: bigint, valueDate: string, flows: DatedFlow[]): { pct: number; baseCents: bigint } | null`; `monthlyPortfolioPct` mantém assinatura e resultados.

- [ ] **Step 1: Write the failing test**

Adicione ao topo de `src/domain/performance.test.ts` o import de `monthlyReturn` (a linha 3 vira):

```ts
import { accumulatePct, gapPp, monthlyPortfolioPct, monthlyReturn, monthsBeaten, realReturnPct, xirrPct } from "./performance.ts";
```

E acrescente estes dois testes ao fim do arquivo:

```ts
test("monthlyReturn devolve o capital exposto (base do TWR)", () => {
  // sem fluxos: base = valor anterior
  assert.deepEqual(monthlyReturn(100_000n, "2025-04-30", 103_000n, "2025-05-31", []), { pct: 3, baseCents: 100_000n });
  // aporte no último dia pesa 0 dias → base não muda
  assert.deepEqual(monthlyReturn(100_000n, "2025-04-30", 103_000n, "2025-05-31", [{ date: "2025-05-31", cents: 2_000n }]), { pct: 1, baseCents: 100_000n });
  // aporte de <valor> em 16/05 (15 de 31 dias): base <valor> + <valor> = <valor>; delta <valor> → 0,9857%
  assert.deepEqual(monthlyReturn(100_000n, "2025-04-30", 104_000n, "2025-05-31", [{ date: "2025-05-16", cents: 3_000n }]), { pct: 0.9857, baseCents: 101_452n });
  // resgate de <valor> em 10/05 (21 de 31 dias): base <valor> − <valor> = <valor> (mesmo % do teste de monthlyPortfolioPct)
  assert.deepEqual(monthlyReturn(100_000n, "2025-04-30", 98_000n, "2025-05-31", [{ date: "2025-05-10", cents: -5_000n }]), { pct: 3.1052, baseCents: 96_613n });
  // caso real de mai/2025: base <valor> + <valor> = <valor>
  assert.equal(monthlyReturn(5_761_702n, "2025-04-30", 10_786_488n, "2025-05-31", [
    { date: "2025-05-05", cents: 729_476n },
    { date: "2025-05-06", cents: 708_391n },
    { date: "2025-05-07", cents: 3_470_542n },
  ])?.baseCents, 9_631_675n);
});

test("monthlyReturn devolve null nas mesmas guardas de monthlyPortfolioPct", () => {
  assert.equal(monthlyReturn(0n, "2025-04-30", 10_000n, "2025-05-31", []), null);
  assert.equal(monthlyReturn(100_000n, "2025-05-31", 100_000n, "2025-05-31", []), null);
  assert.equal(monthlyReturn(100_000n, "2025-04-30", 0n, "2025-05-31", [{ date: "2025-05-02", cents: -110_000n }]), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/domain/performance.test.ts`
Expected: FAIL — `SyntaxError`/`monthlyReturn is not a function` (import inexistente).

- [ ] **Step 3: Write minimal implementation**

Em `src/domain/performance.ts`, substitua a função `monthlyPortfolioPct` (linhas 4–26) por:

```ts
/** Retorno e capital exposto do mês (Modified Dietz, fluxos ponderados pelos dias investidos); null sem base/período. */
export function monthlyReturn(
  prevValueCents: bigint,
  prevDate: string,
  valueCents: bigint,
  valueDate: string,
  flows: DatedFlow[],
): { pct: number; baseCents: bigint } | null {
  if (prevValueCents <= 0n) return null;
  const periodDays = daysBetween(prevDate, valueDate);
  if (periodDays <= 0) return null;
  let totalFlow = 0n;
  let weightedFlow = 0n;
  for (const flow of flows) {
    totalFlow += flow.cents;
    const investedDays = Math.min(Math.max(daysBetween(flow.date, valueDate), 0), periodDays);
    weightedFlow += flow.cents * BigInt(investedDays);
  }
  const denominator = prevValueCents * BigInt(periodDays) + weightedFlow;
  if (denominator <= 0n) return null;
  const delta = valueCents - prevValueCents - totalFlow;
  return {
    pct: Number(divRoundHalfUp(delta * 1_000_000n * BigInt(periodDays), denominator)) / 10_000,
    baseCents: prevValueCents + divRoundHalfUp(weightedFlow, BigInt(periodDays)),
  };
}

/** Retorno do período em % (4 casas) com fluxos ponderados pelos dias investidos (Modified Dietz); null sem base/período. */
export function monthlyPortfolioPct(
  prevValueCents: bigint,
  prevDate: string,
  valueCents: bigint,
  valueDate: string,
  flows: DatedFlow[],
): number | null {
  return monthlyReturn(prevValueCents, prevDate, valueCents, valueDate, flows)?.pct ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/domain/performance.test.ts`
Expected: PASS — 8 testes (6 existentes + 2 novos).

- [ ] **Step 5: Commit**

```bash
git add src/domain/performance.ts src/domain/performance.test.ts
git commit -m "feat: monthlyReturn expoe a base do TWR"
```

---

### Task 2: Serviço e rota — `baseCents` no `/api/performance`

**Files:**
- Modify: `src/services/performance.ts:1-35`
- Modify: `src/services/performance.test.ts:33-42,62-71`
- Modify: `src/api/routes/performance.ts:17-31`
- Modify: `src/api/app.test.ts:466-487`
- Modify: `web/src/api.ts:82-85`

**Interfaces:**
- Consumes: `monthlyReturn` (Task 1).
- Produces: `PerformanceMonth.baseCents: bigint | null` (serviço); `baseCents: number | null` no JSON e no tipo do web.

- [ ] **Step 1: Write the failing tests**

Em `src/services/performance.test.ts`, no primeiro teste, logo depois de `assert.equal(result.months[1]?.rendimentoCents, 1_010n);` (linha 37), adicione:

```ts
  assert.deepEqual(result.months.map((month) => month.baseCents), [100_000n, 134_333n]);
```

Ainda no mesmo arquivo, no teste "buildPerformance sem dados devolve meses nulos e MWR nulo", depois de `assert.equal(result.months[0]?.portfolioPct, null);` (linha 67), adicione:

```ts
  assert.equal(result.months[0]?.baseCents, null);
```

Em `src/api/app.test.ts`, no teste "GET /api/performance valida a janela e devolve números", depois de `assert.equal(body.months[1].realPct, null, "sem IPCA no mês, o líquido é null");` (linha 480), adicione:

```ts
  assert.equal(body.months[1].baseCents, null, "sem base no mês, baseCents null");
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/services/performance.test.ts src/api/app.test.ts`
Expected: FAIL — `baseCents` `undefined` nos três pontos (`deepEqual` e `equal`).

- [ ] **Step 3: Write minimal implementation**

Em `src/services/performance.ts`:

3a. Troque a linha 3 (import) por:

```ts
import { accumulatePct, gapPp, monthlyReturn, monthsBeaten, realReturnPct, xirrPct, type DatedFlow } from "../domain/performance.ts";
```

3b. O tipo `PerformanceMonth` (linhas 6–9) vira:

```ts
export type PerformanceMonth = {
  month: string; portfolioPct: number | null; baseCents: bigint | null; cdiPct: number | null; ipcaPct: number | null; realPct: number | null;
  diffCdiPp: number | null; rendimentoCents: bigint; investedCents: bigint; redeemedCents: bigint;
};
```

3c. No laço de `buildPerformance`, as linhas 26–33 viram:

```ts
    const retorno = monthlyReturn(previous.marketValueCents, previous.asOf, point.marketValueCents, point.asOf, point.flows);
    const portfolioPct = retorno?.pct ?? null;
    months.push({
      month: point.month, portfolioPct, baseCents: retorno?.baseCents ?? null, cdiPct: point.cdiPct, ipcaPct: point.ipcaPct,
      realPct: portfolioPct === null || point.ipcaPct === null ? null : realReturnPct(portfolioPct, point.ipcaPct),
      diffCdiPp: portfolioPct === null || point.cdiPct === null ? null : gapPp(portfolioPct, point.cdiPct),
      rendimentoCents: point.marketValueCents - previous.marketValueCents - point.investedCents + point.redeemedCents,
      investedCents: point.investedCents, redeemedCents: point.redeemedCents,
    });
```

Em `src/api/routes/performance.ts`, o map dos meses (linhas 19–26) ganha a linha:

```ts
        baseCents: month.baseCents === null ? null : toNumberSafe(month.baseCents),
```

ficando:

```ts
      months: result.months.map((month) => ({
        month: month.month, portfolioPct: month.portfolioPct, cdiPct: month.cdiPct, ipcaPct: month.ipcaPct,
        realPct: month.realPct,
        diffCdiPp: month.diffCdiPp,
        rendimentoCents: toNumberSafe(month.rendimentoCents),
        baseCents: month.baseCents === null ? null : toNumberSafe(month.baseCents),
        investedCents: toNumberSafe(month.investedCents),
        redeemedCents: toNumberSafe(month.redeemedCents),
      })),
```

Em `web/src/api.ts`, o tipo `PerformanceMonth` (linhas 82–85) vira:

```ts
export type PerformanceMonth = {
  month: string; portfolioPct: number | null; baseCents: number | null; cdiPct: number | null; ipcaPct: number | null; realPct: number | null;
  diffCdiPp: number | null; rendimentoCents: number; investedCents: number; redeemedCents: number;
};
```

- [ ] **Step 4: Run tests and typecheck to verify they pass**

Run: `node --test src/services/performance.test.ts src/api/app.test.ts`
Expected: PASS — todos os testes dos dois arquivos.

Run: `npm run typecheck`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/services/performance.ts src/services/performance.test.ts src/api/routes/performance.ts src/api/app.test.ts web/src/api.ts
git commit -m "feat: performance devolve baseCents por mes"
```

---

### Task 3: Web — tooltip com R$ no `RendimentoChart`

**Files:**
- Modify: `web/src/components/RendimentoChart.tsx`

**Interfaces:**
- Consumes: `PerformanceMonth.baseCents` (Task 2), `Mes` (`web/src/components/graficoComum.tsx:3`), `formataBRLSinal` (`web/src/format.ts:5`).
- Produces: tooltip `Carteira: +1,47% (R$ <valor>)` etc., nas duas visões.

- [ ] **Step 1: Aplicar as mudanças no arquivo**

1a. O import da linha 3 vira:

```ts
import { formataMes, formataPercentual, formataPercentualSinal, formataBRLSinal, formataPontosPercentuais } from "../format.ts";
```

1b. Os tipos e helpers das linhas 7–8 (`LinhaPct`/`LinhaAcumulada`) viram:

```ts
type ValoresCents = { carteiraCents: number | null; cdiCents: number | null; ipcaCents: number | null; realCents: number | null };
type LinhaPct = ValoresCents & { rotulo: string; carteira: number | null; cdi: number | null; ipca: number | null; real: number | null };
type LinhaAcumulada = ValoresCents & { rotulo: string; carteira: number; cdi: number; ipca: number; real: number };

function centavosDoMes(mes: Mes): ValoresCents {
  const carteiraCents = mes.portfolioPct === null ? null : mes.rendimentoCents;
  const cdiCents = mes.baseCents === null || mes.cdiPct === null ? null : Math.round((mes.baseCents * mes.cdiPct) / 100);
  const ipcaCents = mes.baseCents === null || mes.ipcaPct === null ? null : Math.round((mes.baseCents * mes.ipcaPct) / 100);
  return {
    carteiraCents, cdiCents, ipcaCents,
    realCents: carteiraCents === null || ipcaCents === null ? null : carteiraCents - ipcaCents,
  };
}

function somaCents(valores: Array<number | null>): number | null {
  let total: number | null = null;
  for (const valor of valores) if (valor !== null) total = (total ?? 0) + valor;
  return total;
}
```

1c. `visaoPct` (linhas 10–28) vira:

```ts
function visaoPct(meses: Mes[], trimestral: boolean): LinhaPct[] {
  if (!trimestral) {
    return meses.map((mes) => ({
      rotulo: formataMes(mes.month), carteira: mes.portfolioPct, cdi: mes.cdiPct, ipca: mes.ipcaPct, real: mes.realPct,
      ...centavosDoMes(mes),
    }));
  }
  const linhas: LinhaPct[] = [];
  for (let inicio = 0; inicio < meses.length; inicio += 3) {
    const grupo = meses.slice(inicio, inicio + 3);
    const centavos = grupo.map(centavosDoMes);
    linhas.push({
      rotulo: rotuloTrimestre(grupo[0]!.month),
      carteira: acumula(grupo.map((mes) => mes.portfolioPct)),
      cdi: acumula(grupo.map((mes) => mes.cdiPct)),
      ipca: acumula(grupo.map((mes) => mes.ipcaPct)),
      real: acumula(grupo.map((mes) => mes.realPct)),
      carteiraCents: somaCents(centavos.map((valor) => valor.carteiraCents)),
      cdiCents: somaCents(centavos.map((valor) => valor.cdiCents)),
      ipcaCents: somaCents(centavos.map((valor) => valor.ipcaCents)),
      realCents: somaCents(centavos.map((valor) => valor.realCents)),
    });
  }
  return linhas;
}
```

1d. `visaoAcumulada` (linhas 30–44) vira:

```ts
function visaoAcumulada(meses: Mes[]): LinhaAcumulada[] {
  const linhas: LinhaAcumulada[] = [];
  let carteira = 1, cdi = 1, ipca = 1, real = 1;
  let carteiraCents = 0, cdiCents = 0, ipcaCents = 0;
  let temCarteira = false, temCdi = false, temIpca = false;
  for (const mes of meses) {
    if (mes.portfolioPct !== null) carteira *= 1 + mes.portfolioPct / 100;
    if (mes.cdiPct !== null) cdi *= 1 + mes.cdiPct / 100;
    if (mes.ipcaPct !== null) ipca *= 1 + mes.ipcaPct / 100;
    if (mes.realPct !== null) real *= 1 + mes.realPct / 100;
    const centavos = centavosDoMes(mes);
    if (centavos.carteiraCents !== null) { carteiraCents += centavos.carteiraCents; temCarteira = true; }
    if (centavos.cdiCents !== null) { cdiCents += centavos.cdiCents; temCdi = true; }
    if (centavos.ipcaCents !== null) { ipcaCents += centavos.ipcaCents; temIpca = true; }
    linhas.push({
      rotulo: formataMes(mes.month), carteira: (carteira - 1) * 100, cdi: (cdi - 1) * 100,
      ipca: (ipca - 1) * 100, real: (real - 1) * 100,
      carteiraCents: temCarteira ? carteiraCents : null,
      cdiCents: temCdi ? cdiCents : null,
      ipcaCents: temIpca ? ipcaCents : null,
      realCents: temCarteira && temIpca ? carteiraCents - ipcaCents : null,
    });
  }
  return linhas;
}
```

1e. `TooltipPct` (linhas 46–59) vira:

```ts
function valorComCents(pct: number | null, cents: number | null): string {
  const texto = pct === null ? "—" : formataPercentualSinal(pct);
  return cents === null ? texto : `${texto} (${formataBRLSinal(cents)})`;
}

function TooltipPct({ active, payload }: { active?: boolean; payload?: Array<{ payload: LinhaPct | LinhaAcumulada }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const linha = payload[0]!.payload;
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-title">{linha.rotulo}</p>
      <p>Carteira: {valorComCents(linha.carteira, linha.carteiraCents)}</p>
      <p>CDI: {valorComCents(linha.cdi, linha.cdiCents)}</p>
      <p>IPCA: {valorComCents(linha.ipca, linha.ipcaCents)}</p>
      <p>Líquido (Carteira − IPCA): <strong>{valorComCents(linha.real, linha.realCents)}</strong></p>
    </div>
  );
}
```

O resto do arquivo (gráficos, rótulos, resumo) não muda.

- [ ] **Step 2: Verificar tipos e build**

Run: `npm run typecheck`
Expected: sem erros (inclui `web/tsconfig.json`).

Run: `npm run build:web`
Expected: build ok (warning de chunk > 500 kB é conhecido e aceito).

- [ ] **Step 3: Commit**

```bash
git add web/src/components/RendimentoChart.tsx
git commit -m "feat: tooltip do rendimento mostra os valores em reais"
```

---

### Task 4: Verificação completa, evidência e merge

**Files:**
- Modify: `ROADMAP.md` (linha nova em "Estado atual", abaixo da entrada do agrupamento de Posições)

- [ ] **Step 1: Suíte completa e build**

Run: `npm test`
Expected: PASS — 229 testes da main + 2 novos (domínio) = 231 verdes (serviço e rota ganham asserções em testes existentes).

Run: `npm run typecheck && npm run build:web`
Expected: sem erros; build ok.

- [ ] **Step 2: Docker + health**

Run: `docker compose up -d --build && curl -s localhost:3000/api/health`
Expected: container `healthy`; JSON sem fonte em erro; `GET /api/performance` com `baseCents` numérico nos meses com TWR.

Conferência à mão (substituir `<MÊS>` por um mês com movimentação, ex. `2026-04`):

```bash
curl -s "localhost:3000/api/performance?from=2000-01&to=2026-09" | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  const m=JSON.parse(d).months.find(x=>x.month==='2026-04');
  console.log(m, 'cdi R$', (m.baseCents*m.cdiPct/100/100).toFixed(2), 'ipca R$', (m.baseCents*m.ipcaPct/100/100).toFixed(2));
});"
```

Expected: Carteira R$ = `rendimentoCents / 100`; CDI/IPCA R$ = `baseCents × taxa`.

- [ ] **Step 3: Browser (dados reais)**

Com o app em `localhost:3000`, usando a skill `agent-browser`:

1. Abrir a Evolução (ou a Visão geral) e selecionar "Rendimento vs CDI e IPCA" com "Tudo" (jun/2025 – set/2026).
2. Hover em um mês com movimentação (ex. abr/2026): tooltip mostra `Carteira: +1,xx% (R$ <valor>)`, `CDI: … (R$ …)`, `IPCA: … (R$ …)`, `Líquido … (R$ …)` — Carteira bate com `rendimentoCents` da API e CDI/IPCA com a conferência do Step 2.
3. Trocar para "Acumulado": R$ = soma dos meses até o ponto (conferir o último ponto contra a soma manual dos `rendimentoCents`).
4. Hover em um mês sem base (se houver): `—`.
5. Screenshot em `.superpowers/sdd/tooltip-rendimento-01.png` (mês) e `-02.png` (acumulado).
6. Nota: agregação trimestral (>24 meses) não é exercitável com os 16 meses da série real — fica coberta pelo código comum de soma (mesmo caminho do mês a mês).

- [ ] **Step 4: Atualizar o ROADMAP**

Adicionar em `ROADMAP.md` (§Estado atual), após a linha do agrupamento de Posições:

```md
| Tooltip em R$ no Rendimento vs CDI e IPCA | concluída — merge local na main (branch `tooltip-rendimento-rs`) |
```

E uma entrada de evidência (mesmo estilo das demais) com: branch, o que mudou (API `baseCents` + tooltip), os números conferidos no browser, contagem de testes, screenshots e link da spec.

- [ ] **Step 5: Commit, merge e verificação final**

```bash
git add ROADMAP.md
git commit -m "docs: evidencia do tooltip em reais no rendimento"
git checkout main && git merge --ff-only tooltip-rendimento-rs
```

Expected: merge ff sem conflito; `npm test` segue verde; `git log --oneline -4` mostra os commits da branch na main.
