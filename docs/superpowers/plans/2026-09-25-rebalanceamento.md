# Rebalanceamento (metas RF × RV) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o usuário define a meta % de Renda Fixa × Renda Variável e quanto quer investir; o app mostra quantos reais aportar em cada grupo para chegar o mais perto possível da meta, sem vender — excluindo a reserva de emergência e contando previdência como RF.

**Architecture:** regra pura em `src/domain/rebalance.ts` (water-filling do legado para 2 grupos, bigint); persistência em `rebalance_targets` (migration 004, linha única com seed 80/20); serviço `buildRebalance` agrega a carteira do `/api/portfolio`; 2 rotas (`GET` cálculo, `PUT` config); no web, uma `RebalanceView` nova com prévia por debounce. Spec: `docs/superpowers/specs/2026-09-25-rebalanceamento-design.md`.

**Tech Stack:** Node 22 + TypeScript (node:test), Fastify 5, better-sqlite3, React 19 + Vite 8, CSS puro. Nenhuma lib nova.

## Global Constraints

- Zero `float` em dado persistido/cálculo: centavos e E6 em `bigint`; `Number`/`toNumberSafe` só na borda da API/UI.
- Reserva = `objective === "Reserva"` (exato), fora do rebalanceamento; previdência e `etf_fixed` contam como RF.
- Metas somam 100% (`1_000_000` em E6); aporte inteiro ≥ 0; seed RF 80 / RV 20, aporte R$ <valor>
- Artefatos, testes e commits em pt-BR; commits convencionais sem acento (`feat:`, `docs:`).
- Cada task = 1 layer com ≤ 400 linhas / ≤ 10 arquivos; `package-lock.json` não muda nesta branch.
- Verificação da branch: `npm test`, `npm run typecheck`, `npm run build:web`, `docker compose up -d --build`.
- Branch: `rebalanceamento` (worktree `.worktrees/rebalanceamento`).

---

### Task 1: Regra pura do rebalanceamento (domínio)

**Files:**
- Create: `src/domain/rebalance.ts`
- Test: `src/domain/rebalance.test.ts`

**Interfaces:**
- Consumes: `divRoundHalfUp` de `src/domain/money.ts`.
- Produces:
  - `type RebalanceGroupKey = "rf" | "rv"`
  - `type RebalanceInput = { valuesCents: Record<RebalanceGroupKey, bigint>; targetsE6: Record<RebalanceGroupKey, bigint>; amountCents: bigint }`
  - `type RebalanceGroup = { key: RebalanceGroupKey; valueCents: bigint; targetE6: bigint; pctBefore: number; suggestedCents: bigint; afterValueCents: bigint; pctAfter: number; aboveTarget: boolean }`
  - `type RebalanceResult = { baseCents: bigint; amountCents: bigint; totalCents: bigint; groups: RebalanceGroup[] }`
  - `function rebalance(input: RebalanceInput): RebalanceResult`

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/domain/rebalance.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { rebalance } from "./rebalance.ts";

const METAS_80_20 = { rf: 800_000n, rv: 200_000n };

test("investe a demanda dos dois grupos quando ambos estao abaixo da meta", () => {
  const result = rebalance({
    valuesCents: { rf: 100_000n, rv: 0n },
    targetsE6: METAS_80_20,
    amountCents: 100_000n,
  });
  assert.equal(result.baseCents, 100_000n);
  assert.equal(result.totalCents, 200_000n);
  const [rf, rv] = result.groups;
  assert.equal(rf?.suggestedCents, 60_000n);
  assert.equal(rv?.suggestedCents, 40_000n);
  assert.equal(rf?.afterValueCents, 160_000n);
  assert.equal(rv?.afterValueCents, 40_000n);
  assert.equal(rf?.pctAfter, 80);
  assert.equal(rv?.pctAfter, 20);
  assert.equal(rf?.aboveTarget, false);
  assert.equal(rv?.aboveTarget, false);
});

test("grupo acima da meta recebe zero e o aporte inteiro vai para o outro (RF acima)", () => {
  const result = rebalance({
    valuesCents: { rf: 180_000n, rv: 20_000n },
    targetsE6: METAS_80_20,
    amountCents: 10_000n,
  });
  const [rf, rv] = result.groups;
  assert.equal(rf?.aboveTarget, true);
  assert.equal(rf?.suggestedCents, 0n);
  assert.equal(rv?.aboveTarget, false);
  assert.equal(rv?.suggestedCents, 10_000n);
  assert.equal(rf?.pctAfter, 85.71);
  assert.equal(rv?.pctAfter, 14.29);
});

test("grupo acima da meta recebe zero e o aporte inteiro vai para o outro (RV acima)", () => {
  const result = rebalance({
    valuesCents: { rf: 20_000n, rv: 180_000n },
    targetsE6: METAS_80_20,
    amountCents: 10_000n,
  });
  const [rf, rv] = result.groups;
  assert.equal(rf?.suggestedCents, 10_000n);
  assert.equal(rv?.suggestedCents, 0n);
  assert.equal(rv?.aboveTarget, true);
});

test("carteira vazia investe conforme as metas", () => {
  const result = rebalance({
    valuesCents: { rf: 0n, rv: 0n },
    targetsE6: { rf: 700_000n, rv: 300_000n },
    amountCents: 50_000n,
  });
  assert.equal(result.baseCents, 0n);
  const [rf, rv] = result.groups;
  assert.equal(rf?.suggestedCents, 35_000n);
  assert.equal(rv?.suggestedCents, 15_000n);
  assert.equal(rf?.pctBefore, 0);
  assert.equal(rf?.pctAfter, 70);
  assert.equal(rv?.pctAfter, 30);
});

test("aporte zero nao sugere nada e preserva os percentuais", () => {
  const result = rebalance({
    valuesCents: { rf: 50_000n, rv: 50_000n },
    targetsE6: { rf: 700_000n, rv: 300_000n },
    amountCents: 0n,
  });
  const [rf, rv] = result.groups;
  assert.equal(rf?.suggestedCents, 0n);
  assert.equal(rv?.suggestedCents, 0n);
  assert.equal(rf?.pctAfter, 50);
  assert.equal(rv?.pctAfter, 50);
  assert.equal(rf?.aboveTarget, false);
  assert.equal(rv?.aboveTarget, true); // RV 50% > meta de 30%
});

test("meta 100/0 zera o grupo acima e concentra o aporte", () => {
  const result = rebalance({
    valuesCents: { rf: 50_000n, rv: 50_000n },
    targetsE6: { rf: 1_000_000n, rv: 0n },
    amountCents: 10_000n,
  });
  const [rf, rv] = result.groups;
  assert.equal(rf?.suggestedCents, 10_000n);
  assert.equal(rv?.suggestedCents, 0n);
  assert.equal(rv?.aboveTarget, true);
});

test("arredonda o alvo da RF half-up e fecha o aporte no centavo", () => {
  const result = rebalance({
    valuesCents: { rf: 33_333n, rv: 66_667n },
    targetsE6: { rf: 333_333n, rv: 666_667n },
    amountCents: 100_000n,
  });
  const [rf, rv] = result.groups;
  assert.equal(rf?.afterValueCents, 66_667n);
  assert.equal(rv?.afterValueCents, 133_333n);
  assert.equal((rf?.suggestedCents ?? 0n) + (rv?.suggestedCents ?? 0n), 100_000n);
  assert.equal(rf?.pctAfter, 33.33);
  assert.equal(rv?.pctAfter, 66.67);
});

test("total zero mantem os percentuais em zero", () => {
  const result = rebalance({
    valuesCents: { rf: 0n, rv: 0n },
    targetsE6: METAS_80_20,
    amountCents: 0n,
  });
  assert.equal(result.totalCents, 0n);
  const [rf, rv] = result.groups;
  assert.equal(rf?.pctBefore, 0);
  assert.equal(rf?.pctAfter, 0);
  assert.equal(rv?.pctAfter, 0);
  assert.equal((rf?.suggestedCents ?? 0n) + (rv?.suggestedCents ?? 0n), 0n);
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `node --test src/domain/rebalance.test.ts`
Expected: FAIL — `Cannot find module './rebalance.ts'` (ou equivalente).

- [ ] **Step 3: Implementar o domínio**

Criar `src/domain/rebalance.ts`:

```ts
import { divRoundHalfUp, MULTIPLIER_SCALE } from "./money.ts";

export type RebalanceGroupKey = "rf" | "rv";

export type RebalanceInput = {
  valuesCents: Record<RebalanceGroupKey, bigint>;
  targetsE6: Record<RebalanceGroupKey, bigint>;
  amountCents: bigint;
};

export type RebalanceGroup = {
  key: RebalanceGroupKey;
  valueCents: bigint;
  targetE6: bigint;
  pctBefore: number;
  suggestedCents: bigint;
  afterValueCents: bigint;
  pctAfter: number;
  aboveTarget: boolean;
};

export type RebalanceResult = {
  baseCents: bigint;
  amountCents: bigint;
  totalCents: bigint;
  groups: RebalanceGroup[];
};

function pctOf(valueCents: bigint, totalCents: bigint): number {
  if (totalCents === 0n) return 0;
  return Number(divRoundHalfUp(valueCents * 10_000n, totalCents)) / 100;
}

/**
 * Water-filling do legado (max(D - tau, 0)) para 2 grupos: com ambos abaixo da
 * meta, cada um recebe a propria demanda; com um acima, ele recebe zero e o
 * aporte inteiro vai para o outro. Sem vender, nunca ultrapassa a meta.
 */
export function rebalance(input: RebalanceInput): RebalanceResult {
  const baseCents = input.valuesCents.rf + input.valuesCents.rv;
  const totalCents = baseCents + input.amountCents;
  const rfTargetCents = divRoundHalfUp(input.targetsE6.rf * totalCents, MULTIPLIER_SCALE);
  const rvTargetCents = totalCents - rfTargetCents;
  const demand: Record<RebalanceGroupKey, bigint> = {
    rf: rfTargetCents - input.valuesCents.rf,
    rv: rvTargetCents - input.valuesCents.rv,
  };
  const suggested: Record<RebalanceGroupKey, bigint> = { rf: 0n, rv: 0n };
  if (demand.rf >= 0n && demand.rv >= 0n) {
    suggested.rf = demand.rf;
    suggested.rv = demand.rv;
  } else if (demand.rf < 0n) {
    suggested.rv = input.amountCents;
  } else {
    suggested.rf = input.amountCents;
  }
  const groups = (["rf", "rv"] as const).map((key): RebalanceGroup => {
    const afterValueCents = input.valuesCents[key] + suggested[key];
    return {
      key,
      valueCents: input.valuesCents[key],
      targetE6: input.targetsE6[key],
      pctBefore: pctOf(input.valuesCents[key], baseCents),
      suggestedCents: suggested[key],
      afterValueCents,
      pctAfter: pctOf(afterValueCents, totalCents),
      aboveTarget: demand[key] < 0n,
    };
  });
  return { baseCents, amountCents: input.amountCents, totalCents, groups };
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `node --test src/domain/rebalance.test.ts`
Expected: PASS — 8 testes.

- [ ] **Step 5: Rodar a suíte completa**

Run: `npm test`
Expected: PASS — 212 testes (204 + 8).

- [ ] **Step 6: Commit**

```bash
git add src/domain/rebalance.ts src/domain/rebalance.test.ts
git commit -m "feat: regra pura do rebalanceamento rf x rv"
```

---

### Task 2: Persistência (migration 004 + repos) e serviço

**Files:**
- Create: `src/db/migrations/004_rebalance.sql`
- Modify: `src/db/repos.ts` (no fim do arquivo, após `listSourceStatus`)
- Modify: `src/db/migrate.test.ts` (contagem 3→4 + tabela `rebalance_targets`)
- Create: `src/services/rebalance.ts`
- Test: `src/services/rebalance.test.ts`

**Interfaces:**
- Consumes: `rebalance`/`RebalanceGroup`/`RebalanceGroupKey` da Task 1; `buildPortfolio` de `src/services/portfolio.ts`; `Db` de `src/db/index.ts`.
- Produces:
  - `type RebalanceTargetsRow = { rfE6: bigint; rvE6: bigint; amountCents: bigint; updatedAt: string }`
  - `function getRebalanceTargets(db: Db): RebalanceTargetsRow`
  - `function saveRebalanceTargets(db: Db, targets: { rfE6: bigint; rvE6: bigint; amountCents: bigint }): RebalanceTargetsRow`
  - `type RebalanceView = { asOf: string; baseCents: bigint; amountCents: bigint; targets: { rfE6: bigint; rvE6: bigint }; groups: RebalanceGroup[]; stale: boolean }`
  - `function buildRebalance(db: Db, deps?: { now?: () => Date; amountCents?: bigint; targetsE6?: { rfE6: bigint; rvE6: bigint } }): RebalanceView`

- [ ] **Step 1: Criar a migration**

Criar `src/db/migrations/004_rebalance.sql`:

```sql
CREATE TABLE rebalance_targets (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  rf_e6 INTEGER NOT NULL,
  rv_e6 INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO rebalance_targets (id, rf_e6, rv_e6, amount_cents, updated_at)
VALUES (1, <valor>, <valor>, 0, datetime('now'));
```

- [ ] **Step 2: Escrever o teste que falha (serviço)**

Criar `src/services/rebalance.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import {
  insertInstruments, insertTransactions, recordSourceAttempt, writeFundQuotas, writeIndexRates, writeQuotes,
} from "../db/repos.ts";
import type { InstrumentRow } from "../db/repos.ts";
import { buildRebalance } from "./rebalance.ts";

const base = {
  currency: "BRL", quoteSource: null, quoteSymbol: null, maturityDate: null,
  liquidity: null, broker: "PagBank", objective: "Aposentadoria", investor: "Ana",
} as const;

const cdb: InstrumentRow = { ...base, id: "cdb-1", legacyKey: "CDB 1", name: "CDB 1", kind: "fixed_income", category: "cdb", ticker: null, benchmark: "CDI", rateE6: 1_000_000n };
const etfRf: InstrumentRow = { ...base, id: "etf-rf-1", legacyKey: "ETF RF 1", name: "ETF RF 1", kind: "equity", category: "etf_fixed", ticker: "B5P211", benchmark: null, rateE6: null };
const etfRv: InstrumentRow = { ...base, id: "etf-rv-1", legacyKey: "ETF RV 1", name: "ETF RV 1", kind: "equity", category: "etf_equity", ticker: "WRLD11", benchmark: null, rateE6: null };
const pgbl: InstrumentRow = { ...base, id: "pgbl-1", legacyKey: "PGBL 1", name: "PGBL 1", kind: "pension", category: "pension_ipca", ticker: null, quoteSource: "cvm-swb", quoteSymbol: "<valor>", benchmark: null, rateE6: null };
const reservaCdb: InstrumentRow = { ...cdb, id: "reserva-1", legacyKey: "Reserva 1", name: "Reserva 1", objective: "Reserva" };
const pgblSemCota: InstrumentRow = { ...pgbl, id: "pgbl-2", legacyKey: "PGBL 2", name: "PGBL 2", quoteSymbol: "<valor>" }; // símbolo sem cota no banco

const NOW = () => new Date("2026-09-18T12:00:00-03:00");

function seed(db: ReturnType<typeof openDb>) {
  insertInstruments(db, [cdb, etfRf, etfRv, pgbl, reservaCdb, pgblSemCota]);
  insertTransactions(db, [
    { instrumentId: cdb.id, tradeDate: "2026-09-17", kind: "BUY", quantityE8: null, grossCents: 100_000n, feesCents: 0n, note: null, legacyRow: null },
    { instrumentId: etfRf.id, tradeDate: "2026-09-17", kind: "BUY", quantityE8: 10_00000000n, grossCents: 9_000n, feesCents: 0n, note: null, legacyRow: null },
    { instrumentId: etfRv.id, tradeDate: "2026-09-17", kind: "BUY", quantityE8: 10_00000000n, grossCents: 9_000n, feesCents: 0n, note: null, legacyRow: null },
    { instrumentId: pgbl.id, tradeDate: "2026-09-17", kind: "BUY", quantityE8: 5_00000000n, grossCents: 50_000n, feesCents: 0n, note: null, legacyRow: null },
    { instrumentId: reservaCdb.id, tradeDate: "2026-09-17", kind: "BUY", quantityE8: null, grossCents: 100_000n, feesCents: 0n, note: null, legacyRow: null },
    { instrumentId: pgblSemCota.id, tradeDate: "2026-09-17", kind: "BUY", quantityE8: 5_00000000n, grossCents: 50_000n, feesCents: 0n, note: null, legacyRow: null },
  ]);
  writeIndexRates(db, [{ series: "CDI", date: "2026-09-17", valueE12: 1_000_000_000n }]);
  writeQuotes(db, [
    { ticker: "B5P211", date: "2026-09-17", closeCents: 1_000n, source: "yahoo", settled: true },
    { ticker: "WRLD11", date: "2026-09-17", closeCents: 1_000n, source: "yahoo", settled: true },
  ], "2026-09-18");
  writeFundQuotas(db, [{ symbol: "<valor>", date: "2026-09-17", quotaE12: 1_220_696_672_715n, source: "cvm-swb", settled: true }], "2026-09-18");
  recordSourceAttempt(db, "bcb", { ok: true });
  recordSourceAttempt(db, "yahoo", { ok: true });
  recordSourceAttempt(db, "cvm-swb", { ok: true });
}

test("agrupa RF (inclusive previdencia e ETF RF), exclui reserva e posicao sem valor", () => {
  const db = openDb(":memory:");
  migrate(db);
  seed(db);
  const result = buildRebalance(db, { now: NOW, amountCents: 65_000n, targetsE6: { rfE6: 900_000n, rvE6: 100_000n } });
  assert.equal(result.asOf, "2026-09-18");
  assert.equal(result.baseCents, 120_710n);
  assert.equal(result.stale, false);
  const [rf, rv] = result.groups;
  assert.equal(rf?.valueCents, 110_710n); // CDB <valor> + ETF RF <valor> + PGBL 610
  assert.equal(rv?.valueCents, 10_000n);
  assert.equal(rf?.suggestedCents, 56_429n);
  assert.equal(rv?.suggestedCents, 8_571n);
  assert.equal(rf?.afterValueCents, 167_139n);
  assert.equal(rv?.afterValueCents, 18_571n);
  assert.equal(rf?.pctAfter, 90);
  assert.equal(rv?.pctAfter, 10);
  assert.equal(rf?.aboveTarget, false);
  assert.equal(rv?.aboveTarget, false);
});

test("usa as metas do banco (seed 80/20) e o aporte persistido", () => {
  const db = openDb(":memory:");
  migrate(db);
  seed(db);
  const result = buildRebalance(db, { now: NOW });
  assert.deepEqual(result.targets, { rfE6: 800_000n, rvE6: 200_000n });
  assert.equal(result.amountCents, 0n);
  assert.equal(result.baseCents, 120_710n);
  const [rf, rv] = result.groups;
  assert.equal(rf?.aboveTarget, true); // 91,72% > 80%
  assert.equal(rv?.aboveTarget, false);
  assert.equal(rf?.suggestedCents, 0n);
  assert.equal(rv?.suggestedCents, 0n);
});

test("marca stale quando uma posicao considerada esta desatualizada", () => {
  const db = openDb(":memory:");
  migrate(db);
  seed(db);
  recordSourceAttempt(db, "yahoo", { ok: false, error: "HTTP 502" });
  const result = buildRebalance(db, { now: NOW });
  assert.equal(result.stale, true);
  assert.equal(result.baseCents, 120_710n); // ultimo valor conhecido continua valendo
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test src/services/rebalance.test.ts`
Expected: FAIL — `Cannot find module './rebalance.ts'`.

- [ ] **Step 4: Adicionar as funções de repositório**

Em `src/db/repos.ts`, no fim do arquivo:

```ts
export type RebalanceTargetsRow = { rfE6: bigint; rvE6: bigint; amountCents: bigint; updatedAt: string };

type RebalanceTargetsDbRow = { rf_e6: bigint; rv_e6: bigint; amount_cents: bigint; updated_at: string };

export function getRebalanceTargets(db: Db): RebalanceTargetsRow {
  const row = db.prepare("SELECT rf_e6, rv_e6, amount_cents, updated_at FROM rebalance_targets WHERE id = 1")
    .get() as RebalanceTargetsDbRow;
  return { rfE6: row.rf_e6, rvE6: row.rv_e6, amountCents: row.amount_cents, updatedAt: row.updated_at };
}

export function saveRebalanceTargets(
  db: Db,
  targets: { rfE6: bigint; rvE6: bigint; amountCents: bigint },
): RebalanceTargetsRow {
  db.prepare(`INSERT INTO rebalance_targets (id, rf_e6, rv_e6, amount_cents, updated_at)
    VALUES (1, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      rf_e6 = excluded.rf_e6, rv_e6 = excluded.rv_e6,
      amount_cents = excluded.amount_cents, updated_at = excluded.updated_at`)
    .run(targets.rfE6, targets.rvE6, targets.amountCents);
  return getRebalanceTargets(db);
}
```

- [ ] **Step 5: Implementar o serviço**

Criar `src/services/rebalance.ts`:

```ts
import type { Db } from "../db/index.ts";
import { getRebalanceTargets } from "../db/repos.ts";
import { rebalance, type RebalanceGroup, type RebalanceGroupKey } from "../domain/rebalance.ts";
import { buildPortfolio } from "./portfolio.ts";

const OBJETIVO_RESERVA = "Reserva";

export type RebalanceView = {
  asOf: string;
  baseCents: bigint;
  amountCents: bigint;
  targets: { rfE6: bigint; rvE6: bigint };
  groups: RebalanceGroup[];
  stale: boolean;
};

function grupoDe(position: { kind: string; category: string }): RebalanceGroupKey {
  return position.kind === "fixed_income" || position.kind === "pension" || position.category === "etf_fixed"
    ? "rf"
    : "rv";
}

export function buildRebalance(
  db: Db,
  deps: { now?: () => Date; amountCents?: bigint; targetsE6?: { rfE6: bigint; rvE6: bigint } } = {},
): RebalanceView {
  const portfolio = buildPortfolio(db, { now: deps.now });
  const stored = getRebalanceTargets(db);
  const targets = deps.targetsE6 ?? { rfE6: stored.rfE6, rvE6: stored.rvE6 };
  const amountCents = deps.amountCents ?? stored.amountCents;
  const consideradas = portfolio.positions.filter(
    (position) => position.objective !== OBJETIVO_RESERVA && position.marketValueCents !== null,
  );
  const values: Record<RebalanceGroupKey, bigint> = { rf: 0n, rv: 0n };
  for (const position of consideradas) {
    values[grupoDe(position)] += position.marketValueCents ?? 0n;
  }
  const result = rebalance({
    valuesCents: values,
    targetsE6: { rf: targets.rfE6, rv: targets.rvE6 }, // domínio usa as chaves do grupo
    amountCents,
  });
  return {
    asOf: portfolio.asOf,
    baseCents: result.baseCents,
    amountCents: result.amountCents,
    targets,
    groups: result.groups,
    stale: consideradas.some((position) => position.stale),
  };
}
```

- [ ] **Step 5b: Atualizar o teste de migrations**

Em `src/db/migrate.test.ts`, a contagem sobe para 4 e a tabela nova entra na lista:

```diff
-test("migrate aplica 001 a 003 e é idempotente", () => {
+test("migrate aplica 001 a 004 e é idempotente", () => {
   const db = openDb(":memory:");
-  assert.equal(migrate(db), 3);
+  assert.equal(migrate(db), 4);
   assert.equal(migrate(db), 0);
   const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
     .all()
     .map((row) => (row as { name: string }).name);
-  for (const table of ["instruments", "transactions", "quotes", "index_rates", "valuations", "legacy_snapshots", "import_runs", "source_status", "fund_quotas"]) {
+  for (const table of ["instruments", "transactions", "quotes", "index_rates", "valuations", "legacy_snapshots", "import_runs", "source_status", "fund_quotas", "rebalance_targets"]) {
     assert.ok(tables.includes(table), `tabela ${table} existe`);
   }
 });
```

- [ ] **Step 6: Rodar o teste e ver passar**

Run: `node --test src/services/rebalance.test.ts`
Expected: PASS — 3 testes.

- [ ] **Step 7: Rodar a suíte completa**

Run: `npm test`
Expected: PASS — 215 testes (204 + 8 + 3).

- [ ] **Step 8: Commit**

```bash
git add src/db/migrations/004_rebalance.sql src/db/repos.ts src/services/rebalance.ts src/services/rebalance.test.ts
git commit -m "feat: metas persistidas e servico do rebalanceamento"
```

---

### Task 3: Rotas da API

**Files:**
- Create: `src/api/routes/rebalance.ts`
- Modify: `src/app.ts` (imports + registro)
- Test: `src/api/app.test.ts` (helper + 3 testes no fim)

**Interfaces:**
- Consumes: `buildRebalance`/`RebalanceView` da Task 2; `getRebalanceTargets`/`saveRebalanceTargets` da Task 2; `toNumberSafe` de `src/domain/money.ts`.
- Produces:
  - `function registerRebalanceRoutes(app: FastifyInstance, db: Db): void`
  - `GET /api/rebalance?amountCents&rfE6&rvE6` → `{ asOf, baseCents, amountCents, targets: { rfE6, rvE6 }, groups: [{ key, valueCents, pctBefore, targetE6, suggestedCents, afterValueCents, pctAfter, aboveTarget }], stale }`
  - `PUT /api/rebalance` (body `{ rfE6, rvE6, amountCents }`) → `{ rfE6, rvE6, amountCents, updatedAt }`

- [ ] **Step 1: Escrever os testes que falham**

Em `src/api/app.test.ts`, adicionar no fim do arquivo:

```ts
const baseRebalance = {
  currency: "BRL", quoteSource: null, quoteSymbol: null, maturityDate: null,
  liquidity: null, broker: "PagBank", objective: "Aposentadoria", investor: "Ana",
} as const;

function seedRebalance(db: ReturnType<typeof openDb>) {
  insertInstruments(db, [
    { ...baseRebalance, id: "cdb-r", legacyKey: "CDB R", name: "CDB R", kind: "fixed_income", category: "cdb", ticker: null, benchmark: "CDI", rateE6: 1_000_000n },
    { ...baseRebalance, id: "etf-r", legacyKey: "ETF R", name: "ETF R", kind: "equity", category: "etf_equity", ticker: "WRLD11", benchmark: null, rateE6: null, broker: "XP" },
  ]);
  insertTransactions(db, [
    { instrumentId: "cdb-r", tradeDate: "2026-09-17", kind: "BUY", quantityE8: null, grossCents: 100_000n, feesCents: 0n, note: null, legacyRow: null },
    { instrumentId: "etf-r", tradeDate: "2026-09-17", kind: "BUY", quantityE8: 10_00000000n, grossCents: 9_000n, feesCents: 0n, note: null, legacyRow: null },
  ]);
  writeIndexRates(db, [{ series: "CDI", date: "2026-09-17", valueE12: 1_000_000_000n }]);
  writeQuotes(db, [{ ticker: "WRLD11", date: "2026-09-17", closeCents: 1_000n, source: "yahoo", settled: true }], "2026-09-18");
  recordSourceAttempt(db, "bcb", { ok: true });
  recordSourceAttempt(db, "yahoo", { ok: true });
}

test("GET /api/rebalance calcula o aporte por grupo e aceita metas na query", async () => {
  const db = openDb(":memory:");
  migrate(db);
  seedRebalance(db);
  const app = buildApp({ db, csvDir: csvDirFixture(), logger: false });

  let res = await app.inject({ method: "GET", url: "/api/rebalance" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().targets, { rfE6: <valor>, rvE6: <valor> });
  assert.equal(res.json().baseCents, 110_100);
  assert.equal(res.json().amountCents, 0);
  assert.equal(res.json().stale, false);

  res = await app.inject({ method: "GET", url: "/api/rebalance?amountCents=<valor>&rfE6=<valor>&rvE6=<valor>" });
  assert.equal(res.statusCode, 200);
  const calculado = res.json();
  assert.equal(calculado.groups[0].suggestedCents, <valor>);
  assert.equal(calculado.groups[1].suggestedCents, 7510);
  assert.equal(calculado.groups[0].pctAfter, 90);
  assert.equal(calculado.groups[1].pctAfter, 10);

  await app.close();
});

test("PUT /api/rebalance persiste as metas e o ultimo aporte", async () => {
  const db = openDb(":memory:");
  migrate(db);
  seedRebalance(db);
  const app = buildApp({ db, csvDir: csvDirFixture(), logger: false });

  let res = await app.inject({
    method: "PUT", url: "/api/rebalance",
    payload: { rfE6: <valor>, rvE6: <valor>, amountCents: <valor> },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().rfE6, <valor>);
  assert.equal(res.json().amountCents, <valor>);

  res = await app.inject({ method: "GET", url: "/api/rebalance" });
  assert.deepEqual(res.json().targets, { rfE6: <valor>, rvE6: <valor> });
  assert.equal(res.json().amountCents, <valor>);

  await app.close();
});

test("rebalance valida metas e aporte com 400", async () => {
  const db = openDb(":memory:");
  migrate(db);
  const app = buildApp({ db, csvDir: csvDirFixture(), logger: false });

  let res = await app.inject({
    method: "PUT", url: "/api/rebalance",
    payload: { rfE6: <valor>, rvE6: <valor>, amountCents: 0 },
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /somar 100%/);

  res = await app.inject({
    method: "PUT", url: "/api/rebalance",
    payload: { rfE6: -1, rvE6: <valor>, amountCents: 0 },
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /entre 0% e 100%/);

  res = await app.inject({
    method: "PUT", url: "/api/rebalance",
    payload: { rfE6: <valor>, rvE6: <valor>, amountCents: -1 },
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /valor a investir inválido/);

  res = await app.inject({
    method: "PUT", url: "/api/rebalance",
    payload: { rfE6: 1.5, rvE6: <valor>, amountCents: 0 },
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /inteiros/);

  res = await app.inject({ method: "GET", url: "/api/rebalance?amountCents=abc" });
  assert.equal(res.statusCode, 400);

  res = await app.inject({ method: "GET", url: "/api/rebalance?rfE6=<valor>" });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /juntos/);

  res = await app.inject({ method: "GET", url: "/api/rebalance?rfE6=<valor>&rvE6=<valor>" });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /somar 100%/);

  await app.close();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/api/app.test.ts`
Expected: FAIL — `404` nos GET/PUT de `/api/rebalance` (rota não registrada).

- [ ] **Step 3: Implementar a rota**

Criar `src/api/routes/rebalance.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/index.ts";
import { saveRebalanceTargets } from "../../db/repos.ts";
import { toNumberSafe } from "../../domain/money.ts";
import { buildRebalance, type RebalanceView } from "../../services/rebalance.ts";

const META_MAX = 1_000_000n;

type Targets = { rfE6: bigint; rvE6: bigint };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function validateTargets(rfE6: bigint, rvE6: bigint): { ok: true; value: Targets } | { ok: false; error: string } {
  if (rfE6 < 0n || rfE6 > META_MAX || rvE6 < 0n || rvE6 > META_MAX) {
    return { ok: false, error: "metas devem ficar entre 0% e 100%" };
  }
  if (rfE6 + rvE6 !== META_MAX) return { ok: false, error: "as metas precisam somar 100%" };
  return { ok: true, value: { rfE6, rvE6 } };
}

function parseCentsParam(value: string | undefined): { ok: true; value: bigint | undefined } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (!/^\d{1,15}$/.test(value)) return { ok: false, error: "amountCents inválido" };
  return { ok: true, value: BigInt(value) };
}

function parseE6Param(value: string | undefined): { ok: true; value: bigint | undefined } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (!/^\d{1,7}$/.test(value)) return { ok: false, error: "metas inválidas" };
  return { ok: true, value: BigInt(value) };
}

function toApiRebalance(result: RebalanceView) {
  return {
    asOf: result.asOf,
    baseCents: toNumberSafe(result.baseCents),
    amountCents: toNumberSafe(result.amountCents),
    targets: { rfE6: toNumberSafe(result.targets.rfE6), rvE6: toNumberSafe(result.targets.rvE6) },
    groups: result.groups.map((group) => ({
      key: group.key,
      valueCents: toNumberSafe(group.valueCents),
      pctBefore: group.pctBefore,
      targetE6: toNumberSafe(group.targetE6),
      suggestedCents: toNumberSafe(group.suggestedCents),
      afterValueCents: toNumberSafe(group.afterValueCents),
      pctAfter: group.pctAfter,
      aboveTarget: group.aboveTarget,
    })),
    stale: result.stale,
  };
}

export function registerRebalanceRoutes(app: FastifyInstance, db: Db): void {
  app.get<{ Querystring: { amountCents?: string; rfE6?: string; rvE6?: string } }>("/api/rebalance", (request, reply) => {
    const rf = parseE6Param(request.query.rfE6);
    const rv = parseE6Param(request.query.rvE6);
    const amount = parseCentsParam(request.query.amountCents);
    if (!rf.ok) return reply.code(400).send({ error: rf.error });
    if (!rv.ok) return reply.code(400).send({ error: rv.error });
    if (!amount.ok) return reply.code(400).send({ error: amount.error });
    if ((rf.value === undefined) !== (rv.value === undefined)) {
      return reply.code(400).send({ error: "rfE6 e rvE6 devem vir juntos" });
    }
    let targets: Targets | undefined;
    if (rf.value !== undefined && rv.value !== undefined) {
      const parsed = validateTargets(rf.value, rv.value);
      if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
      targets = parsed.value;
    }
    return toApiRebalance(buildRebalance(db, { amountCents: amount.value, targetsE6: targets }));
  });

  app.put<{ Body: unknown }>("/api/rebalance", (request, reply) => {
    if (!isRecord(request.body)) return reply.code(400).send({ error: "corpo deve ser um objeto" });
    const { rfE6, rvE6, amountCents } = request.body;
    if (!Number.isSafeInteger(rfE6) || !Number.isSafeInteger(rvE6) || !Number.isSafeInteger(amountCents)) {
      return reply.code(400).send({ error: "metas e aporte devem ser inteiros" });
    }
    const values = { rfE6: BigInt(rfE6 as number), rvE6: BigInt(rvE6 as number), amountCents: BigInt(amountCents as number) };
    const targets = validateTargets(values.rfE6, values.rvE6);
    if (!targets.ok) return reply.code(400).send({ error: targets.error });
    if (values.amountCents < 0n) return reply.code(400).send({ error: "valor a investir inválido" });
    const saved = saveRebalanceTargets(db, values);
    return {
      rfE6: toNumberSafe(saved.rfE6),
      rvE6: toNumberSafe(saved.rvE6),
      amountCents: toNumberSafe(saved.amountCents),
      updatedAt: saved.updatedAt,
    };
  });
}
```

- [ ] **Step 4: Registrar no app**

Em `src/app.ts`:

1. Junto dos outros imports de rotas:

```ts
import { registerRebalanceRoutes } from "./api/routes/rebalance.ts";
```

2. Junto dos outros `register*Routes`:

```ts
  registerRebalanceRoutes(app, options.db);
```

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `node --test src/api/app.test.ts`
Expected: PASS — 3 testes novos + os existentes.

- [ ] **Step 6: Rodar a suíte completa e o typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS — 218 testes; typecheck limpo.

- [ ] **Step 7: Commit**

```bash
git add src/api/routes/rebalance.ts src/app.ts src/api/app.test.ts
git commit -m "feat: rotas get e put do rebalanceamento"
```

---

### Task 4: Web — seção "Rebalanceamento"

**Files:**
- Modify: `web/src/format.ts` (`parsePercentualParaE6` ganha `permitirZero`)
- Modify: `web/src/api.ts` (tipos + `getRebalance`/`saveRebalance`; `sendJson` aceita `PUT`)
- Modify: `web/src/App.tsx` (5ª seção na sidebar + render)
- Create: `web/src/views/RebalanceView.tsx`
- Modify: `web/src/styles.css` (classes `.reb-*`)

**Interfaces:**
- Consumes: `GET/PUT /api/rebalance` da Task 3; `getJson`/`sendJson` de `web/src/api.ts`; `formataBRL`/`formataPercentual`/`parseMoedaParaCents`/`parsePercentualParaE6` de `web/src/format.ts`; `reloadToken` do `App`.
- Produces: `type Rebalance`, `type RebalanceGroup`, `type RebalanceConfig`, `getRebalance`, `saveRebalance`, componente `RebalanceView`, view `"rebalanceamento"`.

- [ ] **Step 1: Permitir 0% no parser de percentual**

Em `web/src/format.ts`, trocar o helper existente:

```ts
/** "0" | "105" | "105,5" → 0/<valor>/<valor> (escala e6); null se inválido (≤ 0 sem `permitirZero`). */
export function parsePercentualParaE6(texto: string, permitirZero = false): number | null {
  const limpo = texto.trim().replace("%", "").replace(",", ".");
  if (!/^\d+(\.\d{1,4})?$/.test(limpo)) return null;
  const [inteiro = "0", fracao = ""] = limpo.split(".");
  const e6 = Number(BigInt(inteiro) * 10_000n + BigInt((fracao + "0000").slice(0, 4)));
  return Number.isSafeInteger(e6) && (permitirZero ? e6 >= 0 : e6 > 0) ? e6 : null;
}
```

- [ ] **Step 2: Adicionar os tipos e as funções de API**

Em `web/src/api.ts`:

1. No tipo de `sendJson`, incluir `PUT`:

```ts
async function sendJson<T>(url: string, method: "POST" | "PATCH" | "PUT", payload: unknown): Promise<T> {
```

2. Depois de `getAllocation`:

```ts
export type RebalanceGroup = {
  key: "rf" | "rv"; valueCents: number; pctBefore: number; targetE6: number;
  suggestedCents: number; afterValueCents: number; pctAfter: number; aboveTarget: boolean;
};
export type Rebalance = {
  asOf: string; baseCents: number; amountCents: number;
  targets: { rfE6: number; rvE6: number }; groups: RebalanceGroup[]; stale: boolean;
};
export type RebalanceConfig = { rfE6: number; rvE6: number; amountCents: number; updatedAt: string };

export function getRebalance(
  params: { amountCents?: number; rfE6?: number; rvE6?: number },
  signal?: AbortSignal,
): Promise<Rebalance> {
  const query = new URLSearchParams();
  if (params.amountCents !== undefined) query.set("amountCents", String(params.amountCents));
  if (params.rfE6 !== undefined && params.rvE6 !== undefined) {
    query.set("rfE6", String(params.rfE6));
    query.set("rvE6", String(params.rvE6));
  }
  const qs = query.toString();
  return getJson(`/api/rebalance${qs === "" ? "" : `?${qs}`}`, signal);
}

export const saveRebalance = (payload: { rfE6: number; rvE6: number; amountCents: number }): Promise<RebalanceConfig> =>
  sendJson("/api/rebalance", "PUT", payload);
```

- [ ] **Step 3: Criar a `RebalanceView`**

Criar `web/src/views/RebalanceView.tsx`:

```tsx
import { useEffect, useState } from "react";
import { WarningCircle } from "@phosphor-icons/react";
import { getRebalance, saveRebalance, type Rebalance } from "../api.ts";
import { formataBRL, formataPercentual, parseMoedaParaCents, parsePercentualParaE6 } from "../format.ts";

const ROTULOS: Record<string, string> = { rf: "Renda Fixa", rv: "Renda Variável" };
const SOMA_METAS = 1_000_000;

function textoDeE6(e6: number): string {
  return (e6 / 10_000).toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

function textoDeCents(cents: number): string {
  return cents === 0 ? "" : (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function RebalanceView({ reloadToken }: { reloadToken: number }) {
  const [dados, setDados] = useState<Rebalance | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregado, setCarregado] = useState(false);
  const [rfTexto, setRfTexto] = useState("");
  const [rvTexto, setRvTexto] = useState("");
  const [aporteTexto, setAporteTexto] = useState("");
  const [erroEntrada, setErroEntrada] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [recado, setRecado] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setCarregado(false);
    getRebalance({}, controller.signal)
      .then((resultado) => {
        setDados(resultado);
        setRfTexto(textoDeE6(resultado.targets.rfE6));
        setRvTexto(textoDeE6(resultado.targets.rvE6));
        setAporteTexto(textoDeCents(resultado.amountCents));
        setErro(null);
        setCarregado(true);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setErro(cause instanceof Error ? cause.message : String(cause));
      });
    return () => controller.abort();
  }, [reloadToken]);

  useEffect(() => {
    if (!carregado) return;
    const rfE6 = parsePercentualParaE6(rfTexto, true);
    const rvE6 = parsePercentualParaE6(rvTexto, true);
    const aporte = aporteTexto.trim() === "" ? 0 : parseMoedaParaCents(aporteTexto);
    if (rfE6 === null || rvE6 === null) return setErroEntrada("meta inválida (ex.: 80 ou 72,5)");
    if (rfE6 + rvE6 !== SOMA_METAS) return setErroEntrada("as metas precisam somar 100%");
    if (aporte === null) return setErroEntrada("valor a investir inválido");
    setErroEntrada(null);
    const controller = new AbortController();
    const id = setTimeout(() => {
      getRebalance({ amountCents: aporte, rfE6, rvE6 }, controller.signal)
        .then((resultado) => setDados(resultado))
        .catch((cause: unknown) => {
          if (cause instanceof DOMException && cause.name === "AbortError") return;
          setErro(cause instanceof Error ? cause.message : String(cause));
        });
    }, 400);
    return () => { clearTimeout(id); controller.abort(); };
  }, [carregado, rfTexto, rvTexto, aporteTexto]);

  async function salvar() {
    const rfE6 = parsePercentualParaE6(rfTexto, true);
    const rvE6 = parsePercentualParaE6(rvTexto, true);
    const aporte = aporteTexto.trim() === "" ? 0 : parseMoedaParaCents(aporteTexto);
    if (rfE6 === null || rvE6 === null) return setErroEntrada("meta inválida (ex.: 80 ou 72,5)");
    if (rfE6 + rvE6 !== SOMA_METAS) return setErroEntrada("as metas precisam somar 100%");
    if (aporte === null) return setErroEntrada("valor a investir inválido");
    setSalvando(true);
    setRecado(null);
    try {
      await saveRebalance({ rfE6, rvE6, amountCents: aporte });
      setRecado("Metas salvas");
    } catch (cause) {
      setErroEntrada(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Rebalanceamento</h1>
          <p className="page-sub">Fora da reserva de emergência · sem vender posições</p>
        </div>
      </div>

      {erro !== null && (
        <div className="callout callout-error" role="alert">
          <WarningCircle size={17} aria-hidden="true" />
          <div><p className="callout-title">Não foi possível calcular</p><p>{erro}</p></div>
        </div>
      )}

      <section className="card">
        <div className="reb-metas">
          <label className="campo">
            <span className="stat-label">Meta · Renda Fixa</span>
            <span className="campo-sufixo">
              <input inputMode="decimal" value={rfTexto} onChange={(evento) => setRfTexto(evento.target.value)} placeholder="80" />
              <span className="campo-sufixo-texto">%</span>
            </span>
          </label>
          <label className="campo">
            <span className="stat-label">Meta · Renda Variável</span>
            <span className="campo-sufixo">
              <input inputMode="decimal" value={rvTexto} onChange={(evento) => setRvTexto(evento.target.value)} placeholder="20" />
              <span className="campo-sufixo-texto">%</span>
            </span>
          </label>
          <label className="campo campo-largo">
            <span className="stat-label">Quanto quero investir</span>
            <span className="campo-moeda">
              <span className="campo-prefixo">R$</span>
              <input inputMode="decimal" value={aporteTexto} onChange={(evento) => setAporteTexto(evento.target.value)} placeholder="<valor>" />
            </span>
          </label>
        </div>
        {erroEntrada !== null && <p className="campo-erro" role="alert">{erroEntrada}</p>}
        <div className="form-acoes">
          {recado !== null && <span className="reb-nota" role="status">{recado}</span>}
          <button type="button" className="btn btn-primary" disabled={salvando} onClick={() => void salvar()}>
            {salvando ? "Salvando…" : "Salvar metas"}
          </button>
        </div>
      </section>

      {dados !== null && (
        <div className="reb-grade">
          {dados.groups.map((grupo) => (
            <section className="card reb-card" key={grupo.key}>
              <div className="reb-card-topo">
                <h2 className="reb-titulo">{ROTULOS[grupo.key] ?? grupo.key}</h2>
                {grupo.aboveTarget && <span className="badge badge-warn">acima da meta — sem aporte novo</span>}
              </div>
              <div className="reb-pct">
                <span className="reb-pct-bloco"><span className="stat-label">Hoje</span><strong>{formataPercentual(grupo.pctBefore)}</strong></span>
                <span className="reb-seta" aria-hidden="true">→</span>
                <span className="reb-pct-bloco"><span className="stat-label">Alvo</span><strong>{formataPercentual(grupo.targetE6 / 10_000)}</strong></span>
                <span className="reb-seta" aria-hidden="true">→</span>
                <span className="reb-pct-bloco"><span className="stat-label">Depois</span><strong>{formataPercentual(grupo.pctAfter)}</strong></span>
              </div>
              <div className="reb-valores">
                <span className="stat-label">Investir</span>
                <strong className="reb-sugerido">{formataBRL(grupo.suggestedCents)}</strong>
                <span className="reb-nota">
                  hoje {formataBRL(grupo.valueCents)} · depois {formataBRL(grupo.afterValueCents)}
                </span>
              </div>
            </section>
          ))}
        </div>
      )}

      {dados !== null && (
        <p className="reb-nota">
          Carteira fora da reserva: {formataBRL(dados.baseCents)} + aporte {formataBRL(dados.amountCents)} ={" "}
          {formataBRL(dados.baseCents + dados.amountCents)}.
          {dados.stale && " Há cotações desatualizadas — usando o último valor conhecido."}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Ligar a seção no App**

Em `web/src/App.tsx`:

1. Importar o ícone e a view:

```tsx
import { ArrowsClockwise, ChartLine, ChartLineUp, Coins, Table, Target } from "@phosphor-icons/react";
```

```tsx
import { RebalanceView } from "./views/RebalanceView.tsx";
```

2. Estender o tipo e a lista da sidebar:

```tsx
type View = "visao-geral" | "posicoes" | "rebalanceamento" | "evolucao" | "fontes";

const ITENS: Array<{ id: View; rotulo: string; Icone: typeof Coins }> = [
  { id: "visao-geral", rotulo: "Visão geral", Icone: ChartLineUp },
  { id: "posicoes", rotulo: "Posições", Icone: Table },
  { id: "rebalanceamento", rotulo: "Rebalanceamento", Icone: Target },
  { id: "evolucao", rotulo: "Evolução", Icone: ChartLine },
  { id: "fontes", rotulo: "Fontes", Icone: Coins },
];
```

3. Renderizar:

```tsx
        {view === "rebalanceamento" && <RebalanceView reloadToken={reloadToken} />}
```

- [ ] **Step 5: Adicionar os estilos**

Em `web/src/styles.css`, no fim do arquivo:

```css
.reb-metas { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)) minmax(0, 1.2fr); gap: 14px; }
.reb-grade { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 14px; }
.reb-card { display: flex; flex-direction: column; gap: 12px; }
.reb-card-topo { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.reb-titulo { margin: 0; font-size: 15px; }
.reb-pct { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.reb-pct-bloco { display: flex; flex-direction: column; gap: 2px; }
.reb-pct-bloco strong { font-family: var(--font-mono); font-size: 18px; }
.reb-seta { color: var(--text-3); }
.reb-valores { display: flex; flex-direction: column; gap: 4px; border-top: 1px solid var(--border); padding-top: 10px; }
.reb-sugerido { font-family: var(--font-mono); font-size: 26px; font-weight: 600; color: var(--accent); }
.reb-nota { color: var(--text-2); font-size: 12px; }
@media (max-width: 1024px) {
  .reb-metas, .reb-grade { grid-template-columns: minmax(0, 1fr); }
}
```

- [ ] **Step 6: Typecheck e build**

Run: `npm run typecheck && npm run build:web`
Expected: PASS — sem erros; build gera `web/dist`.

- [ ] **Step 7: Commit**

```bash
git add web/src/format.ts web/src/api.ts web/src/App.tsx web/src/views/RebalanceView.tsx web/src/styles.css
git commit -m "feat: secao de rebalanceamento no web"
```

---

### Task 5: Aceite no browser com dados reais + verificação final

**Files:**
- Nenhum arquivo novo (só verificação e evidência).

**Interfaces:**
- Consumes: tudo das Tasks 1–4.

- [ ] **Step 1: Verificação completa**

Run: `npm test && npm run typecheck && npm run build:web`
Expected: 218 testes verdes; typecheck e build limpos.

- [ ] **Step 2: Subir o container e checar saúde**

Run: `docker compose up -d --build && curl -s localhost:3000/api/health`
Expected: container `healthy`; fontes sem `stale` inesperado.

- [ ] **Step 3: Conferir a matemática com dados reais (independente)**

1. `curl -s localhost:3000/api/portfolio` e somar em BigInt (fora do app) as posições com `objective !== "Reserva"` e `marketValueCents !== null`, separando RF (`kind` `fixed_income`/`pension` ou `category` `etf_fixed`) de RV.
2. `curl -s "localhost:3000/api/rebalance?amountCents=<valor>"` (com metas 80/20 salvas).
3. Conferir: `baseCents` = soma; `groups[0].suggestedCents + groups[1].suggestedCents === <valor>`; `groups[i].afterValueCents === valueCents + suggestedCents`; `pctAfter` ≈ 80/20; `asOf` de hoje.
4. `curl -s localhost:3000/api/reconciliation?month=2026-09&asOf=2026-09-16` → `referenceCents <valor>`, `unexplained 0` (inalterado).

- [ ] **Step 4: Aceite no browser (1280 e 1024)**

Abrir `localhost:3000`, seção **Rebalanceamento**:
1. Metas 80/20 e aporte `<valor>` → conferir os dois cartões (R$ sugerido em destaque, % antes → alvo → depois) e a linha de total com a soma = aporte.
2. Mudar a meta para 90/10 sem salvar → a prévia recalcula; salvar → "Metas salvas" e um reload mantém 90/10 e o último aporte.
3. Testar um grupo acima da meta (ex.: meta 60/40 com os dados atuais) → badge "acima da meta — sem aporte novo" e R$ <valor> no grupo.
4. Entrada inválida (ex.: metas 80/30) → erro inline, sem request.
5. Conferir o aviso de `stale` quando alguma fonte estiver desatualizada (pode forçar parando uma fonte ou conferindo `/api/health`).
6. Sem overflow horizontal em 1280 e 1024 (`document.documentElement.scrollWidth === window.innerWidth`).

Screenshots em `.superpowers/sdd/reb-01-visao-geral.png`, `reb-02-grupo-acima.png`, `reb-03-1024.png`.

- [ ] **Step 5: Docker com o bundle novo**

Run: `docker compose up -d --build && curl -s localhost:3000/api/rebalance | head -c 200`
Expected: JSON com `targets` e `groups`; container `healthy`.

- [ ] **Step 6: Atualizar o ROADMAP**

Em `ROADMAP.md`, adicionar a linha na tabela de estado:
`| Rebalanceamento (metas RF × RV, sem reserva) | concluída — branch \`rebalanceamento\` |`
e apontar a próxima ação (projeção até 2099). Commitar:

```bash
git add ROADMAP.md
git commit -m "docs: evidencia do rebalanceamento no roadmap"
```

---

## Notas de execução

- O container monta o código do worktree? Não: `docker compose` usa o diretório atual — rodar os comandos de Docker **dentro do worktree** `.worktrees/rebalanceamento`.
- Escrita de CLI/DB no host com container de pé pode não aparecer no container até reiniciar (snapshot do Docker Desktop) — preferir `docker compose exec app ...` ou reiniciar.
- `npm test` conta os testes por arquivo: se a contagem divergir (204 → 211 → 214 → 217), conferir se cada task rodou o arquivo novo antes de commitar.
