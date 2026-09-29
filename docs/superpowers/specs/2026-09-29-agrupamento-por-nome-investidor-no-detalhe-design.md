# Agrupamento de cartões por nome em Posições (investidor no detalhamento)

**Resumo:** a lista de Posições passa a agrupar por **nome normalizado apenas** — o investidor sai da chave do cartão e vira informação do detalhamento. Hoje 4 nomes são mantidos por Ana e Beto (`Tesouro Selic 2031`, `Investo FTSE Global Equities`, `It Now Ima-B5 P2 Fundo De Indice`, `BTG PACTUAL IPCA CURTA PREV…`): **8 cartões viram 4**. O cartão soma todos os investidores e mostra os nomes na meta; a gaveta em modo grupo ganha **seções por investidor com subtotal**. Nenhum número do aceite muda (mesmos membros, mesma soma) e não há mudança de API/banco.

**Depende de:** `/api/portfolio` (S4/S5), `web/src/posicoes.ts`, `CartaoAtivo`, `PainelGrupo`, `PositionsView` e a spec `2026-09-25-agrupamento-cartoes-posicoes-design.md`.

**Revê:** a decisão "chave = nome + investidor" da spec de 2026-09-25 (tabela de decisões, linha "Chave do grupo"). O restante daquela spec continua valendo (valores somados, ativo × encerrado, modo grupo na gaveta, `‹ Voltar`).

**Não faz parte:** unificar nomes parecidos que são dados distintos (`INVESTO FTSE ALL-WORLD · Ambos` × `Investo FTSE Global Equities · Ana/Beto` — renomear é edição de dado, não desta mudança); agrupar por outras chaves; mudança em `/api/portfolio`, banco ou `PainelAtivo`; expandir grupo na própria lista.

## Decisões do brainstorming (2026-09-29)

| Tema | Decisão |
|---|---|
| Chave do grupo | `nome.trim().toLowerCase()` — sem investidor; nomes iguais em corretoras/objetivos diferentes já eram agrupados e seguem agrupados |
| Investidores do grupo | `investidores: string[]` distintos e ordenados; vazio → "sem investidor"; `Ambos` é tratado como nome comum |
| Meta do cartão | Todos os nomes: `Ana, Beto`; com 1, o nome; nenhum, `sem investidor`; **com filtro Investidor ≠ "todos", os nomes são omitidos** (o filtro já dá o contexto) |
| Grupo com 1 investidor | Sem regressão: cabeçalho e lista atuais; meta do topo continua mostrando o investidor |
| Grupo com N>1 investidores | Gaveta em **seções por investidor**, ordenadas por valor da seção (desc); cabeçalho da seção com nome + subtotal (valor e rendimento R$/% sobre o capital da seção); dentro da seção, ordem atual por vencimento ↓ |
| Badge de vencimento | "vence X" quando **todos** os membros com `maturityDate` têm a mesma data (hoje só com membro único); sem data única, sem badge; `vencido … · resgate pendente` segue a mesma regra de data única, senão texto genérico |
| Clique na posição | Inalterado: abre o detalhe do instrumento (`PainelAtivo`) com `‹ Voltar` para o grupo |
| Encerradas | Mesma chave; seções por investidor também valem; seção com membros todos `marketValueCents === 0` mostra resultado realizado |
| Valores | Convenções atuais preservadas: soma em centavos, `null` conta 0, rendimento % = Σ rendimento ÷ Σ capital (por seção e do grupo), participação = Σ valor ÷ total |
| Implementação | Tudo local no web a partir do `/api/portfolio` já carregado; nenhum arquivo de API/banco |

## Regra (réplica em código)

```
chave(p)          = p.name.trim().toLowerCase()
investidores(g)   = distintos(m.investor não vazio), ordenados; [] → "sem investidor"
secoes(g)         = membros agrupados por investidor, ordenadas por valor da seção ↓
subtotal(secao)   = Σ valor/rendimento/capital dos membros (convenções atuais)
badgeVenc(g)      = datas não nulas dos membros → se todas iguais, "vence a data"; senão nada
```

## Código

| Arquivo | Mudança |
|---|---|
| `web/src/posicoes.ts` | `chaveDoGrupo` perde o investidor; `GrupoPosicoes.investidor: string \| null` vira `investidores: string[]` |
| `web/src/components/CartaoAtivo.tsx` | Meta com todos os investidores + prop `ocultarInvestidor`; badge de vencimento pela regra de data única |
| `web/src/components/PainelGrupo.tsx` | Seções por investidor com subtotal quando `investidores.length > 1`; com 1, render atual |
| `web/src/views/PositionsView.tsx` | Passa `ocultarInvestidor={investidor !== "todos"}`; nenhuma outra mudança |
| `web/src/styles.css` | Classes das seções (título, subtotal) reusando tokens |
| API/backend/migrations | **Nenhum arquivo** |

## Testes e aceite

- Sem runner no web (padrão do projeto): nenhum teste automatizado novo; `npm test` deve continuar com **232 verdes**, `npm run typecheck` e `npm run build:web` limpos.
- Aceite no browser com dados reais (cotações oscilam intraday; critério é bater com `/api/portfolio` no load):
  1. Os 4 nomes com dois investidores renderizam **1 cartão cada** com os valores somados; Renda Fixa e Renda Variável sem cartões duplicados de Ana/Beto.
  2. Gaveta do grupo: seções `Ana` e `Beto` com subtotais; `subtotal(Ana) + subtotal(Beto) = valor do cartão`; rendimento % da seção bate com Σ rendimento ÷ Σ capital da seção.
  3. Cartão com filtro Investidor = `Beto`: valor só da Beto e meta sem nomes; gaveta com 1 seção sem cabeçalho.
  4. `Tesouro Selic 2031`: badge `vence …` aparece com os dois membros na mesma data; grupos com vencimentos diferentes não ganham badge.
  5. Total do cabeçalho e encerradas inalterados em relação a antes da mudança; screenshots novos em `.superpowers/sdd/`.

## Riscos

- **Nome como identidade:** renomear um ativo na planilha separa o grupo de novo; é só apresentação, sem impacto de dados.
- **Fundos com nomes parecidos:** `INVESTO FTSE ALL-WORLD` × `Investo FTSE Global Equities` continuam cartões separados até o dado ser unificado.
- **Grupo misto (um investidor ativo, outro encerrado):** a seção encerrada aparece dentro do grupo ativo com resultado realizado — comportamento pretendido, mas conferir no aceite.
