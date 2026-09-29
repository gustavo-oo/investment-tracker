# TWR e MWR por fluxos datados

**Resumo:** substituir a aproximação "fluxo no fim do mês" do TWR mensal por **Modified Dietz ponderado por dia** e a TIR mensal do MWR por **XIRR sobre fluxos datados (ACT/365)**. A série de retorno passa a começar em **jun/2025** (corte explícito): abr–mai/2025 são lotes de migração de posições registradas pelo valor bruto do dia, não aportes. O CDI/IPCA não mudam: o CDI já é acumulado dia a dia e o índice não tem fluxos para ponderar. Nenhuma mudança de shape na API; só texto dos modais.

**Depende de:** S7 (`/api/performance`, `monthlyPortfolioPct`, `mwrPct`) e das cotações/índices da S4/S5.

**Não faz parte:** contra-factual "mesmos fluxos em CDI/IPCA" na UI (decidido: o TWR já é comparável e o CDI já é diário); detectar lotes de migração automaticamente (o corte é constante explícita); mudar o capital/"Sobre o capital" (seguem somando as transações); mudar `cdiMonthPct`/`ipcaMonthPct`; reconciliação; CRUD (v2).

## Decisões do brainstorming (2026-09-22)

| Tema | Decisão |
|---|---|
| TWR | Modified Dietz ponderado por dia; mês corrente pondera relativo a `asOf` |
| MWR | XIRR sobre fluxos datados (ACT/365), convertida para o retorno do período |
| Início da série | **jun/2025** — abr–mai são migrações registradas pelo valor bruto; corte vale para performance/gráficos, não para o capital |
| CDI/IPCA | Sem mudança de cálculo; documentar alinhamento e lags |
| UI | Sem tabela nova; só textos dos modais (fluxo entra na data em que aconteceu) |
| API | Sem mudança de shape (`PerformanceMonth` e acumulados iguais) |
| Escopo | Uma etapa só (spec → plano → TDD), números de aceite da S7 refeitos |

## Problema

O TWR mensal era `(V1 − V0 − aportes + resgates) ÷ V0`, tratando todo fluxo como se fosse do último dia do mês. Com aportes concentrados no início do mês, o rendimento que eles geram no mês é creditado à base anterior (pequena), inflando o %.

Caso extremo real de distorção (mai/2025, base de abr/2025 = R$ <valor> — mês que o corte abaixo retira da série):

| Cálculo | Fórmula | Resultado |
|---|---|---|
| Atual (fim de mês) | R$ <valor> ÷ R$ <valor> | **+2,0198%** |
| Ponderado por dia | R$ <valor> ÷ (R$ <valor> + R$ <valor>) | **+1,2083%** |

Aportes de mai/2025: R$ <valor> (05/05) + R$ <valor> (06/05) + R$ <valor> (07/05), peso `(31 − dia) ÷ 31`.

**Segundo problema, mesma origem:** os lançamentos iniciais são **lotes de migração**, não aportes — 23/04/2025 tem 23 compras somando R$ <valor> num único dia e 05–07/05/2025 tem 31 compras somando R$ <valor> em três dias (a planilha legada registrou as posições que já existiam pelo **valor bruto do dia**). Tratá-los como fluxo nas datas distorce TWR e MWR de abr–mai. O corte em jun/2025 absorve os dois lotes na base (31/05 = R$ <valor>) e garante que todo fluxo seguinte é aporte real; a partir de jun/2025 as entradas são compras individuais (jun: 1 × B5P211 R$ <valor>).

Efeitos medidos com dados reais (2026-09-22):

| Correção | Antes | Depois |
|---|---|---|
| Mai/2025 isolado (ponderado por dia) | +2,0198% | **+1,2083%** |
| Acumulado 16 meses (jun/2025–set/2026), com o corte | TWR +19,67% · MWR +19,62% · 9/16 acima do CDI | **TWR +19,31% · MWR +19,37% · 6/16** |

## Cálculos

### TWR mensal — Modified Dietz ponderado por dia

```
período   = dias(dataValorização − dataBase)          (dataBase/dataValorização = asOf do ponto)
peso_i    = dias(fluxo_i → dataValorização) ÷ período  (entre 0 e 1)
delta     = V1 − V0 − Σ fluxos
r         = delta ÷ (V0 + Σ peso_i·fluxo_i)            → % com 4 casas
```

- Convenção de sinal dos fluxos: **aporte > 0, resgate < 0** (perspectiva da carteira).
- Aritmética inteira até a divisão final: `divRoundHalfUp(delta × 10^6 × período, V0 × período + Σ fluxo_i × diasInvestidos_i) ÷ 10^4`.
- `null` se `V0 ≤ 0`, `período ≤ 0` ou denominador `≤ 0` (ex.: resgate que zera a base no meio do mês).
- Sem fluxos no mês, o resultado é idêntico ao anterior `(V1 − V0) ÷ V0`.
- Fluxo no último dia do período → peso 0 (mesmo comportamento de hoje).
- Mês corrente: `dataValorização = asOf` (hoje), então o período é parcial e os pesos são proporcionais a ele.

### MWR — XIRR por fluxos datados

```
NPV(r) = −V0 − Σ fluxo_i ÷ (1 + r)^(d_i ÷ 365) + VF ÷ (1 + r)^(D ÷ 365) = 0
```
- Assinatura simétrica ao TWR: `xirrPct(startCents, startDate, flows, endCents, endDate)` — `V0`/`VF` entram como parâmetros (não como pseudo-fluxos) e `flows` segue a convenção da carteira.
- Bisseção em `[−0,9; 10]` (taxa anual), 300 iterações; `null` se nada foi investido (`V0 + Σ|fluxos| = 0`) ou se não houver troca de sinal no intervalo.
- Retorno do período: `(1 + r_anual)^(dias ÷ 365) − 1`, 4 casas.
- `mwr.months` continua sendo o número de meses da série (rótulo "em N meses").

### Início da série — corte em jun/2025

- Constante `SERIES_START_MONTH = "2025-06"` em `src/services/history.ts`, com comentário: 23/04/2025 (23 compras, R$ <valor>) e 05–07/05/2025 (31 compras, R$ <valor>) são migrações de posições registradas pelo valor bruto do dia.
- `resolveHistoryWindow` aplica o piso: `from = max(pedido, primeiro mês com retorno, SERIES_START_MONTH)`.
- Base da série = mai/2025 (`addMonths(window.from, -1)`, já existente) = R$ <valor>; primeira linha de retorno = jun/2025.
- Vale para `/api/history` e `/api/performance` (mesma função). O capital (`Sobre o capital`, aportes/resgates) segue somando todas as transações, incluindo abr–mai — inalterado.
- Sem transações, a janela efetiva começa em jun/2025 (antes devolvia o `from` pedido, ex.: 2000-01).

### CDI e IPCA (sem mudança)

- `cdiMonthPct` já compõe a taxa de **cada dia útil** do mês (`index_rates` série CDI). Depois da mudança, os dois lados são retorno de período do mesmo intervalo: mês fechado × mês fechado.
- Limitações conhecidas e documentadas (não são regressão):
  1. Mês corrente: CDI vai até a última taxa publicada (ex.: 21/09) e a carteira até `asOf` (22/09) → ~1 dia de vantagem para a carteira.
  2. IPCA é índice mensal: o último mês fica até 1 mês atrás (último publicado: ago/2026).
- O CDI tem taxa diária, então o contra-factual com os mesmos fluxos seria exato — mas não entra na UI nesta etapa.

## Código

### `src/domain/dates.ts`

- Novo `daysBetween(a: string, b: string): number` — dias de calendário de `b − a` (positivo se `b` é depois de `a`); parse UTC, sem fuso/DST.

### `src/domain/performance.ts`

- Novo tipo `DatedFlow = { date: string; cents: bigint }` (aporte > 0, resgate < 0).
- `monthlyPortfolioPct(prevValueCents, prevDate, valueCents, valueDate, flows)` — regra acima.
- `xirrPct(startCents, startDate, flows, endCents, endDate): number | null` — taxa anual em %, 4 casas.
- Remover `mwrPct` (TIR mensal por índice de mês).
- `accumulatePct`, `gapPp`, `monthsBeaten` ficam iguais.

### `src/services/history.ts`

- `HistoryPoint` ganha:
  - `asOf: string` — data de valorização do ponto (fim do mês, ou hoje no mês corrente);
  - `flows: DatedFlow[]` — transações do mês com sinal da carteira (BUY = `gross + fees`, SELL = `−gross`), montadas no mesmo laço que já soma `investedCents`/`redeemedCents`.
- `/api/history` não muda (mapeamento de campos explícito na rota).
- Novo `SERIES_START_MONTH = "2025-06"` aplicado em `resolveHistoryWindow` (regra acima).

### `src/services/performance.ts`

- Meses: `monthlyPortfolioPct(prev.marketValueCents, prev.asOf, point.marketValueCents, point.asOf, point.flows)`.
- MWR: `xirrPct(points[0].marketValueCents, points[0].asOf, fluxos de points.slice(1), points.at(-1).marketValueCents, points.at(-1).asOf)` — os fluxos do mês-base não entram (já estão em `V0`); `mwr.periodPct = null` se `months.length = 0`.
- `PerformanceMonth`, `accumulated` e `rendimentoCents` inalterados → API sem mudança de shape.

### `web/`

- Só texto: modais do TWR e do MWR deixam explícito que cada fluxo entra na data em que aconteceu (TWR: peso pelos dias investidos; MWR: TIR dos fluxos datados). Sem novos componentes nem campos.
- Como "desde o início" passa a significar jun/2025 para retorno (e abr/2025 para o capital), o hint do card e os modais mostram a janela efetiva (`performanceTudo.from` – `performanceTudo.to`), o que já acontece hoje.

## Testes

- **Domínio** (`src/domain/performance.test.ts`):
  - `monthlyPortfolioPct`: regressão sem fluxos (+1%); caso real de mai/2025 (1,2083); fluxo no último dia (peso 0); resgate no meio do mês; mês parcial (base 31/08 → valor 22/09, fluxo 17/09 = peso 5/22); `V0 = 0` → null; resgate que zera a base → null.
  - `xirrPct`: sem fluxos, 100k → 110k em 365 dias = 10% a.a. (retorno do período 10%); aporte no meio do caminho; perda extrema sem raiz no intervalo (100k → 5k) → null; nada investido → null.
  - Remover os testes de `mwrPct`.
- **Serviço** (`src/services/performance.test.ts`): fixture existente passa a esperar o mês com aporte no dia 10 ponderado (jun/2025: 0,7519% e acumulado 1,7594%); novo caso com aporte no início do mês; `monthsBeaten`/MWR ajustados; caso sem dados continua null.
- **Janela** (`src/services/history.test.ts`): com transações de abr/2025, `from = 2000-01` clampa em **jun/2025** (era mai); `from` posterior ao piso fica intacto (2025-08); sem transações, `from = 2000-01` também clampa em jun/2025.
- **API** (`src/api/app.test.ts`): sem mudança (não asserta valores).
- **Aceite com dados reais** (medido em 2026-09-22; re-medir após o build):

| Janela | TWR | CDI | IPCA | Gap vs CDI | Meses | MWR |
|---|---|---|---|---|---|---|
| Desde o início (jun/2025 – set/2026, 16 meses) | +19,31% | +19,59% | +4,63% | −0,29 p.p. | 6/16 | +19,37% |
| 1 ano (out/2025 – set/2026) | +13,92% | +14,07% | +3,73% | −0,15 p.p. | 6/12 | +14,01% |

- Mesma janela de 16 meses com o método antigo (sem corte, sem ponderação): TWR +19,67% · MWR +19,62% · 9/16 — referência do "antes".
- mai/2025 isolado (fora da série, mas fixado em teste de domínio): +1,2083% (antes +2,0198%).
- Reconciliação intocada: `referenceCents <valor>`, `unexplained 0`.
- Verificação: `npm test`, `npm run typecheck`, `npm run build:web`, `docker compose up -d --build`, browser em 1280.

## Riscos

- Os números de aceite da S7 documentados (spec e ROADMAP) ficam obsoletos — atualizar a seção de evidências no merge.
- O CDI de set/2026 está parcial; os números acima mudam com o próximo refresh (a verificação re-mede).
- XIRR sem raiz em `[−0,9; 10]` devolve `null` → UI mostra "—".
- Janela com um mês só: sem base, `months.length = 0` → MWR null (já coberto pelo clamp da janela).
- O corte é uma constante manual; se um dia o histórico anterior a abr/2025 for importado, revisar em spec futura (a razão do corte está no comentário do código e nesta spec).
