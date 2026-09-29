# Dashboard + reconciliação (S6) — Plano de Implementação

> **Para agentes:** sub-skill obrigatória: `superpowers:executing-plans` (execução inline, padrão bento) com TDD task a task. Passos usam checkbox (`- [ ]`).

**Goal:** ligar o dashboard pré-desenhado aos dados da API (cards, tabela de posições, alocação, evolução 12 meses em base 100, selo de atualização, refresh manual e revalidação a cada 5 min) e provar fidelidade ao legado com `GET /api/reconciliation`: resíduos de posições encerradas zerados no domínio, cada divergência classificada com causa e reparo automático de trechos constantes de cotação (B5P211) via Alpha Vantage mensal.

**Architecture:** domínio puro (`position.ts` com zeragem de resíduo; `quote-runs.ts` com detecção de trechos) → `sources/alphavantage.ts` (`fetchMonthly`) → `services/quote-repair.ts` (delete+insert idempotente) integrado em `services/refresh.ts` → `services/reconciliation.ts` (legado × nosso, classificação de causas) → rotas (`/api/reconciliation`, `POST /api/refresh` com `repairs`) → `web/DashboardView.tsx` (Recharts base 100). CLI `npm run backfill` força uma janela de reparo.

**Tech Stack:** Node 22 + TypeScript (type-stripping), Fastify 5, better-sqlite3, `node-cron` 4, `node:test`; web com Vite + React 19 + Recharts + Phosphor Icons.

**Spec:** `docs/superpowers/specs/2026-09-21-s6-dashboard-reconciliacao-design.md`

## Global Constraints

- Node ≥ 22.18, ESM, imports `.ts` explícitos; backend sem build (type-stripping). `node:test`; nenhum teste com rede.
- Zero `float` em dado persistido/cálculo: BigInt escalonado (cents 1e2, shares 1e8, rate 1e12, multiplier 1e6, quota 1e12); `Number` só na borda da API (`toNumberSafe`). `parseDecimal` sempre a partir de string.
- Camadas: `domain` sem I/O; `sources` sem domínio/banco; rotas finas chamam services; leitura calcula on-the-fly.
- `settled`: linha `quotes` com `settled = 1` nunca é sobrescrita por `writeQuotes`; o reparo usa delete+insert explícito (transação única) porque substitui histórico fechado.
- Limites de PR (bento): **≤ 400 linhas / ≤ 10 arquivos por layer**; cada task = 1 layer; `package-lock.json` sincroniza no trunk (só a task do Recharts mexe nele).
- Artefatos e commits em pt-BR.
- Regras de classificação da reconciliação (ordem fixa, primeira que casar): `residuo-zerado` → `transacao-fora-da-janela` → `legado-snapshot-maio-2025` (`cdb-di-01-12-28`, mês ≥ 2025-05) → `legado-sem-cdi-maio-2026` (CDI, mês ≥ 2026-05, diff > 0) → `legado-sem-selic-junho-2026` (SELIC, mês ≥ 2026-06, diff > 0) → `fonte-yahoo-corrompida` (B5P211, mês ≤ 2026-01) → `data-de-referencia` (`|diff| ≤ 0,5% × |legado|`) → `nao-explicada`.
- Dados reais de referência: 2026-09 legado = <valor>¢; referência (negativos zerados) = <valor>¢; `asOf=2026-09-16` → `unexplained = 0` com 27 divergências (21 CDI, 2 SELIC, 1 snapshot, 1 resíduo, 1 transação, 1 data).
- Reparo real: janela B5P211 `2025-04-23..2026-01-07` = 179 linhas → 9 pontos mensais; Alpha Vantage mensal grátis (1 request).

---

## Estrutura de arquivos (S6)

```
src/domain/position.ts  position.test.ts       # zeragem de resíduo (T1)
src/domain/quote-runs.ts  quote-runs.test.ts   # trechos constantes (T3)
src/sources/types.ts                           # + MonthlyQuoteSource (T2)
src/sources/alphavantage.ts  alphavantage.test.ts  # + fetchMonthly (T2)
src/sources/index.ts  index.test.ts            # + createMonthlyQuoteSource (T4)
src/services/quote-repair.ts  quote-repair.test.ts # reparo idempotente (T3)
src/services/refresh.ts  refresh.test.ts       # + repairs pós-cotações (T4)
src/api/routes/refresh.ts  src/api/app.test.ts # resposta com repairs (T4)
src/backfill-cli.ts                            # CLI de reparo forçado (T4)
src/services/portfolio.ts  portfolio.test.ts   # + asOf explícito (T5)
src/services/reconciliation.ts  reconciliation.test.ts # legado × nosso (T5)
src/api/routes/reconciliation.ts  src/app.ts   # rota (T6)
web/src/api.ts  web/src/format.ts              # fetchers e formatação (T7)
web/src/views/DashboardView.tsx  web/src/styles.css # dashboard (T7 e T8)
package.json  package-lock.json                # recharts + script backfill (T4/T8)
README.md                                      # reparo e rota nova (T4/T6)
ROADMAP.md                                     # etapa concluída (T9)
```

---

### Task 1: Domínio — zeragem de resíduo de posição encerrada

**Files:**
- Modify: `src/domain/position.ts`, `src/domain/position.test.ts`

**Interfaces:**
- Consumes: `rfValueCents`, `equityValueCents`, `pensionValueCents`, `instrumentValue`, `PositionInput` (S4/S5).
- Produces: `instrumentValue` passa a devolver `marketValueCents = 0n` para posição encerrada (RV/PGBL com `quantityE8 === 0n`; RF com último movimento de saldo `SELL`/`AMORTIZATION` e valor ≤ `1n`). Nada muda em `investedCents`/`redeemedCents`/`feesCents`/`priceCents`/`priceDate`.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao final de `src/domain/position.test.ts`:

```ts
test("RF encerrada zera resíduo (≤ R$ <valor>) e resgate parcial fica intacto", () => {
  const rates = [rate("2026-01-02"), rate("2026-01-05")];
  const base: PositionInput = {
    kind: "fixed_income", benchmark: "CDI", rateE6: 1_000_000n,
    transactions: [
      { tradeDate: "2026-01-02", kind: "BUY", quantityE8: null, grossCents: 100_000n, feesCents: 0n },
      { tradeDate: "2026-01-05", kind: "SELL", quantityE8: null, grossCents: 100_400n, feesCents: 0n },
    ],
    quotes: [], rates,
  };
  // compra capitalizada: <valor> × 1,001 × 1,001 = <valor>; venda D+0: <valor> × 1,001 = <valor> → resíduo −300
  assert.equal(instrumentValue(base, "2026-01-05").marketValueCents, 0n);

  const tiny: PositionInput = {
    ...base,
    transactions: [base.transactions[0]!, { tradeDate: "2026-01-05", kind: "SELL", quantityE8: null, grossCents: 100_099n, feesCents: 0n }],
  };
  // venda <valor> × 1,001 = <valor>,099 → <valor> → resíduo +1
  assert.equal(instrumentValue(tiny, "2026-01-05").marketValueCents, 0n);

  const partial: PositionInput = {
    ...base,
    transactions: [base.transactions[0]!, { tradeDate: "2026-01-05", kind: "SELL", quantityE8: null, grossCents: 40_000n, feesCents: 0n }],
  };
  // <valor> − <valor> = <valor> (posição segue aberta)
  assert.equal(instrumentValue(partial, "2026-01-05").marketValueCents, 60_160n);
});

test("RV/PGBL com quantidade zero valem 0 mesmo sem cotação; posição aberta sem cotação fica null", () => {
  const equity: PositionInput = {
    kind: "equity", benchmark: null, rateE6: null,
    transactions: [
      { tradeDate: "2026-01-02", kind: "BUY", quantityE8: 10_00000000n, grossCents: 1_000n, feesCents: 0n },
      { tradeDate: "2026-01-05", kind: "SELL", quantityE8: -10_00000000n, grossCents: 1_100n, feesCents: 0n },
    ],
    quotes: [], rates: [],
  };
  assert.equal(instrumentValue(equity, "2026-01-05").marketValueCents, 0n);
  assert.equal(instrumentValue({ ...equity, kind: "pension" }, "2026-01-05").marketValueCents, 0n);
  assert.equal(instrumentValue({ ...equity, transactions: [equity.transactions[0]!] }, "2026-01-05").marketValueCents, null);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test "src/domain/position.test.ts"`
Expected: FAIL (o primeiro teste recebe `-300n`; o segundo, `null`).

- [ ] **Step 3: Implementar em `src/domain/position.ts`**

Adicionar antes de `instrumentValue`:

```ts
/** Posição encerrada vale exatamente 0 (resíduo de arredondamento ≤ R$ <valor> zerado). */
function zeroClosedResidue(
  kind: InstrumentKind,
  quantityE8: bigint | null,
  valueCents: bigint | null,
  lastBalanceKind: TransactionKind | null,
): bigint | null {
  if (kind === "equity" || kind === "pension") {
    if (quantityE8 === 0n) return 0n;
    return valueCents;
  }
  if (valueCents === null) return null;
  if ((lastBalanceKind === "SELL" || lastBalanceKind === "AMORTIZATION") && valueCents <= 1n) return 0n;
  return valueCents;
}
```

Dentro de `instrumentValue`, declarar `let lastBalanceKind: TransactionKind | null = null;` junto de `quantityE8` e, no laço (depois do `if` que soma `quantityE8`), registrar o último movimento de saldo:

```ts
    if (transaction.kind === "BUY" || transaction.kind === "SELL" || transaction.kind === "AMORTIZATION") lastBalanceKind = transaction.kind;
```

Trocar o retorno dos três branches para aplicar a regra:

```ts
  if (input.kind === "fixed_income") {
    const multiplierE6 = input.rateE6 ?? 1_000_000n;
    const { valueCents, lastRateDate } = rfValueCents(operations, input.rates, multiplierE6, asOf);
    return {
      marketValueCents: zeroClosedResidue("fixed_income", null, valueCents, lastBalanceKind),
      priceCents: null, priceDate: lastRateDate, quantityE8: null, investedCents, redeemedCents, feesCents,
    };
  }
  if (input.kind === "pension") {
    const quota = pensionValueCents(quantityE8 ?? 0n, input.pensionQuotes ?? [], asOf);
    return {
      marketValueCents: zeroClosedResidue("pension", quantityE8, quota.valueCents, lastBalanceKind),
      priceCents: quota.priceCents, priceDate: quota.priceDate, quantityE8, investedCents, redeemedCents, feesCents,
    };
  }
  const equity = equityValueCents(quantityE8 ?? 0n, input.quotes, asOf);
  return {
    marketValueCents: zeroClosedResidue("equity", quantityE8, equity.valueCents, lastBalanceKind),
    priceCents: equity.priceCents, priceDate: equity.priceDate, quantityE8, investedCents, redeemedCents, feesCents,
  };
```

- [ ] **Step 4: Rodar tudo e commitar**

Run: `node --test "src/domain/*.test.ts" && npm run typecheck`
Expected: PASS.

```bash
git add src/domain
git commit -m "feat: zera residuo de posicao encerrada no dominio"
```

---

### Task 2: Fonte — Alpha Vantage mensal

**Files:**
- Modify: `src/sources/types.ts`, `src/sources/alphavantage.ts`, `src/sources/alphavantage.test.ts`

**Interfaces:**
- Consumes: `FetchLike`, `Quote`, `CENTS`, `parseDecimal`.
- Produces:
  - `type MonthlyQuoteSource = { id: string; available(): Promise<boolean>; fetchMonthly(symbols: string[], from: string, to: string): Promise<Quote[]> }` (`types.ts`)
  - `createAlphaVantageSource(deps)` passa a devolver `QuoteSource & MonthlyQuoteSource` com `fetchMonthly` (`function=TIME_SERIES_MONTHLY`, sem `outputsize`).

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao final de `src/sources/alphavantage.test.ts`:

```ts
const monthlyFixture = {
  "Monthly Time Series": {
    "2025-12-30": { "4. close": "101.6600" },
    "2026-01-30": { "4. close": "102.9000" },
  },
};

test("alphavantage mensal converte close e filtra a janela", async () => {
  const source = createAlphaVantageSource({
    apiKey: "chave",
    fetchImpl: async (url) => {
      assert.match(url, /function=TIME_SERIES_MONTHLY/);
      assert.match(url, /symbol=B5P211\.SAO/);
      assert.doesNotMatch(url, /outputsize/);
      return new Response(JSON.stringify(monthlyFixture), { status: 200 });
    },
  });
  const quotes = await source.fetchMonthly(["B5P211"], "2025-04-23", "2026-01-07");
  assert.deepEqual(quotes, [{ ticker: "B5P211", date: "2025-12-30", closeCents: 10166n }]);
});

test("alphavantage mensal propaga recusa da fonte", async () => {
  const source = createAlphaVantageSource({
    apiKey: "chave",
    fetchImpl: async () => new Response(JSON.stringify({ Information: "premium feature" }), { status: 200 }),
  });
  await assert.rejects(() => source.fetchMonthly(["B5P211"], "2025-01-01", "2025-12-31"), /recusou/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test "src/sources/alphavantage.test.ts"`
Expected: FAIL (`fetchMonthly` não existe).

- [ ] **Step 3: Implementar**

Em `src/sources/types.ts`, adicionar ao final:

```ts
export type MonthlyQuoteSource = {
  id: string;
  available(): Promise<boolean>;
  fetchMonthly(symbols: string[], from: string, to: string): Promise<Quote[]>;
};
```

Em `src/sources/alphavantage.ts`:

1. Ajustar o import de tipos:

```ts
import type { FetchLike, MonthlyQuoteSource, Quote, QuoteSource } from "./types.ts";
```

2. Adicionar o tipo da resposta mensal após `DailyResponse`:

```ts
type MonthlyResponse = {
  "Monthly Time Series"?: Record<string, { "4. close"?: string }>;
  Note?: string;
  Information?: string;
  "Error Message"?: string;
};
```

3. Trocar a assinatura e o retorno da fábrica para incluir `refusalOf` e `fetchMonthly`:

```ts
export function createAlphaVantageSource(deps: AlphaVantageDeps): QuoteSource & MonthlyQuoteSource {
  const fetchImpl: FetchLike = deps.fetchImpl ?? fetch;
  const configured = () => deps.apiKey.trim() !== "";
  const refusalOf = (payload: { Note?: string; Information?: string; "Error Message"?: string }): string | undefined =>
    payload.Note ?? payload.Information ?? payload["Error Message"];
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
        const refusal = refusalOf(payload);
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
    async fetchMonthly(symbols, from, to) {
      if (!configured()) throw new Error("alphavantage sem chave configurada");
      const quotes: Quote[] = [];
      for (const ticker of symbols) {
        const symbol = `${ticker}.SAO`;
        const url = `${BASE}?function=TIME_SERIES_MONTHLY&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(deps.apiKey)}`;
        const response = await fetchImpl(url);
        if (!response.ok) throw new Error(`alphavantage HTTP ${response.status} para ${ticker}`);
        const payload = (await response.json()) as MonthlyResponse;
        const refusal = refusalOf(payload);
        if (refusal) throw new Error(`alphavantage recusou ${ticker}: ${refusal.slice(0, 80)}`);
        const series = payload["Monthly Time Series"];
        if (!series) throw new Error(`alphavantage sem série mensal para ${ticker}`);
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

- [ ] **Step 4: Rodar tudo e commitar**

Run: `node --test "src/sources/*.test.ts" && npm run typecheck`
Expected: PASS (os testes antigos seguem verdes: o diário mantém `outputsize=full`).

```bash
git add src/sources
git commit -m "feat: serie mensal da alphavantage para reparo de historico"
```

---

### Task 3: Reparo — detecção de trechos e serviço idempotente

**Files:**
- Create: `src/domain/quote-runs.ts`, `src/domain/quote-runs.test.ts`, `src/services/quote-repair.ts`, `src/services/quote-repair.test.ts`

**Interfaces:**
- Consumes: `Db`, `listAllQuotes`, `listInstruments`, `toBrDate`, `MonthlyQuoteSource`, `Quote`.
- Produces:
  - `findConstantRuns(quotes, { minDays?, today }): Array<{ from: string; to: string }>` (puro; `minDays` default 7; só trechos encerrados antes de `today`)
  - `type QuoteRepairResult = { ticker; from; to; deleted; inserted; skipped?; error? }`
  - `repairConstantRuns(db, { source, now? }): Promise<QuoteRepairResult[]>`
  - `repairWindow(db, { source, ticker, from, to }): Promise<QuoteRepairResult>` (força a janela; usado pelo CLI)

- [ ] **Step 1: Escrever os testes que falham (domínio)**

Criar `src/domain/quote-runs.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { findConstantRuns } from "./quote-runs.ts";

const flat = (count: number, closeCents = 10n, start = 1) =>
  Array.from({ length: count }, (_, index) => ({
    date: `2026-01-${String(start + index).padStart(2, "0")}`,
    closeCents,
  }));

test("findConstantRuns detecta trecho >= 7 encerrado antes de hoje", () => {
  const quotes = [
    { date: "2025-12-31", closeCents: 5n },
    ...flat(7, 10n),
    { date: "2026-01-08", closeCents: 30n },
  ];
  assert.deepEqual(findConstantRuns(quotes, { today: "2026-01-09" }), [{ from: "2026-01-01", to: "2026-01-07" }]);
});

test("findConstantRuns ignora trecho curto, trecho que termina hoje e encontra múltiplos", () => {
  assert.deepEqual(findConstantRuns(flat(6), { today: "2026-02-01" }), []);
  assert.deepEqual(findConstantRuns(flat(7), { today: "2026-01-07" }), []);
  const quotes = [...flat(7, 10n), { date: "2026-01-08", closeCents: 30n }, ...flat(8, 20n, 9)];
  assert.deepEqual(findConstantRuns(quotes, { today: "2026-02-01" }), [
    { from: "2026-01-01", to: "2026-01-07" },
    { from: "2026-01-09", to: "2026-01-16" },
  ]);
  assert.deepEqual(findConstantRuns([], { today: "2026-01-09" }), []);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test "src/domain/quote-runs.test.ts"`
Expected: FAIL (`./quote-runs.ts` não existe).

- [ ] **Step 3: Implementar `src/domain/quote-runs.ts`**

```ts
export type ConstantRunQuote = { date: string; closeCents: bigint };

/** Trechos de fechamentos idênticos consecutivos com >= minDays linhas, encerrados antes de `today`. */
export function findConstantRuns(
  quotes: ConstantRunQuote[],
  options: { minDays?: number; today: string },
): Array<{ from: string; to: string }> {
  const minDays = options.minDays ?? 7;
  const runs: Array<{ from: string; to: string }> = [];
  let start = 0;
  for (let index = 1; index <= quotes.length; index++) {
    const same = index < quotes.length && quotes[index]!.closeCents === quotes[index - 1]!.closeCents;
    if (same) continue;
    const length = index - start;
    const from = quotes[start]!.date;
    const to = quotes[index - 1]!.date;
    if (length >= minDays && to < options.today) runs.push({ from, to });
    start = index;
  }
  return runs;
}
```

- [ ] **Step 4: Escrever os testes que falham (serviço)**

Criar `src/services/quote-repair.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { insertInstruments, listAllQuotes, writeQuotes } from "../db/repos.ts";
import type { InstrumentRow, QuoteRow } from "../db/repos.ts";
import type { MonthlyQuoteSource, Quote } from "../sources/types.ts";
import { repairConstantRuns, repairWindow } from "./quote-repair.ts";

const etf: InstrumentRow = {
  id: "b5p211", legacyKey: "B5P211", name: "B5P211", kind: "equity", category: "etf_fixed",
  ticker: "B5P211", quoteSource: "yahoo", quoteSymbol: null, currency: "BRL", benchmark: null,
  rateE6: null, maturityDate: null, liquidity: null, broker: "XP", objective: "Longo prazo", investor: "Ana",
};

const TODAY = "2026-09-21";
const now = () => new Date("2026-09-21T12:00:00-03:00");

const flatQuotes = (count: number, month = "2025-04"): QuoteRow[] =>
  Array.from({ length: count }, (_, index) => ({
    ticker: "B5P211",
    date: `${month}-${String(index + 1).padStart(2, "0")}`,
    closeCents: 7125n,
    source: "yahoo",
    settled: true,
  }));

const fakeMonthly = (result: Quote[] | Error): MonthlyQuoteSource => ({
  id: "alphavantage",
  available: async () => true,
  fetchMonthly: async () => {
    if (result instanceof Error) throw result;
    return result;
  },
});

function freshDb() {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [etf]);
  return db;
}

test("repairConstantRuns substitui o trecho constante pela série mensal e é idempotente", async () => {
  const db = freshDb();
  writeQuotes(db, flatQuotes(8), TODAY);
  const results = await repairConstantRuns(db, {
    source: fakeMonthly([{ ticker: "B5P211", date: "2025-04-30", closeCents: 9_570n }]),
    now,
  });
  assert.deepEqual(results, [{ ticker: "B5P211", from: "2025-04-01", to: "2025-04-08", deleted: 8, inserted: 1 }]);
  assert.deepEqual(
    listAllQuotes(db).map((quote) => [quote.date, quote.closeCents, quote.source]),
    [["2025-04-30", 9_570n, "alphavantage"]],
  );
  assert.deepEqual(await repairConstantRuns(db, { source: fakeMonthly([]), now }), []);
});

test("reparo não apaga quando a AV não tem ponto na janela; erro não derruba nem altera", async () => {
  const db = freshDb();
  writeQuotes(db, flatQuotes(8), TODAY);
  const skipped = await repairConstantRuns(db, {
    source: fakeMonthly([{ ticker: "B5P211", date: "2025-03-31", closeCents: 1n }]),
    now,
  });
  assert.equal(skipped[0]?.skipped, true);
  assert.equal(listAllQuotes(db).length, 8, "nada foi apagado");

  const failed = await repairConstantRuns(db, { source: fakeMonthly(new Error("av fora do ar")), now });
  assert.match(failed[0]?.error ?? "", /av fora do ar/);
  assert.equal(listAllQuotes(db).length, 8, "nada mudou");
});

test("repairWindow força a janela mesmo sem trecho constante", async () => {
  const db = freshDb();
  writeQuotes(db, [{ ticker: "B5P211", date: "2025-04-01", closeCents: 1n, source: "yahoo", settled: true }], TODAY);
  const result = await repairWindow(db, {
    source: fakeMonthly([{ ticker: "B5P211", date: "2025-04-30", closeCents: 9_570n }]),
    ticker: "B5P211", from: "2025-04-01", to: "2025-04-30", today: TODAY,
  });
  assert.deepEqual(result, { ticker: "B5P211", from: "2025-04-01", to: "2025-04-30", deleted: 1, inserted: 1 });
});

test("trecho no mês corrente ignora ponto parcial da AV e nada é apagado", async () => {
  const db = freshDb();
  writeQuotes(db, flatQuotes(8, "2026-09"), TODAY);
  const results = await repairConstantRuns(db, {
    source: fakeMonthly([{ ticker: "B5P211", date: "2026-09-18", closeCents: 9_570n }]),
    now,
  });
  assert.equal(results[0]?.skipped, true);
  assert.equal(listAllQuotes(db).length, 8, "as 8 linhas continuam lá");
  assert.deepEqual(listAllQuotes(db).map((quote) => quote.source), Array(8).fill("yahoo"));
});

test("fonte indisponível não consulta nem toca o banco", async () => {
  const db = freshDb();
  writeQuotes(db, flatQuotes(8), TODAY);
  const unavailable: MonthlyQuoteSource = {
    id: "alphavantage", available: async () => false,
    fetchMonthly: async () => { throw new Error("não deve chamar"); },
  };
  assert.deepEqual(await repairConstantRuns(db, { source: unavailable, now }), []);
  assert.equal(listAllQuotes(db).length, 8);
});
```

- [ ] **Step 5: Rodar e ver falhar**

Run: `node --test "src/services/quote-repair.test.ts"`
Expected: FAIL (`./quote-repair.ts` não existe).

- [ ] **Step 6: Implementar `src/services/quote-repair.ts`**

```ts
import type { Db } from "../db/index.ts";
import { listAllQuotes, listInstruments } from "../db/repos.ts";
import { monthEnd, toBrDate } from "../domain/dates.ts";
import { findConstantRuns } from "../domain/quote-runs.ts";
import type { MonthlyQuoteSource, Quote } from "../sources/types.ts";

export type QuoteRepairResult = {
  ticker: string; from: string; to: string; deleted: number; inserted: number; skipped?: boolean; error?: string;
};

export type QuoteRepairDeps = { source: MonthlyQuoteSource; now?: () => Date };

/** Substitui a janela pela série mensal; sem meses fechados que contêm a janela não apaga nada. */
export async function repairWindow(
  db: Db,
  deps: { source: MonthlyQuoteSource; ticker: string; from: string; to: string; today?: string },
): Promise<QuoteRepairResult> {
  const today = deps.today ?? toBrDate(new Date());
  const fetchFrom = `${deps.from.slice(0, 7)}-01`;
  const fetchTo = monthEnd(deps.to.slice(0, 7));
  const quotes = (await deps.source.fetchMonthly([deps.ticker], fetchFrom, fetchTo))
    .filter((quote) =>
      quote.date >= fetchFrom && quote.date <= fetchTo &&
      quote.date.slice(0, 7) < today.slice(0, 7) && quote.closeCents > 0n);
  if (quotes.length === 0) {
    return { ticker: deps.ticker, from: deps.from, to: deps.to, deleted: 0, inserted: 0, skipped: true };
  }
  const replace = db.transaction((items: Quote[]) => {
    const deleted = Number(db.prepare("DELETE FROM quotes WHERE ticker = ? AND date >= ? AND date <= ?")
      .run(deps.ticker, deps.from, deps.to).changes);
    const insert = db.prepare(`INSERT INTO quotes (ticker, date, close_cents, source, settled)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(ticker, date) DO UPDATE SET
        close_cents = excluded.close_cents, source = excluded.source, settled = 1, fetched_at = datetime('now')`);
    for (const quote of items) insert.run(quote.ticker, quote.date, quote.closeCents, deps.source.id);
    return { deleted, inserted: items.length };
  });
  return { ticker: deps.ticker, from: deps.from, to: deps.to, ...replace(quotes) };
}

export async function repairConstantRuns(db: Db, deps: QuoteRepairDeps): Promise<QuoteRepairResult[]> {
  if (!(await deps.source.available())) return [];
  const today = toBrDate((deps.now ?? (() => new Date()))());
  const quotes = listAllQuotes(db);
  const tickers = listInstruments(db)
    .filter((instrument) => instrument.kind === "equity" && instrument.ticker !== null)
    .map((instrument) => instrument.ticker as string);
  const results: QuoteRepairResult[] = [];
  for (const ticker of tickers) {
    for (const run of findConstantRuns(quotes.filter((quote) => quote.ticker === ticker), { today })) {
      try {
        results.push(await repairWindow(db, { source: deps.source, ticker, from: run.from, to: run.to, today }));
      } catch (error) {
        results.push({
          ticker, from: run.from, to: run.to, deleted: 0, inserted: 0,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return results;
}
```

**Por que buscar os meses-calendário:** a Alpha Vantage mensal só devolve fechamento de fim de mês; filtrar pela janela exata do trecho impediria o reparo de trechos que não contêm um fim de mês. O delete continua restrito a `[from, to]`; os pontos de fim de mês fora do trecho são upsertados (mesmo valor esperado do fechamento diário daquele dia).

**Por que só meses fechados (`quote.date.slice(0,7) < today.slice(0,7)`):** a série mensal da AV inclui o mês corrente (parcial, atualizado em tempo real, com data no último dia de negociação). Sem o gate, esse ponto seria upsertado fora da janela apagada e travado como `settled = 1` (o job diário nunca mais toca linhas fechadas). Trecho no mês corrente → `skipped`.

- [ ] **Step 7: Rodar tudo e commitar**

Run: `node --test "src/domain/*.test.ts" "src/services/quote-repair.test.ts" && npm run typecheck`
Expected: PASS.

```bash
git add src/domain src/services
git commit -m "feat: reparo de trechos constantes de cotacao com alphavantage mensal"
```

---

### Task 4: Reparo — orquestrador, CLI, rota e README

**Files:**
- Modify: `src/sources/index.ts`, `src/sources/index.test.ts`, `src/services/refresh.ts`, `src/services/refresh.test.ts`, `src/api/routes/refresh.ts`, `src/api/app.test.ts`, `package.json`, `README.md`
- Create: `src/backfill-cli.ts`

**Interfaces:**
- Consumes: `createAlphaVantageSource` (T2), `repairConstantRuns`/`repairWindow` (T3), `RefreshDeps`/`RefreshResult` (S4).
- Produces:
  - `createMonthlyQuoteSource(deps?): MonthlyQuoteSource` (`sources/index.ts`)
  - `RefreshDeps.monthlySource?`; `RefreshResult.repairs: QuoteRepairResult[]`; reparo roda após o passo de cotações (full e `quotesOnly`), não em `source=cvm-swb`
  - `POST /api/refresh` devolve `{ sources, repairs }`
  - script `npm run backfill` → `src/backfill-cli.ts`

- [ ] **Step 1: `src/sources/index.ts` + teste**

Adicionar `MonthlyQuoteSource` ao import de tipos e exportar:

```ts
/** Fonte mensal para o reparo de histórico (Alpha Vantage; indisponível sem chave). */
export function createMonthlyQuoteSource(deps: SourceDeps = {}): MonthlyQuoteSource {
  return createAlphaVantageSource({ apiKey: deps.alphaVantageApiKey ?? "", fetchImpl: deps.fetchImpl });
}
```

Em `src/sources/index.test.ts`, adicionar `createMonthlyQuoteSource` ao import e ao teste existente:

```ts
  assert.equal(createMonthlyQuoteSource({}).id, "alphavantage");
  assert.equal(await createMonthlyQuoteSource({}).available(), false);
```

(o teste existente passa a ser `async` se ainda não for.)

- [ ] **Step 2: Integrar no `src/services/refresh.ts`**

Trocar imports e tipos:

```ts
import { createFundQuotaSource, createIndexSource, createMonthlyQuoteSource, createQuoteSources } from "../sources/index.ts";
import type { FundQuotaSource, IndexSource, MonthlyQuoteSource, QuoteSource } from "../sources/types.ts";
import { repairConstantRuns, type QuoteRepairResult } from "./quote-repair.ts";
```

```ts
export type RefreshResult = { sources: RefreshSourceSummary[]; repairs: QuoteRepairResult[] };
export type RefreshDeps = {
  quoteSources?: QuoteSource[];
  indexSource?: IndexSource;
  pensionSource?: FundQuotaSource;
  monthlySource?: MonthlyQuoteSource;
  now?: () => Date;
  fallbackAttempts?: Map<string, string>;
};
```

No corpo: criar a fonte mensal junto das outras e rodar o reparo depois das cotações:

```ts
    const pensionSource = deps.pensionSource ?? createFundQuotaSource(sourceDeps);
    const monthlySource = deps.monthlySource ?? createMonthlyQuoteSource(sourceDeps);
```

```ts
    const summaries: RefreshSourceSummary[] = [];
    let repairs: QuoteRepairResult[] = [];
    if (wantsQuotes) {
      let sources = quoteSources;
      if (wanted === "alphavantage") {
        const alphaVantage = quoteSources.find((source) => source.id === "alphavantage");
        if (!alphaVantage) throw new RefreshRequestError("alphavantage não configurado (ALPHAVANTAGE_API_KEY ausente)");
        sources = [alphaVantage];
      } else if (wanted === "yahoo") {
        sources = quoteSources.filter((source) => source.id === "yahoo");
      }
      summaries.push(...(await refreshQuotes(db, { sources, now: deps.now, full: options.full, fallbackAttempts: deps.fallbackAttempts })));
      repairs = await repairConstantRuns(db, { source: monthlySource, now: deps.now });
    }
```

```ts
    return { sources: summaries, repairs };
```

- [ ] **Step 3: Atualizar `src/services/refresh.test.ts`**

Adicionar ao topo: `listAllQuotes` no import de repos e `MonthlyQuoteSource` no import de tipos:

```ts
import { insertInstruments, insertTransactions, listAllFundQuotas, listAllQuotes } from "../db/repos.ts";
import type { FundQuotaSource, IndexSource, MonthlyQuoteSource, QuoteSource } from "../sources/types.ts";
```

Os testes existentes não precisam de ajuste: sem `ALPHAVANTAGE_API_KEY` no ambiente, a fonte mensal default fica indisponível e o reparo devolve `[]` sem rede. Adicionar os testes novos (com o instrumento de RV local, no padrão do `app.test.ts`):

```ts
const etfInstrument: InstrumentRow = {
  id: "etf-1", legacyKey: "ETF 1", name: "ETF 1", kind: "equity", category: "etf_equity",
  ticker: "WRLD11", quoteSource: null, quoteSymbol: null, currency: "BRL", benchmark: null,
  rateE6: null, maturityDate: null, liquidity: null, broker: "XP", objective: "Reserva", investor: "Ana",
};

test("refresh roda o reparo depois das cotações e devolve repairs", async () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [etfInstrument]);
  insertTransactions(db, [{ instrumentId: etfInstrument.id, tradeDate: "2025-04-23", kind: "BUY", quantityE8: 10_00000000n, grossCents: 9_000n, feesCents: 0n, note: null, legacyRow: null }]);
  const quotes: QuoteSource = {
    id: "yahoo", available: async () => true,
    fetchDaily: async () => Array.from({ length: 8 }, (_, index) => ({ ticker: "WRLD11", date: `2025-04-${String(index + 1).padStart(2, "0")}`, closeCents: 1_000n })),
  };
  const monthly: MonthlyQuoteSource = {
    id: "alphavantage", available: async () => true,
    fetchMonthly: async () => [{ ticker: "WRLD11", date: "2025-04-30", closeCents: 1_100n }],
  };
  const result = await refresh(db, {}, {
    quoteSources: [quotes], indexSource: emptyIndexSource, monthlySource: monthly,
    now: () => new Date("2026-09-21T12:00:00-03:00"),
  });
  assert.deepEqual(result.repairs, [{ ticker: "WRLD11", from: "2025-04-01", to: "2025-04-08", deleted: 8, inserted: 1 }]);
  assert.deepEqual(listAllQuotes(db).map((quote) => [quote.date, quote.closeCents, quote.source]), [["2025-04-30", 1_100n, "alphavantage"]]);
});

test("source cvm-swb não roda o reparo", async () => {
  const db = openDb(":memory:");
  migrate(db);
  let calls = 0;
  const monthly: MonthlyQuoteSource = { id: "alphavantage", available: async () => { calls++; return true; }, fetchMonthly: async () => [] };
  const result = await refresh(db, { source: "cvm-swb" }, {
    quoteSources: [], indexSource: emptyIndexSource, pensionSource: { id: "cvm-swb", fetchDaily: async () => [] }, monthlySource: monthly,
  });
  assert.deepEqual(result.repairs, []);
  assert.equal(calls, 0);
});
```

- [ ] **Step 4: Atualizar a rota e o teste da API**

Em `src/api/routes/refresh.ts`, adicionar `repairs` à resposta:

```ts
      return {
        sources: result.sources.map((summary) => ({
          id: summary.id, fetched: summary.fetched, inserted: summary.inserted,
          updated: summary.updated, skipped: summary.skipped, errors: summary.errors,
        })),
        repairs: result.repairs,
      };
```

Em `src/api/app.test.ts`, no teste `"POST /api/refresh usa as fontes injetadas e atualiza o health"`: adicionar `MonthlyQuoteSource` ao import de tipos, injetar a fonte mensal indisponível e afirmar `repairs`:

```ts
  const monthly: MonthlyQuoteSource = { id: "alphavantage", available: async () => false, fetchMonthly: async () => [] };
  const app = buildApp({
    db, csvDir: csvDirFixture(), logger: false,
    refreshDeps: { quoteSources: [yahoo], indexSource: bcb, pensionSource: cvm, monthlySource: monthly, now: () => new Date("2026-09-18T12:00:00-03:00") },
  });
```

```ts
  assert.deepEqual(res.json().repairs, []);
```

- [ ] **Step 5: Criar o CLI e o script**

Criar `src/backfill-cli.ts`:

```ts
import { resolve } from "node:path";
import { openDb } from "./db/index.ts";
import { migrate } from "./db/migrate.ts";
import { repairWindow } from "./services/quote-repair.ts";
import { createMonthlyQuoteSource } from "./sources/index.ts";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const ticker = arg("ticker");
const from = arg("from");
const to = arg("to");
if (ticker === undefined || from === undefined || to === undefined) {
  console.error("uso: npm run backfill -- --ticker B5P211 --from 2025-04-23 --to 2026-01-07");
  process.exit(1);
}
const apiKey = process.env.ALPHAVANTAGE_API_KEY ?? "";
if (apiKey.trim() === "") {
  console.error("ALPHAVANTAGE_API_KEY ausente (coloque no .env)");
  process.exit(1);
}
const db = openDb(resolve(process.env.DB_PATH ?? "data/investments.db"));
migrate(db);
const result = await repairWindow(db, { source: createMonthlyQuoteSource({ alphaVantageApiKey: apiKey }), ticker, from, to });
if (result.skipped) console.log(`nada a reparar: alphavantage sem pontos em ${from}..${to}`);
else console.log(`reparo ${ticker} ${from}..${to}: ${result.deleted} linhas apagadas, ${result.inserted} pontos gravados`);
```

Em `package.json`, adicionar o script:

```json
    "backfill": "node --env-file-if-exists=.env src/backfill-cli.ts",
```

(CLI é entry point fino, sem teste unitário — a verificação real é o aceite da T9.)

- [ ] **Step 6: Atualizar o README**

No bloco de dev, após `npm run import`:

```
    # reparo de cotações: automático após o refresh; para forçar uma janela:
    # npm run backfill -- --ticker B5P211 --from 2025-04-23 --to 2026-01-07
```

Na seção Homelab, após a linha do backup:

```
    Reparo de cotações corrompidas é automático após o refresh (trechos de fechamento
    constante ≥ 7 dias → série mensal da Alpha Vantage). Quem copia `data/` não precisa
    rodar nada; `npm run backfill` só é necessário para forçar uma janela ou reconstruir o banco.
```

Na tabela de rotas, atualizar a linha do refresh:

```
| `POST /api/refresh?full=1&source=yahoo\|alphavantage\|bcb\|cvm-swb` | coleta manual (todas as fontes sem `source`); `full=1` refaz a janela; resposta inclui `repairs` |
```

- [ ] **Step 7: Rodar tudo e commitar**

Run: `npm test && npm run typecheck`
Expected: PASS.

```bash
git add src/sources src/services src/api src/backfill-cli.ts package.json README.md
git commit -m "feat: reparo automatico pos-refresh, cli de backfill e rota com repairs"
```

---

### Task 5: Reconciliação — serviço

**Files:**
- Modify: `src/services/portfolio.ts`, `src/services/portfolio.test.ts`
- Create: `src/services/reconciliation.ts`, `src/services/reconciliation.test.ts`

**Interfaces:**
- Consumes: `buildPortfolio`, `listLegacySnapshotByMonth`, `listAllTransactions`, `listInstruments`, `monthEnd`, `toBrDate`, `InstrumentRow`.
- Produces:
  - `buildPortfolio(db, deps)` aceita `asOf?: string` (aditivo)
  - `RECONCILIATION_CAUSES`, `ReconciliationCause`, `ReconciliationDivergence`, `ReconciliationResult`, `ReconciliationOptions`, `ReconciliationDeps`
  - `classifyDivergence(input): ReconciliationCause`
  - `buildReconciliation(db, options, deps?): ReconciliationResult`

- [ ] **Step 1: `buildPortfolio` com `asOf` explícito**

Em `src/services/portfolio.ts`:

```ts
export function buildPortfolio(db: Db, deps: { now?: () => Date; asOf?: string } = {}): PortfolioResult {
  const now = deps.now ?? (() => new Date());
  const asOf = deps.asOf ?? toBrDate(now());
```

Adicionar o teste em `src/services/portfolio.test.ts` (os nomes `etf`, `writeQuotes`, `insertTransactions` e `openDb`/`migrate` já existem no arquivo):

```ts
test("buildPortfolio aceita asOf explícito (reconciliação)", () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [etf]);
  insertTransactions(db, [{ instrumentId: etf.id, tradeDate: "2026-09-01", kind: "BUY", quantityE8: 10_00000000n, grossCents: 9_000n, feesCents: 0n, note: null, legacyRow: null }]);
  writeQuotes(db, [
    { ticker: "WRLD11", date: "2026-09-15", closeCents: 1_000n, source: "yahoo", settled: true },
    { ticker: "WRLD11", date: "2026-09-20", closeCents: 2_000n, source: "yahoo", settled: true },
  ], "2026-09-21");
  assert.equal(buildPortfolio(db, { asOf: "2026-09-15" }).positions[0]?.marketValueCents, 10_000n);
  assert.equal(buildPortfolio(db, { asOf: "2026-09-20" }).positions[0]?.marketValueCents, 20_000n);
});
```

- [ ] **Step 2: Escrever os testes que falham (classificação)**

Criar `src/services/reconciliation.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { insertInstruments, insertLegacySnapshots, insertTransactions, writeIndexRates, writeQuotes } from "../db/repos.ts";
import type { InstrumentRow } from "../db/repos.ts";
import { buildReconciliation, classifyDivergence } from "./reconciliation.ts";

const base = {
  currency: "BRL", quoteSource: null, quoteSymbol: null, maturityDate: null,
  liquidity: null, broker: "PagBank", objective: "Reserva", investor: "Ana",
} as const;

const cdi: InstrumentRow = {
  ...base, id: "cdb-1", legacyKey: "CDB 1", name: "CDB 1", kind: "fixed_income", category: "cdb",
  ticker: null, benchmark: "CDI", rateE6: 1_000_000n,
};
const etf: InstrumentRow = {
  ...base, id: "etf-1", legacyKey: "ETF 1", name: "ETF 1", kind: "equity", category: "etf_equity",
  ticker: "WRLD11", benchmark: null, rateE6: null,
};

const classify = (overrides: Partial<Parameters<typeof classifyDivergence>[0]>) =>
  classifyDivergence({
    instrument: cdi, month: "2026-09", legacyCents: 100n, ourCents: 200n, diffCents: 100n,
    transactionAfterAsOf: false, ...overrides,
  });

test("classifyDivergence segue a ordem das regras", () => {
  assert.equal(classify({ ourCents: 0n, legacyCents: -10n, diffCents: 10n }), "residuo-zerado");
  assert.equal(classify({ transactionAfterAsOf: true }), "transacao-fora-da-janela");
  assert.equal(classify({ instrument: { ...cdi, id: "cdb-di-01-12-28" } }), "legado-snapshot-maio-2025");
  assert.equal(classify({ month: "2026-05" }), "legado-sem-cdi-maio-2026");
  assert.equal(classify({ instrument: { ...cdi, benchmark: "SELIC" }, month: "2026-06" }), "legado-sem-selic-junho-2026");
  assert.equal(classify({ instrument: { ...etf, ticker: "B5P211" }, month: "2025-09" }), "fonte-yahoo-corrompida");
  assert.equal(
    classify({ month: "2024-12", legacyCents: 100_000n, ourCents: 100_100n, diffCents: 100n }),
    "data-de-referencia",
  );
  assert.equal(
    classify({ month: "2024-12", legacyCents: 100_000n, ourCents: 200_000n, diffCents: 100_000n }),
    "nao-explicada",
  );
});

test("buildReconciliation soma referência com negativos zerados, classifica e conta não explicadas", () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [cdi, etf]);
  insertTransactions(db, [
    { instrumentId: cdi.id, tradeDate: "2026-09-01", kind: "BUY", quantityE8: null, grossCents: 100_000n, feesCents: 0n, note: null, legacyRow: null },
    { instrumentId: etf.id, tradeDate: "2026-09-01", kind: "BUY", quantityE8: 10_00000000n, grossCents: 9_000n, feesCents: 0n, note: null, legacyRow: null },
  ]);
  writeIndexRates(db, [{ series: "CDI", date: "2026-09-01", valueE12: 1_000_000_000n }]);
  writeQuotes(db, [{ ticker: "WRLD11", date: "2026-09-30", closeCents: 1_000n, source: "yahoo", settled: true }], "2026-10-01");
  insertLegacySnapshots(db, [
    { month: "2026-09-01", instrumentId: cdi.id, valueCents: -3_520n, sharesE8: null },
    { month: "2026-09-01", instrumentId: etf.id, valueCents: 10_000n, sharesE8: null },
  ]);

  const result = buildReconciliation(db, { month: "2026-09", asOf: "2026-09-30" });
  assert.deepEqual(result.totals, {
    legacyCents: 6_480n, referenceCents: 10_000n, ourCents: 110_100n, diffCents: 103_620n,
  });
  assert.deepEqual(result.divergences.map((divergence) => [divergence.instrumentId, divergence.cause]), [
    ["cdb-1", "legado-sem-cdi-maio-2026"],
  ]);
  assert.equal(result.unexplained, 0);
  assert.equal(result.asOf, "2026-09-30");
});

test("buildReconciliation resolve asOf default e devolve vazio sem dados", () => {
  const db = openDb(":memory:");
  migrate(db);
  const now = () => new Date("2026-09-21T12:00:00-03:00");
  assert.equal(buildReconciliation(db, { month: "2026-09" }, { now }).asOf, "2026-09-21");
  assert.equal(buildReconciliation(db, { month: "2026-08" }, { now }).asOf, "2026-08-31");
  assert.deepEqual(buildReconciliation(db, { month: "2026-08" }, { now }).totals, {
    legacyCents: 0n, referenceCents: 0n, ourCents: 0n, diffCents: 0n,
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test "src/services/reconciliation.test.ts"`
Expected: FAIL (`./reconciliation.ts` não existe).

- [ ] **Step 4: Implementar `src/services/reconciliation.ts`**

```ts
import type { Db } from "../db/index.ts";
import { listAllTransactions, listInstruments, listLegacySnapshotByMonth } from "../db/repos.ts";
import type { InstrumentRow } from "../db/repos.ts";
import { monthEnd, toBrDate } from "../domain/dates.ts";
import type { InstrumentKind } from "../domain/model.ts";
import { buildPortfolio } from "./portfolio.ts";

export const RECONCILIATION_CAUSES = [
  "residuo-zerado",
  "transacao-fora-da-janela",
  "legado-snapshot-maio-2025",
  "legado-sem-cdi-maio-2026",
  "legado-sem-selic-junho-2026",
  "fonte-yahoo-corrompida",
  "data-de-referencia",
  "nao-explicada",
] as const;
export type ReconciliationCause = (typeof RECONCILIATION_CAUSES)[number];

export type ReconciliationDivergence = {
  instrumentId: string; name: string; kind: InstrumentKind; benchmark: string | null;
  legacyCents: bigint; ourCents: bigint; diffCents: bigint; cause: ReconciliationCause;
};

export type ReconciliationResult = {
  month: string; asOf: string;
  totals: { legacyCents: bigint; referenceCents: bigint; ourCents: bigint; diffCents: bigint };
  divergences: ReconciliationDivergence[];
  unexplained: number;
};

export type ReconciliationOptions = { month?: string; asOf?: string };
export type ReconciliationDeps = { now?: () => Date };

const BALANCE_KINDS = new Set(["BUY", "SELL", "AMORTIZATION"]);
const abs = (value: bigint): bigint => (value < 0n ? -value : value);

/** Primeira regra que casar define a causa; regras de bug conhecido do legado vêm antes das genéricas. */
export function classifyDivergence(input: {
  instrument: InstrumentRow; month: string; legacyCents: bigint; ourCents: bigint; diffCents: bigint;
  transactionAfterAsOf: boolean;
}): ReconciliationCause {
  const { instrument, month, legacyCents, ourCents, diffCents } = input;
  if (ourCents === 0n && legacyCents < 0n) return "residuo-zerado";
  if (input.transactionAfterAsOf) return "transacao-fora-da-janela";
  if (instrument.id === "cdb-di-01-12-28" && month >= "2025-05") return "legado-snapshot-maio-2025";
  if (instrument.benchmark === "CDI" && month >= "2026-05" && diffCents > 0n) return "legado-sem-cdi-maio-2026";
  if (instrument.benchmark === "SELIC" && month >= "2026-06" && diffCents > 0n) return "legado-sem-selic-junho-2026";
  if (instrument.ticker === "B5P211" && month <= "2026-01") return "fonte-yahoo-corrompida";
  if (legacyCents !== 0n && abs(diffCents) * 200n <= abs(legacyCents)) return "data-de-referencia";
  return "nao-explicada";
}

export function buildReconciliation(
  db: Db,
  options: ReconciliationOptions,
  deps: ReconciliationDeps = {},
): ReconciliationResult {
  const today = toBrDate((deps.now ?? (() => new Date()))());
  const month = options.month ?? today.slice(0, 7);
  const asOf = options.asOf ?? (month === today.slice(0, 7) ? today : monthEnd(month));
  const end = monthEnd(month);
  const legacy = listLegacySnapshotByMonth(db, `${month}-01`);
  const legacyByInstrument = new Map(legacy.map((row) => [row.instrumentId, row.valueCents]));
  const portfolio = buildPortfolio(db, { asOf });
  const oursByInstrument = new Map(portfolio.positions.map((position) => [position.instrumentId, position.marketValueCents ?? 0n]));
  const transactions = listAllTransactions(db);
  const hasTransactionAfter = (instrumentId: string): boolean =>
    transactions.some((transaction) =>
      transaction.instrumentId === instrumentId && BALANCE_KINDS.has(transaction.kind)
      && transaction.tradeDate > asOf && transaction.tradeDate <= end);

  let legacyTotal = 0n;
  let referenceTotal = 0n;
  let ourTotal = 0n;
  const divergences: ReconciliationDivergence[] = [];
  for (const instrument of listInstruments(db)) {
    const legacyCents = legacyByInstrument.get(instrument.id) ?? 0n;
    const ourCents = oursByInstrument.get(instrument.id) ?? 0n;
    legacyTotal += legacyCents;
    referenceTotal += legacyCents > 0n ? legacyCents : 0n;
    ourTotal += ourCents;
    if (legacyCents === ourCents) continue;
    const diffCents = ourCents - legacyCents;
    divergences.push({
      instrumentId: instrument.id, name: instrument.name, kind: instrument.kind, benchmark: instrument.benchmark,
      legacyCents, ourCents, diffCents,
      cause: classifyDivergence({
        instrument, month, legacyCents, ourCents, diffCents, transactionAfterAsOf: hasTransactionAfter(instrument.id),
      }),
    });
  }

  return {
    month, asOf,
    totals: { legacyCents: legacyTotal, referenceCents: referenceTotal, ourCents: ourTotal, diffCents: ourTotal - legacyTotal },
    divergences,
    unexplained: divergences.filter((divergence) => divergence.cause === "nao-explicada").length,
  };
}
```

- [ ] **Step 5: Alocação — teste de consistência (soma = total do portfólio)**

Adicionar `buildPortfolio` ao import e o teste ao final de `src/services/allocation.test.ts`:

```ts
import { buildPortfolio } from "./portfolio.ts";
```

```ts
test("allocation soma o total do portfólio", () => {
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
  const deps = { now: () => new Date("2026-09-18T12:00:00-03:00") };
  const soma = buildAllocation(db, "category", deps).groups.reduce((acc, group) => acc + group.marketValueCents, 0n);
  assert.equal(soma, buildPortfolio(db, deps).totals.marketValueCents);
});
```

- [ ] **Step 6: Rodar tudo e commitar**

Run: `node --test "src/services/*.test.ts" && npm run typecheck`
Expected: PASS.

```bash
git add src/services
git commit -m "feat: reconciliacao mensal com causas classificadas"
```

---

### Task 6: Reconciliação — rota

**Files:**
- Create: `src/api/routes/reconciliation.ts`
- Modify: `src/app.ts`, `src/api/app.test.ts`, `README.md`

**Interfaces:**
- Consumes: `buildReconciliation` (T5), `toNumberSafe`, `toBrDate`.
- Produces: `GET /api/reconciliation?month=YYYY-MM&asOf=YYYY-MM-DD` (month opcional, default mês corrente BRT; 400 se inválidos ou `asOf` fora do mês).

- [ ] **Step 1: Escrever o teste que falha em `src/api/app.test.ts`**

Adicionar `insertLegacySnapshots` ao import de repos e o teste ao final:

```ts
test("GET /api/reconciliation devolve totais e divergências classificadas", async () => {
  const db = openDb(":memory:");
  migrate(db);
  seedPortfolio(db);
  insertLegacySnapshots(db, [
    { month: "2026-09-01", instrumentId: cdbInstrument.id, valueCents: -3_520n, sharesE8: null },
    { month: "2026-09-01", instrumentId: etfInstrument.id, valueCents: 10_000n, sharesE8: null },
  ]);
  const app = buildApp({ db, csvDir: csvDirFixture(), logger: false });

  const res = await app.inject({ method: "GET", url: "/api/reconciliation?month=2026-09&asOf=2026-09-30" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.month, "2026-09");
  assert.equal(body.asOf, "2026-09-30");
  assert.equal(body.totals.legacyCents, 6_480);
  assert.equal(body.totals.referenceCents, 10_000);
  assert.equal(body.totals.ourCents, 110_100);
  assert.deepEqual(body.divergences.map((divergence: { instrumentId: string; cause: string }) => [divergence.instrumentId, divergence.cause]), [
    ["cdb-1", "legado-sem-cdi-maio-2026"],
  ]);
  assert.equal(body.unexplained, 0);

  assert.equal((await app.inject({ method: "GET", url: "/api/reconciliation?month=26-09" })).statusCode, 400);
  assert.equal((await app.inject({ method: "GET", url: "/api/reconciliation?month=2026-09&asOf=2026-08-01" })).statusCode, 400);
  assert.equal((await app.inject({ method: "GET", url: "/api/reconciliation?asOf=30/09/2026" })).statusCode, 400);

  await app.close();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test "src/api/app.test.ts"`
Expected: FAIL (404 na rota).

- [ ] **Step 3: Implementar `src/api/routes/reconciliation.ts`**

```ts
import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/index.ts";
import { toBrDate } from "../../domain/dates.ts";
import { toNumberSafe } from "../../domain/money.ts";
import { buildReconciliation } from "../../services/reconciliation.ts";

const isMonth = (value: unknown): value is string => typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const isDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(value);

export function registerReconciliationRoutes(app: FastifyInstance, db: Db): void {
  app.get<{ Querystring: { month?: string; asOf?: string } }>("/api/reconciliation", (request, reply) => {
    const { month, asOf } = request.query;
    if (month !== undefined && !isMonth(month)) return reply.code(400).send({ error: "month deve ser YYYY-MM" });
    if (asOf !== undefined && !isDate(asOf)) return reply.code(400).send({ error: "asOf deve ser YYYY-MM-DD" });
    const resolvedMonth = month ?? toBrDate(new Date()).slice(0, 7);
    if (asOf !== undefined && asOf.slice(0, 7) !== resolvedMonth) {
      return reply.code(400).send({ error: "asOf deve estar dentro do mês" });
    }
    const result = buildReconciliation(db, { month: resolvedMonth, asOf });
    return {
      month: result.month,
      asOf: result.asOf,
      totals: {
        legacyCents: toNumberSafe(result.totals.legacyCents),
        referenceCents: toNumberSafe(result.totals.referenceCents),
        ourCents: toNumberSafe(result.totals.ourCents),
        diffCents: toNumberSafe(result.totals.diffCents),
      },
      divergences: result.divergences.map((divergence) => ({
        instrumentId: divergence.instrumentId, name: divergence.name, kind: divergence.kind, benchmark: divergence.benchmark,
        legacyCents: toNumberSafe(divergence.legacyCents), ourCents: toNumberSafe(divergence.ourCents),
        diffCents: toNumberSafe(divergence.diffCents), cause: divergence.cause,
      })),
      unexplained: result.unexplained,
    };
  });
}
```

- [ ] **Step 4: Registrar em `src/app.ts`**

```ts
import { registerReconciliationRoutes } from "./api/routes/reconciliation.ts";
```

```ts
  registerPortfolioRoutes(app, options.db);
  registerReconciliationRoutes(app, options.db);
  registerRefreshRoutes(app, options.db, options.refreshDeps);
```

- [ ] **Step 5: Atualizar o README**

Na tabela de rotas, após `/api/allocation`:

```
| `GET /api/reconciliation?month=YYYY-MM&asOf=YYYY-MM-DD` | reconciliação do mês contra o legado (totais e divergências com causa) |
```

- [ ] **Step 6: Rodar tudo e commitar**

Run: `npm test && npm run typecheck`
Expected: PASS.

```bash
git add src/api src/app.ts README.md
git commit -m "feat: rota de reconciliacao com totais e causas"
```

---

### Task 7: Dashboard — dados, cards, posições, alocação e reconciliação

**Files:**
- Modify: `web/src/api.ts`, `web/src/format.ts`, `web/src/views/DashboardView.tsx`, `web/src/styles.css`

**Interfaces:**
- Consumes: `GET /api/portfolio|history|allocation|reconciliation|health`, `POST /api/refresh`.
- Produces: `DashboardView` funcional (o gráfico fica para a T8): cards, tabela de posições, alocação, selo "atualizado às HH:MM", botão de refresh, revalidação de 5 min e seção colapsável de reconciliação.

- [ ] **Step 1: Adicionar os tipos e fetchers em `web/src/api.ts`**

Adicionar ao final:

```ts
export type SourceSummary = {
  id: string; lastAttemptAt: string | null; lastSuccessAt: string | null;
  lastErrorAt: string | null; lastError: string | null; stale: boolean;
};

export type Health = { ok: boolean; counts: { instruments: number; transactions: number; legacySnapshots: number; importRuns: number }; sources: SourceSummary[] };

export type PortfolioPosition = {
  instrumentId: string; name: string; kind: "fixed_income" | "equity" | "pension"; category: string;
  broker: string | null; objective: string | null; benchmark: string | null; rateE6: number | null;
  quantityE8: number | null; priceCents: number | null; priceDate: string | null; priceSource: string | null;
  marketValueCents: number | null; investedCents: number; redeemedCents: number; feesCents: number; stale: boolean;
};

export type Portfolio = {
  asOf: string;
  totals: { investedCents: number; redeemedCents: number; feesCents: number; marketValueCents: number };
  positions: PortfolioPosition[];
  sources: SourceSummary[];
};

export type HistoryPoint = {
  month: string; marketValueCents: number; investedCents: number; redeemedCents: number;
  cdiPct: number | null; ipcaPct: number | null;
};

export type AllocationBy = "category" | "broker" | "objective";
export type Allocation = { by: AllocationBy; groups: Array<{ key: string; marketValueCents: number; pct: number }> };

export type ReconciliationCause =
  | "residuo-zerado" | "transacao-fora-da-janela"
  | "legado-snapshot-maio-2025" | "legado-sem-cdi-maio-2026" | "legado-sem-selic-junho-2026"
  | "fonte-yahoo-corrompida" | "data-de-referencia" | "nao-explicada";

export type Reconciliation = {
  month: string; asOf: string;
  totals: { legacyCents: number; referenceCents: number; ourCents: number; diffCents: number };
  divergences: Array<{
    instrumentId: string; name: string; kind: string; benchmark: string | null;
    legacyCents: number; ourCents: number; diffCents: number; cause: ReconciliationCause;
  }>;
  unexplained: number;
};

export type RefreshResult = {
  sources: Array<{ id: string; fetched: number; inserted: number; updated: number; skipped: number; errors: string[] }>;
  repairs: Array<{ ticker: string; from: string; to: string; deleted: number; inserted: number; skipped?: boolean; error?: string }>;
};

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(await errorMessage(response, body));
  }
  return (await response.json()) as T;
}

export const getPortfolio = (): Promise<Portfolio> => getJson("/api/portfolio");
export const getHealth = (): Promise<Health> => getJson("/api/health");
export const getAllocation = (by: AllocationBy): Promise<Allocation> => getJson(`/api/allocation?by=${by}`);
export const getReconciliation = (month: string): Promise<Reconciliation> => getJson(`/api/reconciliation?month=${month}`);
export const getHistory = (from: string, to: string): Promise<HistoryPoint[]> => getJson(`/api/history?from=${from}&to=${to}`);

export async function postRefresh(): Promise<RefreshResult> {
  const response = await fetch("/api/refresh", { method: "POST" });
  const body = (await response.json().catch(() => null)) as RefreshResult | { error?: string } | null;
  if (!response.ok) throw new Error(await errorMessage(response, body));
  return body as RefreshResult;
}
```

- [ ] **Step 2: Adicionar formatação em `web/src/format.ts`**

```ts
const formatadorHora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

function parseTimestamp(value: string): Date | null {
  const parsed = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formataHora(value: string): string {
  const parsed = parseTimestamp(value);
  return parsed === null ? value : formatadorHora.format(parsed);
}

export function formataPercentual(valor: number): string {
  return `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

export function formataIndice(valor: number): string {
  return valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

export function formataQuantidade(e8: number): string {
  return (e8 / 1e8).toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

const ROTULO_CATEGORIA: Record<string, string> = {
  cdb: "CDB", lca: "LCA", selic: "Tesouro Selic", etf_fixed: "ETF RF", etf_equity: "ETF RV", pension_ipca: "Previdência",
};

export function formataCategoria(categoria: string): string {
  return ROTULO_CATEGORIA[categoria] ?? categoria;
}

export function mesDeslocado(mes: string, delta: number): string {
  const [ano = 0, numero = 1] = mes.split("-").map(Number);
  const total = ano * 12 + (numero - 1) + delta;
  return `${String(Math.floor(total / 12)).padStart(4, "0")}-${String(((total % 12) + 12) % 12 + 1).padStart(2, "0")}`;
}
```

- [ ] **Step 3: Reescrever `web/src/views/DashboardView.tsx` (sem gráfico)**

```tsx
import { useCallback, useEffect, useState } from "react";
import { ArrowsClockwise, ChartPie, Clock, Table, WarningCircle, XCircle } from "@phosphor-icons/react";
import {
  getAllocation, getHealth, getHistory, getPortfolio, getReconciliation, postRefresh,
  type Allocation, type AllocationBy, type Health, type HistoryPoint, type Portfolio, type Reconciliation,
} from "../api.ts";
import {
  formataBRL, formataCategoria, formataHora, formataMes, formataNumero, formataPercentual,
  formataQuantidade, mesDeslocado,
} from "../format.ts";

type DashboardData = {
  portfolio: Portfolio;
  history: HistoryPoint[];
  allocations: Allocation[];
  reconciliation: Reconciliation;
  health: Health;
};

const ALOCACOES: Array<{ by: AllocationBy; titulo: string }> = [
  { by: "category", titulo: "Por categoria" },
  { by: "broker", titulo: "Por corretora" },
  { by: "objective", titulo: "Por objetivo" },
];

const ROTULO_CAUSA: Record<string, string> = {
  "residuo-zerado": "Resíduo zerado (regra)",
  "transacao-fora-da-janela": "Transação posterior à data do snapshot",
  "legado-snapshot-maio-2025": "Snapshot do legado menor que o principal (maio/2025)",
  "legado-sem-cdi-maio-2026": "Legado sem capitalização CDI (maio/2026)",
  "legado-sem-selic-junho-2026": "Legado sem capitalização Selic (junho/2026)",
  "fonte-yahoo-corrompida": "Fonte Yahoo corrompida no histórico",
  "data-de-referencia": "Data de referência do snapshot do legado",
  "nao-explicada": "Não explicada",
};

async function carregaDashboard(): Promise<DashboardData> {
  const portfolio = await getPortfolio();
  const mes = portfolio.asOf.slice(0, 7);
  const [history, ...allocations] = await Promise.all([
    getHistory(mesDeslocado(mes, -11), mes),
    ...ALOCACOES.map((item) => getAllocation(item.by)),
  ]);
  const [reconciliation, health] = await Promise.all([getReconciliation(mes), getHealth()]);
  return { portfolio, history, allocations, reconciliation, health };
}

export function DashboardView() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setData(await carregaDashboard());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void carregar();
    const id = setInterval(() => void carregar(), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [carregar]);

  async function atualizar() {
    setBusy(true);
    setError(null);
    try {
      await postRefresh();
      await carregar();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  if (data === null) {
    return (
      <div className="page">
        <div className="page-head">
          <div>
            <h1 className="page-title">Dashboard</h1>
            <p className="page-sub">Posições, alocação e evolução mensal da carteira.</p>
          </div>
        </div>
        <div className="stack">
          {error !== null && (
            <div className="callout callout-error" role="alert">
              <XCircle size={17} aria-hidden="true" />
              <div>
                <p className="callout-title">Não foi possível carregar</p>
                <p>{error}</p>
              </div>
            </div>
          )}
          <section className="card">
            <div className="stats">
              {[0, 1, 2, 3].map((item) => (
                <div className="stat" key={item}>
                  <span className="skeleton" style={{ width: 90 }} />
                  <span className="skeleton" style={{ width: 140, height: 22 }} />
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    );
  }

  const { portfolio, history, allocations, reconciliation, health } = data;
  const total = portfolio.totals.marketValueCents;
  const capital = portfolio.totals.investedCents - portfolio.totals.redeemedCents;
  const rendimento = total - capital;
  const rendimentoPct = capital > 0 ? (rendimento / capital) * 100 : 0;
  const primeiro = history[0];
  const ultimo = history.at(-1);
  const aportes = history.reduce((acc, point) => acc + point.investedCents, 0);
  const resgates = history.reduce((acc, point) => acc + point.redeemedCents, 0);
  const carteira12m = primeiro && primeiro.marketValueCents > 0 && ultimo
    ? ((ultimo.marketValueCents + resgates - aportes - primeiro.marketValueCents) / primeiro.marketValueCents) * 100
    : 0;
  const acumula = (campo: "cdiPct" | "ipcaPct"): number =>
    history.reduce((acc, point) => (point[campo] === null ? acc : acc * (1 + point[campo]! / 100)), 1) * 100 - 100;
  const ultimaAtualizacao = health.sources
    .map((source) => source.lastSuccessAt)
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1);
  const posicoes = [...portfolio.positions].sort((a, b) => (b.marketValueCents ?? 0) - (a.marketValueCents ?? 0));
  const fontesStale = health.sources.filter((source) => source.stale);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">Posições, alocação e evolução mensal da carteira.</p>
        </div>
        <div className="page-head-actions">
          <span className="updated">
            <Clock size={14} />
            {ultimaAtualizacao ? `atualizado às ${formataHora(ultimaAtualizacao)}` : "sem coleta registrada"}
          </span>
          <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => void atualizar()}>
            <ArrowsClockwise size={15} />
            {busy ? "Atualizando..." : "Atualizar cotações"}
          </button>
        </div>
      </div>

      <div className="stack">
        {error !== null && (
          <div className="callout callout-error" role="alert">
            <XCircle size={17} aria-hidden="true" />
            <div>
              <p className="callout-title">Falha ao atualizar</p>
              <p>{error}</p>
            </div>
          </div>
        )}

        {fontesStale.length > 0 && (
          <div className="callout callout-warn">
            <WarningCircle size={17} aria-hidden="true" />
            <div>
              <p className="callout-title">Fontes desatualizadas</p>
              <p>{fontesStale.map((source) => source.id).join(", ")} — último valor mantido.</p>
            </div>
          </div>
        )}

        <section className="card">
          <div className="section-head">
            <h2 className="section-title">Resumo</h2>
            <p className="section-hint">Posição em {portfolio.asOf}, com a última cotação disponível de cada fonte.</p>
          </div>
          <div className="stats">
            <div className="stat">
              <span className="stat-label">Patrimônio total</span>
              <span className="stat-value">{formataBRL(total)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Capital investido</span>
              <span className="stat-value">{formataBRL(capital)}</span>
              <span className="stat-note">aportes − resgates</span>
            </div>
            <div className="stat">
              <span className="stat-label">Rendimento</span>
              <span className="stat-value">{formataBRL(rendimento)}</span>
              <span className="stat-note">{formataPercentual(rendimentoPct)} sobre o capital</span>
            </div>
            <div className="stat">
              <span className="stat-label">Rentabilidade 12m</span>
              <span className="stat-value">{formataPercentual(carteira12m)}</span>
              <span className="stat-note">CDI {formataPercentual(acumula("cdiPct"))} · IPCA {formataPercentual(acumula("ipcaPct"))}</span>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="section-head">
            <h2 className="section-title">Posições</h2>
            <p className="section-hint">Quantidade, preço e valor de mercado por ativo, ordenados por valor.</p>
          </div>
          {posicoes.length === 0 ? (
            <div className="empty">
              <Table size={22} aria-hidden="true" />
              <p className="empty-title">Sem posições</p>
              <p className="empty-hint">Importe a planilha na aba Importar.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <caption className="sr-only">Posições da carteira</caption>
                <thead>
                  <tr>
                    <th scope="col">Ativo</th>
                    <th scope="col">Categoria</th>
                    <th scope="col" className="num">Quantidade</th>
                    <th scope="col" className="num">Preço</th>
                    <th scope="col" className="num">Valor</th>
                    <th scope="col" className="num">%</th>
                  </tr>
                </thead>
                <tbody>
                  {posicoes.map((posicao) => (
                    <tr key={posicao.instrumentId}>
                      <td>
                        {posicao.name}
                        {posicao.stale && <span className="badge badge-warn">stale</span>}
                      </td>
                      <td>{formataCategoria(posicao.category)}</td>
                      <td className="num">{posicao.quantityE8 === null ? "—" : formataQuantidade(posicao.quantityE8)}</td>
                      <td className="num">{posicao.priceCents === null ? "—" : formataBRL(posicao.priceCents)}</td>
                      <td className="num">{formataBRL(posicao.marketValueCents ?? 0)}</td>
                      <td className="num">{total > 0 ? formataPercentual(((posicao.marketValueCents ?? 0) / total) * 100) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="grid-3">
          {ALOCACOES.map((item, index) => (
            <section className="card" key={item.by}>
              <div className="section-head">
                <h2 className="section-title">{item.titulo}</h2>
              </div>
              {allocations[index] && allocations[index]!.groups.length > 0 ? (
                <ul className="alloc-list">
                  {allocations[index]!.groups.map((group) => (
                    <li className="alloc-row" key={group.key}>
                      <div className="alloc-line">
                        <span className="alloc-name">{item.by === "category" ? formataCategoria(group.key) : group.key}</span>
                        <span className="alloc-value">{formataBRL(group.marketValueCents)} · {formataPercentual(group.pct)}</span>
                      </div>
                      <span className="alloc-bar">
                        <span className="alloc-bar-fill" style={{ width: `${Math.min(100, group.pct)}%` }} />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="empty">
                  <ChartPie size={22} aria-hidden="true" />
                  <p className="empty-hint">Sem dados de alocação.</p>
                </div>
              )}
            </section>
          ))}
        </div>

        <section className="card">
          <details className="recon">
            <summary>
              <span className="section-title">Reconciliação — {formataMes(reconciliation.month)}</span>
              {reconciliation.unexplained === 0 ? (
                <span className="badge badge-ok">{formataNumero(reconciliation.divergences.length)} divergências explicadas</span>
              ) : (
                <span className="badge badge-error">{formataNumero(reconciliation.unexplained)} não explicadas</span>
              )}
            </summary>
            <p className="section-hint">
              Compara o cálculo do app com o snapshot do legado em {reconciliation.asOf}. Divergências conhecidas têm causa
              registrada; igualdade não é forçada.
            </p>
            <div className="stats">
              <div className="stat">
                <span className="stat-label">Legado</span>
                <span className="stat-value">{formataBRL(reconciliation.totals.legacyCents)}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Referência (resíduos zerados)</span>
                <span className="stat-value">{formataBRL(reconciliation.totals.referenceCents)}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Nosso</span>
                <span className="stat-value">{formataBRL(reconciliation.totals.ourCents)}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Diferença</span>
                <span className="stat-value">{formataBRL(reconciliation.totals.diffCents)}</span>
              </div>
            </div>
            {reconciliation.divergences.length > 0 && (
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">Divergências da reconciliação</caption>
                  <thead>
                    <tr>
                      <th scope="col">Ativo</th>
                      <th scope="col" className="num">Legado</th>
                      <th scope="col" className="num">Nosso</th>
                      <th scope="col" className="num">Diferença</th>
                      <th scope="col">Causa</th>
                    </tr>
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
          </details>
        </section>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Adicionar os estilos em `web/src/styles.css`**

```css
.badge-warn {
  background: var(--warn-bg, #fff4d6);
  color: var(--warn-fg, #7a5200);
  margin-left: 8px;
}

.alloc-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 12px;
}

.alloc-line {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
}

.alloc-name {
  font-weight: 500;
}

.alloc-value {
  color: var(--text-dim);
}

.alloc-bar {
  display: block;
  height: 6px;
  border-radius: 999px;
  background: var(--surface-2, #eceff3);
  margin-top: 6px;
  overflow: hidden;
}

.alloc-bar-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--accent, #2f6feb);
}

.recon summary {
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.recon[open] summary {
  margin-bottom: 8px;
}

.recon .stats {
  margin: 12px 0;
}
```

Se os tokens `--surface-2`/`--accent`/`--warn-*` não existirem no arquivo, use os valores de fallback (já embutidos) ou os tokens equivalentes do tema.

- [ ] **Step 5: Verificar (typecheck + build)**

Run: `npm run typecheck && npm run build:web`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src
git commit -m "feat: dashboard com cards, posicoes, alocacao e reconciliacao"
```

---

### Task 8: Dashboard — gráfico Recharts em base 100

**Files:**
- Modify: `package.json`, `package-lock.json`, `web/src/views/DashboardView.tsx`, `web/src/styles.css`

**Interfaces:**
- Consumes: `history: HistoryPoint[]` (T7).
- Produces: gráfico de evolução 12 meses (carteira, CDI, IPCA em base 100) com tooltip em R$ e %.

- [ ] **Step 1: Instalar o Recharts**

Run: `npm install recharts`
Expected: `package.json` com `recharts` em dependencies e lockfile atualizado.

- [ ] **Step 2: Adicionar o gráfico em `DashboardView.tsx`**

Adicionar aos imports:

```tsx
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
```

Adicionar antes de `carregaDashboard`:

```tsx
type LinhaGrafico = {
  mes: string; carteira: number; cdi: number; ipca: number; patrimonioCents: number;
};

function base100(history: HistoryPoint[]): LinhaGrafico[] {
  const primeiro = history[0];
  if (!primeiro || primeiro.marketValueCents === 0) return [];
  let cdi = 100;
  let ipca = 100;
  return history.map((point) => {
    const row: LinhaGrafico = {
      mes: formataMes(point.month),
      carteira: (point.marketValueCents / primeiro.marketValueCents) * 100,
      cdi, ipca, patrimonioCents: point.marketValueCents,
    };
    if (point.cdiPct !== null) cdi *= 1 + point.cdiPct / 100;
    if (point.ipcaPct !== null) ipca *= 1 + point.ipcaPct / 100;
    return row;
  });
}

function TooltipEvolucao({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ payload: LinhaGrafico }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]!.payload;
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-title">{label}</p>
      <p>Patrimônio: <strong>{formataBRL(row.patrimonioCents)}</strong></p>
      <p>Carteira {formataIndice(row.carteira)} · CDI {formataIndice(row.cdi)} · IPCA {formataIndice(row.ipca)}</p>
    </div>
  );
}
```

Se o TypeScript reclamar do `content`, troque para `content={<TooltipEvolucao />}` ou use o `TooltipProps` exportado pelo Recharts como tipo dos props.

Adicionar `formataIndice` ao import de `../format.ts` e, antes do fechamento do `</div>` do `stack` (depois da seção de alocação e antes da reconciliação), inserir:

```tsx
        <section className="card">
          <div className="section-head">
            <h2 className="section-title">Evolução 12 meses</h2>
            <p className="section-hint">
              Base 100 no início da janela: carteira, CDI e IPCA acumulados. Passe o mouse para ver o patrimônio em R$.
            </p>
          </div>
          {base100(history).length === 0 ? (
            <div className="empty">
              <ChartLineUp size={22} aria-hidden="true" />
              <p className="empty-title">Sem histórico suficiente</p>
              <p className="empty-hint">A evolução aparece quando houver cotações e índices no período.</p>
            </div>
          ) : (
            <div className="chart">
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={base100(history)} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="mes" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis domain={["auto", "auto"]} tickLine={false} axisLine={false} fontSize={12} width={44} />
                  <Tooltip content={(props) => <TooltipEvolucao {...props} />} />
                  <Legend />
                  <Line type="monotone" dataKey="carteira" name="Carteira" stroke="#2f6feb" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="cdi" name="CDI" stroke="#7a5200" strokeWidth={1.5} dot={false} />
                  <Line type="monotone" dataKey="ipca" name="IPCA" stroke="#1f7a4d" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
```

Adicionar `ChartLineUp` ao import de `@phosphor-icons/react`.

- [ ] **Step 3: Estilos do gráfico**

```css
.chart {
  margin-top: 8px;
}

.chart-tooltip {
  background: var(--surface, #fff);
  border: 1px solid var(--border, #d8dee7);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12px;
  box-shadow: 0 4px 16px rgb(0 0 0 / 12%);
}

.chart-tooltip-title {
  font-weight: 600;
  margin: 0 0 4px;
}

.chart-tooltip p {
  margin: 0;
}
```

- [ ] **Step 4: Verificar (typecheck + build + browser)**

Run: `npm run typecheck && npm run build:web`
Expected: PASS.

Depois: `docker compose up -d --build` e abrir `http://localhost:3000` → conferir cards, tabela, alocação, gráfico (tooltip com R$), selo de hora, botão "Atualizar cotações" e a seção de reconciliação.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json web/src
git commit -m "feat: grafico de evolucao 12 meses em base 100 com recharts"
```

---

### Task 9: Reconciliação — causa para cotação do mês corrente

**Files:**
- Modify: `src/services/reconciliation.ts`, `src/services/reconciliation.test.ts`, `web/src/api.ts`, `web/src/views/DashboardView.tsx`

**Interfaces:**
- Consumes: `RECONCILIATION_CAUSES`, `classifyDivergence` (T5); `ReconciliationCause` (web, T7).
- Produces: causa nova `cotacao-fora-da-janela` (RV/PGBL no mês corrente com `|diff| ≤ 5% × |legado|`), aplicada **depois** de `data-de-referencia`; `classifyDivergence` ganha `currentMonth: string`.

**Contexto (achado do run real):** no dashboard ao vivo (mês corrente, `asOf=hoje`), o WRLD11 divergiu 1,34% só por movimento de mercado entre o snapshot do legado e hoje → caía em `nao-explicada` (a tolerância de `data-de-referencia` é 0,5%). A aceitação fixa `asOf=2026-09-16` (RV casa exata), mas a visão ao vivo precisa classificar isso.

- [ ] **Step 1: Testes que falham em `src/services/reconciliation.test.ts`**

Atualizar o helper `classify` para incluir `currentMonth: "2026-09"` e adicionar as asserções:

```ts
const classify = (overrides: Partial<Parameters<typeof classifyDivergence>[0]>) =>
  classifyDivergence({
    instrument: cdi, month: "2026-09", legacyCents: 100n, ourCents: 200n, diffCents: 100n,
    transactionAfterAsOf: false, currentMonth: "2026-09", ...overrides,
  });
```

```ts
test("classifyDivergence: cotação de RV/PGBL no mês corrente tem causa própria", () => {
  const etfAberto = { ...etf, id: "etf-2" };
  assert.equal(
    classify({ instrument: etfAberto, month: "2026-09", currentMonth: "2026-09", legacyCents: 100_000n, ourCents: 101_340n, diffCents: 1_340n }),
    "cotacao-fora-da-janela",
  );
  // fora do mês corrente e acima de 0,5% → não explicada
  assert.equal(
    classify({ instrument: etfAberto, month: "2026-08", currentMonth: "2026-09", legacyCents: 100_000n, ourCents: 101_340n, diffCents: 1_340n }),
    "nao-explicada",
  );
  // acima de 5% no mês corrente → não explicada
  assert.equal(
    classify({ instrument: etfAberto, month: "2026-09", currentMonth: "2026-09", legacyCents: 100_000n, ourCents: 120_000n, diffCents: 20_000n }),
    "nao-explicada",
  );
  // RF no mês corrente não usa a regra de cotação (benchmark fora de CDI/SELIC para não casar as regras do legado)
  assert.equal(
    classify({ instrument: { ...cdi, benchmark: "IPCA" }, month: "2026-09", currentMonth: "2026-09", legacyCents: 100_000n, ourCents: 101_340n, diffCents: 1_340n }),
    "nao-explicada",
  );
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test "src/services/reconciliation.test.ts"`
Expected: FAIL (`currentMonth` não existe no tipo; causa desconhecida).

- [ ] **Step 3: Implementar em `src/services/reconciliation.ts`**

Adicionar a causa na lista, depois de `"data-de-referencia"`:

```ts
export const RECONCILIATION_CAUSES = [
  "residuo-zerado",
  "transacao-fora-da-janela",
  "legado-snapshot-maio-2025",
  "legado-sem-cdi-maio-2026",
  "legado-sem-selic-junho-2026",
  "fonte-yahoo-corrompida",
  "data-de-referencia",
  "cotacao-fora-da-janela",
  "nao-explicada",
] as const;
```

No input de `classifyDivergence`, adicionar `currentMonth: string;` e, antes do fallback:

```ts
  if ((instrument.kind === "equity" || instrument.kind === "pension") && month === input.currentMonth
    && legacyCents !== 0n && abs(diffCents) * 20n <= abs(legacyCents)) return "cotacao-fora-da-janela";
```

Em `buildReconciliation`, passar `currentMonth: today.slice(0, 7)` na chamada de `classifyDivergence`.

- [ ] **Step 4: Atualizar o web**

Em `web/src/api.ts`, adicionar `"cotacao-fora-da-janela"` ao union `ReconciliationCause` (depois de `"data-de-referencia"`).

Em `web/src/views/DashboardView.tsx`, adicionar ao `ROTULO_CAUSA`:

```ts
  "cotacao-fora-da-janela": "Cotação posterior ao snapshot do legado (mês corrente)",
```

- [ ] **Step 5: Rodar tudo e commitar**

Run: `npm test && npm run typecheck && npm run build:web` (restaure `web/dist` se o build alterá-lo)
Expected: PASS.

```bash
git add src/services web/src
git commit -m "feat: causa de cotacao do mes corrente na reconciliacao"
```

---

### Task 10: Verificação real e ROADMAP

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 1: Suíte completa**

Run: `npm test && npm run typecheck && npm run build:web`
Expected: tudo verde.

- [ ] **Step 2: Reparo real do B5P211**

```bash
npm run backfill -- --ticker B5P211 --from 2025-04-23 --to 2026-01-07
sqlite3 data/investments.db "SELECT COUNT(*) FROM quotes WHERE ticker='B5P211' AND close_cents=7125;"
sqlite3 data/investments.db "SELECT date, close_cents, source FROM quotes WHERE ticker='B5P211' AND date BETWEEN '2025-04-23' AND '2026-01-07' ORDER BY date;"
```

Expected: `179 linhas apagadas, 10 pontos gravados` (9 dentro da janela + o fechamento de 2026-01-30, que fica no mês-calendário final e é upsertado); contagem de 7125 = 0; 9 linhas `alphavantage` na janela (2025-04-30 … 2025-12-30).

- [ ] **Step 3: Reconciliação real de 2026-09**

```bash
docker compose up -d --build
curl -s "localhost:3000/api/health" | head -c 300
curl -s "localhost:3000/api/reconciliation?month=2026-09&asOf=2026-09-16" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const r=JSON.parse(d);console.log('totais',r.totals);console.log('nao explicadas',r.unexplained);const by={};for(const x of r.divergences)by[x.cause]=(by[x.cause]??0)+1;console.log(by)})"
```

Expected: `referenceCents = <valor>`, `unexplained = 0`, classes `{ "legado-sem-cdi-maio-2026": 21, "legado-sem-selic-junho-2026": 2, "legado-snapshot-maio-2025": 1, "residuo-zerado": 1, "transacao-fora-da-janela": 1, "data-de-referencia": 1 }`.

- [ ] **Step 4: Conferir o reparo nos meses antigos**

```bash
for m in 2025-09 2025-12 2026-03; do
  curl -s "localhost:3000/api/reconciliation?month=$m" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const r=JSON.parse(d);console.log(r.month,'nao explicadas',r.unexplained,'divergentes',r.divergences.length)})"
done
```

Expected: `nao explicadas` = 0 nos três meses (divergências restantes ficam como `data-de-referencia`).

- [ ] **Step 5: Atualizar o ROADMAP**

- Tabela "Estado atual": `S6 — dashboard + reconciliação | concluída — merge local na main`; `v2 — CRUD e auxiliares | backlog`.
- Remover a lacuna do dashboard placeholder e a de reconciliação pendente.
- Evidências: contagem nova do `npm test`; reparo do B5P211; `/api/reconciliation` com `referenceCents = <valor>` e `unexplained = 0`; dashboard verificado no browser.
- "Próxima ação": iniciar a v2 (CRUD) com `brainstorming`.
- §Etapa 6: registrar o estado concluído.

- [ ] **Step 6: Commit final**

```bash
git add ROADMAP.md
git commit -m "docs: registra a s6 concluida no roadmap"
```

---

### Task 11: Reconciliação — resíduo positivo de 1¢ do legado

**Files:**
- Modify: `src/services/reconciliation.ts`, `src/services/reconciliation.test.ts`

**Interfaces:**
- Consumes: `classifyDivergence` (T5/T9).
- Produces: `residuo-zerado` passa a cobrir também o resíduo **positivo** de até R$ <valor> no lado legado (`legacyCents <= 1n`), com o nosso lado exato `0n`.

**Contexto (achado do aceite real, T10):** `cdb-liquidez-diaria-106-10-11-25` (2025-12) e `cdb-liquidez-diaria-106-26-02-26` (2026-03) têm `legacy = 1¢` e `ours = 0` (resíduo zerado pela regra do domínio) → caíam em `nao-explicada`. São a mesma classe do resíduo negativo do PagBank.

- [ ] **Step 1: Testes que falham em `src/services/reconciliation.test.ts`**

No teste de ordem das regras, adicionar a asserção do resíduo positivo:

```ts
  assert.equal(classify({ ourCents: 0n, legacyCents: 1n, diffCents: -1n }), "residuo-zerado");
  assert.equal(classify({ ourCents: 0n, legacyCents: 500n, diffCents: -500n }), "nao-explicada");
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test "src/services/reconciliation.test.ts"`
Expected: FAIL (a primeira asserção devolve `nao-explicada`).

- [ ] **Step 3: Implementar em `src/services/reconciliation.ts`**

Trocar a primeira regra de `classifyDivergence`:

```ts
  if (ourCents === 0n && legacyCents !== 0n && legacyCents <= 1n) return "residuo-zerado";
```

(ou seja: nosso lado exatamente 0 e o legado exibindo resíduo de até R$ <valor> positivo ou qualquer valor negativo.)

- [ ] **Step 4: Verificar os meses reais e commitar**

Run: `npm test && npm run typecheck`

Depois de subir o container (`docker compose up -d --build`), conferir `unexplained = 0` em `?month=2025-12`, `?month=2026-03` e no aceite fixo `?month=2026-09&asOf=2026-09-16`.

```bash
git add src/services
git commit -m "fix: residuo positivo de 1 centavo do legado tambem e residuo zerado"
```

---

## Correções pós-review final da branch (2026-09-21)

Dois Important do review final, aplicados em `93cb6bd` e `<valor>` (a spec reflete ambos):

1. **Sem cotação ≠ zero** (`services/reconciliation.ts`): o mapa das nossas posições guarda `bigint | null`; `marketValueCents === null` com legado ≠ 0 vira divergência `nao-explicada` (o total segue somando `0n`).
2. **Reparo pula trecho do mês corrente** (`services/quote-repair.ts`): `if (run.from.slice(0, 7) === currentMonth) continue;` antes de chamar a fonte — sem mês fechado para repor, não gasta cota da AV a cada 10 min.

Os Minors acumulados nas reviews por task ficaram registrados no ledger (`.superpowers/sdd/progress.md`) para follow-up.
