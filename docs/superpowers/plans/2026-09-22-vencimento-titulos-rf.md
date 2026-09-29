# Vencimento de títulos de RF — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Congelar a posição de RF na data do vencimento (parar de capitalizar) e sinalizar resgate pendente na UI.

**Architecture:** O domínio (`instrumentValue`) trunca as taxas na data do vencimento para `fixed_income` e devolve `pendingRedemption`; serviços e rota propagam; a UI mostra badge em Posições e faixa na Visão geral. Sem resgate automático e sem persistência nova.

**Tech Stack:** Node 22 + TypeScript (type stripping), `node:test`, Fastify, better-sqlite3, React 19 + Vite, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-22-vencimento-titulos-rf-design.md`

## Global Constraints

- Zero `float` em dado persistido/cálculo; inteiros escalonados; `toNumberSafe` só na borda da API.
- Testes sem rede (fixtures); `node:test` + `assert/strict`.
- Commits em pt-BR (conventional), 1 por task; ≤ 400 linhas / ≤ 10 arquivos por layer.
- Branch `vencimento-titulos-rf` a partir da `main`; merge ff ao final.
- Não commitar `.superpowers/`, `data/`, `.env`.
- Verificação: `npm test`, `npm run typecheck`, `npm run build:web`, `docker compose up -d --build`, `curl localhost:3000/api/health`.

---

### Task 1: Domínio — congelar no vencimento + `pendingRedemption`

**Files:**
- Modify: `src/domain/position.ts`
- Test: `src/domain/position.test.ts`

**Interfaces:**
- Consumes: `rfValueCents`, `zeroClosedResidue` (internos do arquivo).
- Produces: `PositionInput.maturityDate: string | null` (obrigatório); `PositionValue.maturityDate: string | null` e `PositionValue.pendingRedemption: boolean`. Para `equity`/`pension`: `maturityDate: null`, `pendingRedemption: false`.

- [ ] **Step 1: Write the failing tests**

Adicionar ao fim de `src/domain/position.test.ts`:

```ts
test("RF congela no vencimento: valor do vencimento, não capitaliza depois", () => {
  const input: PositionInput = {
    kind: "fixed_income", benchmark: "CDI", rateE6: 1_000_000n, maturityDate: "2026-01-05",
    transactions: [{ tradeDate: "2026-01-02", kind: "BUY", quantityE8: null, grossCents: 100_000n, feesCents: 0n }],
    quotes: [], rates: [rate("2026-01-02"), rate("2026-01-05"), rate("2026-01-06")],
  };
  const noDia = instrumentValue(input, "2026-01-05");
  assert.equal(noDia.marketValueCents, 100_200n); // <valor> × 1,001 × 1,001
  assert.equal(noDia.maturityDate, "2026-01-05");
  assert.equal(noDia.pendingRedemption, true); // venceu hoje e tem saldo
  const depois = instrumentValue(input, "2026-01-06");
  assert.equal(depois.marketValueCents, 100_200n, "taxa de 06/01 não entra");
  assert.equal(depois.priceDate, "2026-01-05", "última taxa ≤ vencimento");
  assert.equal(depois.pendingRedemption, true);
});

test("RF sem vencimento segue capitalizando e não fica pendente", () => {
  const input: PositionInput = {
    kind: "fixed_income", benchmark: "CDI", rateE6: 1_000_000n, maturityDate: null,
    transactions: [{ tradeDate: "2026-01-02", kind: "BUY", quantityE8: null, grossCents: 100_000n, feesCents: 0n }],
    quotes: [], rates: [rate("2026-01-02"), rate("2026-01-05"), rate("2026-01-06")],
  };
  const value = instrumentValue(input, "2026-01-06");
  assert.equal(value.marketValueCents, 100_300n);
  assert.equal(value.maturityDate, null);
  assert.equal(value.pendingRedemption, false);
});

test("resgate no vencimento zera e limpa o pendente; parcial mantém; poeira ≤ 1¢ zera", () => {
  const rates = [rate("2026-01-02"), rate("2026-01-05"), rate("2026-01-06")];
  const quitado: PositionInput = {
    kind: "fixed_income", benchmark: "CDI", rateE6: 1_000_000n, maturityDate: "2026-01-05",
    transactions: [
      { tradeDate: "2026-01-02", kind: "BUY", quantityE8: null, grossCents: 100_000n, feesCents: 0n },
      { tradeDate: "2026-01-05", kind: "SELL", quantityE8: null, grossCents: 100_200n, feesCents: 0n },
    ],
    quotes: [], rates,
  };
  const value = instrumentValue(quitado, "2026-01-06");
  assert.equal(value.marketValueCents, 0n);
  assert.equal(value.pendingRedemption, false);

  const parcial: PositionInput = {
    ...quitado,
    transactions: [quitado.transactions[0]!, { tradeDate: "2026-01-05", kind: "SELL", quantityE8: null, grossCents: 40_000n, feesCents: 0n }],
  };
  assert.equal(instrumentValue(parcial, "2026-01-06").pendingRedemption, true);

  const poeira: PositionInput = {
    ...quitado,
    transactions: [quitado.transactions[0]!, { tradeDate: "2026-01-05", kind: "SELL", quantityE8: null, grossCents: 100_099n, feesCents: 0n }],
  };
  const comPoeira = instrumentValue(poeira, "2026-01-06");
  assert.equal(comPoeira.marketValueCents, 0n); // resíduo +1¢ zerado
  assert.equal(comPoeira.pendingRedemption, false);
});

test("resgate lançado depois do vencimento zera a posição e limpa o pendente", () => {
  const input: PositionInput = {
    kind: "fixed_income", benchmark: "CDI", rateE6: 1_000_000n, maturityDate: "2026-01-05",
    transactions: [
      { tradeDate: "2026-01-02", kind: "BUY", quantityE8: null, grossCents: 100_000n, feesCents: 0n },
      { tradeDate: "2026-01-07", kind: "SELL", quantityE8: null, grossCents: 100_200n, feesCents: 0n },
    ],
    quotes: [], rates: [rate("2026-01-02"), rate("2026-01-05"), rate("2026-01-07")],
  };
  const value = instrumentValue(input, "2026-01-07");
  assert.equal(value.marketValueCents, 0n, "resgate pós-vencimento entra pelo bruto e zera");
  assert.equal(value.pendingRedemption, false);
  assert.equal(value.redeemedCents, 100_200n);
});

test("sentinela 9999-01-01 e vencimento futuro não congelam", () => {
  const equity: PositionInput = {
    kind: "equity", benchmark: null, rateE6: null, maturityDate: "9999-01-01",
    transactions: [{ tradeDate: "2026-01-02", kind: "BUY", quantityE8: 10_00000000n, grossCents: 1_000n, feesCents: 0n }],
    quotes: [{ date: "2026-01-06", closeCents: 1_100n }], rates: [],
  };
  const acao = instrumentValue(equity, "2026-01-06");
  assert.equal(acao.marketValueCents, 11_000n);
  assert.equal(acao.maturityDate, null);
  assert.equal(acao.pendingRedemption, false);

  const futuro: PositionInput = {
    kind: "fixed_income", benchmark: "CDI", rateE6: 1_000_000n, maturityDate: "2026-02-01",
    transactions: [{ tradeDate: "2026-01-02", kind: "BUY", quantityE8: null, grossCents: 100_000n, feesCents: 0n }],
    quotes: [], rates: [rate("2026-01-02"), rate("2026-01-05")],
  };
  const rf = instrumentValue(futuro, "2026-01-05");
  assert.equal(rf.marketValueCents, 100_200n);
  assert.equal(rf.pendingRedemption, false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | tail -30`
Expected: os 4 testes novos falham (`pendingRedemption`/`maturityDate` undefined e valor capitalizado além do vencimento).

- [ ] **Step 3: Implement**

> Ajuste 2026-09-22 (após a 1ª implementação): o congelamento trunca as **taxas** em `date ≤ maturityDate` (não o `asOf`) — operações lançadas depois do vencimento entram pelo valor bruto e o resgate pós-vencimento zera a posição. Ver o teste extra do Step 1.

Em `src/domain/position.ts`:

1. `PositionInput` ganha o campo (depois de `rateE6`):

```ts
export type PositionInput = {
  kind: InstrumentKind;
  benchmark: string | null;
  rateE6: bigint | null;
  maturityDate: string | null;
  transactions: PositionTransaction[];
  quotes: QuotePoint[];
  rates: RatePoint[];
  pensionQuotes?: PensionQuotePoint[];
};
```

2. `PositionValue` ganha os campos:

```ts
export type PositionValue = {
  marketValueCents: bigint | null;
  priceCents: bigint | null;
  priceDate: string | null;
  quantityE8: bigint | null;
  investedCents: bigint;
  redeemedCents: bigint;
  feesCents: bigint;
  maturityDate: string | null;
  pendingRedemption: boolean;
};
```

3. Em `instrumentValue`, antes do laço de transações:

```ts
  const maturityDate = input.kind === "fixed_income" ? (input.maturityDate ?? null) : null;
```

4. Ramo `fixed_income` passa a truncar as taxas no vencimento e devolver o flag:

```ts
  if (input.kind === "fixed_income") {
    const multiplierE6 = input.rateE6 ?? 1_000_000n;
    const taxas = maturityDate === null ? input.rates : input.rates.filter((rate) => rate.date <= maturityDate);
    const { valueCents, lastRateDate } = rfValueCents(operations, taxas, multiplierE6, asOf);
    const marketValueCents = zeroClosedResidue("fixed_income", null, valueCents, lastBalanceKind);
    return {
      marketValueCents,
      priceCents: null, priceDate: lastRateDate, quantityE8: null, investedCents, redeemedCents, feesCents,
      maturityDate,
      pendingRedemption: maturityDate !== null && maturityDate <= asOf && marketValueCents !== null && marketValueCents > 0n,
    };
  }
```

5. Ramos `pension` e `equity` acrescentam `maturityDate: null, pendingRedemption: false` ao retorno.

6. Como o campo é obrigatório, atualizar os dois callers (senão o typecheck quebra) — em `src/services/portfolio.ts` (chamada de `instrumentValue`, ~linha 56) e `src/services/history.ts` (~linha 85), adicionar ao objeto:

```ts
      maturityDate: instrument.maturityDate,
```

- [ ] **Step 4: Atualizar os literais existentes e conferir tipos**

Em `src/domain/position.test.ts`, adicionar `maturityDate: null` aos literais `rf` (linha ~35), `input` (~70), `base` (~86) e `equity` (~124) — os spreads (`tiny`, `amortized`, `partial`, `pension`) herdam de `rf`/`base`.

Run: `npm run typecheck`
Expected: limpo.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -20`
Expected: todos verdes (162 testes: 158 + 4 novos).

- [ ] **Step 6: Commit**

```bash
git add src/domain/position.ts src/domain/position.test.ts src/services/portfolio.ts src/services/history.ts
git commit -m "feat: congela posição de RF no vencimento com sinal de resgate pendente"
```

---

### Task 2: Serviços — cobertura de regressão do congelamento

> Decisão do usuário (2026-09-22): os callers foram atualizados na Task 1 para o typecheck ficar verde; esta task escreve os testes de serviço como **cobertura de regressão** (não há fase "falha primeiro" — se algum falhar, a Task 1 está incompleta).

**Files:**
- Test: `src/services/portfolio.test.ts`, `src/services/history.test.ts`

**Interfaces:**
- Consumes: `PositionInput.maturityDate` e `PositionValue.pendingRedemption` (Task 1).
- Produces: cobertura de que `buildPortfolio` expõe `maturityDate`/`pendingRedemption` e `buildHistory` congela meses pós-vencimento. `HistoryPoint` não muda.

- [ ] **Step 1: Write the tests**

Adicionar a `src/services/portfolio.test.ts`:

```ts
const cdbVencido: InstrumentRow = { ...cdb, id: "cdb-vencido", legacyKey: "CDB Vencido", name: "CDB Vencido", maturityDate: "2026-09-17" };

test("portfolio congela título vencido e expõe pendingRedemption", () => {
  const db = openDb(":memory:");
  migrate(db);
  insertInstruments(db, [cdbVencido]);
  insertTransactions(db, [{ instrumentId: cdbVencido.id, tradeDate: "2026-09-15", kind: "BUY", quantityE8: null, grossCents: 100_000n, feesCents: 0n, note: null, legacyRow: null }]);
  writeIndexRates(db, [
    { series: "CDI", date: "2026-09-15", valueE12: 1_000_000_000n },
    { series: "CDI", date: "2026-09-16", valueE12: 1_000_000_000n },
    { series: "CDI", date: "2026-09-17", valueE12: 1_000_000_000n },
    { series: "CDI", date: "2026-09-18", valueE12: 1_000_000_000n },
  ]);
  const portfolio = buildPortfolio(db, { now: NOW }); // NOW = 2026-09-18
  const posicao = portfolio.positions[0];
  assert.equal(posicao?.marketValueCents, 100_300n); // 15→17/09; 18/09 não entra
  assert.equal(posicao?.priceDate, "2026-09-17");
  assert.equal(posicao?.maturityDate, "2026-09-17");
  assert.equal(posicao?.pendingRedemption, true);
});
```

Adicionar a `src/services/history.test.ts`:

```ts
test("history congela mês posterior ao vencimento", () => {
  const db = openDb(":memory:");
  migrate(db);
  const cdbVencido: InstrumentRow = { ...cdb, maturityDate: "2026-01-05" };
  insertInstruments(db, [cdbVencido]);
  insertTransactions(db, [{ instrumentId: cdbVencido.id, tradeDate: "2026-01-02", kind: "BUY", quantityE8: null, grossCents: 100_000n, feesCents: 0n, note: null, legacyRow: null }]);
  writeIndexRates(db, [
    { series: "CDI", date: "2026-01-02", valueE12: 1_000_000_000n },
    { series: "CDI", date: "2026-01-05", valueE12: 1_000_000_000n },
    { series: "CDI", date: "2026-02-10", valueE12: 1_000_000_000n },
  ]);
  const points = buildHistory(db, { from: "2026-01", to: "2026-02" }, { now: () => new Date("2026-02-20T12:00:00-03:00") });
  assert.equal(points[0]?.marketValueCents, 100_200n); // 02→05/01
  assert.equal(points[1]?.marketValueCents, 100_200n, "fevereiro não capitaliza");
});
```

- [ ] **Step 2: Run tests**

Run: `npm test 2>&1 | tail -20`
Expected: todos verdes (164 testes). Se algum falhar, a Task 1 está incompleta — investigue antes de seguir.

- [ ] **Step 3: Commit**

```bash
git add src/services/portfolio.test.ts src/services/history.test.ts
git commit -m "test: cobre congelamento de vencimento no portfolio e history"
```

---

### Task 3: Rota `/api/portfolio` expõe os campos

**Files:**
- Modify: `src/api/routes/portfolio.ts:20-30`
- Test: `src/api/app.test.ts`

**Interfaces:**
- Consumes: `PortfolioPosition.maturityDate`/`pendingRedemption` (Task 2).
- Produces: JSON de `/api/portfolio` com `maturityDate: string | null` e `pendingRedemption: boolean` por posição (aditivo).

- [ ] **Step 1: Write the failing test**

Adicionar a `src/api/app.test.ts` (depois do teste "rotas de portfolio, history e allocation…"):

```ts
test("GET /api/portfolio expõe maturityDate e pendingRedemption", async () => {
  const db = openDb(":memory:");
  migrate(db);
  const cdbVencido: InstrumentRow = { ...cdbInstrument, id: "cdb-vencido", legacyKey: "CDB Vencido", name: "CDB Vencido", maturityDate: "2026-09-17" };
  insertInstruments(db, [cdbVencido]);
  insertTransactions(db, [{ instrumentId: cdbVencido.id, tradeDate: "2026-09-15", kind: "BUY", quantityE8: null, grossCents: 100_000n, feesCents: 0n, note: null, legacyRow: null }]);
  writeIndexRates(db, [
    { series: "CDI", date: "2026-09-15", valueE12: 1_000_000_000n },
    { series: "CDI", date: "2026-09-16", valueE12: 1_000_000_000n },
    { series: "CDI", date: "2026-09-17", valueE12: 1_000_000_000n },
  ]);
  const app = buildApp({ db, csvDir: csvDirFixture(), logger: false });

  const portfolio = (await app.inject({ method: "GET", url: "/api/portfolio" })).json();
  assert.equal(portfolio.positions[0].marketValueCents, 100_300);
  assert.equal(portfolio.positions[0].maturityDate, "2026-09-17");
  assert.equal(portfolio.positions[0].pendingRedemption, true);

  await app.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | tail -20`
Expected: falha em `maturityDate`/`pendingRedemption` (`undefined`).

- [ ] **Step 3: Implement**

Em `src/api/routes/portfolio.ts`, no mapeamento de `positions`:

```ts
        marketValueCents: position.marketValueCents === null ? null : toNumberSafe(position.marketValueCents),
        investedCents: toNumberSafe(position.investedCents), redeemedCents: toNumberSafe(position.redeemedCents),
        feesCents: toNumberSafe(position.feesCents), stale: position.stale,
        maturityDate: position.maturityDate, pendingRedemption: position.pendingRedemption,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test 2>&1 | tail -20`
Expected: todos verdes (165 testes).

- [ ] **Step 5: Commit**

```bash
git add src/api/routes/portfolio.ts src/api/app.test.ts
git commit -m "feat: api de portfolio expõe vencimento e resgate pendente"
```

---

### Task 4: Web — tipos + badge em Posições

**Files:**
- Modify: `web/src/api.ts:74-79`, `web/src/views/PositionsView.tsx:161-164`

**Interfaces:**
- Consumes: JSON de `/api/portfolio` (Task 3).
- Produces: `PortfolioPosition` com `maturityDate`/`pendingRedemption`; badge âmbar na linha do ativo vencido.

- [ ] **Step 1: Atualizar o tipo**

Em `web/src/api.ts`:

```ts
export type PortfolioPosition = {
  instrumentId: string; name: string; kind: "fixed_income" | "equity" | "pension"; category: string;
  broker: string | null; objective: string | null; benchmark: string | null; rateE6: number | null;
  quantityE8: number | null; priceCents: number | null; priceDate: string | null; priceSource: string | null;
  marketValueCents: number | null; investedCents: number; redeemedCents: number; feesCents: number; stale: boolean;
  maturityDate: string | null; pendingRedemption: boolean;
};
```

- [ ] **Step 2: Badge na linha**

Em `web/src/views/PositionsView.tsx`, na célula do nome (linha ~161):

```tsx
                    <td>
                      {posicao.name}
                      {posicao.stale && <span className="badge badge-warn">desatualizado</span>}
                      {posicao.pendingRedemption && (
                        <span className="badge badge-warn">
                          {posicao.maturityDate === null ? "vencido · resgate pendente" : `vencido em ${formataData(posicao.maturityDate)} · resgate pendente`}
                        </span>
                      )}
                    </td>
```

(`formataData` já está importado no arquivo.)

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build:web`
Expected: limpo e build ok.

- [ ] **Step 4: Verificar no browser**

Com a API atualizada (`docker compose up -d --build`, ~1 min) e o Vite de pé: `npm run dev:web` e abrir `http://localhost:5173`.

Checklist: Posições → filtro **Tipo: Renda fixa** → a linha do "CDB Liquidez Diária 105%" (R$ <valor>) mostra o badge "vencido em 21/09/2026 · resgate pendente"; demais linhas sem badge. Screenshot: `.superpowers/sdd/venc-01-posicoes-badge.png`.

- [ ] **Step 5: Commit**

```bash
git add web/src/api.ts web/src/views/PositionsView.tsx
git commit -m "feat: badge de resgate pendente em Posições"
```

---

### Task 5: Web — faixa na Visão geral + navegação sem filtro

**Files:**
- Modify: `web/src/App.tsx:37,56-59,127`, `web/src/views/OverviewView.tsx:41-44,119-134`, `web/src/styles.css` (perto de `.callout`)

**Interfaces:**
- Consumes: `PortfolioPosition.pendingRedemption`/`maturityDate` (Task 4).
- Produces: faixa âmbar com contagem/total/vencimento mais antigo e atalho "Ver posições"; `onAbrirPosicoes` aceita `Classe | null`.

- [ ] **Step 1: Navegação sem filtro no App**

Em `web/src/App.tsx`:

```ts
  function abrirPosicoes(classe: Classe | null) {
    setFiltroPosicoes(classe);
    setView("posicoes");
  }
```

E o `useState` de `filtroPosicoes` continua `Classe | null`; `PositionsView` já trata `null` como "todos".

- [ ] **Step 2: Faixa na Visão geral**

Em `web/src/views/OverviewView.tsx`:

1. Assinatura (linha ~41):

```tsx
export function OverviewView({ reloadToken, onAbrirPosicoes }: {
  reloadToken: number;
  onAbrirPosicoes: (classe: Classe | null) => void;
}) {
```

2. Import: acrescentar `formataData` à lista de `../format.ts`.

3. Depois de `const somaResgates = …` (linha ~117):

```tsx
  const vencidos = portfolio.positions.filter((posicao) => posicao.pendingRedemption);
  const totalVencido = vencidos.reduce((soma, posicao) => soma + (posicao.marketValueCents ?? 0), 0);
  const vencimentoMaisAntigo = vencidos.reduce<string | null>((maisAntigo, posicao) => {
    if (posicao.maturityDate === null) return maisAntigo;
    return maisAntigo === null || posicao.maturityDate < maisAntigo ? posicao.maturityDate : maisAntigo;
  }, null);
```

4. Faixa entre o callout de erro e `<div className="colunas">` (linha ~134):

```tsx
      {vencidos.length > 0 && (
        <div className="callout callout-warn" role="status">
          <WarningCircle size={17} aria-hidden="true" />
          <div>
            <p className="callout-title">
              {vencidos.length === 1 ? "1 título vencido sem resgate lançado" : `${vencidos.length} títulos vencidos sem resgate lançado`}
            </p>
            <p>
              {formataBRL(totalVencido)} congelados desde {vencimentoMaisAntigo === null ? "o vencimento" : formataData(vencimentoMaisAntigo)}.
              Lance o resgate para zerar a posição.
            </p>
          </div>
          <button type="button" className="btn btn-secondary callout-acao" onClick={() => onAbrirPosicoes(null)}>
            Ver posições
          </button>
        </div>
      )}
```

- [ ] **Step 3: CSS do botão da faixa**

Em `web/src/styles.css`, depois do bloco `.callout-warn`:

```css
.callout-acao {
  margin-left: auto;
  flex: none;
  align-self: center;
}
```

- [ ] **Step 4: Typecheck + build + browser**

Run: `npm run typecheck && npm run build:web`
Expected: limpo e build ok.

Com `npm run dev:web` aberto: Visão geral mostra a faixa "1 título vencido sem resgate lançado · R$ <valor> congelados desde 21/09/2026"; clicar em "Ver posições" abre Posições **sem filtro** (48 ativos). Screenshot: `.superpowers/sdd/venc-02-overview-faixa.png`.

- [ ] **Step 5: Commit**

```bash
git add web/src/App.tsx web/src/views/OverviewView.tsx web/src/styles.css
git commit -m "feat: faixa de títulos vencidos na Visão geral"
```

---

### Task 6: Verificação real + fechamento do ROADMAP

**Files:**
- Modify: `ROADMAP.md`

**Interfaces:**
- Consumes: tudo das tasks 1–5.
- Produces: etapa marcada como concluída com evidências; próxima ação = v2 (CRUD).

- [ ] **Step 1: Suite e build**

Run: `npm test && npm run typecheck && npm run build:web`
Expected: **165 testes** verdes, typecheck limpo, build ok.

- [ ] **Step 2: Docker**

Run: `docker compose up -d --build && sleep 10 && curl -s localhost:3000/api/health`
Expected: container `healthy`; `/api/health` com `sources` sem erro.

- [ ] **Step 3: Aceite com dados reais**

```bash
curl -s localhost:3000/api/portfolio | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);const p=j.positions.filter(x=>x.pendingRedemption);console.log('total',j.totals.marketValueCents,'pendentes',p.map(x=>[x.instrumentId,x.marketValueCents,x.maturityDate]))})"
```

Expected: `total <valor>` (medido em 22/09 — se rodar em outro dia, re-medir e registrar o valor); pendentes = `cdb-liquidez-diaria-105-21-09-26` com `<valor>` e `2026-09-21`. O `...105-24-09-26` fica fora (vence 24/09).

```bash
curl -s "localhost:3000/api/reconciliation?month=2026-09&asOf=2026-09-16" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('reference',j.totals.referenceCents,'unexplained',j.unexplained)})"
curl -s "localhost:3000/api/reconciliation?month=2026-09" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('live unexplained',j.unexplained)})"
```

Expected: `reference <valor> unexplained 0` e `live unexplained 0`.

- [ ] **Step 4: Browser final (`:3000`)**

Com o container rebuildado, abrir `http://localhost:3000`: Visão geral com a faixa; Posições com o badge; screenshots `.superpowers/sdd/venc-03-final-*.png`.

- [ ] **Step 5: Atualizar o ROADMAP**

- Tabela "Estado atual": linha `| Vencimento de títulos RF (congelar + aviso) | concluída — ... |`.
- Evidências: acrescentar bullet com o resultado (165 testes, congelamento do CDB 21/09, reconciliação intocada, screenshots).
- "Próxima ação": `Etapa Vencimento de títulos RF concluída... Próxima: brainstorming da v2 (CRUD); imposto líquido × líquido na v3.`

- [ ] **Step 6: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: fecha etapa de vencimento de títulos no roadmap"
```

---

## Notas de execução

- O congelamento só muda números a partir de 23/09 (hoje o BCB ainda não publicou a taxa de 22/09): o total de hoje não muda.
- `cdb-liquidez-diaria-105-24-09-26` passa a `pendingRedemption: true` em 24/09, sem código novo.
- Renovação no mesmo ativo (BUY após vencimento) fica fora do escopo — premissa registrada na spec.
