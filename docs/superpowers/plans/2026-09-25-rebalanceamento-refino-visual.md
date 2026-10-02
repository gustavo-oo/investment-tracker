# Refino visual do Rebalanceamento — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** reorganizar a tela de Rebalanceamento na variação A aprovada (Metas com largura do conteúdo + aporte/total ocupando o resto, mesma altura e mesma base), remover legendas redundantes, tornar o aporte transiente (nunca persistido) e destacar o patrimônio total depois do aporte.

**Architecture:** sem mudança na fórmula: o backend só perde a persistência do aporte (migration 005 dropa `amount_cents`) e o serviço/rota passam a expor `portfolioTotalCents` (patrimônio total, inclui a reserva). O web reorganiza `RebalanceView` + classes `.reb-*`.

**Tech Stack:** Node 22 + TypeScript (`node:test`), Fastify 5, better-sqlite3, React 19 + Vite 8, CSS puro.

## Global Constraints

- Zero `float` em dado persistido/cálculo: centavos e E6 em `bigint`; `Number`/`toNumberSafe` só na borda da API/UI (pct de exibição pode ser `number`).
- Reserva = `objective === "Reserva"` fora do cálculo; previdência e `etf_fixed` contam como RF; metas somam `1_000_000` (E6).
- Aporte é **transiente**: `PUT /api/rebalance` recebe só `{ rfE6, rvE6 }`; `GET` sem `amountCents` usa 0.
- Artefatos, testes e commits em pt-BR; commits convencionais sem acento.
- Cada task = 1 layer com ≤ 400 linhas / ≤ 10 arquivos; `package-lock.json` não muda.
- Branch: `refino-rebalanceamento` (worktree `.worktrees/refino-rebalanceamento`).

---

### Task 1: Backend — aporte transiente + `portfolioTotalCents`

**Files:**
- Create: `src/db/migrations/005_remove_rebalance_amount.sql`
- Modify: `src/db/repos.ts` (fim do arquivo: `RebalanceTargetsRow`, `getRebalanceTargets`, `saveRebalanceTargets`)
- Modify: `src/db/migrate.test.ts` (contagem 4→5 + colunas de `rebalance_targets`)
- Modify: `src/services/rebalance.ts` (`RebalanceView.portfolioTotalCents`; `amountCents` default `0n`)
- Modify: `src/services/rebalance.test.ts`
- Modify: `src/api/routes/rebalance.ts` (PUT sem aporte; `toApiRebalance` com `portfolioTotalCents`)
- Modify: `src/api/app.test.ts` (fixture com reserva + 3 testes de rebalance)

**Interfaces:**
- Consumes: `buildPortfolio` (totals), `rebalance` (domínio, inalterado).
- Produces:
  - `type RebalanceTargetsRow = { rfE6: bigint; rvE6: bigint; updatedAt: string }`
  - `getRebalanceTargets(db): RebalanceTargetsRow` / `saveRebalanceTargets(db, { rfE6: bigint; rvE6: bigint }): RebalanceTargetsRow`
  - `RebalanceView` ganha `portfolioTotalCents: bigint`
  - `GET /api/rebalance` devolve `portfolioTotalCents` (number); `PUT /api/rebalance` aceita `{ rfE6, rvE6 }` e devolve `{ rfE6, rvE6, updatedAt }`

- [ ] **Step 1: Criar a migration**

Criar `src/db/migrations/005_remove_rebalance_amount.sql`:

```sql
ALTER TABLE rebalance_targets DROP COLUMN amount_cents;
```

- [ ] **Step 2: Atualizar os testes que falham**

Em `src/db/migrate.test.ts`, trocar o teste existente por:

```ts
test("migrate aplica 001 a 005 e é idempotente", () => {
  const db = openDb(":memory:");
  assert.equal(migrate(db), 5);
  assert.equal(migrate(db), 0);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => (row as { name: string }).name);
  for (const table of ["instruments", "transactions", "quotes", "index_rates", "valuations", "legacy_snapshots", "import_runs", "source_status", "fund_quotas", "rebalance_targets"]) {
    assert.ok(tables.includes(table), `tabela ${table} existe`);
  }
  const colunas = db.prepare("PRAGMA table_info(rebalance_targets)").all()
    .map((row) => (row as { name: string }).name);
  assert.deepEqual(colunas, ["id", "rf_e6", "rv_e6", "updated_at"]);
});
```

Em `src/services/rebalance.test.ts`:

1. No teste 1 ("agrupa RF..."), adicionar depois de `assert.equal(result.stale, false);`:

```ts
  assert.equal(result.portfolioTotalCents, 220_810n); // inclui a reserva (<valor>) e o CDB sem reserva
```

2. Trocar o teste 2 inteiro por:

```ts
test("usa as metas do banco (seed 80/20) e nao persiste aporte", () => {
  const db = openDb(":memory:");
  migrate(db);
  seed(db);
  const result = buildRebalance(db, { now: NOW });
  assert.deepEqual(result.targets, { rfE6: 800_000n, rvE6: 200_000n });
  assert.equal(result.amountCents, 0n);
  assert.equal(result.baseCents, 120_710n);
  assert.equal(result.portfolioTotalCents, 220_810n);
  const [rf, rv] = result.groups;
  assert.equal(rf?.aboveTarget, true); // 91,72% > 80%
  assert.equal(rv?.aboveTarget, false);
  assert.equal(rf?.suggestedCents, 0n);
  assert.equal(rv?.suggestedCents, 0n);
});
```

3. No teste 3 ("marca stale..."), adicionar:

```ts
  assert.equal(result.portfolioTotalCents, 220_810n);
```

Em `src/api/app.test.ts`, trocar a fixture `seedRebalance` por (inclui uma reserva para provar que o total a soma):

```ts
function seedRebalance(db: ReturnType<typeof openDb>) {
  insertInstruments(db, [
    { ...baseRebalance, id: "cdb-r", legacyKey: "CDB R", name: "CDB R", kind: "fixed_income", category: "cdb", ticker: null, benchmark: "CDI", rateE6: 1_000_000n },
    { ...baseRebalance, id: "etf-r", legacyKey: "ETF R", name: "ETF R", kind: "equity", category: "etf_equity", ticker: "WRLD11", benchmark: null, rateE6: null, broker: "XP" },
    { ...baseRebalance, id: "cdb-res", legacyKey: "CDB Res", name: "CDB Res", kind: "fixed_income", category: "cdb", ticker: null, benchmark: "CDI", rateE6: 1_000_000n, objective: "Reserva" },
  ]);
  insertTransactions(db, [
    { instrumentId: "cdb-r", tradeDate: "2026-09-17", kind: "BUY", quantityE8: null, grossCents: 100_000n, feesCents: 0n, note: null, legacyRow: null },
    { instrumentId: "etf-r", tradeDate: "2026-09-17", kind: "BUY", quantityE8: 10_00000000n, grossCents: 9_000n, feesCents: 0n, note: null, legacyRow: null },
    { instrumentId: "cdb-res", tradeDate: "2026-09-17", kind: "BUY", quantityE8: null, grossCents: 100_000n, feesCents: 0n, note: null, legacyRow: null },
  ]);
  writeIndexRates(db, [{ series: "CDI", date: "2026-09-17", valueE12: 1_000_000_000n }]);
  writeQuotes(db, [{ ticker: "WRLD11", date: "2026-09-17", closeCents: 1_000n, source: "yahoo", settled: true }], "2026-09-18");
  recordSourceAttempt(db, "bcb", { ok: true });
  recordSourceAttempt(db, "yahoo", { ok: true });
}
```

E trocar os 3 testes de rebalance do fim do arquivo por:

```ts
test("GET /api/rebalance calcula o aporte por grupo e aceita metas na query", async () => {
  const db = openDb(":memory:");
  migrate(db);
  seedRebalance(db);
  const app = buildApp({ db, csvDir: csvDirFixture(), logger: false });

  let res = await app.inject({ method: "GET", url: "/api/rebalance" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().targets, { rfE6: <valor>, rvE6: <valor> });
  assert.equal(res.json().baseCents, 110_100);
  assert.equal(res.json().portfolioTotalCents, 210_200); // inclui a reserva
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

test("PUT /api/rebalance persiste so as metas", async () => {
  const db = openDb(":memory:");
  migrate(db);
  seedRebalance(db);
  const app = buildApp({ db, csvDir: csvDirFixture(), logger: false });

  let res = await app.inject({
    method: "PUT", url: "/api/rebalance",
    payload: { rfE6: <valor>, rvE6: <valor> },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().rfE6, <valor>);
  assert.equal(res.json().rvE6, <valor>);
  assert.equal(typeof res.json().updatedAt, "string");

  res = await app.inject({ method: "GET", url: "/api/rebalance" });
  assert.deepEqual(res.json().targets, { rfE6: <valor>, rvE6: <valor> });
  assert.equal(res.json().amountCents, 0);

  await app.close();
});

test("rebalance valida metas e aporte com 400", async () => {
  const db = openDb(":memory:");
  migrate(db);
  const app = buildApp({ db, csvDir: csvDirFixture(), logger: false });

  let res = await app.inject({
    method: "PUT", url: "/api/rebalance",
    payload: { rfE6: <valor>, rvE6: <valor> },
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /somar 100%/);

  res = await app.inject({
    method: "PUT", url: "/api/rebalance",
    payload: { rfE6: -1, rvE6: <valor> },
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /entre 0% e 100%/);

  res = await app.inject({
    method: "PUT", url: "/api/rebalance",
    payload: { rfE6: 1.5, rvE6: <valor> },
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /inteiras/);

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

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test src/services/rebalance.test.ts src/db/migrate.test.ts src/api/app.test.ts`
Expected: FAIL — `portfolioTotalCents` undefined; PRAGMA ainda lista `amount_cents`; `migrate` devolve 4.

- [ ] **Step 4: Atualizar o repositório**

Em `src/db/repos.ts`, substituir as funções de rebalance (fim do arquivo) por:

```ts
export type RebalanceTargetsRow = { rfE6: bigint; rvE6: bigint; updatedAt: string };

type RebalanceTargetsDbRow = { rf_e6: bigint; rv_e6: bigint; updated_at: string };

export function getRebalanceTargets(db: Db): RebalanceTargetsRow {
  const row = db.prepare("SELECT rf_e6, rv_e6, updated_at FROM rebalance_targets WHERE id = 1")
    .get() as RebalanceTargetsDbRow;
  return { rfE6: row.rf_e6, rvE6: row.rv_e6, updatedAt: row.updated_at };
}

export function saveRebalanceTargets(db: Db, targets: { rfE6: bigint; rvE6: bigint }): RebalanceTargetsRow {
  db.prepare(`INSERT INTO rebalance_targets (id, rf_e6, rv_e6, updated_at)
    VALUES (1, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      rf_e6 = excluded.rf_e6, rv_e6 = excluded.rv_e6, updated_at = excluded.updated_at`)
    .run(targets.rfE6, targets.rvE6);
  return getRebalanceTargets(db);
}
```

- [ ] **Step 5: Atualizar o serviço**

Em `src/services/rebalance.ts`:

1. No tipo `RebalanceView`, adicionar depois de `baseCents`:

```ts
  portfolioTotalCents: bigint;
```

2. Trocar a linha do aporte:

```ts
  const amountCents = deps.amountCents ?? 0n;
```

3. No retorno, adicionar depois de `baseCents: result.baseCents,`:

```ts
    portfolioTotalCents: portfolio.totals.marketValueCents,
```

- [ ] **Step 6: Atualizar a rota**

Em `src/api/routes/rebalance.ts`:

1. Em `toApiRebalance`, adicionar depois de `baseCents`:

```ts
    portfolioTotalCents: toNumberSafe(result.portfolioTotalCents),
```

2. Trocar o handler do PUT inteiro por:

```ts
  app.put<{ Body: unknown }>("/api/rebalance", (request, reply) => {
    if (!isRecord(request.body)) return reply.code(400).send({ error: "corpo deve ser um objeto" });
    const { rfE6, rvE6 } = request.body;
    if (!Number.isSafeInteger(rfE6) || !Number.isSafeInteger(rvE6)) {
      return reply.code(400).send({ error: "metas devem ser inteiras" });
    }
    const targets = validateTargets(BigInt(rfE6 as number), BigInt(rvE6 as number));
    if (!targets.ok) return reply.code(400).send({ error: targets.error });
    const saved = saveRebalanceTargets(db, targets.value);
    return {
      rfE6: toNumberSafe(saved.rfE6),
      rvE6: toNumberSafe(saved.rvE6),
      updatedAt: saved.updatedAt,
    };
  });
```

- [ ] **Step 7: Rodar os testes e o typecheck**

Run: `node --test src/services/rebalance.test.ts src/db/migrate.test.ts src/api/app.test.ts && npm test && npm run typecheck`
Expected: PASS — 219 testes; typecheck limpo.

- [ ] **Step 8: Commit**

```bash
git add src/db/migrations/005_remove_rebalance_amount.sql src/db/repos.ts src/db/migrate.test.ts src/services/rebalance.ts src/services/rebalance.test.ts src/api/routes/rebalance.ts src/api/app.test.ts
git commit -m "feat: aporte transiente e total com reserva no rebalanceamento"
```

---

### Task 2: Web — layout da variação A

**Files:**
- Modify: `web/src/api.ts` (tipos + payload do PUT)
- Modify: `web/src/views/RebalanceView.tsx` (reescrito)
- Modify: `web/src/styles.css` (bloco `.reb-*` substituído)

**Interfaces:**
- Consumes: `GET /api/rebalance` com `portfolioTotalCents` (Task 1); `formataBRL`/`formataPercentual`/`parseMoedaParaCents`/`parsePercentualParaE6` de `web/src/format.ts`.
- Produces: `Rebalance.portfolioTotalCents: number`; `saveRebalance({ rfE6, rvE6 })`; `RebalanceView` no layout A.

- [ ] **Step 1: Atualizar os tipos e o PUT no cliente**

Em `web/src/api.ts`:

1. No tipo `Rebalance`, adicionar depois de `baseCents: number;`:

```ts
  portfolioTotalCents: number;
```

2. Trocar o tipo `RebalanceConfig` e a função `saveRebalance`:

```ts
export type RebalanceConfig = { rfE6: number; rvE6: number; updatedAt: string };
```

```ts
export const saveRebalance = (payload: { rfE6: number; rvE6: number }): Promise<RebalanceConfig> =>
  sendJson("/api/rebalance", "PUT", payload);
```

- [ ] **Step 2: Reescrever a view**

Substituir todo o `web/src/views/RebalanceView.tsx` por:

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
        setAporteTexto(""); // transiente: sempre começa vazio
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
    setRecado(null);
    const controller = new AbortController();
    const id = setTimeout(() => {
      getRebalance({ amountCents: aporte, rfE6, rvE6 }, controller.signal)
        .then((resultado) => { setDados(resultado); setErro(null); })
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
    if (rfE6 === null || rvE6 === null) return setErroEntrada("meta inválida (ex.: 80 ou 72,5)");
    if (rfE6 + rvE6 !== SOMA_METAS) return setErroEntrada("as metas precisam somar 100%");
    setSalvando(true);
    setRecado(null);
    try {
      await saveRebalance({ rfE6, rvE6 });
      setRecado("Metas salvas");
    } catch (cause) {
      setErroEntrada(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSalvando(false);
    }
  }

  const totalDepois = dados === null ? 0 : dados.portfolioTotalCents + dados.amountCents;

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

      <div className="reb-topo">
        <section className="card">
          <h2 className="reb-secao-titulo">Metas</h2>
          <div className="reb-metas-linha">
            <label className="campo">
              <span className="stat-label">Renda Fixa</span>
              <span className="campo-sufixo">
                <input inputMode="decimal" value={rfTexto} onChange={(evento) => setRfTexto(evento.target.value)} placeholder="80" />
                <span className="campo-sufixo-texto">%</span>
              </span>
            </label>
            <label className="campo">
              <span className="stat-label">Renda Variável</span>
              <span className="campo-sufixo">
                <input inputMode="decimal" value={rvTexto} onChange={(evento) => setRvTexto(evento.target.value)} placeholder="20" />
                <span className="campo-sufixo-texto">%</span>
              </span>
            </label>
            <button type="button" className="btn btn-secondary" disabled={salvando} onClick={() => void salvar()}>
              {salvando ? "Salvando…" : "Salvar metas"}
            </button>
          </div>
          {erroEntrada !== null && <p className="campo-erro" role="alert">{erroEntrada}</p>}
          {recado !== null && <span className="reb-nota" role="status">{recado}</span>}
        </section>

        <section className="card">
          <span className="stat-label">Quanto vou investir</span>
          <div className="reb-base">
            <span className="campo-moeda">
              <span className="campo-prefixo">R$</span>
              <input inputMode="decimal" value={aporteTexto} onChange={(evento) => setAporteTexto(evento.target.value)} placeholder="<valor>" />
            </span>
            <div className="reb-resumo-total">
              <span className="stat-label">Patrimônio total depois</span>
              <strong>{formataBRL(totalDepois)}</strong>
            </div>
          </div>
        </section>
      </div>

      {dados !== null && (
        <div className="reb-grade">
          {dados.groups.map((grupo) => (
            <section className="card reb-card" key={grupo.key}>
              <div className="reb-card-topo">
                <h2 className="reb-titulo">{ROTULOS[grupo.key] ?? grupo.key}</h2>
                <span className={grupo.aboveTarget ? "badge badge-warn" : "badge badge-neutro"}>
                  {grupo.aboveTarget ? "acima da meta — sem aporte novo" : `meta ${formataPercentual(grupo.targetE6 / 10_000)}`}
                </span>
              </div>
              <div className="reb-hero">
                <span className="stat-label">Investir</span>
                <strong>{formataBRL(grupo.suggestedCents)}</strong>
              </div>
              <span className="reb-caminho">
                <span className="reb-caminho-rotulo">Valor</span>
                {formataBRL(grupo.valueCents)} <span className="reb-seta">→</span> {formataBRL(grupo.afterValueCents)}
              </span>
              <span className="reb-caminho">
                <span className="reb-caminho-rotulo">Participação</span>
                {formataPercentual(grupo.pctBefore)} <span className="reb-seta">→</span> {formataPercentual(grupo.pctAfter)}
              </span>
            </section>
          ))}
        </div>
      )}

      {dados !== null && (
        <p className="reb-nota reb-rodape">
          Base do cálculo: {formataBRL(dados.baseCents)} fora da reserva ({formataBRL(dados.portfolioTotalCents - dados.baseCents)} na reserva de emergência).
          {dados.stale && " Há cotações desatualizadas — usando o último valor conhecido."}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Substituir o bloco de estilos**

Em `web/src/styles.css`, substituir o bloco atual de `.reb-*` (de `.reb-metas {` até o `@media (max-width: 1024px)` que contém `.reb-metas, .reb-grade`) por:

```css
.reb-secao-titulo { margin: 0; font-size: 15px; }
.reb-topo { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 14px; align-items: stretch; }
.reb-topo > .card { display: flex; flex-direction: column; justify-content: space-between; gap: 12px; }
.reb-metas-linha { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
.reb-metas-linha .campo { min-width: 92px; max-width: 110px; }
.reb-base { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; flex-wrap: wrap; }
.reb-base .campo-moeda { min-width: 190px; }
.reb-resumo-total { text-align: right; }
.reb-resumo-total strong { display: block; margin-top: 2px; font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 30px; font-weight: 600; letter-spacing: -0.03em; white-space: nowrap; }
.reb-grade { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 14px; }
.reb-card { display: flex; flex-direction: column; gap: 12px; }
.reb-card-topo { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.reb-titulo { margin: 0; font-size: 15px; }
.reb-hero { display: flex; flex-direction: column; gap: 2px; margin-top: 14px; }
.reb-hero strong { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 30px; font-weight: 600; letter-spacing: -0.02em; color: var(--accent); }
.reb-caminho { display: flex; gap: 8px; margin-top: 8px; color: var(--text-2); font-size: 12.5px; }
.reb-caminho-rotulo { color: var(--text-3); min-width: 78px; }
.reb-seta { color: var(--text-3); }
.reb-nota { color: var(--text-2); font-size: 12px; }
.reb-rodape { margin-top: 14px; }
@media (max-width: 1024px) {
  .reb-topo, .reb-grade { grid-template-columns: minmax(0, 1fr); }
}
```

- [ ] **Step 4: Typecheck, build e suíte**

Run: `npm run typecheck && npm run build:web && npm test`
Expected: typecheck limpo; build ok; 219 testes.

- [ ] **Step 5: Commit**

```bash
git add web/src/api.ts web/src/views/RebalanceView.tsx web/src/styles.css
git commit -m "feat: layout em colunas do rebalanceamento com aporte transiente"
```

---

### Task 3: Aceite com dados reais + verificação final

**Files:** nenhum novo (verificação e evidência).

- [ ] **Step 1: Verificação completa**

Run: `npm test && npm run typecheck && npm run build:web`
Expected: 219 testes; typecheck e build limpos.

- [ ] **Step 2: Servidor local com o banco real**

Copiar o banco e subir a API do worktree em segundo plano:

```bash
mkdir -p data && sqlite3 ./data/investments.db ".backup 'data/investments.db'"
PORT=3100 DB_PATH=data/investments.db WEB_DIR=web/dist nohup node src/server.ts > /tmp/refino-server.log 2>&1 &
echo $! > /tmp/refino-server.pid
sleep 3 && curl -s localhost:3100/api/health | head -c 160
```

- [ ] **Step 3: Conferência independente (BigInt)**

1. `curl -s "localhost:3100/api/portfolio"` → somar `totals.marketValueCents` (total com reserva) e a base sem reserva.
2. `curl -s "localhost:3100/api/rebalance?amountCents=<valor>"` → `portfolioTotalCents` deve ser igual ao total do portfolio; `suggested` soma <valor>¢; `amountCents` = <valor>.
3. `curl -s localhost:3100/api/reconciliation?month=2026-09&asOf=2026-09-16` → `referenceCents <valor>`, `unexplained 0`.

- [ ] **Step 4: Aceite no browser (1280 e 1024)**

1. Abrir `localhost:3100` → Rebalanceamento: conferir layout A (Metas à esquerda com título no topo; aporte + total na mesma base; cartões RF/RV lado a lado com "Investir" herói, badge `meta %`, linhas `Valor`/`Participação`).
2. Digitar `<valor>` → "Patrimônio total depois" = total do portfolio + <valor>; conferir contra o `/api/portfolio`.
3. Recarregar → aporte **vazio** de novo; metas continuam; rodapé "Base do cálculo" presente.
4. Metas 60/40 → badge âmbar "acima da meta" + R$ <valor> no grupo acima; metas 80/30 → erro inline.
5. Sem overflow horizontal em 1280/1024 (`document.documentElement.scrollWidth === window.innerWidth`).

Screenshots em `.superpowers/sdd/refino-01-visao.png`, `refino-02-acima.png`, `refino-03-1024.png`.

- [ ] **Step 5: Docker**

Com a `:3000` possivelmente ocupada por outra sessão, usar um projeto/porta alternativos:

```bash
printf 'services:\n  app:\n    ports: !override\n      - "3101:3000"\n' > /tmp/refino-dc-override.yml
docker compose -p refino-check -f docker-compose.yml -f /tmp/refino-dc-override.yml up -d --build
sleep 30 && docker ps --filter name=refino-check --format '{{.Names}} {{.Status}}'
curl -s localhost:3101/api/health | head -c 160; echo
curl -s "localhost:3101/api/rebalance?amountCents=<valor>" | head -c 200; echo
docker compose -p refino-check -f docker-compose.yml -f /tmp/refino-dc-override.yml down
rm -f /tmp/refino-dc-override.yml
```

- [ ] **Step 6: ROADMAP + commit final**

No `ROADMAP.md`, acrescentar ao bullet de evidência do rebalanceamento:

`**Refino visual (2026-09-25, branch refino-rebalanceamento):** layout em colunas (Metas no tamanho do conteúdo + aporte/total na mesma base), aporte transiente (migration 005 remove amount_cents) e "Patrimônio total depois" em destaque; 219 testes.`

```bash
git add ROADMAP.md
git commit -m "docs: evidencia do refino visual do rebalanceamento"
```

---

## Notas de execução

- Rodar tudo dentro do worktree `.worktrees/refino-rebalanceamento`.
- O container em `:3000` pode estar em uso por outra sessão; usar porta alternativa com override temporário (nunca derrubar o container alheio).
- `npm test` deve terminar em 219 testes nas Tasks 1–3.
