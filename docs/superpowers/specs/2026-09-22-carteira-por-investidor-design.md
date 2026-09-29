# Carteira por investidor (filtro + correção no painel)

**Resumo:** o campo `investor` (já importado, hoje invisível fora do banco) passa a aparecer em `/api/portfolio`, ganha filtro na tela **Posições** e pode ser corrigido pelo painel do ativo via `PATCH /api/instruments/:id` (enum exato `Ana` · `Beto`). O import continua permissivo e **sobrescreve** a correção no próximo ciclo — a UI avisa isso explicitamente.

**Depende de:** import de `investor` (S2, `src/import/map.ts:46`), `/api/portfolio` (S4), tela Posições (S7) e a rota `GET /api/instruments` existente.

**Não faz parte:** recorte de Visão geral, gráfico, alocação, TWR/MWR ou reconciliação (decidido: recorte só em Posições); edição em lote; CRUD completo (v2); auditoria/histórico de alterações; renomear/criar investidores; `Ambos` como valor gravável; normalização de valores vindos do import.

## Decisões do brainstorming (2026-09-22)

| Tema | Decisão |
|---|---|
| Onde editar | Painel do ativo em Posições, 1 ativo por vez (Abordagem A aprovada) |
| Onde filtrar | Só a tela Posições; Visão geral, gráfico e alocação seguem totais |
| Valores graváveis | Enum exato `Ana` · `Beto`; sem trim/case — `Ambos`, `gustavo`, `Ana ` → 400 |
| Import × correção | Import sempre sobrescreve (sem flag/auditoria); correção vale até o próximo import; UI avisa |
| API | `PATCH /api/instruments/:id` com body estrito `{ investor }` |
| Total do cabeçalho | Continua somando a carteira inteira mesmo com filtro ativo (consistente com Tipo/Corretora/Objetivo) |
| Opções do filtro | Derivadas dos valores distintos presentes nos dados; `Ambos` some quando o último for reatribuído |

## Problema

`investor` é coluna TEXT em `instruments` (`migrations/001_init.sql:17`), preenchida no import e exposta só em `GET /api/instruments` — não aparece em `/api/portfolio` nem na UI. A planilha pode atribuir o ativo à pessoa errada ou marcar `Ambos` (4 dos 48 ativos hoje: Ana 26, Beto 18, Ambos 4) sem que haja investimento compartilhado. O app é read-only, então não há como corrigir. Esta etapa entrega o primeiro write de domínio do app.

## API

```
PATCH /api/instruments/:id
body estrito: { "investor": "Ana" | "Beto" }

- body sem `investor`, com valor fora do enum ou com chave extra → 400
- id inexistente → 404
- sucesso → 200 com o instrumento no mesmo shape de `GET /api/instruments`
```

- Comparação por igualdade exata de string (após `JSON.parse`), sem trim nem case-fold.
- Body estrito: apenas a chave `investor` é aceita; não-objeto/array → 400.
- Import inalterado: continua permissivo (grava qualquer texto da planilha) e `INSERT OR REPLACE` sobrescreve o valor corrigido no próximo import (`src/db/repos.ts:51-63`).
- `GET /api/portfolio` passa a expor `investor: string | null` por posição.

## Código

- `src/db/repos.ts`: `updateInstrumentInvestor(db, id, investor): InstrumentRow | undefined` — `UPDATE instruments SET investor = ? WHERE id = ?` + `getInstrument`.
- `src/services/portfolio.ts`: `PortfolioPosition` ganha `investor: string | null`; `buildPortfolio` propaga `instrument.investor`.
- `src/api/routes/instruments.ts`: rota PATCH com a validação acima; helper de mapeamento compartilhado com o GET para a resposta.
- `src/api/routes/portfolio.ts`: mapeamento aditivo de `investor`.
- `web/src/api.ts`: `PortfolioPosition` acompanha; `patchInvestor(id, investor)` (fetch PATCH + `apiErrorMessage`).
- `web/src/views/PositionsView.tsx`:
  - filtro `Investidor` no card de filtros (mesmo padrão de Corretora/Objetivo): "Todos" + valores distintos de `posicao.investor` ("—" para nulo); aplicado em `visiveis` junto dos demais;
  - painel do ativo: linha "Investidor" com `select` (`Ana` · `Beto` + valor atual se fora do enum, para poder sair dele), botão `Salvar` (desabilitado sem mudança ou salvando) e aviso fixo "Correções valem até o próximo import — a planilha sobrescreve.";
  - feedback: erro inline no painel (`role="alert"`), sucesso "Investidor atualizado" (`aria-live="polite"`);
  - após sucesso: atualiza `posicoes` e `selecionada` em memória (sem refetch — investor não afeta valor/cotação);
  - chip do investidor atual no painel, junto de categoria/corretora/classe.
- `web/src/styles.css`: só ajustes pontuais se necessário (reusar `.campo`, `.stats`, hints existentes).

## Testes

- **Repo** (`src/db/repos.test.ts`): `updateInstrumentInvestor` altera só o investidor (demais campos intactos) e retorna o instrumento; id inexistente → `undefined`.
- **API** (`src/api/app.test.ts`): PATCH válido → 200 e `GET /api/portfolio` refletindo o novo valor; 400 para `Ambos`, `gustavo`, `""`, chave extra e body ausente; 404 para id inexistente; posição com investidor nulo exposta como `null`.
- **Serviço** (`src/services/portfolio.test.ts`): posição expõe `investor` (com valor e com `null`).
- **Regressão:** 170 testes seguem verdes; nenhum cálculo muda — reconciliação segue `referenceCents <valor>`, `unexplained 0`.
- UI sem runner: verificação por browser.

## Aceite

- Com dados reais: filtro mostra Ana 26 · Beto 18 · Ambos 4; reatribuir um ativo de `Ambos` para `Ana` atualiza painel e lista, e persiste após reload; `Ambos` some do filtro quando o último ativo sair.
- PATCH inválido exibe erro no painel sem alterar a lista.
- Import real após a correção **devolve o valor da planilha** (prova do overwrite) — executado uma vez na verificação.
- `npm test` (novos testes verdes), `npm run typecheck`, `npm run build:web`; `docker compose up -d --build` + `curl localhost:3000/api/health`; screenshot da tela Posições com filtro e editor.

## Riscos

- Valor desconhecido vindo do import (ex.: `Ambos`, typo) aparece no filtro e como valor atual do select — dá para sair dele, mas não para gravá-lo; comportamento desejado.
- Corrigir e perder no próximo import é aceito e avisado na UI; sem undo.
- Enum rígido: uma terceira pessoa exige mudança de código/migration (decisão consciente).
- Sem auditoria (YAGNI); revisitar quando o CRUD da v2 crescer sobre essa rota.
- `investor` não entra em valuation/TWR/MWR/reconciliação — risco de cálculo: nenhum.
