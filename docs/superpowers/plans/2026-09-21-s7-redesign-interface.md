# Redesign da interface (S7) — Plano de Implementação

> **Para agentes:** sub-skill obrigatória: `superpowers:executing-plans` (execução inline, padrão bento) com TDD task a task. Passos usam checkbox (`- [ ]`). Backend primeiro, depois web.

**Goal:** refazer a interface do app (paleta "Papel quente", shell em 5 seções, Visão geral em duas colunas, gráfico com abas R$/% mês a mês e acumulado, período 1 ano · 5 anos · Tudo, lista de ativos em Posições, reconciliação em Fontes) e adicionar a camada de leitura `GET /api/performance` (TWR mensal, acumulado, gap em p.p. e MWR), sem mudar nenhum número de cálculo existente — a reconciliação de 2026-09 segue `referenceCents = <valor>` com `unexplained = 0`.

**Architecture:** `src/domain/performance.ts` (puro: retorno mensal, acumulado, MWR por bisseção, gap, meses acima do CDI) → `src/services/history.ts` ganha `resolveHistoryWindow` (default + clamp no primeiro mês com retorno) → `src/services/performance.ts` monta a série sobre `buildHistory` (um mês antes para o valor-base) e os fluxos do MWR → `src/api/routes/performance.ts` → web: tokens em `styles.css`, shell `App.tsx` com barra lateral, `EvolucaoChart` (Recharts) reutilizado por `OverviewView` e `EvolutionView`, mais `PositionsView` e `SourcesView` (reconciliação).

**Tech Stack:** Node 22 + TypeScript (type-stripping), Fastify 5, better-sqlite3, `node:test`; web com Vite + React 19 + Recharts 3 + Phosphor Icons.

**Spec:** `docs/superpowers/specs/2026-09-21-s7-redesign-interface-design.md`

## Global Constraints

- Node ≥ 22.18, ESM, imports `.ts` explícitos; backend sem build (type-stripping). `node:test`; nenhum teste com rede.
- Zero `float` em dado persistido/cálculo: BigInt escalonado; `Number` só na borda da API (`toNumberSafe`) e em percentuais de apresentação (4 casas), como `cdiMonthPct`.
- Camadas: `domain` sem I/O; rotas finas chamam services; leitura calcula on-the-fly.
- Limites de PR (bento): **≤ 400 linhas / ≤ 10 arquivos por layer**; cada task = 1 layer/commit; `package-lock.json` não muda nesta etapa.
- Artefatos e commits em pt-BR; checkbox por passo.
- Paleta: só **Papel quente** (sem variante escura — remover `@media (prefers-color-scheme: dark)` e `color-scheme`). Números em `tabular-nums`.
- Nenhum número de cálculo muda: `buildHistory`, `buildPortfolio`, `instrumentValue` e `buildReconciliation` ficam intactos; só a apresentação e a leitura nova.
- Regras de `performance`: retorno mensal `(valor − anterior − aporte + resgate) ÷ anterior`, `null` se anterior = 0; acumulado `∏(1+p/100) − 1`; MWR = TIR mensal por bisseção (300 iterações, intervalo `[−0,9; 1,0]`); janela clampada no primeiro mês com retorno (dados atuais: mai/2025).
- Aceite numérico (dados reais, 2026-09-21): **1 ano (out/2025 → set/2026)** carteira +14,14% · CDI +14,01% · IPCA +3,73% · +0,13 p.p. · 6/12 meses · MWR +14,15%; **Tudo (mai/2025 → set/2026)** carteira +22,07% · CDI +20,89% · IPCA +4,90% · +1,18 p.p. · 10/17 · MWR +21,40%; abr/2026: aporte R$ <valor> + rendimento R$ <valor>
- Verificação por task web: `npm run typecheck` + `npm run build:web`; verificação visual com `npm run dev:web` (proxy `/api` → `:3000`, container de pé).
- Pendências herdadas da S6 que entram aqui: `null` de `marketValueCents` renderiza "—" + badge "desatualizado"; cancelamento de request (AbortController) nas leituras; lazy-load do Recharts.

---

## Estrutura de arquivos (S7)

```
src/domain/performance.ts  performance.test.ts          # T1
src/services/history.ts  history.test.ts                # resolveHistoryWindow (T2)
src/services/performance.ts  performance.test.ts        # série + MWR (T3)
src/api/routes/performance.ts  src/app.ts  src/api/app.test.ts # rota (T3)
web/src/styles.css                                      # tokens Papel quente + shell (T4)
web/src/App.tsx                                         # barra lateral + refresh global (T4)
web/src/api.ts  web/src/format.ts                       # performance/transactions, signal, p.p. (T4)
web/src/views/OverviewView.tsx  (stub em T4, pronto em T5)
web/src/views/PositionsView.tsx  (stub em T4, pronto em T6)
web/src/views/EvolutionView.tsx  (stub em T4, pronto em T7)
web/src/views/SourcesView.tsx    (stub em T4, pronto em T8)
web/src/components/EvolucaoChart.tsx                    # gráfico (T5)
web/src/views/DashboardView.tsx                         # removido em T4
ROADMAP.md                                              # fechamento (T9)
```

---

### Task 1: Domínio — retorno mensal, acumulado, MWR

**Files:**
- Create: `src/domain/performance.ts`, `src/domain/performance.test.ts`

**Interfaces:**
- Consumes: `divRoundHalfUp` (`src/domain/money.ts`).
- Produces: `monthlyPortfolioPct(prevValueCents: bigint, valueCents: bigint, investedCents: bigint, redeemedCents: bigint): number | null`; `accumulatePct(pcts: Array<number | null>): number`; `gapPp(a: number, b: number): number`; `monthsBeaten(rows: Array<{ portfolioPct: number | null; cdiPct: number | null }>): number`; `mwrPct(flowsCents: bigint[]): number | null` (TIR **mensal** em %, 4 casas).

- [ ] **Step 1: Escrever os testes que falham**

Arquivo `src/domain/performance.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { accumulatePct, gapPp, monthlyPortfolioPct, monthsBeaten, mwrPct } from "./performance.ts";

test("monthlyPortfolioPct desconta aporte e resgate e devolve null com base 0", () => {
  // (<valor> − <valor> − 2000 + 0) / <valor> = 1%
  assert.equal(monthlyPortfolioPct(100_000n, 103_000n, 2_000n, 0n), 1);
  // (<valor> − <valor> − 0 + 500) / <valor> = −2%
  assert.equal(monthlyPortfolioPct(100_000n, 97_500n, 0n, 500n), -2);
  assert.equal(monthlyPortfolioPct(0n, 10_000n, 0n, 0n), null);
});

test("accumulatePct compõe, ignora null e devolve 0 vazio", () => {
  assert.equal(accumulatePct([1, 1]), 2.01);
  assert.equal(accumulatePct([null, 1, null]), 1);
  assert.equal(accumulatePct([]), 0);
  assert.equal(accumulatePct([10, -10]), -1);
});

test("mwrPct acha a TIR mensal e devolve null sem fluxo", () => {
  // −<valor> + <valor>/(1+r) = 0 → r = 10% no mês
  assert.equal(mwrPct([-100_000n, 110_000n]), 10);
  // −<valor> + 0/(1+r) + <valor>/(1+r)² ... fluxo no período 1 → 5%
  assert.equal(mwrPct([-100_000n, 105_000n, 0n]), 5);
  assert.equal(mwrPct([0n, 0n]), null);
  assert.equal(mwrPct([]), null);
});

test("monthsBeaten ignora empate e nulos; gapPp desconta", () => {
  assert.equal(monthsBeaten([
    { portfolioPct: 1.2, cdiPct: 1.0 },
    { portfolioPct: 1.0, cdiPct: 1.0 },
    { portfolioPct: null, cdiPct: 1.0 },
    { portfolioPct: 0.9, cdiPct: 1.0 },
  ]), 1);
  assert.equal(gapPp(14.14, 14.01), 0.13);
  assert.equal(gapPp(1, 1.5), -0.5);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test "src/domain/performance.test.ts"`
Expected: FAIL (`Cannot find module './performance.ts'`).

- [ ] **Step 3: Implementar `src/domain/performance.ts`**

```ts
import { divRoundHalfUp } from "./money.ts";

/** Retorno mensal da carteira em % (4 casas); null se o mês anterior não tem valor. */
export function monthlyPortfolioPct(
  prevValueCents: bigint,
  valueCents: bigint,
  investedCents: bigint,
  redeemedCents: bigint,
): number | null {
  if (prevValueCents <= 0n) return null;
  const delta = valueCents - prevValueCents - investedCents + redeemedCents;
  return Number(divRoundHalfUp(delta * 1_000_000n, prevValueCents)) / 10_000;
}

/** Acumula percentuais compostos em % (4 casas); ignora null; 0 se vazio. */
export function accumulatePct(pcts: Array<number | null>): number {
  let factor = 1;
  for (const pct of pcts) {
    if (pct !== null) factor *= 1 + pct / 100;
  }
  return Math.round((factor - 1) * 1_000_000) / 10_000;
}

/** Diferença em pontos percentuais (a − b), 4 casas. */
export function gapPp(a: number, b: number): number {
  return Math.round((a - b) * 10_000) / 10_000;
}

/** Quantos meses da série bateram o CDI (empate não conta). */
export function monthsBeaten(rows: Array<{ portfolioPct: number | null; cdiPct: number | null }>): number {
  return rows.filter((row) => row.portfolioPct !== null && row.cdiPct !== null && row.portfolioPct > row.cdiPct).length;
}

/** TIR mensal dos fluxos em % (4 casas); null sem fluxo ou sem raiz no intervalo. */
export function mwrPct(flowsCents: bigint[]): number | null {
  if (flowsCents.length === 0 || flowsCents.every((flow) => flow === 0n)) return null;
  const npv = (rate: number): number => {
    let total = 0;
    for (let index = 0; index < flowsCents.length; index++) {
      total += Number(flowsCents[index]!) / (1 + rate) ** index;
    }
    return total;
  };
  let low = -0.9;
  let high = 1;
  if (npv(low) * npv(high) > 0) return null;
  for (let iteration = 0; iteration < 300; iteration++) {
    const mid = (low + high) / 2;
    if (npv(low) * npv(mid) <= 0) high = mid;
    else low = mid;
  }
  return Math.round(((low + high) / 2) * 1_000_000) / 10_000;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test "src/domain/performance.test.ts"`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/domain/performance.ts src/domain/performance.test.ts
git commit -m "feat: dominio de performance (twr mensal, acumulado e mwr)"
```

---

### Task 2: Janela compartilhada de histórico

**Files:**
- Modify: `src/services/history.ts`, `src/services/history.test.ts`, `src/api/routes/portfolio.ts:36-40`

**Interfaces:**
- Consumes: `earliestTradeDate` (`src/db/repos.ts:210`), `buildHistory` (mesmo arquivo).
- Produces: `resolveHistoryWindow(db: Db, options?: HistoryOptions, deps?: { now?: () => Date }): { from: string; to: string }` — `to` default = mês corrente (BRT); `from` default = `to − 11`; clamp: nunca antes do primeiro mês cujo mês anterior tem `marketValueCents > 0`.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao final de `src/services/history.test.ts` (importar `resolveHistoryWindow` na linha 7):

```ts
import { buildHistory, resolveHistoryWindow } from "./history.ts";
```

```ts
test("resolveHistoryWindow clampa no primeiro mês com retorno", () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [cdb]);
  insertTransactions(db, [{ instrumentId: cdb.id, tradeDate: "2025-04-23", kind: "BUY", quantityE8: null, grossCents: 100_000n, feesCents: 0n, note: null, legacyRow: null }]);
  writeIndexRates(db, [{ series: "CDI", date: "2025-05-02", valueE12: 1_000_000_000n }]);
  const now = () => new Date("2026-09-18T12:00:00-03:00");

  // abr/2025 é atividade inicial; mai/2025 é o primeiro mês com mês anterior > 0
  assert.deepEqual(resolveHistoryWindow(db, { from: "2000-01", to: "2026-09" }, { now }), { from: "2025-05", to: "2026-09" });
  // pedido depois do clamp fica intacto
  assert.deepEqual(resolveHistoryWindow(db, { from: "2025-08", to: "2026-09" }, { now }), { from: "2025-08", to: "2026-09" });
  // default: to = mês corrente, from = to − 11
  assert.deepEqual(resolveHistoryWindow(db, {}, { now }), { from: "2025-10", to: "2026-09" });
});

test("resolveHistoryWindow sem transações mantém a janela pedida", () => {
  const db = openDb(":memory:");
  migrate(db);
  const now = () => new Date("2026-09-18T12:00:00-03:00");
  assert.deepEqual(resolveHistoryWindow(db, { from: "2000-01", to: "2026-09" }, { now }), { from: "2000-01", to: "2026-09" });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test "src/services/history.test.ts"`
Expected: FAIL (`resolveHistoryWindow is not a function`).

- [ ] **Step 3: Implementar em `src/services/history.ts`**

Trocar a linha 2 (imports de repos) por:

```ts
import { earliestTradeDate, listAllFundQuotas, listAllIndexRates, listAllQuotes, listAllTransactions, listInstruments } from "../db/repos.ts";
```

Adicionar antes de `buildHistory`:

```ts
/** Janela efetiva: defaults e clamp no primeiro mês com retorno (mês anterior com valor > 0). */
export function resolveHistoryWindow(
  db: Db,
  options: HistoryOptions = {},
  deps: { now?: () => Date } = {},
): { from: string; to: string } {
  const today = toBrDate((deps.now ?? (() => new Date()))());
  const to = options.to ?? today.slice(0, 7);
  const requestedFrom = options.from ?? addMonths(to, -11);
  const first = firstMonthWithReturn(db, to);
  const from = first !== null && requestedFrom < first ? first : requestedFrom;
  return { from, to };
}

function firstMonthWithReturn(db: Db, limit: string): string | null {
  const earliest = earliestTradeDate(db);
  if (earliest === null) return null;
  const points = buildHistory(db, { from: earliest.slice(0, 7), to: limit });
  for (let index = 1; index < points.length; index++) {
    if (points[index - 1]!.marketValueCents > 0n) return points[index]!.month;
  }
  return null;
}
```

- [ ] **Step 4: Usar a janela na rota `/api/history`**

Em `src/api/routes/portfolio.ts`, trocar o import da linha 5 e o corpo da rota (linhas 36-48):

```ts
import { buildHistory, resolveHistoryWindow } from "../../services/history.ts";
```

```ts
  app.get<{ Querystring: { from?: string; to?: string } }>("/api/history", (request, reply) => {
    const { from, to } = request.query;
    if ((from !== undefined && !isMonth(from)) || (to !== undefined && !isMonth(to))) {
      return reply.code(400).send({ error: "from/to devem ser YYYY-MM" });
    }
    return buildHistory(db, resolveHistoryWindow(db, { from, to })).map((point) => ({
      month: point.month,
      marketValueCents: toNumberSafe(point.marketValueCents),
      investedCents: toNumberSafe(point.investedCents),
      redeemedCents: toNumberSafe(point.redeemedCents),
      cdiPct: point.cdiPct,
      ipcaPct: point.ipcaPct,
    }));
  });
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test "src/services/history.test.ts" "src/api/app.test.ts"`
Expected: PASS (histórico antigo continua verde; 2 testes novos passam).

- [ ] **Step 6: Commit**

```bash
git add src/services/history.ts src/services/history.test.ts src/api/routes/portfolio.ts
git commit -m "feat: janela de historico com clamp no primeiro mes com retorno"
```

---

### Task 3: Serviço + rota `/api/performance`

**Files:**
- Create: `src/services/performance.ts`, `src/services/performance.test.ts`, `src/api/routes/performance.ts`
- Modify: `src/app.ts`, `src/api/app.test.ts`

**Interfaces:**
- Consumes: `resolveHistoryWindow`, `buildHistory` (T2); `monthlyPortfolioPct`, `accumulatePct`, `gapPp`, `monthsBeaten`, `mwrPct` (T1).
- Produces: `buildPerformance(db: Db, options?: HistoryOptions, deps?: { now?: () => Date }): PerformanceResult` com `{ from, to, months: PerformanceMonth[], accumulated: { portfolioPct, cdiPct, ipcaPct, diffCdiPp, diffIpcaPp }, monthsBeaten, monthsTotal, mwr: { periodPct: number | null; months: number } }`; `PerformanceMonth = { month, portfolioPct, cdiPct, ipcaPct, diffCdiPp, rendimentoCents: bigint, investedCents: bigint, redeemedCents: bigint }`; rota `GET /api/performance?from=YYYY-MM&to=YYYY-MM` (400 para formato inválido e `from > to`).

- [ ] **Step 1: Escrever os testes do serviço que falham**

Arquivo `src/services/performance.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { insertInstruments, insertTransactions, writeIndexRates } from "../db/repos.ts";
import type { InstrumentRow } from "../db/repos.ts";
import { buildPerformance } from "./performance.ts";

const cdb: InstrumentRow = {
  id: "cdb-1", legacyKey: "CDB 1", name: "CDB 1", kind: "fixed_income", category: "cdb",
  ticker: null, quoteSource: null, quoteSymbol: null, currency: "BRL", benchmark: "CDI",
  rateE6: 1_000_000n, maturityDate: null, liquidity: null, broker: "PagBank",
  objective: "Reserva", investor: "Ana",
};
const now = () => new Date("2026-09-18T12:00:00-03:00");
const buy = (tradeDate: string, grossCents: bigint) =>
  ({ instrumentId: cdb.id, tradeDate, kind: "BUY" as const, quantityE8: null, grossCents, feesCents: 0n, note: null, legacyRow: null });

test("buildPerformance calcula meses, acumulado e MWR sem timing", () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [cdb]);
  insertTransactions(db, [buy("2025-04-23", 100_000n), buy("2025-06-10", 50_000n)]);
  writeIndexRates(db, [
    { series: "CDI", date: "2025-05-02", valueE12: 10_000_000_000n },
    { series: "CDI", date: "2025-06-02", valueE12: 10_000_000_000n },
    { series: "IPCA", date: "2025-04-01", valueE12: 3_000_000_000n },
  ]);

  const result = buildPerformance(db, { from: "2025-05", to: "2025-06" }, { now });
  assert.deepEqual({ from: result.from, to: result.to }, { from: "2025-05", to: "2025-06" });
  assert.equal(result.monthsTotal, 2);
  assert.deepEqual(result.months.map((month) => [month.month, month.portfolioPct, month.cdiPct]), [
    ["2025-05", 1, 1],   // <valor> sobre <valor>
    ["2025-06", 1, 1],   // <valor> − <valor> − <valor> = 1010 sobre <valor>
  ]);
  assert.equal(result.months[1]?.rendimentoCents, 1_010n);
  assert.equal(result.months[1]?.investedCents, 50_000n);
  assert.deepEqual(result.accumulated, { portfolioPct: 2.01, cdiPct: 2.01, ipcaPct: 0, diffCdiPp: 0, diffIpcaPp: 2.01 });
  assert.equal(result.monthsBeaten, 0);
  assert.deepEqual(result.mwr, { periodPct: 2.01, months: 2 });
});

test("buildPerformance clampa a janela e MWR fica abaixo do TWR com aporte grande", () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [cdb]);
  insertTransactions(db, [buy("2025-04-23", 100_000n), buy("2025-07-10", 500_000n)]);
  writeIndexRates(db, [
    { series: "CDI", date: "2025-05-02", valueE12: 10_000_000_000n },
    { series: "CDI", date: "2025-06-02", valueE12: 10_000_000_000n },
  ]);

  const result = buildPerformance(db, { from: "2000-01", to: "2025-09" }, { now });
  assert.deepEqual({ from: result.from, to: result.to }, { from: "2025-05", to: "2025-09" });
  assert.equal(result.monthsTotal, 5);
  assert.equal(result.accumulated.portfolioPct, 2.01);
  assert.ok(result.mwr.periodPct !== null && result.mwr.periodPct < result.accumulated.portfolioPct);
  assert.ok(result.mwr.periodPct !== null && result.mwr.periodPct > 0);
});

test("buildPerformance sem dados devolve meses nulos e MWR nulo", () => {
  const db = openDb(":memory:");
  migrate(db);
  const result = buildPerformance(db, { from: "2026-08", to: "2026-09" }, { now });
  assert.equal(result.monthsTotal, 2);
  assert.equal(result.months[0]?.portfolioPct, null);
  assert.equal(result.accumulated.portfolioPct, 0);
  assert.equal(result.mwr.periodPct, null);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test "src/services/performance.test.ts"`
Expected: FAIL (`Cannot find module './performance.ts'`).

- [ ] **Step 3: Implementar `src/services/performance.ts`**

```ts
import type { Db } from "../db/index.ts";
import { addMonths } from "../domain/dates.ts";
import { accumulatePct, gapPp, monthlyPortfolioPct, monthsBeaten, mwrPct } from "../domain/performance.ts";
import { buildHistory, resolveHistoryWindow, type HistoryOptions } from "./history.ts";

export type PerformanceMonth = {
  month: string; portfolioPct: number | null; cdiPct: number | null; ipcaPct: number | null;
  diffCdiPp: number | null; rendimentoCents: bigint; investedCents: bigint; redeemedCents: bigint;
};

export type PerformanceResult = {
  from: string; to: string; months: PerformanceMonth[];
  accumulated: { portfolioPct: number; cdiPct: number; ipcaPct: number; diffCdiPp: number; diffIpcaPp: number };
  monthsBeaten: number; monthsTotal: number;
  mwr: { periodPct: number | null; months: number };
};

export function buildPerformance(db: Db, options: HistoryOptions = {}, deps: { now?: () => Date } = {}): PerformanceResult {
  const window = resolveHistoryWindow(db, options, deps);
  const points = buildHistory(db, { from: addMonths(window.from, -1), to: window.to }, deps);
  const base = points[0];
  const months: PerformanceMonth[] = [];
  let previous = base;
  for (const point of points.slice(1)) {
    if (!previous) break;
    const portfolioPct = monthlyPortfolioPct(previous.marketValueCents, point.marketValueCents, point.investedCents, point.redeemedCents);
    months.push({
      month: point.month, portfolioPct, cdiPct: point.cdiPct, ipcaPct: point.ipcaPct,
      diffCdiPp: portfolioPct === null || point.cdiPct === null ? null : gapPp(portfolioPct, point.cdiPct),
      rendimentoCents: point.marketValueCents - previous.marketValueCents - point.investedCents + point.redeemedCents,
      investedCents: point.investedCents, redeemedCents: point.redeemedCents,
    });
    previous = point;
  }

  const accumulated = {
    portfolioPct: accumulatePct(months.map((month) => month.portfolioPct)),
    cdiPct: accumulatePct(months.map((month) => month.cdiPct)),
    ipcaPct: accumulatePct(months.map((month) => month.ipcaPct)),
    diffCdiPp: 0, diffIpcaPp: 0,
  };
  accumulated.diffCdiPp = gapPp(accumulated.portfolioPct, accumulated.cdiPct);
  accumulated.diffIpcaPp = gapPp(accumulated.portfolioPct, accumulated.ipcaPct);

  const flows: bigint[] = [-(base?.marketValueCents ?? 0n)];
  for (const month of months) flows.push(-(month.investedCents - month.redeemedCents));
  const lastPoint = points.at(-1);
  if (lastPoint && flows.length > 0 && months.length > 0) {
    flows[flows.length - 1] = flows[flows.length - 1]! + lastPoint.marketValueCents;
  }
  const monthly = mwrPct(flows);
  const mwr = {
    periodPct: monthly === null ? null : Math.round(((1 + monthly / 100) ** months.length - 1) * 1_000_000) / 10_000,
    months: months.length,
  };

  return { from: window.from, to: window.to, months, accumulated, monthsBeaten: monthsBeaten(months), monthsTotal: months.length, mwr };
}
```

- [ ] **Step 4: Implementar a rota e registrar**

Arquivo `src/api/routes/performance.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/index.ts";
import { isMonth } from "../../domain/dates.ts";
import { toNumberSafe } from "../../domain/money.ts";
import { buildPerformance } from "../../services/performance.ts";

export function registerPerformanceRoutes(app: FastifyInstance, db: Db): void {
  app.get<{ Querystring: { from?: string; to?: string } }>("/api/performance", (request, reply) => {
    const { from, to } = request.query;
    if ((from !== undefined && !isMonth(from)) || (to !== undefined && !isMonth(to))) {
      return reply.code(400).send({ error: "from/to devem ser YYYY-MM" });
    }
    if (from !== undefined && to !== undefined && from > to) {
      return reply.code(400).send({ error: "from deve ser <= to" });
    }
    const result = buildPerformance(db, { from, to });
    return {
      from: result.from, to: result.to,
      months: result.months.map((month) => ({
        month: month.month, portfolioPct: month.portfolioPct, cdiPct: month.cdiPct, ipcaPct: month.ipcaPct,
        diffCdiPp: month.diffCdiPp,
        rendimentoCents: toNumberSafe(month.rendimentoCents),
        investedCents: toNumberSafe(month.investedCents),
        redeemedCents: toNumberSafe(month.redeemedCents),
      })),
      accumulated: result.accumulated,
      monthsBeaten: result.monthsBeaten, monthsTotal: result.monthsTotal,
      mwr: result.mwr,
    };
  });
}
```

Em `src/app.ts`, adicionar o import e o registro (depois de `registerPortfolioRoutes`):

```ts
import { registerPerformanceRoutes } from "./api/routes/performance.ts";
```

```ts
  registerPerformanceRoutes(app, options.db);
```

- [ ] **Step 5: Escrever os testes de rota**

Adicionar ao final de `src/api/app.test.ts` (usa `seedPortfolio` da linha 214):

```ts
test("GET /api/performance valida a janela e devolve números", async () => {
  const db = openDb(":memory:");
  migrate(db);
  seedPortfolio(db);
  const app = buildApp({ db, csvDir: csvDirFixture(), logger: false });

  const res = await app.inject({ method: "GET", url: "/api/performance?from=2026-08&to=2026-09" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.from, "2026-08");
  assert.equal(body.to, "2026-09");
  assert.equal(body.monthsTotal, 2);
  assert.equal(typeof body.months[1].rendimentoCents, "number", "bigint convertido na borda");
  assert.equal(typeof body.mwr.months, "number");

  assert.equal((await app.inject({ method: "GET", url: "/api/performance?from=2026-13" })).statusCode, 400);
  assert.equal((await app.inject({ method: "GET", url: "/api/performance?from=2026-10&to=2026-09" })).statusCode, 400);
  assert.equal((await app.inject({ method: "GET", url: "/api/performance?from=26-10" })).statusCode, 400);

  await app.close();
});
```

- [ ] **Step 6: Rodar e ver passar**

Run: `node --test "src/services/performance.test.ts" "src/api/app.test.ts"`
Expected: PASS (3 testes de serviço + 1 de rota).

- [ ] **Step 7: Commit**

```bash
git add src/services/performance.ts src/services/performance.test.ts src/api/routes/performance.ts src/app.ts src/api/app.test.ts
git commit -m "feat: servico e rota /api/performance (twr, acumulado, mwr)"
```

---

### Task 4: Tokens Papel quente, shell em 5 seções e plumbing de API

**Files:**
- Modify: `web/src/styles.css`, `web/src/App.tsx`, `web/src/api.ts`, `web/src/format.ts`
- Create: `web/src/views/OverviewView.tsx`, `web/src/views/PositionsView.tsx`, `web/src/views/EvolutionView.tsx`, `web/src/views/SourcesView.tsx` (stubs; Tasks 5–8 preenchem)
- Delete: `web/src/views/DashboardView.tsx`

**Interfaces:**
- Produces: `getPerformance(from, to, signal?)`, `getTransactions(id, signal?)` e `signal?` nos getters existentes; tipos `Performance`, `PerformanceMonth`, `Transaction`; `formataPontosPercentuais`, `formataPercentualSinal`, `formataJanela`; shell com 5 seções, selo "atualizado às HH:MM", botão global "Atualizar cotações" e ponto âmbar em Fontes quando `stale`; views recebem `reloadToken` (e `PositionsView` recebe `filtroInicial: PortfolioPosition["kind"] | null`).

- [ ] **Step 1: Trocar os tokens em `web/src/styles.css`**

Substituir o bloco `:root` (linhas 1–32) e remover o bloco `@media (prefers-color-scheme: dark)` (linhas 34–55) e a regra `color-scheme`, se existir:

```css
:root {
  --font-sans: "Geist Variable", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "Geist Mono Variable", ui-monospace, SFMono-Regular, Menlo, monospace;

  --bg: #F3EEE6;
  --surface: #FBF8F3;
  --surface-2: #EBE4D8;
  --border: #DED5C6;
  --border-strong: #CFC4B2;
  --text: #2E2A24;
  --text-2: #6B6355;
  --text-3: #8C8272;
  --ink: #2E2A24;
  --ink-contrast: #FBF8F3;

  --accent: #3F6B52;
  --accent-soft: #DCE8DF;
  --sand: #C9B79A;
  --olive: #8A8F6B;
  --danger: #A8452F;
  --danger-soft: #F2DED8;
  --warn: #9A6A2A;
  --warn-soft: #F6E8D2;

  --radius-card: 12px;
  --radius-control: 10px;
  --radius-pill: 999px;

  --shadow-card: 0 1px 2px rgba(46, 42, 36, 0.06);
  --ring: 0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent);

  --dur: 180ms;
  --ease: cubic-bezier(0.16, 1, 0.3, 1);
}
```

Remover também os blocos mortos `.chart-placeholder` (linhas ~639–656), `.topbar`/`.topbar-inner` e `.tabs`/`.tab` (o shell novo não usa nenhum). Trocar a regra `.shell` (linhas 90–95) por:

```css
.content {
  flex: 1;
  min-width: 0;
  padding: 0 32px;
}
```

Adicionar ao final do arquivo os estilos do shell:

```css
.app { display: flex; min-height: 100vh; }
.sidebar {
  position: sticky; top: 0; align-self: flex-start;
  display: flex; flex-direction: column; gap: 18px;
  width: 232px; height: 100vh; padding: 22px 16px;
  border-right: 1px solid var(--border); background: var(--surface-2);
}
.nav { display: flex; flex-direction: column; gap: 4px; }
.nav-item {
  display: flex; align-items: center; gap: 10px; padding: 9px 10px;
  border: none; border-radius: var(--radius-control); background: transparent;
  color: var(--text-2); font: inherit; text-align: left; cursor: pointer;
}
.nav-item:hover { background: var(--surface); color: var(--text); }
.nav-item.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.dot { width: 8px; height: 8px; margin-left: auto; border-radius: 50%; background: var(--warn); }
.sidebar-foot { display: flex; flex-direction: column; gap: 8px; margin-top: auto; }
.sidebar-recado { font-size: 12px; color: var(--text-2); }
.colunas { display: grid; grid-template-columns: 1.7fr 1fr; gap: 16px; align-items: start; }
.chart-controles { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.chart-foot { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 8px; font-size: 13px; color: var(--text-2); }
.painel-ativo {
  position: fixed; top: 0; right: 0; z-index: 20; width: min(420px, 100vw); height: 100vh;
  overflow-y: auto; padding: 20px; border-left: 1px solid var(--border); background: var(--surface);
}
.rendimento-positivo { color: var(--accent); }
.rendimento-negativo { color: var(--danger); }
.num, td.num, th.num { font-variant-numeric: tabular-nums; }
@media (max-width: 1000px) { .colunas { grid-template-columns: 1fr; } }
@media (max-width: 900px) {
  .app { flex-direction: column; }
  .sidebar { position: static; width: 100%; height: auto; flex-direction: row; align-items: center; gap: 10px; overflow-x: auto; }
  .nav { flex-direction: row; }
  .sidebar-foot { flex-direction: row; align-items: center; margin-top: 0; margin-left: auto; }
  .content { padding: 0 16px; }
}
```

- [ ] **Step 2: Adicionar tipos, getters e `signal` em `web/src/api.ts`**

Em `getJson` e nos getters, aceitar `signal?: AbortSignal`; adicionar os tipos novos e as duas funções no final:

```ts
export type PerformanceMonth = {
  month: string; portfolioPct: number | null; cdiPct: number | null; ipcaPct: number | null;
  diffCdiPp: number | null; rendimentoCents: number; investedCents: number; redeemedCents: number;
};

export type Performance = {
  from: string; to: string; months: PerformanceMonth[];
  accumulated: { portfolioPct: number; cdiPct: number; ipcaPct: number; diffCdiPp: number; diffIpcaPp: number };
  monthsBeaten: number; monthsTotal: number; mwr: { periodPct: number | null; months: number };
};

export type Transaction = {
  tradeDate: string; kind: string; quantityE8: number | null;
  grossCents: number; feesCents: number; note: string | null; legacyRow: number | null;
};
```

```ts
async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(await apiErrorMessage(response, body));
  }
  return (await response.json()) as T;
}

export const getPortfolio = (signal?: AbortSignal): Promise<Portfolio> => getJson("/api/portfolio", signal);
export const getHealth = (signal?: AbortSignal): Promise<Health> => getJson("/api/health", signal);
export const getAllocation = (by: AllocationBy, signal?: AbortSignal): Promise<Allocation> => getJson(`/api/allocation?by=${by}`, signal);
export const getReconciliation = (month: string, signal?: AbortSignal): Promise<Reconciliation> => getJson(`/api/reconciliation?month=${month}`, signal);
export const getHistory = (from: string, to: string, signal?: AbortSignal): Promise<HistoryPoint[]> => getJson(`/api/history?from=${from}&to=${to}`, signal);
export const getPerformance = (from: string, to: string, signal?: AbortSignal): Promise<Performance> => getJson(`/api/performance?from=${from}&to=${to}`, signal);
export const getTransactions = (id: string, signal?: AbortSignal): Promise<Transaction[]> =>
  getJson(`/api/instruments/${encodeURIComponent(id)}/transactions`, signal);
```

- [ ] **Step 3: Adicionar formatadores em `web/src/format.ts`**

Trocar `formataDataHora` por uma versão que aceita ISO e o formato do SQLite:

```ts
export function formataDataHora(valor: string): string {
  const parsed = new Date(/[TZ]/.test(valor) ? valor : `${valor.replace(" ", "T")}Z`);
  return Number.isNaN(parsed.getTime()) ? valor : formatadorDataHora.format(parsed);
}
```

```ts
export function formataPercentualSinal(valor: number): string {
  const sinal = valor > 0 ? "+" : "";
  return `${sinal}${valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

export function formataPontosPercentuais(valor: number): string {
  const sinal = valor > 0 ? "+" : "";
  return `${sinal}${valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} p.p.`;
}

export function formataJanela(from: string, to: string): string {
  return `${formataMes(from)} → ${formataMes(to)}`;
}
```

- [ ] **Step 4: Criar os stubs das views**

`web/src/views/OverviewView.tsx`, `PositionsView.tsx`, `EvolutionView.tsx` e `SourcesView.tsx` (stubs; as tasks seguintes preenchem). Exemplo de `OverviewView.tsx` — os outros três seguem o mesmo esqueleto trocando só o nome:

```tsx
import type { PortfolioPosition } from "../api.ts";

export function OverviewView(_props: {
  reloadToken: number;
  onAbrirPosicoes: (kind: PortfolioPosition["kind"]) => void;
  onAbrirFontes: () => void;
}) {
  return (
    <div className="page">
      <div className="empty">
        <p className="empty-title">Em construção</p>
        <p className="empty-hint">Esta seção chega na próxima task.</p>
      </div>
    </div>
  );
}
```

Stubs de `PositionsView` (`_props: { reloadToken: number; filtroInicial: PortfolioPosition["kind"] | null }`), `EvolutionView` (`_props: { reloadToken: number }`) e `SourcesView` (`_props: { reloadToken: number }`) com o mesmo corpo; importam `PortfolioPosition` apenas onde o tipo aparece.

- [ ] **Step 5: Substituir `web/src/App.tsx` pelo shell**

```tsx
import { useCallback, useEffect, useState } from "react";
import { ArrowsClockwise, ChartLine, ChartLineUp, Coins, FileArrowUp, Table } from "@phosphor-icons/react";
import { getHealth, postRefresh, type Health, type PortfolioPosition } from "./api.ts";
import { formataHora } from "./format.ts";
import { ImportView } from "./views/ImportView.tsx";
import { OverviewView } from "./views/OverviewView.tsx";
import { PositionsView } from "./views/PositionsView.tsx";
import { EvolutionView } from "./views/EvolutionView.tsx";
import { SourcesView } from "./views/SourcesView.tsx";

type View = "visao-geral" | "posicoes" | "evolucao" | "importar" | "fontes";

const ITENS: Array<{ id: View; rotulo: string; Icone: typeof Coins }> = [
  { id: "visao-geral", rotulo: "Visão geral", Icone: ChartLineUp },
  { id: "posicoes", rotulo: "Posições", Icone: Table },
  { id: "evolucao", rotulo: "Evolução", Icone: ChartLine },
  { id: "importar", rotulo: "Importar", Icone: FileArrowUp },
  { id: "fontes", rotulo: "Fontes", Icone: Coins },
];

function ultimaColeta(health: Health | null): string | null {
  if (health === null) return null;
  return health.sources.map((source) => source.lastSuccessAt).filter((value): value is string => value !== null).sort().at(-1) ?? null;
}

export function App() {
  const [view, setView] = useState<View>("visao-geral");
  const [health, setHealth] = useState<Health | null>(null);
  const [filtroPosicoes, setFiltroPosicoes] = useState<PortfolioPosition["kind"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [recado, setRecado] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const carregaHealth = useCallback(async () => {
    try {
      setHealth(await getHealth());
    } catch {
      /* mantém o último health */
    }
  }, []);

  useEffect(() => {
    void carregaHealth();
    const id = setInterval(() => void carregaHealth(), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [carregaHealth]);

  function abrirPosicoes(kind: PortfolioPosition["kind"]) {
    setFiltroPosicoes(kind);
    setView("posicoes");
  }

  async function atualizar() {
    setBusy(true);
    setRecado(null);
    try {
      const result = await postRefresh();
      const erros = [
        ...result.sources.flatMap((source) => source.errors.map((erro) => `${source.id}: ${erro}`)),
        ...result.repairs.filter((repair) => repair.error !== undefined).map((repair) => `${repair.ticker}: ${repair.error}`),
      ];
      setRecado(erros.length > 0 ? erros.join(" · ") : "cotações atualizadas");
      await carregaHealth();
      setReloadToken((token) => token + 1);
    } catch (cause) {
      setRecado(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const stale = health?.sources.some((source) => source.stale) ?? false;
  const ultima = ultimaColeta(health);

  return (
    <div className="app">
      <aside className="sidebar">
        <p className="brand">investment-tracker</p>
        <nav className="nav" aria-label="Seções">
          {ITENS.map(({ id, rotulo, Icone }) => (
            <button
              key={id}
              type="button"
              className={view === id ? "nav-item active" : "nav-item"}
              aria-current={view === id ? "page" : undefined}
              onClick={() => setView(id)}
            >
              <Icone size={17} aria-hidden="true" />
              {rotulo}
              {id === "fontes" && stale && <span className="dot" aria-label="fontes desatualizadas" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="updated">{ultima ? `atualizado às ${formataHora(ultima)}` : "sem coleta registrada"}</span>
          <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => void atualizar()}>
            <ArrowsClockwise size={15} />
            {busy ? "Atualizando..." : "Atualizar cotações"}
          </button>
          {recado !== null && <p className="sidebar-recado" role="status">{recado}</p>}
        </div>
      </aside>
      <main className="content">
        {view === "visao-geral" && (
          <OverviewView reloadToken={reloadToken} onAbrirPosicoes={abrirPosicoes} onAbrirFontes={() => setView("fontes")} />
        )}
        {view === "posicoes" && <PositionsView reloadToken={reloadToken} filtroInicial={filtroPosicoes} />}
        {view === "evolucao" && <EvolutionView reloadToken={reloadToken} />}
        {view === "importar" && <ImportView />}
        {view === "fontes" && <SourcesView reloadToken={reloadToken} />}
      </main>
    </div>
  );
}
```

- [ ] **Step 6: Remover `DashboardView.tsx` e verificar**

```bash
git rm web/src/views/DashboardView.tsx
npm run typecheck
npm run build:web
```

Expected: typecheck limpo; build ok. No browser: `npm run dev:web` e conferir a paleta clara quente, 5 itens na lateral, 4 seções com "Em construção" e Importar funcionando.

- [ ] **Step 7: Commit**

```bash
git add web/src/styles.css web/src/App.tsx web/src/api.ts web/src/format.ts web/src/views
git commit -m "feat: tokens papel quente, shell em 5 secoes e api de performance/transacoes"
```

---

### Task 5: `EvolucaoChart` + `OverviewView`

**Files:**
- Create: `web/src/components/EvolucaoChart.tsx`
- Modify: `web/src/views/OverviewView.tsx`

**Interfaces:**
- Consumes: `Performance`, `HistoryPoint`, `Portfolio`, `Allocation`, `Health` (api.ts); formatadores (T4); tokens `--accent`, `--sand`, `--olive`, `--danger`.
- Produces: `EvolucaoChart({ history, performance, altura }: { history: HistoryPoint[]; performance: Performance; altura?: number })` — abas R$/% e sub-abas Mês a mês/Acumulado, agregação trimestral quando a janela tem > 24 meses, rodapé com acumulados e meses acima do CDI; `OverviewView` com Visão geral completa (patrimônio, gráfico, onde está o dinheiro, MWR, alocação com seletor e fontes).

- [ ] **Step 1: Criar `web/src/components/EvolucaoChart.tsx`**

```tsx
import { useState } from "react";
import {
  Area, Bar, CartesianGrid, Cell, ComposedChart, LabelList, Legend, Line, LineChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { HistoryPoint, Performance, PerformanceMonth } from "../api.ts";
import { formataBRL, formataMes, formataPercentual, formataPercentualSinal, formataPontosPercentuais } from "../format.ts";

type Aba = "rs" | "pct";
type SubAba = "mes" | "acumulado";

type Mes = PerformanceMonth & { patrimonioCents: number };
type LinhaRs = { rotulo: string; patrimonioCents: number; aporteCents: number; resgateCents: number; rendimentoCents: number; variacaoCents: number };
type LinhaPct = { rotulo: string; carteira: number | null; cdi: number | null; ipca: number | null };
type LinhaAcumulada = { rotulo: string; carteira: number; cdi: number; ipca: number };

const acumula = (pcts: Array<number | null>): number => {
  let fator = 1;
  for (const pct of pcts) if (pct !== null) fator *= 1 + pct / 100;
  return Math.round((fator - 1) * 1_000_000) / 10_000;
};

const rotuloTrimestre = (mes: string): string => {
  const [ano = "0000", mesNumero = "01"] = mes.split("-");
  return `T${Math.ceil(Number(mesNumero) / 3)}/${ano.slice(2)}`;
};

function visaoRs(meses: Mes[], trimestral: boolean): LinhaRs[] {
  const linhas = meses.map((mes) => ({
    rotulo: formataMes(mes.month), patrimonioCents: mes.patrimonioCents,
    aporteCents: mes.investedCents, resgateCents: mes.redeemedCents,
    rendimentoCents: mes.rendimentoCents,
    variacaoCents: mes.rendimentoCents + mes.investedCents - mes.redeemedCents,
  }));
  if (!trimestral) return linhas;
  const grupos: LinhaRs[] = [];
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
      rendimentoCents: grupo.reduce((total, linha) => total + linha.rendimentoCents, 0),
      variacaoCents: grupo.at(-1)!.patrimonioCents - anterior,
    });
  }
  return grupos;
}

function visaoPct(meses: Mes[], trimestral: boolean): LinhaPct[] {
  if (!trimestral) {
    return meses.map((mes) => ({
      rotulo: formataMes(mes.month), carteira: mes.portfolioPct, cdi: mes.cdiPct, ipca: mes.ipcaPct,
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
    });
  }
  return linhas;
}

function visaoAcumulada(meses: Mes[]): LinhaAcumulada[] {
  const linhas: LinhaAcumulada[] = [];
  let carteira = 1, cdi = 1, ipca = 1;
  for (const mes of meses) {
    if (mes.portfolioPct !== null) carteira *= 1 + mes.portfolioPct / 100;
    if (mes.cdiPct !== null) cdi *= 1 + mes.cdiPct / 100;
    if (mes.ipcaPct !== null) ipca *= 1 + mes.ipcaPct / 100;
    linhas.push({ rotulo: formataMes(mes.month), carteira: (carteira - 1) * 100, cdi: (cdi - 1) * 100, ipca: (ipca - 1) * 100 });
  }
  return linhas;
}

function TooltipRs({ active, payload }: { active?: boolean; payload?: Array<{ payload: LinhaRs }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const linha = payload[0]!.payload;
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-title">{linha.rotulo}</p>
      <p>Patrimônio: <strong>{formataBRL(linha.patrimonioCents)}</strong></p>
      <p>Variação: {formataBRL(linha.variacaoCents)}</p>
      <p>Aporte: {formataBRL(linha.aporteCents)} · Resgate: {formataBRL(linha.resgateCents)}</p>
      <p>Rendimento: {formataBRL(linha.rendimentoCents)}</p>
    </div>
  );
}

function TooltipPct({ active, payload }: { active?: boolean; payload?: Array<{ payload: LinhaPct }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const linha = payload[0]!.payload;
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-title">{linha.rotulo}</p>
      <p>Carteira: {linha.carteira === null ? "—" : formataPercentualSinal(linha.carteira)}</p>
      <p>CDI: {linha.cdi === null ? "—" : formataPercentualSinal(linha.cdi)} · IPCA: {linha.ipca === null ? "—" : formataPercentualSinal(linha.ipca)}</p>
    </div>
  );
}

export function EvolucaoChart({ history, performance, altura = 280 }: {
  history: HistoryPoint[]; performance: Performance; altura?: number;
}) {
  const [aba, setAba] = useState<Aba>("rs");
  const [subAba, setSubAba] = useState<SubAba>("mes");
  const patrimonioPorMes = new Map(history.map((point) => [point.month, point.marketValueCents]));
  const meses: Mes[] = performance.months.map((mes) => ({ ...mes, patrimonioCents: patrimonioPorMes.get(mes.month) ?? 0 }));
  const trimestral = meses.length > 24;
  const linhasRs = visaoRs(meses, trimestral);
  const linhasPct = visaoPct(meses, trimestral);
  const linhasAcumuladas = visaoAcumulada(meses);
  const dados = aba === "rs" ? linhasRs : subAba === "mes" ? linhasPct : linhasAcumuladas;

  if (meses.length === 0) {
    return (
      <div className="empty">
        <p className="empty-title">Sem histórico suficiente</p>
        <p className="empty-hint">A evolução aparece quando houver cotações e índices no período.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="chart-controles">
        <button type="button" className={aba === "rs" ? "chip active" : "chip"} onClick={() => setAba("rs")}>R$</button>
        <button type="button" className={aba === "pct" ? "chip active" : "chip"} onClick={() => setAba("pct")}>%</button>
        {aba === "pct" && (
          <>
            <span className="section-hint">·</span>
            <button type="button" className={subAba === "mes" ? "chip active" : "chip"} onClick={() => setSubAba("mes")}>Mês a mês</button>
            <button type="button" className={subAba === "acumulado" ? "chip active" : "chip"} onClick={() => setSubAba("acumulado")}>Acumulado</button>
          </>
        )}
        {trimestral && <span className="section-hint">· por trimestre</span>}
      </div>

      <ResponsiveContainer width="100%" height={altura}>
        {aba === "rs" ? (
          <ComposedChart data={linhasRs} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="rotulo" tickLine={false} axisLine={false} fontSize={12} />
            <YAxis yAxisId="valor" tickLine={false} axisLine={false} fontSize={12} width={64}
              tickFormatter={(valor: number) => formataBRL(valor)} />
            <YAxis yAxisId="fluxo" orientation="right" tickLine={false} axisLine={false} fontSize={11} width={56}
              tickFormatter={(valor: number) => formataBRL(valor)} />
            <Tooltip content={<TooltipRs />} />
            <Legend />
            <Area yAxisId="valor" type="monotone" dataKey="patrimonioCents" name="Patrimônio" stroke="var(--accent)" fill="var(--accent-soft)" strokeWidth={2} />
            <Bar yAxisId="fluxo" dataKey="aporteCents" name="Aporte" fill="var(--sand)" />
            <Bar yAxisId="fluxo" dataKey="resgateCents" name="Resgate" fill="var(--danger)" />
          </ComposedChart>
        ) : subAba === "mes" ? (
          <ComposedChart data={linhasPct} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="rotulo" tickLine={false} axisLine={false} fontSize={12} />
            <YAxis tickLine={false} axisLine={false} fontSize={12} width={48} tickFormatter={(valor: number) => `${valor}%`} />
            <ReferenceLine y={0} stroke="var(--border-strong)" />
            <Tooltip content={<TooltipPct />} />
            <Legend />
            <Bar dataKey="carteira" name="Carteira">
              {linhasPct.map((linha, index) => (
                <Cell key={index} fill={linha.carteira !== null && linha.cdi !== null && linha.carteira < linha.cdi ? "var(--danger)" : "var(--accent)"} />
              ))}
            </Bar>
            <Bar dataKey="cdi" name="CDI" fill="var(--sand)" />
            <Bar dataKey="ipca" name="IPCA" fill="var(--olive)" />
          </ComposedChart>
        ) : (
          <LineChart data={linhasAcumuladas} margin={{ top: 8, right: 44, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="rotulo" tickLine={false} axisLine={false} fontSize={12} />
            <YAxis tickLine={false} axisLine={false} fontSize={12} width={48} tickFormatter={(valor: number) => `${valor}%`} />
            <ReferenceLine y={0} stroke="var(--border-strong)" strokeDasharray="3 3" />
            <Tooltip content={<TooltipPct />} />
            <Legend />
            <Line type="monotone" dataKey="carteira" name="Carteira" stroke="var(--accent)" strokeWidth={2} dot={false}>
              <LabelList dataKey="carteira" content={(props) => <RotuloFinal {...props} ultimo={linhasAcumuladas.length - 1} />} />
            </Line>
            <Line type="monotone" dataKey="cdi" name="CDI" stroke="var(--sand)" strokeWidth={1.5} dot={false}>
              <LabelList dataKey="cdi" content={(props) => <RotuloFinal {...props} ultimo={linhasAcumuladas.length - 1} />} />
            </Line>
            <Line type="monotone" dataKey="ipca" name="IPCA" stroke="var(--olive)" strokeWidth={1.5} dot={false}>
              <LabelList dataKey="ipca" content={(props) => <RotuloFinal {...props} ultimo={linhasAcumuladas.length - 1} />} />
            </Line>
          </LineChart>
        )}
      </ResponsiveContainer>

      <div className="chart-foot">
        <span>carteira <strong>{formataPercentualSinal(performance.accumulated.portfolioPct)}</strong></span>
        <span>CDI {formataPercentualSinal(performance.accumulated.cdiPct)}</span>
        <span>IPCA {formataPercentualSinal(performance.accumulated.ipcaPct)}</span>
        <span>diferença vs CDI: {formataPontosPercentuais(performance.accumulated.diffCdiPp)}</span>
        <span>bateu o CDI em {performance.monthsBeaten} de {performance.monthsTotal} meses</span>
      </div>
    </div>
  );
}

function RotuloFinal(props: { index?: number; x?: number | string; y?: number | string; value?: number | string; ultimo: number }) {
  if (props.index !== props.ultimo) return null;
  return (
    <text x={Number(props.x) + 6} y={Number(props.y)} fontSize={11} fill="var(--text-2)">
      {formataPercentual(Number(props.value))}
    </text>
  );
}
```

- [ ] **Step 2: Trocar `web/src/views/OverviewView.tsx` pela versão completa**

```tsx
import { useCallback, useEffect, useState } from "react";
import { ChartPie, Coins, WarningCircle } from "@phosphor-icons/react";
import {
  getAllocation, getHealth, getHistory, getPerformance, getPortfolio,
  type Allocation, type AllocationBy, type Health, type HistoryPoint, type Performance, type Portfolio, type PortfolioPosition,
} from "../api.ts";
import { formataBRL, formataCategoria, formataJanela, formataPercentualSinal, mesDeslocado } from "../format.ts";
import { EvolucaoChart } from "../components/EvolucaoChart.tsx";

type Periodo = "1a" | "5a" | "tudo";
const PERIODOS: Array<{ id: Periodo; rotulo: string }> = [
  { id: "1a", rotulo: "1 ano" }, { id: "5a", rotulo: "5 anos" }, { id: "tudo", rotulo: "Tudo" },
];
const ALOCACOES: Array<{ by: AllocationBy; rotulo: string }> = [
  { by: "category", rotulo: "Categoria" }, { by: "broker", rotulo: "Corretora" }, { by: "objective", rotulo: "Objetivo" },
];
const NOMES_KIND: Record<string, string> = { fixed_income: "Renda fixa", equity: "Renda variável", pension: "Previdência" };
const ORDEM_KIND: Array<PortfolioPosition["kind"]> = ["fixed_income", "equity", "pension"];

type Dados = { portfolio: Portfolio; history: HistoryPoint[]; performance: Performance; performance12m: Performance; allocation: Allocation; health: Health };

function inicioDoPeriodo(periodo: Periodo, mes: string): string {
  if (periodo === "1a") return mesDeslocado(mes, -11);
  if (periodo === "5a") return mesDeslocado(mes, -59);
  return "2000-01";
}

export function OverviewView({ reloadToken, onAbrirPosicoes, onAbrirFontes }: {
  reloadToken: number;
  onAbrirPosicoes: (kind: PortfolioPosition["kind"]) => void;
  onAbrirFontes: () => void;
}) {
  const [periodo, setPeriodo] = useState<Periodo>("1a");
  const [alocacaoBy, setAlocacaoBy] = useState<AllocationBy>("category");
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async (signal: AbortSignal) => {
    try {
      const portfolio = await getPortfolio(signal);
      const mes = portfolio.asOf.slice(0, 7);
      const from = inicioDoPeriodo(periodo, mes);
      const [history, performance, performance12m, allocation, health] = await Promise.all([
        getHistory(from, mes, signal),
        getPerformance(from, mes, signal),
        getPerformance(mesDeslocado(mes, -11), mes, signal),
        getAllocation(alocacaoBy, signal),
        getHealth(signal),
      ]);
      setDados({ portfolio, history, performance, performance12m, allocation, health });
      setErro(null);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setErro(cause instanceof Error ? cause.message : String(cause));
    }
  }, [periodo, alocacaoBy]);

  useEffect(() => {
    const controller = new AbortController();
    void carregar(controller.signal);
    const id = setInterval(() => void carregar(controller.signal), 5 * 60 * 1000);
    return () => {
      controller.abort();
      clearInterval(id);
    };
  }, [carregar, reloadToken]);

  if (dados === null) {
    return (
      <div className="page">
        <div className="page-head">
          <div>
            <h1 className="page-title">Visão geral</h1>
            <p className="page-sub">Patrimônio, evolução, alocação e fontes.</p>
          </div>
        </div>
        {erro !== null && (
          <div className="callout callout-error" role="alert">
            <WarningCircle size={17} aria-hidden="true" />
            <div><p className="callout-title">Não foi possível carregar</p><p>{erro}</p></div>
          </div>
        )}
      </div>
    );
  }

  const { portfolio, history, performance, performance12m, allocation, health } = dados;
  const capital = portfolio.totals.investedCents - portfolio.totals.redeemedCents;
  const rendimento = portfolio.totals.marketValueCents - capital;
  const rendimentoPct = capital > 0 ? (rendimento / capital) * 100 : 0;
  const porKind = ORDEM_KIND.map((kind) => {
    const posicoes = portfolio.positions.filter((posicao) => posicao.kind === kind);
    const valor = posicoes.reduce((total, posicao) => total + (posicao.marketValueCents ?? 0), 0);
    return { kind, valor, quantidade: posicoes.length, pct: portfolio.totals.marketValueCents > 0 ? (valor / portfolio.totals.marketValueCents) * 100 : 0 };
  });
  const stale = health.sources.filter((source) => source.stale).length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Visão geral</h1>
          <p className="page-sub">Posição em {portfolio.asOf}, com a última cotação disponível de cada fonte.</p>
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

      {erro !== null && (
        <div className="callout callout-error" role="alert">
          <WarningCircle size={17} aria-hidden="true" />
          <div><p className="callout-title">Falha ao atualizar</p><p>{erro}</p></div>
        </div>
      )}

      <div className="colunas">
        <div className="stack">
          <section className="card">
            <div className="section-head">
              <h2 className="section-title">Patrimônio</h2>
              <p className="section-hint">{formataJanela(performance.from, performance.to)}</p>
            </div>
            <p className="stat-value grande">{formataBRL(portfolio.totals.marketValueCents)}</p>
            <p className="section-hint">rendimento {formataBRL(rendimento)} ({formataPercentualSinal(rendimentoPct)} sobre o capital)</p>
          </section>

          <section className="card">
            <div className="section-head">
              <h2 className="section-title">Evolução</h2>
              <p className="section-hint">Janela: {formataJanela(performance.from, performance.to)}.</p>
            </div>
            <EvolucaoChart history={history} performance={performance} />
          </section>
        </div>

        <div className="stack">
          <section className="card">
            <div className="section-head"><h2 className="section-title">Onde está o dinheiro</h2></div>
            <ul className="alloc-list">
              {porKind.map((bloco) => (
                <li className="alloc-row" key={bloco.kind}>
                  <button type="button" className="alloc-line botao-linha" onClick={() => onAbrirPosicoes(bloco.kind)}>
                    <span className="alloc-name">{NOMES_KIND[bloco.kind] ?? bloco.kind}</span>
                    <span className="alloc-value">{formataBRL(bloco.valor)} · {bloco.pct.toFixed(1)}% · {bloco.quantidade} ativos</span>
                  </button>
                  <span className="alloc-bar"><span className="alloc-bar-fill" style={{ width: `${Math.min(100, bloco.pct)}%` }} /></span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <div className="section-head">
              <h2 className="section-title">Meu dinheiro rendeu</h2>
              <p className="section-hint">Cada aporte pesa pelo tempo investido (MWR).</p>
            </div>
            <div className="stats">
              <div className="stat">
                <span className="stat-label">No período</span>
                <span className="stat-value">{performance.mwr.periodPct === null ? "—" : formataPercentualSinal(performance.mwr.periodPct)}</span>
                <span className="stat-note">{formataJanela(performance.from, performance.to)}</span>
              </div>
              <div className="stat">
                <span className="stat-label">CDI · IPCA</span>
                <span className="stat-value">{formataPercentualSinal(performance.accumulated.cdiPct)} · {formataPercentualSinal(performance.accumulated.ipcaPct)}</span>
              </div>
              <div className="stat">
                <span className="stat-label">12 meses</span>
                <span className="stat-value">{performance12m.mwr.periodPct === null ? "—" : formataPercentualSinal(performance12m.mwr.periodPct)}</span>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="section-head">
              <h2 className="section-title">Alocação</h2>
              <div className="chart-controles">
                {ALOCACOES.map((item) => (
                  <button key={item.by} type="button" className={alocacaoBy === item.by ? "chip active" : "chip"} onClick={() => setAlocacaoBy(item.by)}>
                    {item.rotulo}
                  </button>
                ))}
              </div>
            </div>
            {allocation.groups.length === 0 ? (
              <div className="empty"><ChartPie size={22} aria-hidden="true" /><p className="empty-hint">Sem dados de alocação.</p></div>
            ) : (
              <ul className="alloc-list">
                {allocation.groups.map((grupo) => (
                  <li className="alloc-row" key={grupo.key}>
                    <div className="alloc-line">
                      <span className="alloc-name">{alocacaoBy === "category" ? formataCategoria(grupo.key) : grupo.key}</span>
                      <span className="alloc-value">{formataBRL(grupo.marketValueCents)} · {grupo.pct.toFixed(1)}%</span>
                    </div>
                    <span className="alloc-bar"><span className="alloc-bar-fill" style={{ width: `${Math.min(100, grupo.pct)}%` }} /></span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <div className="section-head"><h2 className="section-title">Fontes</h2></div>
            <p className="section-hint">
              <Coins size={14} aria-hidden="true" /> {health.sources.length - stale} ok · {stale} desatualizadas
              {stale > 0 && <span className="badge badge-warn">desatualizado</span>}
            </p>
            <button type="button" className="btn btn-secondary" onClick={onAbrirFontes}>Ver fontes</button>
          </section>
        </div>
      </div>
    </div>
  );
}
```

Adicionar em `styles.css` os estilos que a view usa:

```css
.stat-value.grande { font-size: 34px; letter-spacing: -0.03em; }
.chip {
  padding: 5px 10px; border: 1px solid var(--border); border-radius: var(--radius-pill);
  background: var(--surface); color: var(--text-2); font: inherit; font-size: 13px; cursor: pointer;
}
.chip.active { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.botao-linha { display: flex; width: 100%; border: none; background: transparent; padding: 0; font: inherit; text-align: left; cursor: pointer; }
```

- [ ] **Step 3: Verificar**

```bash
npm run typecheck
npm run build:web
```

Expected: typecheck limpo; build ok (aviso de chunk > 500 kB do Recharts é aceitável). Com `npm run dev:web` + container de pé: Visão geral com patrimônio, gráfico (R$/%), blocos por tipo clicando para Posições, MWR e alocação com seletor.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/EvolucaoChart.tsx web/src/views/OverviewView.tsx web/src/styles.css
git commit -m "feat: visao geral em duas colunas com grafico R$/%, MWR e alocacao"
```

---

### Task 6: `PositionsView`

**Files:**
- Modify: `web/src/views/PositionsView.tsx`

**Interfaces:**
- Consumes: `Portfolio`, `PortfolioPosition`, `Transaction`, `getPortfolio`, `getTransactions`, `Health`; formatadores.
- Produces: lista dos 48 ativos com busca, filtros (tipo/corretora/objetivo), ordenação (valor ↓, nome, rendimento R$, rendimento %, % da carteira) e painel lateral com transações; `null` → "—" e badge "desatualizado".

- [ ] **Step 1: Implementar `web/src/views/PositionsView.tsx`**

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { MagnifyingGlass, Table, X } from "@phosphor-icons/react";
import { getPortfolio, getTransactions, type PortfolioPosition, type Transaction } from "../api.ts";
import { formataBRL, formataCategoria, formataDataHora, formataMes, formataPercentualSinal, formataQuantidade } from "../format.ts";

type Ordem = "valor" | "nome" | "rendimento" | "rendimentoPct" | "pct";

function rendimentoDe(posicao: PortfolioPosition): { cents: number; pct: number | null } {
  const capital = posicao.investedCents - posicao.redeemedCents;
  const cents = (posicao.marketValueCents ?? 0) - capital;
  return { cents, pct: capital > 0 ? (cents / capital) * 100 : null };
}

function precoMedio(transacao: Transaction): string {
  if (transacao.quantityE8 === null || transacao.quantityE8 === 0) return "—";
  return formataBRL(Math.round(transacao.grossCents / (transacao.quantityE8 / 1e8)));
}

const ROTULO_KIND: Record<string, string> = { fixed_income: "Renda fixa", equity: "Renda variável", pension: "Previdência" };
const ROTULO_OPERACAO: Record<string, string> = { BUY: "Compra", SELL: "Venda", AMORTIZATION: "Amortização", INTEREST: "Juros", DIVIDEND: "Dividendo" };

export function PositionsView({ reloadToken, filtroInicial }: {
  reloadToken: number; filtroInicial: PortfolioPosition["kind"] | null;
}) {
  const [posicoes, setPosicoes] = useState<PortfolioPosition[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [kind, setKind] = useState<PortfolioPosition["kind"] | "todos">(filtroInicial ?? "todos");
  const [corretora, setCorretora] = useState("todas");
  const [objetivo, setObjetivo] = useState("todos");
  const [ordem, setOrdem] = useState<Ordem>("valor");
  const [selecionada, setSelecionada] = useState<PortfolioPosition | null>(null);
  const [transacoes, setTransacoes] = useState<Transaction[] | null>(null);

  useEffect(() => {
    setKind(filtroInicial ?? "todos");
  }, [filtroInicial]);

  useEffect(() => {
    const controller = new AbortController();
    getPortfolio(controller.signal)
      .then((portfolio) => { setPosicoes(portfolio.positions); setErro(null); })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setErro(cause instanceof Error ? cause.message : String(cause));
      });
    return () => controller.abort();
  }, [reloadToken]);

  useEffect(() => {
    if (selecionada === null) return;
    const controller = new AbortController();
    setTransacoes(null);
    getTransactions(selecionada.instrumentId, controller.signal)
      .then(setTransacoes)
      .catch(() => setTransacoes([]));
    return () => controller.abort();
  }, [selecionada]);

  const corretoras = useMemo(() => [...new Set((posicoes ?? []).map((posicao) => posicao.broker ?? "—"))].sort(), [posicoes]);
  const objetivos = useMemo(() => [...new Set((posicoes ?? []).map((posicao) => posicao.objective ?? "—"))].sort(), [posicoes]);
  const total = (posicoes ?? []).reduce((soma, posicao) => soma + (posicao.marketValueCents ?? 0), 0);

  const visiveis = (posicoes ?? [])
    .filter((posicao) => posicao.name.toLowerCase().includes(busca.trim().toLowerCase()))
    .filter((posicao) => kind === "todos" || posicao.kind === kind)
    .filter((posicao) => corretora === "todas" || (posicao.broker ?? "—") === corretora)
    .filter((posicao) => objetivo === "todos" || (posicao.objective ?? "—") === objetivo)
    .sort((a, b) => {
      if (ordem === "nome") return a.name.localeCompare(b.name, "pt-BR");
      if (ordem === "rendimento") return rendimentoDe(b).cents - rendimentoDe(a).cents;
      if (ordem === "rendimentoPct") return (rendimentoDe(b).pct ?? -Infinity) - (rendimentoDe(a).pct ?? -Infinity);
      if (ordem === "pct") return (b.marketValueCents ?? 0) - (a.marketValueCents ?? 0);
      return (b.marketValueCents ?? 0) - (a.marketValueCents ?? 0);
    });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Posições</h1>
          <p className="page-sub">{visiveis.length} de {(posicoes ?? []).length} ativos · valor total {formataBRL(total)}</p>
        </div>
      </div>

      {erro !== null && <div className="callout callout-error" role="alert"><p>{erro}</p></div>}

      <div className="card filtros">
        <label className="campo">
          <span className="stat-label">Busca</span>
          <span className="campo-com-icone">
            <MagnifyingGlass size={15} aria-hidden="true" />
            <input value={busca} onChange={(evento) => setBusca(evento.target.value)} placeholder="Nome do ativo" />
          </span>
        </label>
        <label className="campo">
          <span className="stat-label">Tipo</span>
          <select value={kind} onChange={(evento) => setKind(evento.target.value as PortfolioPosition["kind"] | "todos")}>
            <option value="todos">Todos</option>
            <option value="fixed_income">Renda fixa</option>
            <option value="equity">Renda variável</option>
            <option value="pension">Previdência</option>
          </select>
        </label>
        <label className="campo">
          <span className="stat-label">Corretora</span>
          <select value={corretora} onChange={(evento) => setCorretora(evento.target.value)}>
            <option value="todas">Todas</option>
            {corretoras.map((valor) => <option key={valor} value={valor}>{valor}</option>)}
          </select>
        </label>
        <label className="campo">
          <span className="stat-label">Objetivo</span>
          <select value={objetivo} onChange={(evento) => setObjetivo(evento.target.value)}>
            <option value="todos">Todos</option>
            {objetivos.map((valor) => <option key={valor} value={valor}>{valor}</option>)}
          </select>
        </label>
        <label className="campo">
          <span className="stat-label">Ordenar por</span>
          <select value={ordem} onChange={(evento) => setOrdem(evento.target.value as Ordem)}>
            <option value="valor">Valor (↓)</option>
            <option value="nome">Nome</option>
            <option value="rendimento">Rendimento (R$)</option>
            <option value="rendimentoPct">Rendimento (%)</option>
            <option value="pct">% da carteira</option>
          </select>
        </label>
      </div>

      {visiveis.length === 0 ? (
        <div className="empty">
          <Table size={22} aria-hidden="true" />
          <p className="empty-title">Nenhum ativo</p>
          <p className="empty-hint">Ajuste os filtros ou importe a planilha em Importar.</p>
        </div>
      ) : (
        <div className="table-wrap card">
          <table>
            <caption className="sr-only">Posições da carteira</caption>
            <thead>
              <tr>
                <th scope="col">Ativo</th>
                <th scope="col">Setor</th>
                <th scope="col" className="num">Valor</th>
                <th scope="col" className="num">%</th>
                <th scope="col" className="num">Rendimento</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((posicao) => {
                const rendimento = rendimentoDe(posicao);
                return (
                  <tr key={posicao.instrumentId} onClick={() => setSelecionada(posicao)} className="linha-clicavel">
                    <td>
                      {posicao.name}
                      {posicao.stale && <span className="badge badge-warn">desatualizado</span>}
                    </td>
                    <td>{ROTULO_KIND[posicao.kind] ?? posicao.kind}</td>
                    <td className="num">{posicao.marketValueCents === null ? "—" : formataBRL(posicao.marketValueCents)}</td>
                    <td className="num">{total > 0 && posicao.marketValueCents !== null ? formataPercentualSinal((posicao.marketValueCents / total) * 100) : "—"}</td>
                    <td className={`num ${rendimento.cents >= 0 ? "rendimento-positivo" : "rendimento-negativo"}`}>
                      {formataBRL(rendimento.cents)}{rendimento.pct === null ? "" : ` (${formataPercentualSinal(rendimento.pct)})`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selecionada !== null && (
        <aside className="painel-ativo" aria-label={`Detalhes de ${selecionada.name}`}>
          <div className="section-head">
            <h2 className="section-title">{selecionada.name}</h2>
            <button type="button" className="btn btn-secondary" onClick={() => setSelecionada(null)}>
              <X size={15} /> Fechar
            </button>
          </div>
          <p className="section-hint">
            {formataCategoria(selecionada.category)} · {selecionada.broker ?? "—"} · {ROTULO_KIND[selecionada.kind] ?? selecionada.kind}
          </p>
          <div className="stats">
            <div className="stat"><span className="stat-label">Valor</span><span className="stat-value">{selecionada.marketValueCents === null ? "—" : formataBRL(selecionada.marketValueCents)}</span></div>
            <div className="stat"><span className="stat-label">Quantidade</span><span className="stat-value">{selecionada.quantityE8 === null ? "—" : formataQuantidade(selecionada.quantityE8)}</span></div>
            <div className="stat"><span className="stat-label">Preço</span><span className="stat-value">{selecionada.priceCents === null ? "—" : formataBRL(selecionada.priceCents)}</span></div>
            <div className="stat"><span className="stat-label">Preço em</span><span className="stat-value">{selecionada.priceDate === null ? "—" : formataMes(selecionada.priceDate.slice(0, 7))}</span></div>
          </div>
          <h3 className="section-title">Transações</h3>
          {transacoes === null ? (
            <p className="section-hint">Carregando...</p>
          ) : transacoes.length === 0 ? (
            <p className="section-hint">Sem transações registradas.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th scope="col">Data</th><th scope="col">Tipo</th><th scope="col" className="num">Qtd.</th><th scope="col" className="num">Preço</th><th scope="col" className="num">Valor</th><th scope="col" className="num">Taxas</th></tr>
                </thead>
                <tbody>
                  {transacoes.map((transacao, index) => (
                    <tr key={index}>
                      <td>{formataDataHora(`${transacao.tradeDate} 00:00:00`)}</td>
                      <td>{ROTULO_OPERACAO[transacao.kind] ?? transacao.kind}</td>
                      <td className="num">{transacao.quantityE8 === null ? "—" : formataQuantidade(transacao.quantityE8)}</td>
                      <td className="num">{precoMedio(transacao)}</td>
                      <td className="num">{formataBRL(transacao.grossCents)}</td>
                      <td className="num">{formataBRL(transacao.feesCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
```

Adicionar em `styles.css`:

```css
.filtros { display: flex; flex-wrap: wrap; gap: 12px; padding: 14px 16px; }
.campo { display: flex; flex-direction: column; gap: 4px; min-width: 150px; }
.campo-com-icone { display: flex; align-items: center; gap: 6px; border: 1px solid var(--border); border-radius: var(--radius-control); padding: 6px 8px; background: var(--surface); }
.campo-com-icone input, .campo select { border: none; background: transparent; font: inherit; color: var(--text); }
.linha-clicavel { cursor: pointer; }
```

- [ ] **Step 2: Verificar**

```bash
npm run typecheck
npm run build:web
```

Expected: limpo. No browser: 48 ativos, filtros e painel de transações funcionando; ativo sem cotação mostra "—".

- [ ] **Step 3: Commit**

```bash
git add web/src/views/PositionsView.tsx web/src/styles.css
git commit -m "feat: lista de posicoes com filtros, ordenacao e painel de transacoes"
```

---

### Task 7: `EvolutionView`

**Files:**
- Modify: `web/src/views/EvolutionView.tsx`

**Interfaces:**
- Consumes: `getHistory`, `getPerformance`, `EvolucaoChart` (T5), formatadores.
- Produces: gráfico grande (mesmo componente), tabela mês a mês (patrimônio, aportes, resgates, rendimento R$ e %, CDI, IPCA, diferença vs CDI, acumulado %) e barras "De onde veio o crescimento".

- [ ] **Step 1: Implementar `web/src/views/EvolutionView.tsx`**

```tsx
import { useCallback, useEffect, useState } from "react";
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
                        {formataBRL(mes.rendimentoCents)}{mes.portfolioPct === null ? "" : ` (${formataPercentualSinal(mes.portfolioPct)})`}
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
            <p className="section-hint">você aportou · o mercado rendeu · você resgatou</p>
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
```

- [ ] **Step 2: Verificar**

```bash
npm run typecheck
npm run build:web
```

Expected: limpo. No browser: janela escrita, tabela mês a mês com números da API e o gráfico empilhado.

- [ ] **Step 3: Commit**

```bash
git add web/src/views/EvolutionView.tsx
git commit -m "feat: tela de evolucao com tabela mes a mes e crescimento"
```

---

### Task 8: `SourcesView` com reconciliação

**Files:**
- Modify: `web/src/views/SourcesView.tsx`

**Interfaces:**
- Consumes: `getHealth`, `getReconciliation`, `postRefresh`, `Health`, `Reconciliation`, `RefreshResult`; formatadores.
- Produces: cartões por fonte (última tentativa, último sucesso, stale, último erro), botão "Atualizar cotações" com resultado por fonte e reparo do B5P211, e a seção de reconciliação (cards, tabela de divergências com causa legível e selo).

- [ ] **Step 1: Implementar `web/src/views/SourcesView.tsx`**

```tsx
import { useCallback, useEffect, useState } from "react";
import { ArrowsClockwise, WarningCircle } from "@phosphor-icons/react";
import { getHealth, getReconciliation, postRefresh, type Health, type Reconciliation, type RefreshResult } from "../api.ts";
import { formataBRL, formataDataHora, formataMes, formataNumero } from "../format.ts";

const ROTULO_CAUSA: Record<string, string> = {
  "residuo-zerado": "Resíduo zerado (regra)",
  "transacao-fora-da-janela": "Transação posterior à data do snapshot",
  "legado-snapshot-maio-2025": "Snapshot do legado menor que o principal (maio/2025)",
  "legado-sem-cdi-maio-2026": "Legado sem capitalização CDI (maio/2026)",
  "legado-sem-selic-junho-2026": "Legado sem capitalização Selic (junho/2026)",
  "fonte-yahoo-corrompida": "Fonte Yahoo corrompida no histórico",
  "data-de-referencia": "Data de referência do snapshot do legado",
  "cotacao-fora-da-janela": "Cotação posterior ao snapshot do legado (mês corrente)",
  "nao-explicada": "Não explicada",
};

const mesAtual = (): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()).slice(0, 7);

export function SourcesView({ reloadToken }: { reloadToken: number }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [reconciliation, setReconciliation] = useState<Reconciliation | null>(null);
  const [resultado, setResultado] = useState<RefreshResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async (signal: AbortSignal) => {
    try {
      const [novoHealth, novaRecon] = await Promise.all([getHealth(signal), getReconciliation(mesAtual(), signal)]);
      setHealth(novoHealth);
      setReconciliation(novaRecon);
      setErro(null);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setErro(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void carregar(controller.signal);
    const id = setInterval(() => void carregar(controller.signal), 5 * 60 * 1000);
    return () => {
      controller.abort();
      clearInterval(id);
    };
  }, [carregar, reloadToken]);

  async function atualizar() {
    setBusy(true);
    setErro(null);
    try {
      setResultado(await postRefresh());
      await carregar(new AbortController().signal);
    } catch (cause) {
      setErro(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Fontes</h1>
          <p className="page-sub">Coleta, desatualização e reconciliação com o legado.</p>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => void atualizar()}>
            <ArrowsClockwise size={15} />
            {busy ? "Atualizando..." : "Atualizar cotações"}
          </button>
        </div>
      </div>

      {erro !== null && (
        <div className="callout callout-error" role="alert">
          <WarningCircle size={17} aria-hidden="true" />
          <div><p className="callout-title">Falha</p><p>{erro}</p></div>
        </div>
      )}

      <div className="stack">
        <section className="card">
          <div className="section-head"><h2 className="section-title">Estado das fontes</h2></div>
          {health === null ? (
            <p className="section-hint">Carregando...</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th scope="col">Fonte</th><th scope="col">Última tentativa</th><th scope="col">Último sucesso</th><th scope="col">Estado</th><th scope="col">Último erro</th></tr>
                </thead>
                <tbody>
                  {health.sources.map((source) => (
                    <tr key={source.id}>
                      <td>{source.id}</td>
                      <td>{source.lastAttemptAt === null ? "—" : formataDataHora(source.lastAttemptAt)}</td>
                      <td>{source.lastSuccessAt === null ? "—" : formataDataHora(source.lastSuccessAt)}</td>
                      <td>{source.stale ? <span className="badge badge-warn">desatualizado</span> : <span className="badge badge-ok">ok</span>}</td>
                      <td>{source.lastError ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {resultado !== null && (
          <section className="card">
            <div className="section-head"><h2 className="section-title">Resultado do refresh</h2></div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th scope="col">Fonte</th><th scope="col" className="num">Buscados</th><th scope="col" className="num">Inseridos</th><th scope="col" className="num">Atualizados</th><th scope="col" className="num">Pulados</th><th scope="col">Erros</th></tr>
                </thead>
                <tbody>
                  {resultado.sources.map((source) => (
                    <tr key={source.id}>
                      <td>{source.id}</td>
                      <td className="num">{source.fetched}</td>
                      <td className="num">{source.inserted}</td>
                      <td className="num">{source.updated}</td>
                      <td className="num">{source.skipped}</td>
                      <td>{source.errors.length === 0 ? "—" : source.errors.join(" · ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {resultado.repairs.length > 0 && (
              <p className="section-hint">
                Reparo: {resultado.repairs.map((repair) => repair.error !== undefined
                  ? `${repair.ticker} ${repair.from}..${repair.to} falhou (${repair.error})`
                  : `${repair.ticker} ${repair.from}..${repair.to}: ${repair.deleted} linhas apagadas, ${repair.inserted} pontos gravados`).join(" · ")}
              </p>
            )}
          </section>
        )}

        {reconciliation !== null && (
          <section className="card">
            <div className="section-head">
              <h2 className="section-title">Reconciliação — {formataMes(reconciliation.month)}</h2>
              {reconciliation.unexplained === 0 ? (
                <span className="badge badge-ok">{formataNumero(reconciliation.divergences.length)} divergências explicadas</span>
              ) : (
                <span className="badge badge-error">{formataNumero(reconciliation.unexplained)} não explicadas</span>
              )}
            </div>
            <p className="section-hint">Compara o cálculo do app com o snapshot do legado em {reconciliation.asOf}. Divergências conhecidas têm causa registrada; igualdade não é forçada.</p>
            <div className="stats">
              <div className="stat"><span className="stat-label">Legado</span><span className="stat-value">{formataBRL(reconciliation.totals.legacyCents)}</span></div>
              <div className="stat"><span className="stat-label">Referência (resíduos zerados)</span><span className="stat-value">{formataBRL(reconciliation.totals.referenceCents)}</span></div>
              <div className="stat"><span className="stat-label">Nosso</span><span className="stat-value">{formataBRL(reconciliation.totals.ourCents)}</span></div>
              <div className="stat"><span className="stat-label">Diferença</span><span className="stat-value">{formataBRL(reconciliation.totals.diffCents)}</span></div>
            </div>
            {reconciliation.divergences.length > 0 && (
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">Divergências da reconciliação</caption>
                  <thead>
                    <tr><th scope="col">Ativo</th><th scope="col" className="num">Legado</th><th scope="col" className="num">Nosso</th><th scope="col" className="num">Diferença</th><th scope="col">Causa</th></tr>
                  </thead>
                  <tbody>
                    {reconciliation.divergences.map((divergence) => (
                      <tr key={divergence.instrumentId}>
                        <td>{divergence.name}</td>
                        <td className="num">{formataBRL(divergence.legacyCents)}</td>
                        <td className="num">{formataBRL(divergence.ourCents)}</td>
                        <td className="num">{formataBRL(divergence.diffCents)}</td>
                        <td>{ROTULO_CAUSA[divergence.cause] ?? divergence.cause}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificar**

```bash
npm run typecheck
npm run build:web
```

Expected: limpo. No browser: fontes com estado, refresh mostrando linhas por fonte e reconciliação com 0 não explicadas em 2026-09.

- [ ] **Step 3: Commit**

```bash
git add web/src/views/SourcesView.tsx
git commit -m "feat: secao de fontes com resultado do refresh e reconciliacao"
```

---

### Task 9: Verificação final e fechamento

**Files:**
- Modify: `ROADMAP.md`
- Verify: tudo

- [ ] **Step 1: Suíte e build**

```bash
npm test
npm run typecheck
npm run build:web
```

Expected: todos os testes verdes (144 anteriores + ~12 novos), typecheck limpo, build ok.

- [ ] **Step 2: Docker com o código novo**

```bash
docker compose up -d --build
sleep 8
curl -s localhost:3000/api/health
curl -s 'localhost:3000/api/performance?from=2025-10&to=2026-09' | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['from'], d['to'], d['accumulated'], d['monthsBeaten'], '/', d['monthsTotal'], d['mwr'])"
curl -s 'localhost:3000/api/performance?from=2000-01&to=2026-09' | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['from'], d['to'], d['accumulated'], d['monthsBeaten'], '/', d['monthsTotal'], d['mwr'])"
curl -s 'localhost:3000/api/reconciliation?month=2026-09&asOf=2026-09-16' | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['totals'], d['unexplained'])"
```

Expected:
- 1 ano: `2025-10 2026-09 {'portfolioPct': 14.14, 'cdiPct': 14.01, 'ipcaPct': 3.73, ...} 6 / 12` e `mwr.periodPct` ≈ 14.15.
- Tudo: `2025-05 2026-09` com carteira ≈ 22.07, CDI ≈ 20.89, IPCA ≈ 4.90, 10/17 e MWR ≈ 21.40.
- Reconciliação: `referenceCents = <valor>`, `unexplained = 0`.
Se algum número divergir do aceite, **não** ajuste a fórmula para bater: registre o valor real e a diferença no ROADMAP/handoff (o legado é a referência; arredondamento de 1 casa é aceitável, > 0,05 p.p. não).

- [ ] **Step 3: Verificação no browser com dados reais**

Com `npm run dev:web` (proxy para `:3000`), verificar (agent-browser + screenshot em `.superpowers/sdd/s7-*.png`):
1. Paleta Papel quente em todas as 5 seções; sem tema escuro.
2. Visão geral em duas colunas, sem tabela de ativos e sem reconciliação; janela escrita ("out/2025 → set/2026" no padrão).
3. Gráfico: abas R$, % · Mês a mês, % · Acumulado; períodos 1 ano · 5 anos · Tudo; rodapé com acumulados e "bateu o CDI em 6 de 12 meses".
4. abr/2026 no modo R$: aporte R$ <valor> e rendimento R$ <valor> (tooltip).
5. Posições: 48 ativos, filtro por tipo/corretora/objetivo, busca e painel de transações; sem cotação mostra "—".
6. Fontes: cards, refresh com resultado por fonte e reconciliação.

- [ ] **Step 4: Atualizar `ROADMAP.md`**

Na tabela de estado: `| S7 — redesign da interface | concluída — merge local |`. Na seção da Etapa 7, trocar o estado para concluída e registrar as evidências (testes, Docker, números reais conferidos, screenshots). Ajustar a linha `npm test = N testes verdes`.

- [ ] **Step 5: Commit final e merge**

```bash
git add ROADMAP.md
git commit -m "docs: registra s7 concluida no roadmap"
git checkout main
git merge --ff-only s7-redesign-interface
git push origin main
```

---

## Autoverificação do plano (feita na escrita)

- **Cobertura da spec:** tokens (T4), shell/sidebar (T4), Visão geral em duas colunas (T5), `EvolucaoChart` com abas/períodos/agregação (T5), MWR card (T5), Posições com painel (T6), Evolução com tabela e crescimento (T7), Fontes + reconciliação (T8), `domain/performance` + service + rota (T1–T3), janela clampada compartilhada (T2), testes de domínio/serviço/rota (T1–T3), aceite numérico e browser (T9), pendências herdadas — `null` → "—" e badge "desatualizado" (T6), cancelamento de request (T5–T8); lazy-load do Recharts fica opcional e é registrado no fechamento (T9) se o bundle incomodar.
- **Sem placeholders:** todos os passos têm código ou comando exato; os stubs de T4 são substituídos integralmente em T5–T8.
- **Consistência de tipos:** `PerformanceMonth`/`Performance` no backend (bigint) e no web (number) espelham o JSON da rota; `resolveHistoryWindow` usado por `/api/history` e pelo serviço; `EvolucaoChart` recebe `history` + `performance` nos dois consumidores.
