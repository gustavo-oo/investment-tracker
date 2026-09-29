# Fundação (S2) — Plano de Implementação

> **Para agentes:** sub-skill obrigatória: `superpowers:executing-plans` (execução inline, padrão bento) com TDD task a task. Passos usam checkbox (`- [ ]`).

**Goal:** entregar a fundação do app: modelo de dados novo (instrumentos × movimentos), import dos CSVs do legado com precisão inteira, API de import/consulta e Docker rodando no homelab.

**Architecture:** monólito em camadas — `domain/` (tipos e cálculo puro), `db/` (schema/migrations/repos), `import/` (CSV → banco), `api/` (rotas finas), `server.ts`. Sem ORM; SQL direto. Dinheiro/cota em inteiros escalonados (BigInt ↔ `INTEGER`). Import substitui os dados numa transação única e fica auditado em `import_runs`.

**Tech Stack:** Node ≥ 22.18 (type-stripping nativo), TypeScript 5.8 (`noEmit` + `tsc --noEmit`), Fastify 5, better-sqlite3, `node:test`, Docker (`node:22-slim` + compose).

## Global Constraints

- Node ≥ 22.18, ESM (`"type": "module"`); imports com extensão explícita (`./money.ts`).
- Zero `float` em dado persistido ou cálculo: inteiros escalonados (cents 10², cotas 10⁸, taxas 10¹², multiplicador 10⁶); parsing por string; arredondamento half-up só em `domain/money.ts`.
- Quantidade assinada (+ entra, − sai) e **`NULL` em renda fixa** (a planilha grava `1.0` fictício). Bruto = coluna `Resultado`; taxas = coluna `Taxas + Impostos`.
- API nunca serializa `BigInt`; usar `toNumberSafe`.
- Testes com `node:test`, sem bater em rede/API externa.
- Artefatos e commits em pt-BR (conventional commits).
- Limites de PR (bento): **≤ 400 linhas / ≤ 10 arquivos por layer**; cada task = 1 layer; parar se estourar.
- Banco local em `data/investments.db` (gitignored). CSVs de import em `data/csv/` (commitados).
- Container: non-root, `DB_PATH=/app/data/investments.db`, volume `./data:/app/data`, `TZ=America/Sao_Paulo`, healthcheck em `/api/health`.

---

## Estrutura de arquivos (S2)

```
package.json  tsconfig.json  .env.example  .dockerignore  Dockerfile  docker-compose.yml  README.md
src/
  domain/model.ts            # tipos: InstrumentKind/Category/TransactionKind
  domain/money.ts            # precisão: escalas, parse, format, arredondamento
  db/index.ts                # abre SQLite (WAL, FK, safe integers)
  db/migrate.ts              # aplica migrations por versão
  db/migrations/001_init.sql # schema completo
  db/repos.ts                # leitura/escrita das tabelas
  import/catalog.ts          # rótulos do legado → slugs/kind + slugify/normalize
  import/csv.ts              # parser CSV (aspas, CRLF)
  import/map.ts              # linha CSV → linha do banco
  import/snapshots.ts        # decodifica GZIP+Base64 da aba Evolução
  import/run.ts              # orquestra import (dry-run ou transação)
  import/cli.ts              # `npm run import`
  api/routes/instruments.ts | import.ts | health.ts
  app.ts                     # monta Fastify
  server.ts                  # abre banco, migra, sobe servidor
```

Referências de aceite (conferidas em 2026-09-17): 48 instrumentos, 119 transações, 847 linhas de histórico (22 meses), soma do último mês = <valor> centavos.

---

### Task 1: Esqueleto + módulo de precisão monetária

**Files:**
- Create: `package.json`, `tsconfig.json`, `.env.example`, `src/domain/money.ts`, `src/domain/money.test.ts`

**Interfaces:**
- Produces: `Cents`, `SharesE8`, `RateE12`, `MultiplierE6`; `CENTS`, `SHARES_SCALE`, `RATE_SCALE`, `MULTIPLIER_SCALE`; `divRoundHalfUp(n, d)`; `mulScaled(a, b, scale)`; `parseDecimal(text, scale)`; `formatCents(v)`; `toNumberSafe(v)`.

- [ ] **Step 1: Criar `package.json`**

```json
{
  "name": "investment-tracker",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.18" },
  "scripts": {
    "dev": "node --watch src/server.ts",
    "start": "node src/server.ts",
    "test": "node --test src",
    "typecheck": "tsc --noEmit",
    "import": "node src/import/cli.ts"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 2: Criar `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Criar `.env.example`**

```bash
PORT=3000
DB_PATH=data/investments.db
CSV_DIR=data/csv
ALPHAVANTAGE_API_KEY=
```

- [ ] **Step 4: Instalar dependências**

Run: `npm install`
Expected: cria `node_modules/` e `package-lock.json`, sem erros.

- [ ] **Step 5: Escrever o teste que falha — `src/domain/money.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CENTS, RATE_SCALE, SHARES_SCALE,
  divRoundHalfUp, formatCents, mulScaled, parseDecimal, toNumberSafe,
} from "./money.ts";

test("divRoundHalfUp arredonda metade para longe do zero", () => {
  assert.equal(divRoundHalfUp(1n, 2n), 1n);
  assert.equal(divRoundHalfUp(1n, 3n), 0n);
  assert.equal(divRoundHalfUp(2n, 3n), 1n);
  assert.equal(divRoundHalfUp(-1n, 2n), -1n);
  assert.equal(divRoundHalfUp(-1n, 3n), 0n);
});

test("parseDecimal converte decimal exato (vírgula ou ponto)", () => {
  assert.equal(parseDecimal("7074.84", CENTS), 707484n);
  assert.equal(parseDecimal("0,<valor>", RATE_SCALE), 536780000n);
  assert.equal(parseDecimal("-35.<valor>", CENTS), -3520n);
  assert.equal(parseDecimal("930.<valor>", SHARES_SCALE), 93014877553n);
  assert.equal(parseDecimal("<valor>", CENTS), 101n);
});

test("mulScaled multiplica mantendo a escala", () => {
  assert.equal(mulScaled(93014877553n, 1075n, SHARES_SCALE), 10000n);
});

test("formatCents formata pt-BR e nunca produz -0,00", () => {
  assert.equal(formatCents(707484n), "R$ <valor>");
  assert.equal(formatCents(-3520n), "-R$ <valor>");
  assert.equal(formatCents(0n), "R$ <valor>");
});

test("toNumberSafe converte cents para JSON e barra acima de 2^53", () => {
  assert.equal(toNumberSafe(707484n), <valor>);
  assert.throws(() => toNumberSafe(9007199254740993n));
});
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL (`./money.ts` não existe). Se o runner não achar `.ts`, trocar o script para `node --test "src/**/*.test.ts"` e revalidar.

- [ ] **Step 7: Implementar `src/domain/money.ts`**

```ts
export type Cents = bigint;
export type SharesE8 = bigint;
export type RateE12 = bigint;
export type MultiplierE6 = bigint;

export const CENTS = 100n;
export const SHARES_SCALE = 100_000_000n;
export const RATE_SCALE = 1_000_000_000_000n;
export const MULTIPLIER_SCALE = 1_000_000n;

/** Divisão inteira com arredondamento half-up (para longe do zero). */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error("divisão por zero");
  const negative = (numerator < 0n) !== (denominator < 0n);
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const rounded = (n * 2n + d) / (d * 2n);
  return negative ? -rounded : rounded;
}

/** Multiplica dois valores escalonados mantendo a escala do resultado. */
export function mulScaled(a: bigint, b: bigint, scale: bigint): bigint {
  return divRoundHalfUp(a * b, scale);
}

/** Converte texto decimal ("1234.56", "<valor>", "-<valor>...") em inteiro escalonado. */
export function parseDecimal(text: string, scale: bigint): bigint {
  const clean = String(text).trim().replace(/R\$/g, "").replace(/\s+/g, "");
  if (clean === "" || clean === "-") throw new Error(`número vazio: ${JSON.stringify(text)}`);
  const negative = clean.startsWith("-");
  const body = clean.replace(/^[-+]/, "");
  const normalized = body.includes(",") && !body.includes(".")
    ? body.replace(",", ".")
    : body.replace(/,/g, "");
  if (!/^\d*(\.\d*)?$/.test(normalized) || normalized === ".") {
    throw new Error(`número inválido: ${JSON.stringify(text)}`);
  }
  const digits = scale.toString().length - 1;
  const [intPart = "0", fracPart = ""] = normalized.split(".");
  const kept = (fracPart + "0".repeat(digits)).slice(0, digits);
  const nextDigit = fracPart.length > digits ? fracPart[digits] : "0";
  let value = BigInt(intPart === "" ? "0" : intPart) * scale + BigInt(kept === "" ? "0" : kept);
  if (nextDigit >= "5") value += 1n;
  return negative ? -value : value;
}

/** Formata centavos em pt-BR: 707484n -> "R$ <valor>". */
export function formatCents(value: Cents): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const int = abs / CENTS;
  const cents = (abs % CENTS).toString().padStart(2, "0");
  const intStr = int.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}R$ ${intStr},${cents}`;
}

/** Converte bigint para number seguro em JSON (rejeita perda de precisão). */
export function toNumberSafe(value: bigint): number {
  const MAX = 9007199254740991n;
  if (value > MAX || value < -MAX) throw new Error(`valor fora do range seguro: ${value}`);
  return Number(value);
}
```

- [ ] **Step 8: Rodar e ver passar + typecheck**

Run: `npm test && npm run typecheck`
Expected: `tests 5`, `pass 5`; typecheck sem erros.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.json .env.example src/domain
git commit -m "feat: esqueleto node+ts e módulo de precisão monetária"
```

---

### Task 2: Schema, migrations e conexão

**Files:**
- Create: `src/domain/model.ts`, `src/db/index.ts`, `src/db/migrate.ts`, `src/db/migrations/001_init.sql`, `src/db/migrate.test.ts`
- Modify: `package.json` (deps)

**Interfaces:**
- Produces: tipos `InstrumentKind`, `InstrumentCategory`, `TransactionKind` (model.ts); `Db`, `openDb(path)`; `migrate(db): number`.

- [ ] **Step 1: Instalar deps**

Run: `npm install fastify better-sqlite3 && npm install -D @types/better-sqlite3`
Expected: `package.json` ganha `dependencies` e o lock atualiza.

- [ ] **Step 2: Criar `src/domain/model.ts`**

```ts
export type InstrumentKind = "fixed_income" | "equity" | "pension";
export type InstrumentCategory =
  | "cdb" | "lca" | "selic" | "etf_fixed" | "etf_equity" | "pension_ipca";
export type TransactionKind = "BUY" | "SELL" | "DIVIDEND" | "AMORTIZATION" | "FEE" | "TAX";
```

- [ ] **Step 3: Criar `src/db/migrations/001_init.sql`**

```sql
CREATE TABLE instruments (
  id TEXT PRIMARY KEY,
  legacy_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('fixed_income', 'equity', 'pension')),
  category TEXT NOT NULL CHECK (category IN ('cdb', 'lca', 'selic', 'etf_fixed', 'etf_equity', 'pension_ipca')),
  ticker TEXT,
  quote_source TEXT,
  quote_symbol TEXT,
  currency TEXT NOT NULL DEFAULT 'BRL',
  benchmark TEXT CHECK (benchmark IN ('CDI', 'SELIC', 'IPCA')),
  rate_e6 INTEGER,
  maturity_date TEXT,
  liquidity TEXT,
  broker TEXT,
  objective TEXT,
  investor TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instrument_id TEXT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  trade_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('BUY', 'SELL', 'DIVIDEND', 'AMORTIZATION', 'FEE', 'TAX')),
  quantity_e8 INTEGER,
  gross_cents INTEGER NOT NULL CHECK (gross_cents >= 0),
  fees_cents INTEGER NOT NULL DEFAULT 0 CHECK (fees_cents >= 0),
  note TEXT,
  legacy_row INTEGER
);

CREATE TABLE quotes (
  ticker TEXT NOT NULL,
  date TEXT NOT NULL,
  close_cents INTEGER NOT NULL,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (ticker, date)
);

CREATE TABLE index_rates (
  series TEXT NOT NULL,
  date TEXT NOT NULL,
  value_e12 INTEGER NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (series, date)
);

CREATE TABLE valuations (
  month TEXT NOT NULL,
  instrument_id TEXT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  quantity_e8 INTEGER,
  price_cents INTEGER,
  market_value_cents INTEGER NOT NULL,
  cost_basis_cents INTEGER NOT NULL,
  PRIMARY KEY (month, instrument_id)
);

CREATE TABLE legacy_snapshots (
  month TEXT NOT NULL,
  instrument_id TEXT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  value_cents INTEGER NOT NULL,
  shares_e8 INTEGER,
  PRIMARY KEY (month, instrument_id)
);

CREATE TABLE import_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT NOT NULL CHECK (source IN ('ui', 'cli', 'api')),
  instruments INTEGER NOT NULL,
  transactions INTEGER NOT NULL,
  history_rows INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
  message TEXT
);

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_transactions_instrument_date ON transactions(instrument_id, trade_date);
CREATE INDEX idx_valuations_month ON valuations(month);
CREATE INDEX idx_legacy_snapshots_month ON legacy_snapshots(month);
```

- [ ] **Step 4: Implementar `src/db/index.ts`**

```ts
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Db = Database.Database;

export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.defaultSafeIntegers(true);
  return db;
}
```

- [ ] **Step 5: Implementar `src/db/migrate.ts`**

```ts
import { readdirSync, readFileSync } from "node:fs";
import type { Db } from "./index.ts";

const MIGRATIONS_DIR = new URL("./migrations/", import.meta.url);

export function migrate(db: Db): number {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const appliedRows = db.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: bigint }>;
  const applied = new Set(appliedRows.map((row) => Number(row.version)));
  const files = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql")).sort();
  let count = 0;
  for (const file of files) {
    const version = Number(file.slice(0, 3));
    if (applied.has(version)) continue;
    const sql = readFileSync(new URL(file, MIGRATIONS_DIR), "utf8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(version);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    count++;
  }
  return count;
}
```

- [ ] **Step 6: Escrever o teste que falha — `src/db/migrate.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "./index.ts";
import { migrate } from "./migrate.ts";

test("migrate aplica 001 e é idempotente", () => {
  const db = openDb(":memory:");
  assert.equal(migrate(db), 1);
  assert.equal(migrate(db), 0);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => (row as { name: string }).name);
  for (const table of ["instruments", "transactions", "quotes", "index_rates", "valuations", "legacy_snapshots", "import_runs"]) {
    assert.ok(tables.includes(table), `tabela ${table} existe`);
  }
});

test("schema rejeita kind inválido em transaction", () => {
  const db = openDb(":memory:");
  migrate(db);
  db.prepare(`INSERT INTO instruments (id, legacy_key, name, kind, category) VALUES (?, ?, ?, ?, ?)`)
    .run("x", "X", "X", "fixed_income", "cdb");
  assert.throws(() => {
    db.prepare(`INSERT INTO transactions (instrument_id, trade_date, kind, gross_cents) VALUES (?, ?, ?, ?)`)
      .run("x", "2026-01-01", "DOACAO", 100n);
  });
});
```

- [ ] **Step 7: Rodar e ver passar + typecheck**

Run: `npm test && npm run typecheck`
Expected: 7 testes passam; typecheck limpo.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/domain/model.ts src/db/index.ts src/db/migrate.ts src/db/migrations src/db/migrate.test.ts
git commit -m "feat: schema sqlite novo (instrumentos, transacoes, valuations) e migrations"
```

---

### Task 3: Repositórios

**Files:**
- Create: `src/db/repos.ts`, `src/db/repos.test.ts`

**Interfaces:**
- Consumes: `Db` (Task 2), `InstrumentKind`/`InstrumentCategory`/`TransactionKind` (Task 2).
- Produces: tipos `InstrumentRow`, `TransactionRow`, `LegacySnapshotRow`, `ImportRunRow`; funções `insertInstruments`, `listInstruments`, `getInstrument`, `getInstrumentByLegacyKey`, `insertTransactions`, `listTransactionsByInstrument`, `insertLegacySnapshots`, `latestLegacyMonth`, `listLegacySnapshotByMonth`, `insertImportRun`, `listImportRuns`, `clearImportedData`, `counts`.

- [ ] **Step 1: Escrever o teste que falha — `src/db/repos.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "./index.ts";
import { migrate } from "./migrate.ts";
import {
  clearImportedData, counts, getInstrument, getInstrumentByLegacyKey, insertImportRun,
  insertInstruments, insertLegacySnapshots, insertTransactions, latestLegacyMonth,
  listImportRuns, listLegacySnapshotByMonth, listTransactionsByInstrument,
} from "./repos.ts";
import type { InstrumentRow } from "./repos.ts";

function freshDb() {
  const db = openDb(":memory:");
  migrate(db);
  return db;
}

const cdb: InstrumentRow = {
  id: "cdb-teste-01-01-30", legacyKey: "CDB Teste:  01-01-30", name: "CDB Teste",
  kind: "fixed_income", category: "cdb", ticker: null, quoteSource: null, quoteSymbol: null,
  currency: "BRL", benchmark: "CDI", rateE6: 1060000n, maturityDate: "2030-01-01",
  liquidity: "Diário", broker: "PagBank", objective: "Reserva", investor: "Ana",
};

test("instrumentos e transações fazem roundtrip com inteiros escalonados", () => {
  const db = freshDb();
  insertInstruments(db, [cdb]);
  insertTransactions(db, [
    { instrumentId: cdb.id, tradeDate: "2025-04-23", kind: "BUY", quantityE8: null, grossCents: 227539n, feesCents: 0n, note: null, legacyRow: 2 },
    { instrumentId: cdb.id, tradeDate: "2026-07-01", kind: "SELL", quantityE8: null, grossCents: 273342n, feesCents: 9546n, note: null, legacyRow: 3 },
  ]);
  assert.equal(getInstrument(db, cdb.id)?.rateE6, 1060000n);
  assert.equal(getInstrumentByLegacyKey(db, cdb.legacyKey)?.id, cdb.id);
  const txs = listTransactionsByInstrument(db, cdb.id);
  assert.equal(txs.length, 2);
  assert.equal(txs[1]?.grossCents, 273342n);
  assert.equal(txs[1]?.quantityE8, null, "RF não tem cota");
});

test("histórico legado, runs e limpeza", () => {
  const db = freshDb();
  insertInstruments(db, [cdb]);
  insertLegacySnapshots(db, [
    { month: "2026-08-01", instrumentId: cdb.id, valueCents: 100000n, sharesE8: null },
    { month: "2026-09-01", instrumentId: cdb.id, valueCents: -3520n, sharesE8: null },
  ]);
  assert.equal(latestLegacyMonth(db), "2026-09-01");
  assert.equal(listLegacySnapshotByMonth(db, "2026-09-01")[0]?.valueCents, -3520n);
  insertImportRun(db, { source: "cli", instruments: 1, transactions: 0, historyRows: 2, status: "ok", message: null });
  assert.equal(listImportRuns(db, 10)[0]?.historyRows, 2);
  assert.deepEqual(counts(db), { instruments: 1, transactions: 0, legacySnapshots: 2, importRuns: 1 });
  clearImportedData(db);
  assert.deepEqual(counts(db), { instruments: 0, transactions: 0, legacySnapshots: 0, importRuns: 1 });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL (`./repos.ts` não existe).

- [ ] **Step 3: Implementar `src/db/repos.ts`**

```ts
import type { Db } from "./index.ts";
import type { InstrumentCategory, InstrumentKind, TransactionKind } from "../domain/model.ts";

export type InstrumentRow = {
  id: string; legacyKey: string; name: string; kind: InstrumentKind; category: InstrumentCategory;
  ticker: string | null; quoteSource: string | null; quoteSymbol: string | null; currency: string;
  benchmark: string | null; rateE6: bigint | null; maturityDate: string | null;
  liquidity: string | null; broker: string | null; objective: string | null; investor: string | null;
};

export type TransactionRow = {
  instrumentId: string; tradeDate: string; kind: TransactionKind;
  quantityE8: bigint | null; grossCents: bigint; feesCents: bigint;
  note: string | null; legacyRow: number | null;
};

export type LegacySnapshotRow = { month: string; instrumentId: string; valueCents: bigint; sharesE8: bigint | null };

export type ImportRunRow = {
  id: number; importedAt: string; source: "ui" | "cli" | "api";
  instruments: number; transactions: number; historyRows: number;
  status: "ok" | "error"; message: string | null;
};

type InstrumentDbRow = {
  id: string; legacy_key: string; name: string; kind: InstrumentKind; category: InstrumentCategory;
  ticker: string | null; quote_source: string | null; quote_symbol: string | null; currency: string;
  benchmark: string | null; rate_e6: bigint | null; maturity_date: string | null;
  liquidity: string | null; broker: string | null; objective: string | null; investor: string | null;
};

const toInstrument = (row: InstrumentDbRow): InstrumentRow => ({
  id: row.id, legacyKey: row.legacy_key, name: row.name, kind: row.kind, category: row.category,
  ticker: row.ticker, quoteSource: row.quote_source, quoteSymbol: row.quote_symbol, currency: row.currency,
  benchmark: row.benchmark, rateE6: row.rate_e6, maturityDate: row.maturity_date,
  liquidity: row.liquidity, broker: row.broker, objective: row.objective, investor: row.investor,
});

export function insertInstruments(db: Db, rows: InstrumentRow[]): void {
  const stmt = db.prepare(`INSERT OR REPLACE INTO instruments
    (id, legacy_key, name, kind, category, ticker, quote_source, quote_symbol, currency,
     benchmark, rate_e6, maturity_date, liquidity, broker, objective, investor)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const run = db.transaction((items: InstrumentRow[]) => {
    for (const i of items) {
      stmt.run(i.id, i.legacyKey, i.name, i.kind, i.category, i.ticker, i.quoteSource, i.quoteSymbol,
        i.currency, i.benchmark, i.rateE6, i.maturityDate, i.liquidity, i.broker, i.objective, i.investor);
    }
  });
  run(rows);
}

export function listInstruments(db: Db): InstrumentRow[] {
  return (db.prepare("SELECT * FROM instruments ORDER BY id").all() as InstrumentDbRow[]).map(toInstrument);
}

export function getInstrument(db: Db, id: string): InstrumentRow | undefined {
  const row = db.prepare("SELECT * FROM instruments WHERE id = ?").get(id) as InstrumentDbRow | undefined;
  return row ? toInstrument(row) : undefined;
}

export function getInstrumentByLegacyKey(db: Db, legacyKey: string): InstrumentRow | undefined {
  const row = db.prepare("SELECT * FROM instruments WHERE legacy_key = ?").get(legacyKey) as InstrumentDbRow | undefined;
  return row ? toInstrument(row) : undefined;
}

export function insertTransactions(db: Db, rows: TransactionRow[]): void {
  const stmt = db.prepare(`INSERT INTO transactions
    (instrument_id, trade_date, kind, quantity_e8, gross_cents, fees_cents, note, legacy_row)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const run = db.transaction((items: TransactionRow[]) => {
    for (const t of items) {
      stmt.run(t.instrumentId, t.tradeDate, t.kind, t.quantityE8, t.grossCents, t.feesCents, t.note, t.legacyRow);
    }
  });
  run(rows);
}

export function listTransactionsByInstrument(db: Db, instrumentId: string): TransactionRow[] {
  const rows = db.prepare("SELECT * FROM transactions WHERE instrument_id = ? ORDER BY trade_date, id")
    .all(instrumentId) as Array<{
      instrument_id: string; trade_date: string; kind: TransactionKind;
      quantity_e8: bigint | null; gross_cents: bigint; fees_cents: bigint; note: string | null; legacy_row: bigint | null;
    }>;
  return rows.map((row) => ({
    instrumentId: row.instrument_id, tradeDate: row.trade_date, kind: row.kind,
    quantityE8: row.quantity_e8, grossCents: row.gross_cents, feesCents: row.fees_cents,
    note: row.note, legacyRow: row.legacy_row === null ? null : Number(row.legacy_row),
  }));
}

export function insertLegacySnapshots(db: Db, rows: LegacySnapshotRow[]): void {
  const stmt = db.prepare("INSERT OR REPLACE INTO legacy_snapshots (month, instrument_id, value_cents, shares_e8) VALUES (?, ?, ?, ?)");
  const run = db.transaction((items: LegacySnapshotRow[]) => {
    for (const s of items) stmt.run(s.month, s.instrumentId, s.valueCents, s.sharesE8);
  });
  run(rows);
}

export function latestLegacyMonth(db: Db): string | null {
  const row = db.prepare("SELECT MAX(month) AS month FROM legacy_snapshots").get() as { month: string | null };
  return row.month;
}

export function listLegacySnapshotByMonth(db: Db, month: string): LegacySnapshotRow[] {
  const rows = db.prepare("SELECT * FROM legacy_snapshots WHERE month = ? ORDER BY instrument_id").all(month) as Array<{
    month: string; instrument_id: string; value_cents: bigint; shares_e8: bigint | null;
  }>;
  return rows.map((row) => ({
    month: row.month, instrumentId: row.instrument_id, valueCents: row.value_cents, sharesE8: row.shares_e8,
  }));
}

export function insertImportRun(db: Db, run: Omit<ImportRunRow, "id" | "importedAt">): void {
  db.prepare("INSERT INTO import_runs (source, instruments, transactions, history_rows, status, message) VALUES (?, ?, ?, ?, ?, ?)")
    .run(run.source, run.instruments, run.transactions, run.historyRows, run.status, run.message);
}

export function listImportRuns(db: Db, limit = 20): ImportRunRow[] {
  const rows = db.prepare("SELECT * FROM import_runs ORDER BY id DESC LIMIT ?").all(limit) as Array<{
    id: bigint; imported_at: string; source: "ui" | "cli" | "api";
    instruments: bigint; transactions: bigint; history_rows: bigint; status: "ok" | "error"; message: string | null;
  }>;
  return rows.map((row) => ({
    id: Number(row.id), importedAt: row.imported_at, source: row.source,
    instruments: Number(row.instruments), transactions: Number(row.transactions),
    historyRows: Number(row.history_rows), status: row.status, message: row.message,
  }));
}

export function clearImportedData(db: Db): void {
  db.exec("DELETE FROM transactions; DELETE FROM legacy_snapshots; DELETE FROM valuations; DELETE FROM instruments;");
}

export function counts(db: Db): { instruments: number; transactions: number; legacySnapshots: number; importRuns: number } {
  const one = (sql: string): number => Number((db.prepare(sql).get() as { total: bigint }).total);
  return {
    instruments: one("SELECT COUNT(*) AS total FROM instruments"),
    transactions: one("SELECT COUNT(*) AS total FROM transactions"),
    legacySnapshots: one("SELECT COUNT(*) AS total FROM legacy_snapshots"),
    importRuns: one("SELECT COUNT(*) AS total FROM import_runs"),
  };
}
```

- [ ] **Step 4: Rodar e ver passar + typecheck**

Run: `npm test && npm run typecheck`
Expected: 9 testes passam; typecheck limpo.

- [ ] **Step 5: Commit**

```bash
git add src/db/repos.ts src/db/repos.test.ts
git commit -m "feat: repositórios de instrumentos, transações, histórico e runs"
```

---

### Task 4: Catálogo, parser CSV e mapeamento

**Files:**
- Create: `src/import/catalog.ts`, `src/import/csv.ts`, `src/import/map.ts`, `src/import/catalog.test.ts`, `src/import/csv.test.ts`, `src/import/map.test.ts`

**Interfaces:**
- Consumes: `parseDecimal`, `CENTS`, `SHARES_SCALE`, `MULTIPLIER_SCALE` (Task 1); `InstrumentRow`, `TransactionRow` (Task 3); tipos de `model.ts`.
- Produces: `kindFromLegacy(type)`, `categoryFromLegacy(subtype)`, `slugify(legacyKey)`, `normalizeLegacyId(value)`; `parseCsv(text)`, `readCsv(path)`; `mapInstrumentRow(row)`, `mapTransactionRow(row, kind, rowIndex)`.

- [ ] **Step 1: Escrever o teste que falha — `src/import/catalog.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { categoryFromLegacy, kindFromLegacy, normalizeLegacyId, slugify } from "./catalog.ts";

test("rótulos do legado viram slugs", () => {
  assert.equal(kindFromLegacy("Renda Fixa"), "fixed_income");
  assert.equal(kindFromLegacy("Renda Variável"), "equity");
  assert.equal(kindFromLegacy("Previdência PGBL"), "pension");
  assert.equal(categoryFromLegacy("CDB"), "cdb");
  assert.equal(categoryFromLegacy("LCA"), "lca");
  assert.equal(categoryFromLegacy("Selic"), "selic");
  assert.equal(categoryFromLegacy("ETF - Renda Fixa"), "etf_fixed");
  assert.equal(categoryFromLegacy("ETF - Renda Variável"), "etf_equity");
  assert.equal(categoryFromLegacy("IPCA - Previdência"), "pension_ipca");
  assert.throws(() => kindFromLegacy("Cripto"));
});

test("slugify gera id estável sem acento", () => {
  assert.equal(slugify("CDB Liquidez Diária 106%:  26-02"), "cdb-liquidez-diaria-106-26-02");
  assert.equal(slugify("B5P211"), "b5p211");
});

test("normalizeLegacyId remove sufixo numérico .0", () => {
  assert.equal(normalizeLegacyId("<valor>.0"), "<valor>");
  assert.equal(normalizeLegacyId("<valor>"), "<valor>");
  assert.equal(normalizeLegacyId("CDB X:  01-01-30"), "CDB X:  01-01-30");
});
```

- [ ] **Step 2: Implementar `src/import/catalog.ts`**

```ts
import type { InstrumentCategory, InstrumentKind } from "../domain/model.ts";

const KIND_BY_LEGACY_TYPE: Record<string, InstrumentKind> = {
  "Renda Fixa": "fixed_income",
  "Renda Variável": "equity",
  "Previdência PGBL": "pension",
};

const CATEGORY_BY_LEGACY_SUBTYPE: Record<string, InstrumentCategory> = {
  "CDB": "cdb",
  "LCA": "lca",
  "Selic": "selic",
  "ETF - Renda Fixa": "etf_fixed",
  "ETF - Renda Variável": "etf_equity",
  "IPCA - Previdência": "pension_ipca",
};

export function kindFromLegacy(type: string): InstrumentKind {
  const kind = KIND_BY_LEGACY_TYPE[type.trim()];
  if (!kind) throw new Error(`tipo desconhecido: ${JSON.stringify(type)}`);
  return kind;
}

export function categoryFromLegacy(subtype: string): InstrumentCategory {
  const category = CATEGORY_BY_LEGACY_SUBTYPE[subtype.trim()];
  if (!category) throw new Error(`subtipo desconhecido: ${JSON.stringify(subtype)}`);
  return category;
}

export function slugify(legacyKey: string): string {
  const slug = legacyKey
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug === "") throw new Error(`id vazio após slugify: ${JSON.stringify(legacyKey)}`);
  return slug;
}

export function normalizeLegacyId(value: string): string {
  const trimmed = value.trim();
  return /^\d+\.0$/.test(trimmed) ? trimmed.slice(0, -2) : trimmed;
}
```

- [ ] **Step 3: Escrever o teste que falha — `src/import/csv.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "./csv.ts";

test("parseCsv lida com aspas, vírgula dentro de campo e CRLF", () => {
  const rows = parseCsv('a,b\r\n"linha, com vírgula",2\r\n"aspas ""internas""",3');
  assert.deepEqual(rows, [["a", "b"], ["linha, com vírgula", "2"], ['aspas "internas"', "3"]]);
});

test("parseCsv ignora linha final vazia", () => {
  assert.deepEqual(parseCsv("a,b\n"), [["a", "b"]]);
});
```

- [ ] **Step 4: Implementar `src/import/csv.ts`**

```ts
import { readFileSync } from "node:fs";

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  const src = text.replace(/\r\n?/g, "\n");
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (row.length > 0 || field !== "") { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

export function readCsv(path: string): string[][] {
  return parseCsv(readFileSync(path, "utf8"));
}
```

- [ ] **Step 5: Escrever o teste que falha — `src/import/map.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapInstrumentRow, mapTransactionRow } from "./map.ts";

test("mapInstrumentRow: RF sem cota, sem ticker, com rate e benchmark", () => {
  const instrument = mapInstrumentRow([
    "CDB PagBank 112%:  02-07-26", "CDB PagBank 112%", "Renda Fixa", "CDB", "-", "PagBank",
    "2026-07-02 00:00:00", "CDI", "1.12", "Diário", "Ana", "Reserva",
  ]);
  assert.equal(instrument.id, "cdb-pagbank-112-02-07-26");
  assert.equal(instrument.legacyKey, "CDB PagBank 112%:  02-07-26");
  assert.equal(instrument.kind, "fixed_income");
  assert.equal(instrument.category, "cdb");
  assert.equal(instrument.ticker, null);
  assert.equal(instrument.quoteSource, null);
  assert.equal(instrument.rateE6, 1120000n);
  assert.equal(instrument.benchmark, "CDI");
  assert.equal(instrument.maturityDate, "2026-07-02");
});

test("mapInstrumentRow: ETF com ticker e previdência com cvm-swb", () => {
  const etf = mapInstrumentRow(["B5P211", "B5P211", "Renda Variável", "ETF - Renda Fixa", "B5P211", "Inter", "2026-01-01 00:00:00", "Nenhum", "1.0", "Diário", "Ana", "Longo prazo"]);
  assert.equal(etf.kind, "equity");
  assert.equal(etf.category, "etf_fixed");
  assert.equal(etf.ticker, "B5P211");
  assert.equal(etf.quoteSource, "yahoo");
  assert.equal(etf.benchmark, null);

  const prev = mapInstrumentRow(["<valor>", "Previdência", "Previdência PGBL", "IPCA - Previdência", "<valor>.0", "BTG", "2026-01-01 00:00:00", "Nenhum", "1.0", "Diário", "Ana", "Longo prazo"]);
  assert.equal(prev.kind, "pension");
  assert.equal(prev.quoteSource, "cvm-swb");
  assert.equal(prev.quoteSymbol, "<valor>");
  assert.equal(prev.ticker, null);
});

test("mapTransactionRow: bruto=Resultado, taxas, sinal da quantidade e NULL em RF", () => {
  const compraRf = mapTransactionRow(["CDB X", "Compra", "2025-04-23 00:00:00", "1176.16", "0.01", "1176.15", "1.0"], "fixed_income", 2);
  assert.equal(compraRf.kind, "BUY");
  assert.equal(compraRf.grossCents, 117615n);
  assert.equal(compraRf.feesCents, 1n);
  assert.equal(compraRf.quantityE8, null, "cota 1.0 fictícia vira NULL em RF");
  assert.equal(compraRf.legacyRow, 2);

  const compraEtf = mapTransactionRow(["B5P211", "Compra", "2025-06-04 00:00:00", "3951.11", "1.17", "3949.94", "41.0"], "equity", 3);
  assert.equal(compraEtf.quantityE8, 4100000000n);
  assert.equal(compraEtf.grossCents, 394994n);

  const venda = mapTransactionRow(["B5P211", "Resgate", "2026-08-01 00:00:00", "1000.00", "0.0", "1000.00", "10.0"], "equity", 4);
  assert.equal(venda.kind, "SELL");
  assert.equal(venda.quantityE8, -1000000000n, "saída é negativa");

  const prev = mapTransactionRow(["<valor>.0", "Compra", "2025-10-01 00:00:00", "1000.0", "0.0", "1000", "930.<valor>"], "pension", 5);
  assert.equal(prev.instrumentId, "<valor>", "id normalizado sem .0");
  assert.equal(prev.quantityE8, 93014877553n);
});
```

- [ ] **Step 6: Implementar `src/import/map.ts`**

```ts
import { CENTS, MULTIPLIER_SCALE, SHARES_SCALE, parseDecimal } from "../domain/money.ts";
import type { InstrumentKind, TransactionKind } from "../domain/model.ts";
import type { InstrumentRow, TransactionRow } from "../db/repos.ts";
import { categoryFromLegacy, kindFromLegacy, normalizeLegacyId, slugify } from "./catalog.ts";

const clean = (value: string | undefined): string | null => {
  const trimmed = (value ?? "").trim();
  return trimmed === "" || trimmed === "-" ? null : trimmed;
};

const isoDate = (value: string): string => value.trim().slice(0, 10);

export function mapInstrumentRow(row: string[]): InstrumentRow {
  const [id = "", name = "", type = "", subtype = "", ticker, broker, maturity,
    benchmark, rate, liquidity, investor, objective] = row;
  const kind = kindFromLegacy(type);
  const category = categoryFromLegacy(subtype);
  const legacyKey = normalizeLegacyId(id);
  return {
    id: slugify(legacyKey),
    legacyKey,
    name: name.trim(),
    kind,
    category,
    ticker: kind === "equity" ? clean(ticker) : null,
    quoteSource: kind === "equity" ? "yahoo" : kind === "pension" ? "cvm-swb" : null,
    quoteSymbol: kind === "pension" ? clean(ticker) : null,
    currency: "BRL",
    benchmark: (benchmark ?? "").trim() === "Nenhum" ? null : clean(benchmark),
    rateE6: clean(rate) === null ? null : parseDecimal(rate ?? "0", MULTIPLIER_SCALE),
    maturityDate: clean(maturity) === null ? null : isoDate(maturity ?? ""),
    liquidity: clean(liquidity),
    broker: clean(broker),
    objective: clean(objective),
    investor: clean(investor),
  };
}

const TRANSACTION_KIND_BY_LEGACY: Record<string, TransactionKind> = {
  Compra: "BUY",
  Resgate: "SELL",
};

export function mapTransactionRow(row: string[], instrumentKind: InstrumentKind, rowIndex: number): TransactionRow {
  const [assetId = "", legacyKind = "", date = "", _cost = "0", taxes = "0", result = "0", quantity] = row;
  const kind = TRANSACTION_KIND_BY_LEGACY[legacyKind.trim()];
  if (!kind) throw new Error(`operação desconhecida na linha ${rowIndex}: ${JSON.stringify(legacyKind)}`);
  const hasQuantity = instrumentKind !== "fixed_income" && clean(quantity) !== null;
  const magnitude = hasQuantity ? parseDecimal(quantity ?? "0", SHARES_SCALE) : null;
  return {
    instrumentId: slugify(normalizeLegacyId(assetId)),
    tradeDate: isoDate(date),
    kind,
    quantityE8: magnitude === null ? null : kind === "SELL" ? -magnitude : magnitude,
    grossCents: parseDecimal(result, CENTS),
    feesCents: parseDecimal(taxes || "0", CENTS),
    note: null,
    legacyRow: rowIndex,
  };
}
```

Nota: `_cost` (coluna "Custo total da Operação") fica só documentado por enquanto — `Custo = bruto + taxas`, conferido nos dados.

- [ ] **Step 7: Rodar e ver passar + typecheck**

Run: `npm test && npm run typecheck`
Expected: 17 testes passam; typecheck limpo.

- [ ] **Step 8: Commit**

```bash
git add src/import/catalog.ts src/import/catalog.test.ts src/import/csv.ts src/import/csv.test.ts src/import/map.ts src/import/map.test.ts
git commit -m "feat: catálogo do legado, parser csv e mapeamento para o modelo novo"
```

---

### Task 5: Import completo (dry-run + gravação) e CLI

**Files:**
- Create: `src/import/snapshots.ts`, `src/import/run.ts`, `src/import/cli.ts`, `src/import/snapshots.test.ts`, `src/import/run.test.ts`, `src/import/real-data.test.ts`

**Interfaces:**
- Consumes: `parseCsv` (Task 4); `mapInstrumentRow`, `mapTransactionRow` (Task 4); repos (Task 3).
- Produces: `parseLegacyHistory(csvText): LegacySnapshotRaw[]`; `buildImportInputFromDir(csvDir): ImportInput`; `runImport(db, input, opts): ImportSummary`.

- [ ] **Step 1: Escrever o teste que falha — `src/import/snapshots.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { decodeLegacySnapshot, parseLegacyHistory } from "./snapshots.ts";

test("decodeLegacySnapshot descomprime GZIP+Base64 do legado", () => {
  const original = [{ id: "CDB X", value: -35.<valor> }, { id: "WRLD11", value: 100.5, nShares: 12 }];
  const base64 = gzipSync(Buffer.from(JSON.stringify(original))).toString("base64");
  assert.deepEqual(decodeLegacySnapshot(base64), original);
  assert.deepEqual(decodeLegacySnapshot(""), []);
});

test("parseLegacyHistory converte cada mês para centavos e ignora linhas vazias", () => {
  const gzip = gzipSync(Buffer.from(JSON.stringify([
    { id: "CDB X", value: -35.<valor> },
    { id: "WRLD11", value: 100.5, nShares: 12.3 },
  ]))).toString("base64");
  const csv = `Mês/Ano,Investimentos acumulados (GZIP + Base64)\n2026-09-01 00:00:00,"${gzip}"\n2027-01-01 00:00:00,\n`;
  const rows = parseLegacyHistory(csv);
  assert.deepEqual(rows, [
    { month: "2026-09-01", legacyKey: "CDB X", valueCents: -3520n, sharesE8: null },
    { month: "2026-09-01", legacyKey: "WRLD11", valueCents: 10050n, sharesE8: 1230000000n },
  ]);
});
```

- [ ] **Step 2: Implementar `src/import/snapshots.ts`**

```ts
import { gunzipSync } from "node:zlib";
import { CENTS, SHARES_SCALE, parseDecimal } from "../domain/money.ts";
import { parseCsv } from "./csv.ts";
import { normalizeLegacyId } from "./catalog.ts";

export type LegacySnapshotItem = { id: string; value: number; nShares?: number };
export type LegacySnapshotRaw = { month: string; legacyKey: string; valueCents: bigint; sharesE8: bigint | null };

export function decodeLegacySnapshot(base64: string): LegacySnapshotItem[] {
  const trimmed = base64.trim();
  if (trimmed === "") return [];
  const json = gunzipSync(Buffer.from(trimmed, "base64")).toString("utf8");
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error("snapshot legado não é uma lista");
  return parsed as LegacySnapshotItem[];
}

export function parseLegacyHistory(csvText: string): LegacySnapshotRaw[] {
  const rows = parseCsv(csvText).slice(1);
  const out: LegacySnapshotRaw[] = [];
  for (const row of rows) {
    const month = (row[0] ?? "").trim();
    const gzipCell = (row[1] ?? "").trim();
    if (month === "" || gzipCell === "") continue;
    const isoMonth = month.slice(0, 10);
    for (const item of decodeLegacySnapshot(gzipCell)) {
      out.push({
        month: isoMonth,
        legacyKey: normalizeLegacyId(item.id),
        valueCents: parseDecimal(String(item.value), CENTS),
        sharesE8: item.nShares == null ? null : parseDecimal(String(item.nShares), SHARES_SCALE),
      });
    }
  }
  return out;
}
```

- [ ] **Step 3: Escrever o teste que falha — `src/import/run.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { counts, listImportRuns, listTransactionsByInstrument } from "../db/repos.ts";
import { runImport, type ImportInput } from "./run.ts";

const gzip = (obj: unknown) => gzipSync(Buffer.from(JSON.stringify(obj))).toString("base64");

function input(): ImportInput {
  return {
    assetsCsv:
      "ID,Nome do Ativo,Tipo,Subtipo,Código (Ticker/ISIN),Corretora,Vencimento,Indicador,Rentabilidade,Liquidez,Quem investiu?,Objetivo,Total investido\n" +
      "CDB Teste:  01-01-30,CDB Teste,Renda Fixa,CDB,-,PagBank,2030-01-01 00:00:00,CDI,1.06,Diário,Ana,Reserva,0\n",
    transactionsCsv:
      "Ativo,Tipo de Operação,Data,Custo total da Operação,Taxas + Impostos,Resultado,Quantidade de Cotas\n" +
      "CDB Teste:  01-01-30,Compra,2025-04-23 00:00:00,1000.00,0.0,1000.00,1.0\n" +
      "CDB Teste:  01-01-30,Resgate,2026-07-01 00:00:00,1100.00,5.50,1100.00,1.0\n",
    historyCsv:
      "Mês/Ano,Investimentos acumulados (GZIP + Base64)\n" +
      `2026-09-01 00:00:00,"${gzip([{ id: "CDB Teste:  01-01-30", value: 1100.55 }])}"\n`,
  };
}

test("runImport dry-run não escreve e resume os dados", () => {
  const db = openDb(":memory:");
  migrate(db);
  const summary = runImport(db, input(), { dryRun: true, source: "cli" });
  assert.deepEqual(summary, {
    dryRun: true, instruments: 1, transactions: 2, historyRows: 1,
    latestMonth: "2026-09-01", latestTotalCents: <valor>, warnings: [], errors: [],
  });
  assert.equal(counts(db).instruments, 0, "dry-run não escreve");
});

test("runImport grava, audita e é idempotente", () => {
  const db = openDb(":memory:");
  migrate(db);
  const first = runImport(db, input(), { dryRun: false, source: "api" });
  assert.equal(first.errors.length, 0);
  const second = runImport(db, input(), { dryRun: false, source: "api" });
  assert.equal(second.errors.length, 0);
  assert.equal(counts(db).instruments, 1);
  assert.equal(counts(db).transactions, 2, "reimportar não duplica");
  assert.equal(listImportRuns(db, 10).length, 2);
  assert.equal(listTransactionsByInstrument(db, "cdb-teste-01-01-30")[1]?.grossCents, 110000n);
});

test("runImport aponta erro de ativo desconhecido sem escrever", () => {
  const db = openDb(":memory:");
  migrate(db);
  const bad = input();
  bad.transactionsCsv += "CDB Fantasma,Compra,2026-01-01 00:00:00,10.00,0.0,10.00,1.0\n";
  const summary = runImport(db, bad, { dryRun: false, source: "cli" });
  assert.equal(summary.errors.length, 1);
  assert.match(summary.errors[0] ?? "", /CDB Fantasma/);
  assert.equal(counts(db).instruments, 0, "erro não escreve nada");
});
```

- [ ] **Step 4: Implementar `src/import/run.ts`**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "../db/index.ts";
import {
  clearImportedData, insertImportRun, insertInstruments, insertLegacySnapshots, insertTransactions,
  type InstrumentRow, type LegacySnapshotRow, type TransactionRow,
} from "../db/repos.ts";
import { parseCsv } from "./csv.ts";
import { normalizeLegacyId } from "./catalog.ts";
import { mapInstrumentRow, mapTransactionRow } from "./map.ts";
import { parseLegacyHistory } from "./snapshots.ts";

export type ImportInput = { assetsCsv: string; transactionsCsv: string; historyCsv: string };

export type ImportSummary = {
  dryRun: boolean;
  instruments: number;
  transactions: number;
  historyRows: number;
  latestMonth: string | null;
  latestTotalCents: number;
  warnings: string[];
  errors: string[];
};

export function buildImportInputFromDir(csvDir: string): ImportInput {
  return {
    assetsCsv: readFileSync(join(csvDir, "Lista de Ativos.csv"), "utf8"),
    transactionsCsv: readFileSync(join(csvDir, "Investimentos.csv"), "utf8"),
    historyCsv: readFileSync(join(csvDir, "Evolução.csv"), "utf8"),
  };
}

export function runImport(db: Db, input: ImportInput, opts: { dryRun: boolean; source: "ui" | "cli" | "api" }): ImportSummary {
  const errors: string[] = [];
  const warnings: string[] = [];
  const instruments: InstrumentRow[] = [];

  for (const row of parseCsv(input.assetsCsv).slice(1)) {
    if ((row[0] ?? "").trim() === "") continue;
    try {
      instruments.push(mapInstrumentRow(row));
    } catch (error) {
      errors.push(`ativo inválido: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const byLegacyKey = new Map<string, InstrumentRow>();
  for (const instrument of instruments) {
    if (byLegacyKey.has(instrument.legacyKey)) {
      errors.push(`ativo duplicado: ${instrument.legacyKey}`);
      continue;
    }
    byLegacyKey.set(instrument.legacyKey, instrument);
  }

  const transactions: TransactionRow[] = [];
  parseCsv(input.transactionsCsv).slice(1).forEach((row, index) => {
    if ((row[0] ?? "").trim() === "") return;
    const instrument = byLegacyKey.get(normalizeLegacyId(row[0] ?? ""));
    if (!instrument) {
      errors.push(`transação referencia ativo desconhecido: ${row[0]}`);
      return;
    }
    try {
      transactions.push(mapTransactionRow(row, instrument.kind, index + 2));
    } catch (error) {
      errors.push(`transação inválida: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  const history: LegacySnapshotRow[] = [];
  const rawHistory = parseLegacyHistory(input.historyCsv);
  for (const item of rawHistory) {
    const instrument = byLegacyKey.get(item.legacyKey);
    if (!instrument) {
      warnings.push(`histórico sem cadastro (ignorado): ${item.legacyKey}`);
      continue;
    }
    history.push({ month: item.month, instrumentId: instrument.id, valueCents: item.valueCents, sharesE8: item.sharesE8 });
  }

  const latestMonth = history.reduce<string | null>((max, row) => (max === null || row.month > max ? row.month : max), null);
  const latestTotalCents = history
    .filter((row) => row.month === latestMonth)
    .reduce((acc, row) => acc + row.valueCents, 0n);

  const summary: ImportSummary = {
    dryRun: opts.dryRun,
    instruments: instruments.length,
    transactions: transactions.length,
    historyRows: history.length,
    latestMonth,
    latestTotalCents: Number(latestTotalCents),
    warnings,
    errors,
  };

  if (!opts.dryRun && errors.length === 0) {
    db.transaction(() => {
      clearImportedData(db);
      insertInstruments(db, instruments);
      insertTransactions(db, transactions);
      insertLegacySnapshots(db, history);
      insertImportRun(db, {
        source: opts.source,
        instruments: instruments.length,
        transactions: transactions.length,
        historyRows: history.length,
        status: "ok",
        message: null,
      });
    })();
  }

  return summary;
}
```

- [ ] **Step 5: Implementar `src/import/cli.ts`**

```ts
import { resolve } from "node:path";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { buildImportInputFromDir, runImport } from "./run.ts";

const csvDir = resolve(process.env.CSV_DIR ?? "data/csv");
const dbPath = resolve(process.env.DB_PATH ?? "data/investments.db");
const db = openDb(dbPath);
const applied = migrate(db);
const summary = runImport(db, buildImportInputFromDir(csvDir), { dryRun: false, source: "cli" });

console.log(`migrations aplicadas: ${applied}`);
console.log(`importado: ${summary.instruments} instrumentos, ${summary.transactions} transações, ${summary.historyRows} linhas de histórico`);
console.log(`último mês: ${summary.latestMonth} (total ${summary.latestTotalCents} centavos)`);
for (const warning of summary.warnings) console.warn(`aviso: ${warning}`);
for (const error of summary.errors) console.error(`erro: ${error}`);
console.log(`banco: ${dbPath}`);
db.close();
process.exit(summary.errors.length > 0 ? 1 : 0);
```

- [ ] **Step 6: Escrever o teste com dados reais — `src/import/real-data.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { counts, latestLegacyMonth, listLegacySnapshotByMonth, listTransactionsByInstrument } from "../db/repos.ts";
import { buildImportInputFromDir, runImport } from "./run.ts";

test("import dos dados reais reproduz os números do legado", () => {
  const db = openDb(":memory:");
  migrate(db);
  const summary = runImport(db, buildImportInputFromDir("data/csv"), { dryRun: false, source: "cli" });
  assert.deepEqual(summary.errors, []);
  assert.deepEqual(summary.warnings, []);
  assert.deepEqual(counts(db), { instruments: 48, transactions: 119, legacySnapshots: 847, importRuns: 1 });
  assert.equal(summary.latestMonth, "2026-09-01");
  assert.equal(summary.latestTotalCents, <valor>);
  assert.equal(listLegacySnapshotByMonth(db, "2026-09-01").length, 33);
  assert.equal(listTransactionsByInstrument(db, "cdb-pagbank-112-02-07-26")[1]?.grossCents, 273342n);
  assert.equal(listTransactionsByInstrument(db, "b5p211")[0]?.quantityE8, 4100000000n);
  assert.equal(listTransactionsByInstrument(db, "cdb-pagbank-112-02-07-26")[0]?.quantityE8, null);
});
```

- [ ] **Step 7: Rodar e ver passar + import real**

Run: `npm test && npm run typecheck && npm run import`
Expected: testes passam; CLI imprime `48 instrumentos, 119 transações, 847 linhas de histórico` e `total <valor> centavos`.

- [ ] **Step 8: Commit**

```bash
git add src/import
git commit -m "feat: import completo do legado (dry-run, auditoria e teste com dados reais)"
```

---

### Task 6: API (import, instruments, health)

**Files:**
- Create: `src/api/routes/import.ts`, `src/api/routes/instruments.ts`, `src/api/routes/health.ts`, `src/app.ts`, `src/server.ts`, `src/api/app.test.ts`

**Interfaces:**
- Consumes: `runImport`, `buildImportInputFromDir`, `ImportSummary` (Task 5); repos (Task 3); `toNumberSafe` (Task 1).
- Produces: `buildApp({ db, csvDir, logger }): FastifyInstance`; rotas `POST /api/import`, `GET /api/import/runs`, `GET /api/instruments`, `GET /api/instruments/:id/transactions`, `GET /api/health`.

- [ ] **Step 1: Escrever o teste que falha — `src/api/app.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { buildApp } from "../app.ts";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";

const gzip = (obj: unknown) => gzipSync(Buffer.from(JSON.stringify(obj))).toString("base64");

function csvDirFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "api-"));
  writeFileSync(join(dir, "Lista de Ativos.csv"),
    "ID,Nome do Ativo,Tipo,Subtipo,Código (Ticker/ISIN),Corretora,Vencimento,Indicador,Rentabilidade,Liquidez,Quem investiu?,Objetivo,Total investido\n" +
    "CDB X:  01-01-30,CDB X,Renda Fixa,CDB,-,PagBank,2030-01-01 00:00:00,CDI,1.06,Diário,Ana,Reserva,0\n");
  writeFileSync(join(dir, "Investimentos.csv"),
    "Ativo,Tipo de Operação,Data,Custo total da Operação,Taxas + Impostos,Resultado,Quantidade de Cotas\n" +
    "CDB X:  01-01-30,Compra,2025-04-23 00:00:00,1000.00,0.0,1000.00,1.0\n");
  writeFileSync(join(dir, "Evolução.csv"),
    "Mês/Ano,Investimentos acumulados (GZIP + Base64)\n" +
    `2026-09-01 00:00:00,"${gzip([{ id: "CDB X:  01-01-30", value: 1100.55 }])}"\n`);
  return dir;
}

test("health, import (dry-run e real), instruments e runs", async () => {
  const db = openDb(":memory:");
  migrate(db);
  const app = buildApp({ db, csvDir: csvDirFixture(), logger: false });

  let res = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true, counts: { instruments: 0, transactions: 0, legacySnapshots: 0, importRuns: 0 } });

  res = await app.inject({ method: "POST", url: "/api/import", payload: { dryRun: true } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().dryRun, true);
  assert.equal(res.json().latestTotalCents, <valor>);
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM instruments").get()!.total, 0n);

  res = await app.inject({ method: "POST", url: "/api/import", payload: {} });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().instruments, 1);
  assert.equal(res.json().errors.length, 0);

  res = await app.inject({ method: "GET", url: "/api/instruments" });
  const instruments = res.json();
  assert.equal(instruments[0].id, "cdb-x-01-01-30");
  assert.equal(instruments[0].rateE6, <valor>);

  res = await app.inject({ method: "GET", url: `/api/instruments/${encodeURIComponent("cdb-x-01-01-30")}/transactions` });
  assert.equal(res.json()[0].grossCents, <valor>);
  assert.equal(res.json()[0].quantityE8, null);

  res = await app.inject({ method: "GET", url: "/api/import/runs" });
  assert.equal(res.json()[0].instruments, 1);

  await app.close();
});

test("import com ativo inválido responde 422 e não escreve", async () => {
  const db = openDb(":memory:");
  migrate(db);
  const app = buildApp({ db, csvDir: csvDirFixture(), logger: false });
  const res = await app.inject({
    method: "POST",
    url: "/api/import",
    payload: {
      assetsCsv: "ID,Nome do Ativo,Tipo,Subtipo\nCripto X,Cripto X,Cripto,Ouro\n",
      transactionsCsv: "Ativo,Tipo de Operação,Data,Custo total da Operação,Taxas + Impostos,Resultado,Quantidade de Cotas\n",
      historyCsv: "Mês/Ano,Investimentos acumulados (GZIP + Base64)\n",
    },
  });
  assert.equal(res.statusCode, 422);
  assert.equal(res.json().errors.length, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM instruments").get()!.total, 0n);
  await app.close();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL (`../app.ts` não existe).

- [ ] **Step 3: Implementar `src/api/routes/instruments.ts`**

```ts
import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/index.ts";
import { listInstruments, listTransactionsByInstrument } from "../../db/repos.ts";
import { toNumberSafe } from "../../domain/money.ts";

export function registerInstrumentsRoutes(app: FastifyInstance, db: Db): void {
  app.get("/api/instruments", () => listInstruments(db).map((instrument) => ({
    id: instrument.id, name: instrument.name, kind: instrument.kind, category: instrument.category,
    ticker: instrument.ticker, quoteSource: instrument.quoteSource, quoteSymbol: instrument.quoteSymbol,
    currency: instrument.currency, benchmark: instrument.benchmark,
    rateE6: instrument.rateE6 === null ? null : toNumberSafe(instrument.rateE6),
    maturityDate: instrument.maturityDate, liquidity: instrument.liquidity,
    broker: instrument.broker, objective: instrument.objective, investor: instrument.investor,
  })));

  app.get<{ Params: { id: string } }>("/api/instruments/:id/transactions", (request) =>
    listTransactionsByInstrument(db, request.params.id).map((transaction) => ({
      tradeDate: transaction.tradeDate, kind: transaction.kind,
      quantityE8: transaction.quantityE8 === null ? null : toNumberSafe(transaction.quantityE8),
      grossCents: toNumberSafe(transaction.grossCents),
      feesCents: toNumberSafe(transaction.feesCents),
      note: transaction.note, legacyRow: transaction.legacyRow,
    })));
}
```

- [ ] **Step 4: Implementar `src/api/routes/import.ts`**

```ts
import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/index.ts";
import { listImportRuns } from "../../db/repos.ts";
import { buildImportInputFromDir, runImport, type ImportInput } from "../../import/run.ts";

type ImportBody = { assetsCsv?: string; transactionsCsv?: string; historyCsv?: string; dryRun?: boolean };

export function registerImportRoutes(app: FastifyInstance, db: Db, csvDir: string): void {
  app.post<{ Body: ImportBody }>("/api/import", (request, reply) => {
    const body = request.body ?? {};
    const input: ImportInput = body.assetsCsv && body.transactionsCsv && body.historyCsv
      ? { assetsCsv: body.assetsCsv, transactionsCsv: body.transactionsCsv, historyCsv: body.historyCsv }
      : buildImportInputFromDir(csvDir);
    const summary = runImport(db, input, { dryRun: body.dryRun === true, source: "api" });
    if (summary.errors.length > 0 && body.dryRun !== true) {
      reply.code(422);
    }
    return summary;
  });

  app.get("/api/import/runs", () => listImportRuns(db, 20));
}
```

- [ ] **Step 5: Implementar `src/api/routes/health.ts`, `src/app.ts` e `src/server.ts`**

```ts
// health.ts
import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/index.ts";
import { counts } from "../../db/repos.ts";

export function registerHealthRoutes(app: FastifyInstance, db: Db): void {
  app.get("/api/health", () => ({ ok: true, counts: counts(db) }));
}
```

```ts
// app.ts
import Fastify, { type FastifyInstance } from "fastify";
import type { Db } from "./db/index.ts";
import { registerHealthRoutes } from "./api/routes/health.ts";
import { registerImportRoutes } from "./api/routes/import.ts";
import { registerInstrumentsRoutes } from "./api/routes/instruments.ts";

export function buildApp(options: { db: Db; csvDir: string; logger?: boolean }): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 20 * 1024 * 1024 });
  registerInstrumentsRoutes(app, options.db);
  registerImportRoutes(app, options.db, options.csvDir);
  registerHealthRoutes(app, options.db);
  return app;
}
```

```ts
// server.ts
import { resolve } from "node:path";
import { buildApp } from "./app.ts";
import { openDb } from "./db/index.ts";
import { migrate } from "./db/migrate.ts";

const dbPath = resolve(process.env.DB_PATH ?? "data/investments.db");
const csvDir = resolve(process.env.CSV_DIR ?? "data/csv");
const port = Number(process.env.PORT ?? 3000);

const db = openDb(dbPath);
const applied = migrate(db);
const app = buildApp({ db, csvDir, logger: true });

app.listen({ port, host: "0.0.0.0" })
  .then((address) => console.log(`migrations: ${applied}; servindo em ${address}`))
  .catch((error) => { console.error(error); process.exit(1); });
```

- [ ] **Step 6: Rodar e ver passar + subir local**

Run: `npm test && npm run typecheck`
Expected: todos os testes passam.
Run: `npm run import && npm run dev` (em outro terminal: `curl -s localhost:3000/api/health` e `curl -s -X POST localhost:3000/api/import`)
Expected: `{"ok":true,"counts":{"instruments":48,...}}` e o segundo POST devolve o resumo do import com `latestTotalCents: <valor>`.

- [ ] **Step 7: Commit**

```bash
git add src/app.ts src/server.ts src/api
git commit -m "feat: api de import (dry-run), instrumentos, runs e health"
```

---

### Task 7: Docker + compose + README (homelab)

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `README.md`

**Interfaces:**
- Consumes: `npm run import`, `npm start`, `POST /api/import`, `GET /api/health` (Tasks 5–6).

- [ ] **Step 1: Criar `.dockerignore`**

```
node_modules
.git
.bento
.codegraph
.opencode
docs
legacy
data/*.db
data/*.db-*
data/*.xlsx
```

- [ ] **Step 2: Criar `Dockerfile`**

```dockerfile
FROM node:22-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
USER node
EXPOSE 3000
CMD ["node", "src/server.ts"]
```

- [ ] **Step 3: Criar `docker-compose.yml`**

```yaml
services:
  app:
    build: .
    restart: unless-stopped
    env_file:
      - path: .env
        required: false
    environment:
      DB_PATH: /app/data/investments.db
      CSV_DIR: /app/data/csv
      PORT: "3000"
      TZ: America/Sao_Paulo
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
```

- [ ] **Step 4: Criar `README.md`**

```markdown
# investment-tracker

Substitui a planilha Google + Apps Script por um app local (Node + SQLite).

## Dev

    npm install
    npm run import     # lê data/csv e popula data/investments.db
    npm run dev        # http://localhost:3000

Testes: `npm test` · Tipos: `npm run typecheck`

## Homelab (Docker)

    git pull
    docker compose up -d --build
    docker compose exec app npm run import   # popula o banco do volume
    curl localhost:3000/api/health

Atualizar: `git pull && docker compose up -d --build`. Backup: copiar `data/`.
Se o volume der erro de permissão, ajuste o dono de `./data` para o uid do container (1000).

## API (v1)

| Rota | Descrição |
|---|---|
| `POST /api/import` | importa CSVs (corpo com os textos ou lê `data/csv`); `{"dryRun":true}` só valida |
| `GET /api/import/runs` | histórico de imports |
| `GET /api/instruments` | lista de ativos |
| `GET /api/instruments/:id/transactions` | movimentos do ativo |
| `GET /api/health` | status + contagens |

## Estrutura

- `src/domain/` tipos e cálculo puro · `src/db/` schema e repositórios · `src/import/` CSV → banco · `src/api/` rotas
- `data/csv/` CSVs extraídos do legado · `legacy/apps-script/` código original · `docs/superpowers/` spec e planos
```

- [ ] **Step 5: Subir e validar o container (smoke test)**

Run:
```bash
docker compose up -d --build
docker compose exec app npm run import
curl -s localhost:3000/api/health
curl -s -X POST localhost:3000/api/import | head -c 200
docker compose down
```
Expected: health `{"ok":true,...}`; o POST devolve resumo com `latestTotalCents: <valor>`; CLI imprime 48/119/847.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile docker-compose.yml .dockerignore README.md
git commit -m "feat: container docker e runbook do homelab"
```

---

## Execução (bento / small-prs)

- Plano commitado em `main` **antes** da stack.
- Cada task vira uma layer: `gh stack init` (uma vez) e, por task, `gh stack add -Am "<commit da task>" s2-t<N>-<slug>`.
- Depois de cada task: `node scripts/pr-split-verify.mjs check <base> HEAD` (base = `main` na T1; = layer anterior nas demais). Se estourar 400 linhas/10 arquivos: parar e dividir.
- Fim da sessão: `gh stack push && gh stack submit`; depois self-review (2 revisores, repro para High/Medium) antes de pedir review humano.
- Aceite da sessão: `npm test` verde, `npm run import` com 48/119/847 e total <valor> centavos, container de pé com `/api/health` ok.
