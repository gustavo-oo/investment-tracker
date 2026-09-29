# Handoff — pendências da S6 (dashboard + reconciliação)

**Para a próxima sessão:** este documento é o ponto de partida. A S6 está **mergeada e funcionando**; o que resta são 4 decisões e uma lista de follow-ups menores. Leia o `ROADMAP.md` (fonte de prioridades) e o ledger `.superpowers/sdd/progress.md` (histórico por task, com os minors originais) antes de agir.

## Estado ao encerrar (2026-09-21)

- `main` em `1ff9cb8` (branch `s6-dashboard-reconciliacao` mergeada e apagada). 137/137 testes verdes, typecheck limpo, `build:web` ok.
- Aceite real: `GET /api/reconciliation?month=2026-09&asOf=2026-09-16` → legado R$ <valor> referência R$ <valor> `unexplained = 0`; visão ao vivo e 2025-12/2026-03 também 0.
- B5P211 reparado (0 linhas em R$ <valor>; 9 pontos mensais da Alpha Vantage); reparo automático roda pós-refresh.
- Docker de pé em `:3000` com o código da S6. `data/` e `.env` (chave Alpha Vantage) são gitignored.

## Decisões pendentes (precisam de resposta antes de codar)

| # | Tema | Opções |
|---|---|---|
| 1 | Loop duplicado `fetchDaily`/`fetchMonthly` (`src/sources/alphavantage.ts`) | (a) extrair helper `fetchSeries(kind, série, url)` (~15 min); (b) manter como está (o plano mandava assim) |
| 2 | Gráfico: índice CDI/IPCA atrasa 1 mês vs linha da carteira (`DashboardView.tsx` `base100`) | (a) alinhar ao card (acumular a taxa do mês antes de plotar; muda o número do gráfico); (b) manter e documentar no hint |
| 3 | `web/dist` versionado está defasado (Docker rebuilda; `npm start` no host serve a UI antiga) | (a) rebuild + commit; (b) adicionar ao `.gitignore` e destrackear |
| 4 | `main` está ~20 commits à frente do `origin/main` | (a) `git push`; (b) deixar local |

## Follow-ups (menores, sem bloqueio) — agrupar num único batch

**Backend/correção (rápidos):**

1. `referenceCents` soma resíduo **+1¢** do legado (`reconciliation.ts`): zerar também `legacyCents <= 1n` na referência.
2. `isDate` aceita data inválida (`2026-09-31`) e `isMonth` está duplicado de `portfolio.ts` (`api/routes/reconciliation.ts`): validar calendário e compartilhar o helper.
3. CLI `npm run backfill` valida só presença dos args e não tem try/catch (`src/backfill-cli.ts`): validar formato e imprimir erro de uma linha.
4. Reparo de trecho em **mês fechado** que falha retenta a cada 10 min (cota AV): considerar memoizar tentativa por dia/ticker (como o fallback do Yahoo faz em `refresh-quotes.ts`).
5. `hasTransactionAfter` é O(n·m) (`reconciliation.ts`): pré-agrupar por instrumento se virar problema.

**Testes que faltam (pequenos):**

1. Fronteiras exatas das tolerâncias: 0,5% (`data-de-referencia`) e 5% (`cotacao-fora-da-janela`).
2. `AMORTIZATION` na zeragem de resíduo (`domain/position.ts`) e ramo `ourCents !== 0n` na reconciliação.
3. Reparo em `quotesOnly` e erro de reparo aparecendo na resposta de `POST /api/refresh`.
4. Rota `/api/reconciliation` sem `month`/`asOf` (defaults).

**Web/polish:**

1. `.alloc-row` sem regra CSS; badge `stale` em inglês (usar "desatualizado").
2. `marketValueCents === null` renderiza `R$ <valor>` na tabela (mostrar "—" + stale).
3. `RefreshResult` descartado: mostrar erro por fonte após o refresh manual.
4. Sem cancelamento de request no intervalo de 5 min (`DashboardView.tsx`).
5. `.chart-placeholder` CSS morto (`styles.css`); contraste do CDI no dark mode (~2,5:1).
6. Bundle ~648 kB (Recharts): aceitável; lazy-load se incomodar.

## Como executar (padrão bento, igual à S6)

1. Decidir os 4 itens da tabela (uma resposta curta por item).
2. Se virar mais que ajuste: spec curta em `docs/superpowers/specs/` + plano em `docs/superpowers/plans/`; senão, batch direto com TDD.
3. Fluxo: TDD task a task → `npm test && npm run typecheck && npm run build:web` → Docker → atualizar `ROADMAP.md`.
4. Referências: spec da S6 (`docs/superpowers/specs/2026-09-21-s6-dashboard-reconciliacao-design.md`), plano (`docs/superpowers/plans/2026-09-21-s6-dashboard-reconciliacao.md`) e ledger `.superpowers/sdd/progress.md`.

**Estimativa do batch completo (sem os 4 itens de decisão):** ~1h30–2h.
**Depois das pendências:** iniciar a v2 (CRUD de transações/ativos) com `brainstorming` — é a próxima fase do `ROADMAP.md`.
