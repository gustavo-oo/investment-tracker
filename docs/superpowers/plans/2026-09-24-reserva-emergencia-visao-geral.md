# Card da reserva de emergência na Visão geral — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** exibir o valor da reserva de emergência (posições com objetivo `Reserva`) num card próprio no topo da coluna direita da Visão geral.

**Architecture:** cálculo local no `OverviewView.tsx` a partir do `/api/portfolio` que a tela já carrega — sem request, endpoint ou estado novos. O card reusa as classes existentes (`.card`, `.section-title`, `.alloc-bar`) e ganha duas classes pequenas no `styles.css` (`.reserva-valor`, `.reserva-sub`). Spec: `docs/superpowers/specs/2026-09-24-reserva-emergencia-visao-geral-design.md`.

**Tech Stack:** React 19 + TypeScript, Vite 8, CSS puro em `web/src/styles.css`.

## Global Constraints

- Zero `float` em dado persistido/cálculo: somas em centavos inteiros; `Number` só na borda de apresentação (percentual).
- Artefatos e commits em pt-BR; commits convencionais sem acento (`feat:`, `docs:`).
- Web não tem runner de testes: nenhum teste automatizado novo — verificação por `npm run typecheck`, `npm run build:web` e browser com dados reais (precedente: S7 e carteira por investidor).
- `package-lock.json` não muda nesta branch (sincroniza no trunk).
- Texto de UI em pt-BR com plural correto ("1 ativo" / "44 ativos").

---

### Task 1: Card e cálculo na OverviewView + estilos

**Files:**
- Modify: `web/src/views/OverviewView.tsx` (constante ~linha 31; cálculo após `porClasse` ~linha 106; JSX na coluna direita ~linha 193)
- Modify: `web/src/styles.css` (após o bloco `.metrica-valor`, ~linha 794)

**Interfaces:**
- Consumes: `Portfolio` de `web/src/api.ts` — `positions[].objective: string | null`, `positions[].marketValueCents: number | null`, `totals.marketValueCents: number`; `formataBRL` de `web/src/format.ts`.
- Produces: nada exportado; `OverviewView` passa a renderizar o card.

- [ ] **Step 1: Adicionar a constante do objetivo**

Em `web/src/views/OverviewView.tsx`, junto de `INICIO_TUDO`:

```tsx
const INICIO_TUDO = "2000-01";
const OBJETIVO_RESERVA = "Reserva";
```

- [ ] **Step 2: Calcular reserva, valor e percentual**

Logo depois do bloco `const porClasse = ORDEM_CLASSE.map(...)` (termina na linha ~106):

```tsx
  const posicoesReserva = portfolio.positions.filter((posicao) => posicao.objective === OBJETIVO_RESERVA);
  const reservaCents = posicoesReserva.reduce((total, posicao) => total + (posicao.marketValueCents ?? 0), 0);
  const reservaPct = portfolio.totals.marketValueCents > 0 ? (reservaCents / portfolio.totals.marketValueCents) * 100 : 0;
```

- [ ] **Step 3: Renderizar o card como primeiro item da coluna direita**

Na linha ~193, o `<div className="stack">` da coluna direita abre logo antes de "Onde está o dinheiro". Inserir o card antes da `<section>` existente:

```tsx
        <div className="stack">
          {posicoesReserva.length > 0 && (
            <section className="card">
              <div className="section-head"><h2 className="section-title">Reserva de emergência</h2></div>
              <p className="reserva-valor">{formataBRL(reservaCents)}</p>
              <p className="reserva-sub">
                {reservaPct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% do patrimônio · {posicoesReserva.length} {posicoesReserva.length === 1 ? "ativo" : "ativos"}
              </p>
              <span className="alloc-bar"><span className="alloc-bar-fill" style={{ width: `${Math.min(100, reservaPct)}%` }} /></span>
            </section>
          )}

          <section className="card">
            <div className="section-head"><h2 className="section-title">Onde está o dinheiro</h2></div>
```

- [ ] **Step 4: Adicionar as classes no styles.css**

Em `web/src/styles.css`, imediatamente depois do bloco `.metrica-valor { ... }` (termina na linha ~794):

```css
.reserva-valor {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.reserva-sub {
  margin: 2px 0 10px;
  font-size: 12px;
  color: var(--text-3);
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: sem erros.

- [ ] **Step 6: Build do web**

Run: `npm run build:web`
Expected: build ok (warning conhecido de chunk > 500 kB é aceitável).

- [ ] **Step 7: Testes do backend inalterados**

Run: `npm test`
Expected: `# tests 175` / `# pass 175` / `# fail 0`.

- [ ] **Step 8: Commit**

```bash
git add web/src/views/OverviewView.tsx web/src/styles.css
git commit -m "feat: card da reserva de emergencia na visao geral"
```

---

### Task 2: Aceite no browser com dados reais

**Files:**
- Nenhum arquivo de código (verificação); screenshot em `.superpowers/sdd/reserva-01-visao-geral.png`

**Interfaces:**
- Consumes: container `investment-tracker-app-1` em `localhost:3000` com dados reais; Vite dev na worktree (`npm run dev:web`, porta 5173, proxy `/api` → 3000).
- Produces: evidência de aceite (screenshot + valores conferidos).

- [ ] **Step 1: Conferir a API real**

Run:

```bash
curl -s localhost:3000/api/portfolio | python3 -c "
import json,sys
d=json.load(sys.stdin)
r=[p for p in d['positions'] if p['objective']=='Reserva']
s=sum(p['marketValueCents'] or 0 for p in r)
print(len(r), s, round(s/d['totals']['marketValueCents']*100,1))
"
```

Expected (2026-09-24): `44 <valor> 44.8`. Se o container tiver atualizado cotações depois, os valores podem variar — o critério é o card bater com a API **no momento da conferência**, não com este número fixo.

- [ ] **Step 2: Abrir a UI da worktree**

Run: `npm run dev:web` (na worktree) e abrir `http://localhost:5173`.
Expected: card "Reserva de emergência" no topo da coluna direita, acima de "Onde está o dinheiro", com `R$ <valor>`, `44,8% do patrimônio · 44 ativos` e barra de ~45% preenchida.

- [ ] **Step 3: Conferir responsividade e ausência de overflow**

Em 1280 e 1024 de largura:

```js
document.documentElement.scrollWidth === window.innerWidth
```

Expected: `true` nas duas larguras; card sem colisão com "Onde está o dinheiro".

- [ ] **Step 4: Screenshot**

Salvar screenshot da Visão geral em `.superpowers/sdd/reserva-01-visao-geral.png`.

- [ ] **Step 5 (após o merge, no checkout principal): Docker**

Run (no checkout principal, não na worktree — a porta 3000 já está em uso): `docker compose up -d --build` e `curl localhost:3000/api/health`.
Expected: container `healthy`, health sem erro de fonte.

---

## Verificação final da branch

```bash
npm test && npm run typecheck && npm run build:web
```

Expected: 175 testes verdes, typecheck limpo, build ok. Depois: merge local na `main` (padrão do projeto) e atualização do `ROADMAP.md`.
