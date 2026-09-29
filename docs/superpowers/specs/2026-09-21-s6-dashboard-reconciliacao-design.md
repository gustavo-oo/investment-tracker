# S6 — Dashboard + reconciliação

**Resumo:** ligar o dashboard pré-desenhado aos dados da API (cards, tabela de posições, alocação, evolução 12 meses em base 100, selo "atualizado às HH:MM", refresh manual e revalidação a cada 5 min) e provar fidelidade ao legado com reconciliação mês a mês contra `legacy_snapshots`: resíduos de posições encerradas zerados no domínio e cada divergência ativo a ativo classificada com causa. Inclui o reparo do histórico corrompido do B5P211 no Yahoo via Alpha Vantage mensal.

**Depende de:** S2 (schema, import, API), S3 (front), S4 (fontes, refresh, portfolio) e S5 (previdência) concluídas.

**Não faz parte:** CRUD (v2); abas auxiliares (projeção, rebalanceamento); correção do histórico de outras fontes; replicar os bugs do legado.

## Decisões do brainstorming (2026-09-21)

| Tema | Decisão |
|---|---|
| Critério de aceite | Nosso número é o correto: igualdade com o legado não é forçada. Relatório mostra lado legado (<valor> + resíduos = referência <valor>) e lado nosso; **toda divergência precisa de causa**. |
| Exposição | `GET /api/reconciliation?month=YYYY-MM&asOf=YYYY-MM-DD` + seção colapsável "Reconciliação" no Dashboard. |
| Cards | 4 cards com fórmulas próprias (abaixo), não o ponderado por subtipo do legado. |
| Gráfico | Base 100 (carteira, CDI, IPCA) com tooltip mostrando R$ e %. |
| B5P211 | Reparo automático pós-refresh (trechos constantes ≥ 7 dias) via Alpha Vantage **mensal** (plano grátis; a chave do legado foi para o `.env`) + CLI `npm run backfill` para forçar janela. |
| Regra de zeragem | Posição encerrada → exatamente 0,00 (detalhe no domínio). |

## Evidências da investigação (2026-09-21)

Comparação mês a mês contra `legacy_snapshots` (banco real):

| Causa | Evidência |
|---|---|
| **CDI congelado em maio/2026** | 28 ativos CDI com valor de abril = maio no legado (ex.: `cdb-di-01-01-29`: <valor> nos dois). Junho em diante capitaliza a partir da base congelada. Nosso valor fica ~1% maior. |
| **SELIC congelado em junho/2026** | 2 Tesouros Selic com valor de maio = junho (ex.: `tesouro-selic-2031-01-03-31`: <valor> nos dois). |
| **Snapshot de maio/2025 abaixo do principal** | `cdb-di-01-12-28`: compras somam <valor>¢ em 2025-05-07; legado mostra <valor>¢ (−R$ <valor>). Divergência persiste (~+3,3k a +6,2k¢). |
| **B5P211 no Yahoo** | 178 fechamentos presos em R$ <valor> na janela 2025-04-23→2026-01-07 (179 linhas; uma de 24/10 difere); Alpha Vantage mensal confere com o legado (2025-12 = 101,66; 2026-09-18 = 112,49). |
| **Resíduos** | Legado: −<valor>¢ (PagBank) e −<valor>¢; nosso: −167¢ + três ±1¢. Regra de zeragem resolve. |
| **Data de referência do snapshot** | O snapshot de 2026-09 foi gerado em 17/09 com cotações de 16/09 e cota CVM de 15/09 (1.<valor>), misturando datas. |

Aceite de 2026-09 usa `asOf=2026-09-16` (data das cotações do snapshot): RV casa exata, PGBL difere 0,09% (cota publicada depois) e o resgate de 17/09 fica fora da janela.

## Arquitetura

```
web/DashboardView ─► GET /api/portfolio|history|allocation|reconciliation|health
                   └► POST /api/refresh ─► services/refresh (existente + reparo)
GET /api/reconciliation ─► services/reconciliation ─► db (legacy_snapshots) + services/portfolio
services/refresh ─► services/quote-repair ─► domain/quote-runs + sources/alphavantage.fetchMonthly
npm run backfill ─► services/quote-repair.repairWindow ─► sources/alphavantage.fetchMonthly
```

Regras herdadas: `domain` sem I/O; `sources` sem domínio/banco; rotas finas chamam services; leitura calcula on-the-fly.

## Domínio — zeragem de resíduo (`src/domain/position.ts`)

`instrumentValue` aplica a regra ao valor bruto, no fim:

| Tipo | Condição de "posição encerrada" | Efeito |
|---|---|---|
| `equity` / `pension` | `quantityE8 === 0n` | `marketValueCents = 0n` (mesmo sem cotação) |
| `fixed_income` | último movimento de saldo (`BUY`/`SELL`/`AMORTIZATION`) é `SELL`/`AMORTIZATION` **e** `marketValueCents ≤ 1n` | `marketValueCents = 0n` |

- `investedCents`/`redeemedCents`/`feesCents`/`priceCents`/`priceDate` não mudam.
- Resgate parcial (saldo grande) não é tocado; posição aberta nunca é zerada.
- Cobre os casos reais: −167¢, +1¢, −1¢ (legado exibe 0,00 ou −0,00).

## Reconciliação

### Service (`src/services/reconciliation.ts`)

```ts
export type ReconciliationCause =
  | "residuo-zerado" | "transacao-fora-da-janela"
  | "legado-sem-cdi-maio-2026" | "legado-sem-selic-junho-2026" | "legado-snapshot-maio-2025"
  | "fonte-yahoo-corrompida" | "data-de-referencia" | "nao-explicada";

export type ReconciliationResult = {
  month: string; asOf: string;
  totals: { legacyCents: bigint; referenceCents: bigint; ourCents: bigint; diffCents: bigint };
  divergences: Array<{ instrumentId; name; kind; benchmark; legacyCents; ourCents; diffCents; cause: ReconciliationCause }>;
  unexplained: number;
};
```

- **Lado legado:** `listLegacySnapshotByMonth(db, "YYYY-MM-01")`. `referenceCents` = soma de `max(0, value)` (resíduos negativos zerados) → 2026-09 = <valor>.
- **Lado nosso:** `buildPortfolio(db, { asOf })` (novo parâmetro aditivo; sem ele, `toBrDate(now())` como hoje). O domínio já zera resíduos.
- **Posição sem cotação** (`marketValueCents === null`) com legado ≠ 0 → divergência com causa `nao-explicada` (o total soma `0n`, mas o payload não a trata como zero); com legado = 0 não é divergência.
- **`asOf` default:** mês corrente → hoje (BRT); mês passado → `monthEnd(month)`. Validação: `asOf` dentro do mês, senão 400.
- **Causas** (primeira que casar, nesta ordem; as regras 3–4 são o registro explícito dos bugs do legado, não heurística; a regra específica de ativo vem antes das genéricas por benchmark):
  1. `residuo-zerado` — nosso lado exatamente `0n` e o legado exibindo resíduo (`legacyCents <= 1n`: até R$ <valor> positivo ou qualquer negativo).
  2. `transacao-fora-da-janela` — existe transação de saldo com `asOf < tradeDate ≤ monthEnd(month)`.
  3. `legado-snapshot-maio-2025` — `instrumentId === "cdb-di-01-12-28" && month ≥ "2025-05"`.
  4. `legado-sem-cdi-maio-2026` — `benchmark === "CDI" && month ≥ "2026-05" && diffCents > 0`.
  5. `legado-sem-selic-junho-2026` — `benchmark === "SELIC" && month ≥ "2026-06" && diffCents > 0`.
  6. `fonte-yahoo-corrompida` — `ticker === "B5P211" && month ≤ "2026-01"` (deixa de ocorrer após o reparo).
  7. `data-de-referencia` — `|diffCents| ≤ 0,5% × |legacyCents|` (legacy ≠ 0): cobre a data exata do snapshot (ex.: B5P211 jun/2025 = 0,27%) e a cota CVM de 15/09.
  8. `cotacao-fora-da-janela` — `kind` equity/pension no **mês corrente** com `|diffCents| ≤ 5% × |legacyCents|`: a cotação andou depois do snapshot do legado (visão ao vivo; ex.: WRLD11 1,34% em 5 dias).
  9. `nao-explicada` — fallback; visível na API/UI.

### Rota (`src/api/routes/reconciliation.ts`)

`GET /api/reconciliation?month=YYYY-MM&asOf=YYYY-MM-DD` → JSON com `bigint` convertido por `toNumberSafe` (padrão das rotas existentes). `month` opcional (default: mês corrente BRT; 400 se inválido); `asOf` opcional (400 se fora do mês). Registrada em `src/app.ts`.

## Reparo de cotações (trechos constantes)

O Yahoo devolveu 178 dias presos em R$ <valor> (2025-04-23→2026-01-07) para o B5P211. O reparo é **automático e idempotente** e vale para qualquer ticker que trave no futuro.

- `src/sources/alphavantage.ts` ganha `fetchMonthly(symbols, from, to): Promise<Quote[]>` (`function=TIME_SERIES_MONTHLY`, disponível no plano grátis); mesma validação de recusa/série.
- `src/domain/quote-runs.ts` (puro): `findConstantRuns(quotes, { minDays = 7, today })` → trechos de fechamentos idênticos consecutivos com ≥ 7 linhas, **encerrados antes de hoje** (histórico fechado); entrada ordenada por data. Evidência: maior trecho legítimo hoje = 2 dias (WRLD11/VWRA11); B5P211 tem 130d e 48d.
- `src/services/quote-repair.ts`:
  - `repairConstantRuns(db, deps)`: para cada instrumento `equity` com `ticker`, detecta trechos constantes, busca a série mensal da AV nos **meses-calendário** que contêm a janela (a AV só devolve fim de mês), **apaga** `quotes` do ticker na janela e grava as novas em transação única (fins de mês do mês inicial ao final; fora da janela é upsert do mesmo fechamento diário). Erro de um ticker não impede os outros (vai no resumo como `error`); falha da AV não altera nada.
  - **Trava:** se a AV não devolver nenhum ponto de **mês fechado** nos meses da janela, nada é apagado (`skipped`, sem perda de dados). O mês corrente é ignorado (a série mensal da AV inclui um parcial atualizado em tempo real, que não pode ser travado como `settled = 1`).
  - `repairWindow(db, { ticker, from, to })`: reparo forçado (usado pelo CLI).
  - Resumo: `Array<{ ticker, from, to, deleted, inserted, error? }>`.
- Integração: `services/refresh.ts` roda `repairConstantRuns` **depois do passo de cotações** (modos full e `quotesOnly`); `source=cvm-swb` não roda. O resultado vai no summary do refresh (`repairs`, aditivo em `POST /api/refresh`).
- Trechos que **começam no mês corrente** são pulados antes de consultar a fonte: não há mês fechado para repor e a AV não gasta cota (o job de 10 min tentaria de novo indefinidamente). Trechos que cruzam o mês continuam reparáveis pelo mês fechado.
- CLI `npm run backfill` (`src/backfill-cli.ts` — entry point na raiz de `src/`, fora de `sources/`, para não violar "sources sem banco/domínio"; `node --env-file-if-exists=.env ...`): args `--ticker --from --to`; força `repairWindow`; sem `ALPHAVANTAGE_API_KEY` → erro claro.
- **Quando é necessário:** quem copia `data/` (backup) não roda nada — o reparo viaja no banco. O CLI serve para forçar uma janela ou ao reconstruir o banco do zero (ordem: `import` → `refresh` → reparo; o refresh do startup já dispara o automático). Documentar no README (Homelab).
- Uso real: `npm run backfill -- --ticker B5P211 --from 2025-04-23 --to 2026-01-07` (179 linhas da janela → 9 pontos mensais).

## Dashboard (`web/`)

- `web/src/api.ts`: tipos + `getPortfolio`, `getHistory(from)`, `getAllocation(by)`, `getReconciliation()`, `postRefresh()`.
- `DashboardView.tsx` (substitui os placeholders):
  - **Cards:** patrimônio = `totals.marketValueCents`; capital = `investedCents − redeemedCents`; rendimento = patrimônio − capital (R$ e % sobre o capital); rentabilidade 12m = carteira vs CDI vs IPCA (carteira: `(V_hoje + Σresgates₁₂m − Σaportes₁₂m − V₁₂m_atrás) ÷ V₁₂m_atrás`; CDI/IPCA acumulados dos `cdiPct`/`ipcaPct` mensais de `/api/history`).
  - **Posições:** tabela ordenada por valor (ativo, categoria, quantidade, preço, valor, % da carteira, selo `stale`).
  - **Alocação:** 3 cards (categoria, corretora, objetivo) com valor, % e barra CSS.
  - **Evolução 12 meses:** Recharts `LineChart` em base 100 (carteira, CDI, IPCA acumulados no início da janela); tooltip com patrimônio em R$ e percentuais.
  - **Cabeçalho:** selo "atualizado às HH:MM" = maior `lastSuccessAt` de `/api/health`; botão "Atualizar cotações" → `POST /api/refresh` → refetch; erro em callout.
  - **Revalidação:** `setInterval` de 5 min refaz os GETs (sem refresh de fontes); limpo no unmount.
  - **Reconciliação:** `<details>` com totais (legado/referência/nosso/diff), badge "N divergências explicadas" e tabela de divergências (ativo, legado, nosso, diff, causa legível).
- Dependência nova: `recharts` (lockfile sincroniza junto).
- Estados de carregamento/erro/vazio seguem os padrões da `ImportView`.

## Erros e observabilidade

- Fonte fora do ar: comportamento atual (último valor + `stale`) já cobre; o selo do dashboard mostra a hora do último sucesso e marca fontes `stale`.
- `nao-explicada` conta no payload e aparece na UI em destaque — aceite exige 0 em 2026-09.
- O reparo não altera `source_status` (é reparo de dados, não coleta); a `source` das linhas fica `alphavantage`. Falhas e `skipped` aparecem em `repairs[]` na resposta de `POST /api/refresh` e no log.

## Testes (sem rede, `node --test`)

- Domínio: RF encerrada com resíduo negativo → 0; ±1¢ → 0; resgate parcial intacto; posição aberta intacta; RV/PGBL com `quantity = 0` → 0 mesmo sem cotação.
- `findConstantRuns`: trecho ≥ 7 detectado; < 7 ignorado; trecho que termina hoje ignorado; múltiplos trechos; valor diferente quebra o trecho.
- Reparo: substitui a janela (delete + insert); idempotente (segunda execução não acha trecho); AV sem pontos na janela não apaga nada; falha da AV não altera dados e não derruba os outros tickers; só `equity`.
- Refresh: full e `quotesOnly` chamam o reparo; `source=cvm-swb` não; resumo com `repairs`.
- Reconciliação (banco em memória com fixtures): referência = negativos zerados; cada uma das 8 causas; ordem das regras; `asOf` default (mês corrente × passado); divergência não explicada conta 1; mês vazio.
- Rota: 200 com totais; `month` inválido → 400; `asOf` fora do mês → 400.
- CLI: janela forçada + contagens (fetch fake); sem chave → erro.
- Alocação: soma dos grupos por categoria = total do portfólio (fixture).

## Aceite

1. `npm test` verde; `npm run typecheck` limpo; `npm run build:web` ok.
2. `npm run backfill -- --ticker B5P211 --from 2025-04-23 --to 2026-01-07` → `deleted = 179`, `inserted = 10` (9 na janela + o fechamento de 2026-01-30 do mês final); segunda execução não muda nada (trecho constante some).
3. `GET /api/reconciliation?month=2026-09&asOf=2026-09-16` → `referenceCents = <valor>`, `unexplained = 0`, classes esperadas: 21 `legado-sem-cdi-maio-2026`, 2 `legado-sem-selic-junho-2026`, 1 `legado-snapshot-maio-2025`, 1 `residuo-zerado`, 1 `transacao-fora-da-janela`, 1 `data-de-referencia`.
4. Dashboard no browser: cards com números do banco, tabela, alocação somando o total, gráfico base 100 com tooltip em R$, selo de hora, botão de refresh funcionando, seção de reconciliação com 0 não explicadas.
5. Docker de pé em `:3000`; `/api/health` ok.

## Riscos

- Classificador mascarar bug novo: regras são lista explícita e ordenada, `nao-explicada` fica visível e o aceite exige zero em 2026-09.
- Tolerância de 0,5% em `data-de-referencia`: documentada; se um mês futuro divergir mais que isso, aparece como não explicada.
- Recharts (~100 kB) no bundle: aceitável para app local.
- Chave Alpha Vantage do legado está exposta no repositório antigo → funciona no plano grátis, mas deve ser rotacionada; fica só no `.env` (gitignored).
- Detecção com 7 dias pode pegar ativo ilíquido com fechamento repetido legítimo: hoje o maior trecho legítimo é 2 dias; a trava "AV sem pontos não apaga" evita perda de dados e a janela reparada troca diário por mensal (aceitável para valores mensais/reconciliação).
- Yahoo pode re-corromper o histórico: o reparo automático pós-refresh conserta na execução seguinte (1 request AV por trecho; plano grátis = 25/dia).

## Referências

- Roadmap: `ROADMAP.md` §Etapa 6 e §Definição de pronto da v1.
- Specs: design v1 (`2026-09-17-modernizacao-app-investimentos-design.md`), S4 (`2026-09-18-s4-cotacoes-indices-portfolio-design.md`), S5 (`2026-09-20-s5-previdencia-cvm-swb-design.md`).
- Legado: `legacy/apps-script/update_all.js` e `asset_manager.js` (bugs de maio/2026), `stocks_api.js` (chave Alpha Vantage).
