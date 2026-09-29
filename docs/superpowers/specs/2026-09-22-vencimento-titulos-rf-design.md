# Vencimento de títulos de renda fixa (congelar + aviso)

**Resumo:** a posição de RF com `maturityDate` para de capitalizar no vencimento (taxas truncadas no dia útil anterior, D−1) e ganha o sinal `pendingRedemption` quando vencida com saldo. A UI avisa em dois lugares — badge na linha em Posições e faixa na Visão geral — para o usuário lançar o resgate real. **Sem resgate automático:** o valor bruto aplicado antes da planilha é desconhecido e o resgate vem do banco.

**Depende de:** `instrumentValue` (S4/S6), import do `maturityDate` (`src/import/map.ts`), `/api/portfolio` (S4) e da UI S7.

**Não faz parte:** resgate automático (decidido fora: valor bruto pré-planilha desconhecido; o resgate real é lançado pelo usuário); replicar o sumiço silencioso do legado 3 meses após o vencimento; alerta de vencimento futuro ("vence em X dias"); CRUD (v2); imposto líquido × líquido (v3).

## Decisões do brainstorming (2026-09-22)

| Tema | Decisão |
|---|---|
| Comportamento | Congelar no vencimento (para de capitalizar); o ativo continua no patrimônio, congelado |
| Resgate automático | Fora do escopo — não há valor bruto aplicado antes da planilha; o resgate real é lançado pelo usuário |
| Sinal para a UI | `pendingRedemption` = vencido (`maturityDate <= asOf`) e saldo > 0 |
| Onde avisar | Badge na linha em Posições + faixa na Visão geral (só vencidos, não futuros) |
| Implementação | Cap no domínio (taxas truncadas no vencimento); `history`/`portfolio`/reconciliação herdam |
| Legado | Não replicar o sumiço após 3 meses (`legacy/apps-script/asset_manager.js:204`) |

## Problema

`rfValueCents` capitaliza todas as operações até o `asOf` e ignora `maturityDate`: título vencido sem resgate lançado continua rendendo e nunca zera sozinho (item do backlog v2). O legado capitalizava e, 3 meses após o vencimento, **excluía o ativo em silêncio** — o resgate era sempre lançado à mão.

Auditoria retroativa (2026-09-22; todos os 48 ativos, mês a mês, 2025-01 → 2026-09, com `rfValueCents` e taxas reais):

- **Nenhuma capitalização pós-vencimento material.** 3 títulos com poeira de arredondamento: `cdb-pagbank-112-02-07-26` acumulou −R$ <valor> em 3 meses; `cdb-liquidez-diaria-106-29-12-25` e `...106-07-10-25`, ±R$ <valor> Todos já exibidos como 0,00 pelo `zeroClosedResidue`.
- **1 caso real:** `cdb-liquidez-diaria-105-21-09-26` venceu 21/09 com **R$ <valor>** e sem resgate. Hoje congelado = capitalizado (o BCB ainda não publicou a taxa de 22/09); sem o fix, renderia a partir de 23/09.
- `cdb-liquidez-diaria-105-24-09-26` vence **24/09** (R$ <valor> hoje).
- 16 títulos venceram com resgate lançado no vencimento e resíduo ≤ 1¢ → o congelamento preserva o zero limpo.

## Regra

```
fixed_income com maturityDate ≠ null:
  taxas             = taxas com date < maturityDate    # o banco credita até o dia útil anterior (D−1)
  valor             = rfValueCents(ops ≤ asOf, taxas, multiplicador, asOf)
  priceDate         = última taxa < maturityDate
  pendingRedemption = maturityDate ≤ asOf && marketValueCents > 0
```

- Operações lançadas **depois** do vencimento entram pelo valor bruto (sem taxa): um resgate datado depois do vencimento zera a posição e limpa o pendente (o banco pode creditar e o usuário lançar dias depois).

- `asOf` é o parâmetro já existente (hoje em `portfolio`; fim do mês ou hoje em `history`) — o congelamento vale para todo ponto da série, retroativo por construção.
- Resgate no vencimento zera limpo: o valor do banco é o congelado (mesma matemática de CDI/SELIC do legado), resíduo ≤ 1¢ cai no `zeroClosedResidue` (`lastBalanceKind` SELL/AMORTIZATION).
- Resgate parcial mantém `pendingRedemption = true` enquanto houver saldo.
- `equity`/`pension` têm sentinela `9999-01-01` e não são afetados (regra só para `fixed_income`).
- Congelado ≠ `stale`: `stale` continua sendo estado da fonte (BCB).
- Reconciliação sem causa nova: as divergências do mês corrente já caem em `legado-sem-cdi-maio-2026` (o legado parou de aplicar CDI em mai/2026); `asOf 2026-09-16` fica intocado (vencimentos 21 e 24/09 são posteriores).

### Correção pós-implementação (2026-09-22): congelamento em D−1

A primeira versão truncava as taxas em `date ≤ maturityDate` (incluía o CDI do dia do vencimento). O resgate real do CDB 21/09 mostrou a diferença: banco **<valor>** × nosso **<valor>** — os R$ <valor> são exatamente a taxa de 21/09. Evidência nos 20 resgates históricos:

- **7 resgates lançados na data do vencimento** (fev–set/2026): todos batem com o nosso valor **D−1** (±1¢) e divergem do valor incluindo o dia do vencimento (R$ <valor> a R$ <valor>). Ex.: CDB 02/03 → resgate <valor> = nosso D−1 exato; com o dia do vencimento daria <valor>.
- Resgates **antecipados** (ex.: PagBank 01/07, um dia antes do vencimento) batem com o dia do resgate inclusive — não passam pelo congelamento.
- Com D−1, o valor congelado do CDB 21/09 fica **<valor>** (1¢ de arredondamento abaixo do banco, a mesma poeira dos históricos) e o resgate lançado zera limpo.

Regra final: `taxas = taxas com date < maturityDate`.
- Premissa: 1 vencimento por ativo (renovação = ativo novo, padrão do legado); BUY após o vencimento no mesmo ativo fica fora do escopo.

## Código

- `src/domain/position.ts`: `PositionInput` ganha `maturityDate: string | null`; `PositionValue` ganha `maturityDate: string | null` e `pendingRedemption: boolean`; `instrumentValue` trunca as taxas no vencimento (fixed_income) e calcula o flag. `rfValueCents` fica puro (recebe as taxas já truncadas).
- `src/services/portfolio.ts`: passa `maturityDate` ao input; `PortfolioPosition` expõe os 2 campos.
- `src/services/history.ts`: passa `maturityDate` (mês pós-vencimento congela); `HistoryPoint` sem campo novo.
- `src/api/routes/portfolio.ts`: `/api/portfolio` expõe `maturityDate` e `pendingRedemption` por posição (aditivo; mapeamento explícito).
- `web/src/api.ts`: tipo `PortfolioPosition` acompanha.
- `web/`: badge âmbar ao lado do nome em Posições (mesma célula do badge `desatualizado`, `PositionsView.tsx:161`) — "Vencido em 21/09 · resgate pendente"; faixa âmbar na Visão geral, entre o cabeçalho e os cards, quando houver vencidos — "1 título vencido sem resgate lançado · R$ <valor> congelados desde 21/09" — com atalho "Ver posições" reusando a navegação da alocação (`onAbrirPosicoes`, `App.tsx:56`). Sem alerta de vencimento futuro.

## Testes

- **Domínio** (`src/domain/position.test.ts`):
  - valor em `asOf` posterior ao vencimento == valor no vencimento (taxa do dia inclusa);
  - sem `maturityDate`, comportamento atual inalterado;
  - `pendingRedemption`: vencido com saldo → true; SELL no vencimento → false; SELL parcial → true; vencimento futuro → false;
  - sentinela `9999-01-01` não congela;
  - poeira ≤ 1¢ de título vencido vira 0 no `instrumentValue` e não flutua em `asOf` posterior.
- **Serviço** (`src/services/portfolio.test.ts`): posição expõe `maturityDate`/`pendingRedemption`; (`src/services/history.test.ts`) mês posterior ao vencimento não cresce.
- **API** (`src/api/app.test.ts`): shape de `/api/portfolio` com os 2 campos.
- **Aceite com dados reais** (2026-09-22):
  - `/api/portfolio` total = **<valor>** centavos (48 posições) — inalterado no dia do fix (total re-medido em 2026-09-22 após refresh de cotações: <valor> — ver ROADMAP; congelamento e reconciliação inalterados);
  - `cdb-liquidez-diaria-105-21-09-26`: `pendingRedemption: true`, `marketValueCents: <valor>` (D−1; o resgate real do banco foi <valor> — 1¢ de arredondamento);
  - `cdb-liquidez-diaria-105-24-09-26`: `pendingRedemption: false` hoje e `true` a partir de 24/09;
  - reconciliação `asOf 2026-09-16` = `referenceCents <valor>` / `unexplained 0`; visão live segue `unexplained 0`;
  - browser: badge em Posições e faixa na Visão geral com o caso 21/09; screenshot.
- **Verificação:** `npm test`, `npm run typecheck`, `npm run build:web`, `docker compose up -d --build` + `curl localhost:3000/api/health`.

## Riscos

- Se o legado continuar capitalizando um título vencido, a divergência futura no mês corrente pode precisar de causa própria — hoje `legado-sem-cdi-maio-2026` cobre os casos CDI; revisar se aparecer.
- Renovação no mesmo ativo (BUY após o vencimento) não é suportada; assumir ativo novo.
- O total do mês corrente deixa de crescer para os vencidos a partir de 23/09 (comportamento esperado; números de aceite do ROADMAP re-medidos no merge).
- `pendingRedemption` vale a partir do próprio dia do vencimento (`≤`): o badge aparece no dia — decisão consciente (o banco credita no dia).
