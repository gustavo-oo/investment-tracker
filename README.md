# investment-tracker

Substitui a planilha Google + Apps Script por um app local (Node + SQLite).

## Dev

    npm install
    npm run import     # lê data/csv e popula data/investments.db
    npm run dev        # http://localhost:3000

Testes: `npm test` · Tipos: `npm run typecheck`

## Homelab (Docker)

    git pull
    docker compose up -d --build
    docker compose exec app npm run import   # popula o banco do volume
    curl localhost:3000/api/health

Atualizar: `git pull && docker compose up -d --build`. Backup: copiar `data/`.
Se o volume der erro de permissão, ajuste o dono de `./data` para o uid do container (1000).

## API (v1)

| Rota | Descrição |
|---|---|
| `POST /api/import` | importa CSVs (corpo com os textos ou lê `data/csv`); `{"dryRun":true}` só valida |
| `GET /api/import/runs` | histórico de imports |
| `GET /api/instruments` | lista de ativos |
| `GET /api/instruments/:id/transactions` | movimentos do ativo |
| `GET /api/health` | status + contagens |

## Estrutura

- `src/domain/` tipos e cálculo puro · `src/db/` schema e repositórios · `src/import/` CSV → banco · `src/api/` rotas
- `data/csv/` CSVs extraídos do legado · `legacy/apps-script/` código original · `docs/superpowers/` spec e planos
