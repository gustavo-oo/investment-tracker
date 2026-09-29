# TWR/MWR por fluxos datados — Plano de Implementação

> **Para agentes:** sub-skill obrigatória: `superpowers:executing-plans` (execução inline, padrão bento) com TDD task a task. Passos usam checkbox (`- [ ]`). Backend primeiro, depois web.

**Goal:** trocar a aproximação "fluxo no fim do mês" do TWR por Modified Dietz ponderado por dia, trocar a TIR mensal do MWR por XIRR sobre fluxos datados (ACT/365) e fazer a série de retorno começar em jun/2025 (os lançamentos de abr–mai são lotes de migração registrados pelo valor bruto do dia). Nenhuma mudança de shape na API.

**Architecture:** `domain/dates.ts` ganha `daysBetween`; `domain/performance.ts` ganha `DatedFlow`/`xirrPct` e `monthlyPortfolioPct` passa a receber datas + fluxos; `services/history.ts` passa a expor `asOf` e `flows` datados no `HistoryPoint` e aplica o piso `SERIES_START_MONTH = "2025-06"` em `resolveHistoryWindow`; `services/performance.ts` monta os meses e o MWR com fluxos datados; web só muda textos de modal.

**Tech Stack:** Node 22 + TypeScript (type-stripping), Fastify 5, better-sqlite3, `node:test`; web com Vite + React 19.

**Spec:** `docs/superpowers/specs/2026-09-22-twr-mwr-fluxos-datados-design.md`

## Global Constraints

- Node ≥ 22.18, ESM, imports `.ts` explícitos; backend sem build (type-stripping). `node:test`; nenhum teste com rede.
- Zero `float` em dado persistido/cálculo: BigInt escalonado até a divisão final; `Number` só em percentuais de apresentação (4 casas).
- Convenção de sinal dos fluxos no domínio e no `HistoryPoint`: **aporte > 0, resgate < 0** (perspectiva da carteira).
- Camadas: `domain` sem I/O; services calculam; rotas finas. PR (bento): **≤ 400 linhas / ≤ 10 arquivos por layer**; cada task = 1 commit; `package-lock.json` não muda nesta etapa.
- Artefatos e commits em pt-BR; conventional commits imperativos; checkbox por passo.
- Corte da série: `SERIES_START_MONTH = "2025-06"` em `resolveHistoryWindow` (motivo no comentário: 23/04 = 23 compras/R$ <valor> e 05–07/05 = 31 compras/R$ <valor> posições migradas pelo valor bruto do dia). Capital/"Sobre o capital" não muda.
- Aceite numérico (dados reais, 2026-09-22 — re-medir no fim): Desde o início (jun/2025–set/2026, 16 meses) TWR **+19,31%** · CDI +19,59% · IPCA +4,63% · −0,29 p.p. · **6/16** · MWR **+19,37%**; 1 ano (out/2025–set/2026) TWR +13,92% · CDI +14,07% · IPCA +3,73% · −0,15 p.p. · 6/12 · MWR +14,01%; reconciliação `referenceCents <valor>`, `unexplained 0`.
- Verificação final: `npm test && npm run typecheck && npm run build:web && docker compose up -d --build` + browser.

---

## Estrutura de arquivos

```
src/domain/dates.ts                  # daysBetween (T1)
src/domain/dates.test.ts             # teste do daysBetween (T1)
src/domain/performance.ts            # DatedFlow + xirrPct (T1); nova assinatura do TWR, mwrPct removido (T3)
src/domain/performance.test.ts       # xirr (T1); TWR datado, mwrPct removido (T3)
src/services/history.ts              # asOf + flows no HistoryPoint (T2); piso jun/2025 (T3)
src/services/history.test.ts         # asOf/flows (T2); piso (T3)
src/services/performance.ts          # fluxos datados no TWR e no MWR (T3)
src/services/performance.test.ts     # datas 2026 + expectativas novas (T3)
web/src/views/OverviewView.tsx       # textos dos modais (T4)
ROADMAP.md                           # fechamento (T5)
```

---

### Task 1: Domínio — `daysBetween` e `xirrPct` (aditivo)

**Files:**
- Modify: `src/domain/dates.ts`, `src/domain/dates.test.ts`
- Modify: `src/domain/performance.ts`, `src/domain/performance.test.ts`

**Interfaces:**
- Consumes: `divRoundHalfUp` (`src/domain/money.ts`) — não nesta task.
- Produces: `daysBetween(a: string, b: string): number`; `DatedFlow = { date: string; cents: bigint }`; `xirrPct(startCents: bigint, startDate: string, flows: DatedFlow[], endCents: bigint, endDate: string): number | null` (TIR **anual** ACT/365 em %, 4 casas).
- `monthlyPortfolioPct` e `mwrPct` ficam intactos nesta task (o service ainda usa).

- [ ] **Step 1: Escrever os testes que falham**

Em `src/domain/dates.test.ts`, adicionar ao import `daysBetween` e o teste no fim:

```ts
test("daysBetween conta dias de calendário nos dois sentidos", () => {
  assert.equal(daysBetween("2025-04-30", "2025-05-31"), 31);
  assert.equal(daysBetween("2025-05-31", "2025-04-30"), -31);
  assert.equal(daysBetween("2028-02-28", "2028-03-01"), 2);
  assert.equal(daysBetween("2025-01-01", "2025-01-01"), 0);
});
```

Em `src/domain/performance.test.ts`, adicionar `xirrPct` ao import e o teste:

```ts
test("xirrPct acha a TIR anual (ACT/365) e devolve null sem raiz", () => {
  // <valor> → <valor> em 365 dias = 10% a.a.
  assert.equal(xirrPct(100_000n, "2025-01-01", [], 110_000n, "2026-01-01"), 10);
  // aporte de <valor> em 01/07 pesa no meio do caminho
  assert.equal(xirrPct(100_000n, "2025-01-01", [{ date: "2025-07-01", cents: 50_000n }], 165_000n, "2026-01-01"), 12.0487);
  // perda extrema fica fora do intervalo [−0,9; 10] → null
  assert.equal(xirrPct(100_000n, "2025-01-01", [], 5_000n, "2026-01-01"), null);
  // nada investido → null
  assert.equal(xirrPct(0n, "2025-01-01", [], 0n, "2026-01-01"), null);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/domain/dates.test.ts src/domain/performance.test.ts`
Expected: FAIL — `daysBetween is not a function` / `xirrPct is not a function`.

- [ ] **Step 3: Implementar**

Em `src/domain/dates.ts`, adicionar no fim (antes dos regex de validação):

```ts
/** Dias de calendário de `b − a` (positivo se `b` é depois de `a`); UTC, sem fuso/DST. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
```

Em `src/domain/performance.ts`, adicionar o import de `daysBetween` e, abaixo de `monthsBeaten`:

```ts
import { daysBetween } from "./dates.ts";
```

```ts
/** Fluxo datado na perspectiva da carteira: aporte > 0, resgate < 0. */
export type DatedFlow = { date: string; cents: bigint };

const YEAR_DAYS = 365;
const XIRR_MIN_RATE = -0.9;
const XIRR_MAX_RATE = 10;

/** TIR anual (ACT/365) em % (4 casas); null se nada foi investido ou sem troca de sinal no intervalo. */
export function xirrPct(
  startCents: bigint,
  startDate: string,
  flows: DatedFlow[],
  endCents: bigint,
  endDate: string,
): number | null {
  const invested = flows.reduce((total, flow) => total + (flow.cents < 0n ? -flow.cents : flow.cents), startCents);
  if (invested === 0n) return null;
  const elapsedDays = [0, ...flows.map((flow) => daysBetween(startDate, flow.date)), daysBetween(startDate, endDate)];
  const cents = [-startCents, ...flows.map((flow) => -flow.cents), endCents];
  const npv = (rate: number): number => {
    let total = 0;
    for (let index = 0; index < cents.length; index++) {
      total += Number(cents[index]!) / (1 + rate) ** (elapsedDays[index]! / YEAR_DAYS);
    }
    return total;
  };
  if (npv(XIRR_MIN_RATE) * npv(XIRR_MAX_RATE) > 0) return null;
  let low = XIRR_MIN_RATE;
  let high = XIRR_MAX_RATE;
  for (let iteration = 0; iteration < 300; iteration++) {
    const mid = (low + high) / 2;
    if (npv(low) * npv(mid) <= 0) high = mid;
    else low = mid;
  }
  return Math.round(((low + high) / 2) * 1_000_000) / 10_000;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test src/domain/dates.test.ts src/domain/performance.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/dates.ts src/domain/dates.test.ts src/domain/performance.ts src/domain/performance.test.ts
git commit -m "feat: adiciona daysBetween e xirrPct ao dominio"
```

---

### Task 2: Histórico — `asOf` e fluxos datados no `HistoryPoint`

**Files:**
- Modify: `src/services/history.ts`, `src/services/history.test.ts`

**Interfaces:**
- Consumes: `DatedFlow` (Task 1).
- Produces: `HistoryPoint` com `asOf: string` (data de valorização: fim do mês ou hoje no mês corrente) e `flows: DatedFlow[]` (transações do mês, sinal da carteira; BUY = `gross + fees`, SELL = `−gross`).
- Sem mudança de comportamento: MV, invested, redeemed e janela seguem iguais; `/api/history` não muda (a rota mapeia campos explicitamente).

- [ ] **Step 1: Escrever os testes que falham**

Em `src/services/history.test.ts`:

Teste 1 ("history inclui previdência com cota") — acrescentar antes do fechamento:

```ts
  assert.equal(points[0]?.asOf, "2026-09-18", "mês corrente usa hoje como data de valorização");
  assert.deepEqual(points[0]?.flows, [{ date: "2026-09-17", cents: 50_000n }]);
```

Teste 2 ("history devolve 12 meses com total, aportes e índices do mês") — acrescentar depois das asserções de `jan`:

```ts
  assert.equal(jan?.asOf, "2026-01-31");
  assert.deepEqual(jan?.flows, [{ date: "2026-01-02", cents: 105_000n }], "compra soma taxas no fluxo");
  assert.deepEqual(feb?.flows, [{ date: "2026-02-10", cents: -20_000n }], "resgate entra negativo e sem taxas");
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/services/history.test.ts`
Expected: FAIL — `points[0]?.asOf` é `undefined`.

- [ ] **Step 3: Implementar**

Em `src/services/history.ts`, adicionar o import do tipo e os campos:

```ts
import type { DatedFlow } from "../domain/performance.ts";
```

```ts
export type HistoryPoint = {
  month: string;
  asOf: string;
  marketValueCents: bigint;
  investedCents: bigint;
  redeemedCents: bigint;
  flows: DatedFlow[];
  cdiPct: number | null;
  ipcaPct: number | null;
};
```

No laço de `buildHistory`, acumular os fluxos do mês — o retorno do `.map` passa a ser:

```ts
  return monthRange(from, to).map((month) => {
    const asOf = month === currentMonth ? today : monthEnd(month);
    let marketValueCents = 0n;
    let investedCents = 0n;
    let redeemedCents = 0n;
    const flows: DatedFlow[] = [];
    for (const instrument of instruments) {
      const instrumentTransactions = transactions.filter((transaction) => transaction.instrumentId === instrument.id);
      const instrumentQuotes = instrument.ticker === null ? [] : quotes.filter((quote) => quote.ticker === instrument.ticker);
      const instrumentFundQuotas = instrument.kind === "pension" && instrument.quoteSymbol !== null
        ? fundQuotas.filter((quota) => quota.symbol === instrument.quoteSymbol)
        : [];
      const series = instrument.benchmark === "SELIC" ? "SELIC" : instrument.benchmark === "CDI" ? "CDI" : null;
      const instrumentRates = series === null ? [] : rates.filter((rate) => rate.series === series);
      const value = instrumentValue({
        kind: instrument.kind, benchmark: instrument.benchmark, rateE6: instrument.rateE6,
        transactions: instrumentTransactions, quotes: instrumentQuotes, rates: instrumentRates,
        pensionQuotes: instrumentFundQuotas,
      }, asOf);
      marketValueCents += value.marketValueCents ?? 0n;
      investedCents += sumMonth(instrumentTransactions, month, "BUY");
      redeemedCents += sumMonth(instrumentTransactions, month, "SELL");
      for (const transaction of instrumentTransactions) {
        if (transaction.tradeDate.slice(0, 7) !== month) continue;
        flows.push({
          date: transaction.tradeDate,
          cents: transaction.kind === "BUY" ? transaction.grossCents + transaction.feesCents : -transaction.grossCents,
        });
      }
    }
    return { month, asOf, marketValueCents, investedCents, redeemedCents, flows, cdiPct: cdiMonthPct(cdiRates, month), ipcaPct: ipcaMonthPct(ipcaRates, month) };
  });
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test src/services/history.test.ts && npm run typecheck`
Expected: PASS e typecheck limpo (o service de performance ignora os campos novos).

- [ ] **Step 5: Commit**

```bash
git add src/services/history.ts src/services/history.test.ts
git commit -m "feat: expoe asOf e fluxos datados no HistoryPoint"
```

---

### Task 3: Corte do cálculo e da janela (Modified Dietz + XIRR + piso jun/2025)

**Files:**
- Modify: `src/domain/performance.ts` (nova assinatura de `monthlyPortfolioPct`; remover `mwrPct`)
- Modify: `src/domain/performance.test.ts` (testes do TWR datado; remover testes de `mwrPct`)
- Modify: `src/services/history.ts` (piso `SERIES_START_MONTH`), `src/services/history.test.ts`
- Modify: `src/services/performance.ts`, `src/services/performance.test.ts`

**Interfaces:**
- Consumes: `daysBetween`/`xirrPct`/`DatedFlow` (Task 1); `HistoryPoint.asOf`/`flows` (Task 2).
- Produces: `monthlyPortfolioPct(prevValueCents: bigint, prevDate: string, valueCents: bigint, valueDate: string, flows: DatedFlow[]): number | null`; `resolveHistoryWindow` com piso jun/2025.

- [ ] **Step 1: Escrever os testes que falham**

Em `src/domain/performance.test.ts`, trocar o import (perde `mwrPct`), substituir o teste de `monthlyPortfolioPct` e remover o teste de `mwrPct`:

```ts
import { accumulatePct, gapPp, monthlyPortfolioPct, monthsBeaten, xirrPct } from "./performance.ts";
```

```ts
test("monthlyPortfolioPct desconta fluxos e devolve null sem base", () => {
  // sem fluxos: (<valor> − <valor>) / <valor> = 3%
  assert.equal(monthlyPortfolioPct(100_000n, "2025-04-30", 103_000n, "2025-05-31", []), 3);
  // aporte no último dia do mês pesa 0: (<valor> − <valor> − 2000) / <valor> = 1%
  assert.equal(monthlyPortfolioPct(100_000n, "2025-04-30", 103_000n, "2025-05-31", [{ date: "2025-05-31", cents: 2_000n }]), 1);
  // resgate no último dia do mês: (<valor> − <valor> + 500) / <valor> = −2%
  assert.equal(monthlyPortfolioPct(100_000n, "2025-04-30", 97_500n, "2025-05-31", [{ date: "2025-05-31", cents: -500n }]), -2);
  assert.equal(monthlyPortfolioPct(0n, "2025-04-30", 10_000n, "2025-05-31", []), null);
});

test("monthlyPortfolioPct pondera o fluxo pelos dias investidos", () => {
  // caso real de mai/2025: base <valor>, aportes em 05/05 (<valor>), 06/05 (<valor>) e 07/05 (<valor>)
  assert.equal(monthlyPortfolioPct(5_761_702n, "2025-04-30", 10_786_488n, "2025-05-31", [
    { date: "2025-05-05", cents: 729_476n },
    { date: "2025-05-06", cents: 708_391n },
    { date: "2025-05-07", cents: 3_470_542n },
  ]), 1.2083); // era 2.0198 no método antigo
  // resgate no meio do mês reduz o denominador
  assert.equal(monthlyPortfolioPct(100_000n, "2025-04-30", 98_000n, "2025-05-31", [{ date: "2025-05-10", cents: -5_000n }]), 3.1052);
  // mês corrente parcial: base 31/08, valor em 22/09, aporte em 17/09 (5 de 22 dias)
  assert.equal(monthlyPortfolioPct(100_000n, "2025-08-31", 112_000n, "2025-09-22", [{ date: "2025-09-17", cents: 10_000n }]), 1.9556);
  // resgate que zera a base no meio do mês → null
  assert.equal(monthlyPortfolioPct(100_000n, "2025-04-30", 0n, "2025-05-31", [{ date: "2025-05-02", cents: -110_000n }]), null);
});
```

Em `src/services/history.test.ts`, mudar as expectativas do piso:

```ts
  // abr/2025 é atividade inicial; o piso da série é jun/2025 (migrações de abr–mai não contam como aporte)
  assert.deepEqual(resolveHistoryWindow(db, { from: "2000-01", to: "2026-09" }, { now }), { from: "2025-06", to: "2026-09" });
```

E no teste sem transações (renomear):

```ts
test("resolveHistoryWindow sem transações clampa no piso da série", () => {
  const db = openDb(":memory:");
  migrate(db);
  const now = () => new Date("2026-09-18T12:00:00-03:00");
  assert.deepEqual(resolveHistoryWindow(db, { from: "2000-01", to: "2026-09" }, { now }), { from: "2025-06", to: "2026-09" });
});
```

Em `src/services/performance.test.ts`, deslocar os fixtures para 2026 (o piso não interfere) e trocar as expectativas do cálculo datado:

```ts
test("buildPerformance calcula meses, acumulado e MWR com fluxos datados", () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [cdb]);
  insertTransactions(db, [buy("2026-04-23", 100_000n), buy("2026-06-10", 50_000n)]);
  writeIndexRates(db, [
    { series: "CDI", date: "2026-05-02", valueE12: 10_000_000_000n },
    { series: "CDI", date: "2026-06-02", valueE12: 10_000_000_000n },
    { series: "IPCA", date: "2026-04-01", valueE12: 3_000_000_000n },
  ]);

  const result = buildPerformance(db, { from: "2026-05", to: "2026-06" }, { now });
  assert.deepEqual({ from: result.from, to: result.to }, { from: "2026-05", to: "2026-06" });
  assert.equal(result.monthsTotal, 2);
  assert.deepEqual(result.months.map((month) => [month.month, month.portfolioPct, month.cdiPct]), [
    ["2026-05", 1, 1],        // <valor> sobre <valor>
    ["2026-06", 0.7519, 1],   // 1010 ÷ (<valor> + <valor> × 20/30)
  ]);
  assert.equal(result.months[1]?.rendimentoCents, 1_010n);
  assert.equal(result.months[1]?.investedCents, 50_000n);
  assert.deepEqual(result.accumulated, { portfolioPct: 1.7594, cdiPct: 2.01, ipcaPct: 0, diffCdiPp: -0.2506, diffIpcaPp: 1.7594 });
  assert.equal(result.monthsBeaten, 0);
  assert.deepEqual(result.mwr, { periodPct: 1.7283, months: 2 });
});

test("buildPerformance clampa a janela e MWR fica abaixo do TWR com aporte grande", () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [cdb]);
  insertTransactions(db, [buy("2026-04-23", 100_000n), buy("2026-07-10", 500_000n)]);
  writeIndexRates(db, [
    { series: "CDI", date: "2026-05-02", valueE12: 10_000_000_000n },
    { series: "CDI", date: "2026-06-02", valueE12: 10_000_000_000n },
  ]);

  const result = buildPerformance(db, { from: "2000-01", to: "2026-09" }, { now });
  assert.deepEqual({ from: result.from, to: result.to }, { from: "2026-05", to: "2026-09" });
  assert.equal(result.monthsTotal, 5);
  assert.equal(result.accumulated.portfolioPct, 2.01);
  assert.ok(result.mwr.periodPct !== null && result.mwr.periodPct < result.accumulated.portfolioPct);
  assert.ok(result.mwr.periodPct !== null && result.mwr.periodPct > 0);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/domain/performance.test.ts src/services/history.test.ts src/services/performance.test.ts`
Expected: FAIL — assinatura antiga do `monthlyPortfolioPct` e `from` ainda em 2025-05.

- [ ] **Step 3: Implementar**

`src/domain/performance.ts` — substituir `monthlyPortfolioPct` e **remover `mwrPct`**:

```ts
/** Retorno do período em % (4 casas) com fluxos ponderados pelos dias investidos (Modified Dietz); null sem base/período. */
export function monthlyPortfolioPct(
  prevValueCents: bigint,
  prevDate: string,
  valueCents: bigint,
  valueDate: string,
  flows: DatedFlow[],
): number | null {
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
  return Number(divRoundHalfUp(delta * 1_000_000n * BigInt(periodDays), denominator)) / 10_000;
}
```

`src/services/history.ts` — piso da série:

```ts
/** Início da série de retorno: abr–mai/2025 são lotes de migração de posições que já existiam, registrados pelo valor bruto do dia — não são aportes. */
const SERIES_START_MONTH = "2025-06";
```

```ts
  const first = firstMonthWithReturn(db, to);
  const floor = first !== null && first > SERIES_START_MONTH ? first : SERIES_START_MONTH;
  const from = requestedFrom < floor ? floor : requestedFrom;
  return { from, to };
```

`src/services/performance.ts` — usar fluxos datados nos meses e no MWR (o bloco antigo `const flows: bigint[] = [-(base?.marketValueCents ?? 0n)]` … `mwrPct(flows)` sai inteiro, junto com o import de `mwrPct`):

```ts
import { addMonths, daysBetween } from "../domain/dates.ts";
import { accumulatePct, gapPp, monthlyPortfolioPct, monthsBeaten, xirrPct, type DatedFlow } from "../domain/performance.ts";
```

```ts
  for (const point of points.slice(1)) {
    if (!previous) break;
    const portfolioPct = monthlyPortfolioPct(previous.marketValueCents, previous.asOf, point.marketValueCents, point.asOf, point.flows);
    months.push({
      month: point.month, portfolioPct, cdiPct: point.cdiPct, ipcaPct: point.ipcaPct,
      diffCdiPp: portfolioPct === null || point.cdiPct === null ? null : gapPp(portfolioPct, point.cdiPct),
      rendimentoCents: point.marketValueCents - previous.marketValueCents - point.investedCents + point.redeemedCents,
      investedCents: point.investedCents, redeemedCents: point.redeemedCents,
    });
    previous = point;
  }
```

```ts
  const lastPoint = points.at(-1);
  const datedFlows: DatedFlow[] = points.slice(1).flatMap((point) => point.flows);
  let mwr: PerformanceResult["mwr"] = { periodPct: null, months: months.length };
  if (base && lastPoint && months.length > 0) {
    const annual = xirrPct(base.marketValueCents, base.asOf, datedFlows, lastPoint.marketValueCents, lastPoint.asOf);
    if (annual !== null) {
      mwr = {
        periodPct: Math.round(((1 + annual / 100) ** (daysBetween(base.asOf, lastPoint.asOf) / 365) - 1) * 1_000_000) / 10_000,
        months: months.length,
      };
    }
  }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test && npm run typecheck`
Expected: PASS (todos os testes, incluindo os intactos) e typecheck limpo.

- [ ] **Step 5: Commit**

```bash
git add src/domain/performance.ts src/domain/performance.test.ts src/services/history.ts src/services/history.test.ts src/services/performance.ts src/services/performance.test.ts
git commit -m "feat: twr ponderado por dia, mwr por xirr e serie a partir de jun/2025"
```

---

### Task 4: Web — textos dos modais

**Files:**
- Modify: `web/src/views/OverviewView.tsx`

**Interfaces:**
- Consumes: nada novo (API sem mudança de shape).
- Produces: textos que explicam a ponderação por dia (TWR) e as datas reais (MWR).

- [ ] **Step 1: Trocar os textos**

No modal do TWR, trocar o parágrafo por:

```tsx
<p className="info-pop-texto">Desde o início ({formataJanela(performanceTudo.from, performanceTudo.to)}). Encadeia o retorno de cada mês (juros compostos) e ignora aportes e resgates: cada aporte/resgate pesa pelos dias em que ficou investido no mês. Mede a qualidade da estratégia e é o número justo para comparar com CDI, IPCA e outros fundos.</p>
```

No modal do MWR, trocar o parágrafo por:

```tsx
<p className="info-pop-texto">Desde o início ({formataJanela(performanceTudo.from, performanceTudo.to)}). É a TIR (taxa interna de retorno) dos fluxos datados: cada aporte é uma saída de caixa e cada resgate uma entrada, na data em que aconteceram, e o patrimônio no fim é o valor de volta. Dá mais peso aos momentos em que você colocou mais dinheiro — é o ganho real do seu bolso.</p>
```

- [ ] **Step 2: Verificar build**

Run: `npm run typecheck && npm run build:web`
Expected: typecheck limpo e build ok (aviso de chunk > 500 kB é pré-existente).

- [ ] **Step 3: Commit**

```bash
git add web/src/views/OverviewView.tsx
git commit -m "style: explica ponderacao por dia no twr e mwr"
```

---

### Task 5: Verificação com dados reais + ROADMAP

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 1: Verificação completa**

```bash
npm test && npm run typecheck && npm run build:web && docker compose up -d --build
```

Expected: 154+ testes verdes, typecheck/build ok, container `Up (healthy)`.

- [ ] **Step 2: Aceite numérico via API**

```bash
curl -s "http://localhost:3000/api/performance?from=2000-01" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.from,j.to,'TWR',j.accumulated.portfolioPct,'CDI',j.accumulated.cdiPct,'IPCA',j.accumulated.ipcaPct,'gap',j.accumulated.diffCdiPp,'meses',j.monthsBeaten+'/'+j.monthsTotal,'MWR',j.mwr.periodPct)})"
curl -s "http://localhost:3000/api/performance?from=2025-10" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.from,j.to,'TWR',j.accumulated.portfolioPct,'CDI',j.accumulated.cdiPct,'gap',j.accumulated.diffCdiPp,'MWR',j.mwr.periodPct)})"
curl -s "http://localhost:3000/api/history?from=2000-01" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('primeiro mes',j[0].month)})"
```

Expected (tolerância ±0,02 p.p. por refreshes de CDI/índices):
- Desde o início: `2025-06 2026-09` · TWR ~19,31 · CDI ~19,59 · IPCA ~4,63 · gap ~−0,29 · 6/16 · MWR ~19,37.
- 1 ano: TWR ~13,92 · CDI ~14,07 · gap ~−0,15 · MWR ~14,01.
- `/api/history`: primeiro mês `2025-06`.

- [ ] **Step 3: Aceite visual (browser)**

Abrir `http://localhost:3000` e conferir: chips "TWR (desde o início)" e "MWR (desde o início)" com os valores acima; hint "Desde o início: jun/2025 – set/2026."; modal do TWR com 16 linhas começando em jun/2025 e o texto novo; chip "1 ano" muda só o gráfico. Screenshot em `.superpowers/sdd/`.

- [ ] **Step 4: Atualizar o ROADMAP**

- Tabela "Estado atual": linha da etapa para `concluída — merge local na main` (e a linha do imposto segue backlog).
- Seção de evidências: adicionar o item do corte com os números de aceite medidos e o screenshot; marcar os números antigos da S7 como superados por esta etapa.
- "Próxima ação": apontar o `brainstorming` da etapa de **imposto (líquido × líquido)**.

- [ ] **Step 5: Commit final**

```bash
git add ROADMAP.md
git commit -m "docs: atualiza roadmap com twr/mwr por fluxos datados"
```
