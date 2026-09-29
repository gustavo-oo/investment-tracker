# Redesign visual da tela de Posições

**Resumo:** a tela de Posições troca a tabela por **cartões agrupados por classe econômica** (Renda Fixa · Renda Variável · Previdência), com cor por classe, valor, rendimento em R$ e %, barra de participação e contexto (corretora · investidor · objetivo). Posições **encerradas** (`marketValueCents === 0`) saem dos grupos e viram uma faixa colapsada com o resultado realizado somado. O painel do ativo vira **gaveta lateral com fundo escurecido** que concentra tudo do ativo: detalhe, transações em lista e formulários — **transação e cadastro são modos da gaveta**, e "Novo ativo" abre a gaveta em branco. **Sem modal em Posições.** O sistema de campos (`input`/`select`/data) ganha estilo próprio e os formulários usam segmented controls e sugestões digitáveis. **Zero mudança de API, banco ou migration.**

**Depende de:** `GET /api/portfolio` (S4/S5), `GET/POST/PATCH/DELETE /api/instruments*` e `PATCH/DELETE /api/transactions/:id` (v2), `web/src/views/PositionsView.tsx`, `FormAtivo`/`FormTransacao`/`Modal`, tokens de `web/src/styles.css` (S7) e `web/src/classes.ts`.

**Não faz parte:** mudanças estruturais na Visão geral/Evolução/Fontes; tema escuro; gráfico/sparkline nos cartões; novos tipos de transação além de Compra/Resgate; edição em lote; filtro por investidor no recálculo de TWR/MWR; teste automatizado de UI (o projeto não tem runner no web); mudança de API/banco.

## Decisões do brainstorming (2026-09-24)

| Tema | Decisão |
|---|---|
| Formato da lista | **Cartões**, 3 por linha no desktop (mockups em `.superpowers/brainstorm/<valor>-<valor>/content/lista-opcoes.html` e `cartoes-densidade.html`; variante 1 escolhida) |
| Agrupamento | Por **classe econômica** (`classeDe`: ETF de RF conta como RF), na ordem `ORDEM_CLASSE` |
| Encerradas | `marketValueCents === 0` → fora dos grupos; faixa colapsada "N posições encerradas" com resultado realizado (`Σ redeemedCents − investedCents`) |
| Cor por classe | RF `#3F6B52` · RV `#47657F` · Previdência `#9A6A2A` (fonte única em `classes.ts`); nunca sozinha, sempre com rótulo |
| Painel do ativo | **Gaveta** lateral 440px sobre scrim, `<dialog>` nativo (Esc, clique fora, foco preso, fundo inerte) — mockups `painel-opcoes.html` (A) |
| Conteúdo da gaveta | Modos **detalhe ⇄ transação ⇄ cadastro**; "Novo ativo" abre a gaveta em modo cadastro; nenhuma modal em Posições |
| Formulários | Campos estilizados (borda/raio/foco/erro); Tipo, Modelo e Investidor em **segmented**; Corretora/Objetivo/Liquidez com **sugestões digitáveis** (valor novo continua possível) — mockups `modais-visual-v2.html` (1 A, 2 A) e `conjunto-final.html` |
| Ordenação | Select atual permanece; a ordem vale **dentro de cada grupo** (padrão: valor ↓) |
| Filtros | Mantidos como hoje (Busca, Tipo, Corretora, Objetivo, Investidor, Ordenar), sem novos filtros |
| Escopo visual | Só Posições + componentes compartilhados (`styles.css` de campos, `Gaveta` novo); `Modal` continua existindo para a Visão geral |

## Problema (auditoria de 2026-09-24)

1. **Painel quebrado:** `.painel-ativo` fixo de 420px contém a tabela global com `min-width: 660px` (`styles.css:444`) → a tabela de transações corta colunas; `.stats` de 4 colunas em 420px corta os valores (`R$ <valor>…`, `set/2026`).
2. **Sem fundo/scroll-lock:** a coluna fixa cobre a lista sem scrim, sem Esc e sem travar a rolagem do fundo.
3. **Zeradas na lista:** 23 das 48 posições têm `marketValueCents === 0` (encerradas) e ocupam a lista com R$ <valor>
4. **Lista sem leitura rápida:** tabela densa, sem cor por classe, sem barra de participação nem contexto (corretora/investidor/objetivo).
5. **Formulários crus:** inputs nativos sem estilo; `select` sem borda por override (`.campo select { border: none }`, `styles.css:719`); botão "Salvar" usa `.btn` sem `.btn-primary` e parece desabilitado.

## 1. Lista

- **Cabeçalho da página:** título "Posições"; linha secundária `N de M ativos · valor total R$ X · rendimento +R$ Y (+Z%)` (mesmos cálculos de hoje; o contador inclui as encerradas — a faixa tem contagem própria); botão "Novo ativo" (abre a gaveta em modo cadastro).
- **Filtros:** card atual com os 6 campos; nenhum novo.
- **Grupos:** para cada classe em `ORDEM_CLASSE`, renderiza só se houver posição ativa. Cabeçalho: quadrado na cor da classe, rótulo, `N ativos · R$ X · P%` (soma e % da carteira; encerradas não entram no cabeçalho) e barra fina de proporção.
- **Cartão** (elemento `<button>`; Enter/clique abrem a gaveta):
  1. Nome + chip à direita: RF → taxa (`96% CDI`, `100,1% Selic`); RF sem taxa → categoria (`CDB`, `LCA`, `Selic`); ETF RF/RV → `ETF RF`/`ETF RV`; PGBL → `PGBL · IPCA`.
  2. Valor (`—` quando `marketValueCents === null`; badge `desatualizado` quando `stale` — fonte fora do ar mantém o último valor, regra herdada do AGENTS.md).
  3. Rendimento: `▲ +R$ X (+Y%)` em verde, `▼`/vermelho quando negativo; "sem cotação hoje" quando não há cotação.
  4. Barra de participação + `P%` (`Math.min(100, pct)`; sem barra quando o valor é `null`).
  5. Contexto (linha fraca): `corretora · investidor · objetivo`, omitindo vazios; RV acrescenta `N cotas · R$ preço`.
  6. Badges: `vence DD/MM/AAAA`, `vencido em DD/MM/AAAA · resgate pendente`, `desatualizado` — mesmos textos de hoje.
- **Ordenação:** o select atual ordena **dentro de cada grupo** (chaves e critérios inalterados).
- **Encerradas:** faixa única ao final: `▸ N posições encerradas (R$ <valor>) · resultado realizado somado +R$ X`; expandida, linhas compactas (`nome · corretora · investidor`, resultado assinado, rótulo "encerrada"). Linha clicável abre a gaveta do ativo (com as transações).
- **Vazios:** sem posições → estado vazio atual; filtros sem resultado → "Nenhum ativo" atual.

## 2. Gaveta (`Gaveta.tsx` + modos)

- **Base:** `<dialog class="gaveta">` com `showModal()`; posicionada à direita, `width: min(440px, 100vw)`, altura total, rolagem interna; `::backdrop` escurecido. Fecha no X, no Esc (nativo) e no clique fora (`event.target === dialog`). Ao abrir, foco no botão "Fechar". Trocar de ativo reseta para o modo detalhe.
- **Modo detalhe:** nome com ponto na cor da classe + chips (classe, categoria, corretora, investidor, objetivo); valor grande; rendimento (R$ e %); barra de participação; grade 2×2 conforme o tipo:
  - RF: Taxa · Vencimento · Índice em (`priceDate`) · Capital (`invested − redeemed`).
  - RV: Cotas · Preço · Preço em · Capital.
  - Previdência: Cotas · Cota · Cota em · Capital.
  - Ações: `Editar cadastro` (vai ao modo cadastro) e `Nova transação` (vai ao modo transação).
- **Transações:** contador + resumo `Aportes R$ X · Resgates R$ Y`; **lista** (não tabela): data, chip do tipo (`Compra`/`Resgate`), `sem taxas` ou `taxas R$ X`, valor e ícone de edição. Clique abre o modo transação preenchido. Sem `min-width` de tabela — é o que corta hoje.
- **Modo transação:** formulário de Compra/Resgate (ver §3). Salvar → recarrega carteira + transações e **volta ao detalhe** (a gaveta permanece aberta). Excluir em dois toques. "‹ Voltar" retorna ao detalhe sem salvar.
- **Modo cadastro:** formulário do ativo (ver §3). Editar salvo → recarrega e volta ao detalhe. **Novo ativo** → gaveta em branco; ao salvar, fecha a gaveta e a lista recarrega (o ativo só aparece na lista quando tiver transação — comportamento atual mantido). Exclusão do ativo em dois toques, desabilitada quando há transações (mesmos textos de hoje).

## 3. Formulários

- **Campos (estilo global em `styles.css`):** `input` (exceto checkbox), `select` e `textarea` com fundo `--surface`, borda `--border-strong`, raio `--radius-control`, altura ~36px, foco com anel `--ring`, `disabled` em `--surface-2`/`--text-3`, placeholder `--text-3`. Remove-se o override que zera a borda do select (`.campo select`) e o `.campo-com-icone` passa a ter borda própria em volta (busca).
- **Segmented** (componente `Segmented.tsx`, botões com `aria-pressed`): Tipo (`Compra` · `Resgate`), Modelo (`Renda fixa` · `ETF RF` · `ETF RV` · `PGBL`) e Investidor (`Ana` · `Beto` · `—`).
- **Sugestões digitáveis (`datalist`, texto livre preservado):** Corretora e Objetivo vêm das posições já carregadas (props de `PositionsView`), **sem** o marcador `—`; Liquidez vem de `GET /api/instruments` (mesma chamada que `editarAtivo` já faz; em "Novo ativo" ela passa a ser feita ao abrir).
- **Validação:** mesmas regras de hoje; erro exibido **junto do campo** (`role="alert"`), mantendo a mensagem inline atual como fallback.
- **Ações:** `Salvar` vira `.btn-primary` de verdade (corrige o botão que parece desabilitado hoje); `Cancelar` secundário; `Excluir` isolado à esquerda em `danger`, com confirmação em dois toques.
- **Aviso de travado:** quando o ativo tem transações, faixa âmbar no modo cadastro ("N transações lançadas. Modelo e categoria travados; excluir indisponível") — mesma regra vigente.

## 4. Cores, forma e acessibilidade

- `classes.ts` ganha `COR_DA_CLASSE: Record<Classe, string>` (`#3F6B52`, `#47657F`, `#9A6A2A`), usado inline em ponto, barra e filete do cartão. Ganho/perda seguem `--accent`/`--danger`; avisos `--warn`.
- Raio e sombra seguem o sistema atual (card 12, controle 10, pill 999). Sem token novo além das 3 cores de classe.
- Cartões e linhas são `<button type="button">` (foco visível, Enter abre); cor nunca comunica sozinha (sempre acompanhada de texto/valor).
- Breakpoints: cartões 3 colunas ≥1100px, 2 colunas 700–1100, 1 coluna <700; gaveta 100vw <640px. Sem overflow horizontal (`scrollWidth === innerWidth` em 1280/1024/900).

## 5. Código

| Arquivo | Mudança |
|---|---|
| `web/src/views/PositionsView.tsx` | Reescrita: grupos, cartões, faixa de encerradas, estado da gaveta (detalhe/transação/cadastro), sugestões |
| `web/src/components/Gaveta.tsx` | **Novo** — dialog lateral genérico (título, fechar, children) |
| `web/src/components/PainelAtivo.tsx` | **Novo** — conteúdo do detalhe (chips, valor, 2×2, lista de transações) |
| `web/src/components/Segmented.tsx` | **Novo** — grupo de botões com `aria-pressed` |
| `web/src/components/FormTransacao.tsx` | Deixa de usar `Modal`; vira conteúdo da gaveta (props de voltar/concluir); segmented + estilo |
| `web/src/components/FormAtivo.tsx` | Idem; segmented de Modelo, `datalist`s, aviso travado |
| `web/src/classes.ts` | `COR_DA_CLASSE` |
| `web/src/styles.css` | Campos globais, `.segmented`, `.cartao-ativo`, grupos, faixa de encerradas, `.gaveta`; remoção dos overrides que removem bordas |
| `web/src/components/Modal.tsx` | **Sem mudança** (segue usado nos detalhes da Visão geral) |
| API/backend/migrations | **Nenhum arquivo** |

## 6. Testes e aceite

- Sem runner no web (padrão do projeto): nenhum teste automatizado novo; `npm test` deve seguir com os **204 verdes**, `npm run typecheck` e `npm run build:web` limpos; `docker compose up -d --build` + `curl localhost:3000/api/health`.
- Aceite no browser com dados reais (2026-09-24; cotações oscilam intraday, o critério é bater com `/api/portfolio` no load):
  1. 48 posições: grupos RF 23 · RV 1 · Previdência 1; **nenhum cartão com R$ <valor>**; faixa "23 posições encerradas · +R$ <valor>".
  2. BB LCA POS CDI: `R$ <valor>`, `+R$ <valor> (+20,52%)`, chip `96% CDI`, `vence 09/02/2029`, capital `R$ <valor>`, 1 transação (23/04/2025, R$ <valor>) — abrindo pelo cartão e pela linha de encerrada.
  3. Gaveta: X, Esc e clique fora fecham; fundo não rola; foco visível; "‹ Voltar" entre modos.
  4. Fluxos v2 preservados na gaveta: compra cria posição; resgate acima do saldo rejeitado inline; excluir transação e ativo em dois toques; ativo com transações com classe travada.
  5. "Novo ativo" abre a gaveta em branco e salva.
  6. Sem overflow em 1280/1024/900; cartões 3/2/1 colunas; gaveta 100% em <640.
  7. Screenshots novos em `.superpowers/sdd/`.

## 7. Riscos

- **PositionsView cresce:** a reescrita concentra grupos + gaveta + faixa; mitigação: extrair `Gaveta`, `PainelAtivo` e `Segmented` (cada arquivo <400 linhas, padrão do fluxo).
- **`<dialog>` como gaveta:** posicionamento/rolagem variam por browser; validar no Chrome do aceite e nos breakpoints.
- **Números do aceite oscilam intraday:** comparar sempre com `/api/portfolio` no mesmo instante, nunca com valores fixos deste documento.
- **Acessibilidade da gaveta:** o foco inicial e a inércia do fundo vêm do `<dialog>` nativo; conferir teclado (Tab, Esc) no aceite.
- **Formulários sem modal:** `Modal.tsx` não pode ser removido (Visão geral usa); remover apenas o uso em Posições.
