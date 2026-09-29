# investment-tracker

App self-hosted para acompanhar uma carteira de investimentos: posições de renda fixa,
renda variável e previdência, cotações automáticas, alocação, evolução mensal,
desempenho, reconciliação e rebalanceamento. Backend Node + SQLite (Fastify), frontend
React (Vite). Roda em Docker no homelab.

## Recursos

- Importação de ativos, transações e histórico por CSV ou XLSX (UI ou API).
- Cotações e índices: Yahoo (ações/FIIs/ETFs), BCB (CDI/Selic/IPCA) e CVM SWB
  (previdência); `ALPHAVANTAGE_API_KEY` habilita o fallback do Yahoo. Fonte fora do ar
  mantém o último valor e marca `stale`.
- Portfólio consolidado: renda fixa capitalizada (CDI/Selic/IPCA), renda variável por
  cotas × fechamento, previdência por cota.
- Alocação por categoria, corretora e objetivo.
- Evolução mensal, desempenho (retorno, CDI/IPCA em p.p., MWR) e projeção de patrimônio.
- Reconciliação do mês contra o snapshot de referência, com divergências e causa.
- Rebalanceamento renda fixa × renda variável com metas e aporte transiente.

## Dev

    npm install
    npm run dev        # API em http://localhost:3000 (cria o banco em data/)
    npm run dev:web    # UI em http://localhost:5173 (proxy /api -> :3000)

    # importar seus dados: tela "Importar" da UI (CSV/XLSX) ou CLI:
    # CSV_DIR=/caminho/dos/csv npm run import
    # reparo de cotações: automático após o refresh; para forçar uma janela:
    # npm run backfill -- --ticker B5P211 --from 2025-04-23 --to 2026-01-07

    # cotações/índices: job roda no processo (10 min no pregão; índices + previdência às 7h)

Testes: `npm test` · Tipos: `npm run typecheck` · Build da UI: `npm run build:web`

## Homelab (Docker)

    git pull
    docker compose up -d --build
    curl localhost:3000/api/health

A UI é servida pelo próprio container em `http://<host>:3000`.

Atualizar: `git pull && docker compose up -d --build`. Backup: copiar `data/`.
Reparo de cotações corrompidas é automático após o refresh (trechos de fechamento
constante ≥ 7 dias → série mensal da Alpha Vantage). Quem copia `data/` não precisa
rodar nada; `npm run backfill` só é necessário para forçar uma janela ou reconstruir o banco.
Se o volume der erro de permissão, ajuste o dono de `./data` para o uid do container (1000).
`env_file.required` exige Docker Compose ≥ 2.24; em versões antigas, crie o `.env` (`cp .env.example .env`).

## Configuração (.env)

| Variável | Default | Descrição |
|---|---|---|
| `PORT` | `3000` | porta da API/UI |
| `DB_PATH` | `data/investments.db` | arquivo SQLite |
| `CSV_DIR` | `data/csv` | pasta lida pelo import via CLI |
| `ALPHAVANTAGE_API_KEY` | vazio | fallback opcional das cotações |

## API (v1)

| Rota | Descrição |
|---|---|
| `POST /api/import` | importa CSVs (corpo com os textos ou a pasta `CSV_DIR`); `{"dryRun":true}` só valida |
| `GET /api/import/runs` | histórico de imports |
| `GET /api/instruments` | lista de ativos |
| `GET /api/instruments/:id/transactions` | movimentos do ativo |
| `POST /api/instruments` | cria ativo (corpo com o cadastro; `id` gerado do nome) |
| `PATCH /api/instruments/:id` | edita cadastro (classe/categoria só sem transações) |
| `DELETE /api/instruments/:id` | exclui ativo sem transações |
| `POST /api/instruments/:id/transactions` | cria Compra/Resgate (`kind: BUY\|SELL`; quantidade em RV/previdência) |
| `PATCH /api/transactions/:id` · `DELETE /api/transactions/:id` | edita/exclui transação (guarda impede posição negativa) |
| `GET /api/portfolio` | posições + totais (RF capitalizada, RV = cotas × fechamento) |
| `GET /api/history?from=YYYY-MM&to=YYYY-MM` | evolução mensal (default: 12 meses) |
| `GET /api/performance?from=YYYY-MM&to=YYYY-MM` | retorno mensal/acumulado da carteira, diferença em p.p. contra CDI/IPCA e MWR |
| `GET /api/allocation?by=category\|broker\|objective` | alocação por critério |
| `GET /api/reconciliation?month=YYYY-MM&asOf=YYYY-MM-DD` | reconciliação do mês contra o snapshot de referência (totais e divergências com causa) |
| `GET /api/rebalance?amountCents&rfE6&rvE6` | Cálculo do rebalanceamento RF × RV fora da reserva (aporte transiente via query `amountCents`) |
| `PUT /api/rebalance` | Salva as metas RF × RV (o aporte é transiente; existe só na query do GET) |
| `POST /api/refresh?full=1&source=yahoo\|alphavantage\|bcb\|cvm-swb` | coleta manual (todas as fontes sem `source`); `full=1` refaz a janela; resposta inclui `repairs` |
| `GET /api/health` | status + contagens + fontes (última coleta/erro, stale) |

## Estrutura

- `src/domain/` tipos e cálculo puro · `src/db/` schema e repositórios · `src/import/` CSV/XLSX → banco · `src/api/` rotas · `web/` UI
- `data/` banco e arquivos importados, locais e ignorados pelo Git · `docs/superpowers/` spec e planos
