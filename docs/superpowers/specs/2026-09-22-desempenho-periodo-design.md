# Desempenho no período — polimento do gráfico (R$ e %)

**Resumo:** a aba **R$** passa a ter as barras de aporte/resgate **sobrepostas numa única coluna** (aporte sobe, resgate desce, eixo de fluxos simétrico com zero no meio). A aba **%** perde as barras: as sub-abas **Mês a mês** e **Acumulado** viram linhas de 3 séries (Carteira · CDI · IPCA) e o **Líquido (Carteira − IPCA)** aparece só no tooltip. Os controles (visão · granularidade · período) ficam no **canto superior direito do cabeçalho do card**, e os **rótulos finais** ganham anti-colisão para o caso Carteira ≈ CDI.

**Depende de:** `EvolucaoChart` (S7), `/api/performance` (S7 + fluxos datados 2026-09-22), `realReturnPct` (`src/domain/performance.ts`).

**Não faz parte:** linha de capital acumulado no R$ (decidida fora em 2026-09-22); mudar TWR/MWR/capital (nenhum número de cálculo muda); abas auxiliares (v2); imposto líquido × líquido (v3); trimestralização acima de 24 meses (permanece).

## Decisões do brainstorming (2026-09-22, com mock em dados reais)

| Tema | Decisão |
|---|---|
| Aba % | Sub-abas mantidas; **ambas só com linhas** (3 séries). Barras removidas |
| Líquido (Carteira − IPCA) | **Só no tooltip** (mensal e acumulado) — não vira 4ª linha |
| R$ — linha de capital | **Fora do escopo**: não implementar (decidido em 2026-09-22) |
| R$ — tooltip | Mostra Patrimônio, Capital acumulado, Aporte e Resgate; **sem "Rendimento acumulado"** |
| R$ — barras | **Uma coluna por mês** (variante 2 do mock): aporte sobe, resgate desce (−Y) na mesma coluna; eixo de fluxos simétrico, zero no meio do gráfico |
| R$ — sub-abas | **Mês a mês**: só as barras de aporte/resgate do mês (movimentação). **Acumulado**: evolução do patrimônio ao longo do tempo (área), sem barras. Decidido em 2026-09-22 |
| R$ — leitura | Os dois valores ficam ancorados no zero dos fluxos; como o zero dos fluxos não coincide com a base do gráfico (zero do patrimônio), uma linha de referência marca o zero |
| R$ — descartados | Linha de capital acumulado (qualquer forma); empilhadas (movimentação); duas faixas; item de backlog "acumulado na aba R$" |
| Controles | Três grupos como segmented controls (pods `--surface-2` com chips claros; ativo com borda/texto accent) no **canto superior direito do cabeçalho do card**: visão (`R$ · %`), granularidade (`Mês a mês · Acumulado`) e período (`1 ano · 5 anos · Tudo`). Uma linha; hint da janela encurtada (`out/2025 – set/2026.`); chips 11 px; em telas estreitas a linha quebra à direita. Decidido em 2026-09-22 |
| Rótulos finais | Anti-colisão: rótulos com valores finais próximos são empilhados com desvio vertical |
| Fonte do líquido | **API** passa a devolver `realPct` por mês (domain `realReturnPct`); web só acumula e exibe |

## Problema

O card "Desempenho no período" ficou com quatro atritos visuais (backlog do ROADMAP):

1. A aba R$ não aproveita o espaço: as barras de aporte/resgate dividem o espaço do mês e ficam estreitas.
2. A aba % mistura barras mensais e linhas acumuladas (sub-abas) e não expõe o retorno real no tooltip.
3. As sub-abas surgem/somem ao alternar R$/% e deslocam a linha de controles; os grupos (valor × granularidade) não são visualmente separados.
4. Os rótulos finais se sobrepõem quando Carteira ≈ CDI (ex.: 1 ano: +13,91% vs +14,07%).

## Definições de cálculo

### Barras em coluna única (R$)

As duas séries continuam no eixo `fluxo` (direita), mas ocupam a **mesma coluna**: aporte positivo (para cima) e resgate negativo (para baixo), com o eixo simétrico `[−max, +max]` — o zero dos fluxos fica no meio do gráfico, marcado por uma linha de referência. Assim os dois valores ficam ancorados no zero (leitura correta mês a mês) e a coluna economiza espaço horizontal.

Implementação: Recharts 3 não tem stack divergente (`stackOffset="diverging"` cai em `none`), então as barras usam `barSize` fixo e `barGap` negativo (`−barSize`) para se sobreporem na mesma coluna sem `stackId`. O tooltip mostra os valores brutos positivos.

### Líquido (Carteira − IPCA)

- Mensal: `realReturnPct(portfolioPct, ipcaPct)` — `(1 + carteira) ÷ (1 + IPCA) − 1`, 4 casas, `null` se qualquer um for `null`.
- Acumulado: composição dos líquidos mensais (mesma matemática de `accumulatePct`).
- Exibido apenas no tooltip; o total acumulado já existe em `accumulated.realPct` (cards/modais inalterados).

### Rótulos finais (% acumulado)

Entre os 3 valores finais, os que estiverem a menos de 1,5 p.p. entre si formam um grupo; dentro do grupo os rótulos são deslocados verticalmente (passo 14 px, centrado). Rótulo isolado fica na linha.

## Código

### `src/services/performance.ts`

Cada `PerformanceMonth` ganha `realPct: number | null` (via `realReturnPct(portfolioPct, ipcaPct)`, disponível no loop). `PerformanceResult` e o shape da API ficam iguais no resto.

### `web/src/api.ts`

`PerformanceMonth` ganha `realPct: number | null`.

### `web/src/components/EvolucaoChart.tsx`

- `visaoRs`: barras `Aporte`/`Resgate` na mesma coluna (`barSize` fixo + `barGap` negativo), resgate com valor negativo; no **Mês a mês** só as barras, com eixo de fluxos simétrico e linha de referência em zero; no **Acumulado**, só a área do patrimônio (sem barras). Sem linha de capital.
- `TooltipRs`: remove a linha "Rendimento acumulado"; adiciona "Capital acumulado".
- Aba %: remove `Bar`/`Cell` e a sub-visão de barras; `visaoPct` (mensal) e `visaoAcumulada` continuam com 3 séries; `TooltipPct` ganha "Líquido (Carteira − IPCA)" (mensal na sub-aba Mês a mês; composto acumulado na sub-aba Acumulado).
- `RotuloFinal`: recebe deslocamento calculado por um helper de agrupamento (1,5 p.p. / 14 px).
- `formataEixoRs`: sinal negativo limpo no eixo de fluxos simétrico (ex. `−R$ <valor> mil`).
- Controles: componente `ControlesGrafico` (novo, `web/src/components/ControlesGrafico.tsx`) com os três pods (`chart-grupo`) e os tipos `Aba`/`SubAba`; os estados `aba`/`subAba` sobem para as views, que renderizam o componente no cabeçalho do card; `EvolucaoChart` fica controlado (`aba`/`subAba` por props) e `Periodo`/`PERIODOS` vivem em `web/src/periodos.ts`.

### `web/src/styles.css`

Classes dos pods (`.chart-grupo`: fundo `--surface-2`, pill, chips claros) e da faixa (`.chart-controles-grafico`); `gap` de 2 px dentro do pod e 6 px entre pods. Sem divisor.

### `ROADMAP.md`

Registrar a etapa e marcar os itens de backlog consumidos/descartados.

## Testes

- `src/services/performance.test.ts`: novo caso cobrindo `realPct` por mês (valores conhecidos: ex. carteira 1,4253% e IPCA 0,09% ⇒ líquido 1,3341%; mês com IPCA `null` ⇒ `null`).
- `src/api/app.test.ts`: se o teste da rota já valida o shape, incluir `realPct` na asserção; senão, sem mudança.
- Web sem teste unitário (padrão do projeto): verificação no browser.

## Aceite

1. **R$**: `Mês a mês` mostra só as barras (aporte sobe, resgate desce, mesma coluna, zero dos fluxos marcado); `Acumulado` mostra a evolução do patrimônio sem barras; sem linha de capital; tooltip sem "Rendimento acumulado" e com "Capital acumulado".
2. **%**: ambas as sub-abas com 3 linhas; nenhuma barra; tooltip com "Líquido (Carteira − IPCA)".
3. **Controles**: visão, granularidade e período ficam no canto superior direito do cabeçalho do card (segmented controls), com o período afetando a janela; sem esconder/mostrar chips ao trocar de aba.
4. **Rótulos**: sem sobreposição na janela 1 ano (Carteira ≈ CDI) e em Tudo.
5. `npm test`, `npm run typecheck` e `npm run build:web` verdes; Docker `healthy`; screenshots das duas abas.
6. Números de TWR/MWR/capital inalterados (só apresentação).

## Riscos

- **Zero dos fluxos no meio do gráfico** não coincide com a base (zero do patrimônio); a linha de referência e a direção das barras comunicam a leitura. Se confundir na prática, as alternativas registradas são lado a lado ou duas faixas.
- **Líquido acumulado** composto mês a mês pode divergir em 0,01 p.p. do `accumulated.realPct` (arredondamento a 4 casas); os modais continuam usando o total da API.
