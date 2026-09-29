# Rebalanceamento (metas RF × RV, sem reserva)

**Resumo:** nova seção "Rebalanceamento" onde o usuário define a meta % de **Renda Fixa × Renda Variável** e quanto quer investir; o app mostra quantos reais aportar em cada grupo para deixar a carteira o mais próxima possível da meta, **sem vender**. Reserva de emergência fica fora; previdência (PGBL) conta como RF.

**Depende de:** `/api/portfolio` (S4), classes do web (`classeDe`), campos `objective`/`investor` do cadastro (S2/v2), migration runner (`src/db/migrate.ts`), helpers `parsePercentualParaE6`/`parseMoedaParaCents`/`formataBRL`/`formataPercentual`.

**Não faz parte:** venda/redistribuição do que está acima da meta; sugestão por ativo; filtro ou metas por investidor; imposto líquido × líquido (v3); projeção até 2099 (etapa separada).

## Decisões do brainstorming (2026-09-25)

| Tema | Decisão |
|---|---|
| Metas | RF × RV (2 grupos); previdência conta como RF; soma obrigatória 100% |
| Recorte | carteira inteira; exclui posições com `objective === "Reserva"` |
| Onde fica | 5ª seção da sidebar ("Rebalanceamento", entre Posições e Evolução) |
| Resultado | por grupo: % antes → alvo → depois e R$ sugerido; sem sugestão por ativo |
| Persistência | banco (migration 004, linha única): metas + último aporte |
| Seed | RF 80% / RV 20%, aporte R$ <valor> (hoje o split sem reserva é ~89/11) |
| Fórmula | water-filling do legado generalizada para 2 grupos: `F = max(D − τ, 0)` |

## Problema

O Excel legado tinha a Calculadora de Rebalanceamento (`Dashboard!B76:T89` + aba `Investimentos por Tipo - Rebala`): metas CDI 0% · IPCA 80% · AÇÕES 20%, aporte R$ <valor> `Dᵢ = metaᵢ × (base + aporte) − valorᵢ` e `Fᵢ = max(Dᵢ − τ, 0)` com `τ` na célula `J6`. O app não tem nada disso.

## Regra

```
base  = Σ marketValueCents das posições com objective ≠ "Reserva" e valor não nulo
RF    = kind ∈ {fixed_income, pension} ou category = etf_fixed
RV    = demais (kind equity)

alvo_RF = divRoundHalfUp(metaRF_E6 × (base + aporte), 1_000_000)
alvo_RV = (base + aporte) − alvo_RF          # resíduo fecha o centavo
Dᵢ      = alvoᵢ − valorᵢ                     # ΣD = aporte, exato em centavos

se D_RF ≥ 0 e D_RV ≥ 0 → F_RF = D_RF; F_RV = D_RV     # ambos abaixo da meta
senão se D_RF < 0      → F_RF = 0;     F_RV = aporte  # RF acima da meta
senão                  → F_RV = 0;     F_RF = aporte  # RV acima da meta

pct = total > 0 ? divRoundHalfUp(valor × 10_000, total) / 100 : 0   # 2 casas, igual à alocação
```

- É o caso de 2 grupos do water-filling do legado (`τ = 0` quando ninguém está acima; `τ = −D_neg` quando um está) — o Excel usava 3 grupos e as mesmas contas.
- `suggested_RF + suggested_RV === aporte` sempre; um grupo acima da meta recebe `0` e **nunca** ultrapassa a meta (o outro também não: `F ≤ D`).
- `stale` da resposta = alguma posição **considerada** (fora da reserva e com valor) tem `stale === true` no `/api/portfolio`.
- Validações ficam na borda (API/UI), não no domínio: metas somam 100%, cada meta em 0–100%, aporte inteiro ≥ 0.

## Persistência (`src/db/migrations/004_rebalance.sql`)

- Linha única `rebalance_targets(id INTEGER PRIMARY KEY CHECK (id = 1), rf_e6 INTEGER NOT NULL, rv_e6 INTEGER NOT NULL, amount_cents INTEGER NOT NULL, updated_at TEXT NOT NULL)`.
- Seed: `(1, <valor>, <valor>, 0, datetime('now'))`.
- `src/db/repos.ts`: `getRebalanceTargets` e `saveRebalanceTargets` (upsert `id = 1`).
- Percentuais em E6 (80% = `<valor>`), como `rateE6`; aporte em centavos.

## API (`src/api/routes/rebalance.ts`, 2 rotas)

`GET /api/rebalance?amountCents&rfE6&rvE6` — cálculo com dados vivos; os 3 parâmetros são opcionais (omitidos = valor persistido). `rfE6`/`rvE6` devem vir juntos (400 se só um). Resposta:

```json
{
  "asOf": "2026-09-25",
  "baseCents": 0,
  "amountCents": 0,
  "targets": { "rfE6": <valor>, "rvE6": <valor> },
  "groups": [
    { "key": "rf", "valueCents": 0, "pctBefore": 0, "targetE6": <valor>,
      "suggestedCents": 0, "afterValueCents": 0, "pctAfter": 0, "aboveTarget": false },
    { "key": "rv", "valueCents": 0, "pctBefore": 0, "targetE6": <valor>,
      "suggestedCents": 0, "afterValueCents": 0, "pctAfter": 0, "aboveTarget": false }
  ],
  "stale": false
}
```

`PUT /api/rebalance` — corpo `{ rfE6, rvE6, amountCents }`; valida soma `1_000_000`, cada meta em `0..1_000_000` e aporte inteiro ≥ 0; 400 em pt-BR ("as metas precisam somar 100%", "valor a investir inválido"). Resposta: config salva `{ rfE6, rvE6, amountCents, updatedAt }`.

## Web

- `web/src/App.tsx`: `View` ganha `"rebalanceamento"`; `ITENS` ganha a 5ª seção (ícone `Target`, entre Posições e Evolução); renderiza `<RebalanceView reloadToken={reloadToken} />`.
- `web/src/api.ts`: tipos `Rebalance`/`RebalanceGroup` + `getRebalance({ amountCents, rfE6, rvE6 }, signal)` e `saveRebalance(payload)`.
- `web/src/views/RebalanceView.tsx` (padrão `OverviewView`: `page-head`, callout de erro, `AbortController`):
  - Subtítulo "Fora da reserva de emergência".
  - Card "Metas": 2 inputs % (`parsePercentualParaE6`), validação de soma 100 na UI, botão "Salvar metas" com feedback ("Metas salvas" / erro inline) — `PUT`.
  - Campo "Quanto quero investir" (`parseMoedaParaCents`) com debounce ~400 ms; qualquer mudança (metas ou aporte) refaz o `GET` **com os valores do formulário** — prévia de meta ainda não salva funciona.
  - Resultado: sempre os 2 cartões (RF/RV) com "% antes → alvo → depois" e o **R$ sugerido em destaque**; badge "acima da meta — sem aporte novo" quando `aboveTarget`; linha de total "Carteira fora da reserva: base + aporte = total" (a soma das sugestões equivale ao aporte); aviso quando `stale`; base 0 → cartões zerados.

## Testes

- `src/domain/rebalance.test.ts`: ambos abaixo da meta (`F = D`, metas atingidas); RF acima (`F_RF = 0`, `F_RV = aporte`, `aboveTarget`); RV acima (simétrico); base 0; aporte 0; meta 100/0; centavos (soma exata do aporte, alvo RF half-up); `pct` com 2 casas; total 0 → `pct` 0.
- `src/services/rebalance.test.ts`: previdência e `etf_fixed` contam como RF; `objective === "Reserva"` excluído; posição sem valor ignorada; `stale` propaga; config do banco (seed 80/20 e aporte 0).
- `src/api/app.test.ts` (padrão do projeto): GET com e sem params; 400 para meta fora de 0–100, soma ≠ 100, aporte inválido e meta incompleta; PUT persiste e devolve a config.
- Web sem runner (padrão do projeto): aceite no browser.

## Aceite

- Verificação: `npm test`, `npm run typecheck`, `npm run build:web`, `docker compose up -d --build` + `/api/health` ok.
- Dados reais: conferência manual em BigInt da base sem reserva e das sugestões (RF/RV) para metas 80/20 e aporte R$ <valor> — `suggested_RF + suggested_RV = <valor>` centavos e `pctAfter` ≈ 80/20; screenshots 1280/1024; reconciliação segue `referenceCents <valor>` / `unexplained 0`.

## Riscos

- `objective` é texto livre: renomear "Reserva" na planilha inclui a reserva na base — mesma fragilidade do card (constante única, documentada).
- Posição `stale` entra com o último valor (convenção do app) e a tela avisa; posição sem valor fica fora (como a alocação).
- Fórmula é do legado, não é conselho de investimento: a tela mostra a conta e a premissa ("sem vender").
