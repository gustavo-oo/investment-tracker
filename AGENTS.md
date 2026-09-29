## Workflow opencode (bento)

Referência: https://github.com/gustavo-oo/bento — nada é vendorizado neste projeto. O README do repo é um prompt de setup: cole-o num agente para instalar ou atualizar o workflow (superpowers, taste-skill, i-have-adhd, agent-browser, codegraph) seguindo as instruções de cada upstream.

## Projeto (investment-tracker)

Fonte única de prioridades: `ROADMAP.md` (raiz). Leia antes de planejar qualquer sessão; atualize-o ao concluir uma etapa.

- **Norte:** aposentar a planilha Google + Apps Script. v1 = app read-only no homelab com os mesmos números do legado; v2 = CRUD de transações/ativos.
- **Estado:** S2 (fundação) e S3 (UI + Importar) concluídas. Pendentes, nesta ordem: S4 (cotações Yahoo/BCB + job intraday + `/api/portfolio`), S5 (previdência CVM SWB), S6 (dashboard + reconciliação).
- **Aceite da v1:** 2026-09 = R$ <valor> (centavos) + R$ <valor> de resíduos negativos zerados; dashboard e cotações conforme spec de design.
- **Spec de design:** `docs/superpowers/specs/2026-09-17-modernizacao-app-investimentos-design.md`.
- **Fluxo por etapa:** spec → plano em `docs/superpowers/plans/` → TDD task a task (≤ 400 linhas / ≤ 10 arquivos por layer; lockfile sincroniza no trunk) → verificação (`npm test`, `npm run typecheck`, `npm run build:web`, `docker compose up -d --build`) → merge e atualização do `ROADMAP.md`.
- **Deploy no homelab (sempre após merge na `main`):** `git push origin main`; no homelab (`ssh <valor>.<valor>` ou `mosh <valor>.<valor>`) → `cd ~/homelab/investment-tracker && git pull --ff-only && docker compose up -d --build`; conferir `curl localhost:3000/api/health` (contagens + fontes) e a reconciliação.
- **Banco canônico e espelho:** o banco local (`data/investments.db`) é a fonte da verdade (inclui edições da UI/SQL); toda alteração de dados também é publicada no homelab — snapshot consistente local (`VACUUM INTO` ou backup do better-sqlite3), backup do homelab em `~/backups/investment-tracker/` e troca do arquivo com o container parado (`docker compose stop app` → copiar `investments.db` sem `-wal`/`-shm` → `docker compose up -d --build`); edições pontuais podem ser aplicadas nos dois bancos com script verificado (melhor `BEGIN` + checagem + rollback); registrar no `ROADMAP.md` quando afetar números do aceite.
- **Regras herdadas:** zero `float` em dado persistido/cálculo (inteiros escalonados); fonte externa fora do ar mantém último valor + `stale`; segredos só no `.env`; artefatos e commits em pt-BR.
