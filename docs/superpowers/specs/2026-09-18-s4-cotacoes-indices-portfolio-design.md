# S4 — Cotações, índices e portfolio

**Resumo:** coletar cotações de RV (Yahoo, com fallback Alpha Vantage), índices do BCB (CDI, Selic, IPCA), calcular posição RF/RV com aritmética inteira e expor `/api/portfolio`, `/api/history`, `/api/allocation`, `POST /api/refresh`. Job no processo (`node-cron`). Nada de UI — o dashboard liga os dados na S6.

**Depende de:** S2 (schema, import, API) e S3 (front) concluídas.

**Não faz parte:** previdência PGBL/CVM (S5); dashboard/Recharts (S6); persistir `valuations` e rendimento % ponderado (S6); PTAX (removido — sem consumidor); Alpha Vantage como fonte primária.

## Decisões do brainstorming (2026-09-18)

| Tema | Decisão |
|---|---|
| Endpoint Yahoo | Chart v8 por ticker (`/v8/finance/chart/{TICKER}.SA?interval=1d`), sem chave; `close` bruto (não `adjclose`). |
| Fonte RV | Yahoo primária; Alpha Vantage `TIME_SERIES_DAILY` (`.SAO`) como fallback automático, chave no `.env`. |
| Gatilho do fallback | Yahoo falhou para o ticker **e** não existe cota AV do dia para ele (throttle ≤ 3 req/dia no free tier). Sem chave = fallback desligado. |
| Correção RF | Espelhar a regra do legado: capitalização diária por operação, compra D+0 / venda D−1, fim de semana/feriado cai na próxima taxa publicada. Aritmética inteira; arredonda uma vez por ativo. |
| Escrita | Dia fechado é imutável. Linha de hoje (`settled = 0`) pode ser sobrescrita; no primeiro fetch do dia seguinte vira `settled = 1` com o fechamento oficial. BCB sempre `INSERT OR IGNORE`. |
| Janela do fetch | Fronteira exata: `from = max(date)` por ticker/série; banco vazio → 1ª transação (2025-04-23). `?full=1` refaz desde o início e só insere buraco / finaliza pendente. |
| `valuations` | Não gravar nesta etapa — histórico calculado on-the-fly (import invalida cache; cálculo é barato). |
| Rendimento % | Adiado para a S6 (base ponderada por dias é a parte ligada à reconciliação). |
| PTAX | Removido do escopo e do design pai (sem ativo em USD). |

## Arquitetura

```
jobs (cron/startup) ─┐
POST /api/refresh ───┼─► services/refresh ──► sources/{yahoo,alphavantage,bcb}
                     │        │                        │
                     │        ▼                        ▼
                     │   db: quotes (settled) / index_rates / source_status
                     ▼
GET /api/portfolio|history|allocation ──► services/* ──► domain (puro) ──► db (leitura)
```

Regras de dependência (herdadas): `domain` sem I/O; `sources` sem domínio/banco; rotas finas chamam services; leitura calcula on-the-fly com domínio puro.

## Contratos de fonte

```ts
export type Quote = { ticker: string; date: string; closeCents: bigint };
export type IndexRate = { series: "CDI" | "SELIC" | "IPCA"; date: string; valueE12: bigint };

export type QuoteSource = {
  id: "yahoo" | "alphavantage";
  available(): Promise<boolean>;
  fetchDaily(symbols: string[], from: string, to: string): Promise<Quote[]>;
};

export type IndexSource = {
  id: "bcb";
  fetchSeries(series: "CDI" | "SELIC" | "IPCA", from: string, to: string): Promise<IndexRate[]>;
};
```

- Registro explícito em `src/sources/index.ts`; `fetch` e `now` injetáveis (teste sem rede).
- **Yahoo:** chart v8 por ticker, símbolo `${ticker}.SA`; timestamp unix → data BRT (`America/Sao_Paulo`); `null`/`≤ 0` pulado; `chart.error` ou HTTP ≠ 200 → erro do ticker (não grava lote).
- **Alpha Vantage:** `TIME_SERIES_DAILY&outputsize=full&symbol=${ticker}.SAO`, filtrado na janela; `Note`/`Information`/`Error Message` = erro, nunca dado.
- **BCB:** SGS `12` (CDI diário), `11` (Selic diária), `433` (IPCA mensal); `dataInicial`/`dataFinal` dd/mm/yyyy; valor em % → fração e12 (`0,0524% → <valor>`).
- `quotes.ticker` guarda o ticker B3 (`WRLD11`); sufixo do provedor é detalhe do adapter. `quote_symbol` de RV continua NULL.

Desvio do design pai: `QuoteSource` e `IndexSource` separados (o contrato único devolvia `Quote[]` e não representava índice em e12). O registro explícito e o formato geral do contrato se mantêm.

## Persistência

Migration nova `src/db/migrations/002_quotes_settled.sql`:

```sql
ALTER TABLE quotes ADD COLUMN settled INTEGER NOT NULL DEFAULT 0;

CREATE TABLE source_status (
  source TEXT PRIMARY KEY,         -- yahoo | alphavantage | bcb
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_error_at TEXT,
  last_error TEXT
);
```

Regras de escrita (guardas: data ≤ hoje BRT, valor > 0, lote atômico por ticker/série):

| Caso | SQL | Efeito |
|---|---|---|
| `date < hoje` | `INSERT ... VALUES (..., settled=1) ON CONFLICT(ticker,date) DO UPDATE SET close_cents=excluded.close_cents, source=excluded.source, settled=1, fetched_at=excluded.fetched_at WHERE quotes.settled = 0` | Insere dia faltante; finaliza parcial pendente (0→1); **nunca** toca `settled = 1` |
| `date = hoje` | `INSERT ... VALUES (..., settled=0) ON CONFLICT(ticker,date) DO UPDATE SET ... WHERE quotes.settled = 0` | Insere/atualiza o bar corrente |
| `index_rates` | `INSERT OR IGNORE` | BCB publicado é definitivo |

- `fetched_at` só muda quando há escrita; linha `settled = 1` mantém o valor original.
- Fronteira: `from = max(date)` do ticker/série; vazio → `MIN(trade_date)` de `transactions`. `?full=1` → `from = MIN(trade_date)`.
- `?full=1` nunca sobrescreve fechado: preenche buracos e finaliza `settled = 0` pendentes.
- Correção de valor fechado errado: manual (fora do caminho automatizado).

## Domínio (puro)

**RF** — `capitalizeRf(ops, rates, multiplierE6, asOf)`:

```
dia  = 1e12 + divRoundHalfUp(valueE12 × multiplierE6, 1e6)   // fator diário, e12
F    = Π dia  (taxas com op.date ≤ rate.date ≤ asOf)          // divRoundHalfUp(..., 1e12) por passo
valor = Σ op.grossCents × F   (sinal de BUY +, SELL −)        // acumulado em cents×1e12
valor = divRoundHalfUp(acumulado, 1e12)                       // arredonda 1× por ativo
```

- Compra rende o índice do próprio dia (D+0); venda remove principal + juros do dia (D−1).
- Sábado/domingo/feriado: primeira taxa com `date >= data da operação`.
- RF sem saldo → `0` (resíduo em `(−1, 1)` centavo zerado).
- Insumos: `benchmark` CDI → série CDI, SELIC → série SELIC; `rate_e6` = multiplicador.

**RV** — `equityValue(sharesE8, quotes, asOf)`: quantidades assinadas somadas; preço = último `close` com `date ≤ asOf`; valor = `mulScaled(sharesE8, closeCents, SHARES_SCALE)`. Sem cota → `marketValue: null` + `stale`.

**Histórico** — para cada mês de `from` a `to` (default: 12 meses até o corrente): posição no último dia do mês (ou hoje, no mês corrente), `investedCents` = Σ BUY(bruto+taxas) do mês, `redeemedCents` = Σ SELL(bruto) do mês, `cdiPct` = (Π fatores diários do mês − 1) em %, `ipcaPct` = série 433 do mês em %.

**Alocação** — agrega valor de mercado por `category`, `broker` ou `objective`.

Precisão: BigInt e12 interno; `Number` só na borda da API (`toNumberSafe`).

## Serviços e rotas

`services/refresh(db, opts)`:
- Mutex in-process: um refresh em andamento → `409 { error: "refresh em andamento" }` (sem coalescer `?full=1` com refresh normal).
- Por fonte: calcula `from`, busca, valida, grava em transação por ticker/série, atualiza `source_status`.
- Fallback AV: por ticker, se Yahoo falhou e não há cota AV do dia (BRT) → tenta AV; falha mantém o último valor + `stale`.
- Retorna `{ sources: [{ id, fetched, inserted, updated, skipped, errors[] }] }`.
- Sem `source`, atualiza todas as fontes (cotações + índices).

| Rota | Resposta |
|---|---|
| `GET /api/portfolio` | `{ asOf, totals: { investedCents, redeemedCents, feesCents, marketValueCents }, positions: [{ instrumentId, name, kind, category, broker, objective, benchmark, rateE6, quantityE8, priceCents, priceDate, marketValueCents, investedCents, redeemedCents, feesCents, stale }], sources }` |
| `GET /api/history?from=YYYY-MM&to=YYYY-MM` | `[{ month, marketValueCents, investedCents, redeemedCents, cdiPct, ipcaPct }]` |
| `GET /api/allocation?by=category\|broker\|objective` | `{ by, groups: [{ key, marketValueCents, pct }] }`; default `category` |
| `POST /api/refresh?full=1&source=yahoo\|alphavantage\|bcb` | Resumo do refresh; `source=alphavantage` sem chave → 400 |
| `GET /api/health` | Ganha `sources: [{ id, lastAttemptAt, lastSuccessAt, lastErrorAt, lastError, stale }]`; `stale` = última tentativa falhou e é mais recente que o último sucesso; linha `alphavantage` só existe com chave configurada |

- PGBL ainda não entra no cálculo (S5): a posição aparece com `kind: "pension"`, `marketValueCents: null` e `stale: true`. A exibição é da S6.
- Cents/quantidades emitidos como `number` (convenção atual da API). `pct`/`cdiPct`/`ipcaPct` como `number` na borda.

## Job

- Nova dependência `node-cron` (lockfile sincroniza no trunk).
- Cotações: `*/10 10-17 * * 1-5`; índices: `0 7 * * *`; TZ `America/Sao_Paulo`.
- Refresh no startup após o `listen` (não bloqueia; erro só loga).
- Sem calendário de feriados da B3 — Yahoo devolve o último fechamento; dias sem dado não geram linha.
- `src/jobs/scheduler.ts` chamado só pelo `server.ts` (app de teste não agenda).

## Erros e observabilidade

- Fonte fora do ar não derruba nada: mantém último valor, registra erro em `source_status`, marca `stale` no health e nas posições daquela fonte.
- Erro por ticker não impede os outros (lote atômico por ticker/série).
- Logs em JSON (pino/Fastify); sem segredo em log.

## Testes (sem rede, `node --test`)

- Adapters com fixtures: Yahoo com `close: null` e `chart.error`; AV com `Note` de limite; BCB com `dd/mm/yyyy` e % → e12.
- Domínio: compra D+0 e venda D−1; operação em fim de semana; multiplicador 106%; posição encerrada = `0` exato; RV com cota anterior ao `asOf` e sem cota.
- Serviços (fetch fake): passado imutável (`settled = 1` não é tocado); hoje sobrescreve; transição 0→1 no fetch do dia seguinte; throttle AV; `?full=1` preenche buraco e finaliza pendente; falha mantém último + `stale`.
- Rotas: shapes de `/api/portfolio`, `/api/history`, `/api/allocation`, `/api/refresh` e `sources` no health.

## Aceite

1. `npm test` verde; `npm run typecheck` limpo; `npm run build:web` ok.
2. Refresh real popula `quotes` (3 tickers, desde 2025-04) e `index_rates` (CDI/Selic/IPCA).
3. `/api/portfolio` com 48 posições (3 RV + 44 RF + 1 pension pendente), RV = cotas × último fechamento, RF capitalizada, sem negativo indevido; total de mercado na ordem do referencial de setembro/2026 (reconciliação centavo a centavo e resíduos ficam para a S6).
4. Fonte fora do ar mantém último valor + `stale` (teste offline).
5. Docker de pé em `:3000`; `/api/health` mostra as fontes com última coleta/erro.

## Riscos

- Yahoo não é oficial: adapter isolado, fallback AV com throttle, `stale` visível.
- Buraco do provedor no meio de janela já passada exige `?full=1` (fronteira exata).
- Chave do Alpha Vantage do legado estava hardcoded → rotacionar; só no `.env`.
- `close` bruto não corrige split: cotações antigas ficariam em escala antiga e o reparo seria manual (a escrita nunca sobrescreve `settled = 1`).
- Divergência vs planilha: reconciliação ativo a ativo é a S6.

## Referências

- Design pai: `docs/superpowers/specs/2026-09-17-modernizacao-app-investimentos-design.md` (PTAX removido nesta spec).
- Roadmap: `ROADMAP.md` §Etapa 4 (PTAX removido; decisões resolvidas).
- Legado da regra RF: `legacy/apps-script/asset_manager.js` (`CdiAsset`, `SelicAsset`, `StockAsset`).
