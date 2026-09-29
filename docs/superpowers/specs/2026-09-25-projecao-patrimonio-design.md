# Projeção do patrimônio na Visão geral

**Resumo:** card novo na coluna esquerda da Visão geral, abaixo do card dos três gráficos nomeados, com a **projeção do patrimônio para 1 ou 2 anos** a partir do padrão recente (últimos 12 meses): linha-base + faixa ±1 desvio-padrão. O cálculo vira domínio puro testado (`src/domain/projection.ts`), exposto por `GET /api/projection`; o web só desenha. Sem persistência e sem mudança de banco.

**Depende de:** `/api/performance` e `/api/history` (S4/S7, retornos mensais datados e patrimônio por mês); `resolveHistoryWindow`/`buildHistory`/`buildPerformance` existentes; cards e padrões de chip do redesign S7.

**Não faz parte:** rebalanceamento (etapa separada); cenários nomeados; aporte editável na tela; projeção por classe/ativo; "até 2099" (o nome vem da lista de anos da aba `Dashboard - Anual - Auxiliar` do legado — esta etapa entrega 1–2 anos; horizonte maior, se pedido, vira outra spec); persistência de projeções; mudanças em TWR/MWR/reconciliação; tema escuro; lazy-load do Recharts.

## Decisões do brainstorming (2026-09-25)

| Tema | Decisão |
|---|---|
| Onde | Visão geral, **coluna esquerda**, abaixo do card dos 3 gráficos nomeados (não full-width) |
| Modelo | Linha-base + faixa **pessimista–otimista (±1σ** dos retornos mensais) |
| Estimador | **Média geométrica** do TWR mensal dos últimos 12 meses + aporte líquido médio (descarta a média aritmética do legado) |
| Cálculo | Domínio puro + serviço + rota `GET /api/projection` (testável; web não calcula) |
| Histórico no gráfico | 12 meses reais (linha cheia) + marco "hoje" + projeção tracejada |
| Horizonte | Chips **1 ano · 2 anos**; a rota devolve 24 meses e o cliente recorta (sem refetch) |
| Escopo técnico | API de leitura + web; sem banco/migration |

## Problema

A aba `Evolução - Auxiliar - Previsão` da planilha projeta 60 meses assim:

- janela = últimos 12 meses; `r̄ = AVERAGE(Rendimento % mensal)` (1,0255%/mês no arquivo) e `c̄ = AVERAGE(Total investido − Total resgatado)` (≈ R$ <valor>/mês);
- recorrência `V₁ = (V₀ + c̄)·(1 + r̄)` e `Vₙ₊₁ = (Vₙ + c̄)·(1 + r̄)`, com `V₀` = último "Valor total somado".

Três problemas: (1) compor com **média aritmética** superestima o juro composto (*volatility drag*); (2) o rendimento do legado é simplificado, não o TWR datado que o app já calcula (`monthlyPortfolioPct`, Modified Dietz); (3) uma linha única parece exata num horizonte de 1–2 anos.

## Desenho

### Fórmula (domínio puro)

- **Janela:** 12 meses terminando no mês corrente (`resolveHistoryWindow` com `from = addMonths(mêsCorrente, -11)` e o clamp existente em jun/2025); inclui o mês parcial, igual ao "1 ano" do gráfico e ao legado.
- **Retornos:** `portfolioPct` de cada mês de `buildPerformance` (já com 4 casas); `null` é ignorado.
- **Mínimo:** 6 meses com retorno válido; abaixo disso a premissa é `null` e o card mostra estado vazio.
- **Taxa:** `r = (Π(1 + pct/100))^(1/n) − 1`, em %/mês com 4 casas (arredondamento do domínio); `σ` = desvio-padrão **amostral** (n−1) dos mesmos retornos, em p.p.
- **Aporte:** `c` = média do fluxo líquido (`investedCents − redeemedCents`) de **todos** os meses da janela (inclusive meses sem retorno válido), em centavos, com `divRoundHalfUp`.
- **Partida:** `V₀` = último `marketValueCents` do histórico da janela (mesmo ponto da linha do gráfico).
- **Recorrência (24 meses):** `Vₙ₊₁ = round((Vₙ + c) · (1 + r*/100))` com `r*` = `r` (base), `max(r − σ, −99)` (pessimista) e `r + σ` (otimista); centavos via `divRoundHalfUp` e fator escalado (`factorE6 = 1_000_000 + round(r*·10_000)`), sem float no valor.
- **Sem promessa:** a faixa é **referência de ±1 desvio-padrão** dos retornos recentes, não intervalo de confiança nem probabilidade.

### API

`GET /api/projection` (sem parâmetros) →

```json
{
  "from": "2025-10",
  "to": "2026-09",
  "premise": {
    "monthsUsed": 12,
    "monthlyRatePct": 1.0307,
    "bandPp": 0.3267,
    "contributionCents": <valor>,
    "pessimisticMonthlyPct": <valor>,
    "optimisticMonthlyPct": 1.3574,
    "patrimonyCents": <valor>
  },
  "history": [{ "month": "2025-10", "marketValueCents": <valor> }],
  "projection": [{ "month": "2026-10", "baseCents": <valor>, "pessimisticCents": <valor>, "optimisticCents": <valor> }]
}
```

- `premise: null` (com `history: []` e `projection: []`) quando há menos de 6 retornos válidos — `from`/`to` seguem preenchidos.
- BigInts serializados com `toNumberSafe`; todos os números do exemplo são ilustrativos (os valores vivos entram no aceite).
- Sem query string: o recorte 12/24 é do cliente, evitando refetch ao trocar o chip.

### UI (Visão geral)

- Card **"Projeção do patrimônio"** na coluna esquerda, abaixo do card dos três gráficos; cabeçalho com o título à esquerda e chips **1 ano · 2 anos** à direita (padrão `chip`/`chart-grupo` do app).
- Hint fixo com a premissa: "Estimativa pelos últimos 12 meses: rendimento de **X%/mês** e aporte médio de **R$ Y/mês**. A faixa usa ±1 desvio-padrão dos retornos mensais."
- Gráfico (`ComposedChart`, ~300 px): 12 meses reais em área cheia (`--accent`); ponto de junção em "hoje" com o patrimônio atual em todas as séries; projeção base tracejada; faixa preenchida entre pessimista e otimista (`--accent-soft` com opacidade); `ReferenceLine` vertical rotulada **"hoje"**; eixo Y com `formataEixoRs`; tooltip com mês, valor base e faixa (ou patrimônio real, nos meses passados).
- Eixo X: rótulos mensais com `minTickGap` (36 pontos no modo 2 anos não cabem todos); chips trocam só o recorte dos dados.
- Estado vazio (premissa `null`): card presente com "Sem histórico suficiente para projetar (precisa de 6 meses de retornos)."
- Erro de leitura entra no callout existente da página; a projeção não bloqueia o resto da Visão geral.

## Código

- `src/domain/projection.ts` (novo): `projectionPremise(pcts, netContributionsCents)` e `projectPatrimony(patrimonyCents, premise, months)` + constante `MIN_MONTHS = 6`.
- `src/services/projection.ts` (novo): `buildProjection(db, deps?)` reusa `resolveHistoryWindow`, `buildPerformance` e `buildHistory`.
- `src/api/routes/projection.ts` (novo) + registro em `src/app.ts`.
- `web/src/api.ts`: tipo `Projection` + `getProjection(signal)`.
- `web/src/components/ProjecaoChart.tsx` (novo) + card em `web/src/views/OverviewView.tsx` (fetch no `Promise.all` existente, estado dos chips).
- `web/src/styles.css`: só o necessário para o card/faixa (se houver).
- `ROADMAP.md` no merge.

## Testes

**Domínio (`src/domain/projection.test.ts`)**

1. Média geométrica de série conhecida (ex.: `[+10, −10]` → `−0,5013%/mês`); `σ` amostral conhecido.
2. Ignora `null`; exatamente 6 válidos funciona; 5 → `null`.
3. Aporte médio inclui meses sem retorno válido e arredonda half-up.
4. Recorrência base/pessimista/otimista com centavos conferidos à mão; `r*` pessimista clampa em −99; 24 pontos no horizonte.
5. `V₀ ≤ 0` ou aporte negativo (resgate médio) não quebram a recorrência.

**Serviço (`src/services/projection.test.ts`)**

1. Janela pedida de 12 meses respeita o piso (jun/2025 ou primeiro mês com retorno); `history` com o mesmo último ponto de `buildHistory`.
2. `premise.monthlyRatePct` bate com `buildPerformance` da mesma janela: `(1 + r/100)^n − 1` ≈ `accumulated.portfolioPct` (tolerância de arredondamento).
3. Histórico insuficiente → `premise: null`, listas vazias.
4. Banco vazio não lança.

**Rota (`src/api/app.test.ts`, padrão do projeto)**

1. `200` com shape completo e bigints como number.
2. `premise: null` → `history`/`projection` vazios.

**Aceite com dados reais**

1. `GET /api/projection` devolve 12 meses de histórico (out/2025 – set/2026) e 24 projetados (out/2026 – set/2028).
2. `premise.monthlyRatePct` confere com `/api/performance?from=2025-10&to=2026-09` pela identidade do item 2 dos testes de serviço; último ponto de `history` = último `/api/history`.
3. Chips 1 ano/2 anos alternam o recorte; faixa e marco "hoje" visíveis; tooltip confere; sem overflow em 1280 e 1024; screenshots em `.superpowers/sdd/`.
4. `npm test` verde (204 + novos), `npm run typecheck`, `npm run build:web`; `docker compose up -d --build` + `curl localhost:3000/api/health`.

## Riscos

- **σ com 12 observações é ruidoso** → a faixa é rótulo de referência, e o texto não promete probabilidade.
- **Mês corrente parcial** entra na janela (como no gráfico) e pode puxar a média em meses atípicos → documentado no hint; janela fixa em 12 meses, sem ajuste manual (YAGNI).
- **Aporte médio dilui meses atípicos** (abr/2026: +R$ <valor> mil líquido) → premissa explícita no hint; edição de aporte fica fora do escopo.
- **Faixa no Recharts:** se a versão instalada não suportar área de intervalo (`[min, max]`), implementar com duas áreas empilhadas — decisão e verificação no plano.
- **Projeção não é promessa** → tracejado + rótulo "estimativa" + tooltip com a faixa.
