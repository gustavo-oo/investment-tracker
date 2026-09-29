# Previdência CVM SWB (S5) — Plano de Implementação

> **Para agentes:** sub-skill obrigatória: `superpowers:executing-plans` (execução inline, padrão bento) com TDD task a task. Passos usam checkbox (`- [ ]`).

**Goal:** coletar a cota diária do PGBL na tela pública SWB da CVM (GET + POST `ddComptc`), persistir em `fund_quotas` com precisão e12 e fazer a posição de previdência entrar em `/api/portfolio` e `/api/history`, com job diário às 07:00 BRT, startup e `POST /api/refresh?source=cvm-swb`.

**Architecture:** `sources/cvm-swb.ts` (adapter com `fetch` injetável e cache 6h) → `services/refresh-pension.ts` (grava `fund_quotas` com `settled`, `source_status`) → `domain/position.ts` (`pensionValueCents`) → `services/{portfolio,history}` (leitura on-the-fly) → rotas existentes. Scheduler diário encadeia BCB e `cvm-swb`.

**Tech Stack:** Node 22 + TypeScript (type-stripping), Fastify 5, better-sqlite3, `node-cron` 4, `node:test`. Sem rede nos testes (fixtures HTML + fetch fake).

**Spec:** `docs/superpowers/specs/2026-09-20-s5-previdencia-cvm-swb-design.md`

## Global Constraints

- Node ≥ 22.18, ESM, imports `.ts` explícitos; backend sem build (type-stripping). `node:test`; nenhum teste com rede.
- Zero `float` em dado persistido/cálculo: BigInt escalonado (cents 1e2, shares 1e8, rate 1e12, multiplier 1e6, **quota 1e12**); `Number` só na borda da API (`toNumberSafe`). `parseDecimal` sempre a partir de string.
- `settled`: linha `fund_quotas` com `settled = 1` nunca é sobrescrita; linha `settled = 0` (hoje) pode; transição 0→1 acontece no fetch em que a data já é passada.
- Fronteira exata: `from = max(date)` por símbolo; banco vazio → `MIN(trade_date)`; `?full=1` → `MIN(trade_date)` de novo (só preenche buraco/finaliza pendente).
- Guardas de escrita: `date ≤ hoje` (BRT), `quotaE12 > 0`, lote atômico por símbolo.
- SWB: `PK_PARTIC = quote_symbol` (hoje `<valor>`); TZ `America/Sao_Paulo`; cache em memória 6h por `symbol:YYYY-MM`; sem retry/warmup.
- Dados reais: 1 ativo `pension` (`<valor>`, <valor> cotas); cota 2026-09-17 = `1.<valor>` → `<valor>` centavos; cota 2026-08-31 = `1.<valor>` → `<valor>` centavos.
- Limites de PR (bento): **≤ 400 linhas / ≤ 10 arquivos por layer**; cada task = 1 layer; `package-lock.json` fora das layers (sem dependência nova nesta etapa).
- Artefatos e commits em pt-BR.

---

## Estrutura de arquivos (S5)

```
src/db/migrations/003_fund_quotas.sql      # tabela fund_quotas
src/db/repos.ts  repos.test.ts             # + writeFundQuotas/frontier/leitura
src/domain/money.ts                        # + QUOTA_SCALE
src/domain/position.ts  position.test.ts   # + pensionValueCents e branch pension
src/sources/types.ts                       # FetchLike com init + FundQuota/FundQuotaSource
src/sources/cvm-swb.ts  cvm-swb.test.ts    # parser + sessão + cache 6h
src/sources/index.ts  index.test.ts        # + createFundQuotaSource
src/services/refresh-pension.ts  refresh-pension.test.ts
src/services/refresh.ts  refresh.test.ts   # + wantsPension e deps.pensionSource
src/services/portfolio.ts  portfolio.test.ts
src/services/history.ts  history.test.ts
src/jobs/scheduler.ts  scheduler.test.ts   # tarefa diária BCB + cvm-swb
README.md                                  # fontes e refresh
ROADMAP.md                                 # etapa concluída (task 6)
```

---

### Task 1: Migration 003 + repositório de cotas de fundo

**Files:**
- Create: `src/db/migrations/003_fund_quotas.sql`
- Modify: `src/db/repos.ts`, `src/db/repos.test.ts`

**Interfaces:**
- Consumes: `Db`, `migrate` (S2).
- Produces:
  - `type FundQuotaRow = { symbol: string; date: string; quotaE12: bigint; source: string; settled: boolean }`
  - `writeFundQuotas(db, rows, today): { inserted; updated; skipped }`
  - `fundQuotaFrontier(db, symbol): string | null`
  - `listAllFundQuotas(db): FundQuotaRow[]`

- [ ] **Step 1: Criar a migration**

```sql
-- src/db/migrations/003_fund_quotas.sql
CREATE TABLE fund_quotas (
  symbol TEXT NOT NULL,
  date TEXT NOT NULL,
  quota_e12 INTEGER NOT NULL,
  source TEXT NOT NULL,
  settled INTEGER NOT NULL DEFAULT 0,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (symbol, date)
);
```

- [ ] **Step 2: Testes que falham em `src/db/repos.test.ts`**

Ajustar o import do topo para incluir as funções novas:

```ts
import {
  clearImportedData, counts, earliestTradeDate, fundQuotaFrontier, getInstrument, getInstrumentByLegacyKey,
  hasQuoteFromSourceOnDate, indexFrontier, insertImportRun, insertInstruments, insertLegacySnapshots,
  insertTransactions, latestLegacyMonth, listAllFundQuotas, listAllIndexRates, listAllQuotes, listAllTransactions,
  listImportRuns, listLegacySnapshotByMonth, listSourceStatus, listTransactionsByInstrument,
  quoteFrontier, recordSourceAttempt, writeFundQuotas, writeIndexRates, writeQuotes,
} from "./repos.ts";
import type { FundQuotaRow, IndexRateRow, InstrumentRow, QuoteRow } from "./repos.ts";
```

Adicionar os testes ao final do arquivo:

```ts
test("writeFundQuotas: fechado imutável, hoje sobrescreve e pendente finaliza", () => {
  const db = freshDb();
  const past: FundQuotaRow = { symbol: "<valor>", date: "2026-09-16", quotaE12: 1_217_429_617_864n, source: "cvm-swb", settled: true };
  const today: FundQuotaRow = { symbol: "<valor>", date: "2026-09-18", quotaE12: 1_220_696_672_715n, source: "cvm-swb", settled: false };
  assert.deepEqual(writeFundQuotas(db, [past, today], "2026-09-18"), { inserted: 2, updated: 0, skipped: 0 });
  assert.deepEqual(
    writeFundQuotas(db, [{ ...past, quotaE12: 1n }, { ...today, quotaE12: 1_221_000_000_000n }], "2026-09-18"),
    { inserted: 0, updated: 1, skipped: 1 },
  );
  assert.deepEqual(listAllFundQuotas(db), [
    { symbol: "<valor>", date: "2026-09-16", quotaE12: 1_217_429_617_864n, source: "cvm-swb", settled: true },
    { symbol: "<valor>", date: "2026-09-18", quotaE12: 1_221_000_000_000n, source: "cvm-swb", settled: false },
  ]);
  assert.equal(fundQuotaFrontier(db, "<valor>"), "2026-09-18");
  assert.equal(fundQuotaFrontier(db, "<valor>"), null);
});

test("writeFundQuotas: fetch do dia seguinte finaliza o parcial (0→1)", () => {
  const db = freshDb();
  writeFundQuotas(db, [{ symbol: "<valor>", date: "2026-09-18", quotaE12: 1n, source: "cvm-swb", settled: false }], "2026-09-18");
  assert.deepEqual(
    writeFundQuotas(db, [{ symbol: "<valor>", date: "2026-09-18", quotaE12: 2n, source: "cvm-swb", settled: true }], "2026-09-19"),
    { inserted: 0, updated: 1, skipped: 0 },
  );
  assert.deepEqual(listAllFundQuotas(db)[0], { symbol: "<valor>", date: "2026-09-18", quotaE12: 2n, source: "cvm-swb", settled: true });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test "src/db/repos.test.ts"`
Expected: FAIL (`writeFundQuotas` não existe; import quebra).

- [ ] **Step 4: Implementar em `src/db/repos.ts`**

Adicionar o tipo após `SourceStatusRow`:

```ts
export type FundQuotaRow = { symbol: string; date: string; quotaE12: bigint; source: string; settled: boolean };
```

Adicionar as funções ao final do arquivo:

```ts
export function writeFundQuotas(db: Db, rows: FundQuotaRow[], today: string): { inserted: number; updated: number; skipped: number } {
  const writeClosed = db.prepare(`INSERT INTO fund_quotas (symbol, date, quota_e12, source, settled)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(symbol, date) DO UPDATE SET
      quota_e12 = excluded.quota_e12, source = excluded.source, settled = 1, fetched_at = datetime('now')
    WHERE fund_quotas.settled = 0`);
  const writeToday = db.prepare(`INSERT INTO fund_quotas (symbol, date, quota_e12, source, settled)
    VALUES (?, ?, ?, ?, 0)
    ON CONFLICT(symbol, date) DO UPDATE SET
      quota_e12 = excluded.quota_e12, source = excluded.source, fetched_at = datetime('now')
    WHERE fund_quotas.settled = 0`);
  const find = db.prepare("SELECT settled FROM fund_quotas WHERE symbol = ? AND date = ?");
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const run = db.transaction((items: FundQuotaRow[]) => {
    for (const quota of items) {
      const before = find.get(quota.symbol, quota.date) as { settled: bigint } | undefined;
      const result = (quota.date < today ? writeClosed : writeToday).run(quota.symbol, quota.date, quota.quotaE12, quota.source);
      if (Number(result.changes) === 0) skipped++;
      else if (before) updated++;
      else inserted++;
    }
  });
  run(rows);
  return { inserted, updated, skipped };
}

export function fundQuotaFrontier(db: Db, symbol: string): string | null {
  const row = db.prepare("SELECT MAX(date) AS date FROM fund_quotas WHERE symbol = ?").get(symbol) as { date: string | null };
  return row.date;
}

export function listAllFundQuotas(db: Db): FundQuotaRow[] {
  const rows = db.prepare("SELECT symbol, date, quota_e12, source, settled FROM fund_quotas ORDER BY symbol, date").all() as Array<{
    symbol: string; date: string; quota_e12: bigint; source: string; settled: bigint;
  }>;
  return rows.map((row) => ({
    symbol: row.symbol, date: row.date, quotaE12: row.quota_e12, source: row.source, settled: Number(row.settled) === 1,
  }));
}
```

- [ ] **Step 5: Rodar tudo e commitar**

Run: `node --test "src/db/repos.test.ts" && npm run typecheck`
Expected: PASS.

```bash
git add src/db
git commit -m "feat: fund_quotas com settled imutavel (migration 003)"
```

---

### Task 2: Domínio — valor de previdência

**Files:**
- Modify: `src/domain/money.ts`, `src/domain/position.ts`, `src/domain/position.test.ts`

**Interfaces:**
- Consumes: `divRoundHalfUp`, `SHARES_SCALE`, `CENTS` (`money.ts`).
- Produces:
  - `QUOTA_SCALE = 1_000_000_000_000n` (`money.ts`)
  - `type PensionQuotePoint = { date: string; quotaE12: bigint }`
  - `pensionValueCents(quantityE8, quotas, asOf): { valueCents; priceCents; priceDate }` (todos `bigint | null`)
  - `PositionInput.pensionQuotes?: PensionQuotePoint[]`
  - branch `pension` do `instrumentValue` calculando valor

- [ ] **Step 1: Testes que falham em `src/domain/position.test.ts`**

Adicionar `pensionValueCents` ao import do topo e os testes ao final:

```ts
import { equityValueCents, instrumentValue, pensionValueCents, rfValueCents, type PositionInput } from "./position.ts";
```

```ts
test("PGBL: cotas × última cota ≤ asOf, com precisão e12", () => {
  const quotas = [
    { date: "2026-08-31", quotaE12: 1_203_709_189_955n },
    { date: "2026-09-17", quotaE12: 1_220_696_672_715n },
  ];
  assert.deepEqual(pensionValueCents(11_754_09886092n, quotas, "2026-09-17"), {
    valueCents: 1_434_819n, priceCents: 122n, priceDate: "2026-09-17",
  });
  assert.deepEqual(pensionValueCents(11_754_09886092n, quotas, "2026-09-16"), {
    valueCents: 1_414_852n, priceCents: 120n, priceDate: "2026-08-31",
  });
  assert.deepEqual(pensionValueCents(11_754_09886092n, quotas, "2026-08-30"), { valueCents: null, priceCents: null, priceDate: null });
  assert.deepEqual(pensionValueCents(11_754_09886092n, [], "2026-09-17"), { valueCents: null, priceCents: null, priceDate: null });
});

test("instrumentValue: PGBL usa pensionQuotes e fica pendente sem cota", () => {
  const input: PositionInput = {
    kind: "pension", benchmark: null, rateE6: null,
    transactions: [{ tradeDate: "2026-01-02", kind: "BUY", quantityE8: 5_00000000n, grossCents: 50_000n, feesCents: 0n }],
    quotes: [], rates: [],
    pensionQuotes: [{ date: "2026-01-02", quotaE12: 1_200_000_000_000n }],
  };
  const value = instrumentValue(input, "2026-01-05");
  assert.equal(value.marketValueCents, 600n); // 5 cotas × R$ <valor>
  assert.equal(value.priceCents, 120n);
  assert.equal(value.priceDate, "2026-01-02");
  assert.equal(value.quantityE8, 5_00000000n);
  assert.equal(instrumentValue({ ...input, pensionQuotes: [] }, "2026-01-05").marketValueCents, null);
});
```

E renomear o teste existente `"instrumentValue consolida invested/redeemed/fees e PGBL fica pendente"` para `"instrumentValue consolida invested/redeemed/fees e PGBL fica pendente sem cota"` (as asserções seguem válidas: o `pension` daquele teste não tem `pensionQuotes`).

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test "src/domain/position.test.ts"`
Expected: FAIL (`pensionValueCents` não existe).

- [ ] **Step 3: Implementar**

Em `src/domain/money.ts`, adicionar após `SHARES_SCALE`:

```ts
export const QUOTA_SCALE = 1_000_000_000_000n;
```

Em `src/domain/position.ts`:

1. Importar `QUOTA_SCALE`:

```ts
import { MULTIPLIER_SCALE, QUOTA_SCALE, RATE_SCALE, SHARES_SCALE, divRoundHalfUp, mulScaled } from "./money.ts";
```

2. Adicionar o tipo e o campo em `PositionInput`:

```ts
export type PensionQuotePoint = { date: string; quotaE12: bigint };
```

```ts
export type PositionInput = {
  kind: InstrumentKind;
  benchmark: string | null;
  rateE6: bigint | null;
  transactions: PositionTransaction[];
  quotes: QuotePoint[];
  rates: RatePoint[];
  pensionQuotes?: PensionQuotePoint[];
};
```

3. Adicionar a função após `equityValueCents`:

```ts
/** Valor PGBL: cotas × última cota ≤ asOf; cota em e12, cotas em e8. */
export function pensionValueCents(
  quantityE8: bigint,
  quotas: PensionQuotePoint[],
  asOf: string,
): { valueCents: bigint | null; priceCents: bigint | null; priceDate: string | null } {
  let quotaE12: bigint | null = null;
  let priceDate: string | null = null;
  for (const quota of quotas) {
    if (quota.date > asOf) break;
    quotaE12 = quota.quotaE12;
    priceDate = quota.date;
  }
  if (quotaE12 === null) return { valueCents: null, priceCents: null, priceDate: null };
  return {
    valueCents: divRoundHalfUp(quantityE8 * quotaE12, SHARES_SCALE * QUOTA_SCALE / CENTS),
    priceCents: divRoundHalfUp(quotaE12, QUOTA_SCALE / CENTS),
    priceDate,
  };
}
```

4. Substituir o branch `pension` do `instrumentValue`:

```ts
  if (input.kind === "pension") {
    const quota = pensionValueCents(quantityE8 ?? 0n, input.pensionQuotes ?? [], asOf);
    return { marketValueCents: quota.valueCents, priceCents: quota.priceCents, priceDate: quota.priceDate, quantityE8, investedCents, redeemedCents, feesCents };
  }
```

- [ ] **Step 4: Rodar tudo e commitar**

Run: `node --test "src/domain/*.test.ts" && npm run typecheck`
Expected: PASS (inclui `money.test.ts` inalterado).

```bash
git add src/domain
git commit -m "feat: valor de previdencia por cota e12 no dominio"
```

---

### Task 3: Fonte CVM SWB

**Files:**
- Modify: `src/sources/types.ts`
- Create: `src/sources/cvm-swb.ts`, `src/sources/cvm-swb.test.ts`

**Interfaces:**
- Consumes: `QUOTA_SCALE`, `parseDecimal` (`domain/money.ts`); `monthRange` (`domain/dates.ts`).
- Produces:
  - `FetchLike = (url, init?) => Promise<Response>` (aditivo)
  - `type FundQuota = { symbol: string; date: string; quotaE12: bigint }`
  - `type FundQuotaSource = { id: string; fetchDaily(symbols, from, to): Promise<FundQuota[]> }`
  - `createCvmSwbSource({ fetchImpl?, now? }): FundQuotaSource` (id `cvm-swb`)
  - `parseQuotaSeries(html, year, month): Array<{ date; quotaE12 }>`

- [ ] **Step 1: Ajustar `src/sources/types.ts`**

```ts
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
```

Adicionar ao final:

```ts
export type FundQuota = { symbol: string; date: string; quotaE12: bigint };

export type FundQuotaSource = {
  id: string;
  fetchDaily(symbols: string[], from: string, to: string): Promise<FundQuota[]>;
};
```

- [ ] **Step 2: Teste que falha — `src/sources/cvm-swb.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCvmSwbSource, parseQuotaSeries } from "./cvm-swb.ts";
import type { FetchLike } from "./types.ts";

const GET_HTML = `<html><body><form name="iForm" method="post" action="./CPublicaInfdiario.aspx?PK_PARTIC=<valor>&amp;PK_SUBCLASSE=-1">
<input type="hidden" name="__EVENTTARGET" value="" />
<input type="hidden" name="__VIEWSTATE" value="VS-TOKEN" />
<input type="hidden" name="__VIEWSTATEGENERATOR" value="GEN-TOKEN" />
<input type="hidden" name="__EVENTVALIDATION" value="EV-TOKEN" />
</form></body></html>`;

const POST_HTML = `<html><body><table>
<tr><td>Dia</td><td>Quota (R$)</td><td>Captação no Dia (R$)</td></tr>
<tr><td>01</td><td>1,<valor></td><td><valor></td></tr>
<tr><td>02</td><td>1,<valor></td><td><valor></td></tr>
<tr><td>03</td><td></td><td></td></tr>
<tr><td>04</td><td>1,<valor></td><td><valor></td></tr>
<tr><td>31</td><td>9,<valor></td><td>0,00</td></tr>
</table></body></html>`;

type Call = { url: string; init?: RequestInit };

const queueFetch = (calls: Call[], responses: Array<() => Response>): FetchLike =>
  async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("fetch inesperado");
    return next();
  };

const ok = (body: string) => () => new Response(body, { status: 200, headers: { "set-cookie": "ASP.NET_SessionId=abc; path=/" } });

test("parseQuotaSeries lê o layout calendário e ignora dia vazio e data inválida", () => {
  assert.deepEqual(parseQuotaSeries(POST_HTML, 2026, 2), [
    { date: "2026-02-01", quotaE12: 1_205_210_301_515n },
    { date: "2026-02-02", quotaE12: 1_206_947_830_859n },
    { date: "2026-02-04", quotaE12: 1_209_588_321_963n },
  ]);
});

test("cvm-swb faz GET + POST por mês e devolve a série do símbolo", async () => {
  const calls: Call[] = [];
  const source = createCvmSwbSource({
    fetchImpl: queueFetch(calls, [ok(GET_HTML), ok(POST_HTML)]),
    now: () => new Date("2026-09-20T10:00:00-03:00"),
  });
  const quotas = await source.fetchDaily(["<valor>"], "2026-09-01", "2026-09-30");
  assert.equal(calls.length, 2);
  assert.match(calls[0]!.url, /PK_PARTIC=<valor>/);
  assert.equal(calls[1]!.init?.method, "POST");
  assert.match(String(calls[1]!.init?.body), /ddComptc=09%2F2026/);
  assert.match(String(calls[1]!.init?.body), /__VIEWSTATE=VS-TOKEN/);
  const headers = calls[1]!.init?.headers as Record<string, string>;
  assert.equal(headers["Origin"], "https://cvmweb.cvm.gov.br");
  assert.match(headers["Cookie"] ?? "", /ASP\.NET_SessionId=abc/);
  assert.deepEqual(quotas, [
    { symbol: "<valor>", date: "2026-09-01", quotaE12: 1_205_210_301_515n },
    { symbol: "<valor>", date: "2026-09-02", quotaE12: 1_206_947_830_859n },
    { symbol: "<valor>", date: "2026-09-04", quotaE12: 1_209_588_321_963n },
  ]);
});

test("cvm-swb filtra a janela from/to", async () => {
  const source = createCvmSwbSource({ fetchImpl: queueFetch([], [ok(GET_HTML), ok(POST_HTML)]) });
  const quotas = await source.fetchDaily(["<valor>"], "2026-09-02", "2026-09-03");
  assert.deepEqual(quotas, [{ symbol: "<valor>", date: "2026-09-02", quotaE12: 1_206_947_830_859n }]);
});

test("cvm-swb cacheia o mês por 6h e itera vários meses", async () => {
  const calls: Call[] = [];
  const fetchImpl = queueFetch(calls, [ok(GET_HTML), ok(POST_HTML)]);
  const source = createCvmSwbSource({ fetchImpl, now: () => new Date("2026-09-20T10:00:00-03:00") });
  await source.fetchDaily(["<valor>"], "2026-09-01", "2026-09-30");
  await source.fetchDaily(["<valor>"], "2026-09-15", "2026-09-30");
  assert.equal(calls.length, 2, "segunda chamada usa o cache");
  const multi = createCvmSwbSource({ fetchImpl: queueFetch(calls, [ok(GET_HTML), ok(POST_HTML), ok(GET_HTML), ok(POST_HTML)]) });
  await multi.fetchDaily(["<valor>"], "2026-08-01", "2026-09-30");
  assert.equal(calls.length, 6, "dois meses = quatro requests");
});

test("cvm-swb falha em HTTP ruim, viewstate ausente e página de erro", async () => {
  const http = createCvmSwbSource({ fetchImpl: async () => new Response("nope", { status: 502 }) });
  await assert.rejects(() => http.fetchDaily(["<valor>"], "2026-09-01", "2026-09-30"), /cvm-swb HTTP 502/);

  const semViewstate = createCvmSwbSource({ fetchImpl: async () => new Response("<html>vazio</html>", { status: 200 }) });
  await assert.rejects(() => semViewstate.fetchDaily(["<valor>"], "2026-09-01", "2026-09-30"), /sem VIEWSTATE/);

  const erro = createCvmSwbSource({ fetchImpl: queueFetch([], [ok(GET_HTML), ok("<html>Erro em Página do Sistema</html>")]) });
  await assert.rejects(() => erro.fetchDaily(["<valor>"], "2026-09-01", "2026-09-30"), /página de erro/);
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test "src/sources/cvm-swb.test.ts"`
Expected: FAIL (`./cvm-swb.ts` não existe).

- [ ] **Step 4: Implementar `src/sources/cvm-swb.ts`**

```ts
import { monthRange } from "../domain/dates.ts";
import { QUOTA_SCALE, parseDecimal } from "../domain/money.ts";
import type { FetchLike, FundQuota, FundQuotaSource } from "./types.ts";

const BASE = "https://cvmweb.cvm.gov.br/SWB/Sistemas/SCW/CPublica/InfDiario/CPublicaInfdiario.aspx";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9",
};

export type CvmSwbDeps = { fetchImpl?: FetchLike; now?: () => Date };

export type ParsedQuota = { date: string; quotaE12: bigint };

const stripTags = (html: string): string =>
  html.replace(/<[^>]+>/g, " ").replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();

const hiddenField = (html: string, name: string): string =>
  html.match(new RegExp(`name=['"]${name}['"][^>]*value=['"]([^'"]*)['"]`, "i"))?.[1] ?? "";

const isErrorPage = (html: string): boolean =>
  /Erro em P[áa]gina do Sistema/i.test(html) || /Ocorreu um erro de processamento no servidor\./i.test(html);

/** Linhas do layout calendário: cells[0] = dia, cells[1] = cota; dias vazios e datas inválidas são descartados. */
export function parseQuotaSeries(html: string, year: number, month: number): ParsedQuota[] {
  const mm = String(month).padStart(2, "0");
  const series: ParsedQuota[] = [];
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = Array.from(row[1]!.matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi))
      .map((cell) => stripTags(cell[1]!))
      .filter((cell) => cell !== "");
    if (cells.length < 2 || !/^\d{1,2}$/.test(cells[0]!)) continue;
    const day = Number(cells[0]);
    const date = `${year}-${mm}-${String(day).padStart(2, "0")}`;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) continue;
    let quotaE12: bigint;
    try {
      quotaE12 = parseDecimal(cells[1]!, QUOTA_SCALE);
    } catch {
      continue;
    }
    if (quotaE12 <= 0n) continue;
    series.push({ date, quotaE12 });
  }
  return series.sort((a, b) => a.date.localeCompare(b.date));
}

export function createCvmSwbSource(deps: CvmSwbDeps = {}): FundQuotaSource {
  const fetchImpl: FetchLike = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => new Date());
  const cache = new Map<string, { at: number; rows: ParsedQuota[] }>();

  const fetchMonth = async (symbol: string, year: number, month: number): Promise<ParsedQuota[]> => {
    const key = `${symbol}:${year}-${String(month).padStart(2, "0")}`;
    const cached = cache.get(key);
    if (cached && now().getTime() - cached.at < CACHE_TTL_MS) return cached.rows;

    const url = `${BASE}?PK_PARTIC=${encodeURIComponent(symbol)}&PK_SUBCLASSE=-1`;
    const getResponse = await fetchImpl(url, { headers: BROWSER_HEADERS });
    if (!getResponse.ok) throw new Error(`cvm-swb HTTP ${getResponse.status} no GET de ${symbol}`);
    const getHtml = await getResponse.text();
    if (isErrorPage(getHtml)) throw new Error(`cvm-swb página de erro no GET de ${symbol}`);
    const viewState = hiddenField(getHtml, "__VIEWSTATE");
    const eventValidation = hiddenField(getHtml, "__EVENTVALIDATION");
    if (viewState === "" || eventValidation === "") throw new Error(`cvm-swb sem VIEWSTATE/EVENTVALIDATION para ${symbol}`);

    const cookie = (getResponse.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const form = new URLSearchParams({
      __EVENTTARGET: "ddComptc",
      __EVENTARGUMENT: "",
      __LASTFOCUS: "",
      __VIEWSTATE: viewState,
      __VIEWSTATEGENERATOR: hiddenField(getHtml, "__VIEWSTATEGENERATOR"),
      __EVENTVALIDATION: eventValidation,
      ddComptc: `${String(month).padStart(2, "0")}/${year}`,
    });
    const headers: Record<string, string> = {
      ...BROWSER_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: "https://cvmweb.cvm.gov.br",
      Referer: url,
    };
    if (cookie !== "") headers["Cookie"] = cookie;

    const postResponse = await fetchImpl(url, { method: "POST", headers, body: form.toString() });
    if (!postResponse.ok) throw new Error(`cvm-swb HTTP ${postResponse.status} no POST de ${symbol} ${year}-${String(month).padStart(2, "0")}`);
    const postHtml = await postResponse.text();
    if (isErrorPage(postHtml)) throw new Error(`cvm-swb página de erro no POST de ${symbol} ${year}-${String(month).padStart(2, "0")}`);

    const rows = parseQuotaSeries(postHtml, year, month);
    cache.set(key, { at: now().getTime(), rows });
    return rows;
  };

  return {
    id: "cvm-swb",
    async fetchDaily(symbols, from, to) {
      const months = monthRange(from.slice(0, 7), to.slice(0, 7));
      const quotas: FundQuota[] = [];
      for (const symbol of symbols) {
        for (const month of months) {
          const [year = 0, monthNumber = 1] = month.split("-").map(Number);
          const rows = await fetchMonth(symbol, year, monthNumber);
          for (const row of rows) {
            if (row.date < from || row.date > to) continue;
            quotas.push({ symbol, date: row.date, quotaE12: row.quotaE12 });
          }
        }
      }
      return quotas;
    },
  };
}
```

- [ ] **Step 5: Rodar tudo e commitar**

Run: `node --test "src/sources/*.test.ts" && npm run typecheck`
Expected: PASS (Yahoo/BCB/Alpha Vantage seguem verdes com o `FetchLike` novo).

```bash
git add src/sources
git commit -m "feat: fonte cvm-swb com sessao viewstate, parse calendario e cache 6h"
```

---

### Task 4: Serviço refresh de previdência + orquestrador

**Files:**
- Create: `src/services/refresh-pension.ts`, `src/services/refresh-pension.test.ts`
- Modify: `src/services/refresh.ts`, `src/services/refresh.test.ts`, `src/sources/index.ts`, `src/sources/index.test.ts`

**Interfaces:**
- Consumes: repos da T1; `toBrDate` (S4); `FundQuota`, `FundQuotaSource` (T3); `createCvmSwbSource` (T3); `emptySummary` (S4).
- Produces:
  - `type PensionRefreshDeps = { source: FundQuotaSource; now?: () => Date; full?: boolean }`
  - `refreshPension(db, deps): Promise<RefreshSourceSummary>`
  - `createFundQuotaSource(deps?): FundQuotaSource` (`sources/index.ts`)
  - `RefreshDeps.pensionSource?: FundQuotaSource`; `refresh()` aceita `source = "cvm-swb"` e inclui previdência quando `source` é omitido (exceto `quotesOnly`)

- [ ] **Step 1: Implementar `src/sources/index.ts`**

Adicionar o import e a fábrica:

```ts
import { createCvmSwbSource } from "./cvm-swb.ts";
import type { FetchLike, FundQuotaSource, IndexSource, QuoteSource } from "./types.ts";
```

```ts
export function createFundQuotaSource(deps: SourceDeps = {}): FundQuotaSource {
  return createCvmSwbSource(deps);
}
```

Em `src/sources/index.test.ts`, adicionar ao import `createFundQuotaSource` e uma asserção no teste existente:

```ts
assert.equal(createFundQuotaSource({}).id, "cvm-swb");
```

- [ ] **Step 2: Teste que falha — `src/services/refresh-pension.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { insertInstruments, insertTransactions, listAllFundQuotas, listSourceStatus } from "../db/repos.ts";
import type { InstrumentRow } from "../db/repos.ts";
import type { FundQuota, FundQuotaSource } from "../sources/types.ts";
import { refreshPension } from "./refresh-pension.ts";

const pgbl: InstrumentRow = {
  id: "pgbl-1", legacyKey: "PGBL 1", name: "PGBL 1", kind: "pension", category: "pension_ipca",
  ticker: null, quoteSource: "cvm-swb", quoteSymbol: "<valor>", currency: "BRL", benchmark: null,
  rateE6: null, maturityDate: null, liquidity: null, broker: "BTG", objective: "Aposentadoria", investor: "Ana",
};

const NOW = () => new Date("2026-09-18T14:00:00-03:00");

function freshDb() {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [pgbl]);
  insertTransactions(db, [{ instrumentId: pgbl.id, tradeDate: "2025-10-01", kind: "BUY", quantityE8: 930_14877553n, grossCents: 100_000n, feesCents: 0n, note: null, legacyRow: null }]);
  return db;
}

const fakeSource = (resolver: (symbol: string, from: string, to: string) => FundQuota[] | Promise<FundQuota[]>): FundQuotaSource => ({
  id: "cvm-swb",
  fetchDaily: async (symbols, from, to) => resolver(symbols[0]!, from, to),
});

test("refreshPension grava fechado imutável e avança a fronteira", async () => {
  const db = freshDb();
  const froms: string[] = [];
  const source = fakeSource((symbol, from) => {
    froms.push(from);
    return [
      { symbol, date: "2026-09-16", quotaE12: 1_217_429_617_864n },
      { symbol, date: "2026-09-17", quotaE12: 1_220_696_672_715n },
    ];
  });
  const first = await refreshPension(db, { source, now: NOW });
  assert.deepEqual(first, { id: "cvm-swb", fetched: 2, inserted: 2, updated: 0, skipped: 0, errors: [] });
  assert.deepEqual(froms, ["2025-10-01"]);

  const second = await refreshPension(db, { source: fakeSource((symbol) => [{ symbol, date: "2026-09-17", quotaE12: 9n }]), now: NOW });
  assert.deepEqual(second, { id: "cvm-swb", fetched: 1, inserted: 0, updated: 0, skipped: 1, errors: [] });
  assert.equal(listAllFundQuotas(db)[1]?.quotaE12, 1_220_696_672_715n, "fechado não é sobrescrito");
  assert.ok(listSourceStatus(db).find((row) => row.source === "cvm-swb")?.lastSuccessAt);
});

test("refreshPension full volta à 1ª transação e falha mantém último valor + stale", async () => {
  const db = freshDb();
  const froms: string[] = [];
  const source = fakeSource((symbol, from) => {
    froms.push(from);
    return [{ symbol, date: "2026-09-17", quotaE12: 1_220_696_672_715n }];
  });
  await refreshPension(db, { source, now: NOW });
  await refreshPension(db, { source, now: NOW });
  await refreshPension(db, { source, now: NOW, full: true });
  assert.deepEqual(froms, ["2025-10-01", "2026-09-17", "2025-10-01"]);

  const result = await refreshPension(db, { source: fakeSource(() => { throw new Error("cvm fora do ar"); }), now: NOW });
  assert.match(result.errors[0] ?? "", /cvm fora do ar/);
  assert.equal(listAllFundQuotas(db).at(-1)?.quotaE12, 1_220_696_672_715n, "último valor é mantido");
  const status = listSourceStatus(db).find((row) => row.source === "cvm-swb");
  assert.equal(status?.lastError, "<valor>: cvm fora do ar");
  assert.ok((status?.lastErrorAt ?? "") > (status?.lastSuccessAt ?? ""));
});

test("sem instrumento de previdência não consulta a fonte", async () => {
  const db = openDb(":memory:");
  migrate(db);
  let calls = 0;
  const source: FundQuotaSource = { id: "cvm-swb", fetchDaily: async () => { calls++; return []; } };
  const result = await refreshPension(db, { source, now: NOW });
  assert.deepEqual(result, { id: "cvm-swb", fetched: 0, inserted: 0, updated: 0, skipped: 0, errors: [] });
  assert.equal(calls, 0);
  assert.deepEqual(listSourceStatus(db), []);
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test "src/services/refresh-pension.test.ts"`
Expected: FAIL (`./refresh-pension.ts` não existe).

- [ ] **Step 4: Implementar `src/services/refresh-pension.ts`**

```ts
import type { Db } from "../db/index.ts";
import { earliestTradeDate, fundQuotaFrontier, listInstruments, recordSourceAttempt, writeFundQuotas } from "../db/repos.ts";
import { toBrDate } from "../domain/dates.ts";
import type { FundQuotaSource } from "../sources/types.ts";
import { emptySummary, type RefreshSourceSummary } from "./refresh-summary.ts";

export type PensionRefreshDeps = { source: FundQuotaSource; now?: () => Date; full?: boolean };

export async function refreshPension(db: Db, deps: PensionRefreshDeps): Promise<RefreshSourceSummary> {
  const now = deps.now ?? (() => new Date());
  const today = toBrDate(now());
  const floor = earliestTradeDate(db);
  const summary = emptySummary(deps.source.id);
  const symbols = listInstruments(db)
    .filter((instrument) => instrument.kind === "pension" && instrument.quoteSymbol !== null)
    .map((instrument) => instrument.quoteSymbol as string);
  let attempted = false;
  for (const symbol of symbols) {
    const from = deps.full ? floor : (fundQuotaFrontier(db, symbol) ?? floor);
    if (from === null) continue;
    attempted = true;
    try {
      const quotas = await deps.source.fetchDaily([symbol], from, today);
      const valid = quotas.filter((quota) => quota.date <= today && quota.quotaE12 > 0n);
      const written = writeFundQuotas(db, valid.map((quota) => ({
        symbol: quota.symbol, date: quota.date, quotaE12: quota.quotaE12, source: deps.source.id, settled: quota.date < today,
      })), today);
      summary.fetched += valid.length;
      summary.inserted += written.inserted;
      summary.updated += written.updated;
      summary.skipped += written.skipped;
    } catch (error) {
      summary.errors.push(`${symbol}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (attempted) {
    recordSourceAttempt(db, deps.source.id, summary.errors.length === 0 ? { ok: true } : { ok: false, error: summary.errors[0]! });
  }
  return summary;
}
```

- [ ] **Step 5: Integrar no `src/services/refresh.ts`**

Substituir o topo e os trechos indicados:

```ts
import { createFundQuotaSource, createIndexSource, createQuoteSources } from "../sources/index.ts";
import type { FundQuotaSource, IndexSource, QuoteSource } from "../sources/types.ts";
import { refreshIndices } from "./refresh-indices.ts";
import { refreshPension } from "./refresh-pension.ts";
import { refreshQuotes } from "./refresh-quotes.ts";
```

```ts
export type RefreshDeps = {
  quoteSources?: QuoteSource[];
  indexSource?: IndexSource;
  pensionSource?: FundQuotaSource;
  now?: () => Date;
  fallbackAttempts?: Map<string, string>;
};
```

```ts
    const sourceDeps = { alphaVantageApiKey: process.env.ALPHAVANTAGE_API_KEY ?? "" };
    const quoteSources = deps.quoteSources ?? createQuoteSources(sourceDeps);
    const indexSource = deps.indexSource ?? createIndexSource(sourceDeps);
    const pensionSource = deps.pensionSource ?? createFundQuotaSource(sourceDeps);
    const wanted = options.source;
    const wantsQuotes = wanted === undefined || wanted === "yahoo" || wanted === "alphavantage";
    const wantsIndices = wanted === undefined ? options.quotesOnly !== true : wanted === "bcb";
    const wantsPension = wanted === undefined ? options.quotesOnly !== true : wanted === "cvm-swb";
    if (!wantsQuotes && !wantsIndices && !wantsPension) throw new RefreshRequestError(`fonte desconhecida: ${wanted}`);
```

E, depois do bloco de índices:

```ts
    if (wantsIndices) summaries.push(await refreshIndices(db, { source: indexSource, now: deps.now }, options.full));
    if (wantsPension) summaries.push(await refreshPension(db, { source: pensionSource, now: deps.now, full: options.full }));
```

- [ ] **Step 6: Atualizar `src/services/refresh.test.ts`**

Adicionar imports e os testes:

```ts
import { listAllFundQuotas } from "../db/repos.ts";
import type { FundQuotaSource, IndexSource, QuoteSource } from "../sources/types.ts";
```

```ts
const pgblInstrument: InstrumentRow = {
  id: "pgbl-1", legacyKey: "PGBL 1", name: "PGBL 1", kind: "pension", category: "pension_ipca",
  ticker: null, quoteSource: "cvm-swb", quoteSymbol: "<valor>", currency: "BRL", benchmark: null,
  rateE6: null, maturityDate: null, liquidity: null, broker: "BTG", objective: "Aposentadoria", investor: "Ana",
};

test("source cvm-swb roda só a previdência e usa o quote_symbol", async () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [pgblInstrument]);
  insertTransactions(db, [{ instrumentId: pgblInstrument.id, tradeDate: "2025-10-01", kind: "BUY", quantityE8: 930_14877553n, grossCents: 100_000n, feesCents: 0n, note: null, legacyRow: null }]);
  const symbols: string[] = [];
  const pensionSource: FundQuotaSource = {
    id: "cvm-swb",
    fetchDaily: async (requested, from, to) => {
      symbols.push(requested[0]!);
      assert.equal(from, "2025-10-01");
      assert.equal(to, "2026-09-18");
      return [{ symbol: requested[0]!, date: "2026-09-17", quotaE12: 1_220_696_672_715n }];
    },
  };
  const result = await refresh(db, { source: "cvm-swb" }, {
    quoteSources: [], indexSource: emptyIndexSource, pensionSource,
    now: () => new Date("2026-09-18T14:00:00-03:00"),
  });
  assert.deepEqual(result.sources.map((summary) => summary.id), ["cvm-swb"]);
  assert.deepEqual(symbols, ["<valor>"]);
  assert.equal(listAllFundQuotas(db)[0]?.quotaE12, 1_220_696_672_715n);
});

test("quotesOnly não busca previdência", async () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [pgblInstrument]);
  insertTransactions(db, [{ instrumentId: pgblInstrument.id, tradeDate: "2025-10-01", kind: "BUY", quantityE8: 930_14877553n, grossCents: 100_000n, feesCents: 0n, note: null, legacyRow: null }]);
  let pensionCalls = 0;
  const pensionSource: FundQuotaSource = { id: "cvm-swb", fetchDaily: async () => { pensionCalls++; return []; } };
  const result = await refresh(db, { quotesOnly: true }, { quoteSources: [emptyQuoteSource], indexSource: emptyIndexSource, pensionSource });
  assert.deepEqual(result.sources.map((summary) => summary.id), ["yahoo"]);
  assert.equal(pensionCalls, 0);
});
```

- [ ] **Step 7: Rodar tudo e commitar**

Run: `node --test "src/services/*.test.ts" "src/sources/*.test.ts" && npm run typecheck`
Expected: PASS.

```bash
git add src/services src/sources
git commit -m "feat: refresh de previdencia e fonte cvm-swb no orquestrador"
```

---

### Task 5: Portfolio, history, scheduler e README

**Files:**
- Modify: `src/services/portfolio.ts`, `src/services/portfolio.test.ts`, `src/services/history.ts`, `src/services/history.test.ts`, `src/jobs/scheduler.ts`, `src/jobs/scheduler.test.ts`, `README.md`

**Interfaces:**
- Consumes: `listAllFundQuotas` (T1); `PensionQuotePoint` (T2); `sourceSummary` (S4).
- Produces: posição PGBL com valor em `/api/portfolio` e `/api/history`; tarefa diária encadeando `bcb` e `cvm-swb`.

- [ ] **Step 1: Atualizar `src/services/portfolio.ts`**

Adicionar `listAllFundQuotas` ao import de repos e, dentro de `buildPortfolio`:

```ts
  const fundQuotas = listAllFundQuotas(db);
```

Substituir o trecho de montagem da posição:

```ts
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
    const priceSource = instrument.kind === "equity"
      ? (instrumentQuotes.filter((quote) => quote.date <= asOf).at(-1)?.source ?? null)
      : instrument.kind === "pension"
        ? (instrumentFundQuotas.filter((quota) => quota.date <= asOf).at(-1)?.source ?? null)
        : instrument.kind === "fixed_income" ? "bcb" : null;
```

- [ ] **Step 2: Atualizar `src/services/portfolio.test.ts`**

No topo, importar `writeFundQuotas` e ajustar o `pgbl`:

```ts
import {
  insertInstruments, insertTransactions, recordSourceAttempt, writeFundQuotas, writeIndexRates, writeQuotes,
} from "../db/repos.ts";
```

```ts
const pgbl: InstrumentRow = { ...base, id: "pgbl-1", legacyKey: "PGBL 1", name: "PGBL 1", kind: "pension", category: "pension_ipca", ticker: null, quoteSource: "cvm-swb", quoteSymbol: "<valor>", benchmark: null, rateE6: null };
```

No teste existente, adicionar após o `writeQuotes` e ajustar as asserções:

```ts
  writeFundQuotas(db, [{ symbol: "<valor>", date: "2026-09-17", quotaE12: 1_220_696_672_715n, source: "cvm-swb", settled: true }], "2026-09-18");
  recordSourceAttempt(db, "cvm-swb", { ok: true });
```

```ts
  assert.equal(pension?.marketValueCents, 610n); // 5 cotas × R$ <valor>
  assert.equal(pension?.priceCents, 122n);
  assert.equal(pension?.priceDate, "2026-09-17");
  assert.equal(pension?.priceSource, "cvm-swb");
  assert.equal(pension?.stale, false);
  assert.deepEqual(portfolio.totals, { investedCents: 159_100n, redeemedCents: 0n, feesCents: 100n, marketValueCents: 110_710n });
```

Adicionar o teste de ausência de cota:

```ts
test("PGBL sem cota fica null + stale", () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [pgbl]);
  insertTransactions(db, [{ instrumentId: pgbl.id, tradeDate: "2026-09-17", kind: "BUY", quantityE8: 5_00000000n, grossCents: 50_000n, feesCents: 0n, note: null, legacyRow: null }]);
  const portfolio = buildPortfolio(db, { now: NOW });
  const pension = portfolio.positions[0];
  assert.equal(pension?.marketValueCents, null);
  assert.equal(pension?.priceSource, null);
  assert.equal(pension?.stale, true);
});
```

- [ ] **Step 3: Atualizar `src/services/history.ts`**

Adicionar `listAllFundQuotas` ao import e passar as cotas no `instrumentValue`:

```ts
  const fundQuotas = listAllFundQuotas(db);
```

```ts
      const instrumentFundQuotas = instrument.kind === "pension" && instrument.quoteSymbol !== null
        ? fundQuotas.filter((quota) => quota.symbol === instrument.quoteSymbol)
        : [];
      const value = instrumentValue({
        kind: instrument.kind, benchmark: instrument.benchmark, rateE6: instrument.rateE6,
        transactions: instrumentTransactions, quotes: instrumentQuotes, rates: instrumentRates,
        pensionQuotes: instrumentFundQuotas,
      }, asOf);
```

- [ ] **Step 4: Atualizar `src/services/history.test.ts`**

Adicionar imports e o teste:

```ts
import { insertInstruments, insertTransactions, writeFundQuotas, writeIndexRates } from "../db/repos.ts";
```

```ts
const pgbl: InstrumentRow = {
  id: "pgbl-1", legacyKey: "PGBL 1", name: "PGBL 1", kind: "pension", category: "pension_ipca",
  ticker: null, quoteSource: "cvm-swb", quoteSymbol: "<valor>", currency: "BRL", benchmark: null,
  rateE6: null, maturityDate: null, liquidity: null, broker: "BTG", objective: "Aposentadoria", investor: "Ana",
};

test("history inclui previdência com cota", () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [pgbl]);
  insertTransactions(db, [{ instrumentId: pgbl.id, tradeDate: "2026-09-17", kind: "BUY", quantityE8: 5_00000000n, grossCents: 50_000n, feesCents: 0n, note: null, legacyRow: null }]);
  writeFundQuotas(db, [{ symbol: "<valor>", date: "2026-09-17", quotaE12: 1_220_696_672_715n, source: "cvm-swb", settled: true }], "2026-09-18");
  const points = buildHistory(db, { from: "2026-09", to: "2026-09" }, { now: () => new Date("2026-09-18T12:00:00-03:00") });
  assert.equal(points[0]?.marketValueCents, 610n);
  assert.equal(points[0]?.investedCents, 50_000n);
});
```

- [ ] **Step 5: Atualizar `src/jobs/scheduler.ts`**

```ts
export const CRON_QUOTES = "*/10 10-17 * * 1-5";
export const CRON_DAILY = "0 7 * * *";

export type CronTask = { stop: () => void };
export type CronLike = {
  schedule: (expression: string, callback: () => void | Promise<void>, options: { timezone: string }) => CronTask;
};
```

```ts
  const quotesTask = cronImpl.schedule(CRON_QUOTES, () => run({ quotesOnly: true }), { timezone });
  const runDaily = async () => {
    try {
      await refreshFn(db, { source: "bcb" });
    } catch (error) {
      onError(error);
    }
    try {
      await refreshFn(db, { source: "cvm-swb" });
    } catch (error) {
      onError(error);
    }
  };
  const dailyTask = cronImpl.schedule(CRON_DAILY, () => runDaily(), { timezone });

  return {
    stop: () => { quotesTask.stop(); dailyTask.stop(); },
    runNow: () => run({}),
  };
```

- [ ] **Step 6: Atualizar `src/jobs/scheduler.test.ts`**

```ts
import { CRON_DAILY, CRON_QUOTES, startScheduler, type CronLike } from "./scheduler.ts";
```

Trocar as asserções e o disparo:

```ts
  assert.deepEqual(scheduled.map((task) => task.expression), [CRON_QUOTES, CRON_DAILY]);
  assert.equal(scheduled[0]?.expression, "*/10 10-17 * * 1-5");
  assert.equal(scheduled[1]?.expression, "0 7 * * *");
  assert.equal(scheduled.every((task) => task.timezone === "America/Sao_Paulo"), true);

  scheduled[0]?.callback();
  await scheduled[1]?.callback();
  assert.deepEqual(calls, [{ quotesOnly: true }, { source: "bcb" }, { source: "cvm-swb" }]);
```

(o teste passa a ser `async`; `scheduler.stop()` segue contando 2 stops).

- [ ] **Step 7: Atualizar `README.md`**

Linha 10–11 (comentário do bloco de execução) e a tabela de rotas (linha 40):

```
    # cotações/índices: job roda no processo (10 min no pregão; índices + previdência às 7h);
```

```
| `POST /api/refresh?full=1&source=yahoo\|alphavantage\|bcb\|cvm-swb` | coleta manual (todas as fontes sem `source`); `full=1` refaz a janela |
```

- [ ] **Step 8: Rodar tudo e commitar**

Run: `npm test && npm run typecheck && npm run build:web`
Expected: PASS.

```bash
git add src/services src/jobs README.md
git commit -m "feat: previdencia no portfolio, history e job diario"
```

---

### Task 6: Verificação real e ROADMAP

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 1: Suíte completa**

Run: `npm test && npm run typecheck && npm run build:web`
Expected: tudo verde.

- [ ] **Step 2: Refresh real da previdência**

```bash
docker compose up -d --build
curl -s localhost:3000/api/health | head -c 400
curl -s -X POST "localhost:3000/api/refresh?source=cvm-swb"
```

Expected: health com `cvm-swb`; refresh com `fetched > 0` e `errors: []`.

- [ ] **Step 3: Conferir cotas e posição**

```bash
sqlite3 -header -column data/investments.db "SELECT date, quota_e12 FROM fund_quotas WHERE symbol='<valor>' ORDER BY date DESC LIMIT 3;"
curl -s localhost:3000/api/portfolio | python3 -c "import json,sys; p=json.load(sys.stdin); print([x for x in p['positions'] if x['kind']=='pension'])"
```

Expected: cota de 2026-09-17 = `<valor>`; posição PGBL com `marketValueCents` = cotas × última cota, `priceSource: "cvm-swb"` e `stale: false`. Conferir a última cota contra a tela da CVM (`https://cvmweb.cvm.gov.br/SWB/Sistemas/SCW/CPublica/InfDiario/CPublicaInfdiario.aspx?PK_PARTIC=<valor>&PK_SUBCLASSE=-1`).

- [ ] **Step 4: Atualizar o ROADMAP**

- Tabela "Estado atual": `S5 — previdência (CVM SWB) | concluída — merge local na main`; `S6 — dashboard + reconciliação | próxima`.
- Remover a lacuna "Previdência PGBL sem cota/valor (S5)".
- Evidências: `npm test` com a contagem nova; `fund_quotas` com a série real; `/api/portfolio` com PGBL valorizado.
- "Próxima ação": rodar `brainstorming` para a S6.
- Seção §Etapa 5: registrar o estado concluído.

- [ ] **Step 5: Commit final**

```bash
git add ROADMAP.md
git commit -m "docs: registra a s5 concluida no roadmap"
```
