# Agrupamento de cartões por nome + investidor em Posições

**Resumo:** a lista de Posições agrupa posições com **mesmo nome normalizado e mesmo investidor** num único cartão somado. Hoje: 25 posições ativas → **7 cartões** (`CDB-DI · Beto` sozinho tem 17 posições) e 23 encerradas → **5 linhas**. O cartão do grupo mostra chip `N posições`, valores somados (valor, rendimento R$ e %, barra de participação) e meta agregada; clicar abre a gaveta em **modo grupo** com a lista de posições (vencimento, valor, rendimento) e clicar numa posição abre o detalhe atual. **Sem mudança de API/banco.**

**Depende de:** `/api/portfolio` (S4/S5), `web/src/posicoes.ts`, `CartaoAtivo`, `Gaveta`/`PainelAtivo` e `PositionsView` (redesign de 2026-09-24).

**Não faz parte:** agrupar por outras chaves (só nome, só corretora, categoria); recorte por grupo na Visão geral/alocação/TWR/MWR; expandir o grupo na própria lista; edição em lote; criar/editar grupo; mudança de `/api/portfolio` (que segue posição a posição).

## Decisões do brainstorming (2026-09-25)

| Tema | Decisão |
|---|---|
| Chave do grupo | `nome.trim().toLowerCase() + "\|" + (investor ?? "")` — mesmo nome com investidor diferente segue em cartões separados; `sem investidor` agrupa os nulos |
| Grupo de 1 | Sem regressão: chip de taxa (`96% CDI`), meta (cotas/preço em RV), badge de vencimento e demais campos idênticos ao cartão atual |
| Grupo com N>1 | Chip da categoria (`CDB`, `LCA`); meta com corretora única ou `N corretoras` + investidor + objetivo único ou `N objetivos`; **sem** taxa e **sem** badge de vencimento no cartão (ficam na lista interna) |
| Badges do grupo | `desatualizado` se **qualquer** membro `stale`; `vencido … · resgate pendente` se **qualquer** membro `pendingRedemption` |
| Valores | Somas em centavos; `marketValueCents === null` conta 0 (convenção da tela); se **todos** os membros forem `null`, valor e rendimento exibem `—`; rendimento % do grupo = Σ rendimento ÷ Σ capital; participação = Σ valor ÷ total |
| Ativo × encerrado | Grupo **ativo** se ao menos um membro tem `marketValueCents !== 0`; **encerrado** se todos os membros têm `marketValueCents === 0` |
| Ordenação | O select ordena **grupos** pelo critério agregado; dentro do grupo, membros em valor ↓ |
| Clique no cartão | Cartão de **1 posição** abre o detalhe direto (sem modo grupo); grupo com N>1 abre a gaveta em **modo grupo** (cabeçalho somado + lista de membros); clique no membro abre o detalhe; o detalhe vindo do grupo ganha `‹ Voltar` que retorna ao grupo |
| Encerradas | Mesma chave, linha somada com `N posições` + `corretora · investidor` + resultado somado (R$ assinado); abrir mostra os membros com resultado individual |
| Cabeçalho | Contadores seguem contando **posições** (`48 de 48 ativos`); a contagem de grupos aparece nos chips dos cartões |
| Implementação | Tudo local no web a partir do `/api/portfolio` já carregado: helper puro `agruparPosicoes` em `posicoes.ts`; nenhum arquivo de API/banco |

## Regra (réplica em código)

```
chave(p)        = p.name.trim().toLowerCase() + "|" + (p.investor ?? "")
grupoAtivo(g)   = g.membros.some(m => m.marketValueCents !== 0)
valor(g)        = Σ (m.marketValueCents ?? 0)            # null conta 0
rendimento(g)   = Σ rendimentoDe(m).cents (não-nulos)
capital(g)      = Σ capitalDe(m)
pct(g)          = capital(g) > 0 ? rendimento(g)/capital(g)*100 : null
participacao(g) = total > 0 ? valor(g)/total*100 : null
brokers(g)      = distintos(m.broker sem vazios); objetivo(g) idem
stale(g)        = algum m.stale; pendente(g) = algum m.pendingRedemption
```

## Código

| Arquivo | Mudança |
|---|---|
| `web/src/posicoes.ts` | `chaveDoGrupo`, `agruparPosicoes` (retorna `GrupoPosicoes[]`) e `agregarGrupo` |
| `web/src/components/CartaoAtivo.tsx` | Passa a receber `grupo: GrupoPosicoes`; N=1 replica o cartão atual, N>1 rende o cartão somado |
| `web/src/components/PainelGrupo.tsx` | **Novo** — cabeçalho somado + lista de membros (vencimento/valor/rendimento, badges) e `onAbrirMembro` |
| `web/src/views/PositionsView.tsx` | Agrupa ativos/encerradas, ordena grupos, `EstadoGaveta` ganha `{ tipo: "grupo"; chave }` e a origem do detalhe; render do modo grupo |
| `web/src/styles.css` | Classes da lista de membros do grupo e do cartão agregado (reusa tokens) |
| API/backend/migrations | **Nenhum arquivo** |

## Testes e aceite

- Sem runner no web (padrão do projeto): nenhum teste automatizado novo; `npm test` deve continuar com **204 verdes**, `npm run typecheck` e `npm run build:web` limpos; `docker compose up -d --build` + `curl localhost:3000/api/health`.
- Aceite no browser com dados reais (2026-09-25; cotações oscilam intraday, o critério é bater com `/api/portfolio` no load):
  1. Renda Fixa com **7 cartões** (não 25): `CDB-DI · Beto` com chip `17 posições` e valor somado batendo com a API (`R$ <valor>` no momento da conferência); `BB LCA POS CDI · Ana` com `3 posições`; os 5 grupos de 1 idênticos aos cartões de hoje (taxa/meta/vencimento).
  2. `CDB-DI · Beto`: clique abre o modo grupo com 17 linhas (vencimento, valor, rendimento); a soma bate; clicar numa posição abre o detalhe com `‹ Voltar` para o grupo; `Nova transação` e `Editar cadastro` funcionam a partir do detalhe.
  3. Encerradas: **5 linhas** (3 + 3 + 15 + 1 + 1), resultado somado por linha; total `+R$ <valor>`; abrir `CDB Liquidez Diária 106%` lista as 15 posições.
  4. Ordenação por Valor/Rendimento movendo **grupos**; filtros (busca/corretora/objetivo/investidor/tipo) seguem filtrando posições e reagrupando o resultado.
  5. Sem overflow em 1280/1024/900; cabeçalho `48 de 48 ativos` inalterado; screenshots novos em `.superpowers/sdd/`.

## Riscos

- **Chave por nome é sensível a renomeação** na planilha/import: o grupo se separa; sem impacto de dados (só apresentação) e o critério é exatamente o que o usuário pediu.
- **Nome igual com investidor `null` vs `"Ambos"`**: chaves distintas — comportamento pretendido (pessoa diferente).
- **Grupo com membros de corretoras diferentes**: código agrega (`N corretoras`), embora hoje só existam grupos com corretora única.
- **Modo grupo na gaveta**: precisa da mesma reconciliação do detalhe (se o grupo sumir após refresh, fecha a gaveta); reaproveita o gate de render existente.
