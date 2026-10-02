# Projeção do patrimônio na Visão geral — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** card "Projeção do patrimônio" na coluna esquerda da Visão geral, abaixo dos 3 gráficos nomeados, projetando 1–2 anos a partir do padrão recente (média geométrica do TWR dos últimos 12 meses + aporte líquido médio) com faixa ±1 desvio-padrão.

**Architecture:** domínio puro e testado (`src/domain/projection.ts`) → serviço (`src/services/projection.ts`, reusa `resolveHistoryWindow`/`buildPerformance`/`buildHistory`) → rota `GET /api/projection` (24 meses, sem parâmetros) → web (`web/src/components/ProjecaoChart.tsx` + card na `OverviewView` com chips 1 ano · 2 anos). Sem persistência, migration ou mudança de banco. Spec: `docs/superpowers/specs/2026-09-25-projecao-patrimonio-design.md`.

**Tech Stack:** TypeScript + Node 22 (`node --test`, type stripping), Fastify, better-sqlite3, React 19 + Recharts 3 (área de intervalo por `dataKey` com `[min, max]`), Vite 8, CSS puro.

## Global Constraints

- Zero `float` em dado persistido/cálculo: valores em centavos `bigint`; taxa/σ em % com 4 casas (`number`, como `src/domain/performance.ts`); fator mensal escalado em e6.
- Artefatos e commits em pt-BR; commits convencionais sem acento (`feat:`, `docs:`).
- Web não tem runner de testes: nenhum teste automatizado novo no `web/` — verificação por `npm run typecheck`, `npm run build:web` e browser com dados reais.
- Cada task é 1 layer com ≤ 400 linhas / ≤ 10 arquivos; `package-lock.json` não muda nesta branch.
- `npm test` usa `node --test "src/**/*.test.ts"`; baseline da branch: **204 testes verdes**.
- Premissa exibida é estimativa: texto não promete probabilidade ("faixa = ±1 desvio-padrão dos retornos mensais").

---

### Task 1: Domínio da projeção (`src/domain/projection.ts`)

**Files:**
- Create: `src/domain/projection.ts`
- Test: `src/domain/projection.test.ts`

**Interfaces:**
- Consumes: `divRoundHalfUp` de `src/domain/money.ts` (linha 13).
- Produces: `MIN_MONTHS = 6`; `type ProjectionPremise = { monthsUsed: number; monthlyRatePct: number; bandPp: number; contributionCents: bigint; pessimisticMonthlyPct: number; optimisticMonthlyPct: number }`; `projectionPremise(returnsPct: Array<number | null>, netContributionsCents: bigint[]): ProjectionPremise | null`; `type ProjectionPoint = { baseCents: bigint; pessimisticCents: bigint; optimisticCents: bigint }`; `projectPatrimony(patrimonyCents: bigint, premise: Pick<ProjectionPremise, "contributionCents" | "monthlyRatePct" | "pessimisticMonthlyPct" | "optimisticMonthlyPct">, months: number): ProjectionPoint[]`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/domain/projection.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_MONTHS, projectPatrimony, projectionPremise } from "./projection.ts";

test("projectionPremise usa media geometrica, desvio amostral e aporte medio", () => {
  const premise = projectionPremise([2, -1, 2, -1, 2, -1], [100n, 200n, 300n, 400n, 500n, 600n]);
  assert.ok(premise !== null);
  assert.equal(MIN_MONTHS, 6);
  assert.equal(premise.monthsUsed, 6);
  assert.equal(premise.monthlyRatePct, 0.4888); // sqrt(1,02 × 0,99) − 1; a média aritmética daria 0,5
  assert.equal(premise.bandPp, 1.6432); // desvio amostral de [2, −1, 2, −1, 2, −1]
  assert.equal(premise.contributionCents, 350n); // (100 + … + 600) ÷ 6
  assert.equal(premise.pessimisticMonthlyPct, -1.1544);
  assert.equal(premise.optimisticMonthlyPct, <valor>);
});

test("projectionPremise ignora null, exige 6 validos e clampa o pessimista em −99", () => {
  assert.equal(projectionPremise([1, 1, null, 1, 1, 1], [0n]), null); // 5 válidos
  assert.equal(projectionPremise([1, 1, null, 1, 1, 1, 1, null], [0n])?.monthsUsed, 6);
  const clamp = projectionPremise([-100, 0, 0, 0, 0, 0], [0n, 0n, 0n, 0n, 0n, 0n]);
  assert.ok(clamp !== null);
  assert.equal(clamp.monthlyRatePct, -100);
  assert.equal(clamp.bandPp, 40.8248);
  assert.equal(clamp.pessimisticMonthlyPct, -99);
  assert.equal(clamp.optimisticMonthlyPct, -59.1752);
});

test("projectionPremise arredonda o aporte half-up e aceita aporte negativo", () => {
  assert.equal(projectionPremise([0, 0, 0, 0, 0, 0], [1n, 0n])?.contributionCents, 1n);
  assert.equal(projectionPremise([0, 0, 0, 0, 0, 0], [-100n, -201n])?.contributionCents, -151n);
});

test("projectPatrimony compoe aporte e taxa por cenario", () => {
  const premise = { contributionCents: 1_000n, monthlyRatePct: 1, pessimisticMonthlyPct: 0.5, optimisticMonthlyPct: 1.5 };
  assert.deepEqual(projectPatrimony(100_000n, premise, 2), [
    { baseCents: 102_010n, pessimisticCents: 101_505n, optimisticCents: 102_515n },
    { baseCents: 104_040n, pessimisticCents: 103_018n, optimisticCents: 105_068n },
  ]);
  assert.equal(projectPatrimony(100_000n, premise, 24).length, 24);
});

test("projectPatrimony aceita aporte negativo e meses = 0", () => {
  const premise = { contributionCents: -3_000n, monthlyRatePct: 0, pessimisticMonthlyPct: 0, optimisticMonthlyPct: 0 };
  assert.deepEqual(projectPatrimony(10_000n, premise, 2).map((ponto) => ponto.baseCents), [7_000n, 4_000n]);
  assert.deepEqual(projectPatrimony(10_000n, premise, 0), []);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/domain/projection.test.ts`
Expected: FAIL — `Cannot find module`/`ERR_MODULE_NOT_FOUND` para `./projection.ts`.

- [ ] **Step 3: Implementar o domínio**

Criar `src/domain/projection.ts`:

```ts
import { divRoundHalfUp } from "./money.ts";

/** Mínimo de retornos mensais válidos para estimar a projeção. */
export const MIN_MONTHS = 6;

export type ProjectionPremise = {
  monthsUsed: number;
  monthlyRatePct: number;
  bandPp: number;
  contributionCents: bigint;
  pessimisticMonthlyPct: number;
  optimisticMonthlyPct: number;
};

/** Padrão recente: média geométrica do retorno mensal, desvio-padrão amostral e aporte líquido médio. */
export function projectionPremise(
  returnsPct: Array<number | null>,
  netContributionsCents: bigint[],
): ProjectionPremise | null {
  const valid = returnsPct.filter((pct): pct is number => pct !== null);
  if (valid.length < MIN_MONTHS || netContributionsCents.length === 0) return null;
  let factor = 1;
  for (const pct of valid) factor *= 1 + pct / 100;
  const monthlyRatePct = round4((factor ** (1 / valid.length) - 1) * 100);
  const mean = valid.reduce((total, pct) => total + pct, 0) / valid.length;
  const variance = valid.reduce((total, pct) => total + (pct - mean) ** 2, 0) / (valid.length - 1);
  const bandPp = round4(Math.sqrt(variance));
  return {
    monthsUsed: valid.length,
    monthlyRatePct,
    bandPp,
    contributionCents: divRoundHalfUp(
      netContributionsCents.reduce((total, cents) => total + cents, 0n),
      BigInt(netContributionsCents.length),
    ),
    pessimisticMonthlyPct: round4(Math.max(monthlyRatePct - bandPp, -99)),
    optimisticMonthlyPct: round4(monthlyRatePct + bandPp),
  };
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export type ProjectionPoint = { baseCents: bigint; pessimisticCents: bigint; optimisticCents: bigint };

/** Recorrência mensal (Vₙ₊₁ = (Vₙ + aporte) × (1 + taxa)) para base, pessimista e otimista. */
export function projectPatrimony(
  patrimonyCents: bigint,
  premise: Pick<ProjectionPremise, "contributionCents" | "monthlyRatePct" | "pessimisticMonthlyPct" | "optimisticMonthlyPct">,
  months: number,
): ProjectionPoint[] {
  const rates = [premise.monthlyRatePct, premise.pessimisticMonthlyPct, premise.optimisticMonthlyPct];
  let values = [patrimonyCents, patrimonyCents, patrimonyCents];
  const points: ProjectionPoint[] = [];
  for (let index = 0; index < months; index++) {
    values = values.map((value, scenario) => divRoundHalfUp((value + premise.contributionCents) * factorE6(rates[scenario]!), 1_000_000n));
    points.push({ baseCents: values[0]!, pessimisticCents: values[1]!, optimisticCents: values[2]! });
  }
  return points;
}

/** Fator mensal em e6: 1,0307% → 1_010_307n (1e6 = 1,0). */
function factorE6(ratePct: number): bigint {
  return 1_000_000n + BigInt(Math.round(ratePct * 10_000));
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test src/domain/projection.test.ts`
Expected: `# pass 5` / `# fail 0`.

- [ ] **Step 5: Rodar a suíte completa**

Run: `npm test`
Expected: `# tests 209` / `# pass 209` / `# fail 0` (204 + 5).

- [ ] **Step 6: Commit**

```bash
git add src/domain/projection.ts src/domain/projection.test.ts
git commit -m "feat: dominio da projecao do patrimonio"
```

---

### Task 2: Serviço da projeção (`src/services/projection.ts`)

**Files:**
- Create: `src/services/projection.ts`
- Test: `src/services/projection.test.ts`

**Interfaces:**
- Consumes: `projectionPremise`/`projectPatrimony` da Task 1; `resolveHistoryWindow`/`buildHistory` de `src/services/history.ts`; `buildPerformance` de `src/services/performance.ts`; `addMonths`/`toBrDate` de `src/domain/dates.ts`.
- Produces: `type ProjectionResult = { from: string; to: string; premise: (ProjectionPremise & { patrimonyCents: bigint }) | null; history: Array<{ month: string; marketValueCents: bigint }>; projection: Array<{ month: string; baseCents: bigint; pessimisticCents: bigint; optimisticCents: bigint }> }`; `buildProjection(db: Db, deps?: { now?: () => Date }): ProjectionResult` (24 meses fixos).

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/services/projection.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { insertInstruments, insertTransactions, writeQuotes } from "../db/repos.ts";
import type { InstrumentRow } from "../db/repos.ts";
import { buildPerformance } from "./performance.ts";
import { buildProjection } from "./projection.ts";

const etf: InstrumentRow = {
  id: "etf-1", legacyKey: "ETF 1", name: "ETF 1", kind: "equity", category: "etf_equity",
  ticker: "WRLD11", quoteSource: null, quoteSymbol: null, currency: "BRL", benchmark: null,
  rateE6: null, maturityDate: null, liquidity: null, broker: "XP", objective: null, investor: "Ana",
};
const now = () => new Date("2026-09-18T12:00:00-03:00");
const cotas = [
  { date: "2026-03-31", closeCents: 1_000n }, { date: "2026-04-30", closeCents: 1_010n },
  { date: "2026-05-31", closeCents: 1_020n }, { date: "2026-06-30", closeCents: 1_030n },
  { date: "2026-07-31", closeCents: 1_040n }, { date: "2026-08-31", closeCents: 1_050n },
  { date: "2026-09-17", closeCents: 1_060n },
];

function seed(db: ReturnType<typeof openDb>, quotes: Array<{ date: string; closeCents: bigint }>): void {
  insertInstruments(db, [etf]);
  insertTransactions(db, [{ instrumentId: etf.id, tradeDate: "2026-03-02", kind: "BUY", quantityE8: 100_00000000n, grossCents: 100_000n, feesCents: 0n, note: null, legacyRow: null }]);
  writeQuotes(db, quotes.map((quote) => ({ ticker: "WRLD11", date: quote.date, closeCents: quote.closeCents, source: "yahoo", settled: true })), "2026-09-18");
}

test("buildProjection usa a janela de 12 meses, o último patrimônio e 24 pontos", () => {
  const db = openDb(":memory:");
  migrate(db);
  seed(db, cotas);

  const result = buildProjection(db, { now });
  assert.deepEqual({ from: result.from, to: result.to }, { from: "2026-04", to: "2026-09" });
  assert.deepEqual(result.history.map((ponto) => [ponto.month, ponto.marketValueCents]), [
    ["2026-04", 101_000n], ["2026-05", 102_000n], ["2026-06", 103_000n],
    ["2026-07", 104_000n], ["2026-08", 105_000n], ["2026-09", 106_000n],
  ]);
  assert.ok(result.premise !== null);
  assert.deepEqual(result.premise, {
    monthsUsed: 6, monthlyRatePct: 0.9759, bandPp: 0.0178, contributionCents: 0n,
    pessimisticMonthlyPct: 0.9581, optimisticMonthlyPct: 0.9937, patrimonyCents: 106_000n,
  });
  assert.equal(result.projection.length, 24);
  assert.deepEqual(result.projection[0], { month: "2026-10", baseCents: 107_034n, pessimisticCents: 107_016n, optimisticCents: 107_053n });
  assert.equal(result.projection.at(-1)?.month, "2028-09");
});

test("buildProjection mantém paridade com o acumulado de buildPerformance", () => {
  const db = openDb(":memory:");
  migrate(db);
  seed(db, cotas);

  const result = buildProjection(db, { now });
  const performance = buildPerformance(db, { from: result.from, to: result.to }, { now });
  assert.ok(result.premise !== null);
  const composto = (1 + result.premise.monthlyRatePct / 100) ** result.premise.monthsUsed - 1;
  assert.ok(Math.abs(composto - performance.accumulated.portfolioPct / 100) < 0.0005);
});

test("buildProjection devolve premissa nula com histórico curto ou banco vazio", () => {
  const curto = openDb(":memory:");
  migrate(curto);
  seed(curto, [{ date: "2026-08-31", closeCents: 1_000n }, { date: "2026-09-17", closeCents: 1_000n }]);
  const semMeses = buildProjection(curto, { now });
  assert.equal(semMeses.premise, null);
  assert.deepEqual(semMeses.history, []);
  assert.deepEqual(semMeses.projection, []);

  const vazio = openDb(":memory:");
  migrate(vazio);
  const semDados = buildProjection(vazio, { now });
  assert.equal(semDados.premise, null);
  assert.deepEqual(semDados.projection, []);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/services/projection.test.ts`
Expected: FAIL — `Cannot find module`/`ERR_MODULE_NOT_FOUND` para `./projection.ts`.

- [ ] **Step 3: Implementar o serviço**

Criar `src/services/projection.ts`:

```ts
import type { Db } from "../db/index.ts";
import { addMonths, toBrDate } from "../domain/dates.ts";
import { projectPatrimony, projectionPremise, type ProjectionPremise } from "../domain/projection.ts";
import { buildHistory, resolveHistoryWindow } from "./history.ts";
import { buildPerformance } from "./performance.ts";

const PROJECTION_MONTHS = 24;

export type ProjectionResult = {
  from: string;
  to: string;
  premise: (ProjectionPremise & { patrimonyCents: bigint }) | null;
  history: Array<{ month: string; marketValueCents: bigint }>;
  projection: Array<{ month: string; baseCents: bigint; pessimisticCents: bigint; optimisticCents: bigint }>;
};

/** Projeção do patrimônio pelos últimos 12 meses (TWR datado + aporte líquido). */
export function buildProjection(db: Db, deps: { now?: () => Date } = {}): ProjectionResult {
  const today = toBrDate((deps.now ?? (() => new Date()))());
  const to = today.slice(0, 7);
  const window = resolveHistoryWindow(db, { from: addMonths(to, -11), to }, deps);
  const performance = buildPerformance(db, { from: window.from, to: window.to }, deps);
  const history = buildHistory(db, { from: window.from, to: window.to }, deps);
  const premise = projectionPremise(
    performance.months.map((month) => month.portfolioPct),
    performance.months.map((month) => month.investedCents - month.redeemedCents),
  );
  const last = history.at(-1);
  if (premise === null || last === undefined) {
    return { from: window.from, to: window.to, premise: null, history: [], projection: [] };
  }
  return {
    from: window.from, to: window.to,
    premise: { ...premise, patrimonyCents: last.marketValueCents },
    history: history.map((point) => ({ month: point.month, marketValueCents: point.marketValueCents })),
    projection: projectPatrimony(last.marketValueCents, premise, PROJECTION_MONTHS).map((point, index) => ({
      month: addMonths(window.to, index + 1),
      ...point,
    })),
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test src/services/projection.test.ts`
Expected: `# pass 3` / `# fail 0`.

- [ ] **Step 5: Rodar a suíte completa**

Run: `npm test`
Expected: `# tests 212` / `# pass 212` / `# fail 0` (209 + 3).

- [ ] **Step 6: Commit**

```bash
git add src/services/projection.ts src/services/projection.test.ts
git commit -m "feat: servico da projecao do patrimonio"
```

---

### Task 3: Rota `GET /api/projection`

**Files:**
- Create: `src/api/routes/projection.ts`
- Modify: `src/app.ts` (imports ~linha 5-12; registro ~linha 24)
- Test: `src/api/app.test.ts` (import de `addMonths` no topo; 2 testes novos após o teste de portfolio/PGBL ~linha 307)

**Interfaces:**
- Consumes: `buildProjection` da Task 2; `toNumberSafe` de `src/domain/money.ts`; `buildApp` do teste.
- Produces: `registerProjectionRoutes(app: FastifyInstance, db: Db): void`; resposta JSON `{ from, to, premise, history, projection }` com bigints como `number` (`premise: null` → listas vazias).

- [ ] **Step 1: Escrever os testes que falham**

Em `src/api/app.test.ts`, adicionar ao bloco de imports (depois da linha 12):

```ts
import { addMonths } from "../domain/dates.ts";
```

E, depois do teste `"portfolio com PGBL calcula pela cota CVM e health lista cvm-swb"` (termina na linha ~307), inserir:

```ts
test("GET /api/projection devolve premissa, histórico e 24 pontos", async () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [etfInstrument]);
  insertTransactions(db, [{ instrumentId: etfInstrument.id, tradeDate: "2026-03-02", kind: "BUY", quantityE8: 100_00000000n, grossCents: 100_000n, feesCents: 0n, note: null, legacyRow: null }]);
  writeQuotes(db, [
    { ticker: "WRLD11", date: "2026-03-31", closeCents: 1_000n, source: "yahoo", settled: true },
    { ticker: "WRLD11", date: "2026-04-30", closeCents: 1_010n, source: "yahoo", settled: true },
    { ticker: "WRLD11", date: "2026-05-31", closeCents: 1_020n, source: "yahoo", settled: true },
    { ticker: "WRLD11", date: "2026-06-30", closeCents: 1_030n, source: "yahoo", settled: true },
    { ticker: "WRLD11", date: "2026-07-31", closeCents: 1_040n, source: "yahoo", settled: true },
    { ticker: "WRLD11", date: "2026-08-31", closeCents: 1_050n, source: "yahoo", settled: true },
    { ticker: "WRLD11", date: "2026-09-17", closeCents: 1_060n, source: "yahoo", settled: true },
  ], "2026-09-18");
  const app = buildApp({ db, csvDir: csvDirFixture(), logger: false });

  const res = await app.inject({ method: "GET", url: "/api/projection" });
  assert.equal(res.statusCode, 200);
  const projection = res.json();
  assert.equal(projection.projection.length, 24);
  assert.equal(projection.history.at(-1).month, projection.to);
  assert.equal(projection.projection[0].month, addMonths(projection.to, 1));
  assert.ok(projection.premise !== null);
  assert.ok(projection.premise.monthsUsed >= 6);
  assert.equal(typeof projection.premise.contributionCents, "number");
  assert.ok(projection.projection[0].pessimisticCents <= projection.projection[0].baseCents);
  assert.ok(projection.projection[0].baseCents <= projection.projection[0].optimisticCents);

  await app.close();
});

test("GET /api/projection sem dados devolve premissa nula", async () => {
  const db = openDb(":memory:");
  migrate(db);
  const app = buildApp({ db, csvDir: csvDirFixture(), logger: false });

  const res = await app.inject({ method: "GET", url: "/api/projection" });
  assert.equal(res.statusCode, 200);
  const projection = res.json();
  assert.match(projection.from, /^\d{4}-\d{2}$/);
  assert.match(projection.to, /^\d{4}-\d{2}$/);
  assert.equal(projection.premise, null);
  assert.deepEqual(projection.history, []);
  assert.deepEqual(projection.projection, []);

  await app.close();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/api/app.test.ts`
Expected: FAIL — os dois testes novos falham com `404` (`res.statusCode` 404 ≠ 200).

- [ ] **Step 3: Implementar a rota e registrar**

Criar `src/api/routes/projection.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/index.ts";
import { toNumberSafe } from "../../domain/money.ts";
import { buildProjection } from "../../services/projection.ts";

export function registerProjectionRoutes(app: FastifyInstance, db: Db): void {
  app.get("/api/projection", () => {
    const result = buildProjection(db);
    return {
      from: result.from,
      to: result.to,
      premise: result.premise === null ? null : {
        monthsUsed: result.premise.monthsUsed,
        monthlyRatePct: result.premise.monthlyRatePct,
        bandPp: result.premise.bandPp,
        contributionCents: toNumberSafe(result.premise.contributionCents),
        pessimisticMonthlyPct: result.premise.pessimisticMonthlyPct,
        optimisticMonthlyPct: result.premise.optimisticMonthlyPct,
        patrimonyCents: toNumberSafe(result.premise.patrimonyCents),
      },
      history: result.history.map((point) => ({ month: point.month, marketValueCents: toNumberSafe(point.marketValueCents) })),
      projection: result.projection.map((point) => ({
        month: point.month,
        baseCents: toNumberSafe(point.baseCents),
        pessimisticCents: toNumberSafe(point.pessimisticCents),
        optimisticCents: toNumberSafe(point.optimisticCents),
      })),
    };
  });
}
```

Em `src/app.ts`: adicionar o import depois de `registerPortfolioRoutes` (linha 9) e a chamada depois de `registerPerformanceRoutes(app, options.db)` (linha 24):

```ts
import { registerProjectionRoutes } from "./api/routes/projection.ts";
```

```ts
  registerProjectionRoutes(app, options.db);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test src/api/app.test.ts`
Expected: todos os testes do arquivo passam (inclui os 2 novos).

- [ ] **Step 5: Rodar a suíte completa**

Run: `npm test`
Expected: `# tests 214` / `# pass 214` / `# fail 0` (212 + 2).

- [ ] **Step 6: Commit**

```bash
git add src/api/routes/projection.ts src/app.ts src/api/app.test.ts
git commit -m "feat: rota da projecao do patrimonio"
```

---

### Task 4: Web — card e gráfico na Visão geral

**Files:**
- Modify: `web/src/api.ts` (tipos após `Performance` ~linha 91; getter após `getPerformance` ~linha 119)
- Create: `web/src/components/ProjecaoChart.tsx`
- Modify: `web/src/views/OverviewView.tsx` (imports ~linha 4-16; `Dados` ~linha 29; estado ~linha 59; `carregar` ~linha 61-78; destructuring ~linha 108; JSX da coluna esquerda ~linha 206)

**Interfaces:**
- Consumes: `GET /api/projection` da Task 3; `formataEixoRs` de `web/src/components/graficoComum.tsx`; `formataBRL`/`formataMes`/`formataPercentual` de `web/src/format.ts`; classes `.card`, `.section-head-linha`, `.chart-grupo`, `.chip`, `.section-hint`, `.hint-grafico`, `.empty*`.
- Produces: `type Projection`, `type ProjectionPremise`, `getProjection(signal?)` em `web/src/api.ts`; componente `ProjecaoChart({ projecao, horizonte, altura? })`.

- [ ] **Step 1: Tipos e getter em `web/src/api.ts`**

Depois do bloco `export type Performance = {...};` (termina ~linha 91), inserir:

```ts
export type ProjectionPremise = {
  monthsUsed: number; monthlyRatePct: number; bandPp: number; contributionCents: number;
  pessimisticMonthlyPct: number; optimisticMonthlyPct: number; patrimonyCents: number;
};

export type Projection = {
  from: string; to: string; premise: ProjectionPremise | null;
  history: Array<{ month: string; marketValueCents: number }>;
  projection: Array<{ month: string; baseCents: number; pessimisticCents: number; optimisticCents: number }>;
};
```

E, junto aos outros getters (depois de `getPerformance`, ~linha 119):

```ts
export const getProjection = (signal?: AbortSignal): Promise<Projection> => getJson("/api/projection", signal);
```

- [ ] **Step 2: Criar o componente do gráfico**

Criar `web/src/components/ProjecaoChart.tsx`:

```tsx
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
      <p className="chart-tooltip-title">{linha.rotulo}{linha.realCents !== null ? " · hoje" : ""}</p>
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
        <Area dataKey="faixaCents" name="Faixa (±1σ)" stroke="none" fill="var(--accent-soft)" fillOpacity={0.9} isAnimationActive={false} />
        <Area dataKey="realCents" name="Patrimônio" stroke="var(--accent)" fill="var(--accent-soft)" strokeWidth={2} />
        <Line dataKey="baseCents" name="Projeção" stroke="var(--accent)" strokeWidth={2} strokeDasharray="5 4" dot={false} />
        <ReferenceLine x={formataMes(projecao.to)} stroke="var(--border-strong)" strokeDasharray="3 3" label={{ value: "hoje", position: "top", fontSize: 11 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 3: Ligar no `OverviewView`**

3a. Imports (linhas 4-16): adicionar `getProjection` e `type Projection` ao import de `../api.ts`; adicionar o import do componente:

```tsx
import {
  getAllocation, getHistory, getPerformance, getPortfolio, getProjection,
  type Allocation, type AllocationBy, type HistoryPoint, type Performance, type Portfolio, type Projection,
} from "../api.ts";
```

```tsx
import { ProjecaoChart } from "../components/ProjecaoChart.tsx";
```

3b. Tipo `Dados` (linha ~29):

```tsx
type Dados = {
  portfolio: Portfolio; history: HistoryPoint[];
  performance: Performance; performanceTudo: Performance; allocation: Allocation;
  projection: Projection | null;
};
```

3c. Estado (depois de `const [detalhe, setDetalhe] = useState<Detalhe | null>(null);`):

```tsx
  const [horizonte, setHorizonte] = useState<12 | 24>(12);
```

3d. `carregar` (linha ~66): incluir a projeção no `Promise.all` e no `setDados` — com `catch` próprio para que a falha da projeção não bloqueie o resto da Visão geral (regra da spec):

```tsx
      const [history, performance, performanceTudo, allocation, projection] = await Promise.all([
        getHistory(from, mes, signal),
        getPerformance(from, mes, signal),
        getPerformance(INICIO_TUDO, mes, signal),
        getAllocation(alocacaoBy, signal),
        getProjection(signal).catch(() => null),
      ]);
      setDados({ portfolio, history, performance, performanceTudo, allocation, projection });
```

3e. Destructuring (linha ~108):

```tsx
  const { portfolio, history, performance, performanceTudo, allocation, projection } = dados;
```

3f. Card na coluna esquerda: depois do `</section>` do card dos 3 gráficos (~linha 206) e antes do `</div>` que fecha o `stack`:

```tsx
          <section className="card">
            <div className="section-head section-head-linha">
              <h2 className="section-title">Projeção do patrimônio</h2>
              {projection !== null && projection.premise !== null && (
                <div className="chart-grupo" role="group" aria-label="Horizonte da projeção">
                  <button type="button" className={horizonte === 12 ? "chip active" : "chip"} aria-pressed={horizonte === 12} onClick={() => setHorizonte(12)}>1 ano</button>
                  <button type="button" className={horizonte === 24 ? "chip active" : "chip"} aria-pressed={horizonte === 24} onClick={() => setHorizonte(24)}>2 anos</button>
                </div>
              )}
            </div>
            {projection === null || projection.premise === null ? (
              <div className="empty">
                <p className="empty-title">{projection === null ? "Projeção indisponível" : "Sem histórico suficiente"}</p>
                <p className="empty-hint">
                  {projection === null
                    ? "Não foi possível carregar a projeção agora — o resto da Visão geral segue normalmente."
                    : "A projeção aparece quando houver 6 meses de retornos e o patrimônio atual."}
                </p>
              </div>
            ) : (
              <>
                <p className="section-hint hint-grafico">
                  Estimativa pelos últimos {projection.premise.monthsUsed} meses: rendimento médio de {formataPercentual(projection.premise.monthlyRatePct)}/mês e aporte médio de {formataBRL(projection.premise.contributionCents)}/mês. A faixa cobre ±{formataPercentual(projection.premise.bandPp)} (1 desvio-padrão dos retornos mensais).
                </p>
                <ProjecaoChart projecao={projection} horizonte={horizonte} />
              </>
            )}
          </section>
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: sem erros.

- [ ] **Step 5: Build do web**

Run: `npm run build:web`
Expected: build ok (warning conhecido de chunk > 500 kB é aceitável).

- [ ] **Step 6: Suíte do backend inalterada**

Run: `npm test`
Expected: `# tests 214` / `# pass 214` / `# fail 0`.

- [ ] **Step 7: Commit**

```bash
git add web/src/api.ts web/src/components/ProjecaoChart.tsx web/src/views/OverviewView.tsx
git commit -m "feat: card de projecao na visao geral"
```

---

### Task 5: Aceite com dados reais

**Files:**
- Nenhum arquivo de código (verificação); screenshots em `.superpowers/sdd/`

**Interfaces:**
- Consumes: servidor local na porta 3100 servindo `web/dist` + API com o banco real; `agent-browser`.
- Produces: evidência de aceite (JSON conferido + screenshots).

- [ ] **Step 1: Copiar o banco real e subir o servidor**

Na worktree:

```bash
mkdir -p data
node --input-type=module -e "import Database from 'better-sqlite3'; const db = new Database('./data/investments.db', { readonly: true }); await db.backup('data/investments.db'); db.close();"
PORT=3100 npm start > /tmp/server-3100.log 2>&1 &
```

Expected: log sem erro; `curl -s localhost:3100/api/health` com `ok: true`.

- [ ] **Step 2: Conferir a API e a identidade da taxa**

```bash
python3 - <<'PY'
import json, urllib.request
base = "http://localhost:3100"
proj = json.load(urllib.request.urlopen(f"{base}/api/projection"))
perf = json.load(urllib.request.urlopen(f"{base}/api/performance?from={proj['from']}&to={proj['to']}"))
p = proj["premise"]
composto = (1 + p["monthlyRatePct"] / 100) ** p["monthsUsed"] - 1
acc = perf["accumulated"]["portfolioPct"] / 100
print("janela", proj["from"], proj["to"], "meses", p["monthsUsed"])
print("taxa", p["monthlyRatePct"], "banda", p["bandPp"], "aporte", p["contributionCents"] / 100)
print("composto", round(composto * 100, 4), "acumulado API", perf["accumulated"]["portfolioPct"], "diferença", round((composto - acc) * 100, 4))
print("histórico", len(proj["history"]), "último", proj["history"][-1])
print("projeção", len(proj["projection"]), "primeiro", proj["projection"][0])
PY
```

Expected (referência 2026-09-25; valores vivos): janela `2025-10 2026-09`, `meses 12`, taxa ≈ `1,10`%/mês, banda ≈ `0,3`, `composto` dentro de `0,05` do `acumulado API` (identidade da média geométrica), 12 pontos de histórico (último = último `/api/history`) e 24 projetados (primeiro = mês seguinte ao `to`). Os aportes/projeção batem com a API **no momento da conferência**, não com números fixos.

- [ ] **Step 3: Verificar no browser**

Com `agent-browser`, abrir `http://localhost:3100` (Visão geral) e conferir:

1. Card **Projeção do patrimônio** na coluna esquerda, abaixo do card dos 3 gráficos; padrão **1 ano**; chips 1 ano · 2 anos no cabeçalho.
2. Hint com meses usados, taxa e aporte; área cheia até "hoje", linha tracejada e faixa preenchida depois; `ReferenceLine` "hoje" em `set/2026`.
3. Hover num mês futuro mostra "Projetado" e "Faixa (±1σ)"; hover num mês passado mostra o patrimônio real.
4. Chip **2 anos** estende a projeção a `set/2028` sem recarregar a página; **1 ano** volta a `set/2027`.
5. Em 1280 e 1024: `document.documentElement.scrollWidth === window.innerWidth` nas duas larguras.
6. Screenshots: `.superpowers/sdd/projecao-01-1ano.png` e `.superpowers/sdd/projecao-02-2anos.png`.

- [ ] **Step 4: Derrubar o servidor local**

```bash
kill %1 2>/dev/null || true
```

- [ ] **Step 5: Docker (no checkout principal, após o merge)**

Run (no checkout principal, não na worktree — a porta 3000 já está em uso): `docker compose up -d --build` e `curl localhost:3000/api/health`.
Expected: container `healthy`, health sem erro de fonte; `curl -s localhost:3000/api/projection | head -c 120` devolve o JSON.

---

## Verificação final da branch

```bash
npm test && npm run typecheck && npm run build:web
```

Expected: 214 testes verdes, typecheck limpo, build ok. Depois: merge local na `main` (padrão do projeto), atualizar o `ROADMAP.md` na `main` (tabela "Estado atual" + evidência do aceite + "Próxima ação", mantendo o rebalanceamento como próxima etapa) e remover a worktree:

```bash
git -C . checkout main
git -C . merge --ff-only projecao-visao-geral
git -C . worktree remove .worktrees/projecao-visao-geral
```

Commit do ROADMAP: `docs: registra a projecao do patrimonio no roadmap`.
