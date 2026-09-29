# S7 — Redesign da interface (cozy, setorizado, leitura clara)

**Resumo:** refazer a interface do app para uso diário: paleta clara e quente ("Papel quente"), navegação em barra lateral com 5 seções, Visão geral em duas colunas (patrimônio + evolução à esquerda; setores, rendimento e fontes à direita), gráfico de evolução com abas **R$** e **% vs CDI/IPCA** (mês a mês e acumulado) e período 1 ano · 5 anos · Tudo, lista de ativos fora da tela principal (seção Posições) e reconciliação movida para a seção Fontes. Inclui uma camada de cálculo nova (`/api/performance`): retorno mensal da carteira (TWR), acumulado da janela, diferença em p.p. contra CDI/IPCA e rentabilidade ponderada pelo capital (MWR).

**Depende de:** S2–S6 concluídas (import, cotações, previdência, portfolio, history, allocation, reconciliation).

**Não faz parte:** CRUD (v2); projeção/rebalanceamento; publicação no GHCR; variação do dia ("hoje") nos cards — exigiria persistir o fechamento anterior de cada ativo; reagrupar o gráfico por outro critério que não mês/trimestre; tema escuro (decidido: só Papel quente).

## Decisões do brainstorming (2026-09-21)

| Tema | Decisão |
|---|---|
| Paleta | **A · Papel quente**: fundo creme, texto marrom-escuro, verde-sálvia no destaque. Sem variante escura — o app fica sempre claro, mesmo com o sistema em dark. |
| Shell | Barra lateral com 5 seções; Visão geral em **duas colunas** (números e gráfico à esquerda; contexto à direita). |
| Gráfico | Abas **R$** e **%**. Dentro de %: sub-abas **"Mês a mês"** (barras carteira × CDI × IPCA) e **"Acumulado"** (3 linhas + diferença em p.p. + meses que bateu o CDI). Sem base 100. |
| Período | **1 ano** (padrão) · 5 anos · Tudo, aplicado às abas; a janela efetiva fica escrita na tela. |
| Posições | Fora da tela principal: busca, filtros (setor/corretora/objetivo), ordenação e painel do ativo com as transações (leitura). |
| Reconciliação | Sai da tela principal; passa para a seção **Fontes**. |
| Extras aceitos | Card "Meu dinheiro rendeu" (MWR) na Visão geral e gráfico "De onde veio o crescimento" (aporte × rendimento) na Evolução. |
| Mapa de seções | **5 seções**: Visão geral · Posições · Evolução · Importar · Fontes. |

## Problemas da interface atual (por que refazer)

1. **Escuro demais e monótono** — `prefers-color-scheme: dark` pinta fundo quase preto com texto claro; as duas variantes usam cinzas frios e sem hierarquia.
2. **Tudo numa página só** — cards, tabela dos 48 ativos, alocação, gráfico e reconciliação empilhados; nada é "o principal".
3. **Gráfico em base 100 confuso** — 3 linhas sem significado no eixo ("112" é o quê?), tooltip misturando R$ e %, sem período selecionável.
4. **R$ sem contexto de aporte** — os saltos do patrimônio são aportes, mas o gráfico não mostra isso; a leitura vira "rendeu muito" quando foi dinheiro novo.
5. **% única esconde o período** — nos últimos 12 meses a carteira está empatada com o CDI (+0,13 p.p.); desde mai/2025 está +1,18 p.p. à frente.

## Tokens de design (`web/src/styles.css`)

| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#F3EEE6` | fundo da página |
| `--surface` | `#FBF8F3` | cards |
| `--surface-2` | `#EBE4D8` | chips, barras de fundo, cabeçalho |
| `--border` / `--border-strong` | `#DED5C6` / `#CFC4B2` | divisórias |
| `--text` / `--text-2` / `--text-3` | `#2E2A24` / `#6B6355` / `#8C8272` | hierarquia de texto |
| `--accent` / `--accent-soft` | `#3F6B52` / `#DCE8DF` | destaque, série "carteira" |
| `--sand` | `#C9B79A` | barras de aporte, série CDI |
| `--olive` | `#8A8F6B` | série IPCA |
| `--danger` / `--danger-soft` | `#A8452F` / `#F2DED8` | mês abaixo do CDI, erros |
| `--warn` / `--warn-soft` | `#9A6A2A` / `#F6E8D2` | fontes desatualizadas |

- Remover o bloco `@media (prefers-color-scheme: dark)` e qualquer `color-scheme`.
- Tipografia: Geist / Geist Mono (mantidas). Números sempre em `tabular-nums`; patrimônio em ~34px com `letter-spacing: -0.03em`.
- Cantos 10–14px, sombra única e sutil, sem blur/glass.

## Shell e navegação (`web/src/App.tsx`)

- Estado de view: `visao-geral | posicoes | evolucao | importar | fontes`.
- Barra lateral (≥ 900px) com marca, 5 itens e rodapé com o botão **"Atualizar cotações"** (global, `POST /api/refresh`) e o selo "atualizado às HH:MM".
- Item **Fontes** ganha ponto âmbar quando `health.sources.some(s => s.stale)`.
- < 900px: barra lateral vira faixa horizontal no topo (mesmos itens).
- Sem roteamento por URL (estado em memória, como hoje).

## Visão geral (`OverviewView`)

Duas colunas (1.7fr / 1fr), uma coluna < 1000px.

**Esquerda**
1. **Patrimônio**: número grande (`portfolio.totals.marketValueCents`), abaixo "rendimento R$ X (+Y% sobre o capital)" e "em `asOf`".
2. **Evolução**: card do gráfico (aba R$ / %, período, sub-abas) — detalhado abaixo.

**Direita**
3. **Onde está o dinheiro**: 3 blocos por `kind` (renda fixa, renda variável, previdência) com valor, % do total, nº de ativos e barra; clique leva a Posições já filtrado.
4. **Meu dinheiro rendeu** (MWR): % do período + CDI/IPCA do mesmo período + % de 12 meses; subtítulo explicando que cada aporte pesa pelo tempo investido.
5. **Alocação**: um bloco só, com seletor categoria · corretora · objetivo (`/api/allocation?by=`).
6. **Fontes**: contagem ok/desatualizadas e atalho para a seção Fontes.

Regra de cálculo (cliente, sobre `positions`): setor = `kind`; % = `marketValueCents` ÷ total; rendimento = `marketValueCents − (investedCents − redeemedCents)`.

## Gráfico de evolução (`EvolucaoChart`, Recharts)

| Controle | Valores | Efeito |
|---|---|---|
| Período | 1 ano (padrão) · 5 anos · Tudo | define `from`/`to` em `/api/history` e `/api/performance`; a janela efetiva aparece escrita (ex.: "out/2025 → set/2026") |
| Aba | R$ · % | qual gráfico desenha |
| Sub-abas (só em %) | Mês a mês · Acumulado | barras mensais ou linhas acumuladas |

- **R$**: área do patrimônio (`accent`) + barras de aporte (`--sand`) e resgate (`--danger`) por mês, abaixo do eixo. Tooltip: mês, patrimônio, variação, aporte/resgate, rendimento.
- **% · Mês a mês**: barras agrupadas por mês (carteira, CDI, IPCA). A barra da carteira fica `accent` quando `portfolioPct ≥ cdiPct` e `--danger` quando abaixo. Tooltip com os 3 valores e a diferença em p.p.
- **% · Acumulado**: 3 linhas partindo de 0%, rótulo com o valor no fim de cada linha; rodapé com "carteira +X% · CDI +Y% · IPCA +Z%", "diferença vs CDI: ±W p.p." e "bateu o CDI em N de M meses".
- **Agregação**: janela ≤ 24 meses → barras mensais; > 24 meses → barras trimestrais (o rótulo indica "por trimestre"). A linha acumulada é sempre mensal.
- Y do modo % tem 0% fixo (linha tracejada); sem base 100.
- O período escolhido também alimenta o card **"Meu dinheiro rendeu"** (mesma janela) e o rótulo da janela aparece nos dois.
- Revalidação a cada 5 min e botão de refresh mantidos.
- Hoje (dados de 2026-09-21): "5 anos" e "Tudo" mostram a mesma janela (mai/2025 → set/2026), porque o clamp corta no primeiro mês com retorno; quando houver mais histórico os dois se separam sozinhos.

## Performance — domínio, serviço e rota (novo)

**`src/domain/performance.ts`** (puro, sem I/O):

| Função | Regra |
|---|---|
| `monthlyPortfolioPct(prevValueCents, valueCents, investedCents, redeemedCents)` | `(value − prev − aporte + resgate) ÷ prev × 100`, 4 casas; `null` se `prev = 0` |
| `accumulatePct(pcts)` | produtório `∏(1 + p/100) − 1` em %; ignora `null`; `0` se vazio |
| `mwrPct(flowsCents)` | TIR mensal por bisseção (300 iterações, intervalo [−0,9; 1,0]); `null` se todos os fluxos forem 0; devolve a taxa do período em % |
| `gapPp(a, b)` | `a − b` em pontos percentuais |
| `monthsBeaten(rows)` | quantos meses têm `portfolioPct > cdiPct` |

**`src/services/performance.ts`**: monta a série a partir de `buildHistory` estendida um mês antes de `from` (só para o valor-base) e devolve meses + acumulado + MWR. Fluxos do MWR: `−prevValue` no t=0 e `−(aporte − resgate)` por mês, com o valor final somado ao último mês — tudo em centavos inteiros.

**`GET /api/performance?from=YYYY-MM&to=YYYY-MM`**

```json
{
  "from": "2025-10", "to": "2026-09",
  "months": [{ "month": "2025-10", "portfolioPct": 1.44, "cdiPct": 1.28, "ipcaPct": 0.09,
               "diffCdiPp": 0.16, "rendimentoCents": <valor>, "investedCents": <valor>, "redeemedCents": 0 }],
  "accumulated": { "portfolioPct": 14.14, "cdiPct": 14.01, "ipcaPct": 3.73, "diffCdiPp": 0.13, "diffIpcaPp": 10.42 },
  "monthsBeaten": 6, "monthsTotal": 12,
  "mwr": { "periodPct": 14.15, "months": 12 }
}
```

- Defaults: `to` = mês corrente (BRT); `from` = `to − 11 meses`. `400` se o formato for inválido ou `from > to`.
- `bigint → number` na borda (`toNumberSafe`), como nas rotas existentes.

**Janela (regra única, compartilhada com `/api/history`)** — `resolveHistoryWindow(db, {from, to})` em `src/services/history.ts`:

1. `to` default = mês corrente; `from` default = `to − 11`.
2. Clamp: nunca antes do **primeiro mês com retorno** — o primeiro mês cujo mês anterior tem `marketValueCents > 0`. Para os dados atuais: **mai/2025** (abr/2025 é o mês de atividade inicial, sem mês anterior para comparar).
3. Isso elimina os 321 pontos vazios que `from=2000-01` devolve hoje.

## Posições (`PositionsView`)

- Busca por nome (case-insensitive), filtros por `kind`, `broker`, `objective` e ordenação (valor ↓ padrão, nome, rendimento R$, rendimento %, % da carteira).
- Colunas: Ativo (+ badge `stale`) · Setor · Valor · % · Rendimento (R$ e %).
- Clique na linha abre um painel lateral com os dados do ativo e as transações (`GET /api/instruments/:id/transactions`): data, tipo, quantidade, preço, valor, taxas.
- Estado vazio: aponta para Importar. Sem CRUD.

## Evolução (`EvolutionView`)

1. O mesmo gráfico da Visão geral, em tamanho maior.
2. Tabela mês a mês: patrimônio, aportes, resgates, rendimento (R$ e %), CDI %, IPCA %, diferença vs CDI (p.p.) e acumulado %.
3. **De onde veio o crescimento**: barras empilhadas por mês — aporte (`--sand`) na base, rendimento (`--accent`) no topo, resgate (`--danger`) abaixo do eixo. Legenda: "você aportou / o mercado rendeu / você resgatou".

## Fontes (`SourcesView`)

1. Cartões por fonte: id, última tentativa, último sucesso, `stale`, último erro.
2. Botão "Atualizar cotações" com o resultado por fonte (fetched/inserted/errors) e o reparo do B5P211 quando houver.
3. **Reconciliação** (vinda do Dashboard): cards legado · referência · nosso · diferença, tabela de divergências com causa legível e selo explicadas/não explicadas; `<details>` aberto por padrão quando `unexplained > 0`.

## Importar

Sem mudanças: dropzone `.xlsx`/CSV, dry-run e histórico de imports.

## Testes

- **Domínio** (`src/domain/performance.test.ts`): retorno mensal com aporte, com resgate, com `prev = 0` (null), série de 1 mês; acumulado com `null` no meio e vazio; MWR com aportes regulares (confere com TWR quando não há timing), com aporte grande no fim (MWR < TWR) e sem fluxo (null); `monthsBeaten` empate não conta; `gapPp` negativo.
- **Serviço/rota** (`src/services/performance.test.ts`, `src/api/app.test.ts`): janela com clamp no primeiro mês com retorno; `from` default; `400` para formato inválido e `from > to`; `+X%` com base do mês anterior; `bigint` convertido.
- **UI**: sem framework de teste no `web/` (padrão do projeto) — verificação no browser com dados reais: as 5 seções, os controles do gráfico e a tabela de Evolução.
- **Regressão**: `npm test`, `npm run typecheck`, `npm run build:web`, `docker compose up -d --build` + `curl localhost:3000/api/health`; reconciliação segue com 0 não explicadas (agora em Fontes).

## Critérios de aceite

1. Paleta Papel quente em todas as telas, sem variante escura; contraste AA e foco visível.
2. Visão geral em duas colunas, sem tabela de ativos e sem reconciliação.
3. Gráfico: abas R$ e % operando; período 1 ano · 5 anos · Tudo; janela escrita na tela; sub-abas Mês a mês e Acumulado.
4. Números da janela conferem com a API (dados reais de 2026-09-21):
   - **1 ano (out/2025 → set/2026)**: carteira **+14,14%** · CDI **+14,01%** · IPCA **+3,73%** · diferença **+0,13 p.p.** · **6 de 12** meses acima do CDI · MWR **+14,15%**.
   - **Tudo (mai/2025 → set/2026, 17 meses)**: carteira **+22,07%** · CDI **+20,89%** · IPCA **+4,90%** · diferença **+1,18 p.p.** · **10 de 17** meses acima do CDI · MWR **+21,40%**.
5. Aportes visíveis: em abr/2026 o gráfico em R$ mostra aporte de R$ <valor> e rendimento de R$ <valor> (total +R$ <valor>).
6. Posições lista os 48 ativos, filtra por setor/corretora/objetivo e abre as transações do ativo.
7. `npm test` verde, typecheck limpo, build da web ok, container healthy.

## Riscos

- **MWR com mês de base zero**: o primeiro mês de atividade não tem retorno calculável; a janela "Tudo" começa no mês seguinte e o rótulo deixa isso explícito.
- **Yahoo pode re-corromper o histórico** (B5P211): fora do escopo do redesign; comportamento atual se mantém.
- **Janelas longas** (5 anos/Tudo) podem ficar densas: barras trimestrais acima de 24 meses e `from` clampado evitam payload/renders grandes.
- **Mudança de tema afeta legibilidade de estados** (`stale`, erro, resgate): os tokens de `--warn`/`--danger` foram escolhidos com contraste AA sobre `--surface`.
- **Regressão de dados**: nenhum número de cálculo muda nesta etapa — só apresentação e uma camada de leitura nova; a reconciliação continua sendo o teste de fidelidade.

## Arquivos previstos

```
src/domain/performance.ts            (+ .test.ts)
src/services/performance.ts          (+ .test.ts)
src/services/history.ts              (resolveHistoryWindow + clamp)
src/api/routes/performance.ts        (novo, registrado em src/app.ts)
web/src/styles.css                   (tokens Papel quente)
web/src/App.tsx                      (shell + barra lateral)
web/src/views/OverviewView.tsx       (substitui DashboardView)
web/src/views/PositionsView.tsx      (novo)
web/src/views/EvolutionView.tsx      (novo)
web/src/views/SourcesView.tsx        (novo, com a reconciliação)
web/src/components/EvolucaoChart.tsx (novo)
web/src/api.ts                       (tipos + getPerformance)
web/src/format.ts                    (formatação de p.p. e datas da janela)
```

Referências: design v1 (`2026-09-17-modernizacao-app-investimentos-design.md`), S4, S5 e S6.
