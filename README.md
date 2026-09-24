# investment-tracker

Substitui a planilha Google + Apps Script por um app local (Node + SQLite).

## Dev

    npm install
    npm run import                  # lê data/csv e popula data/investments.db (1ª vez)
    npm run import -- --replace     # substitui TODOS os dados (apaga edições feitas na UI)
    # reparo de cotações: automático após o refresh; para forçar uma janela:
    # npm run backfill -- --ticker B5P211 --from 2025-04-23 --to 2026-01-07
    npm run dev        # API em http://localhost:3000
    # cotações/índices: job roda no processo (10 min no pregão; índices + previdência às 7h);
    # ALPHAVANTAGE_API_KEY no .env habilita o fallback do Yahoo.
    npm run dev:web    # UI em http://localhost:5173 (proxy /api -> :3000)

Testes: `npm test` · Tipos: `npm run typecheck` · Build da UI: `npm run build:web`

## Homelab (Docker)

    git pull
    docker compose up -d --build
    docker compose exec app npm run import   # popula o banco do volume
    curl localhost:3000/api/health

A UI é servida pelo próprio container em `http://<host>:3000`.

Atualizar: `git pull && docker compose up -d --build`. Backup: copiar `data/`.
Reparo de cotações corrompidas é automático após o refresh (trechos de fechamento
constante ≥ 7 dias → série mensal da Alpha Vantage). Quem copia `data/` não precisa
rodar nada; `npm run backfill` só é necessário para forçar uma janela ou reconstruir o banco.
Se o volume der erro de permissão, ajuste o dono de `./data` para o uid do container (1000).
`env_file.required` exige Docker Compose ≥ 2.24; em versões antigas, crie o `.env` (`cp .env.example .env`).

## API (v1)

| Rota | Descrição |
|---|---|
| `POST /api/import` | importa CSVs (corpo com os textos ou lê `data/csv`); `{"dryRun":true}` só valida |
| `GET /api/import/runs` | histórico de imports |
| `GET /api/instruments` | lista de ativos |
| `GET /api/instruments/:id/transactions` | movimentos do ativo |
| `POST /api/instruments` | cria ativo (corpo com o cadastro; `id` gerado do nome) |
| `PATCH /api/instruments/:id` | edita cadastro (classe/categoria só sem transações) |
| `DELETE /api/instruments/:id` | exclui ativo sem transações |
| `POST /api/instruments/:id/transactions` | cria Compra/Resgate (`kind: BUY\|SELL`; quantidade em RV/previdência) |
| `PATCH /api/transactions/:id` · `DELETE /api/transactions/:id` | edita/exclui transação (guarda impede posição negativa) |
| `GET /api/portfolio` | posições + totais (RF capitalizada, RV = cotas × fechamento) |
| `GET /api/history?from=YYYY-MM&to=YYYY-MM` | evolução mensal (default: 12 meses); clampa a janela no primeiro mês com retorno (mai/2025 nos dados atuais) |
| `GET /api/performance?from=YYYY-MM&to=YYYY-MM` | retorno mensal/acumulado da carteira, diferença em p.p. contra CDI/IPCA e MWR (mesma janela clampada do `/api/history`) |
| `GET /api/allocation?by=category\|broker\|objective` | alocação por critério |
| `GET /api/reconciliation?month=YYYY-MM&asOf=YYYY-MM-DD` | reconciliação do mês contra o legado (totais e divergências com causa) |
| `POST /api/refresh?full=1&source=yahoo\|alphavantage\|bcb\|cvm-swb` | coleta manual (todas as fontes sem `source`); `full=1` refaz a janela; resposta inclui `repairs` |
| `GET /api/health` | status + contagens + fontes (última coleta/erro, stale) |

## Estrutura

- `src/domain/` tipos e cálculo puro · `src/db/` schema e repositórios · `src/import/` CSV → banco · `src/api/` rotas
- `data/csv/` CSVs extraídos do legado · `legacy/apps-script/` código original · `docs/superpowers/` spec e planos
