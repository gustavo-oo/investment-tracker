# Reconciliação: causa `transacao-no-mes` (emenda à spec da S6)

**Resumo:** a visão ao vivo da reconciliação (`asOf` = hoje) deixa de marcar como `nao-explicada` as divergências causadas por **transações de saldo já ocorridas no mês** (entre o snapshot do legado e o `asOf`). Nova causa `transacao-no-mes`, regra pura em `classifyDivergence` posicionada depois das causas específicas e do `cotacao-fora-da-janela`, antes do fallback. Sem migration, sem mudança de dados; a verificação canônica (`asOf=2026-09-16`) fica **idêntica**.

**Depende de:** `src/services/reconciliation.ts` (S6), `web/src/api.ts` e `web/src/views/SourcesView.tsx` (rótulo). Emenda a spec `2026-09-21-s6-dashboard-reconciliacao-design.md` (lista de causas, regra 9 vira 10).

## Contexto (investigação de 2026-09-29)

Varredura `GET /api/reconciliation?month=2026-09&asOf=2026-09-16…29`:

- `unexplained 0` até 20/09; **+1 em 21/09** (SELL que zera `cdb-liquidez-diaria-105-21-09-26`, legado `<valor>`); **+1 em 24/09** (idem `…-24-09-26`, legado `<valor>`); **+2 em 28/09** (BUY de 28/09 em `b5p211-julia` R$ <valor> e `wrld11-julia` R$ <valor>).
- Antes das datas, os mesmos itens eram `transacao-fora-da-janela` (a transação estava no "futuro" do `asOf`).
- **Causa raiz:** a regra `transacao-fora-da-janela` cobre só `asOf < tradeDate ≤ monthEnd` — correta para o teste canônico em 16/09, mas a atividade entre o snapshot legado e o `asOf` da visão ao vivo não tem causa e cai no fallback.
- Não existe transação de saldo entre 01/09 e 16/09 (as de setembro são 17/09, 21/09, 24/09 e 28/09) → uma regra de "mês até o asOf" não altera nenhuma causa em `asOf=16`.

## Decisões

| Tema | Decisão |
|---|---|
| Causa nova | `transacao-no-mes` — "transação de saldo no mês, com `monthStart ≤ tradeDate ≤ asOf`" |
| Ordem da regra | Depois de todas as causas específicas (incluindo `cotacao-fora-da-janela`), imediatamente antes de `nao-explicada`: não mascara bug conhecido do legado nem a causa de cotação |
| Ordem em `RECONCILIATION_CAUSES` | Inserir entre `cotacao-fora-da-janela` e `nao-explicada` (espelha a ordem das regras) |
| Aproximação | Sem a data de referência do snapshot no banco, a janela é o mês até o `asOf`; documentar que atividade antes da referência (01–16/09 em snapshots futuros) poderia ser classificada assim — nenhuma hoje; precisão fina = Fix B (data de referência no banco) |
| UI | Rótulo em `ROTULO_CAUSA`: "Transação no mês (posterior ao snapshot do legado)" |
| Sem mudança | Sem migration, sem import, sem alteração de `legacy_snapshots`; a canônica de 16/09 (28 divergências, mesmas causas, `referenceCents <valor>`, `unexplained 0`) não muda |
| Convenções | Zero float; boolean no `classifyDivergence` (função pura); textos pt-BR |

## Regra (réplica em código)

```
transacao-no-mes(g, m, asOf) = existe transação com kind ∈ {BUY, SELL, AMORTIZATION}
                               e m-01 <= tradeDate <= asOf
ordem: residuo-zerado → transacao-fora-da-janela → legado-snapshot-maio-2025 →
       legado-sem-cdi-maio-2026 → legado-sem-selic-junho-2026 → fonte-yahoo-corrompida →
       data-de-referencia → cotacao-fora-da-janela → transacao-no-mes → nao-explicada
```

## Código

| Arquivo | Mudança |
|---|---|
| `src/services/reconciliation.ts` | `RECONCILIATION_CAUSES` + `transacao-no-mes`; input de `classifyDivergence` ganha `transactionInMonthUpToAsOf: boolean`; regra antes do fallback; `buildReconciliation` passa o flag via `hasTransactionInMonthUpTo(instrumentId)` |
| `web/src/api.ts` | União `ReconciliationCause` + `"transacao-no-mes"` |
| `web/src/views/SourcesView.tsx` | `ROTULO_CAUSA` + rótulo novo |
| Banco/migrations | **Nenhum** |

## Testes e aceite

- TDD em `src/services/reconciliation.test.ts`: (1) `transacao-no-mes` quando a única explicação é a transação no mês; (2) prioridade de `transacao-fora-da-janela`, `legado-sem-cdi-maio-2026`, `data-de-referencia` e `cotacao-fora-da-janela` sobre a nova regra; (3) integração `buildReconciliation`: ETF com SELL em 20/09 e cota de 10/09 — `asOf=19/09` → `transacao-fora-da-janela`; `asOf=30/09` → `transacao-no-mes`, `unexplained 0`.
- `npm test` verde (232 + novos), `npm run typecheck`, `npm run build:web` limpos.
- Aceite com dados reais: varredura `asOf` 16 → 29/09 com `unexplained 0` em todos os dias (hoje: 0 até 20/09, 1 em 21–23/09, 2 em 24–27/09, 4 em 28–29/09 → depois do fix: 21/24/28/29 explicadas por `transacao-no-mes`); canônica `asOf=2026-09-16` com `referenceCents <valor>` e a mesma distribuição de causas; browser em Fontes mostra o rótulo novo.
- Docker `healthy`; reconciliação `asOf=2026-09-16`/`0` no merge.

## Riscos

- **Aproximação do mês:** uma divergência causada por transação anterior à referência do snapshot (01–16/09) passaria a ser `transacao-no-mes`; hoje isso é vazio e a decisão fica documentada — se incomodar em snapshots futuros, o Fix B (data de referência no banco) resolve.
- **Colocação da regra:** se fosse antes das causas específicas, mascararia `legado-sem-cdi`/`data-de-referencia`; por isso ela vem quase no fim.
