# S5 — Previdência CVM SWB

**Resumo:** coletar a cota diária do PGBL na tela pública SWB da CVM (mesmo fluxo do legado: GET + POST `ddComptc`, parse da tabela-calendário), persistir em `fund_quotas` com precisão `e12` e entrar no cálculo de posição/histórico (`/api/portfolio`, `/api/history`). Job diário às 07:00 BRT + startup + refresh manual `?source=cvm-swb`, cache em memória de 6h. Nada de UI — o dashboard liga os dados na S6.

**Depende de:** S2 (schema, import, API), S3 (front) e S4 (fontes, refresh, portfolio) concluídas.

**Não faz parte:** dashboard/Recharts e reconciliação (S6); dados abertos da CVM em ZIP (avaliado e descartado); CRUD (v2); edição retroativa de cota publicada.

## Decisões do brainstorming (2026-09-20)

| Tema | Decisão |
|---|---|
| Identificador | `quote_symbol` (hoje `<valor>` = `PK_PARTIC`). Confirmado no banco: 1 único ativo `pension`. |
| Fonte | Scraping da tela SWB (`CPublicaInfdiario.aspx`), como o legado; identificador direto, 2 requests por mês. |
| Frequência | 1×/dia às 07:00 BRT (junto do BCB) + startup + `POST /api/refresh?source=cvm-swb`; cache 6h por `symbol:YYYY-MM`. |
| Precisão da cota | `quota_e12` (12 casas, mesma resolução da publicação da CVM). Centavos perderiam ~R$ <valor> na posição. |
| Persistência | Tabela nova `fund_quotas`; `quotes` continua exclusiva de RV (centavos). |
| Regra de valor | Última cota com `date ≤ asOf` (consistente com RV). O legado usava "cota mais próxima no mês"; em fim de mês dá o mesmo resultado — agosto/2026 reproduz centavo a centavo. Divergências residuais ficam para a S6. |
| Retry/warmup | Sem retry e sem warmup: falha → `stale` (o teste direto em 2026-09-20 funcionou sem isso). |
| ZIP de dados abertos | Descartado: exige lib de ZIP, download de ~12 MB/mês e mapa `<valor> → CNPJ` que não existe no banco. |

Verificação da fonte (2026-09-20): SWB `PK_PARTIC=<valor>` devolve a classe `CNPJ <valor>/0001-50`; as cotas batem linha a linha com `inf_diario_fi_AAAAMM.zip` dos dados abertos (ex.: 2026-08-31 = `1.<valor>`; 2026-09-17 = `1.<valor>`). O nome do ativo cita outro CNPJ (`<valor>/0001-27` — outra classe do mesmo fundo); o operacional é o `quote_symbol` e o import não muda.

## Arquitetura

```
scheduler 07:00 ───┐
POST /api/refresh ─┼─► services/refresh ──► services/refresh-pension ──► sources/cvm-swb
startup ───────────┘         │                                              │
                             ▼                                              ▼
                     db: source_status                     db: fund_quotas (settled)
GET /api/portfolio|history ─► services/* ─► domain (instrumentValue) ─► db (leitura)
```

Regras herdadas: `domain` sem I/O; `sources` sem domínio/banco; rotas finas chamam services; leitura calcula on-the-fly.

## Contrato de fonte

```ts
export type FundQuota = { symbol: string; date: string; quotaE12: bigint };

export type FundQuotaSource = {
  id: string; // "cvm-swb"
  fetchDaily(symbols: string[], from: string, to: string): Promise<FundQuota[]>;
};
```

- `FetchLike` ganha `init?: RequestInit` opcional (aditivo; Yahoo/BCB seguem chamando só com URL).
- Fluxo por símbolo e mês (de `from.slice(0,7)` a `to.slice(0,7)`):
  1. GET `.../CPublicaInfdiario.aspx?PK_PARTIC=<symbol>&PK_SUBCLASSE=-1` com headers de navegador; extrai `__VIEWSTATE`, `__VIEWSTATEGENERATOR`, `__EVENTVALIDATION` e o cookie (`Set-Cookie` → primeiro par, como o legado).
  2. POST `application/x-www-form-urlencoded` com `__EVENTTARGET=ddComptc` e `ddComptc=MM/YYYY`, `Origin`/`Referer` do SWB e o cookie.
  3. Parse da tabela-calendário: células `td/th` limpas (tags, NBSP); linha válida = `cells[0]` = dia `^\d{1,2}$` e `cells[1]` = cota pt-BR (`<valor>`); data = `ano-mês-dia` validada no calendário; dias vazios (18, 19…) são descartados. Cota > 0.
- Erros: HTTP ≠ 200, `Página de Erro`/`Ocorreu um erro de processamento`, viewstate ausente, cota ilegível → erro do símbolo (lote não é gravado). Mês sem nenhuma linha → devolve `[]` para aquele mês.
- Cache 6h em memória (`Map<string, { at: number; rows: FundQuota[] }>`, chave `symbol:YYYY-MM`, `now` injetável); só sucesso é cacheado.
- Sem aquecedor/retry: a próxima execução (07:00 seguinte ou refresh manual) tenta de novo; falha visível em `source_status`.

## Persistência

Migration nova `src/db/migrations/003_fund_quotas.sql`:

```sql
CREATE TABLE fund_quotas (
  symbol TEXT NOT NULL,
  date TEXT NOT NULL,
  quota_e12 INTEGER NOT NULL,     -- cota em reais × 1e12
  source TEXT NOT NULL,
  settled INTEGER NOT NULL DEFAULT 0,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (symbol, date)
);
```

Regras de escrita (`writeFundQuotas`), idênticas às de `writeQuotes`:

| Caso | Efeito |
|---|---|
| `date < hoje` (BRT) | Insere dia faltante ou finaliza `settled = 0` pendente com `settled = 1`; nunca sobrescreve `settled = 1`. |
| `date = hoje` | Insere/atualiza a linha do dia (`settled = 0`). |
| `?full=1` | Rebusca desde a 1ª transação; preenche buracos e finaliza pendentes; nunca toca linha fechada. |

Repos: `writeFundQuotas`, `fundQuotaFrontier(db, symbol)`, `listAllFundQuotas(db)` (ordem symbol, date) devolvendo `{ symbol, date, quotaE12, source, settled }`.

## Domínio (puro)

```ts
export type PensionQuotePoint = { date: string; quotaE12: bigint };

pensionValueCents(quantityE8, quotas, asOf)
// última cota com date <= asOf
// marketValueCents = divRoundHalfUp(quantityE8 * quotaE12, 1e18)   // e8 × e12 = e20 reais ÷ 1e18 = centavos
// priceCents       = divRoundHalfUp(quotaE12, 1e10)                // exibição
// sem cota         = { null, null, null }
```

- `PositionInput` ganha `pensionQuotes?: PensionQuotePoint[]` (default vazio); o branch `pension` de `instrumentValue` passa a calcular em vez de devolver `null`.
- Arredondamento único no fim (mesma convenção da S4); `quota_e12` preserva a resolução publicada.
- Sem cota (`null`) → posição `stale` como as demais.

## Serviços e rotas

- `services/refresh-pension.ts` espelha `refresh-quotes.ts`:
  - Símbolos = `instruments` com `kind = "pension"` e `quote_symbol` não nulo.
  - `from = full ? earliestTradeDate : (fundQuotaFrontier(symbol) ?? earliestTradeDate)`; `to = hoje` (BRT).
  - Valida `date <= hoje` e `quotaE12 > 0`; grava em transação; summary `id = "cvm-swb"`; `recordSourceAttempt` ao tentar.
  - Falha → mantém o último valor gravado, grava erro e não derruba cotações/índices (fontes separadas).
- `services/refresh.ts` ganha `pensionSource?: FundQuotaSource` em `RefreshDeps`:
  - `source` ausente → cotações + índices + previdência; `quotesOnly` (job de 10 min) → só cotações; `source = "cvm-swb"` → só previdência; fonte desconhecida → 400.
- `services/portfolio.ts` e `services/history.ts`: para `kind = "pension"`, série = `fundQuotas` do `quote_symbol`; `priceSource` = fonte da última cota `≤ asOf`; `stale` pelo `source_status` correspondente.
- `POST /api/refresh?source=cvm-swb` passa pela validação existente; `GET /api/health` lista `cvm-swb` automaticamente via `source_status`.

## Job

- A tarefa diária das 07:00 BRT (`0 7 * * *`, TZ `America/Sao_Paulo`) roda índices BCB e previdência. As duas chamadas são encadeadas (BCB e, ao terminar, `cvm-swb`) para não colidir com o mutex de `refresh()`; erro de uma não impede a outra.
- Job de 10 min do pregão continua só cotações (`quotesOnly`).
- Startup (`refresh({})`) inclui previdência sem bloquear o `listen`; erro só loga.

## Erros e observabilidade

- Fonte fora do ar/limitada: mantém último valor, registra `source_status("cvm-swb")` e marca `stale` no health e na posição PGBL; RF/RV não são afetadas.
- Erro de um símbolo não impede os outros (hoje só existe um).
- Logs JSON (pino/Fastify); sem segredo em log (a fonte não usa chave).

## Testes (sem rede, `node --test`)

- Fonte com fixtures HTML: GET + POST de um mês real; dia vazio; cota pt-BR (`1.<valor>`); data inválida; página de erro; HTTP 500; viewstate ausente; iteração de múltiplos meses; cache 6h (segunda chamada não toca o fetch) e erro não cacheado.
- Domínio: valor exato com dados reais (<valor> cotas × `1.<valor>` = `<valor>` centavos); última cota ≤ `asOf`; sem cota → `null`; quota do dia seguinte não é usada.
- Serviços: fronteira por símbolo; passado imutável (`settled = 1`); hoje sobrescreve; `full` preenche buraco; falha mantém último + `stale`; `source = cvm-swb` só previdência; `quotesOnly` não busca previdência.
- Rotas: `/api/portfolio` com PGBL `marketValueCents` e `priceCents` preenchidos; `sources` com `cvm-swb` no health.

## Aceite

1. `npm test` verde; `npm run typecheck` limpo; `npm run build:web` ok.
2. `POST /api/refresh?source=cvm-swb` grava a série do mês corrente; conferir contra o site da CVM 3 datas (ex.: 2026-09-17 = `1.<valor>`).
3. `/api/portfolio`: PGBL com `quantityE8 = <valor>`, `marketValueCents` = cota de 2026-09-17 × cotas (`<valor>` centavos), `stale = false`; total inclui a previdência (antes ficava `null`).
4. Fonte fora do ar (teste offline com fetch fake que falha) mantém último valor + `stale` sem derrubar o resto.
5. Docker de pé em `:3000`; `/api/health` com `cvm-swb` e última coleta/erro.

## Riscos

- Raspagem frágil (layout ASP.NET/VIEWSTATE, bloqueio de IP): módulo isolado, parser com fixture, falha → `stale`; nunca derruba o app.
- Cache 6h mascara correção intradiária da cota de hoje: aceitável (publicação é diária).
- Regra `≤ asOf` vs "mais próxima" do legado: agosto/2026 confere centavo a centavo; divergência residual de setembro/2026 vai para a reconciliação da S6.
- Sem retry: uma janela de indisponibilidade da CVM deixa o dia sem cota até o próximo refresh manual; o valor de mercado continua com a última cota + `stale`.

## Referências

- Legado: `legacy/apps-script/investment_fund_api.js` (`getMonthlyQuotasFromSWB`, `getQuotaFromSWBOnDate`).
- Roadmap: `ROADMAP.md` §Etapa 5.
- Spec anterior: `docs/superpowers/specs/2026-09-18-s4-cotacoes-indices-portfolio-design.md`.
