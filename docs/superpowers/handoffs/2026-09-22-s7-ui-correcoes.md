# Handoff — correções de UI da S7 (2026-09-22)

**Para a próxima sessão:** leia este doc e o `ROADMAP.md` antes de agir. Tudo está na `main` (`0d785ef`, push feito), 154 testes verdes, Docker `healthy` em `:3000`. **Nenhuma mudança de backend é esperada** — é um batch de UI (~2h–2h30) com verificação no browser.

> **Cache:** o browser pode servir CSS antigo; valide com hard reload (Cmd+Shift+R) ou reiniciando a sessão do `agent-browser` (fechei e reabri uma vez e a medição mudou).

## Estado ao encerrar

- Última rodada: separadores `·`/`→` removidos + padrões de dashboard (delta chip no patrimônio, tabela comparativa Carteira × CDI × IPCA, rendimento em duas colunas, fontes em badges) + grid com `minmax(0, …)`.
- O feedback do usuário sobre essa rodada gerou os 6 apontamentos abaixo (numeração do usuário entre parênteses quando diferente).
- Screenshots de referência: `.superpowers/sdd/s7-11-kpi-pacote.png` (antes do fix de grid), `s7-12-kpi-grid-ok.png` (depois), `s7-13-posicoes-duas-colunas.png`.

## Apontamentos (sintoma → causa → direção → aceite)

### 1. Card Patrimônio ignora o período (1 ano / 5 anos / Tudo)

- **Sintoma:** `+15,04%` e "rendimento de R$ <valor> sobre o capital" não mudam ao trocar o período.
- **Causa:** `web/src/views/OverviewView.tsx:88-90` calcula de `portfolio.totals` (posição de hoje), enquanto o período só afeta `performance`/`history`; a janela no cabeçalho do card (`OverviewView.tsx:127`) sugere que o número é da janela.
- **Direção (escolher):** (a) separar "Posição atual" (patrimônio + rendimento **desde o início**, rótulo explícito) de "Desempenho no período"; ou (b) tornar o card do período somando `performance.months[].rendimentoCents` da janela + capital base.
- **Aceite:** trocar 1/5/Tudo muda o número exibido, **ou** o rótulo deixa explícito que é acumulado desde o início.

### 2. Página mais larga que o viewport

- **Sintoma:** scroll horizontal; medido `document.documentElement.scrollWidth = 1591` para `innerWidth = 1280`.
- **Causa raiz (confirmada no browser):** `th { white-space: nowrap }` (`web/src/styles.css:433`) + `.tabela-comparativa { width: 100% }` inflam o min-content do card "Meu dinheiro rendeu" (~700px); `.stack` (`styles.css:112-115`) é grid de uma coluna `auto` sem piso zero, então o card transborda a track de ~359px; `.colunas > * { min-width: 0 }` (`styles.css:677`) não cobre os netos.
- **Fix validado no browser (transbordo zerado):**
  ```css
  .stack { grid-template-columns: minmax(0, 1fr); }
  .tabela-comparativa { width: auto; min-width: 0; }
  .tabela-comparativa th { white-space: normal; }
  ```
- **Aceite:** `document.documentElement.scrollWidth === window.innerWidth` em 1280, 1024 e 900; conferir também <900px (sidebar vira faixa horizontal).

### 3. Números do eixo Y do gráfico cortados

- **Sintoma:** rótulos truncados no Evolução: "R$ <valor>" e "<valor>" (faltando o prefixo).
- **Causa:** larguras fixas pequenas para o texto formatado (`web/src/components/EvolucaoChart.tsx:153-156`, `width={64}`/`width={56}`; `:167` e `:183`, `width={48}`).
- **Direção:** aumentar a largura ou usar ticks compactos no `tickFormatter` ("R$ <valor> mil"); testar com o maior valor real (~R$ <valor>) e no modo %.
- **Aceite:** nenhum rótulo cortado no R$ (1 ano e Tudo) e no % (mês a mês e acumulado).

### 4. O prazo não deixa claro o que afeta; falta separação "atual × histórico"

- **Sintoma:** os chips de período ficam no topo da página (`OverviewView.tsx:106-110`), mas só o gráfico, a tabela MWR e o rótulo da janela mudam.
- **Direção:** agrupar em dois blocos visíveis — **Posição atual** (patrimônio, rendimento, onde está o dinheiro, alocação, fontes) e **Desempenho no período** (chips de período + gráfico + tabela comparativa com a janela escrita). Mover os chips para o cabeçalho do card do gráfico.
- **Aceite:** o seletor de período está visivelmente dentro do bloco histórico; a janela efetiva aparece ao lado do gráfico e do MWR.

### 5. Fontes mais bonitas, com ícone e disponibilidade

- **Sintoma:** `OverviewView.tsx:234-243` mostra só badges `id ok`.
- **Direção:** linha/cartão por fonte com ícone (Yahoo/BCB/CVM), ponto de status (verde ok / âmbar desatualizada), "última coleta HH:MM" e atalho "Ver fontes"; manter a tabela detalhada em `SourcesView.tsx`.
- **Aceite:** cada fonte com ícone + estado + horário, coerente com `/api/health`; estado `stale` destacado.

### 6. Cards ocupando o espaço de forma mais uniforme

- **Sintoma:** a coluna direita termina bem antes da esquerda (vazio sob Fontes); gráfico preso em 280px na Visão geral.
- **Direção:** `grid-template-areas` no `.colunas` ou card do gráfico esticando até a altura da linha (`align-items: stretch` + altura 100%); redistribuir Fontes/alocação se necessário; testar nos 3 breakpoints.
- **Aceite:** colunas com alturas próximas (ou diferença intencional e clara) em 1280 e 1024.

## Itens herdados (não bloqueiam este batch)

- MWR exibe `+14,16%`/`+21,41%` enquanto a spec registra `+14,15%`/`+21,40%` (0,01 p.p.; decidir truncar ou atualizar a spec).
- Rótulos finais do gráfico acumulado se sobrepõem quando carteira ≈ CDI.
- Lazy-load do Recharts adiado (bundle ~650 kB).
- Decisão pendente: Fontes em tabela (implementado) vs "cartões" (texto da spec).

## Como executar (padrão bento)

1. **Batch direto de UI** (sem spec/plano; sem backend, sem testes novos de backend).
2. **Ordem sugerida e estimativa:** 2 overflow (~15 min) → 3 eixos (~15 min) → 1+4 atual × período (~45 min) → 5 fontes (~30 min) → 6 layout (~30 min). Total ~2h–2h30.
3. **Verificação:** `npm run typecheck && npm run build:web`; `docker compose up -d --build`; browser em 1280/1024/900 com hard reload; screenshots em `.superpowers/sdd/`; rodar `npm test` (154) antes de fechar.
4. **Fechamento:** commit pt-BR por mudança, push na `main`, atualizar a seção de polish do `ROADMAP.md`.
