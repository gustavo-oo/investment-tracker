# V2 — CRUD de transações e ativos

**Resumo:** a v2 entrega o primeiro CRUD do app: criar/editar/excluir **Compra e Resgate** e criar/editar/excluir **ativos** pela UI, no painel do ativo em Posições. O app passa a ser a **fonte da verdade**: o import sai da UI e vira CLI de bootstrap/restauração (`npm run import -- --replace`). Guardas fortes impedem posição negativa (simulação pura da carteira com a edição aplicada). Sem migration — o schema atual cobre tudo.

**Depende de:** import S2 (`src/import/`), domínio `instrumentValue` (`src/domain/position.ts:122`), rotas `/api/instruments*` (S7 + carteira), painel do ativo em `web/src/views/PositionsView.tsx`, `Modal` web já existente.

**Não faz parte:** audit log (removido do escopo em 2026-09-22); import na UI; tipos além de Compra/Resgate (`DIVIDEND`/`AMORTIZATION`/`FEE`/`TAX` — razões na seção "Tipos fora do escopo"); exclusão de ativo em cascata; split/bonificação; título RF prefixado ou benchmark IPCA; import com merge; edição em lote; login/multiusuário.

## Decisões do brainstorming (2026-09-22)

| Tema | Decisão |
|---|---|
| Fonte da verdade | App. Import sai da UI; CLI `npm run import -- --replace` exige a flag quando já há transações |
| Escopo de tipos | Só Compra (`BUY`) e Resgate (`SELL`), como nos dados reais |
| Ativos | Criar + editar + excluir (exclusão bloqueada com transações); `kind`/`category` travados quando há transações |
| Guardas | Fortes: data ≤ hoje (BRT), valor > 0, quantidade obrigatória em RV/previdência, simulação impede posição negativa (tolerância 1¢ em RF) |
| Onde na UI | Painel do ativo em Posições; "Novo ativo" no cabeçalho de Posições |
| Auditoria | Nenhuma; exclusão física; backup = copiar `data/` |
| Reconciliação | Inalterada; é medida na base importada, não na base editada |

## Problema

A v1 é read-only; a única escrita é `PATCH /api/instruments/:id` (investor). O import substitui TODOS os dados numa transação única (`clearImportedData`, `src/db/repos.ts:148`), então edições na UI seriam perdidas no próximo ciclo — provado no aceite da carteira por investidor. Para aposentar a planilha, o app precisa criar/editar/excluir lançamentos e ativos, e o import precisa deixar de ser o caminho de escrita do dia a dia.

## API

| Rota | Contrato |
|---|---|
| `POST /api/instruments` | Cria ativo (201 com o shape de `GET /api/instruments`). `id = slugify(name)` (reusa `src/import/catalog.ts:30`), `legacy_key = ui:<id>`, `currency = BRL`. 409 se o id já existe. |
| `PATCH /api/instruments/:id` | Atualização parcial: só as chaves enviadas mudam. Editáveis: `name`, `ticker`, `quoteSymbol`, `benchmark`, `rateE6`, `maturityDate`, `liquidity`, `broker`, `objective`, `investor`. `kind`/`category` só sem transações (senão 400 com o motivo). Chave desconhecida → 400. `{ investor }` continua válido (subconjunto). |
| `DELETE /api/instruments/:id` | Só sem transações; senão 409 com a contagem. |
| `POST /api/instruments/:id/transactions` | Cria Compra/Resgate (201 com o shape de `GET .../transactions`, incluindo `id`). Body: `{ tradeDate, kind, grossCents, feesCents?, quantityE8?, note? }`. |
| `PATCH /api/transactions/:id` | Mesmas chaves, todas opcionais; 200 com a transação; 404 se não existe. |
| `DELETE /api/transactions/:id` | Exclusão física; 204. |

Regras do corpo de transação:

- `tradeDate`: ISO válido (`isDate`) e ≤ hoje em America/Sao_Paulo (`toBrDate`).
- `kind`: `BUY` ou `SELL` (demais tipos → 400).
- `grossCents`: inteiro > 0; `feesCents`: inteiro ≥ 0 (default 0).
- `quantityE8`: obrigatório e > 0 em `equity`/`pension` (até 8 decimais); proibido em `fixed_income` (RF usa `grossCents` como valor).
- `note`: string ≤ 200, opcional.
- Entrada de quantidade é **positiva**; o servidor grava `SELL` com sinal negativo (convenção de `src/import/map.ts:70`). Respostas devolvem o sinal já aplicado.
- Criação/edição em ativo inexistente → 404.

Regras de criação de ativo:

- `name` não vazio; `kind`/`category` consistentes (`cdb|lca|selic → fixed_income`, `etf_fixed|etf_equity → equity`, `pension_ipca → pension`).
- Renda fixa: `benchmark ∈ {CDI, SELIC}` e `rateE6 > 0` (ex.: 105% = `<valor>`).
- Renda variável: `ticker` obrigatório, `quote_source = yahoo`.
- Previdência: `quoteSymbol` numérico obrigatório (código CVM SWB), `quote_source = cvm-swb`.
- `maturityDate` (quando presente) ISO válida; `investor` (quando presente) ∈ {`Ana`, `Beto`} (enum da rota existente).
- Na edição, as mesmas regras de consistência valem para o estado final do ativo (não só para a criação).

## Guarda de posição negativa

`src/domain/write-guards.ts`, função pura, recebe `{ instrumento, transações, rates }` + a mudança (insert/update/delete) e simula a carteira ordenada por data:

1. `equity`/`pension`: soma corrida de `quantityE8`; qualquer ponto < 0 → erro com data e quantidade disponível.
2. `fixed_income`: em cada Resgate, `grossCents ≤ rfValueCents(operations até a data) + 1n` — a tolerância de 1¢ cobre os resgates reais de vencimento (capitalização D−1, ver `ROADMAP.md`).
3. Vale para criar, editar e excluir (excluir uma Compra que sustentava um Resgate também bloqueia).
4. `PATCH /api/instruments/:id` que mexe em `benchmark`/`rateE6`/`maturityDate` de RF roda a mesma simulação (evita taxa que tornaria um resgate passado negativo).

O serviço carrega a série CDI/SELIC do instrumento como `portfolio.ts:55` e passa para a função; a guarda não toca banco.

## Código

- `src/domain/write-guards.ts` (+ teste): simulação descrita acima.
- `src/services/writes.ts` (+ teste): `createInstrument`, `updateInstrument`, `deleteInstrument`, `createTransaction`, `updateTransaction`, `deleteTransaction`. Cada mutação: carrega estado → valida guarda → uma `db.transaction` → devolve a entidade. Erros de domínio como resultado tipado (`{ ok: false, error }`) ou exceção própria — mapeados pela rota para 400/404/409.
- `src/db/repos.ts`: `getInstrument`, `getTransaction`, `insertInstrument`, `updateInstrument`, `deleteInstrument`, `insertTransaction`, `updateTransaction`, `deleteTransaction` (+ testes).
- `src/api/routes/instruments.ts`: expande PATCH, adiciona POST/DELETE; `GET /api/instruments/:id/transactions` passa a devolver `id`.
- `src/api/routes/transactions.ts` (novo): PATCH/DELETE; registrado em `src/api/app.ts`.
- `src/import/cli.ts`: erro de uma linha sem `--replace` quando `transactions > 0`.
- `web/src/api.ts`: tipos com `id` e funções `postInstrument`, `patchInstrument`, `deleteInstrument`, `postTransaction`, `patchTransaction`, `deleteTransaction`.
- `web/src/views/PositionsView.tsx`: painel do ativo com transações editáveis + cadastro editável + excluir ativo; botão "Novo ativo".
- `web/src/components/FormTransacao.tsx` e `FormAtivo.tsx` (novos): modais de formulário.
- `web/src/views/ImportView.tsx` removida do shell; histórico de `import_runs` vira `<details>` read-only em `SourcesView.tsx`.

## UI

**Painel do ativo (Posições)**
1. Botão "Nova transação" acima da lista; cada linha ganha editar/excluir (excluir com confirmação no `Modal`).
2. Form da transação: data, Compra/Resgate, valor e taxas em R$ (máscara → centavos), quantidade só em RV/previdência (oculta em RF), nota.
3. "Editar cadastro" no painel; `kind`/`category` desabilitados com o motivo visível quando há transações.
4. "Excluir ativo" desabilitado com "N transações" quando não pode.
5. Erro do backend exibido inline no modal, sem fechar.
6. Após qualquer mutação: refetch de `/api/portfolio` e da lista do painel (barato, local).

**Novo ativo**
- Botão no cabeçalho de Posições abre `FormAtivo` em modo criação com modelo pré-selecionável: Renda fixa (CDI/SELIC) · ETF Renda Fixa · ETF Renda Variável · Previdência PGBL. O modelo preenche `kind`/`category`/fonte; os campos restantes seguem as regras da API.
- Colisão de `id` → erro pedindo ajuste no nome.

**Importar**
- Sidebar volta a 4 seções (Visão geral · Posições · Evolução · Fontes). A rota `POST /api/import` permanece no backend (CLI/curl), sem UI.

## Tipos fora do escopo

| Tipo | Por que fica fora agora |
|---|---|
| `DIVIDEND` | Entra em `operations` como valor positivo e infla a posição de RF (`src/domain/position.ts:137`); decidir se o caixa fica na carteira e como entra no rendimento pede spec própria |
| `AMORTIZATION` | `zeroClosedResidue` já trata como redutor, mas o schema proíbe `gross_cents < 0` (`001_init.sql:27`); exigiria convenção de sinal |
| `FEE` / `TAX` | Já existem como `feesCents` por transação; como tipos separados duplicariam o conceito |
| Split/bonificação | Não existe no enum; mudaria quantidade sem caixa |

Nos dados reais (2 anos, 119 transações) só existem Compra e Resgate: ETFs são acumuladores e CDB/LCA/PGBL pagam no vencimento (registrado como Resgate).

## Testes

- **Domínio** (`write-guards.test.ts`): oversell em RV; resgate RF > valor capitalizado; tolerância de 1¢; edição que cria oversell retroativo; exclusão de Compra que descobre Resgate; RF sem série de índices; quantidade negativa.
- **Serviços** (`writes.test.ts`): CRUD completo em banco in-memory; 404; 409 de id duplicado; 409 de ativo com transações; `kind`/`category` travados; sinal do `SELL`; `legacy_row = null`.
- **Rotas** (`app.test.ts`): 201/200/204; 400 (data futura, valor ≤ 0, quantidade em RF/ausente em RV, tipo inválido, chave desconhecida); 404; 409; `GET /api/instruments/:id/transactions` com `id`.
- **CLI** (`src/import/cli.test.ts`): a guarda do `--replace` extraída como função pura (`args` + `counts` → erro ou segue) com testes; execução real do CLI na verificação.
- **Regressão:** 175 testes atuais seguem verdes; a base importada não muda — reconciliação `asOf=2026-09-16` segue `referenceCents <valor>`, `unexplained 0`.
- Web sem runner: verificação por browser.

## Aceite

1. No browser com dados reais: criar um CDB novo (modelo Renda fixa), lançar uma Compra, editar o valor, excluir a transação — Posições e Visão geral acompanham.
2. Guarda visível: um Resgate maior que a posição é rejeitado com mensagem no modal; em RV, vender mais cotas que o disponível também.
3. Criar e excluir ativo sem transações funciona; excluir ativo com transações mostra 409 com contagem.
4. Sidebar com 4 seções; Fontes mostra o histórico de imports; nada de Importar na UI.
5. `npm run import` sem `--replace` aborta; `npm run import -- --replace` restaura a base e a reconciliação volta a `<valor>` / `0`.
6. `npm test` (novos verdes), `npm run typecheck`, `npm run build:web`, `docker compose up -d --build` + `curl localhost:3000/api/health`; screenshots do painel com formulário, do novo ativo e da guarda rejeitando.

## Riscos

- Edição retroativa muda TWR/MWR e o histórico por design; sem undo e sem auditoria (backup = copiar `data/`).
- `legacy_key ui:<id>` e ativos criados na UI somem no próximo `--replace` — documentado e avisado no README do import.
- Colisão de `id` a partir do nome: erro explícito pede outro nome; sem sufixo automático.
- RF prefixado e benchmark IPCA não são suportados (a capitalização fica plana sem série de índices); modelos da UI restringem a CDI/SELIC.
- `DIVIDEND` continua no `operations` de `instrumentValue` (minor do `ROADMAP.md`); a UI não cria esse tipo, então não piora.
