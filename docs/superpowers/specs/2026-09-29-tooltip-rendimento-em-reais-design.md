# Tooltip em R$ no gráfico Rendimento vs CDI e IPCA

**Resumo:** o tooltip do gráfico "Rendimento vs CDI e IPCA" passa a mostrar, ao lado de cada %, o valor em reais: **Carteira** = rendimento real do mês (`rendimentoCents`); **CDI/IPCA** = taxa do mês × capital exposto do mês (base do TWR, nova `baseCents` na API); **Líquido** = Carteira − IPCA. Mês a mês mostra o valor do mês (trimestral soma o trimestre); Acumulado soma os meses até o ponto. Sem valor disponível → `—`.

**Depende de:** `/api/performance`, `monthlyPortfolioPct` (`src/domain/performance.ts`) e `RendimentoChart` (`web/src/components/RendimentoChart.tsx`) atuais.

**Não faz parte:** mudança nas fórmulas de TWR/MWR/CDI/IPCA, R$ em outros gráficos/telas, exibir a base como série no gráfico, imposto, edição de dados.

## Decisões do brainstorming (2026-09-29)

| Tema | Decisão |
|---|---|
| Como calcular o R$ | % × capital exposto do mês (base do Modified Dietz) — o backend expõe `baseCents` exata; derivar no web (`rendimento ÷ %`) descartado |
| Carteira | R$ = `rendimentoCents` do mês (valor real; bate com a tabela da Evolução) |
| CDI/IPCA | R$ = `baseCents` × taxa do mês, arredondado ao centavo |
| Líquido | R$ = Carteira R$ − IPCA R$ |
| Trimestral (>24 meses) | R$ = soma dos 3 meses (a % já é composta; `null` contribui 0) |
| Acumulado | R$ acumulado até o ponto (soma dos valores mensais) |
| Indisponível | Sem o % → `—`; com o % mas sem o R$ correspondente → mostra só o % (na prática `baseCents` é `null` exatamente quando `portfolioPct` é `null`, então o caso não aparece com os dados reais) |

## Problema

O tooltip de "Rendimento vs CDI e IPCA" só mostra percentuais. Comparar carteira × CDI × IPCA fica abstrato: não dá para saber quanto aquele rendimento representa em dinheiro.

## Desenho

### Domínio e API

- `src/domain/performance.ts`: nova `monthlyReturn(prevValueCents, prevDate, valueCents, valueDate, flows): { pct: number; baseCents: bigint } | null`, com as mesmas guardas de `monthlyPortfolioPct` (base ≤ 0, período ≤ 0 ou denominador ≤ 0 → `null`). `baseCents = prevValueCents + divRoundHalfUp(weightedFlow, BigInt(periodDays))` — capital exposto por dia no mês (aporte/resgate ponderados pelos dias).
- `monthlyPortfolioPct` passa a delegar para `monthlyReturn` (mesma assinatura e mesmos resultados).
- `src/services/performance.ts`: `PerformanceMonth` ganha `baseCents: bigint | null`; `buildPerformance` preenche em cada mês (`null` quando `monthlyReturn` é `null`).
- `src/api/routes/performance.ts`: expõe `baseCents` como número (`toNumberSafe`, `null` preservado).
- `web/src/api.ts`: `PerformanceMonth` ganha `baseCents: number | null`.

### Web (`RendimentoChart.tsx`)

- `LinhaPct` e `LinhaAcumulada` ganham `carteiraCents`, `cdiCents`, `ipcaCents`, `realCents` (`number | null`).
- Mês a mês: `carteiraCents = portfolioPct === null ? null : rendimentoCents`; `cdiCents = baseCents === null || cdiPct === null ? null : Math.round(baseCents * cdiPct / 100)`; `ipcaCents` idem; `realCents = carteiraCents − ipcaCents` (`null` se algum for `null`).
- Trimestral: `carteiraCents`/`cdiCents`/`ipcaCents` = soma dos meses do grupo (ignora `null`), `realCents` = carteira − IPCA somados.
- Acumulado: acumula os centavos mês a mês junto com os %; `realCents` = carteira acumulada − IPCA acumulado.
- Tooltip: `Carteira: +1,47% (+R$ <valor>)` (usa `formataBRLSinal`, que prefixa `+` em valores positivos; `—` quando não há %). Demais linhas no mesmo formato.
- Sem mudança em `graficoComum`, views, CSS ou no resumo do card.

## Contas de referência (para o aceite)

Mês abr/2026 (valores vivos na verificação): `rendimentoCents <valor>`; com `portfolioPct 1,47%`, `baseCents ≈ <valor> / 0,0147`; `cdiCents = baseCents × cdiPct/100`; `ipcaCents = baseCents × ipcaPct/100`; `realCents = carteiraCents − ipcaCents`. Os valores exatos saem da própria API no momento do aceite.

## Testes

- TDD em `src/domain/performance.test.ts`: `monthlyReturn` — sem fluxos, base = `prevValueCents`; aporte no meio do período pondera pelos dias; resgate pondera negativo; `pct` idêntico ao de `monthlyPortfolioPct` no mesmo caso; casos de guarda devolvendo `null`.
- `src/services/performance.test.ts`: `baseCents` preenchido por mês e coerente com `portfolioPct === null`.
- Teste de rota (`src/api/app.test.ts`): JSON de `/api/performance` inclui `baseCents` (número ou `null`).
- Web sem runner (padrão do projeto): aceite no browser.

## Aceite

1. `npm test` verde (novos testes inclusos), `npm run typecheck` e `npm run build:web` limpos.
2. Browser com dados reais (janela 1 ano): tooltip Mês a mês mostra R$ ao lado dos 4 valores; Carteira R$ = `rendimentoCents` da API; CDI/IPCA R$ batem com `baseCents × taxa`; Acumulado mostra as somas; `—` quando não há valor.
3. Trimestral (>24 meses) soma o R$ dos 3 meses.
4. `docker compose up -d --build` + `curl localhost:3000/api/health` ok.

## Riscos

- Arredondamento: Carteira usa o `rendimentoCents` exato; CDI/IPCA herdam o arredondamento de 4 casas do pct (± ~R$ <valor> em base de R$ <valor> mil) — aceito.
- `baseCents` ≠ patrimônio do fim do mês quando há fluxos (é o capital exposto ponderado pelos dias) — números podem parecer diferentes do "patrimônio", mas são a base correta do TWR.
- Meses com `null` no início da série mostram `—`; sem regressão nos percentuais.
