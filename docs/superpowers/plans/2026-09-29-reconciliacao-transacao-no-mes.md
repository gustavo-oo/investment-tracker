# Reconciliação: causa `transacao-no-mes` — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a visão ao vivo da reconciliação explica divergências causadas por transações de saldo já ocorridas no mês (entre o snapshot legado e o `asOf`) com a causa nova `transacao-no-mes` — `unexplained 0` na varredura 16→29/09, sem mudar a canônica `asOf=2026-09-16`.

**Architecture:** regra pura em `classifyDivergence` (novo boolean `transactionInMonthUpToAsOf`), posicionada depois das causas específicas e de `cotacao-fora-da-janela`, antes de `nao-explicada`; `buildReconciliation` calcula o flag varrendo as transações de saldo com `monthStart ≤ tradeDate ≤ asOf`. Web só ganha o rótulo. Spec: `docs/superpowers/specs/2026-09-29-reconciliacao-transacao-no-mes-design.md`.

**Tech Stack:** Node 22 + TypeScript, `node --test` (backend), Fastify; web React 19.

## Global Constraints

- Zero `float` em cálculo persistido: centavos/bigint; `Number` só na apresentação.
- Artefatos e commits em pt-BR; commits convencionais sem acento.
- TDD no backend: teste que falha → implementação mínima → verde; `npm test` (232 atuais + novos), `npm run typecheck` e `npm run build:web` limpos.
- Web sem runner de testes: nenhum teste novo de web; a verificação é typecheck/build + browser.
- Sem migration, sem import, sem mudança em `legacy_snapshots`/API shape (só a união de causa ganha o valor novo).
- Causa: id `transacao-no-mes`; janela `monthStart ≤ tradeDate ≤ asOf`; só kinds de saldo (`BUY`, `SELL`, `AMORTIZATION`).
- Ordem das regras: `residuo-zerado` → `transacao-fora-da-janela` → `legado-snapshot-maio-2025` → `legado-sem-cdi-maio-2026` → `legado-sem-selic-junho-2026` → `fonte-yahoo-corrompida` → `data-de-referencia` → `cotacao-fora-da-janela` → **`transacao-no-mes`** → `nao-explicada`.
- Aceite inegociável: `asOf=2026-09-16` mantém `referenceCents <valor>`, `unexplained 0` e as mesmas 28 divergências com as mesmas causas; varredura 16→29/09 com `unexplained 0` em todos os dias.
- Cada task: ≤ 400 linhas de diff e ≤ 10 arquivos; `package-lock.json` não muda.

---

### Task 1: Regra `transacao-no-mes` no classificador (TDD)

**Files:**
- Modify: `src/services/reconciliation.ts` (causas L8-19; input L40-43; regras L45-54; `buildReconciliation` L70-97)
- Test: `src/services/reconciliation.test.ts` (append)

**Interfaces:**
- Consumes: `RECONCILIATION_CAUSES`, `classifyDivergence`, `buildReconciliation`, `BALANCE_KINDS` (existentes); `insertTransactions`, `writeQuotes`, `insertLegacySnapshots`, `openDb`, `migrate` (testes existentes).
- Produces: `RECONCILIATION_CAUSES` com `"transacao-no-mes"`; input de `classifyDivergence` com `transactionInMonthUpToAsOf: boolean`; `buildReconciliation` passa o flag.

- [ ] **Step 1: Escrever os testes que falham**

Append em `src/services/reconciliation.test.ts`:

```ts
test("classifyDivergence: transação no mês até o asOf explica a divergência", () => {
  assert.equal(
    classify({ ourCents: 0n, legacyCents: 500n, diffCents: -500n, transactionInMonthUpToAsOf: true }),
    "transacao-no-mes",
  );
  // causas específicas têm prioridade sobre a genérica
  assert.equal(classify({ transactionInMonthUpToAsOf: true }), "legado-sem-cdi-maio-2026");
  assert.equal(
    classify({ transactionInMonthUpToAsOf: true, transactionAfterAsOf: true }),
    "transacao-fora-da-janela",
  );
  assert.equal(
    classify({ month: "2024-12", legacyCents: 100_000n, ourCents: 100_100n, diffCents: 100n, transactionInMonthUpToAsOf: true }),
    "data-de-referencia",
  );
  assert.equal(
    classify({
      instrument: etf, month: "2026-09", currentMonth: "2026-09",
      legacyCents: 100_000n, ourCents: 101_340n, diffCents: 1_340n, transactionInMonthUpToAsOf: true,
    }),
    "cotacao-fora-da-janela",
  );
  // sem transação no mês segue não explicada
  assert.equal(classify({ ourCents: 0n, legacyCents: 500n, diffCents: -500n }), "nao-explicada");
});

test("buildReconciliation: SELL de 20/09 vira transacao-no-mes em 30/09 e transacao-fora-da-janela em 19/09", () => {
  const db = openDb(":memory:");
  migrate(db);
  const etfMov = { ...etf, id: "etf-mov", legacyKey: "ETF MOV", name: "ETF MOV" };
  insertInstruments(db, [etfMov]);
  insertTransactions(db, [
    { instrumentId: etfMov.id, tradeDate: "2026-09-01", kind: "BUY", quantityE8: 10_00000000n, grossCents: 9_000n, feesCents: 0n, note: null, legacyRow: null },
    { instrumentId: etfMov.id, tradeDate: "2026-09-20", kind: "SELL", quantityE8: -5_00000000n, grossCents: 5_000n, feesCents: 0n, note: null, legacyRow: null },
  ]);
  writeQuotes(db, [{ ticker: "WRLD11", date: "2026-09-10", closeCents: 1_000n, source: "yahoo", settled: true }], "2026-10-01");
  insertLegacySnapshots(db, [{ month: "2026-09-01", instrumentId: etfMov.id, valueCents: 8_000n, sharesE8: null }]);

  const antes = buildReconciliation(db, { month: "2026-09", asOf: "2026-09-19" });
  assert.deepEqual(
    antes.divergences.map((divergence) => [divergence.cause, divergence.ourCents, divergence.diffCents]),
    [["transacao-fora-da-janela", 10_000n, 2_000n]],
  );

  const depois = buildReconciliation(db, { month: "2026-09", asOf: "2026-09-30" });
  assert.deepEqual(
    depois.divergences.map((divergence) => [divergence.cause, divergence.ourCents, divergence.diffCents]),
    [["transacao-no-mes", 5_000n, -3_000n]],
  );
  assert.equal(depois.unexplained, 0);
});
```

- [ ] **Step 2: Rodar os testes e ver falhar (RED)**

Run: `npm test 2>&1 | grep -E "transacao-no-mes|# (pass|fail)"`
Expected: os 2 testes novos falham (causa devolvida `nao-explicada` / `undefined` no lugar de `transacao-no-mes`); o restante passa.

- [ ] **Step 3: Implementar a causa**

3a. Em `RECONCILIATION_CAUSES` (L8-18), inserir entre `"cotacao-fora-da-janela"` e `"nao-explicada"`:

```ts
  "transacao-no-mes",
```

3b. No input de `classifyDivergence`, acrescentar o campo:

```ts
export function classifyDivergence(input: {
  instrument: InstrumentRow; month: string; legacyCents: bigint; ourCents: bigint; diffCents: bigint;
  transactionAfterAsOf: boolean; transactionInMonthUpToAsOf: boolean; currentMonth: string;
}): ReconciliationCause {
```

3c. Antes do `return "nao-explicada";` (L54), acrescentar a regra:

```ts
  if (input.transactionInMonthUpToAsOf) return "transacao-no-mes";
```

3d. Em `buildReconciliation`, depois de `hasTransactionAfter` (L71-74):

```ts
  const hasTransactionInMonthUpTo = (instrumentId: string): boolean =>
    transactions.some((transaction) =>
      transaction.instrumentId === instrumentId && BALANCE_KINDS.has(transaction.kind)
      && transaction.tradeDate >= `${month}-01` && transaction.tradeDate <= asOf);
```

3e. Na chamada de `classifyDivergence` (L93-96), acrescentar o flag:

```ts
      cause: noQuote ? "nao-explicada" : classifyDivergence({
        instrument, month, legacyCents, ourCents, diffCents, transactionAfterAsOf: hasTransactionAfter(instrument.id),
        transactionInMonthUpToAsOf: hasTransactionInMonthUpTo(instrument.id),
        currentMonth: today.slice(0, 7),
      }),
```

- [ ] **Step 4: Rodar os testes e ver passar (GREEN)**

Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# pass 234` (232 + 2), `# fail 0`.

- [ ] **Step 5: Typecheck e build**

Run: `npm run typecheck && npm run build:web`
Expected: typecheck limpo (o helper `classify` do teste tipa o campo novo) e build ok (warning de chunk conhecido).

- [ ] **Step 6: Commit**

```bash
git add src/services/reconciliation.ts src/services/reconciliation.test.ts
git commit -m "feat: causa transacao-no-mes na reconciliacao"
```

---

### Task 2: Rótulo na UI + aceite real + merge/deploy/ROADMAP

**Files:**
- Modify: `web/src/api.ts` (união `ReconciliationCause`, L62-65)
- Modify: `web/src/views/SourcesView.tsx` (`ROTULO_CAUSA`, L6-16)
- Nenhum outro; screenshots em `.superpowers/sdd/`; `ROADMAP.md` ao final

**Interfaces:**
- Consumes: `ReconciliationCause` e `getReconciliation` de `web/src/api.ts`; `ROTULO_CAUSA` de `SourcesView.tsx`.
- Produces: rótulo "Transação no mês (posterior ao snapshot do legado)" para `transacao-no-mes`.

- [ ] **Step 1: União no web**

Em `web/src/api.ts`, acrescentar `"transacao-no-mes"` à união (entre `"cotacao-fora-da-janela"` e `"nao-explicada"`):

```ts
export type ReconciliationCause =
  | "residuo-zerado" | "transacao-fora-da-janela"
  | "legado-snapshot-maio-2025" | "legado-sem-cdi-maio-2026" | "legado-sem-selic-junho-2026"
  | "fonte-yahoo-corrompida" | "data-de-referencia" | "cotacao-fora-da-janela" | "transacao-no-mes" | "nao-explicada";
```

- [ ] **Step 2: Rótulo em `SourcesView.tsx`**

Em `ROTULO_CAUSA`, depois de `"cotacao-fora-da-janela"`:

```ts
  "transacao-no-mes": "Transação no mês (posterior ao snapshot do legado)",
```

- [ ] **Step 3: Verificação estática**

Run: `npm run typecheck && npm run build:web && npm test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: limpo; `# pass 234`.

- [ ] **Step 4: Conferir a API real (canônica intocada + live zerado)**

```bash
for d in 16 19 21 24 27 28 29; do curl -s "localhost:3000/api/reconciliation?month=2026-09&asOf=2026-09-$d" | python3 -c "
import json,sys
from collections import Counter
d=json.load(sys.stdin)
c=Counter(x['cause'] for x in d['divergences'])
print(d['asOf'], 'unexpl', d.get('unexplained'), dict(sorted(c.items())))
"; done
```

Expected (após rebuild do container com o fix): `unexpl 0` em todos; `asOf=2026-09-16` com as mesmas causas da linha de base (`data-de-referencia 2`, `legado-sem-cdi-maio-2026 19`, `legado-sem-selic-junho-2026 2`, `legado-snapshot-maio-2025 1`, `residuo-zerado 1`, `transacao-fora-da-janela 3`); 21–23/09 com `transacao-no-mes 1`; 24–27/09 com `2`; 28–29/09 com `4`.

- [ ] **Step 5: Browser em Fontes**

Abrir `http://localhost:3000` → Fontes → seção Reconciliação: as 4 linhas de 28–29/09 (ou o estado corrente) mostram o rótulo **"Transação no mês (posterior ao snapshot do legado)"**; screenshot `.superpowers/sdd/recon-01-transacao-no-mes.png`.

- [ ] **Step 6: Verificação final**

Run: `npm test && npm run typecheck && npm run build:web` e `docker compose up -d --build` + `curl localhost:3000/api/health`
Expected: 234 verdes, tudo limpo, Docker `healthy`, reconciliação `asOf=2026-09-16` `<valor>`/`0`.

- [ ] **Step 7: Merge, deploy e ROADMAP**

1. Merge local na `main` (ff) e `git push origin main`.
2. Homelab: `ssh <valor>.<valor>` → `cd ~/homelab/investment-tracker && git pull --ff-only && docker compose up -d --build`; conferir `/api/health` e a varredura live (`unexplained 0`).
3. Atualizar `ROADMAP.md`: marcar a investigação como **corrigida** — causa nova `transacao-no-mes`, canônica intocada, varredura 16→29/09 com `unexplained 0`, testes, commit do merge.
4. Remover worktree/branch da feature, se houver.

---

## Verificação final da branch

```bash
npm test && npm run typecheck && npm run build:web
```

Expected: 234 testes verdes, typecheck limpo, build ok.
