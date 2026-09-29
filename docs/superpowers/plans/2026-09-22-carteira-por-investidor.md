# Carteira por investidor (filtro + correção) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expor `investor` em `/api/portfolio`, filtrar por investidor na tela Posições e corrigir o investidor de um ativo pelo painel via `PATCH /api/instruments/:id` (enum exato `Ana` · `Beto`).

**Architecture:** O repo ganha um UPDATE pontual; o serviço/rota de portfolio propagam `investor`; a rota de instrumentos ganha o primeiro write de domínio (body estrito + enum); a UI (Posições) ganha um `select` de filtro e um editor no painel do ativo, sem refetch. Import segue permissivo e sobrescreve no próximo ciclo (decisão registrada).

**Tech Stack:** Node 22 + TypeScript (type stripping), `node:test`, Fastify, better-sqlite3, React 19 + Vite, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-22-carteira-por-investidor-design.md`

## Global Constraints

- Zero `float` em dado persistido/cálculo; inteiros escalonados; `toNumberSafe` só na borda da API.
- Testes sem rede (fixtures); `node:test` + `assert/strict`; DB de teste = `openDb(":memory:")` + `migrate`.
- Commits em pt-BR (conventional), 1 por task; ≤ 400 linhas / ≤ 10 arquivos por layer.
- Branch `carteira-por-investidor` a partir da `main`; merge ff ao final.
- Não commitar `.superpowers/`, `data/`, `.env`.
- Enum de escrita exato: `Ana` | `Beto` (sem trim/case); import inalterado (permissivo, sobrescreve).
- UI do recorte: só a tela Posições; Visão geral/gráfico/alocação/reconciliação seguem totais.
- Verificação: `npm test`, `npm run typecheck`, `npm run build:web`, `docker compose up -d --build`, `curl localhost:3000/api/health`.

---

### Task 1: Repo — atualizar investidor de um instrumento

**Files:**
- Modify: `src/db/repos.ts` (imports de teste e função após `getInstrumentByLegacyKey`, ~linha 77)
- Test: `src/db/repos.test.ts`

**Interfaces:**
- Consumes: `getInstrument` (`src/db/repos.ts:69`).
- Produces: `updateInstrumentInvestor(db: Db, id: string, investor: string): InstrumentRow | undefined` — UPDATE do campo `investor` e retorno do instrumento atualizado (`undefined` se o id não existir). `InstrumentRow.investor` já é `string | null`.

- [ ] **Step 1: Write the failing test**

Adicionar ao fim de `src/db/repos.test.ts` (e incluir `updateInstrumentInvestor` na lista de imports de `./repos.ts`):

```ts
test("updateInstrumentInvestor altera só o investidor e devolve o instrumento", () => {
  const db = freshDb();
  insertInstruments(db, [cdb]);
  const atualizado = updateInstrumentInvestor(db, cdb.id, "Beto");
  assert.equal(atualizado?.investor, "Beto");
  assert.equal(atualizado?.rateE6, 1060000n, "demais campos intactos");
  assert.equal(atualizado?.broker, "PagBank");
  assert.equal(updateInstrumentInvestor(db, "nao-existe", "Beto"), undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | tail -20`
Expected: falha em `updateInstrumentInvestor is not a function` (ou `undefined`); demais verdes.

- [ ] **Step 3: Implement**

Em `src/db/repos.ts`, logo depois de `getInstrumentByLegacyKey`:

```ts
export function updateInstrumentInvestor(db: Db, id: string, investor: string): InstrumentRow | undefined {
  db.prepare("UPDATE instruments SET investor = ? WHERE id = ?").run(investor, id);
  return getInstrument(db, id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test 2>&1 | tail -20`
Expected: **171 testes** verdes (170 + 1).

- [ ] **Step 5: Commit**

```bash
git add src/db/repos.ts src/db/repos.test.ts
git commit -m "feat: repo atualiza investidor de instrumento"
```

---

### Task 2: Serviço/rota — `/api/portfolio` expõe `investor`

**Files:**
- Modify: `src/services/portfolio.ts:10-21,68-72`, `src/api/routes/portfolio.ts` (mapeamento de positions, ~linha 26)
- Test: `src/services/portfolio.test.ts`, `src/api/app.test.ts:235`

**Interfaces:**
- Consumes: `InstrumentRow.investor` (Task 1, já existente).
- Produces: `PortfolioPosition.investor: string | null`; JSON de `/api/portfolio` com `investor` por posição (aditivo).

- [ ] **Step 1: Write the failing test**

Adicionar ao fim de `src/services/portfolio.test.ts`:

```ts
test("portfolio expõe investor da posição, inclusive nulo", () => {
  const db = openDb(":memory:");
  migrate(db);
  const semInvestidor: InstrumentRow = {
    ...cdb, id: "cdb-sem-investidor", legacyKey: "CDB Sem", name: "CDB Sem", investor: null,
  };
  insertInstruments(db, [cdb, semInvestidor]);
  const portfolio = buildPortfolio(db, { now: NOW });
  assert.equal(portfolio.positions.find((p) => p.instrumentId === "cdb-1")?.investor, "Ana");
  assert.equal(portfolio.positions.find((p) => p.instrumentId === "cdb-sem-investidor")?.investor, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | tail -20`
Expected: falha `undefined !== 'Ana'` no primeiro assert.

- [ ] **Step 3: Implement**

Em `src/services/portfolio.ts`:

1. `PortfolioPosition` ganha o campo (depois de `objective`):

```ts
  investor: string | null;
```

2. No objeto retornado por `instruments.map` (~linha 69), acrescentar:

```ts
      investor: instrument.investor,
```

Em `src/api/routes/portfolio.ts`, no mapeamento de `positions`, acrescentar:

```ts
        investor: position.investor,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test 2>&1 | tail -20`
Expected: **172 testes** verdes (171 + 1).

- [ ] **Step 5: Cobertura da rota**

Em `src/api/app.test.ts`, no teste "rotas de portfolio, history e allocation respondem em centavos", logo após `assert.equal(portfolio.positions[0].priceSource, "bcb");` (linha ~235), acrescentar:

```ts
  assert.equal(portfolio.positions[0].investor, "Ana");
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npm test 2>&1 | tail -20 && npm run typecheck`
Expected: 172 verdes; typecheck limpo.

- [ ] **Step 7: Commit**

```bash
git add src/services/portfolio.ts src/api/routes/portfolio.ts src/services/portfolio.test.ts src/api/app.test.ts
git commit -m "feat: portfolio expoe investidor da posicao"
```

---

### Task 3: Rota — `PATCH /api/instruments/:id`

**Files:**
- Modify: `src/api/routes/instruments.ts` (arquivo inteiro, 23 linhas)
- Test: `src/api/app.test.ts`

**Interfaces:**
- Consumes: `updateInstrumentInvestor` (Task 1).
- Produces: `PATCH /api/instruments/:id`, body estrito `{ investor: "Ana" | "Beto" }`; 200 com instrumento no shape de `GET /api/instruments`; 400 (body ausente/não-objeto, chave extra, valor fora do enum); 404 id inexistente.

- [ ] **Step 1: Write the failing tests**

Adicionar ao fim de `src/api/app.test.ts`:

```ts
test("PATCH /api/instruments/:id corrige o investidor", async () => {
  const db = openDb(":memory:");
  migrate(db);
  seedPortfolio(db);
  const app = buildApp({ db, csvDir: csvDirFixture(), logger: false });

  const res = await app.inject({ method: "PATCH", url: `/api/instruments/${cdbInstrument.id}`, payload: { investor: "Beto" } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().investor, "Beto");
  assert.equal(res.json().rateE6, 1_000_000, "demais campos intactos");

  const portfolio = (await app.inject({ method: "GET", url: "/api/portfolio" })).json();
  const posicao = portfolio.positions.find((p: { instrumentId: string }) => p.instrumentId === cdbInstrument.id);
  assert.equal(posicao.investor, "Beto");

  await app.close();
});

test("PATCH /api/instruments/:id rejeita corpo inválido", async () => {
  const db = openDb(":memory:");
  migrate(db);
  seedPortfolio(db);
  const app = buildApp({ db, csvDir: csvDirFixture(), logger: false });
  const url = `/api/instruments/${cdbInstrument.id}`;

  const invalidos: unknown[] = [
    { investor: "Ambos" }, { investor: "gustavo" }, { investor: "" }, { investor: 1 },
    { investor: "Ana", extra: true }, {},
  ];
  for (const payload of invalidos) {
    const res = await app.inject({ method: "PATCH", url, payload });
    assert.equal(res.statusCode, 400, JSON.stringify(payload));
  }
  const semCorpo = await app.inject({ method: "PATCH", url });
  assert.equal(semCorpo.statusCode, 400);

  await app.close();
});

test("PATCH /api/instruments/:id responde 404 para ativo inexistente", async () => {
  const db = openDb(":memory:");
  migrate(db);
  const app = buildApp({ db, csvDir: csvDirFixture(), logger: false });
  const res = await app.inject({ method: "PATCH", url: "/api/instruments/nao-existe", payload: { investor: "Beto" } });
  assert.equal(res.statusCode, 404);
  await app.close();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | tail -30`
Expected: 3 falhas (404 em vez de 200/400 no PATCH — rota inexistente).

- [ ] **Step 3: Implement**

Reescrever `src/api/routes/instruments.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/index.ts";
import type { InstrumentRow } from "../../db/repos.ts";
import { listInstruments, listTransactionsByInstrument, updateInstrumentInvestor } from "../../db/repos.ts";
import { toNumberSafe } from "../../domain/money.ts";

const INVESTORS = ["Ana", "Beto"] as const;

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

export function registerInstrumentsRoutes(app: FastifyInstance, db: Db): void {
  app.get("/api/instruments", () => listInstruments(db).map(toApiInstrument));

  app.patch<{ Params: { id: string }; Body: unknown }>("/api/instruments/:id", (request, reply) => {
    const body = request.body;
    if (body === null || body === undefined || typeof body !== "object" || Array.isArray(body)) {
      return reply.code(400).send({ error: "corpo deve ser { investor }" });
    }
    const keys = Object.keys(body);
    if (keys.length !== 1 || keys[0] !== "investor") {
      return reply.code(400).send({ error: "corpo deve conter apenas investor" });
    }
    const investor = (body as { investor?: unknown }).investor;
    if (typeof investor !== "string" || !(INVESTORS as readonly string[]).includes(investor)) {
      return reply.code(400).send({ error: "investor deve ser Ana ou Beto" });
    }
    const updated = updateInstrumentInvestor(db, request.params.id, investor);
    if (updated === undefined) {
      return reply.code(404).send({ error: "instrumento não encontrado" });
    }
    return toApiInstrument(updated);
  });

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

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test 2>&1 | tail -20 && npm run typecheck`
Expected: **175 testes** verdes (172 + 3); typecheck limpo.

- [ ] **Step 5: Commit**

```bash
git add src/api/routes/instruments.ts src/api/app.test.ts
git commit -m "feat: rota para corrigir investidor do ativo"
```

---

### Task 4: Web — filtro de investidor na tela Posições

**Files:**
- Modify: `web/src/api.ts:74-80`, `web/src/views/PositionsView.tsx:26-34,64-79,95-134`

**Interfaces:**
- Consumes: JSON de `/api/portfolio` com `investor` (Task 2).
- Produces: `PortfolioPosition.investor: string | null` no client; `select` "Investidor" nos filtros (Todos + valores distintos, `—` para nulo).

- [ ] **Step 1: Atualizar o tipo**

Em `web/src/api.ts`, `PortfolioPosition` ganha o campo (depois de `objective`):

```ts
  investor: string | null;
```

- [ ] **Step 2: Estado + opções + filtro**

Em `web/src/views/PositionsView.tsx`:

1. Depois de `const [objetivo, setObjetivo] = useState("todos");` (linha ~31):

```tsx
  const [investidor, setInvestidor] = useState("todos");
```

2. Depois de `const objetivos = useMemo(...)` (linha ~65):

```tsx
  const investidores = useMemo(
    () => [...new Set((posicoes ?? []).map((posicao) => posicao.investor ?? "—"))].sort(),
    [posicoes],
  );
```

3. Na cadeia de `.filter` de `visiveis` (depois do filtro de objetivo, linha ~72):

```tsx
    .filter((posicao) => investidor === "todos" || (posicao.investor ?? "—") === investidor)
```

4. No card de filtros, depois do `label` de Objetivo (linha ~123):

```tsx
        <label className="campo">
          <span className="stat-label">Investidor</span>
          <select value={investidor} onChange={(evento) => setInvestidor(evento.target.value)}>
            <option value="todos">Todos</option>
            {investidores.map((valor) => <option key={valor} value={valor}>{valor}</option>)}
          </select>
        </label>
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build:web`
Expected: limpo e build ok.

- [ ] **Step 4: Verificar no browser**

Com a API no Docker (`docker compose up -d --build`, ~1 min; rebuild é do commit da Task 3) e `npm run dev:web` de pé, abrir `http://localhost:5173`.

Checklist: filtro **Investidor** lista `Todos · Ambos · Ana · Beto`; selecionar `Ana` → "26 de 48 ativos"; `Beto` → "18 de 48"; `Ambos` → "4 de 48"; `Todos` → 48. Screenshot: `.superpowers/sdd/inv-01-filtro.png`.

- [ ] **Step 5: Commit**

```bash
git add web/src/api.ts web/src/views/PositionsView.tsx
git commit -m "feat: filtro de investidor na tela Posicoes"
```

---

### Task 5: Web — editor de investidor no painel do ativo

**Files:**
- Modify: `web/src/api.ts` (após `getTransactions`, ~linha 156), `web/src/views/PositionsView.tsx:1-4,33-34,160,192-237`, `web/src/styles.css` (perto de `.campo`, linha ~720)

**Interfaces:**
- Consumes: `PATCH /api/instruments/:id` (Task 3), `apiErrorMessage` (interno de `api.ts`).
- Produces: `Investor = "Ana" | "Beto"` e `patchInvestor(id, investor): Promise<void>`; editor no painel com `Salvar` desabilitado sem mudança, aviso do import, erro `role="alert"` e sucesso `aria-live`.

- [ ] **Step 1: Client da rota**

Em `web/src/api.ts`, depois de `getTransactions`:

```ts
export type Investor = "Ana" | "Beto";

export async function patchInvestor(id: string, investor: Investor): Promise<void> {
  const response = await fetch(`/api/instruments/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ investor }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(await apiErrorMessage(response, body));
  }
}
```

- [ ] **Step 2: Estados e handlers em `PositionsView.tsx`**

1. Imports (linha 3):

```tsx
import { getPortfolio, getTransactions, patchInvestor, type Investor, type PortfolioPosition, type Transaction } from "../api.ts";
```

2. Constante module-level (depois de `ROTULO_OPERACAO`, linha ~21):

```tsx
const INVESTIDORES: Investor[] = ["Ana", "Beto"];
```

3. Estados (depois de `const [transacoes, setTransacoes] = useState<Transaction[] | null>(null);`, linha ~34):

```tsx
  const [investidorRascunho, setInvestidorRascunho] = useState("");
  const [salvandoInvestidor, setSalvandoInvestidor] = useState(false);
  const [feedbackInvestidor, setFeedbackInvestidor] = useState<{ tipo: "ok" | "erro"; mensagem: string } | null>(null);
```

4. Handlers (antes do `return`, depois do `useMemo` de `investidores`):

```tsx
  function abrirAtivo(posicao: PortfolioPosition) {
    setSelecionada(posicao);
    setInvestidorRascunho(posicao.investor ?? "");
    setFeedbackInvestidor(null);
  }

  async function salvarInvestidor() {
    if (selecionada === null || investidorRascunho === "") return;
    setSalvandoInvestidor(true);
    setFeedbackInvestidor(null);
    try {
      await patchInvestor(selecionada.instrumentId, investidorRascunho as Investor);
      const atualizada = { ...selecionada, investor: investidorRascunho };
      setPosicoes((antigas) => (antigas ?? []).map((posicao) =>
        posicao.instrumentId === atualizada.instrumentId ? atualizada : posicao));
      setSelecionada(atualizada);
      setFeedbackInvestidor({ tipo: "ok", mensagem: "Investidor atualizado" });
    } catch (cause) {
      setFeedbackInvestidor({ tipo: "erro", mensagem: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setSalvandoInvestidor(false);
    }
  }

  const opcoesInvestidor = selecionada !== null && selecionada.investor !== null && !INVESTIDORES.includes(selecionada.investor as Investor)
    ? [selecionada.investor, ...INVESTIDORES.map((valor) => valor as string)]
    : INVESTIDORES.map((valor) => valor as string);
  const mudouInvestidor = selecionada !== null && investidorRascunho !== (selecionada.investor ?? "");
```

5. Linha da tabela usa o novo handler (linha ~160):

```tsx
                  <tr key={posicao.instrumentId} onClick={() => abrirAtivo(posicao)} className="linha-clicavel">
```

6. Chip no painel, depois do chip de classe (linha ~203):

```tsx
            <span className="chip">{selecionada.investor ?? "sem investidor"}</span>
```

7. Bloco do editor, entre `</p>` dos chips e `<div className="stats">` (linha ~204):

```tsx
          <div className="campo">
            <span className="stat-label">Investidor</span>
            <div className="investidor-opcoes">
              <select value={investidorRascunho} onChange={(evento) => setInvestidorRascunho(evento.target.value)} aria-label="Investidor do ativo">
                {investidorRascunho === "" && <option value="" disabled>—</option>}
                {opcoesInvestidor.map((valor) => <option key={valor} value={valor}>{valor}</option>)}
              </select>
              <button type="button" className="btn btn-secondary" disabled={!mudouInvestidor || salvandoInvestidor || investidorRascunho === ""} onClick={salvarInvestidor}>
                {salvandoInvestidor ? "Salvando..." : "Salvar"}
              </button>
            </div>
            <span className="stat-note">Correções valem até o próximo import — a planilha sobrescreve.</span>
            {feedbackInvestidor !== null && (
              <span
                className={feedbackInvestidor.tipo === "ok" ? "stat-note" : "campo-erro"}
                role={feedbackInvestidor.tipo === "erro" ? "alert" : undefined}
                aria-live="polite"
              >
                {feedbackInvestidor.mensagem}
              </span>
            )}
          </div>
```

- [ ] **Step 3: CSS**

Em `web/src/styles.css`, depois do bloco `.campo { ... }` (linha ~717):

```css
.investidor-opcoes { display: flex; align-items: center; gap: 8px; }
.campo-erro { color: var(--danger); font-size: 12px; }
```

- [ ] **Step 4: Typecheck + build + browser**

Run: `npm run typecheck && npm run build:web`
Expected: limpo e build ok.

Com `npm run dev:web` aberto em `http://localhost:5173`:

1. Posições → filtro **Investidor: Ambos** → abrir um ativo; painel mostra chip do investidor, select e aviso do import.
2. Trocar para `Ana` → `Salvar` habilita → clicar → "Investidor atualizado"; a lista reflete o novo investidor e o filtro `Ambos` cai para 3 (o ativo sai da lista).
3. Recarregar a página → a mudança persistiu.
4. Forçar erro: com `docker compose stop app` (API fora), tentar salvar → erro inline `role="alert"`; `docker compose start app` depois.

Screenshot: `.superpowers/sdd/inv-02-editor.png`. O dado real será restaurado na Task 6.

- [ ] **Step 5: Commit**

```bash
git add web/src/api.ts web/src/views/PositionsView.tsx web/src/styles.css
git commit -m "feat: correcao de investidor no painel do ativo"
```

---

### Task 6: Verificação real + fechamento do ROADMAP

**Files:**
- Modify: `ROADMAP.md`

**Interfaces:**
- Consumes: tudo das tasks 1–5.
- Produces: etapa marcada como concluída com evidências (contagens por investidor, overwrite do import, reconciliação intocada); próxima ação apontada.

- [ ] **Step 1: Suite e build**

Run: `npm test && npm run typecheck && npm run build:web`
Expected: **175 testes** verdes, typecheck limpo, build ok.

- [ ] **Step 2: Docker**

Run: `docker compose up -d --build && sleep 10 && curl -s localhost:3000/api/health`
Expected: container `healthy`; `/api/health` com `sources` sem erro.

- [ ] **Step 3: Aceite com dados reais**

```bash
curl -s localhost:3000/api/instruments | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);const m={};for(const i of j)m[i.investor??'(nulo)']=(m[i.investor??'(nulo)']??0)+1;console.log(m)})"
```

Expected: `{ Ana: 26, 'Beto': 18, Ambos: 4 }` (+ `(nulo)` se houver).

```bash
AMBOS=$(curl -s localhost:3000/api/instruments | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log((j.find(i=>i.investor==='Ambos')??{}).id??'')})")
curl -s -X PATCH "localhost:3000/api/instruments/$AMBOS" -H 'content-type: application/json' -d '{"investor":"Ana"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.id,j.investor)})"
```

Expected: o id do primeiro ativo `Ambos` com `investor Ana` (a correção é real e será desfeita no próximo passo).

```bash
curl -s -X POST localhost:3000/api/import -H 'content-type: application/json' -d '{}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('errors',j.errors.length,'instruments',j.instruments)})"
curl -s localhost:3000/api/instruments | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);const m={};for(const i of j)m[i.investor??'(nulo)']=(m[i.investor??'(nulo)']??0)+1;console.log(m)})"
```

Expected: import sem erros; contagens **de volta** a `{ Ana: 26, 'Beto': 18, Ambos: 4 }` — prova do overwrite.

```bash
curl -s "localhost:3000/api/reconciliation?month=2026-09&asOf=2026-09-16" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('reference',j.totals.referenceCents,'unexplained',j.unexplained)})"
```

Expected: `reference <valor> unexplained 0`.

- [ ] **Step 4: Browser final (`:3000`)**

Abrir `http://localhost:3000`: filtro de investidor com as 3 opções e o editor no painel (select + aviso). Screenshot `.superpowers/sdd/inv-03-final.png`.

- [ ] **Step 5: Atualizar o ROADMAP**

- Tabela "Estado atual": nova linha `| Carteira por investidor (filtro + correção) | concluída — merge local na main (branch carteira-por-investidor) |`.
- Evidências: bullet com 175 testes, contagens 26/18/4, prova do overwrite no import, reconciliação `<valor>`/`0`, screenshots.
- "Próxima ação": apontar **v2 (CRUD)** como próximo brainstorming; citar que a rota `PATCH /api/instruments/:id` já é o embrião.

- [ ] **Step 6: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: fecha etapa carteira por investidor no roadmap"
```

---

## Notas de execução

- A correção feita no browser durante a Task 5 é dado real; a Task 6 a restaura via import (comportamento aprovado).
- `investor` não entra em valuation/TWR/MWR/reconciliação: nenhum número muda com o filtro ou com a correção.
- Se a planilha trouxer um valor fora do enum, ele aparece no filtro e como valor atual do select (dá para sair dele, não para gravá-lo).
- Merge ff na `main` ao final; atualizar o ROADMAP no mesmo merge.
