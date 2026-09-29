# Modernização do tracker de investimentos — Design (v1)

**Resumo:** substituir a planilha Google + Apps Script por um app web local (monólito Node + SQLite) empacotado em Docker para rodar no homelab. A v1 é read-only (dashboard) com import da planilha e cotações via Yahoo Finance, BCB e CVM. A arquitetura é preparada para crescer: novas fontes, novas visualizações e CRUD na v2.

## Contexto

- Legado em `legacy/apps-script/` (14 arquivos), dados extraídos em `data/csv/` e `data/Investimentos.xlsx`.
- Números atuais: 48 ativos, 119 operações, 22 meses de histórico (2024-12 → 2026-09), total em 2026-09 = **R$ <valor>**.
- Fontes do legado: Alpha Vantage (ações, chave hardcoded, 25 req/dia), BCB SGS (CDI=12, Selic=11, IPCA=433), raspagem do site da CVM/SWB (previdência PGBL).
- Dores: lento, frágil, difícil de evoluir, sem UI de verdade.

## Objetivo da v1

Dashboard local read-only, atualizado intraday, com os mesmos números do legado — validado contra setembro/2026.

## Fora de escopo (v1)

- CRUD de transações/ativos pela UI (fica para a v2).
- Projeção até 2099, rebalanceamento, abas auxiliares da planilha.
- Login/multiusuário (uso single-user no homelab).
- Publicação de imagem no GHCR (opcional no futuro).

## Stack

| Camada | Escolha | Por quê |
|---|---|---|
| Runtime | Node 22 + TypeScript (type-stripping nativo, sem build no back) | já instalado; lógica do legado é JS |
| HTTP | Fastify | enxuto, validação de schema |
| Banco | SQLite (`better-sqlite3`) + migrations numeradas | arquivo único, backup fácil, sem servidor |
| Front | Vite + React + TS + Recharts | fácil adicionar views |
| Jobs | `node-cron` no próprio processo | 1 container só |
| Container | Docker multi-stage (`node:22-slim`) + compose | homelab |

## Arquitetura (pastas)

```
src/
  domain/        # cálculo puro, sem I/O
  sources/       # 1 arquivo por fonte + index.ts (registro explícito)
  services/      # casos de uso (refresh, portfolio, snapshots)
  db/            # conexão, migrations/001.., repositórios finos
  api/routes/    # 1 arquivo por recurso
  jobs/          # agendamentos
  server.ts
web/
  src/views/     # 1 componente por visualização
  src/components/ src/api.ts
```

Regras de dependência:
- `domain` não importa `db`, `api` nem `sources`.
- `sources` não conhecem domínio; expõem contrato fixo.
- `api/routes` são finas: validam entrada e chamam `services`.
- Schema muda só via migration nova; migration antiga nunca é editada.

Como estender:
- **Nova fonte:** criar arquivo em `sources/`, implementar o contrato e registrar em `sources/index.ts`.
- **Nova visualização:** criar componente em `web/src/views/`, adicionar rota no menu; endpoint novo só se faltar dado.
- **Nova feature de cálculo:** função pura em `domain/` + teste; service só orquestra.

## Contrato de fonte de cotação

```ts
type QuoteSource = {
  id: string;               // "yahoo" | "alphavantage" | "cvm-swb"
  kind: "eod" | "intraday" | "daily-index";
  available(): Promise<boolean>;
  fetchDaily(symbols: string[], from: string, to: string): Promise<Quote[]>;
};
```

Fontes e comportamento:

| Fonte | Uso | Cadência | Em falha |
|---|---|---|---|
| Yahoo Finance (primária) | ações/ETFs/FIIs, batch; delay ~15 min | 10 min no pregão | mantém último valor + marca `stale` |
| Alpha Vantage (fallback, opt-in) | EOD | 1×/dia | idem |
| BCB SGS | CDI, Selic, IPCA | 1×/dia | idem |
| CVM SWB | cota de previdência | cache 6h | idem |

Nota (S4, 2026-09-18): o contrato foi refinado em `QuoteSource` (preços) + `IndexSource` (índices BCB); PTAX saiu do escopo por não ter consumidor. Detalhes na spec da S4.

## Modelo de dados

Separado por responsabilidade (não espelha a planilha):

- `instruments` — identidade + termos do contrato: `id` slug estável, `name`, `kind` (`fixed_income` | `equity` | `pension`), `category` (`cdb`, `lca`, `selic`, `etf_fixed`, `etf_equity`, `pension_ipca`), `ticker`, `quote_source` + `quote_symbol`, `currency`, `benchmark`, `rate_e6`, `maturity_date`, `broker`, `objective`, `investor`, `legacy_key`.
- `transactions` — livro de movimentos: `instrument_id`, `trade_date`, `kind` (`BUY`, `SELL`, `DIVIDEND`, `AMORTIZATION`, `FEE`, `TAX`), `quantity_e8` (assinada; **NULL em renda fixa**), `gross_cents` (bruto), `fees_cents`, `note`, `legacy_row`.
- `quotes` — `ticker`, `date`, `close_cents`, `source`; PK (ticker, date).
- `index_rates` — `series` (CDI/SELIC/IPCA/PTAX), `date`, `value_e12`; PK (series, date).
- `valuations` — fechamento mensal por ativo: `month`, `instrument_id`, `quantity_e8` (NULL em RF), `price_cents` (NULL em RF), `market_value_cents`, `cost_basis_cents`.
- `import_runs` — auditoria de cada import: quando, fonte (ui/cli/api), contagens, status, mensagem.
- `legacy_snapshots` — valores do GZIP do legado, só para reconciliação.
- `schema_migrations` — controle de migrations.

Convenções: quantidade assinada (+ entra, − sai); efeito de caixa derivado do `kind` (compra = −(bruto+taxas), venda = +(bruto−taxas), provento = +bruto); RF é saldo monetário; RV/PGBL é quantidade × preço/cota. Na planilha, `Resultado` = bruto e `Custo total` = bruto + taxas (conferido nos dados).

Índices: `quotes(ticker, date)`, `transactions(instrument_id, trade_date)`, `valuations(month, instrument_id)`, `legacy_snapshots(month)`.

## Precisão numérica (sem erro de ponto flutuante)

Dinheiro e quantidades **nunca** usam `float`. Armazenamento e cálculo em inteiros escalonados (BigInt no domínio, `INTEGER` no SQLite):

| Grandeza | Coluna | Escala | Exemplo |
|---|---|---|---|
| Valores monetários | `*_cents` | 10² | R$ <valor> → `<valor>` |
| Cotas/quantidades | `shares_e8` | 10⁸ | 1,<valor> cotas → `<valor>` |
| Taxas/índices diários | `rate_e12` | 10¹² | 0,<valor> → `<valor>` |
| Multiplicadores de contrato | `multiplier_e6` | 10⁶ | 1,06 → `<valor>` |

Regras:
- Decimal → inteiro por parsing de string (CSV/API); `parseFloat` nunca nos dados.
- Somas e comparações exatas; multiplicação/divisão arredondam **half-up** (ABNT NBR 5891) em ponto único e documentado (`domain/money.ts`).
- `Number` só na borda de apresentação (formatação pt-BR, gráficos).
- Posição encerrada (sem cotas e sem saldo) exibe exatamente `0,00` — nunca `-0,00` nem `1e-16`.

## Cálculos (porte do legado)

- **RF pós (sem cota):** saldo monetário corrigido pela série CDI/Selic × multiplicador do contrato. A planilha grava cota `1.0` fictícia — o import converte para `NULL`.
- **RV:** cotas × fechamento. **Previdência:** cotas × cota CVM.
- **Mensal:** total, investido (bruto+taxas), resgatado (bruto), rendimento (R$ e %), comparação com CDI e IPCA.
- **Alocação:** por categoria, corretora e objetivo.
- **Precisão:** contas em inteiros escalonados (seção acima); arredondamento só no ponto definido; posições encerradas zeradas de verdade.

Bugs do legado a corrigir no porte: snapshots negativos (set/2026) e resíduos `0,00…`/negativos de float, índice `-1` no mês anterior, cotas chegando como `String`, comparações de data com hora.

Casos concretos de resíduo (snapshot 2026-09, posições encerradas):
- `CDB PagBank 112%: 02-07-26` — compra R$ <valor> resgate total R$ <valor>; legado mostra **-R$ <valor>**.
- `CDB Liquidez Diária 105%: 17-09-26` — resgates até 17/09/2026; legado mostra **-R$ <valor>**.
- `CDB Liquidez Diária 103%: 22-10-26` — resgatado; legado mostra **R$ <valor>**.

Regra: posição sem saldo (último resgate ocorrido) fica exatamente `0,00`, com qualquer resíduo abaixo de R$ <valor> zerado.

## API (v1)

- `POST /api/import` — corpo opcional `{ assetsCsv, transactionsCsv, historyCsv, dryRun }` (upload); sem corpo, lê `data/csv`. Devolve contagens, mês/total mais recente, avisos e erros; `dryRun` não escreve.
- `GET /api/import/runs` — histórico de imports.
- `GET /api/instruments` — lista de ativos.
- `GET /api/instruments/:id/transactions` — movimentos do ativo.
- `GET /api/portfolio` — posições + totais (S4).
- `GET /api/history?from=YYYY-MM` — evolução mensal (S4).
- `GET /api/allocation` — por categoria/corretora/objetivo (S4).
- `GET /api/health` — status, contagens e última coleta por fonte.
- `POST /api/refresh` — atualização manual das cotações (S4).

## UI v1

Duas telas (read-only, exceto import):

- **Importar** — upload do `.xlsx` exportado do Sheets (ou dos 3 CSVs), prévia em dry-run (contagens, erros, total do mês mais recente), confirmação e histórico de imports. Import substitui os dados numa transação única.
- **Dashboard** — cards (total, investido, rendimento vs CDI/IPCA), tabela de posições, alocação, evolução 12 meses e selo "atualizado às HH:MM". Revalida a cada 5 min.

CRUD de transações/ativos fica para a v2.

## Docker / homelab

- `Dockerfile` multi-stage: build do front (Vite) → runtime `node:22-slim` com usuário non-root, servindo API + estáticos.
- `docker-compose.yml`: `restart: unless-stopped`, volume `./data:/app/data` (banco + CSVs), `env_file: .env`, porta `3000`, `TZ=America/Sao_Paulo`, healthcheck em `/api/health`.
- Fluxo: `git pull && docker compose up -d --build`. Backup = copiar `data/`.
- `.env.example`: `PORT`, `DB_PATH`, `ALPHAVANTAGE_API_KEY` (opcional), `TZ`.

## Erros e observabilidade

Fonte que falha não derruba o app: mantém último valor, registra erro e marca `stale`. `/api/health` expõe última coleta e erro por fonte. Logs simples em JSON (pino via Fastify).

## Testes e aceite

- `node --test` cobrindo `domain/` e o import (com fixtures; sem bater em API externa).
- Regressão numérica: ativo encerrado resulta em `0,00` exato; somas feitas em centavos, sem drift.
- **Aceite da v1:** recalcular 2026-09 e reconciliar com a planilha: total de referência **R$ <valor>** = R$ <valor> (soma por ativo em centavos; a planilha exibe R$ <valor> por arredondar a soma dos floats) + R$ <valor> de resíduos negativos zerados; divergência ativo a ativo só com explicação. Alocação por subtipo consistente.

## Sessões (cada uma = 1 PR/layer)

1. **S2** — fundação: modelo, import (lib/CLI), API (import/instruments/health) e Docker rodando com dados (~4h).
2. **S3** — frontend base + tela Importar (xlsx/CSV, prévia dry-run, confirmação) (~3–4h).
3. **S4** — cotações Yahoo/BCB + job intraday + `/api/portfolio` (~3h).
4. **S5** — CVM SWB (previdência) com cache (~2h).
5. **S6** — dashboard + reconciliação contra a planilha (~3h).

## Riscos

- Yahoo não é oficial → adapter isolado, cache e fallback opt-in.
- Raspagem CVM é frágil → módulo isolado com cache; se quebrar, mostra `stale` e não afeta o resto.
- Chave do Alpha Vantage estava hardcoded no legado → rotacionar e usar `.env`.
- Divergência de cálculo vs planilha → validação mês a mês na S6, corrigindo o legado quando ele estiver errado.
- Planilha grava cota `1.0` fictícia em renda fixa → import converte para `NULL` por `kind`; RF nunca usa quantidade no cálculo.
- IDs do legado mudam de formato entre abas (`<valor>` vs `<valor>.0`) → normalização no import validada por teste.
