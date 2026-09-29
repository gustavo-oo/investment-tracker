# V2 — CRUD de transações e ativos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** entregar o CRUD de Compra/Resgate e de ativos pela UI (painel do ativo em Posições), com guardas fortes de posição negativa, app como fonte da verdade e import restrito a CLI com `--replace`.

**Architecture:** guarda pura no domínio (`write-guards.ts`) simula a carteira com a mudança aplicada; `services/writes.ts` orquestra validação + guarda + uma transação SQLite; rotas Fastify finas (instruments expandida + transactions nova) — sem migration, o schema atual cobre tudo (`legacy_key = ui:<id>`). No web, `FormTransacao`/`FormAtivo` (modais) pendurados no painel de Posições; a seção Importar sai da UI e o histórico de imports vai para Fontes.

**Tech Stack:** Node 22 + TypeScript (type stripping), `node:test`, Fastify, better-sqlite3, React 19 + Vite, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-22-v2-crud-transacoes-ativos-design.md`

## Global Constraints

- Zero `float` em dado persistido/cálculo; inteiros escalonados; `toNumberSafe` só na borda da API.
- Testes sem rede (fixtures); `node:test` + `assert/strict`; DB de teste = `openDb(":memory:")` + `migrate`.
- Commits em pt-BR (conventional), 1 por task; ≤ 400 linhas / ≤ 10 arquivos por layer.
- Branch `v2-crud-transacoes-ativos` a partir da `main`; merge ff ao final.
- Não commitar `.superpowers/`, `data/`, `.env`.
- Só Compra (`BUY`) e Resgate (`SELL`); quantidade entra positiva e é gravada negativa em `SELL`; RF não usa quantidade.
- Sem auditoria, exclusão física; sem migration; import só por CLI e exige `--replace` quando há transações.
- Guardas: data ≤ hoje BRT, valor > 0, tolerância de 1¢ no resgate RF; simulação vale para criar/editar/excluir.
- Verificação: `npm test`, `npm run typecheck`, `npm run build:web`, `docker compose up -d --build`, `curl localhost:3000/api/health`.
- Baseline: **175 testes** verdes no head (`aa12aea`); reconciliação `asOf=2026-09-16` = `<valor>` / `0` não pode mudar.

---

### Task 1: Domínio — guarda de posição negativa

**Files:**
- Create: `src/domain/write-guards.ts`
- Test: `src/domain/write-guards.test.ts`

**Interfaces:**
- Consumes: `PositionTransaction`/`RatePoint`/`rfValueCents` (`src/domain/position.ts:4-65`), `formatCents` (`src/domain/money.ts:49`).
- Produces:
  - `type GuardTransaction = PositionTransaction & { id: number }`
  - `type GuardChange = { action: "create"; transaction: PositionTransaction } | { action: "update"; transactionId: number; transaction: PositionTransaction } | { action: "delete"; transactionId: number } | { action: "none" }`
  - `type GuardInput = { kind: InstrumentKind; rateE6: bigint | null; maturityDate: string | null; transactions: GuardTransaction[]; rates: RatePoint[] }`
  - `validateChange(input: GuardInput, change: GuardChange): string | null` — `null` = ok; string = mensagem pt-BR do bloqueio.

- [ ] **Step 1: Write the failing test**

Criar `src/domain/write-guards.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateChange, type GuardInput, type GuardTransaction } from "./write-guards.ts";
import type { PositionTransaction } from "./position.ts";

const rate = { date: "2026-09-17", valueE12: 1_000_000_000n };
const buy: PositionTransaction = { tradeDate: "2026-09-17", kind: "BUY", quantityE8: null, grossCents: 100_000n, feesCents: 0n };
const buy10: PositionTransaction = { tradeDate: "2026-09-17", kind: "BUY", quantityE8: 10_00000000n, grossCents: 9_000n, feesCents: 0n };
const g = (transaction: PositionTransaction, id: number): GuardTransaction => ({ id, ...transaction });
const rf = (transactions: GuardTransaction[], extra: Partial<GuardInput> = {}): GuardInput => ({
  kind: "fixed_income", rateE6: 1_000_000n, maturityDate: null, rates: [rate], transactions, ...extra,
});

test("RF: resgate até o saldo capitalizado passa; acima falha", () => {
  const input = rf([g(buy, 1)]);
  assert.equal(validateChange(input, { action: "create", transaction: { ...buy, kind: "SELL", grossCents: 100_100n } }), null);
  assert.match(validateChange(input, { action: "create", transaction: { ...buy, kind: "SELL", grossCents: 100_102n } }) ?? "", /maior que o saldo/);
});

test("RF: tolerância de 1¢ do vencimento", () => {
  const input = rf([g(buy, 1)]);
  assert.equal(validateChange(input, { action: "create", transaction: { ...buy, kind: "SELL", grossCents: 100_101n } }), null);
  assert.match(validateChange(input, { action: "create", transaction: { ...buy, kind: "SELL", grossCents: 100_102n } }) ?? "", /maior que o saldo/);
});

test("RF sem índice: saldo é a soma dos aportes", () => {
  const input = rf([g(buy, 1)], { rateE6: null, rates: [] });
  assert.equal(validateChange(input, { action: "create", transaction: { ...buy, kind: "SELL", grossCents: 100_000n } }), null);
  assert.match(validateChange(input, { action: "create", transaction: { ...buy, kind: "SELL", grossCents: 100_002n } }) ?? "", /maior que o saldo/);
});

test("RF: vencimento congela a capitalização no dia anterior", () => {
  const input = rf([g(buy, 1)], {
    maturityDate: "2026-09-18",
    rates: [rate, { date: "2026-09-18", valueE12: 1_000_000_000n }],
  });
  assert.equal(validateChange(input, { action: "create", transaction: { ...buy, kind: "SELL", grossCents: 100_100n } }), null);
});

test("RF: resgate sem nenhum aporte falha", () => {
  const input = rf([]);
  assert.match(validateChange(input, { action: "create", transaction: { ...buy, kind: "SELL", grossCents: 2n } }) ?? "", /maior que o saldo/);
});

test("RV: resgate maior que as cotas disponíveis falha", () => {
  const input: GuardInput = { kind: "equity", rateE6: null, maturityDate: null, rates: [], transactions: [g(buy10, 1)] };
  assert.equal(validateChange(input, { action: "create", transaction: { ...buy10, kind: "SELL", quantityE8: -10_00000000n } }), null);
  assert.match(validateChange(input, { action: "create", transaction: { ...buy10, kind: "SELL", quantityE8: -11_00000000n } }) ?? "", /negativa/);
});

test("edição que cria oversell retroativo falha", () => {
  const sell: PositionTransaction = { tradeDate: "2026-09-18", kind: "SELL", quantityE8: -10_00000000n, grossCents: 9_000n, feesCents: 0n };
  const input: GuardInput = { kind: "equity", rateE6: null, maturityDate: null, rates: [], transactions: [g(buy10, 1), g(sell, 2)] };
  assert.equal(validateChange(input, { action: "update", transactionId: 2, transaction: sell }), null);
  assert.match(validateChange(input, { action: "update", transactionId: 2, transaction: { ...sell, quantityE8: -11_00000000n } }) ?? "", /negativa/);
});

test("exclusão de compra que sustenta resgate falha; exclusão do resgate passa", () => {
  const sell: PositionTransaction = { tradeDate: "2026-09-18", kind: "SELL", quantityE8: -10_00000000n, grossCents: 9_000n, feesCents: 0n };
  const input: GuardInput = { kind: "equity", rateE6: null, maturityDate: null, rates: [], transactions: [g(buy10, 1), g(sell, 2)] };
  assert.match(validateChange(input, { action: "delete", transactionId: 1 }) ?? "", /negativa/);
  assert.equal(validateChange(input, { action: "delete", transactionId: 2 }), null);
});

test("instrumento RF: parâmetros novos validam as transações existentes", () => {
  const sell = g({ tradeDate: "2026-09-17", kind: "SELL", quantityE8: null, grossCents: 100_100n, feesCents: 0n }, 2);
  const semTaxa = rf([g(buy, 1), sell], { rateE6: null, rates: [] });
  assert.match(validateChange(semTaxa, { action: "none" }) ?? "", /maior que o saldo/);
  assert.equal(validateChange(rf([g(buy, 1), sell]), { action: "none" }), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | tail -20`
Expected: falha `Cannot find module './write-guards.ts'`; demais verdes.

- [ ] **Step 3: Implement**

Criar `src/domain/write-guards.ts`:

```ts
import { formatCents, MULTIPLIER_SCALE } from "./money.ts";
import type { InstrumentKind } from "./model.ts";
import { rfValueCents, type PositionTransaction, type RatePoint } from "./position.ts";

export type GuardTransaction = PositionTransaction & { id: number };

export type GuardChange =
  | { action: "create"; transaction: PositionTransaction }
  | { action: "update"; transactionId: number; transaction: PositionTransaction }
  | { action: "delete"; transactionId: number }
  | { action: "none" };

export type GuardInput = {
  kind: InstrumentKind;
  rateE6: bigint | null;
  maturityDate: string | null;
  transactions: GuardTransaction[];
  rates: RatePoint[];
};

function applyChange(transactions: GuardTransaction[], change: GuardChange): GuardTransaction[] | null {
  if (change.action === "none") return [...transactions];
  if (change.action === "create") return [...transactions, { id: Number.MAX_SAFE_INTEGER, ...change.transaction }];
  const index = transactions.findIndex((transaction) => transaction.id === change.transactionId);
  if (index === -1) return null;
  if (change.action === "update") {
    return transactions.map((transaction, i) => (i === index ? { id: transaction.id, ...change.transaction } : transaction));
  }
  return transactions.filter((_, i) => i !== index);
}

function validateQuantity(ordered: GuardTransaction[]): string | null {
  let quantity = 0n;
  for (const transaction of ordered) {
    quantity += transaction.quantityE8 ?? 0n;
    if (quantity < 0n) return `resgate deixa a posição negativa em ${transaction.tradeDate}`;
  }
  return null;
}

function validateFixedIncome(input: GuardInput, ordered: GuardTransaction[]): string | null {
  const multiplierE6 = input.rateE6 ?? MULTIPLIER_SCALE;
  const rates = input.maturityDate === null ? input.rates : input.rates.filter((rate) => rate.date < input.maturityDate);
  const operations: Array<{ date: string; grossCents: bigint }> = [];
  for (const transaction of ordered) {
    if (transaction.kind !== "SELL") {
      operations.push({ date: transaction.tradeDate, grossCents: transaction.grossCents });
      continue;
    }
    const { valueCents } = rfValueCents(operations, rates, multiplierE6, transaction.tradeDate);
    if (transaction.grossCents > valueCents + 1n) {
      const saldo = valueCents > 0n ? valueCents : 0n;
      return `resgate de ${formatCents(transaction.grossCents)} maior que o saldo de ${formatCents(saldo)} em ${transaction.tradeDate}`;
    }
    operations.push({ date: transaction.tradeDate, grossCents: -transaction.grossCents });
  }
  return null;
}

/** Simula a carteira com a mudança aplicada; devolve a mensagem do bloqueio ou null. */
export function validateChange(input: GuardInput, change: GuardChange): string | null {
  const updated = applyChange(input.transactions, change);
  if (updated === null) return "transação não encontrada";
  const ordered = [...updated].sort((a, b) =>
    a.tradeDate === b.tradeDate ? a.id - b.id : a.tradeDate < b.tradeDate ? -1 : 1);
  if (input.kind === "fixed_income") return validateFixedIncome(input, ordered);
  return validateQuantity(ordered);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test 2>&1 | tail -20 && npm run typecheck`
Expected: **184 testes** verdes (175 + 9); typecheck limpo.

- [ ] **Step 5: Commit**

```bash
git add src/domain/write-guards.ts src/domain/write-guards.test.ts
git commit -m "feat: guarda de posicao negativa no dominio"
```

---

### Task 2: Repos — CRUD de instrumentos e transações

**Files:**
- Modify: `src/db/repos.ts` (tipos no topo; funções CRUD depois de `getInstrumentByLegacyKey`, ~linha 77)
- Test: `src/db/repos.test.ts`

**Interfaces:**
- Consumes: `Db`, `InstrumentRow`, `TransactionRow` (existentes).
- Produces:
  - `type TransactionWithId = TransactionRow & { id: number }`
  - `listTransactionsByInstrument(db, instrumentId): TransactionWithId[]` (agora com `id`)
  - `getTransaction(db, id: number): TransactionWithId | undefined`
  - `insertTransaction(db, row: TransactionRow): number` (retorna o id novo)
  - `updateTransaction(db, id: number, row: TransactionRow): void`
  - `deleteTransaction(db, id: number): void`
  - `countTransactions(db, instrumentId: string): number`
  - `insertInstrument(db, row: InstrumentRow): void`
  - `updateInstrument(db, row: InstrumentRow): void` (UPDATE completo por `id`)
  - `deleteInstrument(db, id: string): void`

- [ ] **Step 1: Write the failing test**

Adicionar ao fim de `src/db/repos.test.ts` (incluir `countTransactions`, `deleteInstrument`, `deleteTransaction`, `getTransaction`, `insertInstrument`, `insertTransaction`, `updateInstrument`, `updateTransaction` na lista de imports de `./repos.ts`):

```ts
test("CRUD de instrumento: insere, atualiza e exclui", () => {
  const db = freshDb();
  insertInstrument(db, { ...cdb, id: "ui-1", legacyKey: "ui:ui-1", name: "CDB da UI" });
  assert.equal(getInstrument(db, "ui-1")?.name, "CDB da UI");
  updateInstrument(db, { ...cdb, id: "ui-1", legacyKey: "ui:ui-1", name: "CDB renomeado", investor: "Beto" });
  const atualizado = getInstrument(db, "ui-1");
  assert.equal(atualizado?.name, "CDB renomeado");
  assert.equal(atualizado?.investor, "Beto");
  deleteInstrument(db, "ui-1");
  assert.equal(getInstrument(db, "ui-1"), undefined);
});

test("CRUD de transação: insere com id, atualiza, conta e exclui", () => {
  const db = freshDb();
  insertInstruments(db, [cdb]);
  const id = insertTransaction(db, {
    instrumentId: cdb.id, tradeDate: "2026-09-17", kind: "BUY", quantityE8: null,
    grossCents: 100_000n, feesCents: 0n, note: "aporte", legacyRow: null,
  });
  assert.ok(id > 0);
  assert.equal(getTransaction(db, id)?.note, "aporte");
  assert.equal(countTransactions(db, cdb.id), 1);
  assert.equal(listTransactionsByInstrument(db, cdb.id)[0]?.id, id);
  updateTransaction(db, id, {
    instrumentId: cdb.id, tradeDate: "2026-09-18", kind: "BUY", quantityE8: null,
    grossCents: 120_000n, feesCents: 0n, note: null, legacyRow: null,
  });
  assert.equal(getTransaction(db, id)?.grossCents, 120_000n);
  assert.equal(getTransaction(db, id)?.note, null);
  deleteTransaction(db, id);
  assert.equal(getTransaction(db, id), undefined);
  assert.equal(countTransactions(db, cdb.id), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | tail -20`
Expected: falha `insertInstrument is not a function`; demais verdes.

- [ ] **Step 3: Implement**

Em `src/db/repos.ts`:

1. Depois de `TransactionRow` (linha ~15), acrescentar:

```ts
export type TransactionWithId = TransactionRow & { id: number };

type TransactionDbRow = {
  id: bigint; instrument_id: string; trade_date: string; kind: TransactionKind;
  quantity_e8: bigint | null; gross_cents: bigint; fees_cents: bigint; note: string | null; legacy_row: bigint | null;
};

const toTransaction = (row: TransactionDbRow): TransactionWithId => ({
  id: Number(row.id), instrumentId: row.instrument_id, tradeDate: row.trade_date, kind: row.kind,
  quantityE8: row.quantity_e8, grossCents: row.gross_cents, feesCents: row.fees_cents,
  note: row.note, legacyRow: row.legacy_row === null ? null : Number(row.legacy_row),
});
```

2. Substituir `listTransactionsByInstrument` pela versão com `id` e `toTransaction`:

```ts
export function listTransactionsByInstrument(db: Db, instrumentId: string): TransactionWithId[] {
  const rows = db.prepare("SELECT * FROM transactions WHERE instrument_id = ? ORDER BY trade_date, id")
    .all(instrumentId) as TransactionDbRow[];
  return rows.map(toTransaction);
}

export function getTransaction(db: Db, id: number): TransactionWithId | undefined {
  const row = db.prepare("SELECT * FROM transactions WHERE id = ?").get(id) as TransactionDbRow | undefined;
  return row ? toTransaction(row) : undefined;
}

export function insertTransaction(db: Db, row: TransactionRow): number {
  const result = db.prepare(`INSERT INTO transactions
    (instrument_id, trade_date, kind, quantity_e8, gross_cents, fees_cents, note, legacy_row)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(row.instrumentId, row.tradeDate, row.kind, row.quantityE8, row.grossCents, row.feesCents, row.note, row.legacyRow);
  return Number(result.lastInsertRowid);
}

export function updateTransaction(db: Db, id: number, row: TransactionRow): void {
  db.prepare(`UPDATE transactions SET instrument_id = ?, trade_date = ?, kind = ?, quantity_e8 = ?,
    gross_cents = ?, fees_cents = ?, note = ?, legacy_row = ? WHERE id = ?`)
    .run(row.instrumentId, row.tradeDate, row.kind, row.quantityE8, row.grossCents, row.feesCents, row.note, row.legacyRow, id);
}

export function deleteTransaction(db: Db, id: number): void {
  db.prepare("DELETE FROM transactions WHERE id = ?").run(id);
}

export function countTransactions(db: Db, instrumentId: string): number {
  const row = db.prepare("SELECT COUNT(*) AS total FROM transactions WHERE instrument_id = ?").get(instrumentId) as { total: bigint };
  return Number(row.total);
}
```

3. Depois de `updateInstrumentInvestor` (linha ~82), acrescentar:

```ts
export function insertInstrument(db: Db, row: InstrumentRow): void {
  db.prepare(`INSERT INTO instruments
    (id, legacy_key, name, kind, category, ticker, quote_source, quote_symbol, currency,
     benchmark, rate_e6, maturity_date, liquidity, broker, objective, investor)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(row.id, row.legacyKey, row.name, row.kind, row.category, row.ticker, row.quoteSource, row.quoteSymbol,
      row.currency, row.benchmark, row.rateE6, row.maturityDate, row.liquidity, row.broker, row.objective, row.investor);
}

export function updateInstrument(db: Db, row: InstrumentRow): void {
  db.prepare(`UPDATE instruments SET legacy_key = ?, name = ?, kind = ?, category = ?, ticker = ?,
    quote_source = ?, quote_symbol = ?, currency = ?, benchmark = ?, rate_e6 = ?, maturity_date = ?,
    liquidity = ?, broker = ?, objective = ?, investor = ? WHERE id = ?`)
    .run(row.legacyKey, row.name, row.kind, row.category, row.ticker, row.quoteSource, row.quoteSymbol,
      row.currency, row.benchmark, row.rateE6, row.maturityDate, row.liquidity, row.broker, row.objective, row.investor, row.id);
}

export function deleteInstrument(db: Db, id: string): void {
  db.prepare("DELETE FROM instruments WHERE id = ?").run(id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test 2>&1 | tail -20 && npm run typecheck`
Expected: **186 testes** verdes (184 + 2); typecheck limpo.

- [ ] **Step 5: Commit**

```bash
git add src/db/repos.ts src/db/repos.test.ts
git commit -m "feat: repos com crud de instrumentos e transacoes"
```

---

### Task 3: Serviço — regras de escrita

**Files:**
- Create: `src/services/writes.ts`
- Test: `src/services/writes.test.ts`

**Interfaces:**
- Consumes: repos da Task 2; `validateChange` (Task 1); `isDate`/`toBrDate` (`src/domain/dates.ts`); `slugify` (`src/import/catalog.ts:30`).
- Produces:
  - `type WriteFailure = { status: 400 | 404 | 409; message: string }`
  - `type WriteResult<T> = { ok: true; value: T } | { ok: false; failure: WriteFailure }`
  - `type InstrumentInput` (campos cadastrais sem `id`/`legacyKey`/`currency`/`quoteSource`)
  - `type TransactionInput = { tradeDate: string; kind: "BUY" | "SELL"; grossCents: bigint; feesCents: bigint; quantityE8: bigint | null; note: string | null }`
  - `createInstrument(db, input): WriteResult<InstrumentRow>`
  - `patchInstrument(db, id, patch: Partial<InstrumentInput>): WriteResult<InstrumentRow>`
  - `removeInstrument(db, id): WriteResult<null>`
  - `addTransaction(db, instrumentId, input, today?): WriteResult<TransactionWithId>`
  - `editTransaction(db, id, patch: Partial<TransactionInput>, today?): WriteResult<TransactionWithId>`
  - `removeTransaction(db, id): WriteResult<null>`

- [ ] **Step 1: Write the failing test**

Criar `src/services/writes.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { insertInstruments, writeIndexRates, type InstrumentRow } from "../db/repos.ts";
import {
  addTransaction, createInstrument, editTransaction, patchInstrument, removeInstrument, removeTransaction,
} from "./writes.ts";

const cdb: InstrumentRow = {
  id: "cdb-1", legacyKey: "CDB 1", name: "CDB 1", kind: "fixed_income", category: "cdb",
  ticker: null, quoteSource: null, quoteSymbol: null, currency: "BRL", benchmark: "CDI",
  rateE6: 1_000_000n, maturityDate: null, liquidity: null, broker: "PagBank", objective: "Reserva", investor: "Ana",
};

const etf: InstrumentRow = {
  ...cdb, id: "etf-1", legacyKey: "ETF 1", name: "ETF 1", kind: "equity", category: "etf_equity",
  ticker: "WRLD11", benchmark: null, rateE6: null,
};

function freshDb() {
  const db = openDb(":memory:");
  migrate(db);
  return db;
}

const HOJE = "2026-09-22";

test("createInstrument valida, gera id e legacy_key ui:", () => {
  const db = freshDb();
  const result = createInstrument(db, {
    name: "CDB Novo 2029", kind: "fixed_income", category: "cdb", ticker: null, quoteSymbol: null,
    benchmark: "CDI", rateE6: 1_050_000n, maturityDate: "2029-01-01", liquidity: "Diário",
    broker: "PagBank", objective: "Reserva", investor: "Ana",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.id, "cdb-novo-2029");
  assert.equal(result.value.legacyKey, "ui:cdb-novo-2029");
  assert.equal(result.value.quoteSource, null);
  const duplicado = createInstrument(db, {
    name: "CDB Novo 2029", kind: "fixed_income", category: "cdb", ticker: null, quoteSymbol: null,
    benchmark: "CDI", rateE6: 1_050_000n, maturityDate: null, liquidity: null, broker: null, objective: null, investor: null,
  });
  assert.equal(duplicado.ok, false);
  if (!duplicado.ok) assert.equal(duplicado.failure.status, 409);
});

test("createInstrument rejeita cadastro inconsistente", () => {
  const db = freshDb();
  const base = {
    name: "X", kind: "fixed_income" as const, category: "cdb" as const, ticker: null, quoteSymbol: null,
    benchmark: "CDI" as const, rateE6: 1_000_000n, maturityDate: null, liquidity: null, broker: null, objective: null, investor: null,
  };
  const semTaxa = createInstrument(db, { ...base, rateE6: null });
  assert.equal(semTaxa.ok, false);
  const categoriaErrada = createInstrument(db, { ...base, category: "etf_equity" });
  assert.equal(categoriaErrada.ok, false);
  const rvSemTicker = createInstrument(db, { ...base, kind: "equity", category: "etf_equity", benchmark: null, rateE6: null, ticker: null });
  assert.equal(rvSemTicker.ok, false);
});

test("patchInstrument não muda kind/category com transações", () => {
  const db = freshDb();
  insertInstruments(db, [cdb]);
  addTransaction(db, cdb.id, { tradeDate: "2026-09-17", kind: "BUY", grossCents: 100_000n, feesCents: 0n, quantityE8: null, note: null }, HOJE);
  const bloqueado = patchInstrument(db, cdb.id, { category: "lca" });
  assert.equal(bloqueado.ok, false);
  if (!bloqueado.ok) assert.equal(bloqueado.failure.status, 400);
  const ok = patchInstrument(db, cdb.id, { broker: "XP", investor: "Beto" });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.value.broker, "XP");
  assert.equal(patchInstrument(db, "nao-existe", { broker: "XP" }).ok, false);
});

test("removeInstrument bloqueia com transações e libera sem", () => {
  const db = freshDb();
  insertInstruments(db, [cdb]);
  addTransaction(db, cdb.id, { tradeDate: "2026-09-17", kind: "BUY", grossCents: 100_000n, feesCents: 0n, quantityE8: null, note: null }, HOJE);
  const bloqueado = removeInstrument(db, cdb.id);
  assert.equal(bloqueado.ok, false);
  if (!bloqueado.ok) assert.equal(bloqueado.failure.status, 409);
  const semUso = createInstrument(db, {
    name: "LCA Vazia", kind: "fixed_income", category: "lca", ticker: null, quoteSymbol: null,
    benchmark: "CDI", rateE6: 1_000_000n, maturityDate: null, liquidity: null, broker: null, objective: null, investor: null,
  });
  assert.equal(semUso.ok, true);
  if (semUso.ok) assert.equal(removeInstrument(db, semUso.value.id).ok, true);
});

test("addTransaction grava SELL negativo, guarda e valida", () => {
  const db = freshDb();
  insertInstruments(db, [etf, cdb]);
  writeIndexRates(db, [{ series: "CDI", date: "2026-09-17", valueE12: 1_000_000_000n }]);

  const compra = addTransaction(db, etf.id, { tradeDate: "2026-09-17", kind: "BUY", grossCents: 9_000n, feesCents: 0n, quantityE8: 10_00000000n, note: null }, HOJE);
  assert.equal(compra.ok, true);
  const venda = addTransaction(db, etf.id, { tradeDate: "2026-09-18", kind: "SELL", grossCents: 9_500n, feesCents: 0n, quantityE8: 10_00000000n, note: null }, HOJE);
  assert.equal(venda.ok, true);
  if (venda.ok) assert.equal(venda.value.quantityE8, -10_00000000n);

  const oversell = addTransaction(db, etf.id, { tradeDate: "2026-09-19", kind: "SELL", grossCents: 1_000n, feesCents: 0n, quantityE8: 1_00000000n, note: null }, HOJE);
  assert.equal(oversell.ok, false);
  if (!oversell.ok) assert.equal(oversell.failure.status, 400);

  const rfComQuantidade = addTransaction(db, cdb.id, { tradeDate: "2026-09-17", kind: "BUY", grossCents: 100_000n, feesCents: 0n, quantityE8: 1_00000000n, note: null }, HOJE);
  assert.equal(rfComQuantidade.ok, false);

  const futura = addTransaction(db, cdb.id, { tradeDate: "2026-09-23", kind: "BUY", grossCents: 100_000n, feesCents: 0n, quantityE8: null, note: null }, HOJE);
  assert.equal(futura.ok, false);

  assert.equal(addTransaction(db, "nao-existe", { tradeDate: "2026-09-17", kind: "BUY", grossCents: 1n, feesCents: 0n, quantityE8: null, note: null }, HOJE).ok, false);
});

test("editTransaction e removeTransaction respeitam a guarda", () => {
  const db = freshDb();
  insertInstruments(db, [cdb]);
  writeIndexRates(db, [{ series: "CDI", date: "2026-09-17", valueE12: 1_000_000_000n }]);
  const compra = addTransaction(db, cdb.id, { tradeDate: "2026-09-17", kind: "BUY", grossCents: 100_000n, feesCents: 0n, quantityE8: null, note: null }, HOJE);
  assert.equal(compra.ok, true);
  if (!compra.ok) return;

  const editada = editTransaction(db, compra.value.id, { grossCents: 120_000n }, HOJE);
  assert.equal(editada.ok, true);
  if (editada.ok) assert.equal(editada.value.grossCents, 120_000n);

  const resgate = addTransaction(db, cdb.id, { tradeDate: "2026-09-18", kind: "SELL", grossCents: 120_120n, feesCents: 0n, quantityE8: null, note: null }, HOJE);
  assert.equal(resgate.ok, true);
  if (!resgate.ok) return;

  const compraMenor = editTransaction(db, compra.value.id, { grossCents: 100_000n }, HOJE);
  assert.equal(compraMenor.ok, false);
  if (!compraMenor.ok) assert.equal(compraMenor.failure.status, 400);

  const semCompra = removeTransaction(db, compra.value.id);
  assert.equal(semCompra.ok, false);
  assert.equal(removeTransaction(db, resgate.value.id).ok, true);
  assert.equal(removeTransaction(db, compra.value.id).ok, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | tail -20`
Expected: falha `Cannot find module './writes.ts'`.

- [ ] **Step 3: Implement**

Criar `src/services/writes.ts`:

```ts
import type { Db } from "../db/index.ts";
import {
  countTransactions, deleteInstrument, deleteTransaction, getInstrument, getTransaction, insertInstrument,
  insertTransaction, listAllIndexRates, listTransactionsByInstrument, updateInstrument, updateTransaction,
  type InstrumentRow, type TransactionRow, type TransactionWithId,
} from "../db/repos.ts";
import { isDate, toBrDate } from "../domain/dates.ts";
import type { InstrumentCategory, InstrumentKind } from "../domain/model.ts";
import { validateChange, type GuardChange } from "../domain/write-guards.ts";
import { slugify } from "../import/catalog.ts";

export type WriteFailure = { status: 400 | 404 | 409; message: string };
export type WriteResult<T> = { ok: true; value: T } | { ok: false; failure: WriteFailure };

export type InstrumentInput = {
  name: string; kind: InstrumentKind; category: InstrumentCategory;
  ticker: string | null; quoteSymbol: string | null;
  benchmark: string | null; rateE6: bigint | null; maturityDate: string | null;
  liquidity: string | null; broker: string | null; objective: string | null; investor: string | null;
};

export type TransactionInput = {
  tradeDate: string; kind: "BUY" | "SELL"; grossCents: bigint; feesCents: bigint;
  quantityE8: bigint | null; note: string | null;
};

const INVESTORS = new Set(["Ana", "Beto"]);
const CATEGORY_KINDS: Record<InstrumentCategory, InstrumentKind> = {
  cdb: "fixed_income", lca: "fixed_income", selic: "fixed_income",
  etf_fixed: "equity", etf_equity: "equity", pension_ipca: "pension",
};

const clean = (value: string | null): string | null => {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

function validateInstrument(input: InstrumentInput): string | null {
  if (input.name.trim() === "") return "nome obrigatório";
  if (CATEGORY_KINDS[input.category] !== input.kind) return "classe e categoria não combinam";
  if (input.investor !== null && !INVESTORS.has(input.investor)) return "investidor deve ser Ana ou Beto";
  if (input.maturityDate !== null && !isDate(input.maturityDate)) return "vencimento inválido";
  if (input.kind === "fixed_income") {
    if (input.benchmark !== "CDI" && input.benchmark !== "SELIC") return "renda fixa usa CDI ou SELIC";
    if (input.rateE6 === null || input.rateE6 <= 0n) return "renda fixa exige rentabilidade positiva";
  }
  if (input.kind === "equity" && clean(input.ticker) === null) return "ticker obrigatório";
  if (input.kind === "pension" && clean(input.quoteSymbol) === null) return "código CVM obrigatório";
  return null;
}

function validateTransaction(input: TransactionInput, kind: InstrumentKind, today: string): string | null {
  if (!isDate(input.tradeDate)) return "data inválida";
  if (input.tradeDate > today) return "data não pode ser futura";
  if (input.kind !== "BUY" && input.kind !== "SELL") return "tipo deve ser Compra ou Resgate";
  if (input.grossCents <= 0n) return "valor deve ser maior que zero";
  if (input.feesCents < 0n) return "taxas não podem ser negativas";
  if (kind === "fixed_income") {
    if (input.quantityE8 !== null) return "renda fixa não usa quantidade";
  } else if (input.quantityE8 === null || input.quantityE8 <= 0n) {
    return "quantidade obrigatória";
  }
  if (input.note !== null && input.note.length > 200) return "nota deve ter até 200 caracteres";
  return null;
}

function runGuard(
  db: Db,
  instrument: Pick<InstrumentRow, "id" | "kind" | "benchmark" | "rateE6" | "maturityDate">,
  change: GuardChange,
): string | null {
  const series = instrument.benchmark === "SELIC" ? "SELIC" : instrument.benchmark === "CDI" ? "CDI" : null;
  const rates = series === null
    ? []
    : listAllIndexRates(db).filter((rate) => rate.series === series).map((rate) => ({ date: rate.date, valueE12: rate.valueE12 }));
  return validateChange({
    kind: instrument.kind, rateE6: instrument.rateE6, maturityDate: instrument.maturityDate,
    transactions: listTransactionsByInstrument(db, instrument.id), rates,
  }, change);
}

const failure = (status: 400 | 404 | 409, message: string): WriteResult<never> => ({ ok: false, failure: { status, message } });

export function createInstrument(db: Db, input: InstrumentInput): WriteResult<InstrumentRow> {
  const invalid = validateInstrument(input);
  if (invalid !== null) return failure(400, invalid);
  let id: string;
  try {
    id = slugify(input.name);
  } catch {
    return failure(400, "nome precisa ter letras ou números");
  }
  if (getInstrument(db, id) !== undefined) return failure(409, `já existe um ativo com o id ${id}; ajuste o nome`);
  insertInstrument(db, {
    id, legacyKey: `ui:${id}`, name: input.name.trim(), kind: input.kind, category: input.category,
    ticker: input.kind === "equity" ? clean(input.ticker) : null,
    quoteSource: input.kind === "equity" ? "yahoo" : input.kind === "pension" ? "cvm-swb" : null,
    quoteSymbol: input.kind === "pension" ? clean(input.quoteSymbol) : null,
    currency: "BRL",
    benchmark: input.kind === "fixed_income" ? input.benchmark : null,
    rateE6: input.kind === "fixed_income" ? input.rateE6 : null,
    maturityDate: input.kind === "fixed_income" ? input.maturityDate : null,
    liquidity: clean(input.liquidity), broker: clean(input.broker), objective: clean(input.objective),
    investor: input.investor,
  });
  const created = getInstrument(db, id);
  return created === undefined ? failure(404, "instrumento não encontrado") : { ok: true, value: created };
}

export function patchInstrument(db: Db, id: string, patch: Partial<InstrumentInput>): WriteResult<InstrumentRow> {
  const current = getInstrument(db, id);
  if (current === undefined) return failure(404, "instrumento não encontrado");
  const hasTransactions = countTransactions(db, id) > 0;
  if (hasTransactions && (patch.kind !== undefined || patch.category !== undefined)) {
    return failure(400, "não é possível mudar classe/categoria com transações");
  }
  const merged: InstrumentInput = {
    name: patch.name ?? current.name,
    kind: patch.kind ?? current.kind,
    category: patch.category ?? current.category,
    ticker: patch.ticker !== undefined ? patch.ticker : current.ticker,
    quoteSymbol: patch.quoteSymbol !== undefined ? patch.quoteSymbol : current.quoteSymbol,
    benchmark: patch.benchmark !== undefined ? patch.benchmark : current.benchmark,
    rateE6: patch.rateE6 !== undefined ? patch.rateE6 : current.rateE6,
    maturityDate: patch.maturityDate !== undefined ? patch.maturityDate : current.maturityDate,
    liquidity: patch.liquidity !== undefined ? patch.liquidity : current.liquidity,
    broker: patch.broker !== undefined ? patch.broker : current.broker,
    objective: patch.objective !== undefined ? patch.objective : current.objective,
    investor: patch.investor !== undefined ? patch.investor : current.investor,
  };
  const invalid = validateInstrument(merged);
  if (invalid !== null) return failure(400, invalid);
  const mudaRF = patch.benchmark !== undefined || patch.rateE6 !== undefined || patch.maturityDate !== undefined;
  if (hasTransactions && merged.kind === "fixed_income" && mudaRF) {
    const guardError = runGuard(db, { ...current, ...merged }, { action: "none" });
    if (guardError !== null) return failure(400, guardError);
  }
  const updated: InstrumentRow = {
    ...current, name: merged.name.trim(), kind: merged.kind, category: merged.category,
    ticker: merged.kind === "equity" ? clean(merged.ticker) : null,
    quoteSource: merged.kind === "equity" ? "yahoo" : merged.kind === "pension" ? "cvm-swb" : null,
    quoteSymbol: merged.kind === "pension" ? clean(merged.quoteSymbol) : null,
    benchmark: merged.kind === "fixed_income" ? merged.benchmark : null,
    rateE6: merged.kind === "fixed_income" ? merged.rateE6 : null,
    maturityDate: merged.kind === "fixed_income" ? merged.maturityDate : null,
    liquidity: clean(merged.liquidity), broker: clean(merged.broker), objective: clean(merged.objective),
    investor: merged.investor,
  };
  updateInstrument(db, updated);
  return { ok: true, value: updated };
}

export function removeInstrument(db: Db, id: string): WriteResult<null> {
  const current = getInstrument(db, id);
  if (current === undefined) return failure(404, "instrumento não encontrado");
  const total = countTransactions(db, id);
  if (total > 0) return failure(409, `não é possível excluir: ${total} transações lançadas`);
  deleteInstrument(db, id);
  return { ok: true, value: null };
}

function toRow(instrument: InstrumentRow, input: TransactionInput): TransactionRow {
  const quantityE8 = instrument.kind === "fixed_income"
    ? null
    : input.kind === "SELL" ? -(input.quantityE8 ?? 0n) : input.quantityE8;
  return {
    instrumentId: instrument.id, tradeDate: input.tradeDate, kind: input.kind, quantityE8,
    grossCents: input.grossCents, feesCents: input.feesCents, note: input.note, legacyRow: null,
  };
}

export function addTransaction(
  db: Db, instrumentId: string, input: TransactionInput, today = toBrDate(new Date()),
): WriteResult<TransactionWithId> {
  const instrument = getInstrument(db, instrumentId);
  if (instrument === undefined) return failure(404, "instrumento não encontrado");
  const invalid = validateTransaction(input, instrument.kind, today);
  if (invalid !== null) return failure(400, invalid);
  const row = toRow(instrument, input);
  const guardError = runGuard(db, instrument, { action: "create", transaction: row });
  if (guardError !== null) return failure(400, guardError);
  const id = insertTransaction(db, row);
  const created = getTransaction(db, id);
  return created === undefined ? failure(404, "transação não encontrada") : { ok: true, value: created };
}

export function editTransaction(
  db: Db, id: number, patch: Partial<TransactionInput>, today = toBrDate(new Date()),
): WriteResult<TransactionWithId> {
  const current = getTransaction(db, id);
  if (current === undefined) return failure(404, "transação não encontrada");
  if (current.kind !== "BUY" && current.kind !== "SELL") return failure(400, "tipo de transação não editável");
  const instrument = getInstrument(db, current.instrumentId);
  if (instrument === undefined) return failure(404, "instrumento não encontrado");
  const merged: TransactionInput = {
    tradeDate: patch.tradeDate ?? current.tradeDate,
    kind: patch.kind ?? current.kind,
    grossCents: patch.grossCents ?? current.grossCents,
    feesCents: patch.feesCents ?? current.feesCents,
    quantityE8: patch.quantityE8 !== undefined
      ? patch.quantityE8
      : current.quantityE8 === null ? null : current.quantityE8 < 0n ? -current.quantityE8 : current.quantityE8,
    note: patch.note !== undefined ? patch.note : current.note,
  };
  const invalid = validateTransaction(merged, instrument.kind, today);
  if (invalid !== null) return failure(400, invalid);
  const row = toRow(instrument, merged);
  const guardError = runGuard(db, instrument, { action: "update", transactionId: id, transaction: row });
  if (guardError !== null) return failure(400, guardError);
  updateTransaction(db, id, row);
  const updated = getTransaction(db, id);
  return updated === undefined ? failure(404, "transação não encontrada") : { ok: true, value: updated };
}

export function removeTransaction(db: Db, id: number): WriteResult<null> {
  const current = getTransaction(db, id);
  if (current === undefined) return failure(404, "transação não encontrada");
  const instrument = getInstrument(db, current.instrumentId);
  if (instrument === undefined) return failure(404, "instrumento não encontrado");
  const guardError = runGuard(db, instrument, { action: "delete", transactionId: id });
  if (guardError !== null) return failure(400, guardError);
  deleteTransaction(db, id);
  return { ok: true, value: null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test 2>&1 | tail -20 && npm run typecheck`
Expected: **192 testes** verdes (186 + 6); typecheck limpo. Se `editTransaction` falhar no caso "compra menor", conferir a conta: compra <valor> capitalizada a 0,1% = <valor>; resgate <valor> > <valor> + 1¢ → bloqueia — a edição só é barrada quando o resgate já existe, que é o caso do teste.

- [ ] **Step 5: Commit**

```bash
git add src/services/writes.ts src/services/writes.test.ts
git commit -m "feat: servico de escrita do crud"
```

---

### Task 4: Rotas — instruments expandida + transactions

**Files:**
- Modify: `src/api/routes/instruments.ts` (arquivo inteiro)
- Create: `src/api/routes/transactions.ts`
- Modify: `src/app.ts:5-24`
- Modify: `src/api/app.test.ts`
- Modify: `README.md` (tabela da API)

**Interfaces:**
- Consumes: `createInstrument`/`patchInstrument`/`removeInstrument`/`addTransaction`/`editTransaction`/`removeTransaction` (Task 3); `toApiInstrument` atual.
- Produces:
  - `POST /api/instruments` (201), `PATCH /api/instruments/:id` (200; `{investor}` continua válido), `DELETE /api/instruments/:id` (204/409)
  - `POST /api/instruments/:id/transactions` (201), `PATCH /api/transactions/:id` (200), `DELETE /api/transactions/:id` (204)
  - `GET /api/instruments/:id/transactions` com `id`
  - `toApiTransaction(transaction: TransactionWithId)` exportado de `src/api/routes/transactions.ts`

- [ ] **Step 1: Write the failing tests**

Adicionar ao fim de `src/api/app.test.ts` (o arquivo já tem `seedPortfolio`, `cdbInstrument`, `etfInstrument`):

```ts
test("CRUD de ativos pela API: cria, edita e exclui sem transações", async () => {
  const db = openDb(":memory:");
  migrate(db);
  const app = buildApp({ db, csvDir: csvDirFixture(), logger: false });

  let res = await app.inject({
    method: "POST", url: "/api/instruments",
    payload: {
      name: "CDB Teste CRUD", kind: "fixed_income", category: "cdb", benchmark: "CDI", rateE6: 1_050_000,
      maturityDate: "2030-01-01", broker: "PagBank", objective: "Reserva", investor: "Ana",
    },
  });
  assert.equal(res.statusCode, 201);
  const id = res.json().id as string;
  assert.equal(id, "cdb-teste-crud");
  assert.equal(res.json().quoteSource, null);

  res = await app.inject({ method: "PATCH", url: `/api/instruments/${id}`, payload: { broker: "XP", investor: "Beto" } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().broker, "XP");
  assert.equal(res.json().investor, "Beto");

  res = await app.inject({ method: "DELETE", url: `/api/instruments/${id}` });
  assert.equal(res.statusCode, 204);
  assert.equal((await app.inject({ method: "GET", url: "/api/instruments" })).json().length, 0);

  await app.close();
});

test("POST /api/instruments rejeita id duplicado e cadastro inconsistente", async () => {
  const db = openDb(":memory:");
  migrate(db);
  seedPortfolio(db);
  const app = buildApp({ db, csvDir: csvDirFixture(), logger: false });
  const valido = {
    name: "CDB 1", kind: "fixed_income", category: "cdb", benchmark: "CDI", rateE6: 1_050_000, ticker: null, quoteSymbol: null,
  };

  assert.equal((await app.inject({ method: "POST", url: "/api/instruments", payload: valido })).statusCode, 409);
  assert.equal((await app.inject({ method: "POST", url: "/api/instruments", payload: { ...valido, name: "Sem taxa", rateE6: null } })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: "/api/instruments", payload: { ...valido, name: "RV sem ticker", kind: "equity", category: "etf_equity", benchmark: null, rateE6: null } })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: "/api/instruments", payload: { ...valido, name: "Com extra", extra: 1 } })).statusCode, 400);
  assert.equal((await app.inject({ method: "PATCH", url: "/api/instruments/cdb-1", payload: {} })).statusCode, 400);

  await app.close();
});

test("transações pela API: cria com id, edita e exclui", async () => {
  const db = openDb(":memory:");
  migrate(db);
  seedPortfolio(db);
  const app = buildApp({ db, csvDir: csvDirFixture(), logger: false });

  let res = await app.inject({
    method: "POST", url: "/api/instruments/cdb-1/transactions",
    payload: { tradeDate: "2026-09-18", kind: "BUY", grossCents: 50_000, feesCents: 0 },
  });
  assert.equal(res.statusCode, 201);
  const transactionId = res.json().id as number;
  assert.ok(transactionId > 0);
  assert.equal(res.json().quantityE8, null);

  res = await app.inject({ method: "GET", url: "/api/instruments/cdb-1/transactions" });
  assert.ok((res.json() as Array<{ id: number }>).every((transaction) => typeof transaction.id === "number"));

  res = await app.inject({ method: "PATCH", url: `/api/transactions/${transactionId}`, payload: { grossCents: 60_000, note: "ajuste" } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().grossCents, 60_000);
  assert.equal(res.json().note, "ajuste");

  res = await app.inject({ method: "DELETE", url: `/api/transactions/${transactionId}` });
  assert.equal(res.statusCode, 204);
  assert.equal((await app.inject({ method: "PATCH", url: `/api/transactions/${transactionId}`, payload: { grossCents: 1 } })).statusCode, 404);

  await app.close();
});

test("guarda de escrita: resgate acima do saldo e venda acima das cotas respondem 400", async () => {
  const db = openDb(":memory:");
  migrate(db);
  seedPortfolio(db);
  const app = buildApp({ db, csvDir: csvDirFixture(), logger: false });

  let res = await app.inject({
    method: "POST", url: "/api/instruments/cdb-1/transactions",
    payload: { tradeDate: "2026-09-18", kind: "SELL", grossCents: 99_999_999 },
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /maior que o saldo/);

  res = await app.inject({
    method: "POST", url: "/api/instruments/etf-1/transactions",
    payload: { tradeDate: "2026-09-18", kind: "SELL", grossCents: 1_000, quantityE8: 11_00000000 },
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /negativa/);

  res = await app.inject({
    method: "POST", url: "/api/instruments/etf-1/transactions",
    payload: { tradeDate: "2099-01-01", kind: "BUY", grossCents: 1_000, quantityE8: 1_00000000 },
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /futura/);

  await app.close();
});

test("classe/categoria travadas e exclusão de ativo com transações", async () => {
  const db = openDb(":memory:");
  migrate(db);
  seedPortfolio(db);
  const app = buildApp({ db, csvDir: csvDirFixture(), logger: false });

  const patch = await app.inject({ method: "PATCH", url: "/api/instruments/cdb-1", payload: { category: "lca" } });
  assert.equal(patch.statusCode, 400);
  assert.match(patch.json().error, /classe\/categoria/);

  const exclusao = await app.inject({ method: "DELETE", url: "/api/instruments/cdb-1" });
  assert.equal(exclusao.statusCode, 409);
  assert.match(exclusao.json().error, /transações/);

  assert.equal((await app.inject({ method: "DELETE", url: "/api/instruments/nao-existe" })).statusCode, 404);
  assert.equal((await app.inject({ method: "PATCH", url: "/api/transactions/999", payload: { grossCents: 1 } })).statusCode, 404);

  await app.close();
});
```

Atenção: `seedPortfolio` grava a taxa CDI de 0,1% em 2026-09-17 e uma Compra de <valor> em 2026-09-17 → saldo <valor> em 2026-09-18 (a taxa de 09-17 capitaliza uma vez).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | tail -30`
Expected: falhas de 404/405 nas rotas novas; demais verdes.

- [ ] **Step 3: Implement**

3a. Reescrever `src/api/routes/instruments.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/index.ts";
import type { InstrumentRow } from "../../db/repos.ts";
import { listInstruments, listTransactionsByInstrument } from "../../db/repos.ts";
import type { InstrumentCategory, InstrumentKind } from "../../domain/model.ts";
import { toNumberSafe } from "../../domain/money.ts";
import { createInstrument, patchInstrument, removeInstrument, type InstrumentInput } from "../../services/writes.ts";
import { toApiTransaction } from "./transactions.ts";

const KINDS: InstrumentKind[] = ["fixed_income", "equity", "pension"];
const CATEGORIES: InstrumentCategory[] = ["cdb", "lca", "selic", "etf_fixed", "etf_equity", "pension_ipca"];
const TEXT_KEYS = ["ticker", "quoteSymbol", "benchmark", "maturityDate", "liquidity", "broker", "objective", "investor"] as const;
const KEYS: string[] = ["name", "kind", "category", "rateE6", ...TEXT_KEYS];

type Body = Record<string, unknown>;

const isRecord = (value: unknown): value is Body => value !== null && typeof value === "object" && !Array.isArray(value);

function toApiInstrument(instrument: InstrumentRow) {
  return {
    id: instrument.id, name: instrument.name, kind: instrument.kind, category: instrument.category,
    ticker: instrument.ticker, quoteSource: instrument.quoteSource, quoteSymbol: instrument.quoteSymbol,
    currency: instrument.currency, benchmark: instrument.benchmark,
    rateE6: instrument.rateE6 === null ? null : toNumberSafe(instrument.rateE6),
    maturityDate: instrument.maturityDate, liquidity: instrument.liquidity,
    broker: instrument.broker, objective: instrument.objective, investor: instrument.investor,
  };
}

function parseBody(body: Body, partial: boolean): { ok: true; patch: Partial<InstrumentInput> } | { ok: false; error: string } {
  const unknown = Object.keys(body).filter((key) => !KEYS.includes(key));
  if (unknown.length > 0) return { ok: false, error: `campo desconhecido: ${unknown[0]}` };
  if (partial && Object.keys(body).length === 0) return { ok: false, error: "nada para atualizar" };
  const patch: Partial<InstrumentInput> = {};
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.trim() === "") return { ok: false, error: "nome inválido" };
    patch.name = body.name;
  }
  if (body.kind !== undefined) {
    if (typeof body.kind !== "string" || !KINDS.includes(body.kind as InstrumentKind)) return { ok: false, error: "classe inválida" };
    patch.kind = body.kind as InstrumentKind;
  }
  if (body.category !== undefined) {
    if (typeof body.category !== "string" || !CATEGORIES.includes(body.category as InstrumentCategory)) return { ok: false, error: "categoria inválida" };
    patch.category = body.category as InstrumentCategory;
  }
  for (const key of TEXT_KEYS) {
    if (body[key] === undefined) continue;
    const value = body[key];
    if (value === null) { patch[key] = null; continue; }
    if (typeof value !== "string") return { ok: false, error: `${key} inválido` };
    patch[key] = value.trim() === "" ? null : value;
  }
  if (body.rateE6 !== undefined) {
    if (body.rateE6 === null) { patch.rateE6 = null; }
    else if (typeof body.rateE6 === "number" && Number.isSafeInteger(body.rateE6)) { patch.rateE6 = BigInt(body.rateE6); }
    else return { ok: false, error: "rentabilidade inválida" };
  }
  if (partial) return { ok: true, patch };
  for (const required of ["name", "kind", "category"] as const) {
    if (patch[required] === undefined) return { ok: false, error: `${required} obrigatório` };
  }
  const defaults: Partial<InstrumentInput> = {
    ticker: null, quoteSymbol: null, benchmark: null, rateE6: null, maturityDate: null,
    liquidity: null, broker: null, objective: null, investor: null,
  };
  return { ok: true, patch: { ...defaults, ...patch } };
}

export function registerInstrumentsRoutes(app: FastifyInstance, db: Db): void {
  app.get("/api/instruments", () => listInstruments(db).map(toApiInstrument));

  app.post<{ Body: unknown }>("/api/instruments", (request, reply) => {
    if (!isRecord(request.body)) return reply.code(400).send({ error: "corpo deve ser um objeto" });
    const parsed = parseBody(request.body, false);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    const result = createInstrument(db, parsed.patch as InstrumentInput);
    if (!result.ok) return reply.code(result.failure.status).send({ error: result.failure.message });
    return reply.code(201).send(toApiInstrument(result.value));
  });

  app.patch<{ Params: { id: string }; Body: unknown }>("/api/instruments/:id", (request, reply) => {
    if (!isRecord(request.body)) return reply.code(400).send({ error: "corpo deve ser um objeto" });
    const parsed = parseBody(request.body, true);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    const result = patchInstrument(db, request.params.id, parsed.patch);
    if (!result.ok) return reply.code(result.failure.status).send({ error: result.failure.message });
    return toApiInstrument(result.value);
  });

  app.delete<{ Params: { id: string } }>("/api/instruments/:id", (request, reply) => {
    const result = removeInstrument(db, request.params.id);
    if (!result.ok) return reply.code(result.failure.status).send({ error: result.failure.message });
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string } }>("/api/instruments/:id/transactions", (request) =>
    listTransactionsByInstrument(db, request.params.id).map(toApiTransaction));
}
```

3b. Criar `src/api/routes/transactions.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/index.ts";
import { toNumberSafe } from "../../domain/money.ts";
import type { TransactionWithId } from "../../db/repos.ts";
import { addTransaction, editTransaction, removeTransaction, type TransactionInput } from "../../services/writes.ts";

const KEYS = ["tradeDate", "kind", "grossCents", "feesCents", "quantityE8", "note"];
const CENTS_KEYS = ["grossCents", "feesCents"] as const;

type Body = Record<string, unknown>;

const isRecord = (value: unknown): value is Body => value !== null && typeof value === "object" && !Array.isArray(value);

export function toApiTransaction(transaction: TransactionWithId) {
  return {
    id: transaction.id, tradeDate: transaction.tradeDate, kind: transaction.kind,
    quantityE8: transaction.quantityE8 === null ? null : toNumberSafe(transaction.quantityE8),
    grossCents: toNumberSafe(transaction.grossCents), feesCents: toNumberSafe(transaction.feesCents),
    note: transaction.note, legacyRow: transaction.legacyRow,
  };
}

function parseBody(body: Body, partial: boolean): { ok: true; patch: Partial<TransactionInput> } | { ok: false; error: string } {
  const unknown = Object.keys(body).filter((key) => !KEYS.includes(key));
  if (unknown.length > 0) return { ok: false, error: `campo desconhecido: ${unknown[0]}` };
  if (partial && Object.keys(body).length === 0) return { ok: false, error: "nada para atualizar" };
  const patch: Partial<TransactionInput> = {};
  if (body.tradeDate !== undefined) {
    if (typeof body.tradeDate !== "string") return { ok: false, error: "data inválida" };
    patch.tradeDate = body.tradeDate;
  }
  if (body.kind !== undefined) {
    if (body.kind !== "BUY" && body.kind !== "SELL") return { ok: false, error: "tipo deve ser Compra ou Resgate" };
    patch.kind = body.kind;
  }
  for (const key of CENTS_KEYS) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== "number" || !Number.isSafeInteger(body[key])) return { ok: false, error: `${key} deve ser inteiro em centavos` };
    patch[key] = BigInt(body[key]);
  }
  if (body.quantityE8 !== undefined) {
    if (body.quantityE8 === null) { patch.quantityE8 = null; }
    else if (typeof body.quantityE8 === "number" && Number.isSafeInteger(body.quantityE8)) { patch.quantityE8 = BigInt(body.quantityE8); }
    else return { ok: false, error: "quantidade deve ser inteiro escalonado (8 casas)" };
  }
  if (body.note !== undefined) {
    if (body.note === null) { patch.note = null; }
    else if (typeof body.note === "string") { patch.note = body.note.trim() === "" ? null : body.note.trim(); }
    else return { ok: false, error: "nota inválida" };
  }
  if (partial) return { ok: true, patch };
  for (const required of ["tradeDate", "kind", "grossCents"] as const) {
    if (patch[required] === undefined) return { ok: false, error: `${required} obrigatório` };
  }
  return { ok: true, patch: { feesCents: 0n, quantityE8: null, note: null, ...patch } };
}

export function registerTransactionsRoutes(app: FastifyInstance, db: Db): void {
  app.post<{ Params: { id: string }; Body: unknown }>("/api/instruments/:id/transactions", (request, reply) => {
    if (!isRecord(request.body)) return reply.code(400).send({ error: "corpo deve ser um objeto" });
    const parsed = parseBody(request.body, false);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    const result = addTransaction(db, request.params.id, parsed.patch as TransactionInput);
    if (!result.ok) return reply.code(result.failure.status).send({ error: result.failure.message });
    return reply.code(201).send(toApiTransaction(result.value));
  });

  app.patch<{ Params: { id: string }; Body: unknown }>("/api/transactions/:id", (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return reply.code(404).send({ error: "transação não encontrada" });
    if (!isRecord(request.body)) return reply.code(400).send({ error: "corpo deve ser um objeto" });
    const parsed = parseBody(request.body, true);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    const result = editTransaction(db, id, parsed.patch);
    if (!result.ok) return reply.code(result.failure.status).send({ error: result.failure.message });
    return toApiTransaction(result.value);
  });

  app.delete<{ Params: { id: string } }>("/api/transactions/:id", (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return reply.code(404).send({ error: "transação não encontrada" });
    const result = removeTransaction(db, id);
    if (!result.ok) return reply.code(result.failure.status).send({ error: result.failure.message });
    return reply.code(204).send();
  });
}
```

3c. Em `src/app.ts`, importar e registrar:

```ts
import { registerTransactionsRoutes } from "./api/routes/transactions.ts";
```

e, dentro de `buildApp`, depois de `registerInstrumentsRoutes(app, options.db);`:

```ts
  registerTransactionsRoutes(app, options.db);
```

3d. Em `README.md`, na tabela "API (v1)", depois da linha de `GET /api/instruments/:id/transactions`:

```md
| `POST /api/instruments` | cria ativo (corpo com o cadastro; `id` gerado do nome) |
| `PATCH /api/instruments/:id` | edita cadastro (classe/categoria só sem transações) |
| `DELETE /api/instruments/:id` | exclui ativo sem transações |
| `POST /api/instruments/:id/transactions` | cria Compra/Resgate (`kind: BUY\|SELL`; quantidade em RV/previdência) |
| `PATCH /api/transactions/:id` · `DELETE /api/transactions/:id` | edita/exclui transação (guarda impede posição negativa) |
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test 2>&1 | tail -20 && npm run typecheck`
Expected: **197 testes** verdes (192 + 5); typecheck limpo.

- [ ] **Step 5: Commit**

```bash
git add src/api/routes/instruments.ts src/api/routes/transactions.ts src/app.ts src/api/app.test.ts README.md
git commit -m "feat: rotas de crud de ativos e transacoes"
```

---

### Task 5: CLI do import com `--replace`

**Files:**
- Create: `src/import/replace-guard.ts`
- Test: `src/import/replace-guard.test.ts`
- Modify: `src/import/cli.ts`
- Modify: `README.md` (seção Dev)

**Interfaces:**
- Consumes: `counts` (`src/db/repos.ts:152`).
- Produces: `replaceGuardError(argv: string[], counts: { transactions: number }): string | null` — erro em pt-BR ou `null` quando pode importar.

- [ ] **Step 1: Write the failing test**

Criar `src/import/replace-guard.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { replaceGuardError } from "./replace-guard.ts";

test("sem --replace e com transações: bloqueia", () => {
  const erro = replaceGuardError([], { transactions: 119 });
  assert.match(erro ?? "", /--replace/);
  assert.match(erro ?? "", /119/);
});

test("com --replace: libera", () => {
  assert.equal(replaceGuardError(["--replace"], { transactions: 119 }), null);
});

test("banco sem transações: libera sem flag", () => {
  assert.equal(replaceGuardError([], { transactions: 0 }), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | tail -20`
Expected: falha `Cannot find module './replace-guard.ts'`.

- [ ] **Step 3: Implement**

Criar `src/import/replace-guard.ts`:

```ts
/** Import substitui TODOS os dados; sem --replace, aborta quando já há transações. */
export function replaceGuardError(argv: string[], counts: { transactions: number }): string | null {
  if (counts.transactions === 0 || argv.includes("--replace")) return null;
  return `o banco já tem ${counts.transactions} transações; use --replace para substituir (as edições feitas na UI serão perdidas)`;
}
```

Em `src/import/cli.ts`, acrescentar os imports `counts` e `replaceGuardError`, e logo depois de `const applied = migrate(db);`:

```ts
const guard = replaceGuardError(process.argv.slice(2), counts(db));
if (guard !== null) {
  console.error(`erro: ${guard}`);
  db.close();
  process.exit(1);
}
```

Em `README.md`, na seção Dev, trocar a linha do import:

```md
    npm run import                  # lê data/csv e popula data/investments.db (1ª vez)
    npm run import -- --replace     # substitui TODOS os dados (apaga edições feitas na UI)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test 2>&1 | tail -20 && npm run typecheck`
Expected: **200 testes** verdes (197 + 3); typecheck limpo.

- [ ] **Step 5: Commit**

```bash
git add src/import/replace-guard.ts src/import/replace-guard.test.ts src/import/cli.ts README.md
git commit -m "feat: import exige --replace quando ha transacoes"
```

---

### Task 6: Web — client da API e formulários

**Files:**
- Modify: `web/src/api.ts`
- Modify: `web/src/format.ts`
- Create: `web/src/components/FormTransacao.tsx`
- Create: `web/src/components/FormAtivo.tsx`

**Interfaces:**
- Consumes: rotas da Task 4.
- Produces (usados pela Task 7):
  - `api.ts`: `Transaction` com `id: number`; `type Instrument`; `type InstrumentPayload`; `type TransactionPayload`; `getInstruments`, `postInstrument`, `patchInstrument`, `deleteInstrument`, `postTransaction`, `patchTransaction`, `deleteTransaction`
  - `format.ts`: `parseMoedaParaCents(texto: string): number | null` (0 permitido), `parsePercentualParaE6(texto: string): number | null`, `parseQuantidadeE8(texto: string): number | null`
  - Componentes: `FormTransacao({ aberto, posicao, transacao, onFechar, onSalvo })`; `FormAtivo({ aberto, instrumento, qtdTransacoes, onFechar, onSalvo })`

- [ ] **Step 1: Client da API**

Em `web/src/api.ts`:

1. Remover `ImportSummary`, `ImportPayload` e `postImport` (linhas 1-10, 23-29 e 38-52) — a seção Importar sai da UI na Task 7.
2. Trocar `Transaction` (linha ~128) por:

```ts
export type Transaction = {
  id: number; tradeDate: string; kind: string; quantityE8: number | null;
  grossCents: number; feesCents: number; note: string | null; legacyRow: number | null;
};
```

3. Depois de `getTransactions` (linha ~156), acrescentar:

```ts
export type Instrument = {
  id: string; name: string; kind: "fixed_income" | "equity" | "pension"; category: string;
  ticker: string | null; quoteSource: string | null; quoteSymbol: string | null; currency: string;
  benchmark: string | null; rateE6: number | null; maturityDate: string | null;
  liquidity: string | null; broker: string | null; objective: string | null; investor: string | null;
};

export type InstrumentPayload = {
  name: string; kind: Instrument["kind"]; category: string;
  ticker?: string | null; quoteSymbol?: string | null; benchmark?: string | null; rateE6?: number | null;
  maturityDate?: string | null; liquidity?: string | null; broker?: string | null;
  objective?: string | null; investor?: string | null;
};

export type TransactionPayload = {
  tradeDate: string; kind: "BUY" | "SELL"; grossCents: number; feesCents?: number;
  quantityE8?: number | null; note?: string | null;
};

async function sendJson<T>(url: string, method: "POST" | "PATCH", payload: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(await apiErrorMessage(response, body));
  }
  return (await response.json()) as T;
}

async function sendDelete(url: string): Promise<void> {
  const response = await fetch(url, { method: "DELETE" });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(await apiErrorMessage(response, body));
  }
}

export const getInstruments = (signal?: AbortSignal): Promise<Instrument[]> => getJson("/api/instruments", signal);
export const postInstrument = (payload: InstrumentPayload): Promise<Instrument> => sendJson("/api/instruments", "POST", payload);
export const patchInstrument = (id: string, payload: Partial<InstrumentPayload>): Promise<Instrument> =>
  sendJson(`/api/instruments/${encodeURIComponent(id)}`, "PATCH", payload);
export const deleteInstrument = (id: string): Promise<void> => sendDelete(`/api/instruments/${encodeURIComponent(id)}`);
export const postTransaction = (instrumentId: string, payload: TransactionPayload): Promise<Transaction> =>
  sendJson(`/api/instruments/${encodeURIComponent(instrumentId)}/transactions`, "POST", payload);
export const patchTransaction = (id: number, payload: Partial<TransactionPayload>): Promise<Transaction> =>
  sendJson(`/api/transactions/${id}`, "PATCH", payload);
export const deleteTransaction = (id: number): Promise<void> => sendDelete(`/api/transactions/${id}`);
```

4. Remover `patchInvestor` (linhas ~160-170) — o editor de investidor é substituído pelo formulário de cadastro. Manter `export type Investor`.

- [ ] **Step 2: Parsers de entrada**

Em `web/src/format.ts`, no fim:

```ts
/** "<valor>" | "1234,5" | "1234" → centavos; aceita 0; null se inválido. */
export function parseMoedaParaCents(texto: string): number | null {
  const limpo = texto.trim().replace(/R\$/g, "").replace(/\s+/g, "");
  const match = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(limpo);
  if (match === null) return null;
  const inteiro = (match[1] ?? "0").replace(/\./g, "");
  const centavos = ((match[2] ?? "") + "00").slice(0, 2);
  const cents = Number(BigInt(inteiro) * 100n + BigInt(centavos));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** "105" | "105,5" → <valor> (escala e6); null se inválido ou ≤ 0. */
export function parsePercentualParaE6(texto: string): number | null {
  const limpo = texto.trim().replace("%", "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(limpo)) return null;
  const [inteiro = "0", fracao = ""] = limpo.split(".");
  const e6 = Number(BigInt(inteiro) * 1_000_000n + BigInt((fracao + "00").slice(0, 2)) * 10_000n);
  return Number.isSafeInteger(e6) && e6 > 0 ? e6 : null;
}

/** "10,5" → <valor> (escala e8); null se inválido ou ≤ 0. */
export function parseQuantidadeE8(texto: string): number | null {
  const limpo = texto.trim().replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,8})?$/.test(limpo)) return null;
  const [inteiro = "0", fracao = ""] = limpo.split(".");
  const e8 = Number(BigInt(inteiro) * 100_000_000n + BigInt((fracao + "<valor>").slice(0, 8)));
  return Number.isSafeInteger(e8) && e8 > 0 ? e8 : null;
}
```

- [ ] **Step 3: `FormTransacao.tsx`**

Criar `web/src/components/FormTransacao.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Trash } from "@phosphor-icons/react";
import { deleteTransaction, patchTransaction, postTransaction, type PortfolioPosition, type Transaction } from "../api.ts";
import { parseMoedaParaCents, parseQuantidadeE8 } from "../format.ts";
import { Modal } from "./Modal.tsx";

function paraTextoBRL(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function FormTransacao({ aberto, posicao, transacao, onFechar, onSalvo }: {
  aberto: boolean;
  posicao: PortfolioPosition;
  transacao: Transaction | null;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const ehRF = posicao.kind === "fixed_income";
  const [data, setData] = useState("");
  const [tipo, setTipo] = useState<"BUY" | "SELL">("BUY");
  const [valor, setValor] = useState("");
  const [taxas, setTaxas] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [nota, setNota] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    setErro(null);
    setConfirmandoExclusao(false);
    setData(transacao?.tradeDate ?? hoje);
    setTipo(transacao?.kind === "SELL" ? "SELL" : "BUY");
    setValor(transacao === null ? "" : paraTextoBRL(transacao.grossCents));
    setTaxas(transacao === null || transacao.feesCents === 0 ? "" : paraTextoBRL(transacao.feesCents));
    setQuantidade(transacao?.quantityE8 == null ? "" : (Math.abs(transacao.quantityE8) / 1e8).toString().replace(".", ","));
    setNota(transacao?.note ?? "");
  }, [aberto, transacao]);

  async function salvar() {
    const grossCents = parseMoedaParaCents(valor);
    if (data === "") return setErro("informe a data");
    if (grossCents === null || grossCents === 0) return setErro("valor inválido");
    const feesCents = taxas.trim() === "" ? 0 : parseMoedaParaCents(taxas);
    if (feesCents === null) return setErro("taxas inválidas");
    const quantityE8 = ehRF ? null : parseQuantidadeE8(quantidade);
    if (!ehRF && quantityE8 === null) return setErro("quantidade inválida");
    setSalvando(true);
    setErro(null);
    try {
      const payload = { tradeDate: data, kind: tipo, grossCents, feesCents, quantityE8, note: nota.trim() === "" ? null : nota.trim() };
      if (transacao === null) await postTransaction(posicao.instrumentId, payload);
      else await patchTransaction(transacao.id, payload);
      onSalvo();
    } catch (cause) {
      setErro(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSalvando(false);
    }
  }

  async function excluir() {
    if (transacao === null) return;
    setSalvando(true);
    setErro(null);
    try {
      await deleteTransaction(transacao.id);
      onSalvo();
    } catch (cause) {
      setErro(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal aberto={aberto} titulo={transacao === null ? `Nova transação — ${posicao.name}` : `Editar transação — ${posicao.name}`} onFechar={onFechar}>
      <div className="form-grade">
        <label className="campo">
          <span className="stat-label">Data</span>
          <input type="date" value={data} onChange={(evento) => setData(evento.target.value)} />
        </label>
        <label className="campo">
          <span className="stat-label">Tipo</span>
          <select value={tipo} onChange={(evento) => setTipo(evento.target.value as "BUY" | "SELL")}>
            <option value="BUY">Compra</option>
            <option value="SELL">Resgate</option>
          </select>
        </label>
        <label className="campo">
          <span className="stat-label">Valor (R$)</span>
          <input inputMode="decimal" value={valor} onChange={(evento) => setValor(evento.target.value)} placeholder="<valor>" />
        </label>
        <label className="campo">
          <span className="stat-label">Taxas (R$)</span>
          <input inputMode="decimal" value={taxas} onChange={(evento) => setTaxas(evento.target.value)} placeholder="0,00" />
        </label>
        {!ehRF && (
          <label className="campo">
            <span className="stat-label">Quantidade</span>
            <input inputMode="decimal" value={quantidade} onChange={(evento) => setQuantidade(evento.target.value)} placeholder="10,5" />
          </label>
        )}
        <label className="campo campo-largo">
          <span className="stat-label">Nota</span>
          <input value={nota} maxLength={200} onChange={(evento) => setNota(evento.target.value)} placeholder="opcional" />
        </label>
      </div>
      {erro !== null && <p className="campo-erro" role="alert">{erro}</p>}
      <div className="form-acoes">
        {transacao !== null && (
          confirmandoExclusao ? (
            <>
              <button type="button" className="btn btn-danger" disabled={salvando} onClick={() => void excluir()}>Confirmar exclusão</button>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmandoExclusao(false)}>Cancelar</button>
            </>
          ) : (
            <button type="button" className="btn btn-secondary" onClick={() => setConfirmandoExclusao(true)}>
              <Trash size={15} aria-hidden="true" /> Excluir
            </button>
          )
        )}
        <button type="button" className="btn" disabled={salvando} onClick={() => void salvar()}>
          {salvando ? "Salvando..." : "Salvar"}
        </button>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 4: `FormAtivo.tsx`**

Criar `web/src/components/FormAtivo.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Trash } from "@phosphor-icons/react";
import {
  deleteInstrument, patchInstrument, postInstrument,
  type Instrument, type InstrumentPayload,
} from "../api.ts";
import { parsePercentualParaE6 } from "../format.ts";
import { Modal } from "./Modal.tsx";

const MODELOS: Array<{ id: string; rotulo: string; kind: Instrument["kind"]; category: string; benchmark: string | null }> = [
  { id: "rf", rotulo: "Renda fixa", kind: "fixed_income", category: "cdb", benchmark: "CDI" },
  { id: "etf-rf", rotulo: "ETF Renda Fixa", kind: "equity", category: "etf_fixed", benchmark: null },
  { id: "etf-rv", rotulo: "ETF Renda Variável", kind: "equity", category: "etf_equity", benchmark: null },
  { id: "pgbl", rotulo: "Previdência PGBL", kind: "pension", category: "pension_ipca", benchmark: null },
];

const CATEGORIAS_RF: Record<string, string> = { cdb: "CDB", lca: "LCA", selic: "Selic" };

export function FormAtivo({ aberto, instrumento, qtdTransacoes, onFechar, onSalvo }: {
  aberto: boolean;
  instrumento: Instrument | null;
  qtdTransacoes: number;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const temTransacoes = qtdTransacoes > 0;
  const [modelo, setModelo] = useState("rf");
  const [categoria, setCategoria] = useState("cdb");
  const [nome, setNome] = useState("");
  const [ticker, setTicker] = useState("");
  const [codigoCvm, setCodigoCvm] = useState("");
  const [benchmark, setBenchmark] = useState("CDI");
  const [rentabilidade, setRentabilidade] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [liquidez, setLiquidez] = useState("");
  const [corretora, setCorretora] = useState("");
  const [objetivo, setObjetivo] = useState("");
  const [investidor, setInvestidor] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setErro(null);
    setConfirmandoExclusao(false);
    if (instrumento === null) {
      setModelo("rf"); setCategoria("cdb"); setNome(""); setTicker(""); setCodigoCvm("");
      setBenchmark("CDI"); setRentabilidade(""); setVencimento(""); setLiquidez("");
      setCorretora(""); setObjetivo(""); setInvestidor("");
      return;
    }
    const modeloAtual = instrumento.kind === "fixed_income" ? "rf"
      : instrumento.kind === "pension" ? "pgbl"
        : instrumento.category === "etf_fixed" ? "etf-rf" : "etf-rv";
    setModelo(modeloAtual);
    setCategoria(instrumento.category);
    setNome(instrumento.name);
    setTicker(instrumento.ticker ?? "");
    setCodigoCvm(instrumento.quoteSymbol ?? "");
    setBenchmark(instrumento.benchmark ?? "CDI");
    setRentabilidade(instrumento.rateE6 === null ? "" : (instrumento.rateE6 / 10_000).toString().replace(".", ","));
    setVencimento(instrumento.maturityDate ?? "");
    setLiquidez(instrumento.liquidity ?? "");
    setCorretora(instrumento.broker ?? "");
    setObjetivo(instrumento.objective ?? "");
    setInvestidor(instrumento.investor ?? "");
  }, [aberto, instrumento]);

  const definicao = MODELOS.find((item) => item.id === modelo) ?? MODELOS[0];
  const ehRF = definicao.kind === "fixed_income";

  async function salvar() {
    const payload: InstrumentPayload = {
      name: nome.trim(),
      kind: definicao.kind,
      category: ehRF ? categoria : definicao.category,
      benchmark: null, rateE6: null, maturityDate: null, ticker: null, quoteSymbol: null,
      liquidity: liquidez.trim() === "" ? null : liquidez.trim(),
      broker: corretora.trim() === "" ? null : corretora.trim(),
      objective: objetivo.trim() === "" ? null : objetivo.trim(),
      investor: investidor === "" ? null : investidor,
    };
    if (payload.name === "") return setErro("informe o nome");
    if (ehRF) {
      const rateE6 = parsePercentualParaE6(rentabilidade);
      if (rateE6 === null) return setErro("rentabilidade inválida (ex.: 105 ou 105,5)");
      payload.benchmark = benchmark;
      payload.rateE6 = rateE6;
      payload.maturityDate = vencimento === "" ? null : vencimento;
    } else if (definicao.kind === "equity") {
      if (ticker.trim() === "") return setErro("informe o ticker");
      payload.ticker = ticker.trim().toUpperCase();
    } else {
      if (codigoCvm.trim() === "") return setErro("informe o código CVM");
      payload.quoteSymbol = codigoCvm.trim();
    }
    setSalvando(true);
    setErro(null);
    try {
      if (instrumento === null) await postInstrument(payload);
      else await patchInstrument(instrumento.id, payload);
      onSalvo();
    } catch (cause) {
      setErro(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSalvando(false);
    }
  }

  async function excluir() {
    if (instrumento === null) return;
    setSalvando(true);
    setErro(null);
    try {
      await deleteInstrument(instrumento.id);
      onSalvo();
    } catch (cause) {
      setErro(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal aberto={aberto} titulo={instrumento === null ? "Novo ativo" : `Editar cadastro — ${instrumento.name}`} onFechar={onFechar}>
      <div className="form-grade">
        <label className="campo">
          <span className="stat-label">Modelo</span>
          <select value={modelo} onChange={(evento) => setModelo(evento.target.value)} disabled={temTransacoes}>
            {MODELOS.map((item) => <option key={item.id} value={item.id}>{item.rotulo}</option>)}
          </select>
        </label>
        {ehRF && (
          <label className="campo">
            <span className="stat-label">Categoria</span>
            <select value={categoria} onChange={(evento) => setCategoria(evento.target.value)} disabled={temTransacoes}>
              {Object.entries(CATEGORIAS_RF).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
            </select>
          </label>
        )}
        <label className="campo campo-largo">
          <span className="stat-label">Nome</span>
          <input value={nome} onChange={(evento) => setNome(evento.target.value)} placeholder="CDB Banco X 2029" />
        </label>
        {definicao.kind === "equity" && (
          <label className="campo">
            <span className="stat-label">Ticker</span>
            <input value={ticker} onChange={(evento) => setTicker(evento.target.value)} placeholder="WRLD11" />
          </label>
        )}
        {definicao.kind === "pension" && (
          <label className="campo">
            <span className="stat-label">Código CVM</span>
            <input value={codigoCvm} onChange={(evento) => setCodigoCvm(evento.target.value)} placeholder="<valor>" />
          </label>
        )}
        {ehRF && (
          <>
            <label className="campo">
              <span className="stat-label">Índice</span>
              <select value={benchmark} onChange={(evento) => setBenchmark(evento.target.value)}>
                <option value="CDI">CDI</option>
                <option value="SELIC">Selic</option>
              </select>
            </label>
            <label className="campo">
              <span className="stat-label">Rentabilidade (%)</span>
              <input inputMode="decimal" value={rentabilidade} onChange={(evento) => setRentabilidade(evento.target.value)} placeholder="105" />
            </label>
            <label className="campo">
              <span className="stat-label">Vencimento</span>
              <input type="date" value={vencimento} onChange={(evento) => setVencimento(evento.target.value)} />
            </label>
          </>
        )}
        <label className="campo"><span className="stat-label">Liquidez</span><input value={liquidez} onChange={(evento) => setLiquidez(evento.target.value)} placeholder="Diário" /></label>
        <label className="campo"><span className="stat-label">Corretora</span><input value={corretora} onChange={(evento) => setCorretora(evento.target.value)} /></label>
        <label className="campo"><span className="stat-label">Objetivo</span><input value={objetivo} onChange={(evento) => setObjetivo(evento.target.value)} /></label>
        <label className="campo">
          <span className="stat-label">Investidor</span>
          <select value={investidor} onChange={(evento) => setInvestidor(evento.target.value)}>
            <option value="">—</option>
            <option value="Ana">Ana</option>
            <option value="Beto">Beto</option>
          </select>
        </label>
      </div>
      {temTransacoes && (
        <span className="stat-note">
          Classe/categoria travadas e exclusão indisponível: o ativo já tem {qtdTransacoes} transações.
        </span>
      )}
      {erro !== null && <p className="campo-erro" role="alert">{erro}</p>}
      <div className="form-acoes">
        {instrumento !== null && (
          confirmandoExclusao ? (
            <>
              <button type="button" className="btn btn-danger" disabled={salvando || temTransacoes} onClick={() => void excluir()}>Confirmar exclusão</button>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmandoExclusao(false)}>Cancelar</button>
            </>
          ) : (
            <button type="button" className="btn btn-secondary" disabled={temTransacoes} title={temTransacoes ? `${qtdTransacoes} transações lançadas` : undefined} onClick={() => setConfirmandoExclusao(true)}>
              <Trash size={15} aria-hidden="true" /> Excluir ativo
            </button>
          )
        )}
        <button type="button" className="btn" disabled={salvando} onClick={() => void salvar()}>
          {salvando ? "Salvando..." : "Salvar"}
        </button>
      </div>
    </Modal>
  );
}
```

Nota: `parseMoedaParaCents` é usado só pelo `FormTransacao`; se o typecheck acusar import não usado em `FormAtivo`, remover do import de `format.ts`.

- [ ] **Step 5: Typecheck + build**

Run: `npm run typecheck && npm run build:web`
Expected: limpo e build ok (o build ainda não usa os componentes — a Task 7 pendura).

- [ ] **Step 6: Commit**

```bash
git add web/src/api.ts web/src/format.ts web/src/components/FormTransacao.tsx web/src/components/FormAtivo.tsx
git commit -m "feat: formularios de transacao e ativo no web"
```

---

### Task 7: Web — painel, shell e Fontes

**Files:**
- Modify: `web/src/views/PositionsView.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/views/SourcesView.tsx`
- Delete: `web/src/views/ImportView.tsx`
- Modify: `web/src/styles.css`

**Interfaces:**
- Consumes: componentes e client da Task 6; `GET /api/import/runs` (existente).
- Produces: Posições com "Novo ativo", transações editáveis e cadastro editável; sidebar com 4 seções; Fontes com histórico de importações.

- [ ] **Step 1: `PositionsView.tsx`**

1. Imports (linha 3-5):

```tsx
import { useEffect, useMemo, useState } from "react";
import { CaretDown, CaretUp, MagnifyingGlass, PencilSimple, Plus, Table, X } from "@phosphor-icons/react";
import { getInstruments, getPortfolio, getTransactions, type Instrument, type PortfolioPosition, type Transaction } from "../api.ts";
import { formataBRL, formataCategoria, formataData, formataMes, formataPercentualSinal, formataQuantidade } from "../format.ts";
import { ORDEM_CLASSE, ROTULO_CLASSE, classeDe, type Classe } from "../classes.ts";
import { FormAtivo } from "../components/FormAtivo.tsx";
import { FormTransacao } from "../components/FormTransacao.tsx";
```

2. Remover `INVESTIDORES` (linha 22) e os estados `investidorRascunho`/`salvandoInvestidor`/`feedbackInvestidor` (linhas 37-39); trocar por:

```tsx
  const [recargaLocal, setRecargaLocal] = useState(0);
  const [formAtivo, setFormAtivo] = useState<{ instrumento: Instrument | null; qtdTransacoes: number } | null>(null);
  const [formTransacao, setFormTransacao] = useState<{ transacao: Transaction | null } | null>(null);
```

3. O efeito do portfolio (linha 45-54) passa a depender de `[reloadToken, recargaLocal]` e sincroniza a seleção:

```tsx
  useEffect(() => {
    const controller = new AbortController();
    getPortfolio(controller.signal)
      .then((portfolio) => {
        setPosicoes(portfolio.positions);
        setSelecionada((atual) => atual === null
          ? null
          : portfolio.positions.find((posicao) => posicao.instrumentId === atual.instrumentId) ?? null);
        setErro(null);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setErro(cause instanceof Error ? cause.message : String(cause));
      });
    return () => controller.abort();
  }, [reloadToken, recargaLocal]);
```

4. O efeito das transações (linha 56-67) passa a depender de `[selecionada?.instrumentId, recargaLocal]`.

5. Remover `abrirAtivo` parcial (linhas 80-84), `salvarInvestidor`, `opcoesInvestidor`, `mudouInvestidor` e adicionar:

```tsx
  function abrirAtivo(posicao: PortfolioPosition) {
    setSelecionada(posicao);
  }

  function concluirMutacao() {
    setFormTransacao(null);
    setFormAtivo(null);
    setRecargaLocal((valor) => valor + 1);
  }

  function novoAtivo() {
    setFormAtivo({ instrumento: null, qtdTransacoes: 0 });
  }

  async function editarAtivo() {
    if (selecionada === null) return;
    try {
      const instrumentos = await getInstruments();
      const instrumento = instrumentos.find((item) => item.id === selecionada.instrumentId) ?? null;
      setFormAtivo({ instrumento, qtdTransacoes: (transacoes ?? []).length });
    } catch (cause) {
      setErro(cause instanceof Error ? cause.message : String(cause));
    }
  }
```

6. No `page-head`, adicionar ações:

```tsx
        <div className="page-head-actions">
          <button type="button" className="btn" onClick={() => void novoAtivo()}>
            <Plus size={15} aria-hidden="true" /> Novo ativo
          </button>
        </div>
```

7. No painel, trocar o bloco do editor de investidor (linhas 256-274) por um botão de cadastro no cabeçalho — no `section-head` do painel, antes do botão Fechar:

```tsx
            <button type="button" className="btn btn-secondary" onClick={() => void editarAtivo()}>
              <PencilSimple size={15} aria-hidden="true" /> Editar cadastro
            </button>
```

8. No `<h3 className="section-title">Transações</h3>` (linha 281), virar cabeçalho com ação:

```tsx
          <div className="section-head section-head-linha">
            <h3 className="section-title">Transações</h3>
            <button type="button" className="btn btn-secondary" onClick={() => setFormTransacao({ transacao: null })}>
              <Plus size={15} aria-hidden="true" /> Nova transação
            </button>
          </div>
```

9. Na tabela de transações, usar `id` como key e linha clicável:

```tsx
                  {transacoes.map((transacao) => (
                    <tr key={transacao.id} onClick={() => setFormTransacao({ transacao })} className="linha-clicavel">
```

10. Antes de `</div>` final, renderizar os modais:

```tsx
      {formTransacao !== null && selecionada !== null && (
        <FormTransacao
          aberto
          posicao={selecionada}
          transacao={formTransacao.transacao}
          onFechar={() => setFormTransacao(null)}
          onSalvo={concluirMutacao}
        />
      )}
      {formAtivo !== null && (
        <FormAtivo
          aberto
          instrumento={formAtivo.instrumento}
          qtdTransacoes={formAtivo.qtdTransacoes}
          onFechar={() => setFormAtivo(null)}
          onSalvo={concluirMutacao}
        />
      )}
```

11. No estado vazio da lista (linha 190), trocar o hint "Ajuste os filtros ou importe a planilha em Importar." por "Ajuste os filtros ou crie um ativo em Novo ativo."

- [ ] **Step 2: `App.tsx`**

1. Remover `FileArrowUp` do import do phosphor e `ImportView` do import de views; remover `"importar"` do tipo `View` e do array `ITENS`; remover a linha `{view === "importar" && <ImportView />}`.

- [ ] **Step 3: `SourcesView.tsx`**

1. Import: `getImportRuns, type ImportRun`.

2. Estado e carga:

```tsx
  const [importRuns, setImportRuns] = useState<ImportRun[]>([]);
```

No `carregar`, incluir no `Promise.all`:

```tsx
      const [novoHealth, novaRecon, novoRuns] = await Promise.all([getHealth(signal), getReconciliation(mesAtual(), signal), getImportRuns()]);
      setHealth(novoHealth);
      setReconciliation(novaRecon);
      setImportRuns(novoRuns);
```

3. Nova seção no fim do `<div className="stack">`, depois da reconciliação:

```tsx
        {importRuns.length > 0 && (
          <section className="card">
            <details className="recon">
              <summary><span className="section-title">Importações da planilha</span><span className="badge">{formataNumero(importRuns.length)} registros</span></summary>
              <p className="section-hint">O import substitui todos os dados e agora só roda pelo CLI: <code>npm run import -- --replace</code>.</p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th scope="col">Quando</th><th scope="col">Origem</th><th scope="col" className="num">Ativos</th><th scope="col" className="num">Transações</th><th scope="col" className="num">Histórico</th><th scope="col">Estado</th></tr>
                  </thead>
                  <tbody>
                    {importRuns.map((run) => (
                      <tr key={run.id}>
                        <td>{formataDataHora(run.importedAt)}</td>
                        <td>{run.source}</td>
                        <td className="num">{run.instruments}</td>
                        <td className="num">{run.transactions}</td>
                        <td className="num">{run.historyRows}</td>
                        <td>{run.status === "ok" ? <span className="badge badge-ok">ok</span> : <span className="badge badge-error">{run.message ?? "erro"}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
        )}
```

4. Deletar `web/src/views/ImportView.tsx`.

- [ ] **Step 4: CSS**

Em `web/src/styles.css`, acrescentar (perto dos blocos de `.campo`):

```css
.form-grade { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
.form-grade .campo-largo { grid-column: 1 / -1; }
.form-acoes { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; flex-wrap: wrap; }
.btn-danger { border-color: var(--danger); color: var(--danger); }
```

(`--danger: #A8452F` já existe em `web/src/styles.css:20`.)

- [ ] **Step 5: Typecheck + build + browser**

Run: `npm run typecheck && npm run build:web`
Expected: limpos (sem referência a `ImportView`/`postImport`/`patchInvestor`).

Com a API de pé (`npm run dev`) e `npm run dev:web`, em `http://localhost:5173`:
1. Sidebar com 4 seções (sem Importar); Fontes com "Importações da planilha".
2. Posições → "Novo ativo" → criar CDB (CDI, 105) → aparece na lista com R$ <valor>
3. Abrir o ativo → "Nova transação" → Compra de R$ <valor> → painel e lista atualizam.
4. Clicar na transação → editar valor → Painel reflete; excluir → confirmação em dois toques.
5. "Editar cadastro" do ativo criado → mudar corretora; com transações, a exclusão fica desabilitada.
6. Forçar guarda: lançar Resgate de R$ <valor> no CDB → erro inline "maior que o saldo".

Screenshots: `.superpowers/sdd/v2-01-novo-ativo.png`, `v2-02-transacao.png`, `v2-03-guarda.png`.

- [ ] **Step 6: Commit**

```bash
git add web/src/views/PositionsView.tsx web/src/App.tsx web/src/views/SourcesView.tsx web/src/styles.css
git rm web/src/views/ImportView.tsx
git commit -m "feat: crud no painel, shell com 4 secoes e historico em fontes"
```

---

### Task 8: Verificação real + fechamento do ROADMAP

**Files:**
- Modify: `ROADMAP.md`

**Interfaces:**
- Consumes: tudo das tasks 1–7.
- Produces: v2 marcada como concluída com evidências; próxima ação apontada (abas auxiliares).

- [ ] **Step 1: Suite, tipos e build**

Run: `npm test 2>&1 | tail -20 && npm run typecheck && npm run build:web`
Expected: **200 testes** verdes; typecheck e build limpos (warning de chunk conhecido é aceitável).

- [ ] **Step 2: Docker**

Run: `docker compose up -d --build && sleep 10 && curl -s localhost:3000/api/health`
Expected: container `healthy`; `/api/health` com `sources` sem erro novo; contagens inalteradas (48 ativos, 119 transações).

- [ ] **Step 3: Guarda do import CLI**

Run: `npm run import 2>&1 | tail -3`
Expected: `erro: o banco já tem 119 transações; use --replace ...` e exit code 1; o banco não muda.

- [ ] **Step 4: Aceite real pela API (container)**

```bash
curl -s -X POST localhost:3000/api/instruments -H 'content-type: application/json' \
  -d '{"name":"CDB Teste V2","kind":"fixed_income","category":"cdb","benchmark":"CDI","rateE6":<valor>,"maturityDate":"2030-01-01","broker":"PagBank","objective":"Reserva","investor":"Ana"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.id,j.legacyKey??'sem legacyKey exposta')})"
```

Expected: `cdb-teste-v2`.

```bash
curl -s -X POST localhost:3000/api/instruments/cdb-teste-v2/transactions -H 'content-type: application/json' \
  -d '{"tradeDate":"2026-09-22","kind":"BUY","grossCents":<valor>,"feesCents":0}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('id',j.id,'gross',j.grossCents)})"
```

Expected: `id <n> gross <valor>`.

```bash
curl -s -X POST localhost:3000/api/instruments/cdb-teste-v2/transactions -H 'content-type: application/json' \
  -d '{"tradeDate":"2026-09-22","kind":"SELL","grossCents":<valor>}'
```

Expected: `{"error":"resgate de R$ <valor> maior que o saldo de R$ <valor> em 2026-09-22"}`.

```bash
curl -s -X DELETE localhost:3000/api/instruments/cdb-teste-v2
```

Expected: `409` com `não é possível excluir: 1 transações lançadas`; excluir a transação e depois o ativo volta a funcionar (o id da transação sai do passo anterior).

- [ ] **Step 5: Restaurar a base e conferir reconciliação**

Run: `npm run import -- --replace 2>&1 | tail -3 && curl -s "localhost:3000/api/reconciliation?month=2026-09&asOf=2026-09-16" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('reference',j.totals.referenceCents,'unexplained',j.unexplained)})"`
Expected: import ok; `reference <valor> unexplained 0` (a base volta a 48 ativos / 119 transações).

- [ ] **Step 6: Browser final (`:3000`)**

Refazer o roteiro da Task 7 no container (criar ativo → compra → editar → excluir) e conferir Visão geral/Posições recalculando a cada mutação. Screenshot `.superpowers/sdd/v2-04-final.png`.

- [ ] **Step 7: Atualizar o ROADMAP**

- Tabela "Estado atual": `| v2 — CRUD de transações/ativos | concluída — merge local na main (branch v2-crud-transacoes-ativos) |` e remover a linha "v2 — CRUD e auxiliares | backlog" (vira "abas auxiliares (projeção/rebalanceamento)").
- Evidências: bullet com 200 testes, rotas novas, guarda real (resgate > saldo), import CLI com `--replace`, reconciliação `<valor>`/`0`, screenshots.
- "Próxima ação": brainstorming das **abas auxiliares** (projeção até 2099 e rebalanceamento); imposto líquido × líquido segue na v3.
- "Itens herdados em aberto": atualizar o minor do `DIVIDEND` — v2 não cria tipos além de Compra/Resgate, o item segue para quando houver suporte a proventos.

- [ ] **Step 8: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: fecha a v2 de crud no roadmap"
```

---

## Notas de execução

- A guarda usa `rateE6` multiplicando o índice diário igual a `instrumentValue` (`src/domain/position.ts:142`); qualquer divergência aqui quebra o aceite de reconciliação.
- `legacy_key = ui:<id>` convive com a UNIQUE do schema; o próximo `--replace` apaga ativos criados na UI (documentado no README e no confirm da CLI).
- Edições retroativas mudam TWR/MWR por design; sem audit e sem undo — a Task 8 restaura a base canônica pelo CLI.
- `GET /api/instruments/:id/transactions` agora devolve `id`: a UI usa como key e para editar/excluir.
- Merge ff na `main` ao final; atualizar o ROADMAP no mesmo merge.
