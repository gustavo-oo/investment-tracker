# Refino visual do Rebalanceamento (colunas alinhadas + aporte transiente)

**Resumo:** reorganiza a tela aprovada na variação A do brainstorming: **Metas** com largura do próprio conteúdo (título no topo, controles na base), **aporte + Patrimônio total depois** ocupando o resto da linha na mesma base dos controles, cartões RF/RV com "Investir" em herói e linhas `Valor`/`Participação`; legendas redundantes saem; o aporte deixa de ser persistido e o total pós-aporte ganha destaque.

**Depende de:** feature de rebalanceamento (merge `4c6b6cb`), `/api/portfolio` (`totals.marketValueCents`), `toNumberSafe`, tokens/classes existentes de `web/src/styles.css`.

**Não faz parte:** mudança de fórmula, metas ou recorte da reserva; sugestão por ativo; projeção até 2099; remoção do rodapé "Base do cálculo" (fica).

## Decisões do brainstorming (2026-09-25)

| Tema | Decisão |
|---|---|
| Layout do topo | **Variação A** (mockup em `.superpowers/sdd/reb-final.png`; comparação A/B/C em `reb-variacoes2.png`): Metas com largura do conteúdo + card de aporte/total com o resto, **mesma altura** |
| Alinhamento | controles das metas, campo de aporte e número do total na **mesma linha de base** |
| Título | "Metas" no mesmo tamanho dos títulos dos cards (`15px`) |
| Legendas | remover "fora da reserva: …" e "hoje … + aporte … · inclui a reserva de emergência"; rodapé "Base do cálculo: …" **fica** |
| Aporte | **transiente**: nunca persiste, começa vazio a cada visita; `PUT` salva só as metas |
| Total | "Patrimônio total depois" = total do `/api/portfolio` (**com reserva**) + aporte, em destaque (30 px) à direita |
| Cartões RF/RV | lado a lado (2 colunas); herói "Investir"; badge `meta X%`; linhas `Valor` e `Participação` com antes → depois |

## Problema (v1 da tela)

A primeira versão (merge `4c6b6cb`) tinha hierarquia confusa dentro dos cartões (trio "Hoje/Alvo/Depois" + valores duplicados na mesma linha), um botão "Salvar metas" que também persistia o aporte (confundindo as ações) e o pós-investimento aparecia só como legenda pequena ("carteira fora da reserva"), sem o saldo total.

## Regra

Sem mudança na fórmula/recorte: base sem reserva, previdência e `etf_fixed` como RF, water-filling para 2 grupos — tudo como na spec `2026-09-25-rebalanceamento-design.md`.

## API

- `GET /api/rebalance?amountCents&rfE6&rvE6` — resposta ganha **`portfolioTotalCents`** (patrimônio total, inclui a reserva; de `portfolio.totals.marketValueCents`, `toNumberSafe`). Sem `amountCents` na query → **0** (não lê mais o valor do banco).
- `PUT /api/rebalance` — corpo passa a ser **`{ rfE6, rvE6 }`** (sem `amountCents`); resposta `{ rfE6, rvE6, updatedAt }`; validações de 400 mantidas.
- Migration `src/db/migrations/005_remove_rebalance_amount.sql`: `ALTER TABLE rebalance_targets DROP COLUMN amount_cents;`.
- `src/db/repos.ts`: `getRebalanceTargets`/`saveRebalanceTargets` sem `amountCents`.
- `src/services/rebalance.ts`: `RebalanceView` ganha `portfolioTotalCents: bigint`; `amountCents` de `deps` continua opcional (query), sem persistência.

## Web

- `web/src/views/RebalanceView.tsx`:
  - Topo: `.reb-topo` com dois cards de mesma altura — Metas (`max-content`) e aporte/total (`1fr`); título e label no topo, controles na base.
  - Aporte transiente: estado local iniciado **vazio**; nunca entra no `PUT`; recarga (debounce ~400 ms) continua usando `GET` com os valores do formulário.
  - Total: `totalDepois = dados.portfolioTotalCents + aporteCents` em `.reb-resumo-total` (número 30 px, mono).
  - Cartões RF/RV: badge `meta {targetE6/10_000}%` no topo; `.reb-hero` com "Investir" + R$ sugerido; linhas `.reb-caminho` `Valor` (R$ antes → depois) e `Participação` (% antes → depois); `aboveTarget` mantém badge âmbar e R$ <valor>
- `web/src/styles.css`: classes novas `.reb-topo`, `.reb-metas-linha`, `.reb-base`, `.reb-hero`, `.reb-caminho`, `.reb-caminho-rotulo`, `.reb-secao-titulo`; media query ≤ 1024 empilha `.reb-topo`/`.reb-grade`.

## Testes

- `src/services/rebalance.test.ts`: seed 80/20 sem aporte; `portfolioTotalCents` = `portfolio.totals.marketValueCents` (inclui reserva); `stale` e agrupamento inalterados.
- `src/api/app.test.ts`: `PUT { rfE6, rvE6 }` persiste e devolve a config; `GET` expõe `portfolioTotalCents`; `GET` sem query usa aporte 0; 400s existentes mantidos.
- `src/db/migrate.test.ts`: 5 migrations; `rebalance_targets` **sem** a coluna `amount_cents` (`PRAGMA table_info`).
- Web sem runner (padrão): `npm run typecheck` + `npm run build:web` + aceite no browser.

## Aceite

- Browser com dados reais (1280/1024, sem overflow): metas 80/20; digitar `<valor>` → "Patrimônio total depois" = total do `/api/portfolio` + <valor> (conferir o número na hora); aporte **começa vazio** em cada visita e não volta no reload; metas persistem; acima da meta (60/40) → badge âmbar + R$ <valor> no grupo.
- Reconciliação inalterada (`<valor>` / `unexplained 0`); `npm test`, typecheck e `build:web` verdes; Docker `healthy`.

## Riscos

- Migration 005 descarta a coluna `amount_cents` (preferência de UI, sem perda de dado relevante).
- `.reb-topo` com `max-content 1fr` depende de largura; em ≤ 1024 os cards empilham (media query).
- O ganho de "menos detalhes" removeu as legendas do total; o rodapé mantém a base do cálculo para auditoria.
