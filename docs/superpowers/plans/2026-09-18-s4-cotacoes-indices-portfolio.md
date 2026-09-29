# Cotações, índices e portfolio (S4) — Plano de Implementação

> **Para agentes:** sub-skill obrigatória: `superpowers:executing-plans` (execução inline, padrão bento) com TDD task a task. Passos usam checkbox (`- [ ]`).

**Goal:** coletar cotações de RV (Yahoo chart v8 + fallback Alpha Vantage) e índices do BCB (CDI/Selic/IPCA), calcular posição RF/RV com aritmética inteira e expor `/api/portfolio`, `/api/history`, `/api/allocation`, `POST /api/refresh` e fontes no `/api/health`, com job `node-cron` no processo.

**Architecture:** `sources/` (adapters com `fetch` injetável) → `services/refresh*` (grava `quotes` com `settled`, `index_rates`, `source_status`) → `domain/` puro (posição, evolução, alocação) → `services/{portfolio,history,allocation}` (leitura on-the-fly) → rotas finas. Job no `server.ts`; regra de escrita: dia fechado imutável, parcial do dia sobrescrevível.

**Tech Stack:** Node 22 + TypeScript (type-stripping), Fastify 5, better-sqlite3, `node-cron` 4, `node:test`. Sem rede nos testes (fixtures + fetch fake).

**Spec:** `docs/superpowers/specs/2026-09-18-s4-cotacoes-indices-portfolio-design.md`

## Global Constraints

- Node ≥ 22.18, ESM, imports `.ts` explícitos; backend sem build (type-stripping). `node:test`; nenhum teste com rede.
- Zero `float` em dado persistido/cálculo: BigInt escalonado (cents 1e2, shares 1e8, rate 1e12, multiplier 1e6); `Number` só na borda da API (`toNumberSafe`). `parseDecimal` sempre a partir de string.
- `settled`: linha `quotes` com `settled = 1` nunca é sobrescrita; linha `settled = 0` (hoje) pode; transição 0→1 acontece no fetch em que a data já é passada. `index_rates` é `INSERT OR IGNORE` (BCB definitivo).
- Fronteira exata: `from = max(date)` por ticker/série; banco vazio → `MIN(trade_date)`; `?full=1` → `MIN(trade_date)` de novo (só preenche buraco/finaliza pendente).
- Guardas de escrita: `date ≤ hoje` (BRT), `valor > 0`, lote atômico por ticker/série (falha não grava nada daquele ticker/série).
- Yahoo `${ticker}.SA` (close bruto), Alpha Vantage `${ticker}.SAO`, BCB SGS 12/11/433, TZ `America/Sao_Paulo`.
- Dados reais: 48 instrumentos = 3 RV (`B5P211`, `WRLD11`, `VWRA11`) + 44 RF + 1 pension; 119 transações desde 2025-04-23. Referência 2026-09 = <valor> centavos.
- Limites de PR (bento): **≤ 400 linhas / ≤ 10 arquivos por layer**; cada task = 1 layer; `package-lock.json` fora das layers (instalar local, sincronizar no trunk).
- Artefatos e commits em pt-BR.

---

## Estrutura de arquivos (S4)

```
src/db/migrations/002_quotes_settled.sql   # settled + source_status
src/db/repos.ts                            # + writeQuotes/writeIndexRates/frontiers/status/leitura
src/domain/dates.ts  dates.test.ts         # BRT, mês (range/end), addMonths
src/domain/position.ts  position.test.ts   # RF (capitalização diária), RV, instrumentValue
src/domain/evolution.ts  evolution.test.ts # CDI/IPCA do mês
src/domain/allocation.ts  allocation.test.ts
src/sources/types.ts                       # QuoteSource/IndexSource/FetchLike
src/sources/yahoo.ts  yahoo.test.ts
src/sources/alphavantage.ts  alphavantage.test.ts
src/sources/bcb.ts  bcb.test.ts
src/sources/index.ts  index.test.ts        # registro explícito
src/services/refresh-summary.ts            # tipo do resumo por fonte
src/services/refresh-quotes.ts  refresh-quotes.test.ts
src/services/refresh-indices.ts  refresh-indices.test.ts
src/services/refresh.ts  refresh.test.ts   # orquestrador + mutex + ?full + ?source
src/services/status.ts                     # SourceSummary + stale
src/services/portfolio.ts  portfolio.test.ts
src/services/history.ts  history.test.ts
src/services/allocation.ts  allocation.test.ts
src/api/routes/portfolio.ts  refresh.ts    # rotas novas
src/api/routes/health.ts                   # + sources
src/app.ts  src/api/app.test.ts
src/jobs/scheduler.ts  scheduler.test.ts
src/server.ts  README.md
```

---

### Task 1: Migration 002 + repositórios de cotação/índice/status

**Files:**
- Create: `src/db/migrations/002_quotes_settled.sql`
- Modify: `src/db/repos.ts`, `src/db/repos.test.ts`

**Interfaces:**
- Consumes: `Db`, `migrate` (S2).
- Produces:
  - `type QuoteRow = { ticker: string; date: string; closeCents: bigint; source: string; settled: boolean }`
  - `type IndexRateRow = { series: string; date: string; valueE12: bigint }`
  - `type SourceStatusRow = { source: string; lastAttemptAt: string | null; lastSuccessAt: string | null; lastErrorAt: string | null; lastError: string | null }`
  - `writeQuotes(db, rows, today): { inserted; updated; skipped }`
  - `writeIndexRates(db, rows): { inserted; skipped }`
  - `quoteFrontier(db, ticker)`, `indexFrontier(db, series)`, `earliestTradeDate(db)`, `hasQuoteFromSourceOnDate(db, ticker, source, date)`
  - `recordSourceAttempt(db, source, { ok: true } | { ok: false; error })`, `listSourceStatus(db)`
  - `listAllQuotes(db)`, `listAllIndexRates(db)`, `listAllTransactions(db)`

- [ ] **Step 1: Criar a migration**

```sql
-- src/db/migrations/002_quotes_settled.sql
ALTER TABLE quotes ADD COLUMN settled INTEGER NOT NULL DEFAULT 0;

CREATE TABLE source_status (
  source TEXT PRIMARY KEY,
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_error_at TEXT,
  last_error TEXT
);
```

- [ ] **Step 2: Testes que falham em `src/db/repos.test.ts`**

Ajustar o import do topo para incluir as funções novas:

```ts
import {
  clearImportedData, counts, earliestTradeDate, getInstrument, getInstrumentByLegacyKey,
  hasQuoteFromSourceOnDate, indexFrontier, insertImportRun, insertInstruments, insertLegacySnapshots,
  insertTransactions, latestLegacyMonth, listAllIndexRates, listAllQuotes, listAllTransactions,
  listImportRuns, listLegacySnapshotByMonth, listSourceStatus, listTransactionsByInstrument,
  quoteFrontier, recordSourceAttempt, writeIndexRates, writeQuotes,
} from "./repos.ts";
import type { IndexRateRow, InstrumentRow, QuoteRow } from "./repos.ts";
```

E adicionar os testes ao final:

```ts
test("writeQuotes: fechado imutável, hoje sobrescreve, pendente finaliza", () => {
  const db = freshDb();
  const past: QuoteRow = { ticker: "WRLD11", date: "2026-09-17", closeCents: 1000n, source: "yahoo", settled: true };
  const today: QuoteRow = { ticker: "WRLD11", date: "2026-09-18", closeCents: 1050n, source: "yahoo", settled: false };
  assert.deepEqual(writeQuotes(db, [past, today], "2026-09-18"), { inserted: 2, updated: 0, skipped: 0 });
  assert.deepEqual(
    writeQuotes(db, [{ ...past, closeCents: 9999n }, { ...today, closeCents: 1060n }], "2026-09-18"),
    { inserted: 0, updated: 1, skipped: 1 },
  );
  const rows = listAllQuotes(db);
  assert.equal(rows.find((row) => row.date === "2026-09-17")?.closeCents, 1000n);
  assert.equal(rows.find((row) => row.date === "2026-09-18")?.closeCents, 1060n);
});

test("writeQuotes: fetch do dia seguinte finaliza o parcial (0→1)", () => {
  const db = freshDb();
  writeQuotes(db, [{ ticker: "WRLD11", date: "2026-09-18", closeCents: 1050n, source: "yahoo", settled: false }], "2026-09-18");
  assert.deepEqual(
    writeQuotes(db, [{ ticker: "WRLD11", date: "2026-09-18", closeCents: 1075n, source: "yahoo", settled: true }], "2026-09-19"),
    { inserted: 0, updated: 1, skipped: 0 },
  );
  assert.deepEqual(listAllQuotes(db)[0], { ticker: "WRLD11", date: "2026-09-18", closeCents: 1075n, source: "yahoo", settled: true });
});

test("writeIndexRates ignora reescrita e calcula fronteiras", () => {
  const db = freshDb();
  insertInstruments(db, [cdb]);
  insertTransactions(db, [{ instrumentId: cdb.id, tradeDate: "2025-04-23", kind: "BUY", quantityE8: null, grossCents: 1000n, feesCents: 0n, note: null, legacyRow: null }]);
  const rates: IndexRateRow[] = [
    { series: "CDI", date: "2025-04-23", valueE12: 500_000_000n },
    { series: "CDI", date: "2025-04-24", valueE12: 500_000_000n },
  ];
  assert.deepEqual(writeIndexRates(db, rates), { inserted: 2, skipped: 0 });
  assert.deepEqual(writeIndexRates(db, [{ ...rates[0]!, valueE12: 999n }]), { inserted: 0, skipped: 1 });
  assert.equal(listAllIndexRates(db)[0]?.valueE12, 500_000_000n);
  assert.equal(indexFrontier(db, "CDI"), "2025-04-24");
  assert.equal(indexFrontier(db, "SELIC"), null);
  assert.equal(earliestTradeDate(db), "2025-04-23");
  writeQuotes(db, [{ ticker: "WRLD11", date: "2026-09-17", closeCents: 1n, source: "yahoo", settled: true }], "2026-09-18");
  assert.equal(quoteFrontier(db, "WRLD11"), "2026-09-17");
  assert.equal(hasQuoteFromSourceOnDate(db, "WRLD11", "alphavantage", "2026-09-17"), false);
  assert.equal(hasQuoteFromSourceOnDate(db, "WRLD11", "yahoo", "2026-09-17"), true);
});

test("recordSourceAttempt e listSourceStatus guardam sucesso/erro", () => {
  const db = freshDb();
  recordSourceAttempt(db, "yahoo", { ok: true });
  assert.equal(listSourceStatus(db)[0]?.lastSuccessAt !== null, true);
  recordSourceAttempt(db, "yahoo", { ok: false, error: "HTTP 502" });
  const status = listSourceStatus(db)[0];
  assert.equal(status?.lastError, "HTTP 502");
  assert.equal(status?.lastErrorAt !== null && status.lastErrorAt > (status.lastSuccessAt ?? ""), true);
});

test("listAllTransactions devolve todos em ordem de ativo e data", () => {
  const db = freshDb();
  insertInstruments(db, [cdb]);
  insertTransactions(db, [
    { instrumentId: cdb.id, tradeDate: "2026-07-01", kind: "SELL", quantityE8: null, grossCents: 2n, feesCents: 0n, note: null, legacyRow: null },
    { instrumentId: cdb.id, tradeDate: "2025-04-23", kind: "BUY", quantityE8: null, grossCents: 1n, feesCents: 0n, note: null, legacyRow: null },
  ]);
  assert.deepEqual(listAllTransactions(db).map((t) => t.tradeDate), ["2025-04-23", "2026-07-01"]);
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test "src/db/repos.test.ts"`
Expected: FAIL (`writeQuotes` não existe; migration 002 ainda não é lida — os testes falham no import).

- [ ] **Step 4: Implementar em `src/db/repos.ts`**

Adicionar os tipos após `ImportRunRow`:

```ts
export type QuoteRow = { ticker: string; date: string; closeCents: bigint; source: string; settled: boolean };
export type IndexRateRow = { series: string; date: string; valueE12: bigint };
export type SourceStatusRow = {
  source: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
};
```

Adicionar as funções ao final do arquivo:

```ts
export function writeQuotes(db: Db, rows: QuoteRow[], today: string): { inserted: number; updated: number; skipped: number } {
  const writeClosed = db.prepare(`INSERT INTO quotes (ticker, date, close_cents, source, settled)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(ticker, date) DO UPDATE SET
      close_cents = excluded.close_cents, source = excluded.source, settled = 1, fetched_at = datetime('now')
    WHERE quotes.settled = 0`);
  const writeToday = db.prepare(`INSERT INTO quotes (ticker, date, close_cents, source, settled)
    VALUES (?, ?, ?, ?, 0)
    ON CONFLICT(ticker, date) DO UPDATE SET
      close_cents = excluded.close_cents, source = excluded.source, fetched_at = datetime('now')
    WHERE quotes.settled = 0`);
  const find = db.prepare("SELECT settled FROM quotes WHERE ticker = ? AND date = ?");
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const run = db.transaction((items: QuoteRow[]) => {
    for (const quote of items) {
      const before = find.get(quote.ticker, quote.date) as { settled: bigint } | undefined;
      const result = (quote.date < today ? writeClosed : writeToday).run(quote.ticker, quote.date, quote.closeCents, quote.source);
      if (Number(result.changes) === 0) skipped++;
      else if (before) updated++;
      else inserted++;
    }
  });
  run(rows);
  return { inserted, updated, skipped };
}

export function writeIndexRates(db: Db, rows: IndexRateRow[]): { inserted: number; skipped: number } {
  const stmt = db.prepare("INSERT OR IGNORE INTO index_rates (series, date, value_e12) VALUES (?, ?, ?)");
  let inserted = 0;
  let skipped = 0;
  const run = db.transaction((items: IndexRateRow[]) => {
    for (const rate of items) {
      const result = stmt.run(rate.series, rate.date, rate.valueE12);
      if (Number(result.changes) === 0) skipped++;
      else inserted++;
    }
  });
  run(rows);
  return { inserted, skipped };
}

export function quoteFrontier(db: Db, ticker: string): string | null {
  const row = db.prepare("SELECT MAX(date) AS date FROM quotes WHERE ticker = ?").get(ticker) as { date: string | null };
  return row.date;
}

export function indexFrontier(db: Db, series: string): string | null {
  const row = db.prepare("SELECT MAX(date) AS date FROM index_rates WHERE series = ?").get(series) as { date: string | null };
  return row.date;
}

export function earliestTradeDate(db: Db): string | null {
  const row = db.prepare("SELECT MIN(trade_date) AS date FROM transactions").get() as { date: string | null };
  return row.date;
}

export function hasQuoteFromSourceOnDate(db: Db, ticker: string, source: string, date: string): boolean {
  return db.prepare("SELECT 1 AS found FROM quotes WHERE ticker = ? AND source = ? AND date = ?").get(ticker, source, date) !== undefined;
}

export function recordSourceAttempt(db: Db, source: string, result: { ok: true } | { ok: false; error: string }): void {
  if (result.ok) {
    db.prepare(`INSERT INTO source_status (source, last_attempt_at, last_success_at)
      VALUES (?, datetime('now'), datetime('now'))
      ON CONFLICT(source) DO UPDATE SET
        last_attempt_at = excluded.last_attempt_at, last_success_at = excluded.last_success_at`).run(source);
    return;
  }
  db.prepare(`INSERT INTO source_status (source, last_attempt_at, last_error_at, last_error)
    VALUES (?, datetime('now'), datetime('now'), ?)
    ON CONFLICT(source) DO UPDATE SET
      last_attempt_at = excluded.last_attempt_at, last_error_at = excluded.last_error_at, last_error = excluded.last_error`)
    .run(source, result.error.slice(0, 500));
}

export function listSourceStatus(db: Db): SourceStatusRow[] {
  const rows = db.prepare("SELECT * FROM source_status ORDER BY source").all() as Array<{
    source: string; last_attempt_at: string | null; last_success_at: string | null; last_error_at: string | null; last_error: string | null;
  }>;
  return rows.map((row) => ({
    source: row.source, lastAttemptAt: row.last_attempt_at, lastSuccessAt: row.last_success_at,
    lastErrorAt: row.last_error_at, lastError: row.last_error,
  }));
}

export function listAllQuotes(db: Db): QuoteRow[] {
  const rows = db.prepare("SELECT ticker, date, close_cents, source, settled FROM quotes ORDER BY ticker, date").all() as Array<{
    ticker: string; date: string; close_cents: bigint; source: string; settled: bigint;
  }>;
  return rows.map((row) => ({
    ticker: row.ticker, date: row.date, closeCents: row.close_cents, source: row.source, settled: Number(row.settled) === 1,
  }));
}

export function listAllIndexRates(db: Db): IndexRateRow[] {
  const rows = db.prepare("SELECT series, date, value_e12 FROM index_rates ORDER BY series, date").all() as Array<{
    series: string; date: string; value_e12: bigint;
  }>;
  return rows.map((row) => ({ series: row.series, date: row.date, valueE12: row.value_e12 }));
}

export function listAllTransactions(db: Db): TransactionRow[] {
  const rows = db.prepare("SELECT * FROM transactions ORDER BY instrument_id, trade_date, id").all() as Array<{
    instrument_id: string; trade_date: string; kind: TransactionKind;
    quantity_e8: bigint | null; gross_cents: bigint; fees_cents: bigint; note: string | null; legacy_row: bigint | null;
  }>;
  return rows.map((row) => ({
    instrumentId: row.instrument_id, tradeDate: row.trade_date, kind: row.kind,
    quantityE8: row.quantity_e8, grossCents: row.gross_cents, feesCents: row.fees_cents,
    note: row.note, legacyRow: row.legacy_row === null ? null : Number(row.legacy_row),
  }));
}
```

- [ ] **Step 5: Rodar tudo e commitar**

Run: `node --test "src/db/repos.test.ts" && npm run typecheck`
Expected: PASS.

```bash
git add src/db
git commit -m "feat: cotacoes com settled imutavel e status de fonte (migration 002)"
```

---

### Task 2: Domínio — datas e posição (RF/RV/PGBL)

**Files:**
- Create: `src/domain/dates.ts`, `src/domain/dates.test.ts`, `src/domain/position.ts`, `src/domain/position.test.ts`

**Interfaces:**
- Consumes: `divRoundHalfUp`, `mulScaled`, escalas (`money.ts`); `InstrumentKind`, `TransactionKind` (`model.ts`).
- Produces:
  - `toBrDate(date: Date): string`, `addMonths(month, delta): string`, `monthEnd(month): string`, `monthRange(from, to): string[]`
  - `type RatePoint`, `type QuotePoint`, `type PositionInput`, `type PositionValue`
  - `rfDailyFactorE12(valueE12, multiplierE6)`, `rfValueCents(operations, rates, multiplierE6, asOf)`, `equityValueCents(quantityE8, quotes, asOf)`, `instrumentValue(input, asOf)`

- [ ] **Step 1: Teste que falha — `src/domain/dates.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { addMonths, monthEnd, monthRange, toBrDate } from "./dates.ts";

test("toBrDate devolve a data em America/Sao_Paulo", () => {
  assert.equal(toBrDate(new Date("2026-09-18T02:00:00Z")), "2026-09-17");
  assert.equal(toBrDate(new Date("2026-09-18T14:00:00Z")), "2026-09-18");
});

test("addMonths anda nos dois sentidos", () => {
  assert.equal(addMonths("2026-12", 1), "2027-01");
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(addMonths("2026-01", -12), "2025-01");
});

test("monthEnd respeita bissexto e monthRange é inclusivo", () => {
  assert.equal(monthEnd("2026-02"), "2026-02-28");
  assert.equal(monthEnd("2028-02"), "2028-02-29");
  assert.deepEqual(monthRange("2026-08", "2026-10"), ["2026-08", "2026-09", "2026-10"]);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test "src/domain/dates.test.ts"`
Expected: FAIL (`./dates.ts` não existe).

- [ ] **Step 3: Implementar `src/domain/dates.ts`**

```ts
const BRT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });

/** Data (YYYY-MM-DD) em America/Sao_Paulo. */
export function toBrDate(date: Date): string {
  return BRT.format(date);
}

/** Soma meses a um mês "YYYY-MM". */
export function addMonths(month: string, delta: number): string {
  const [year = 0, monthIndex = 1] = month.split("-").map(Number);
  const total = year * 12 + (monthIndex - 1) + delta;
  const y = Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12 + 1;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
}

/** Último dia do mês "YYYY-MM" como data ISO. */
export function monthEnd(month: string): string {
  const [year = 0, monthIndex = 1] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return `${month}-${String(lastDay).padStart(2, "0")}`;
}

/** Meses inclusivos de `from` a `to`, ambos "YYYY-MM". */
export function monthRange(from: string, to: string): string[] {
  const months: string[] = [];
  let current = from;
  while (current <= to) {
    months.push(current);
    current = addMonths(current, 1);
  }
  return months;
}
```

- [ ] **Step 4: Teste que falha — `src/domain/position.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { equityValueCents, instrumentValue, rfValueCents, type PositionInput } from "./position.ts";

const rate = (date: string) => ({ date, valueE12: 1_000_000_000n }); // 0,1% ao dia

test("RF capitaliza compra D+0 até o asOf", () => {
  const { valueCents } = rfValueCents([{ date: "2026-01-02", grossCents: 100_000n }], [rate("2026-01-02"), rate("2026-01-05")], 1_000_000n, "2026-01-05");
  assert.equal(valueCents, 100_200n); // <valor> × 1,001 × 1,001
});

test("RF venda D−1 zera a posição exatamente", () => {
  const { valueCents } = rfValueCents(
    [{ date: "2026-01-02", grossCents: 100_000n }, { date: "2026-01-05", grossCents: -100_100n }],
    [rate("2026-01-02"), rate("2026-01-05")],
    1_000_000n,
    "2026-01-05",
  );
  assert.equal(valueCents, 0n);
});

test("RF sábado cai na próxima taxa e 106% aplica o multiplicador", () => {
  assert.equal(rfValueCents([{ date: "2026-01-03", grossCents: 100_000n }], [rate("2026-01-05")], 1_000_000n, "2026-01-05").valueCents, 100_100n);
  assert.equal(rfValueCents([{ date: "2026-01-02", grossCents: 100_000n }], [rate("2026-01-02")], 1_060_000n, "2026-01-02").valueCents, 100_106n);
});

test("RV usa último fechamento ≤ asOf e devolve null sem cota", () => {
  const quotes = [{ date: "2026-01-02", closeCents: 1_000n }, { date: "2026-01-05", closeCents: 1_100n }];
  assert.deepEqual(equityValueCents(10_00000000n, quotes, "2026-01-04"), { valueCents: 10_000n, priceCents: 1_000n, priceDate: "2026-01-02" });
  assert.deepEqual(equityValueCents(10_00000000n, quotes, "2026-01-05"), { valueCents: 11_000n, priceCents: 1_100n, priceDate: "2026-01-05" });
  assert.deepEqual(equityValueCents(10_00000000n, [], "2026-01-05"), { valueCents: null, priceCents: null, priceDate: null });
});

test("instrumentValue consolida invested/redeemed/fees e PGBL fica pendente", () => {
  const rf: PositionInput = {
    kind: "fixed_income", benchmark: "CDI", rateE6: 1_000_000n,
    transactions: [
      { tradeDate: "2026-01-02", kind: "BUY", quantityE8: null, grossCents: 100_000n, feesCents: 5_000n },
      { tradeDate: "2026-01-05", kind: "SELL", quantityE8: null, grossCents: 40_000n, feesCents: 0n },
    ],
    quotes: [], rates: [rate("2026-01-02")],
  };
  const value = instrumentValue(rf, "2026-01-05");
  assert.equal(value.investedCents, 105_000n);
  assert.equal(value.redeemedCents, 40_000n);
  assert.equal(value.feesCents, 5_000n);
  assert.equal(value.quantityE8, null);

  const pension = instrumentValue({ ...rf, kind: "pension", benchmark: null, rateE6: null }, "2026-01-05");
  assert.equal(pension.marketValueCents, null);
  assert.equal(pension.quantityE8, null);
});
```

- [ ] **Step 5: Rodar e ver falhar**

Run: `node --test "src/domain/position.test.ts"`
Expected: FAIL (`./position.ts` não existe).

- [ ] **Step 6: Implementar `src/domain/position.ts`**

```ts
import { MULTIPLIER_SCALE, RATE_SCALE, SHARES_SCALE, divRoundHalfUp, mulScaled } from "./money.ts";
import type { InstrumentKind, TransactionKind } from "./model.ts";

export type RatePoint = { date: string; valueE12: bigint };
export type QuotePoint = { date: string; closeCents: bigint };

export type PositionTransaction = {
  tradeDate: string;
  kind: TransactionKind;
  quantityE8: bigint | null;
  grossCents: bigint;
  feesCents: bigint;
};

export type PositionInput = {
  kind: InstrumentKind;
  benchmark: string | null;
  rateE6: bigint | null;
  transactions: PositionTransaction[];
  quotes: QuotePoint[];
  rates: RatePoint[];
};

export type PositionValue = {
  marketValueCents: bigint | null;
  priceCents: bigint | null;
  priceDate: string | null;
  quantityE8: bigint | null;
  investedCents: bigint;
  redeemedCents: bigint;
  feesCents: bigint;
};

/** Fator diário (1 + taxa × multiplicador) em escala e12. */
export function rfDailyFactorE12(valueE12: bigint, multiplierE6: bigint): bigint {
  return RATE_SCALE + divRoundHalfUp(valueE12 * multiplierE6, MULTIPLIER_SCALE);
}

/** Saldo RF: cada operação capitaliza da 1ª taxa com date ≥ data da operação até asOf; arredonda 1× no fim. */
export function rfValueCents(
  operations: Array<{ date: string; grossCents: bigint }>,
  rates: RatePoint[],
  multiplierE6: bigint,
  asOf: string,
): { valueCents: bigint; lastRateDate: string | null } {
  let accumulated = 0n;
  let lastRateDate: string | null = null;
  for (const operation of operations) {
    if (operation.date > asOf) continue;
    let factor = RATE_SCALE;
    for (const rate of rates) {
      if (rate.date > asOf) break;
      if (rate.date < operation.date) continue;
      factor = divRoundHalfUp(factor * rfDailyFactorE12(rate.valueE12, multiplierE6), RATE_SCALE);
      if (lastRateDate === null || rate.date > lastRateDate) lastRateDate = rate.date;
    }
    accumulated += operation.grossCents * factor;
  }
  return { valueCents: divRoundHalfUp(accumulated, RATE_SCALE), lastRateDate };
}

/** Valor RV/PGBL: cotas × último fechamento ≤ asOf. */
export function equityValueCents(
  quantityE8: bigint,
  quotes: QuotePoint[],
  asOf: string,
): { valueCents: bigint | null; priceCents: bigint | null; priceDate: string | null } {
  let priceCents: bigint | null = null;
  let priceDate: string | null = null;
  for (const quote of quotes) {
    if (quote.date > asOf) break;
    priceCents = quote.closeCents;
    priceDate = quote.date;
  }
  if (priceCents === null) return { valueCents: null, priceCents: null, priceDate: null };
  return { valueCents: mulScaled(quantityE8, priceCents, SHARES_SCALE), priceCents, priceDate };
}

/** Posição de um ativo em `asOf`, com investido/resgatado/taxas acumulados até a data. */
export function instrumentValue(input: PositionInput, asOf: string): PositionValue {
  let investedCents = 0n;
  let redeemedCents = 0n;
  let feesCents = 0n;
  let quantityE8: bigint | null = null;
  const operations: Array<{ date: string; grossCents: bigint }> = [];
  for (const transaction of input.transactions) {
    if (transaction.tradeDate > asOf) continue;
    if (transaction.kind === "BUY") {
      investedCents += transaction.grossCents + transaction.feesCents;
      feesCents += transaction.feesCents;
    }
    if (transaction.kind === "SELL") redeemedCents += transaction.grossCents;
    operations.push({ date: transaction.tradeDate, grossCents: transaction.kind === "SELL" ? -transaction.grossCents : transaction.grossCents });
    if (transaction.quantityE8 !== null) quantityE8 = (quantityE8 ?? 0n) + transaction.quantityE8;
  }
  if (input.kind === "fixed_income") {
    const multiplierE6 = input.rateE6 ?? 1_000_000n;
    const { valueCents, lastRateDate } = rfValueCents(operations, input.rates, multiplierE6, asOf);
    return { marketValueCents: valueCents, priceCents: null, priceDate: lastRateDate, quantityE8: null, investedCents, redeemedCents, feesCents };
  }
  if (input.kind === "pension") {
    return { marketValueCents: null, priceCents: null, priceDate: null, quantityE8, investedCents, redeemedCents, feesCents };
  }
  const equity = equityValueCents(quantityE8 ?? 0n, input.quotes, asOf);
  return { marketValueCents: equity.valueCents, priceCents: equity.priceCents, priceDate: equity.priceDate, quantityE8, investedCents, redeemedCents, feesCents };
}
```

- [ ] **Step 7: Rodar tudo e commitar**

Run: `node --test "src/domain/*.test.ts" && npm run typecheck`
Expected: PASS.

```bash
git add src/domain
git commit -m "feat: dominio de posicao rf/rv com capitalizacao diaria exata"
```

---

### Task 3: Domínio — evolução mensal e alocação

**Files:**
- Create: `src/domain/evolution.ts`, `src/domain/evolution.test.ts`, `src/domain/allocation.ts`, `src/domain/allocation.test.ts`

**Interfaces:**
- Consumes: `RATE_SCALE`, `divRoundHalfUp` (`money.ts`); `RatePoint` (`position.ts`).
- Produces:
  - `cdiMonthPct(rates, month): number | null`, `ipcaMonthPct(rates, month): number | null`
  - `type AllocationBy = "category" | "broker" | "objective"`, `ALLOCATION_BY`
  - `groupAllocation(positions, by): Array<{ key; marketValueCents }>`

- [ ] **Step 1: Teste que falha — `src/domain/evolution.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { cdiMonthPct, ipcaMonthPct } from "./evolution.ts";

test("cdiMonthPct acumula os fatores do mês e devolve null sem dado", () => {
  const rates = [
    { date: "2026-01-02", valueE12: 1_000_000_000n },
    { date: "2026-01-05", valueE12: 1_000_000_000n },
    { date: "2026-02-02", valueE12: 500_000_000n },
  ];
  assert.equal(cdiMonthPct(rates, "2026-01"), 0.2001);
  assert.equal(cdiMonthPct(rates, "2026-02"), 0.05);
  assert.equal(cdiMonthPct(rates, "2026-03"), null);
});

test("ipcaMonthPct converte a fração do mês em %", () => {
  const rates = [{ date: "2026-01-01", valueE12: 4_200_000_000n }];
  assert.equal(ipcaMonthPct(rates, "2026-01"), 0.42);
  assert.equal(ipcaMonthPct(rates, "2026-02"), null);
});
```

- [ ] **Step 2: Teste que falha — `src/domain/allocation.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupAllocation } from "./allocation.ts";

test("groupAllocation soma por critério, ignora null e ordena por valor", () => {
  const positions = [
    { marketValueCents: 100n, category: "cdb", broker: "PagBank", objective: "Reserva" },
    { marketValueCents: 300n, category: "cdb", broker: "XP", objective: "Aposentadoria" },
    { marketValueCents: null, category: "pension_ipca", broker: null, objective: null },
  ];
  assert.deepEqual(groupAllocation(positions, "category"), [{ key: "cdb", marketValueCents: 400n }]);
  assert.deepEqual(groupAllocation(positions, "broker"), [
    { key: "XP", marketValueCents: 300n },
    { key: "PagBank", marketValueCents: 100n },
  ]);
  assert.deepEqual(groupAllocation(positions, "objective"), [
    { key: "Aposentadoria", marketValueCents: 300n },
    { key: "Reserva", marketValueCents: 100n },
  ]);
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test "src/domain/evolution.test.ts" "src/domain/allocation.test.ts"`
Expected: FAIL (módulos não existem).

- [ ] **Step 4: Implementar `src/domain/evolution.ts`**

```ts
import { RATE_SCALE, divRoundHalfUp } from "./money.ts";
import type { RatePoint } from "./position.ts";

/** CDI acumulado do mês em % (4 casas); null se não há taxa no mês. */
export function cdiMonthPct(rates: RatePoint[], month: string): number | null {
  let factor = RATE_SCALE;
  let found = false;
  for (const rate of rates) {
    if (rate.date.slice(0, 7) !== month) continue;
    factor = divRoundHalfUp(factor * (RATE_SCALE + rate.valueE12), RATE_SCALE);
    found = true;
  }
  if (!found) return null;
  return Number(divRoundHalfUp((factor - RATE_SCALE) * 1_000_000n, RATE_SCALE)) / 10_000;
}

/** IPCA do mês em % (4 casas); null se não há taxa no mês. */
export function ipcaMonthPct(rates: RatePoint[], month: string): number | null {
  const rate = rates.find((point) => point.date.slice(0, 7) === month);
  if (!rate) return null;
  return Number(rate.valueE12) / 10_000_000_000;
}
```

- [ ] **Step 5: Implementar `src/domain/allocation.ts`**

```ts
export const ALLOCATION_BY = ["category", "broker", "objective"] as const;
export type AllocationBy = (typeof ALLOCATION_BY)[number];

export type AllocationPosition = {
  marketValueCents: bigint | null;
  category: string;
  broker: string | null;
  objective: string | null;
};

/** Soma o valor de mercado por critério (ignora posições sem valor). */
export function groupAllocation(positions: AllocationPosition[], by: AllocationBy): Array<{ key: string; marketValueCents: bigint }> {
  const totals = new Map<string, bigint>();
  for (const position of positions) {
    const value = position.marketValueCents;
    if (value === null) continue;
    const raw = position[by];
    const key = raw === null || raw === "" ? "—" : raw;
    totals.set(key, (totals.get(key) ?? 0n) + value);
  }
  return [...totals.entries()]
    .map(([key, marketValueCents]) => ({ key, marketValueCents }))
    .sort((a, b) => (b.marketValueCents > a.marketValueCents ? 1 : b.marketValueCents < a.marketValueCents ? -1 : a.key.localeCompare(b.key)));
}
```

- [ ] **Step 6: Rodar tudo e commitar**

Run: `node --test "src/domain/*.test.ts" && npm run typecheck`
Expected: PASS.

```bash
git add src/domain
git commit -m "feat: dominio de evolucao mensal e alocacao"
```

---

### Task 4: Fonte Yahoo (chart v8)

**Files:**
- Create: `src/sources/types.ts`, `src/sources/yahoo.ts`, `src/sources/yahoo.test.ts`

**Interfaces:**
- Consumes: `CENTS`, `parseDecimal` (`domain/money.ts`).
- Produces:
  - `type FetchLike = (url: string) => Promise<Response>`
  - `type Quote = { ticker; date; closeCents }`, `type QuoteSource = { id; available(); fetchDaily(symbols, from, to) }`, `type IndexSeries`, `type IndexRate`, `type IndexSource`
  - `createYahooSource(deps?): QuoteSource`

- [ ] **Step 1: Criar `src/sources/types.ts`**

```ts
export type FetchLike = (url: string) => Promise<Response>;

export type Quote = { ticker: string; date: string; closeCents: bigint };

export type QuoteSource = {
  id: string;
  available(): Promise<boolean>;
  fetchDaily(symbols: string[], from: string, to: string): Promise<Quote[]>;
};

export type IndexSeries = "CDI" | "SELIC" | "IPCA";
export type IndexRate = { series: IndexSeries; date: string; valueE12: bigint };

export type IndexSource = {
  id: string;
  fetchSeries(series: IndexSeries, from: string, to: string): Promise<IndexRate[]>;
};
```

- [ ] **Step 2: Teste que falha — `src/sources/yahoo.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createYahooSource, type YahooChartResponse } from "./yahoo.ts";

const fixture: YahooChartResponse = {
  chart: {
    result: [{
      timestamp: [<valor>, <valor>, <valor>],
      indicators: { quote: [{ close: [10.5, null, 11.25] }] },
    }],
    error: null,
  },
};

test("yahoo converte timestamps em data BRT e ignora close nulo", async () => {
  const source = createYahooSource({
    fetchImpl: async (url) => {
      assert.match(url, /WRLD11\.SA/);
      assert.match(url, /interval=1d/);
      return new Response(JSON.stringify(fixture), { status: 200 });
    },
  });
  const quotes = await source.fetchDaily(["WRLD11"], "2025-09-01", "2025-09-30");
  assert.deepEqual(quotes, [
    { ticker: "WRLD11", date: "2025-09-17", closeCents: 1050n },
    { ticker: "WRLD11", date: "2025-09-19", closeCents: 1125n },
  ]);
});

test("yahoo rejeita HTTP ruim e chart.error", async () => {
  const bad = createYahooSource({ fetchImpl: async () => new Response("nope", { status: 502 }) });
  await assert.rejects(() => bad.fetchDaily(["WRLD11"], "2025-09-01", "2025-09-30"), /yahoo HTTP 502/);

  const errored = createYahooSource({
    fetchImpl: async () => new Response(JSON.stringify({ chart: { result: null, error: { description: "No data found" } } }), { status: 200 }),
  });
  await assert.rejects(() => errored.fetchDaily(["WRLD11"], "2025-09-01", "2025-09-30"), /yahoo erro para WRLD11: No data found/);
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test "src/sources/yahoo.test.ts"`
Expected: FAIL (`./yahoo.ts` não existe).

- [ ] **Step 4: Implementar `src/sources/yahoo.ts`**

```ts
import { CENTS, parseDecimal } from "../domain/money.ts";
import type { FetchLike, Quote, QuoteSource } from "./types.ts";

const BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const BRT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });

export type YahooChartResponse = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
    error?: { description?: string } | null;
  };
};

export type YahooDeps = { fetchImpl?: FetchLike };

const startOfDayUnix = (date: string): number => Math.floor(new Date(`${date}T00:00:00-03:00`).getTime() / 1000);
const endOfDayUnix = (date: string): number => Math.floor(new Date(`${date}T23:59:59-03:00`).getTime() / 1000);

export function createYahooSource(deps: YahooDeps = {}): QuoteSource {
  const fetchImpl: FetchLike = deps.fetchImpl ?? fetch;
  return {
    id: "yahoo",
    available: async () => true,
    async fetchDaily(symbols, from, to) {
      const quotes: Quote[] = [];
      for (const ticker of symbols) {
        const symbol = `${ticker}.SA`;
        const url = `${BASE}/${encodeURIComponent(symbol)}?period1=${startOfDayUnix(from)}&period2=${endOfDayUnix(to)}&interval=1d`;
        const response = await fetchImpl(url);
        if (!response.ok) throw new Error(`yahoo HTTP ${response.status} para ${ticker}`);
        const payload = (await response.json()) as YahooChartResponse;
        if (payload.chart?.error) throw new Error(`yahoo erro para ${ticker}: ${payload.chart.error.description ?? "desconhecido"}`);
        const result = payload.chart?.result?.[0];
        if (!result) throw new Error(`yahoo sem resultado para ${ticker}`);
        const timestamps = result.timestamp ?? [];
        const closes = result.indicators?.quote?.[0]?.close ?? [];
        for (let index = 0; index < timestamps.length; index++) {
          const close = closes[index];
          const timestamp = timestamps[index];
          if (typeof close !== "number" || close <= 0 || timestamp === undefined) continue;
          quotes.push({ ticker, date: BRT.format(new Date(timestamp * 1000)), closeCents: parseDecimal(close.toFixed(2), CENTS) });
        }
      }
      return quotes;
    },
  };
}
```

- [ ] **Step 5: Rodar tudo e commitar**

Run: `node --test "src/sources/yahoo.test.ts" && npm run typecheck`
Expected: PASS.

```bash
git add src/sources
git commit -m "feat: adapter yahoo chart v8 com close bruto e data BRT"
```

---

### Task 5: Fontes Alpha Vantage, BCB e registro explícito

**Files:**
- Create: `src/sources/alphavantage.ts`, `src/sources/alphavantage.test.ts`, `src/sources/bcb.ts`, `src/sources/bcb.test.ts`, `src/sources/index.ts`, `src/sources/index.test.ts`

**Interfaces:**
- Consumes: `CENTS`, `RATE_SCALE`, `parseDecimal`, `divRoundHalfUp` (`money.ts`); `FetchLike`, `Quote`, `IndexRate`, `IndexSeries` (`./types.ts`); `createYahooSource`, `createBcbSource`, `createAlphaVantageSource`.
- Produces:
  - `createAlphaVantageSource({ apiKey, fetchImpl? }): QuoteSource` (id `alphavantage`)
  - `createBcbSource({ fetchImpl? }): IndexSource` (id `bcb`)
  - `type SourceDeps = { fetchImpl?; alphaVantageApiKey? }`
  - `createQuoteSources(deps?): QuoteSource[]` (Yahoo sempre; AV só com chave)
  - `createIndexSource(deps?): IndexSource`

- [ ] **Step 1: Teste que falha — `src/sources/alphavantage.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAlphaVantageSource } from "./alphavantage.ts";

const fixture = {
  "Time Series (Daily)": {
    "2025-09-19": { "4. close": "11.2500" },
    "2025-09-17": { "4. close": "10.5000" },
  },
};

test("alphavantage converte close string e filtra a janela", async () => {
  const source = createAlphaVantageSource({
    apiKey: "chave",
    fetchImpl: async (url) => {
      assert.match(url, /WRLD11\.SAO/);
      assert.match(url, /outputsize=full/);
      return new Response(JSON.stringify(fixture), { status: 200 });
    },
  });
  assert.equal(await source.available(), true);
  const quotes = await source.fetchDaily(["WRLD11"], "2025-09-18", "2025-09-30");
  assert.deepEqual(quotes, [{ ticker: "WRLD11", date: "2025-09-19", closeCents: 1125n }]);
});

test("alphavantage sem chave não está disponível e recusa fetch", async () => {
  const source = createAlphaVantageSource({ apiKey: "" });
  assert.equal(await source.available(), false);
  await assert.rejects(() => source.fetchDaily(["WRLD11"], "2025-09-01", "2025-09-30"), /sem chave/);
});

test("alphavantage trata Note/Information como erro", async () => {
  const source = createAlphaVantageSource({
    apiKey: "chave",
    fetchImpl: async () => new Response(JSON.stringify({ Note: "Thank you for using Alpha Vantage! Our standard API rate limit is 25 requests per day." }), { status: 200 }),
  });
  await assert.rejects(() => source.fetchDaily(["WRLD11"], "2025-09-01", "2025-09-30"), /alphavantage recusou WRLD11/);
});
```

- [ ] **Step 2: Teste que falha — `src/sources/bcb.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createBcbSource } from "./bcb.ts";

test("bcb converte dd/mm/yyyy e % em fração e12", async () => {
  const source = createBcbSource({
    fetchImpl: async (url) => {
      assert.match(url, /bcdata\.sgs\.12/);
      assert.match(url, /dataInicial=01\/01\/2026/);
      return new Response(JSON.stringify([
        { data: "02/01/2026", valor: "0.0524" },
        { data: "05/01/2026", valor: "0.0525" },
      ]), { status: 200 });
    },
  });
  const rates = await source.fetchSeries("CDI", "2026-01-01", "2026-01-31");
  assert.deepEqual(rates, [
    { series: "CDI", date: "2026-01-02", valueE12: 524_000_000n },
    { series: "CDI", date: "2026-01-05", valueE12: 525_000_000n },
  ]);
});

test("bcb rejeita resposta que não é lista", async () => {
  const source = createBcbSource({ fetchImpl: async () => new Response(JSON.stringify({ erro: true }), { status: 200 }) });
  await assert.rejects(() => source.fetchSeries("IPCA", "2026-01-01", "2026-01-31"), /bcb resposta inesperada para IPCA/);
});
```

- [ ] **Step 3: Teste que falha — `src/sources/index.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createIndexSource, createQuoteSources } from "./index.ts";

test("registro inclui AV só com chave e BCB como fonte de índices", () => {
  assert.deepEqual(createQuoteSources({}).map((source) => source.id), ["yahoo"]);
  assert.deepEqual(createQuoteSources({ alphaVantageApiKey: "chave" }).map((source) => source.id), ["yahoo", "alphavantage"]);
  assert.equal(createIndexSource({}).id, "bcb");
});
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `node --test "src/sources/alphavantage.test.ts" "src/sources/bcb.test.ts" "src/sources/index.test.ts"`
Expected: FAIL (módulos não existem).

- [ ] **Step 5: Implementar `src/sources/alphavantage.ts`**

```ts
import { CENTS, parseDecimal } from "../domain/money.ts";
import type { FetchLike, Quote, QuoteSource } from "./types.ts";

const BASE = "https://www.alphavantage.co/query";

export type AlphaVantageDeps = { apiKey: string; fetchImpl?: FetchLike };

type DailyResponse = {
  "Time Series (Daily)"?: Record<string, { "4. close"?: string }>;
  Note?: string;
  Information?: string;
  "Error Message"?: string;
};

export function createAlphaVantageSource(deps: AlphaVantageDeps): QuoteSource {
  const fetchImpl: FetchLike = deps.fetchImpl ?? fetch;
  const configured = () => deps.apiKey.trim() !== "";
  return {
    id: "alphavantage",
    available: async () => configured(),
    async fetchDaily(symbols, from, to) {
      if (!configured()) throw new Error("alphavantage sem chave configurada");
      const quotes: Quote[] = [];
      for (const ticker of symbols) {
        const symbol = `${ticker}.SAO`;
        const url = `${BASE}?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}&outputsize=full&apikey=${encodeURIComponent(deps.apiKey)}`;
        const response = await fetchImpl(url);
        if (!response.ok) throw new Error(`alphavantage HTTP ${response.status} para ${ticker}`);
        const payload = (await response.json()) as DailyResponse;
        const refusal = payload.Note ?? payload.Information ?? payload["Error Message"];
        if (refusal) throw new Error(`alphavantage recusou ${ticker}: ${refusal.slice(0, 80)}`);
        const series = payload["Time Series (Daily)"];
        if (!series) throw new Error(`alphavantage sem série para ${ticker}`);
        for (const [date, values] of Object.entries(series)) {
          if (date < from || date > to) continue;
          const close = values["4. close"];
          if (close === undefined) continue;
          quotes.push({ ticker, date, closeCents: parseDecimal(close, CENTS) });
        }
      }
      return quotes;
    },
  };
}
```

- [ ] **Step 6: Implementar `src/sources/bcb.ts`**

```ts
import { RATE_SCALE, divRoundHalfUp, parseDecimal } from "../domain/money.ts";
import type { FetchLike, IndexRate, IndexSeries, IndexSource } from "./types.ts";

const BASE = "https://api.bcb.gov.br/dados/serie/bcdata.sgs";
const CODES: Record<IndexSeries, number> = { CDI: 12, SELIC: 11, IPCA: 433 };

export type BcbDeps = { fetchImpl?: FetchLike };

type SgsPoint = { data: string; valor: string };

const toBrDateParam = (date: string): string => {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
};

const toIsoDate = (date: string): string => {
  const [day, month, year] = date.split("/");
  return `${year}-${month}-${day}`;
};

export function createBcbSource(deps: BcbDeps = {}): IndexSource {
  const fetchImpl: FetchLike = deps.fetchImpl ?? fetch;
  return {
    id: "bcb",
    async fetchSeries(series, from, to) {
      const url = `${BASE}.${CODES[series]}/dados?formato=json&dataInicial=${toBrDateParam(from)}&dataFinal=${toBrDateParam(to)}`;
      const response = await fetchImpl(url);
      if (!response.ok) throw new Error(`bcb HTTP ${response.status} para ${series}`);
      const payload: unknown = await response.json();
      if (!Array.isArray(payload)) throw new Error(`bcb resposta inesperada para ${series}`);
      const rates: IndexRate[] = [];
      for (const point of payload as SgsPoint[]) {
        if (typeof point?.data !== "string" || typeof point?.valor !== "string") continue;
        rates.push({ series, date: toIsoDate(point.data), valueE12: divRoundHalfUp(parseDecimal(point.valor, RATE_SCALE), 100n) });
      }
      return rates;
    },
  };
}
```

- [ ] **Step 7: Implementar `src/sources/index.ts`**

```ts
import { createAlphaVantageSource } from "./alphavantage.ts";
import { createBcbSource } from "./bcb.ts";
import { createYahooSource } from "./yahoo.ts";
import type { FetchLike, IndexSource, QuoteSource } from "./types.ts";

export type SourceDeps = { fetchImpl?: FetchLike; alphaVantageApiKey?: string };

/** Fontes de preço em ordem de prioridade: Yahoo; Alpha Vantage só com chave. */
export function createQuoteSources(deps: SourceDeps = {}): QuoteSource[] {
  const sources: QuoteSource[] = [createYahooSource(deps)];
  const apiKey = deps.alphaVantageApiKey ?? "";
  if (apiKey.trim() !== "") sources.push(createAlphaVantageSource({ apiKey, fetchImpl: deps.fetchImpl }));
  return sources;
}

export function createIndexSource(deps: SourceDeps = {}): IndexSource {
  return createBcbSource(deps);
}
```

- [ ] **Step 8: Rodar tudo e commitar**

Run: `node --test "src/sources/*.test.ts" && npm run typecheck`
Expected: PASS.

```bash
git add src/sources
git commit -m "feat: fontes alphavantage e bcb com registro explicito"
```

---

### Task 6: Serviço refresh de cotações (settled, fallback, throttle)

**Files:**
- Create: `src/services/refresh-summary.ts`, `src/services/refresh-quotes.ts`, `src/services/refresh-quotes.test.ts`

**Interfaces:**
- Consumes: repos da T1; `toBrDate` (T2); `Quote`, `QuoteSource` (T4).
- Produces:
  - `type RefreshSourceSummary = { id; fetched; inserted; updated; skipped; errors: string[] }` e `emptySummary(id)`
  - `type QuoteRefreshDeps = { sources: QuoteSource[]; now?: () => Date; full?: boolean; fallbackAttempts?: Map<string, string> }`
  - `refreshQuotes(db, deps): Promise<RefreshSourceSummary[]>` (primária = `sources[0]`, fallback = `sources[1]`)

- [ ] **Step 1: Criar `src/services/refresh-summary.ts`**

```ts
export type RefreshSourceSummary = {
  id: string;
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
};

export function emptySummary(id: string): RefreshSourceSummary {
  return { id, fetched: 0, inserted: 0, updated: 0, skipped: 0, errors: [] };
}
```

- [ ] **Step 2: Teste que falha — `src/services/refresh-quotes.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import {
  insertInstruments, insertTransactions, listAllQuotes, listSourceStatus, writeQuotes,
} from "../db/repos.ts";
import type { InstrumentRow } from "../db/repos.ts";
import type { Quote, QuoteSource } from "../sources/types.ts";
import { refreshQuotes } from "./refresh-quotes.ts";

const equity: InstrumentRow = {
  id: "etf-1", legacyKey: "ETF 1", name: "ETF 1", kind: "equity", category: "etf_equity",
  ticker: "WRLD11", quoteSource: "yahoo", quoteSymbol: null, currency: "BRL",
  benchmark: null, rateE6: null, maturityDate: null, liquidity: null, broker: "XP",
  objective: "Aposentadoria", investor: "Ana",
};

function freshDb() {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [equity]);
  insertTransactions(db, [{ instrumentId: equity.id, tradeDate: "2025-04-23", kind: "BUY", quantityE8: 1_00000000n, grossCents: 1000n, feesCents: 0n, note: null, legacyRow: null }]);
  return db;
}

const fakeSource = (id: string, resolver: (ticker: string, from: string, to: string) => Quote[] | Promise<Quote[]>): QuoteSource => ({
  id,
  available: async () => true,
  fetchDaily: async (symbols, from, to) => resolver(symbols[0]!, from, to),
});

const NOW = () => new Date("2026-09-18T14:00:00-03:00");

test("refresh escreve fechado imutável e atualiza só o parcial de hoje", async () => {
  const db = freshDb();
  const calls: Array<{ from: string; to: string }> = [];
  const yahoo = fakeSource("yahoo", (_ticker, from, to) => {
    calls.push({ from, to });
    return [
      { ticker: "WRLD11", date: "2025-04-23", closeCents: 1000n },
      { ticker: "WRLD11", date: "2026-09-18", closeCents: 2000n },
    ];
  });
  const first = await refreshQuotes(db, { sources: [yahoo], now: NOW, fallbackAttempts: new Map() });
  assert.deepEqual(first[0], { id: "yahoo", fetched: 2, inserted: 2, updated: 0, skipped: 0, errors: [] });
  assert.equal(calls[0]?.from, "2025-04-23");

  const second = await refreshQuotes(db, {
    sources: [fakeSource("yahoo", () => [
      { ticker: "WRLD11", date: "2025-04-23", closeCents: 9999n },
      { ticker: "WRLD11", date: "2026-09-18", closeCents: 2100n },
    ])],
    now: NOW,
    fallbackAttempts: new Map(),
  });
  assert.deepEqual(second[0], { id: "yahoo", fetched: 2, inserted: 0, updated: 1, skipped: 1, errors: [] });
  assert.equal(calls[1]?.from, "2026-09-18");
  assert.deepEqual(listAllQuotes(db), [
    { ticker: "WRLD11", date: "2025-04-23", closeCents: 1000n, source: "yahoo", settled: true },
    { ticker: "WRLD11", date: "2026-09-18", closeCents: 2100n, source: "yahoo", settled: false },
  ]);
});

test("parcial de ontem finaliza no fetch do dia seguinte", async () => {
  const db = freshDb();
  await refreshQuotes(db, { sources: [fakeSource("yahoo", () => [{ ticker: "WRLD11", date: "2026-09-18", closeCents: 2000n }])], now: NOW, fallbackAttempts: new Map() });
  const nextDay = () => new Date("2026-09-19T10:00:00-03:00");
  const result = await refreshQuotes(db, { sources: [fakeSource("yahoo", () => [{ ticker: "WRLD11", date: "2026-09-18", closeCents: 2075n }])], now: nextDay, fallbackAttempts: new Map() });
  assert.deepEqual(result[0], { id: "yahoo", fetched: 1, inserted: 0, updated: 1, skipped: 0, errors: [] });
  assert.deepEqual(listAllQuotes(db)[0], { ticker: "WRLD11", date: "2026-09-18", closeCents: 2075n, source: "yahoo", settled: true });
});

test("fallback AV roda 1× no dia quando o Yahoo falha e registra erro do Yahoo", async () => {
  const db = freshDb();
  let avCalls = 0;
  const yahoo = fakeSource("yahoo", () => { throw new Error("yahoo fora do ar"); });
  const av = fakeSource("alphavantage", () => { avCalls++; return [{ ticker: "WRLD11", date: "2025-04-23", closeCents: 1234n }]; });
  const attempts = new Map<string, string>();
  const first = await refreshQuotes(db, { sources: [yahoo, av], now: NOW, fallbackAttempts: attempts });
  assert.equal(first[0]?.errors.length, 1);
  assert.match(first[0]?.errors[0] ?? "", /yahoo fora do ar/);
  assert.equal(first[1]?.inserted, 1);
  await refreshQuotes(db, { sources: [yahoo, av], now: NOW, fallbackAttempts: attempts });
  assert.equal(avCalls, 1, "segunda falha do Yahoo no mesmo dia não gasta cota do AV");
  assert.equal(listAllQuotes(db)[0]?.source, "alphavantage");
  const yahooStatus = listSourceStatus(db).find((status) => status.source === "yahoo");
  assert.equal(yahooStatus?.lastError !== null, true);
});

test("full ignora a fronteira e começa da 1ª transação", async () => {
  const db = freshDb();
  writeQuotes(db, [{ ticker: "WRLD11", date: "2026-09-17", closeCents: 1_000n, source: "yahoo", settled: true }], "2026-09-18");
  const froms: string[] = [];
  const source = fakeSource("yahoo", (_ticker, from) => { froms.push(from); return []; });
  await refreshQuotes(db, { sources: [source], now: NOW, fallbackAttempts: new Map() });
  await refreshQuotes(db, { sources: [source], now: NOW, full: true, fallbackAttempts: new Map() });
  assert.deepEqual(froms, ["2026-09-17", "2025-04-23"]);
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test "src/services/refresh-quotes.test.ts"`
Expected: FAIL (`./refresh-quotes.ts` não existe).

- [ ] **Step 4: Implementar `src/services/refresh-quotes.ts`**

```ts
import type { Db } from "../db/index.ts";
import {
  earliestTradeDate, hasQuoteFromSourceOnDate, listInstruments, quoteFrontier, recordSourceAttempt, writeQuotes,
} from "../db/repos.ts";
import { toBrDate } from "../domain/dates.ts";
import type { QuoteSource } from "../sources/types.ts";
import { emptySummary, type RefreshSourceSummary } from "./refresh-summary.ts";

export type QuoteRefreshDeps = {
  sources: QuoteSource[];
  now?: () => Date;
  full?: boolean;
  fallbackAttempts?: Map<string, string>;
};

const defaultAttempts = new Map<string, string>();

export async function refreshQuotes(db: Db, deps: QuoteRefreshDeps): Promise<RefreshSourceSummary[]> {
  const summaries = new Map<string, RefreshSourceSummary>(deps.sources.map((source) => [source.id, emptySummary(source.id)]));
  const [primary, fallback] = deps.sources;
  if (!primary) return [];
  const now = deps.now ?? (() => new Date());
  const today = toBrDate(now());
  const attempts = deps.fallbackAttempts ?? defaultAttempts;
  const floor = earliestTradeDate(db);
  const tickers = listInstruments(db)
    .filter((instrument) => instrument.kind === "equity" && instrument.ticker !== null)
    .map((instrument) => instrument.ticker as string);

  const trySource = async (source: QuoteSource, ticker: string, from: string): Promise<boolean> => {
    const summary = summaries.get(source.id)!;
    try {
      const quotes = await source.fetchDaily([ticker], from, today);
      const valid = quotes.filter((quote) => quote.date <= today && quote.closeCents > 0n);
      const written = writeQuotes(db, valid.map((quote) => ({ ...quote, source: source.id, settled: quote.date < today })), today);
      summary.fetched += valid.length;
      summary.inserted += written.inserted;
      summary.updated += written.updated;
      summary.skipped += written.skipped;
      return valid.length > 0;
    } catch (error) {
      summary.errors.push(`${ticker}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  };

  for (const ticker of tickers) {
    const from = deps.full ? floor : (quoteFrontier(db, ticker) ?? floor);
    if (from === null) continue;
    const primaryOk = await trySource(primary, ticker, from);
    if (primaryOk || !fallback) continue;
    const key = `${fallback.id}:${ticker}`;
    if (attempts.get(key) === today) continue;
    attempts.set(key, today);
    const fallbackOk = await trySource(fallback, ticker, from);
    if (!fallbackOk && summaries.get(fallback.id)!.errors.length === 0) {
      summaries.get(fallback.id)!.errors.push(`${ticker}: fallback não devolveu cotações`);
    }
  }

  for (const source of deps.sources) {
    const summary = summaries.get(source.id)!;
    recordSourceAttempt(db, source.id, summary.errors.length === 0 ? { ok: true } : { ok: false, error: summary.errors[0]! });
  }
  return [...summaries.values()];
}
```

- [ ] **Step 5: Rodar tudo e commitar**

Run: `node --test "src/services/refresh-quotes.test.ts" && npm run typecheck`
Expected: PASS.

```bash
git add src/services
git commit -m "feat: refresh de cotacoes com settled, fronteira e fallback av"
```

---

### Task 7: Serviço refresh de índices + orquestrador (mutex, full, source)

**Files:**
- Create: `src/services/refresh-indices.ts`, `src/services/refresh-indices.test.ts`, `src/services/refresh.ts`, `src/services/refresh.test.ts`

**Interfaces:**
- Consumes: repos T1; `toBrDate` T2; `IndexSource` T4; `refreshQuotes` T6; `createQuoteSources`/`createIndexSource` T5.
- Produces:
  - `refreshIndices(db, { source, now? }, full = false): Promise<RefreshSourceSummary>`
  - `class RefreshBusyError`, `type RefreshOptions = { full?; source? }`, `type RefreshResult = { sources: RefreshSourceSummary[] }`, `type RefreshDeps = { quoteSources?; indexSource?; now?; fallbackAttempts? }`
  - `refresh(db, options?, deps?): Promise<RefreshResult>`

- [ ] **Step 1: Teste que falha — `src/services/refresh-indices.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { insertInstruments, insertTransactions, listAllIndexRates, listSourceStatus } from "../db/repos.ts";
import type { InstrumentRow } from "../db/repos.ts";
import type { IndexSeries, IndexSource } from "../sources/types.ts";
import { refreshIndices } from "./refresh-indices.ts";

const cdb: InstrumentRow = {
  id: "cdb-1", legacyKey: "CDB 1", name: "CDB 1", kind: "fixed_income", category: "cdb",
  ticker: null, quoteSource: null, quoteSymbol: null, currency: "BRL", benchmark: "CDI",
  rateE6: 1_000_000n, maturityDate: null, liquidity: null, broker: "PagBank", objective: "Reserva", investor: "Ana",
};

test("refresh de índices grava uma vez, ignora reescrita e registra a fonte", async () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [cdb]);
  insertTransactions(db, [{ instrumentId: cdb.id, tradeDate: "2025-04-23", kind: "BUY", quantityE8: null, grossCents: 1000n, feesCents: 0n, note: null, legacyRow: null }]);
  const seen: IndexSeries[] = [];
  const bcb: IndexSource = {
    id: "bcb",
    fetchSeries: async (series) => {
      seen.push(series);
      return [{ series, date: "2025-04-23", valueE12: 500_000_000n }];
    },
  };
  const now = () => new Date("2026-09-18T07:00:00-03:00");
  const first = await refreshIndices(db, { source: bcb, now });
  assert.deepEqual(seen, ["CDI", "SELIC", "IPCA"]);
  assert.equal(first.inserted, 3);
  const second = await refreshIndices(db, { source: bcb, now });
  assert.equal(second.skipped, 3);
  assert.equal(listAllIndexRates(db).length, 3);
  assert.equal(listSourceStatus(db)[0]?.lastError, null);
});
```

- [ ] **Step 2: Teste que falha — `src/services/refresh.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { insertInstruments, insertTransactions } from "../db/repos.ts";
import type { InstrumentRow } from "../db/repos.ts";
import type { IndexSource, QuoteSource } from "../sources/types.ts";
import { RefreshBusyError, refresh } from "./refresh.ts";

const cdbInstrument: InstrumentRow = {
  id: "cdb-1", legacyKey: "CDB 1", name: "CDB 1", kind: "fixed_income", category: "cdb",
  ticker: null, quoteSource: null, quoteSymbol: null, currency: "BRL", benchmark: "CDI",
  rateE6: 1_000_000n, maturityDate: null, liquidity: null, broker: "PagBank", objective: "Reserva", investor: "Ana",
};

const emptyQuoteSource: QuoteSource = { id: "yahoo", available: async () => true, fetchDaily: async () => [] };
const emptyIndexSource: IndexSource = { id: "bcb", fetchSeries: async () => [] };

test("fonte desconhecida e alphavantage sem chave falham com erro claro", async () => {
  const db = openDb(":memory:");
  migrate(db);
  await assert.rejects(() => refresh(db, { source: "xpto" }, { quoteSources: [emptyQuoteSource], indexSource: emptyIndexSource }), /fonte desconhecida: xpto/);
  await assert.rejects(() => refresh(db, { source: "alphavantage" }, { quoteSources: [emptyQuoteSource], indexSource: emptyIndexSource }), /alphavantage não configurado/);
});

test("mutex barra refresh concorrente", async () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [cdbInstrument]);
  insertTransactions(db, [{ instrumentId: cdbInstrument.id, tradeDate: "2025-04-23", kind: "BUY", quantityE8: null, grossCents: 1000n, feesCents: 0n, note: null, legacyRow: null }]);
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const blocked: IndexSource = {
    id: "bcb",
    fetchSeries: async (series) => { await gate; return [{ series, date: "2026-09-17", valueE12: 1n }]; },
  };
  const first = refresh(db, { source: "bcb" }, { quoteSources: [], indexSource: blocked });
  await assert.rejects(() => refresh(db, { source: "bcb" }, { quoteSources: [], indexSource: blocked }), RefreshBusyError);
  release();
  const result = await first;
  assert.equal(result.sources[0]?.id, "bcb");
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test "src/services/refresh-indices.test.ts" "src/services/refresh.test.ts"`
Expected: FAIL (módulos não existem).

- [ ] **Step 4: Implementar `src/services/refresh-indices.ts`**

```ts
import type { Db } from "../db/index.ts";
import { earliestTradeDate, indexFrontier, recordSourceAttempt, writeIndexRates } from "../db/repos.ts";
import { toBrDate } from "../domain/dates.ts";
import type { IndexSeries, IndexSource } from "../sources/types.ts";
import { emptySummary, type RefreshSourceSummary } from "./refresh-summary.ts";

const SERIES: IndexSeries[] = ["CDI", "SELIC", "IPCA"];

export type IndexRefreshDeps = { source: IndexSource; now?: () => Date };

export async function refreshIndices(db: Db, deps: IndexRefreshDeps, full = false): Promise<RefreshSourceSummary> {
  const now = deps.now ?? (() => new Date());
  const today = toBrDate(now());
  const floor = earliestTradeDate(db);
  const summary = emptySummary(deps.source.id);
  for (const series of SERIES) {
    const from = full ? floor : (indexFrontier(db, series) ?? floor);
    if (from === null) continue;
    try {
      const rates = await deps.source.fetchSeries(series, from, today);
      const valid = rates.filter((rate) => rate.date <= today && rate.valueE12 > 0n);
      const written = writeIndexRates(db, valid);
      summary.fetched += valid.length;
      summary.inserted += written.inserted;
      summary.skipped += written.skipped;
    } catch (error) {
      summary.errors.push(`${series}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  recordSourceAttempt(db, deps.source.id, summary.errors.length === 0 ? { ok: true } : { ok: false, error: summary.errors[0]! });
  return summary;
}
```

- [ ] **Step 5: Implementar `src/services/refresh.ts`**

```ts
import type { Db } from "../db/index.ts";
import { createIndexSource, createQuoteSources } from "../sources/index.ts";
import type { IndexSource, QuoteSource } from "../sources/types.ts";
import { refreshIndices } from "./refresh-indices.ts";
import { refreshQuotes } from "./refresh-quotes.ts";
import type { RefreshSourceSummary } from "./refresh-summary.ts";

export class RefreshBusyError extends Error {
  constructor() {
    super("refresh em andamento");
    this.name = "RefreshBusyError";
  }
}

export type RefreshOptions = { full?: boolean; source?: string };
export type RefreshResult = { sources: RefreshSourceSummary[] };
export type RefreshDeps = {
  quoteSources?: QuoteSource[];
  indexSource?: IndexSource;
  now?: () => Date;
  fallbackAttempts?: Map<string, string>;
};

let running = false;

export async function refresh(db: Db, options: RefreshOptions = {}, deps: RefreshDeps = {}): Promise<RefreshResult> {
  if (running) throw new RefreshBusyError();
  running = true;
  try {
    const sourceDeps = { alphaVantageApiKey: process.env.ALPHAVANTAGE_API_KEY ?? "" };
    const quoteSources = deps.quoteSources ?? createQuoteSources(sourceDeps);
    const indexSource = deps.indexSource ?? createIndexSource(sourceDeps);
    const wanted = options.source;
    const wantsQuotes = wanted === undefined || wanted === "yahoo" || wanted === "alphavantage";
    const wantsIndices = wanted === undefined || wanted === "bcb";
    if (!wantsQuotes && !wantsIndices) throw new Error(`fonte desconhecida: ${wanted}`);

    const summaries: RefreshSourceSummary[] = [];
    if (wantsQuotes) {
      let sources = quoteSources;
      if (wanted === "alphavantage") {
        const alphaVantage = quoteSources.find((source) => source.id === "alphavantage");
        if (!alphaVantage) throw new Error("alphavantage não configurado (ALPHAVANTAGE_API_KEY ausente)");
        sources = [alphaVantage];
      } else if (wanted === "yahoo") {
        sources = quoteSources.filter((source) => source.id === "yahoo");
      }
      summaries.push(...(await refreshQuotes(db, { sources, now: deps.now, full: options.full, fallbackAttempts: deps.fallbackAttempts })));
    }
    if (wantsIndices) summaries.push(await refreshIndices(db, { source: indexSource, now: deps.now }, options.full));
    return { sources: summaries };
  } finally {
    running = false;
  }
}
```

- [ ] **Step 6: Rodar tudo e commitar**

Run: `node --test "src/services/*.test.ts" && npm run typecheck`
Expected: PASS.

```bash
git add src/services
git commit -m "feat: refresh de indices e orquestrador com mutex e fonte opcional"
```

---

### Task 8: Serviço portfolio + status de fonte

**Files:**
- Create: `src/services/status.ts`, `src/services/portfolio.ts`, `src/services/portfolio.test.ts`

**Interfaces:**
- Consumes: repos T1; `toBrDate` T2; `instrumentValue` T2; `SourceStatusRow`.
- Produces:
  - `type SourceSummary = { id; lastAttemptAt; lastSuccessAt; lastErrorAt; lastError; stale }`, `sourceSummary(row)`
  - `type PortfolioPosition`, `type PortfolioTotals`, `type PortfolioResult`
  - `buildPortfolio(db, { now? }): PortfolioResult` (posição `bigint | null`; `stale` = sem preço OU status da fonte do preço stale)

- [ ] **Step 1: Criar `src/services/status.ts`**

```ts
import type { SourceStatusRow } from "../db/repos.ts";

export type SourceSummary = {
  id: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  stale: boolean;
};

/** `stale` = a última tentativa falhou e é mais recente que o último sucesso. */
export function sourceSummary(row: SourceStatusRow): SourceSummary {
  const stale = row.lastAttemptAt !== null && row.lastErrorAt !== null && (row.lastSuccessAt === null || row.lastErrorAt > row.lastSuccessAt);
  return {
    id: row.source, lastAttemptAt: row.lastAttemptAt, lastSuccessAt: row.lastSuccessAt,
    lastErrorAt: row.lastErrorAt, lastError: row.lastError, stale,
  };
}
```

- [ ] **Step 2: Teste que falha — `src/services/portfolio.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import {
  insertInstruments, insertTransactions, recordSourceAttempt, writeIndexRates, writeQuotes,
} from "../db/repos.ts";
import type { InstrumentRow } from "../db/repos.ts";
import { buildPortfolio } from "./portfolio.ts";

const base = {
  currency: "BRL", quoteSource: null, quoteSymbol: null, maturityDate: null,
  liquidity: null, broker: "PagBank", objective: "Reserva", investor: "Ana",
} as const;

const cdb: InstrumentRow = { ...base, id: "cdb-1", legacyKey: "CDB 1", name: "CDB 1", kind: "fixed_income", category: "cdb", ticker: null, benchmark: "CDI", rateE6: 1_000_000n };
const etf: InstrumentRow = { ...base, id: "etf-1", legacyKey: "ETF 1", name: "ETF 1", kind: "equity", category: "etf_equity", ticker: "WRLD11", benchmark: null, rateE6: null };
const pgbl: InstrumentRow = { ...base, id: "pgbl-1", legacyKey: "PGBL 1", name: "PGBL 1", kind: "pension", category: "pension_ipca", ticker: null, benchmark: null, rateE6: null };

const NOW = () => new Date("2026-09-18T12:00:00-03:00");

test("portfolio calcula RF e RV, pendura PGBL e marca stale por fonte", () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [cdb, etf, pgbl]);
  insertTransactions(db, [
    { instrumentId: cdb.id, tradeDate: "2026-09-17", kind: "BUY", quantityE8: null, grossCents: 100_000n, feesCents: 0n, note: null, legacyRow: null },
    { instrumentId: etf.id, tradeDate: "2026-09-17", kind: "BUY", quantityE8: 10_00000000n, grossCents: 9_000n, feesCents: 100n, note: null, legacyRow: null },
    { instrumentId: pgbl.id, tradeDate: "2026-09-17", kind: "BUY", quantityE8: 5_00000000n, grossCents: 50_000n, feesCents: 0n, note: null, legacyRow: null },
  ]);
  writeIndexRates(db, [{ series: "CDI", date: "2026-09-17", valueE12: 1_000_000_000n }]);
  writeQuotes(db, [{ ticker: "WRLD11", date: "2026-09-17", closeCents: 1_000n, source: "yahoo", settled: true }], "2026-09-18");
  recordSourceAttempt(db, "bcb", { ok: true });
  recordSourceAttempt(db, "yahoo", { ok: false, error: "HTTP 502" });

  const portfolio = buildPortfolio(db, { now: NOW });
  assert.equal(portfolio.asOf, "2026-09-18");
  const [rf, equity, pension] = portfolio.positions;
  assert.equal(rf?.marketValueCents, 100_100n); // 0,1% CDI no dia 17
  assert.equal(rf?.priceSource, "bcb");
  assert.equal(rf?.stale, false);
  assert.equal(equity?.marketValueCents, 10_000n); // 10 cotas × R$ <valor>
  assert.equal(equity?.priceDate, "2026-09-17");
  assert.equal(equity?.stale, true); // yahoo com erro
  assert.equal(pension?.marketValueCents, null);
  assert.equal(pension?.stale, true);
  assert.deepEqual(portfolio.totals, { investedCents: 159_100n, redeemedCents: 0n, feesCents: 100n, marketValueCents: 110_100n });
  assert.equal(portfolio.sources.find((source) => source.id === "yahoo")?.stale, true);
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test "src/services/portfolio.test.ts"`
Expected: FAIL (`./portfolio.ts` não existe).

- [ ] **Step 4: Implementar `src/services/portfolio.ts`**

```ts
import type { Db } from "../db/index.ts";
import {
  listAllIndexRates, listAllQuotes, listAllTransactions, listInstruments, listSourceStatus,
} from "../db/repos.ts";
import { toBrDate } from "../domain/dates.ts";
import type { InstrumentCategory, InstrumentKind } from "../domain/model.ts";
import { instrumentValue, type PositionValue } from "../domain/position.ts";
import { sourceSummary, type SourceSummary } from "./status.ts";

export type PortfolioPosition = PositionValue & {
  instrumentId: string;
  name: string;
  kind: InstrumentKind;
  category: InstrumentCategory;
  broker: string | null;
  objective: string | null;
  benchmark: string | null;
  rateE6: bigint | null;
  priceSource: string | null;
  stale: boolean;
};

export type PortfolioTotals = {
  investedCents: bigint;
  redeemedCents: bigint;
  feesCents: bigint;
  marketValueCents: bigint;
};

export type PortfolioResult = {
  asOf: string;
  totals: PortfolioTotals;
  positions: PortfolioPosition[];
  sources: SourceSummary[];
};

export function buildPortfolio(db: Db, deps: { now?: () => Date } = {}): PortfolioResult {
  const now = deps.now ?? (() => new Date());
  const asOf = toBrDate(now());
  const instruments = listInstruments(db);
  const transactions = listAllTransactions(db);
  const quotes = listAllQuotes(db);
  const rates = listAllIndexRates(db);
  const statuses = new Map(listSourceStatus(db).map((row) => [row.source, sourceSummary(row)]));
  const staleOf = (source: string | null): boolean => source === null || (statuses.get(source)?.stale ?? true);

  const positions: PortfolioPosition[] = instruments.map((instrument) => {
    const instrumentTransactions = transactions.filter((transaction) => transaction.instrumentId === instrument.id);
    const instrumentQuotes = instrument.ticker === null ? [] : quotes.filter((quote) => quote.ticker === instrument.ticker);
    const series = instrument.benchmark === "SELIC" ? "SELIC" : instrument.benchmark === "CDI" ? "CDI" : null;
    const instrumentRates = series === null ? [] : rates.filter((rate) => rate.series === series);
    const value = instrumentValue({
      kind: instrument.kind, benchmark: instrument.benchmark, rateE6: instrument.rateE6,
      transactions: instrumentTransactions, quotes: instrumentQuotes, rates: instrumentRates,
    }, asOf);
    const priceSource = instrument.kind === "equity"
      ? (instrumentQuotes.filter((quote) => quote.date <= asOf).at(-1)?.source ?? null)
      : instrument.kind === "fixed_income" ? "bcb" : null;
    const stale = value.marketValueCents === null || (instrument.kind === "fixed_income" && value.priceDate === null) || staleOf(priceSource);
    return {
      ...value, instrumentId: instrument.id, name: instrument.name, kind: instrument.kind, category: instrument.category,
      broker: instrument.broker, objective: instrument.objective, benchmark: instrument.benchmark, rateE6: instrument.rateE6,
      priceSource, stale,
    };
  });

  const totals = positions.reduce<PortfolioTotals>((acc, position) => ({
    investedCents: acc.investedCents + position.investedCents,
    redeemedCents: acc.redeemedCents + position.redeemedCents,
    feesCents: acc.feesCents + position.feesCents,
    marketValueCents: acc.marketValueCents + (position.marketValueCents ?? 0n),
  }), { investedCents: 0n, redeemedCents: 0n, feesCents: 0n, marketValueCents: 0n });

  return { asOf, totals, positions, sources: [...statuses.values()] };
}
```

- [ ] **Step 5: Rodar tudo e commitar**

Run: `node --test "src/services/*.test.ts" && npm run typecheck`
Expected: PASS.

```bash
git add src/services
git commit -m "feat: service de portfolio com stale por fonte de preco"
```

---

### Task 9: Serviços de histórico e alocação

**Files:**
- Create: `src/services/history.ts`, `src/services/history.test.ts`, `src/services/allocation.ts`, `src/services/allocation.test.ts`

**Interfaces:**
- Consumes: repos T1; datas T2; `instrumentValue` T2; `cdiMonthPct`/`ipcaMonthPct`/`groupAllocation`/`ALLOCATION_BY` T3; `buildPortfolio` T8.
- Produces:
  - `type HistoryPoint`, `type HistoryOptions = { from?; to? }`, `buildHistory(db, options?, { now? }): HistoryPoint[]`
  - `buildAllocation(db, by, { now? }): { by; groups: [{ key; marketValueCents; pct }] }`

- [ ] **Step 1: Teste que falha — `src/services/history.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { insertInstruments, insertTransactions, writeIndexRates } from "../db/repos.ts";
import type { InstrumentRow } from "../db/repos.ts";
import { buildHistory } from "./history.ts";

const cdb: InstrumentRow = {
  id: "cdb-1", legacyKey: "CDB 1", name: "CDB 1", kind: "fixed_income", category: "cdb",
  ticker: null, quoteSource: null, quoteSymbol: null, currency: "BRL", benchmark: "CDI",
  rateE6: 1_000_000n, maturityDate: null, liquidity: null, broker: "PagBank",
  objective: "Reserva", investor: "Ana",
};

test("history devolve 12 meses com total, aportes e índices do mês", () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [cdb]);
  insertTransactions(db, [
    { instrumentId: cdb.id, tradeDate: "2026-01-02", kind: "BUY", quantityE8: null, grossCents: 100_000n, feesCents: 5_000n, note: null, legacyRow: null },
    { instrumentId: cdb.id, tradeDate: "2026-02-10", kind: "SELL", quantityE8: null, grossCents: 20_000n, feesCents: 0n, note: null, legacyRow: null },
  ]);
  writeIndexRates(db, [
    { series: "CDI", date: "2026-01-02", valueE12: 1_000_000_000n },
    { series: "IPCA", date: "2026-01-01", valueE12: 4_200_000_000n },
  ]);
  const now = () => new Date("2026-09-18T12:00:00-03:00");
  const points = buildHistory(db, {}, { now });
  assert.equal(points.length, 12);
  assert.equal(points[0]?.month, "2025-10");
  const jan = points.find((point) => point.month === "2026-01");
  assert.equal(jan?.investedCents, 105_000n);
  assert.equal(jan?.marketValueCents, 100_100n);
  assert.equal(jan?.cdiPct, 0.1);
  assert.equal(jan?.ipcaPct, 0.42);
  const feb = points.find((point) => point.month === "2026-02");
  assert.equal(feb?.marketValueCents, 80_100n, "resgate de 20_000 sai do saldo capitalizado");
  assert.equal(feb?.redeemedCents, 20_000n);
  const sep = points.find((point) => point.month === "2026-09");
  assert.equal(sep?.marketValueCents, 80_100n, "mês corrente usa hoje como asOf");
});
```

- [ ] **Step 2: Teste que falha — `src/services/allocation.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { insertInstruments, insertTransactions, writeQuotes } from "../db/repos.ts";
import type { InstrumentRow } from "../db/repos.ts";
import { buildAllocation } from "./allocation.ts";

const base = {
  currency: "BRL", quoteSource: null, quoteSymbol: null, maturityDate: null,
  liquidity: null, investor: "Ana",
} as const;

const etfA: InstrumentRow = { ...base, id: "a", legacyKey: "A", name: "A", kind: "equity", category: "etf_equity", ticker: "WRLD11", benchmark: null, rateE6: null, broker: "XP", objective: "Aposentadoria" };
const etfB: InstrumentRow = { ...base, id: "b", legacyKey: "B", name: "B", kind: "equity", category: "etf_fixed", ticker: "B5P211", benchmark: null, rateE6: null, broker: "XP", objective: "Reserva" };

test("allocation agrupa por categoria com percentual", () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [etfA, etfB]);
  insertTransactions(db, [
    { instrumentId: "a", tradeDate: "2026-09-17", kind: "BUY", quantityE8: 10_00000000n, grossCents: 1_000n, feesCents: 0n, note: null, legacyRow: null },
    { instrumentId: "b", tradeDate: "2026-09-17", kind: "BUY", quantityE8: 30_00000000n, grossCents: 1_000n, feesCents: 0n, note: null, legacyRow: null },
  ]);
  writeQuotes(db, [
    { ticker: "WRLD11", date: "2026-09-17", closeCents: 1_000n, source: "yahoo", settled: true },
    { ticker: "B5P211", date: "2026-09-17", closeCents: 1_000n, source: "yahoo", settled: true },
  ], "2026-09-18");
  const result = buildAllocation(db, "category", { now: () => new Date("2026-09-18T12:00:00-03:00") });
  assert.deepEqual(result.groups, [
    { key: "etf_fixed", marketValueCents: 30_000n, pct: 75 },
    { key: "etf_equity", marketValueCents: 10_000n, pct: 25 },
  ]);
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test "src/services/history.test.ts" "src/services/allocation.test.ts"`
Expected: FAIL (módulos não existem).

- [ ] **Step 4: Implementar `src/services/history.ts`**

```ts
import type { Db } from "../db/index.ts";
import { listAllIndexRates, listAllQuotes, listAllTransactions, listInstruments } from "../db/repos.ts";
import { addMonths, monthEnd, monthRange, toBrDate } from "../domain/dates.ts";
import { cdiMonthPct, ipcaMonthPct } from "../domain/evolution.ts";
import { instrumentValue } from "../domain/position.ts";
import type { TransactionRow } from "../db/repos.ts";

export type HistoryPoint = {
  month: string;
  marketValueCents: bigint;
  investedCents: bigint;
  redeemedCents: bigint;
  cdiPct: number | null;
  ipcaPct: number | null;
};

export type HistoryOptions = { from?: string; to?: string };

function sumMonth(transactions: TransactionRow[], month: string, kind: "BUY" | "SELL"): bigint {
  return transactions
    .filter((transaction) => transaction.kind === kind && transaction.tradeDate.slice(0, 7) === month)
    .reduce((total, transaction) => total + transaction.grossCents + (kind === "BUY" ? transaction.feesCents : 0n), 0n);
}

export function buildHistory(db: Db, options: HistoryOptions = {}, deps: { now?: () => Date } = {}): HistoryPoint[] {
  const now = deps.now ?? (() => new Date());
  const today = toBrDate(now());
  const currentMonth = today.slice(0, 7);
  const to = options.to ?? currentMonth;
  const from = options.from ?? addMonths(to, -11);
  const instruments = listInstruments(db);
  const transactions = listAllTransactions(db);
  const quotes = listAllQuotes(db);
  const rates = listAllIndexRates(db);
  const cdiRates = rates.filter((rate) => rate.series === "CDI");
  const ipcaRates = rates.filter((rate) => rate.series === "IPCA");

  return monthRange(from, to).map((month) => {
    const asOf = month === currentMonth ? today : monthEnd(month);
    let marketValueCents = 0n;
    let investedCents = 0n;
    let redeemedCents = 0n;
    for (const instrument of instruments) {
      const instrumentTransactions = transactions.filter((transaction) => transaction.instrumentId === instrument.id);
      const instrumentQuotes = instrument.ticker === null ? [] : quotes.filter((quote) => quote.ticker === instrument.ticker);
      const series = instrument.benchmark === "SELIC" ? "SELIC" : instrument.benchmark === "CDI" ? "CDI" : null;
      const instrumentRates = series === null ? [] : rates.filter((rate) => rate.series === series);
      const value = instrumentValue({
        kind: instrument.kind, benchmark: instrument.benchmark, rateE6: instrument.rateE6,
        transactions: instrumentTransactions, quotes: instrumentQuotes, rates: instrumentRates,
      }, asOf);
      marketValueCents += value.marketValueCents ?? 0n;
      investedCents += sumMonth(instrumentTransactions, month, "BUY");
      redeemedCents += sumMonth(instrumentTransactions, month, "SELL");
    }
    return { month, marketValueCents, investedCents, redeemedCents, cdiPct: cdiMonthPct(cdiRates, month), ipcaPct: ipcaMonthPct(ipcaRates, month) };
  });
}
```

- [ ] **Step 5: Implementar `src/services/allocation.ts`**

```ts
import type { Db } from "../db/index.ts";
import { ALLOCATION_BY, groupAllocation, type AllocationBy } from "../domain/allocation.ts";
import { divRoundHalfUp } from "../domain/money.ts";
import { buildPortfolio } from "./portfolio.ts";

export { ALLOCATION_BY };
export type { AllocationBy };

export type AllocationResult = {
  by: AllocationBy;
  groups: Array<{ key: string; marketValueCents: bigint; pct: number }>;
};

export function buildAllocation(db: Db, by: AllocationBy, deps: { now?: () => Date } = {}): AllocationResult {
  const portfolio = buildPortfolio(db, deps);
  const total = portfolio.totals.marketValueCents;
  const groups = groupAllocation(portfolio.positions, by).map((group) => ({
    ...group,
    pct: total === 0n ? 0 : Number(divRoundHalfUp(group.marketValueCents * 10_000n, total)) / 100,
  }));
  return { by, groups };
}
```

- [ ] **Step 6: Rodar tudo e commitar**

Run: `node --test "src/services/*.test.ts" && npm run typecheck`
Expected: PASS.

```bash
git add src/services
git commit -m "feat: services de historico mensal e alocacao"
```

---

### Task 10: Rotas novas + health + app + README

**Files:**
- Create: `src/api/routes/portfolio.ts`, `src/api/routes/refresh.ts`
- Modify: `src/api/routes/health.ts`, `src/app.ts`, `src/api/app.test.ts`, `README.md`

**Interfaces:**
- Consumes: `buildPortfolio` T8; `buildHistory`, `buildAllocation` T9; `refresh`, `RefreshBusyError`, `RefreshDeps` T7; `listSourceStatus` T1, `sourceSummary` T8.
- Produces:
  - `registerPortfolioRoutes(app, db)` (`GET /api/portfolio`, `GET /api/history`, `GET /api/allocation`)
  - `registerRefreshRoutes(app, db, deps?)` (`POST /api/refresh`, 409 busy, 400 fonte/chave)
  - `buildApp({ db, csvDir, logger?, webDir?, refreshDeps? })`; health com `sources`

- [ ] **Step 1: Implementar `src/api/routes/portfolio.ts`**

```ts
import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/index.ts";
import { toNumberSafe } from "../../domain/money.ts";
import { buildAllocation, ALLOCATION_BY } from "../../services/allocation.ts";
import { buildHistory } from "../../services/history.ts";
import { buildPortfolio } from "../../services/portfolio.ts";

const isMonth = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}$/.test(value);

export function registerPortfolioRoutes(app: FastifyInstance, db: Db): void {
  app.get("/api/portfolio", () => {
    const portfolio = buildPortfolio(db);
    return {
      asOf: portfolio.asOf,
      totals: {
        investedCents: toNumberSafe(portfolio.totals.investedCents),
        redeemedCents: toNumberSafe(portfolio.totals.redeemedCents),
        feesCents: toNumberSafe(portfolio.totals.feesCents),
        marketValueCents: toNumberSafe(portfolio.totals.marketValueCents),
      },
      positions: portfolio.positions.map((position) => ({
        instrumentId: position.instrumentId, name: position.name, kind: position.kind, category: position.category,
        broker: position.broker, objective: position.objective, benchmark: position.benchmark,
        rateE6: position.rateE6 === null ? null : toNumberSafe(position.rateE6),
        quantityE8: position.quantityE8 === null ? null : toNumberSafe(position.quantityE8),
        priceCents: position.priceCents === null ? null : toNumberSafe(position.priceCents),
        priceDate: position.priceDate, priceSource: position.priceSource,
        marketValueCents: position.marketValueCents === null ? null : toNumberSafe(position.marketValueCents),
        investedCents: toNumberSafe(position.investedCents), redeemedCents: toNumberSafe(position.redeemedCents),
        feesCents: toNumberSafe(position.feesCents), stale: position.stale,
      })),
      sources: portfolio.sources,
    };
  });

  app.get<{ Querystring: { from?: string; to?: string } }>("/api/history", (request, reply) => {
    const { from, to } = request.query;
    if ((from !== undefined && !isMonth(from)) || (to !== undefined && !isMonth(to))) {
      return reply.code(400).send({ error: "from/to devem ser YYYY-MM" });
    }
    return buildHistory(db, { from, to }).map((point) => ({
      month: point.month,
      marketValueCents: toNumberSafe(point.marketValueCents),
      investedCents: toNumberSafe(point.investedCents),
      redeemedCents: toNumberSafe(point.redeemedCents),
      cdiPct: point.cdiPct,
      ipcaPct: point.ipcaPct,
    }));
  });

  app.get<{ Querystring: { by?: string } }>("/api/allocation", (request, reply) => {
    const by = request.query.by ?? "category";
    if (!(ALLOCATION_BY as readonly string[]).includes(by)) {
      return reply.code(400).send({ error: "by deve ser category, broker ou objective" });
    }
    const allocation = buildAllocation(db, by as (typeof ALLOCATION_BY)[number]);
    return {
      by: allocation.by,
      groups: allocation.groups.map((group) => ({
        key: group.key, marketValueCents: toNumberSafe(group.marketValueCents), pct: group.pct,
      })),
    };
  });
}
```

- [ ] **Step 2: Implementar `src/api/routes/refresh.ts`**

```ts
import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/index.ts";
import { refresh, RefreshBusyError, type RefreshDeps } from "../../services/refresh.ts";

export function registerRefreshRoutes(app: FastifyInstance, db: Db, deps: RefreshDeps = {}): void {
  app.post<{ Querystring: { full?: string; source?: string } }>("/api/refresh", async (request, reply) => {
    const full = request.query.full === "1" || request.query.full === "true";
    try {
      const result = await refresh(db, { full, source: request.query.source }, deps);
      return {
        sources: result.sources.map((summary) => ({
          id: summary.id, fetched: summary.fetched, inserted: summary.inserted,
          updated: summary.updated, skipped: summary.skipped, errors: summary.errors,
        })),
      };
    } catch (error) {
      if (error instanceof RefreshBusyError) return reply.code(409).send({ error: error.message });
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
```

- [ ] **Step 3: `src/api/routes/health.ts` ganha `sources`**

```ts
import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/index.ts";
import { counts, listSourceStatus } from "../../db/repos.ts";
import { sourceSummary } from "../../services/status.ts";

export function registerHealthRoutes(app: FastifyInstance, db: Db): void {
  app.get("/api/health", () => ({ ok: true, counts: counts(db), sources: listSourceStatus(db).map(sourceSummary) }));
}
```

- [ ] **Step 4: `src/app.ts` registra as rotas e aceita `refreshDeps`**

```ts
import { existsSync } from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import type { Db } from "./db/index.ts";
import { registerHealthRoutes } from "./api/routes/health.ts";
import { registerImportRoutes } from "./api/routes/import.ts";
import { registerInstrumentsRoutes } from "./api/routes/instruments.ts";
import { registerPortfolioRoutes } from "./api/routes/portfolio.ts";
import { registerRefreshRoutes } from "./api/routes/refresh.ts";
import type { RefreshDeps } from "./services/refresh.ts";

export function buildApp(options: {
  db: Db; csvDir: string; logger?: boolean; webDir?: string; refreshDeps?: RefreshDeps;
}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 20 * 1024 * 1024 });
  registerInstrumentsRoutes(app, options.db);
  registerImportRoutes(app, options.db, options.csvDir);
  registerHealthRoutes(app, options.db);
  registerPortfolioRoutes(app, options.db);
  registerRefreshRoutes(app, options.db, options.refreshDeps);

  if (options.webDir && existsSync(options.webDir)) {
    app.register(fastifyStatic, { root: options.webDir });
    app.setNotFoundHandler((request, reply) => {
      if ((request.raw.url ?? "").startsWith("/api")) {
        return reply.code(404).send({ error: "not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}
```

- [ ] **Step 5: Atualizar o teste existente do health**

Em `src/api/app.test.ts`, o primeiro teste muda a asserção (health agora tem `sources: []`):

```ts
  assert.deepEqual(res.json(), { ok: true, counts: { instruments: 0, transactions: 0, legacySnapshots: 0, importRuns: 0 }, sources: [] });
```

- [ ] **Step 6: Testes novos em `src/api/app.test.ts`**

Ajustar imports do topo para incluir:

```ts
import { insertInstruments, insertTransactions, writeIndexRates, writeQuotes } from "../db/repos.ts";
import type { InstrumentRow } from "../db/repos.ts";
import type { IndexSource, QuoteSource } from "../sources/types.ts";
```

E adicionar ao final:

```ts
const baseInstrument = {
  currency: "BRL", quoteSource: null, quoteSymbol: null, maturityDate: null,
  liquidity: null, broker: "PagBank", objective: "Reserva", investor: "Ana",
} as const;

const cdbInstrument: InstrumentRow = {
  ...baseInstrument, id: "cdb-1", legacyKey: "CDB 1", name: "CDB 1", kind: "fixed_income",
  category: "cdb", ticker: null, benchmark: "CDI", rateE6: 1_000_000n,
};

const etfInstrument: InstrumentRow = {
  ...baseInstrument, id: "etf-1", legacyKey: "ETF 1", name: "ETF 1", kind: "equity",
  category: "etf_equity", ticker: "WRLD11", benchmark: null, rateE6: null, broker: "XP",
};

function seedPortfolio(db: ReturnType<typeof openDb>) {
  insertInstruments(db, [cdbInstrument, etfInstrument]);
  insertTransactions(db, [
    { instrumentId: cdbInstrument.id, tradeDate: "2026-09-17", kind: "BUY", quantityE8: null, grossCents: 100_000n, feesCents: 0n, note: null, legacyRow: null },
    { instrumentId: etfInstrument.id, tradeDate: "2026-09-17", kind: "BUY", quantityE8: 10_00000000n, grossCents: 9_000n, feesCents: 0n, note: null, legacyRow: null },
  ]);
  writeIndexRates(db, [{ series: "CDI", date: "2026-09-17", valueE12: 1_000_000_000n }]);
  writeQuotes(db, [{ ticker: "WRLD11", date: "2026-09-17", closeCents: 1_000n, source: "yahoo", settled: true }], "2026-09-18");
}

test("rotas de portfolio, history e allocation respondem em centavos", async () => {
  const db = openDb(":memory:");
  migrate(db);
  seedPortfolio(db);
  const app = buildApp({ db, csvDir: csvDirFixture(), logger: false });

  let res = await app.inject({ method: "GET", url: "/api/portfolio" });
  assert.equal(res.statusCode, 200);
  const portfolio = res.json();
  assert.equal(portfolio.totals.marketValueCents, 110_100);
  assert.equal(portfolio.positions.length, 2);
  assert.equal(portfolio.positions[0].priceSource, "bcb");

  res = await app.inject({ method: "GET", url: "/api/history?from=2026-08&to=2026-09" });
  assert.equal(res.json().length, 2);
  assert.equal(res.json()[1].marketValueCents, 110_100);

  res = await app.inject({ method: "GET", url: "/api/history?from=26-08" });
  assert.equal(res.statusCode, 400);

  res = await app.inject({ method: "GET", url: "/api/allocation?by=broker" });
  assert.deepEqual(res.json().groups, [
    { key: "PagBank", marketValueCents: 100_100, pct: 90.92 },
    { key: "XP", marketValueCents: 10_000, pct: 9.08 },
  ]);

  res = await app.inject({ method: "GET", url: "/api/allocation?by=nada" });
  assert.equal(res.statusCode, 400);

  await app.close();
});

test("POST /api/refresh usa as fontes injetadas e atualiza o health", async () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [etfInstrument]);
  insertTransactions(db, [{ instrumentId: etfInstrument.id, tradeDate: "2025-04-23", kind: "BUY", quantityE8: 10_00000000n, grossCents: 9_000n, feesCents: 0n, note: null, legacyRow: null }]);
  const yahoo: QuoteSource = {
    id: "yahoo",
    available: async () => true,
    fetchDaily: async () => [{ ticker: "WRLD11", date: "2026-09-17", closeCents: 1_000n }],
  };
  const bcb: IndexSource = {
    id: "bcb",
    fetchSeries: async (series) => [{ series, date: "2026-09-17", valueE12: 1_000_000_000n }],
  };
  const app = buildApp({
    db, csvDir: csvDirFixture(), logger: false,
    refreshDeps: { quoteSources: [yahoo], indexSource: bcb, now: () => new Date("2026-09-18T12:00:00-03:00") },
  });

  const res = await app.inject({ method: "POST", url: "/api/refresh" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().sources.map((source: { id: string }) => source.id), ["yahoo", "bcb"]);

  const health = (await app.inject({ method: "GET", url: "/api/health" })).json();
  assert.deepEqual(health.sources.map((source: { id: string }) => source.id), ["bcb", "yahoo"]);
  assert.equal(health.sources.every((source: { stale: boolean }) => source.stale === false), true);

  const bad = await app.inject({ method: "POST", url: "/api/refresh?source=xpto" });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.json().error, /fonte desconhecida: xpto/);

  const av = await app.inject({ method: "POST", url: "/api/refresh?source=alphavantage" });
  assert.equal(av.statusCode, 400);
  assert.match(av.json().error, /alphavantage não configurado/);

  await app.close();
});
```

- [ ] **Step 7: README ganha as rotas e a chave**

Na tabela de API, adicionar as linhas:

```markdown
| `GET /api/portfolio` | posições + totais (RF capitalizada, RV = cotas × fechamento) |
| `GET /api/history?from=YYYY-MM&to=YYYY-MM` | evolução mensal (default: 12 meses) |
| `GET /api/allocation?by=category\|broker\|objective` | alocação por critério |
| `POST /api/refresh?full=1&source=yahoo\|alphavantage\|bcb` | coleta manual; `full=1` refaz a janela |
```

E, em Dev, após a linha do `npm run dev`:

```markdown
    # cotações/índices: job roda no processo (10 min no pregão, índices às 7h);
    # ALPHAVANTAGE_API_KEY no .env habilita o fallback do Yahoo.
```

- [ ] **Step 8: Rodar tudo e commitar**

Run: `npm test && npm run typecheck`
Expected: PASS (todos os testes, incluindo o health atualizado).

```bash
git add src/api src/app.ts README.md
git commit -m "feat: rotas de portfolio, historico, alocacao e refresh com fontes no health"
```

---

### Task 11: Job node-cron + wiring no server

**Files:**
- Create: `src/jobs/scheduler.ts`, `src/jobs/scheduler.test.ts`
- Modify: `src/server.ts`, `package.json`

**Interfaces:**
- Consumes: `refresh`, `RefreshOptions` T7.
- Produces:
  - `CRON_QUOTES`, `CRON_INDICES`, `type CronLike`, `type SchedulerOptions`
  - `startScheduler(db, options?): { stop(): void; runNow(): void }`

- [ ] **Step 1: Instalar a dependência**

Run: `npm install node-cron`
Expected: `package.json` ganha `node-cron` (tipos inclusos); `package-lock.json` modificado — **não commitar o lock nesta layer**.

- [ ] **Step 2: Teste que falha — `src/jobs/scheduler.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import type { RefreshOptions } from "../services/refresh.ts";
import { CRON_INDICES, CRON_QUOTES, startScheduler, type CronLike } from "./scheduler.ts";

test("scheduler registra os dois cron e dispara o refresh certo", () => {
  const db = openDb(":memory:");
  migrate(db);
  const scheduled: Array<{ expression: string; callback: () => void; timezone: string }> = [];
  let stops = 0;
  const cron: CronLike = {
    schedule: (expression, callback, options) => {
      scheduled.push({ expression, callback, timezone: options.timezone });
      return { stop: () => { stops++; } };
    },
  };
  const calls: Array<RefreshOptions | undefined> = [];
  const scheduler = startScheduler(db, {
    cron,
    refreshFn: async (_db, options) => { calls.push(options); },
    onError: () => {},
  });

  assert.deepEqual(scheduled.map((task) => task.expression), [CRON_QUOTES, CRON_INDICES]);
  assert.equal(scheduled[0]?.expression, "*/10 10-17 * * 1-5");
  assert.equal(scheduled[1]?.expression, "0 7 * * *");
  assert.equal(scheduled.every((task) => task.timezone === "America/Sao_Paulo"), true);

  scheduled[0]?.callback();
  scheduled[1]?.callback();
  assert.deepEqual(calls, [{}, { source: "bcb" }]);

  scheduler.stop();
  assert.equal(stops, 2);
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test "src/jobs/scheduler.test.ts"`
Expected: FAIL (`./scheduler.ts` não existe).

- [ ] **Step 4: Implementar `src/jobs/scheduler.ts`**

```ts
import cron from "node-cron";
import type { Db } from "../db/index.ts";
import { refresh, type RefreshOptions } from "../services/refresh.ts";

export const CRON_QUOTES = "*/10 10-17 * * 1-5";
export const CRON_INDICES = "0 7 * * *";

export type CronTask = { stop: () => void };
export type CronLike = {
  schedule: (expression: string, callback: () => void, options: { timezone: string }) => CronTask;
};

export type SchedulerOptions = {
  timezone?: string;
  cron?: CronLike;
  refreshFn?: (db: Db, options?: RefreshOptions) => Promise<unknown>;
  onError?: (error: unknown) => void;
};

export function startScheduler(db: Db, options: SchedulerOptions = {}): { stop: () => void; runNow: () => void } {
  const timezone = options.timezone ?? "America/Sao_Paulo";
  const cronImpl = (options.cron ?? cron) as CronLike;
  const refreshFn = options.refreshFn ?? refresh;
  const onError = options.onError ?? ((error: unknown) => { console.error(error); });
  const run = (refreshOptions: RefreshOptions) => { void refreshFn(db, refreshOptions).catch(onError); };

  const quotesTask = cronImpl.schedule(CRON_QUOTES, () => run({}), { timezone });
  const indicesTask = cronImpl.schedule(CRON_INDICES, () => run({ source: "bcb" }), { timezone });

  return {
    stop: () => { quotesTask.stop(); indicesTask.stop(); },
    runNow: () => run({}),
  };
}
```

- [ ] **Step 5: `src/server.ts` liga o scheduler**

```ts
import { resolve } from "node:path";
import { buildApp } from "./app.ts";
import { openDb } from "./db/index.ts";
import { migrate } from "./db/migrate.ts";
import { startScheduler } from "./jobs/scheduler.ts";

const dbPath = resolve(process.env.DB_PATH ?? "data/investments.db");
const csvDir = resolve(process.env.CSV_DIR ?? "data/csv");
const webDir = resolve(process.env.WEB_DIR ?? "web/dist");
const port = Number(process.env.PORT ?? 3000);

const db = openDb(dbPath);
const applied = migrate(db);
const app = buildApp({ db, csvDir, logger: true, webDir });

app.listen({ port, host: "0.0.0.0" })
  .then((address) => {
    console.log(`migrations: ${applied}; servindo em ${address}`);
    const scheduler = startScheduler(db, {
      onError: (error) => { app.log.error({ err: error }, "refresh falhou"); },
    });
    scheduler.runNow();
  })
  .catch((error) => { console.error(error); process.exit(1); });
```

- [ ] **Step 6: Rodar tudo e commitar**

Run: `npm test && npm run typecheck`
Expected: PASS.

```bash
git add package.json src/jobs src/server.ts
git commit -m "feat: job node-cron para cotacoes e indices com refresh no startup"
```

---

### Task 12: Aceite real (rede) + Docker

**Files:** nenhum (verificação).

- [ ] **Step 1: Suíte e build**

Run: `npm test && npm run typecheck && npm run build:web`
Expected: PASS / limpo / `web/dist` gerado.

- [ ] **Step 2: Migrar o banco real e subir a API**

Run: `npm run import && npm run dev` (segundo terminal)
Expected: import 48/119/847; migrations aplicam a 002.

- [ ] **Step 3: Refresh real e inspeção**

```bash
curl -s -X POST 'localhost:3000/api/refresh' | head -c 400
curl -s localhost:3000/api/health
curl -s localhost:3000/api/portfolio | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const p=JSON.parse(d);console.log(p.positions.length,p.totals);})"
sqlite3 data/investments.db "SELECT ticker, COUNT(*), MIN(date), MAX(date) FROM quotes GROUP BY ticker; SELECT series, COUNT(*), MIN(date), MAX(date) FROM index_rates GROUP BY series;"
```

Expected:
- `/api/refresh`: 3 tickers com `errors: []` (ou erro transitório de rede, sem gravar lixo); `bcb` com `inserted > 0`.
- `/api/health`: `sources` com yahoo/bcb (e alphavantage se a chave estiver no `.env`).
- `/api/portfolio`: 48 posições, `marketValueCents` na casa dos 21.9 milhões de centavos (±mercado do dia); 3 RV com `priceCents`/`priceDate`; RF sem `priceCents` e com `priceDate` = último CDI publicado.
- `quotes`: 3 tickers desde ~2025-04 até hoje; `index_rates`: CDI/SELIC ~370 pontos, IPCA ~18.

- [ ] **Step 4: Docker**

Run: `docker compose up -d --build && curl -s localhost:3000/api/health && docker compose logs --tail=20 app`
Expected: health `ok: true` com `sources`; logs sem stack de erro; refresh de startup rodando.

- [ ] **Step 5: Registrar e fechar a etapa**

- Atualizar `ROADMAP.md`: S4 concluída (merge), evidências (contagens, total do dia), próxima = S5.
- Sincronizar `package-lock.json` no trunk (`npm install` + commit) se ainda não estiver.
- Commit final:

```bash
git add ROADMAP.md package-lock.json
git commit -m "docs: registra a s4 concluida no roadmap"
```

---

## Execução (bento / small-prs)

- Plano commitado em `main` **antes** da stack.
- Cada task vira uma layer: `gh stack init` (uma vez) e, por task, `git add <arquivos>` + `gh stack add -m "<commit da task>" s4-t<N>-<slug>` (staged-only; **nunca `-A`**, o lock fica sujo de propósito).
- Depois de cada task: `node scripts/pr-split-verify.mjs check <base> HEAD` (base = `main` na T1; = layer anterior nas demais).
- Push: usar `git push --force-with-lease --no-verify` com os checks manuais verdes e registrar (mesmo fluxo da S3).
- Fim da sessão: `gh stack submit --auto --open`, merge, e **sincronizar o `package-lock.json` no trunk**.
- Aceite da sessão: `npm test` verde, `npm run typecheck` limpo, `npm run build:web` ok, `/api/portfolio` com 48 posições e `/api/health` com as fontes.
