# Gráficos nomeados de desempenho (Visão geral e Evolução)

**Resumo:** o gráfico único "Desempenho no período" (abas R$ e %, com sub-abas Mês a mês e Acumulado) vira **um card com seletor nomeado**: os nomes do que cada gráfico mostra — **Evolução do patrimônio** (área, R$), **Aportes e resgates** (barras, R$) e **Rendimento vs CDI e IPCA** (% — linhas, com sub-abas Mês a mês / Acumulado) — viram chips e um gráfico aparece por vez, com o período (1 ano · 5 anos · Tudo) na mesma linha. Na página Evolução, os mesmos três gráficos viram cards separados (altura maior) + tabela, e o "De onde veio o crescimento" sai. Sem mudança de API/banco.

**Depende de:** `/api/history` e `/api/performance` já carregados nas duas telas (S4/S7); `web/src/components/EvolucaoChart.tsx` e `ControlesGrafico.tsx` atuais.

**Não faz parte:** mudança de API/banco ou de cálculo (TWR/MWR intactos), métricas novas, tooltip sincronizado entre gráficos, período independente por gráfico, acordeão/carrossel, `<select>` nativo, lazy-load do Recharts, tema escuro, alteração do card "Posição atual".

## Decisões do brainstorming (2026-09-25)

| Tema | Decisão |
|---|---|
| Divisão | 3 gráficos nomeados: patrimônio (área), aportes/resgates (barras), rendimento (linhas) — nunca no mesmo eixo |
| Compactação (Visão geral) | Card único com **seletor nomeado** e um gráfico por vez; acordeão e carrossel descartados (mockup: `.superpowers/brainstorm/<valor>-<valor>/content/compactar-opcoes.html`) |
| Formato do seletor | Chips, como no resto do app — os 3 nomes ficam sempre visíveis; `<select>` nativo descartado |
| Abas | Abas R$/% e as sub-abas dentro do R$ somem; só o par Mês a mês / Acumulado do rendimento permanece (visível só na visão de rendimento) |
| Período | Um controle só, valendo para os três gráficos: na linha do seletor (Visão geral) e no topo da página (Evolução) |
| Evolução | Os 3 gráficos como cards separados (altura maior) + tabela; "De onde veio o crescimento" sai |
| Rodapé de resumo | "carteira · CDI · IPCA · diferença vs CDI · meses batidos" continua só na Evolução, no card de Rendimento |
| Tooltips | Patrimônio: valor + variação no mês; fluxos: aporte, resgate e líquido; rendimento: como hoje |
| Escopo técnico | Só web: `EvolucaoChart` vira três componentes; `ControlesGrafico` vira seletor + período + granularidade |

## Problema

O card "Desempenho no período" esconde quatro gráficos atrás de dois pares de chips: em R$, "Mês a mês" mostra fluxos (aporte/resgate) e "Acumulado" mostra patrimônio — assuntos sem relação entre si; em %, mostra o rendimento (carteira × CDI × IPCA). Os chips "R$" e "%" não dizem o que o gráfico desenha, e a sub-aba do R$ troca de conceito, não de granularidade. Resultado: quem abre a Visão geral não sabe o que está lendo.

## Desenho

### Visão geral — um card com seletor nomeado

- Cabeçalho em uma linha: chips de visão à esquerda (**Evolução do patrimônio** · **Aportes e resgates** · **Rendimento vs CDI e IPCA**) e chips de período à direita (1 ano · 5 anos · Tudo). Em telas estreitas, quebram em duas linhas.
- Um gráfico por vez (padrão: Evolução do patrimônio); abaixo do cabeçalho, o hint da visão escolhida (janela + descrição):
  1. **Evolução do patrimônio** — R$: área do patrimônio mês a mês. Tooltip: patrimônio do mês e variação vs mês anterior. Hint: "Quanto você tinha em cada mês."
  2. **Aportes e resgates** — R$: barras mês a mês, aporte ↑ (`--sand`) / resgate ↓ (`--danger`), zero no meio e eixo simétrico (± maior fluxo, como hoje). Tooltip: aporte, resgate e líquido do mês. Hint: "O que entrou e saiu da carteira em cada mês."
  3. **Rendimento vs CDI e IPCA** — %: linhas Carteira/CDI/IPCA, com as sub-abas **Mês a mês** (taxa do mês) e **Acumulado** (composto desde o início da janela), que só aparecem nesta visão. Tooltip como hoje (Carteira, CDI, IPCA, Líquido). Hint: "Carteira em TWR (sem o efeito dos aportes), contra CDI e IPCA."
- Altura do gráfico ~300 px, ajustada na verificação visual.
- Acima de 24 meses, agregação trimestral como hoje (patrimônio = último mês do trimestre; fluxos = soma; rendimento mês a mês = composto do trimestre) com o aviso "por trimestre" ao lado do período. O acumulado do rendimento segue mês a mês, como hoje, independente da agregação.

### Evolução — página

- Os mesmos três gráficos como cards separados (patrimônio 360, fluxos 320, rendimento 360), seguidos da tabela "Mês a mês".
- O período (1 ano · 5 anos · Tudo) fica no topo da página (`page-head-actions`), valendo para os três cards e para a tabela; a janela aparece no hint de cada card.
- "De onde veio o crescimento" e seu tooltip saem; o rendimento mensal em R$ continua na tabela.
- O rodapé de resumo (carteira, CDI, IPCA, diferença vs CDI, meses batidos) aparece no card de Rendimento.
- O `page-sub` volta a descrever a página.

### Regras de dados (sem mudança de cálculo)

- **Patrimônio**: `history.marketValueCents` por mês; trimestral = último mês do trimestre.
- **Fluxos**: `performance.months[].investedCents` / `redeemedCents`; trimestral = soma do trimestre.
- **Rendimento**: `portfolioPct` / `cdiPct` / `ipcaPct` / `realPct` como hoje; acumulado composto desde o primeiro mês da janela, ignorando `null` — sem mudança.
- **Variação no mês** (tooltip do patrimônio): no primeiro ponto, `rendimentoCents + investedCents − redeemedCents`; nos demais, diferença vs mês anterior.
- Sem histórico no período: cada gráfico mantém o estado vazio "Sem histórico suficiente".

## Código

- `web/src/components/EvolucaoChart.tsx` dividido em três componentes (`PatrimonioChart`, `FluxosChart`, `RendimentoChart` — nomes finais no plano) + módulo comum com helpers (eixos, `acumula`, trimestre, `RotuloFinal`).
- `web/src/components/ControlesGrafico.tsx`: sai o tipo `Aba`; ficam o seletor de visão (3 chips nomeados), o controle de período e a granularidade do rendimento (`SubAba`).
- `web/src/views/OverviewView.tsx`: card único com estado de visão (padrão `patrimonio`), `subAba` e `periodo`; remove `aba`/`setAba`.
- `web/src/views/EvolutionView.tsx`: três cards + tabela; período no `page-head-actions`; remove `aba`/`setAba`, `crescimento`, `LinhaCrescimento` e `TooltipCrescimento`.
- `web/src/styles.css`: alturas dos gráficos e quebra do cabeçalho do seletor, se necessário.
- Sem mudança em API, banco ou domínio.

## Testes

- Sem runner no web (padrão do projeto): nenhum teste automatizado novo; `npm test` deve seguir com os **204 verdes** (nenhuma mudança de backend).
- Aceite no browser com dados reais (valores vivos, conferir contra a API no momento):
  1. Visão geral: seletor com os três nomes; o padrão é Evolução do patrimônio e cada chip mostra o gráfico certo (área, barras, linhas).
  2. Com "1 ano" (out/2025 – set/2026): patrimônio final = último ponto de `/api/history`; rendimento bate com `/api/performance` (referência de 2026-09-22: carteira +13,89% · CDI +14,07% · IPCA +3,73% · −0,18 p.p. · 6/12); fluxos de abr/2026 conferem (aportes R$ <valor> · resgates R$ <valor> · líquido R$ <valor> valores vivos).
  3. Trocar o período muda a janela dos três gráficos; Mês a mês/Acumulado só existe na visão de rendimento.
  4. Evolução: três cards + tabela, período no topo, sem "De onde veio o crescimento".
  5. Browser em 1280 e 1024: sem overflow horizontal; screenshots em `.superpowers/sdd/`.
- Verificação: `npm test`, `npm run typecheck`, `npm run build:web`; `docker compose up -d --build` + `curl localhost:3000/api/health`.

## Riscos

- O seletor volta a mostrar um gráfico por vez — aceito: os nomes explícitos resolvem a confusão original (o problema era o chip "R$/%" sem nome e a mistura de assuntos, não esconder).
- Refatoração sem testes de UI: conferir no browser os cinco estados do gráfico antigo (patrimônio mensal, fluxos mensal, rendimento mês a mês, rendimento acumulado, agregação trimestral) antes do merge.
- Chips de nome longo ("Rendimento vs CDI e IPCA") podem quebrar linha em telas estreitas → verificação em 1280/1024.
- Perda do "De onde veio o crescimento" é aceita; a leitura mensal de rendimento em R$ segue na tabela da Evolução.
