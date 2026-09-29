# Card da reserva de emergência na Visão geral

**Resumo:** a Visão geral ganha um card "Reserva de emergência" no topo da coluna direita, acima de "Onde está o dinheiro": valor somado das posições com objetivo `Reserva`, percentual sobre o patrimônio, número de ativos e barra de proporção. Sem mudança de API — o dado vem do `/api/portfolio` que a tela já carrega.

**Depende de:** `/api/portfolio` expondo `objective` por posição (S4), UI S7 (`web/src/views/OverviewView.tsx`) e classes de estilo existentes (`.card`, `.alloc-bar`).

**Não faz parte:** meta/valor-alvo de reserva (meses de despesa), filtro por objetivo em Posições, clique no card, alerta por reserva abaixo de um limite, mudança de API/banco, CRUD (v2).

## Decisões do brainstorming (2026-09-24)

| Tema | Decisão |
|---|---|
| Conceito | Reserva de emergência = posições com objetivo `Reserva` — mesmo recorte do "RESERVA" do legado (`data/csv/Dashboard.csv`) |
| Posicionamento | Card próprio no topo da coluna direita (mock C escolhido; mockups em `.superpowers/brainstorm/<valor>-<valor>/content/reserva-posicionamento.html`) |
| Conteúdo | Valor em R$ + "% do patrimônio · N ativos" + barra de proporção |
| Interação | Nenhuma (informativo) — Posições ainda não filtra por objetivo |
| Vazio | Sem posições `Reserva`, o card não aparece |
| Fonte | `/api/portfolio` já carregado — sem request/endpoint novo |
| Implementação | Cálculo local na `OverviewView` com constante `OBJETIVO_RESERVA = "Reserva"` |

## Problema

O legado exibia "RESERVA" no topo do dashboard (R$ <valor> no snapshot de set/2026). O app já tem o objetivo no cadastro (`instruments.objective`, importado da planilha) e a alocação por objetivo (`/api/allocation?by=objective`), mas nenhuma leitura destacada da reserva na Visão geral — o número só aparece se o usuário trocar a Alocação para "Objetivo".

## Regra

```
reserva     = Σ marketValueCents das posições com objective === "Reserva"   # null → 0
quantidade  = nº de posições com objective === "Reserva"
pct         = total > 0 ? reserva / total × 100 : 0                         # apresentação
```

- Valores em centavos inteiros (`marketValueCents`); o percentual é cálculo de apresentação, exibido com 1 casa (`44,8%`).
- `quantidade === 0` → card não renderiza; total 0 → `pct` 0.
- Barra com `Math.min(100, pct)`, igual a "Onde está o dinheiro"; sem `aria` próprio (o texto do card cobre a informação).
- Posição `stale` entra com o último valor e `marketValueCents === null` conta 0 — mesma convenção das demais somas da tela.
- Reserva inclui LCA de liquidez não diária: o card reflete o objetivo cadastrado, não reinterpreta liquidez.

## Código

- `web/src/views/OverviewView.tsx`: calcula `reserva` junto de `porClasse` e renderiza `section.card` como primeiro item do `stack` da coluna direita — título "Reserva de emergência", valor em R$ (`formataBRL`), linha secundária `"{pct}% do patrimônio · {N} ativos"` e `.alloc-bar`.
- `web/src/styles.css`: classe nova `.reserva-valor` para o valor do card (mono `var(--font-mono)`, 22px, 600) — distinto do `.stat-value.grande` (34px) do total, como no mock aprovado.
- Sem mudança em API, banco ou `/api/allocation`.

## Testes

- Sem runner no web (padrão do projeto): nenhum teste automatizado novo; `npm test` deve seguir com os 175 verdes.
- Aceite com dados reais (2026-09-24): card mostra `R$ <valor>`, `44,8% do patrimônio`, `44 ativos`, batendo com a soma de `/api/portfolio` (`objective === "Reserva"`; total `R$ <valor>` = <valor> centavos).
- Browser em 1280 e 1024 de largura: card sem overflow e sem colisão com "Onde está o dinheiro"; screenshot em `.superpowers/sdd/`.
- Caso vazio (`quantidade === 0`): verificado por leitura do guard no review (não dá para simular com os dados reais).
- Verificação: `npm test`, `npm run typecheck`, `npm run build:web`; `docker compose up -d --build` + `curl localhost:3000/api/health`.

## Riscos

- O objetivo é texto livre no banco: renomear "Reserva" na planilha faz o card sumir. Mitigação: constante única `OBJETIVO_RESERVA` — ajuste de 1 linha.
- O percentual do card é sobre o patrimônio total da carteira inteira (sem recorte de investidor), consistente com o cabeçalho da tela.
- Duplicidade visual com a Alocação por "Objetivo": aceita — o card é a leitura rápida, a Alocação segue a visão analítica.
