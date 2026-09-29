# Agrupamento de cartões por nome + investidor — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** agrupar em um só cartão as posições com mesmo nome e mesmo investidor (25 → 7 cartões ativos; 23 → 5 linhas de encerradas), com modo grupo na gaveta.

**Architecture:** só web. `web/src/posicoes.ts` ganha a chave e a agregação puras (`agruparPosicoes`); `CartaoAtivo` passa a renderizar um `GrupoPosicoes` (N=1 idêntico ao cartão atual, N>1 somado); `PainelGrupo` (novo) é o conteúdo do modo grupo da gaveta; `PositionsView` agrupa, ordena grupos e liga os modos. Spec: `docs/superpowers/specs/2026-09-25-agrupamento-cartoes-posicoes-design.md`.

**Tech Stack:** React 19 + TypeScript, Vite 8, CSS puro em `web/src/styles.css`, `@phosphor-icons/react`, `<dialog>` nativo.

## Global Constraints

- Zero `float` em dado persistido/cálculo: somas em centavos inteiros; `Number` só na borda de apresentação (percentuais).
- Artefatos e commits em pt-BR; commits convencionais sem acento.
- Web sem runner de testes: nenhum teste automatizado novo — `npm run typecheck`, `npm run build:web`, `npm test` (204 verdes) e browser com dados reais.
- Cada task: ≤ 400 linhas de diff e ≤ 10 arquivos.
- `package-lock.json` não muda (sem dependência nova).
- Só tokens existentes de `web/src/styles.css` (papel quente, S7); sem tema escuro.
- Chave do grupo: `nome.trim().toLowerCase() + "|" + (investor ?? "")`; `null`/vazio agrupam juntos.
- `grossCents`/`feesCents` sempre ≥ 0; `quantityE8` negativo em `SELL` (exibição com `Math.abs`).
- Texto de UI em pt-BR com plural correto ("1 posição"/"17 posições", "1 corretora"/"N corretoras").
- Sem mudança de API/backend/migrations; `Modal.tsx` permanece (Visão geral).

---

### Task 1: Helper de agrupamento + cartão agregado + painel do grupo

**Files:**
- Modify: `web/src/posicoes.ts` (append)
- Modify: `web/src/components/CartaoAtivo.tsx` (reescrita)
- Create: `web/src/components/PainelGrupo.tsx`
- Modify: `web/src/components/PainelAtivo.tsx` (cabeçalho com `‹ Voltar ao grupo` opcional)
- Modify: `web/src/styles.css` (append)

**Interfaces:**
- Consumes: `PortfolioPosition` de `web/src/api.ts`; `formataBRL`, `formataBRLSinal`, `formataCategoria`, `formataData`, `formataPercentualSinal`, `formataQuantidade` de `web/src/format.ts`; `COR_DA_CLASSE`, `ROTULO_CLASSE`, `classeDe` de `web/src/classes.ts`; `taxaTexto` de `PainelAtivo.tsx`.
- Produces: `chaveDoGrupo(posicao)`, `agruparPosicoes(posicoes)`, tipo `GrupoPosicoes` (campos: `chave`, `nome`, `investidor`, `membros`, `valorCents`, `semValor`, `capitalCents`, `resultadoRealizadoCents`, `rendimentoCents`, `rendimentoPct`, `stale`, `pendente`, `brokers`, `objetivos`); `CartaoAtivo({ grupo, totalCents, onAbrir })`; `PainelGrupo({ grupo, totalCents, onAbrirMembro })`; `PainelAtivo({ …, onVoltarGrupo? })`.

- [ ] **Step 1: Adicionar agrupamento em `web/src/posicoes.ts`**

No fim do arquivo:

```ts
export type GrupoPosicoes = {
  chave: string;
  nome: string;
  investidor: string | null;
  membros: PortfolioPosition[];
  valorCents: number;
  semValor: boolean;
  capitalCents: number;
  resultadoRealizadoCents: number;
  rendimentoCents: number | null;
  rendimentoPct: number | null;
  stale: boolean;
  pendente: boolean;
  brokers: string[];
  objetivos: string[];
};

/** Chave de agrupamento: nome normalizado + investidor (nulos/vazios agrupam juntos). */
export function chaveDoGrupo(posicao: Pick<PortfolioPosition, "name" | "investor">): string {
  return `${posicao.name.trim().toLowerCase()}|${posicao.investor ?? ""}`;
}

/** Agrupa posições por nome + investidor; membros em valor ↓ dentro do grupo. */
export function agruparPosicoes(posicoes: PortfolioPosition[]): GrupoPosicoes[] {
  const mapa = new Map<string, PortfolioPosition[]>();
  for (const posicao of posicoes) {
    const chave = chaveDoGrupo(posicao);
    const membros = mapa.get(chave);
    if (membros === undefined) mapa.set(chave, [posicao]);
    else membros.push(posicao);
  }
  return [...mapa.entries()].map(([chave, membros]) => agregarGrupo(chave, membros));
}

function agregarGrupo(chave: string, membros: PortfolioPosition[]): GrupoPosicoes {
  const ordenados = [...membros].sort((a, b) => (b.marketValueCents ?? 0) - (a.marketValueCents ?? 0));
  const semValor = ordenados.every((posicao) => posicao.marketValueCents === null);
  const valorCents = ordenados.reduce((soma, posicao) => soma + (posicao.marketValueCents ?? 0), 0);
  const capitalCents = ordenados.reduce((soma, posicao) => soma + capitalDe(posicao), 0);
  const resultadoRealizadoCents = ordenados.reduce((soma, posicao) => soma + resultadoRealizadoDe(posicao), 0);
  const rendimentoCents = semValor
    ? null
    : ordenados.reduce((soma, posicao) => soma + (rendimentoDe(posicao).cents ?? 0), 0);
  const rendimentoPct = rendimentoCents === null || capitalCents <= 0 ? null : (rendimentoCents / capitalCents) * 100;
  const distintos = (valores: Array<string | null>): string[] =>
    [...new Set(valores.filter((valor): valor is string => valor !== null && valor !== ""))].sort();
  return {
    chave,
    nome: ordenados[0].name,
    investidor: ordenados[0].investor,
    membros: ordenados,
    valorCents,
    semValor,
    capitalCents,
    resultadoRealizadoCents,
    rendimentoCents,
    rendimentoPct,
    stale: ordenados.some((posicao) => posicao.stale),
    pendente: ordenados.some((posicao) => posicao.pendingRedemption),
    brokers: distintos(ordenados.map((posicao) => posicao.broker)),
    objetivos: distintos(ordenados.map((posicao) => posicao.objective)),
  };
}
```

- [ ] **Step 2: Reescrever `web/src/components/CartaoAtivo.tsx`**

```tsx
import { formataBRL, formataBRLSinal, formataCategoria, formataData, formataPercentualSinal, formataQuantidade } from "../format.ts";
import { COR_DA_CLASSE, classeDe } from "../classes.ts";
import { participacaoPct, type GrupoPosicoes } from "../posicoes.ts";
import { taxaTexto } from "./PainelAtivo.tsx";

export function CartaoAtivo({ grupo, totalCents, onAbrir }: {
  grupo: GrupoPosicoes;
  totalCents: number;
  onAbrir: (grupo: GrupoPosicoes) => void;
}) {
  const posicao = grupo.membros[0];
  const cor = COR_DA_CLASSE[classeDe(posicao)];
  const umSo = grupo.membros.length === 1;
  const taxa = taxaTexto(posicao.rateE6, posicao.benchmark);
  const participacao = participacaoPct(grupo.semValor ? null : grupo.valorCents, totalCents);

  const chip = umSo
    ? posicao.kind === "pension" ? "PGBL · IPCA"
      : posicao.category === "etf_fixed" ? "ETF RF"
        : posicao.category === "etf_equity" ? "ETF RV"
          : taxa ?? formataCategoria(posicao.category)
    : `${grupo.membros.length} posições`;

  const meta: string[] = [];
  if (umSo && posicao.kind !== "fixed_income") {
    if (posicao.quantityE8 !== null) meta.push(`${formataQuantidade(posicao.quantityE8)} cotas`);
    if (posicao.priceCents !== null) meta.push(formataBRL(posicao.priceCents));
  }
  if (grupo.brokers.length === 1) meta.push(grupo.brokers[0]);
  else if (grupo.brokers.length > 1) meta.push(`${grupo.brokers.length} corretoras`);
  meta.push(grupo.investidor ?? "sem investidor");
  if (grupo.objetivos.length === 1) meta.push(grupo.objetivos[0]);
  else if (grupo.objetivos.length > 1) meta.push(`${grupo.objetivos.length} objetivos`);

  return (
    <button type="button" className="cartao-ativo" style={{ borderLeft: `3px solid ${cor}` }} onClick={() => onAbrir(grupo)}>
      <span className="cartao-topo">
        <span className="cartao-nome">{grupo.nome}</span>
        <span className="cartao-chip">{chip}</span>
      </span>
      <span className="cartao-valor">{grupo.semValor ? "—" : formataBRL(grupo.valorCents)}</span>
      {grupo.rendimentoCents === null ? (
        <span className="cartao-sem-cotacao">sem cotação hoje</span>
      ) : (
        <span className={grupo.rendimentoCents >= 0 ? "cartao-rendimento rendimento-positivo" : "cartao-rendimento rendimento-negativo"}>
          {grupo.rendimentoCents >= 0 ? "▲" : "▼"} {formataBRLSinal(grupo.rendimentoCents)}
          {grupo.rendimentoPct === null ? "" : ` (${formataPercentualSinal(grupo.rendimentoPct)})`}
        </span>
      )}
      {participacao !== null && (
        <span className="cartao-participacao">
          <span className="cartao-barra"><span className="cartao-barra-fill" style={{ width: `${Math.min(100, participacao)}%`, background: cor }} /></span>
          <span className="cartao-pct">{participacao.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</span>
        </span>
      )}
      <span className="cartao-meta">{meta.join(" · ")}</span>
      <span className="cartao-badges">
        {grupo.stale && <span className="badge badge-warn">desatualizado</span>}
        {grupo.pendente && (
          <span className="badge badge-warn">
            {umSo && posicao.maturityDate !== null ? `vencido em ${formataData(posicao.maturityDate)} · resgate pendente` : "vencido · resgate pendente"}
          </span>
        )}
        {umSo && !grupo.pendente && posicao.maturityDate !== null && (
          <span className="badge badge-neutro">vence {formataData(posicao.maturityDate)}</span>
        )}
      </span>
    </button>
  );
}
```

- [ ] **Step 3: Criar `web/src/components/PainelGrupo.tsx`**

```tsx
import type { PortfolioPosition } from "../api.ts";
import { formataBRL, formataBRLSinal, formataCategoria, formataData, formataPercentualSinal } from "../format.ts";
import { COR_DA_CLASSE, ROTULO_CLASSE, classeDe } from "../classes.ts";
import { participacaoPct, rendimentoDe, resultadoRealizadoDe, type GrupoPosicoes } from "../posicoes.ts";

export function PainelGrupo({ grupo, totalCents, onAbrirMembro }: {
  grupo: GrupoPosicoes;
  totalCents: number;
  onAbrirMembro: (posicao: PortfolioPosition) => void;
}) {
  const posicao = grupo.membros[0];
  const cor = COR_DA_CLASSE[classeDe(posicao)];
  const encerrado = grupo.membros.every((membro) => membro.marketValueCents === 0);
  const participacao = participacaoPct(grupo.semValor ? null : grupo.valorCents, totalCents);
  const meta: string[] = [];
  if (grupo.brokers.length === 1) meta.push(grupo.brokers[0]);
  else if (grupo.brokers.length > 1) meta.push(`${grupo.brokers.length} corretoras`);
  meta.push(grupo.investidor ?? "sem investidor");
  if (grupo.objetivos.length === 1) meta.push(grupo.objetivos[0]);

  return (
    <div className="painel-conteudo">
      <div className="gaveta-cabecalho">
        <span className="painel-ponto" style={{ background: cor }} aria-hidden="true" />
        <h2 className="gaveta-titulo">{grupo.nome}</h2>
      </div>
      <p className="tags">
        <span className="chip chip-classe" style={{ color: cor, borderColor: cor }}>{ROTULO_CLASSE[classeDe(posicao)]}</span>
        <span className="chip">{grupo.membros.length} {grupo.membros.length === 1 ? "posição" : "posições"}</span>
        <span className="chip">{formataCategoria(posicao.category)}</span>
      </p>
      <p className="painel-valor">{grupo.semValor ? "—" : formataBRL(grupo.valorCents)}</p>
      {encerrado ? (
        <p className="painel-sem-cotacao">posições encerradas (R$ <valor>): resultado realizado {formataBRLSinal(grupo.resultadoRealizadoCents)}</p>
      ) : grupo.rendimentoCents === null ? (
        <p className="painel-sem-cotacao">sem cotação registrada</p>
      ) : (
        <p className={grupo.rendimentoCents >= 0 ? "painel-rendimento rendimento-positivo" : "painel-rendimento rendimento-negativo"}>
          {grupo.rendimentoCents >= 0 ? "▲" : "▼"} {formataBRLSinal(grupo.rendimentoCents)}
          {grupo.rendimentoPct === null ? "" : ` (${formataPercentualSinal(grupo.rendimentoPct)})`}
        </p>
      )}
      {participacao !== null && (
        <>
          <span className="cartao-barra painel-participacao">
            <span className="cartao-barra-fill" style={{ width: `${Math.min(100, participacao)}%`, background: cor }} />
          </span>
          <p className="painel-pct">{participacao.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% da carteira</p>
        </>
      )}
      <p className="painel-meta">{meta.join(" · ")}</p>
      <h3 className="section-title membros-titulo">Posições</h3>
      <ul className="membros">
        {grupo.membros.map((membro) => {
          const rendimento = rendimentoDe(membro);
          const encerrada = membro.marketValueCents === 0;
          return (
            <li key={membro.instrumentId}>
              <button type="button" className="membro" onClick={() => onAbrirMembro(membro)}>
                <span className="membro-esquerda">
                  <span className="membro-vencimento">{membro.maturityDate === null ? "—" : formataData(membro.maturityDate)}</span>
                  <span className="membro-notas">
                    {membro.stale && <span className="badge badge-warn">desatualizado</span>}
                    {membro.pendingRedemption && <span className="badge badge-warn">resgate pendente</span>}
                    {encerrada && <span className="badge badge-neutro">encerrada</span>}
                  </span>
                </span>
                <span className="membro-direita">
                  <span className="membro-valor">
                    {membro.marketValueCents === null ? "—" : encerrada ? formataBRLSinal(resultadoRealizadoDe(membro)) : formataBRL(membro.marketValueCents)}
                  </span>
                  <span className="membro-extra">
                    {encerrada ? "resultado realizado" : rendimento.pct === null ? "" : formataPercentualSinal(rendimento.pct)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="section-hint">Clique numa posição para ver detalhes, transações e cadastro.</p>
    </div>
  );
}
```

- [ ] **Step 4: Abrir espaço para `‹ Voltar ao grupo` no `PainelAtivo`**

Em `web/src/components/PainelAtivo.tsx`:

4a. Assinatura ganha `onVoltarGrupo?: () => void`:

```tsx
export function PainelAtivo({ posicao, totalCents, transacoes, onNovoTransacao, ... }: {
```
Substituir apenas o bloco de props por:

```tsx
export function PainelAtivo({ posicao, totalCents, transacoes, onNovaTransacao, onEditarTransacao, onEditarCadastro, onVoltarGrupo }: {
  posicao: PortfolioPosition;
  totalCents: number;
  transacoes: Transaction[] | null;
  onNovaTransacao: () => void;
  onEditarTransacao: (transacao: Transaction) => void;
  onEditarCadastro: () => void;
  onVoltarGrupo?: () => void;
}) {
```

4b. Cabeçalho atual (ponto + título) vira:

```tsx
      <div className="gaveta-cabecalho gaveta-cabecalho-linha">
        <div className="gaveta-cabecalho-titulo">
          <span className="painel-ponto" style={{ background: cor }} aria-hidden="true" />
          <h2 className="gaveta-titulo">{posicao.name}</h2>
        </div>
        {onVoltarGrupo !== undefined && (
          <button type="button" className="btn-voltar" onClick={onVoltarGrupo}>‹ Voltar ao grupo</button>
        )}
      </div>
```

- [ ] **Step 5: CSS em `styles.css` (append)**

```css
.gaveta-cabecalho-titulo { display: flex; align-items: center; gap: 9px; min-width: 0; }
.painel-meta { margin-top: 10px; font-size: 11.5px; color: var(--text-2); }
.membros-titulo { margin-top: 18px; }

.membros { list-style: none; margin: 8px 0 0; padding: 0; border: 1px solid var(--border); border-radius: var(--radius-control); overflow: hidden; }
.membros li + li { border-top: 1px solid var(--border); }
.membro { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; padding: 9px 11px; border: 0; background: transparent; font: inherit; text-align: left; color: var(--text); cursor: pointer; transition: background-color var(--dur) var(--ease); }
.membro:hover { background: var(--surface-2); }
.membro:focus-visible { outline: none; box-shadow: var(--ring); }
.membro-esquerda { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.membro-vencimento { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 12.5px; font-weight: 600; }
.membro-notas { display: flex; flex-wrap: wrap; gap: 4px; }
.membro-notas .badge { margin-left: 0; }
.membro-direita { display: flex; flex-direction: column; gap: 2px; text-align: right; }
.membro-valor { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-weight: 600; }
.membro-extra { font-size: 11px; color: var(--text-3); }
.encerradas-contagem { color: var(--text-3); font-weight: 400; }
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: sem erros (CartaoAtivo/PainelGrupo ainda não são usados pela view; compilam por si).

- [ ] **Step 7: Build e testes**

Run: `npm run build:web` e `npm test`
Expected: build ok (warning de chunk conhecido) e `# pass 204`.

- [ ] **Step 8: Commit**

```bash
git add web/src/posicoes.ts web/src/components/CartaoAtivo.tsx web/src/components/PainelGrupo.tsx web/src/components/PainelAtivo.tsx web/src/styles.css
git commit -m "feat: agrupamento de posicoes por nome e investidor (helper e componentes)"
```

---

### Task 2: Ligar os grupos na tela de Posições

**Files:**
- Modify: `web/src/views/PositionsView.tsx` (imports ~1-14; estado ~28-46; efeito do portfólio ~46-61; cálculos ~112-155; gaveta ~270-306; lista ~230-290)

**Interfaces:**
- Consumes: `agruparPosicoes`, `chaveDoGrupo`, `GrupoPosicoes` e `rendimentoDe` de `../posicoes.ts`; `CartaoAtivo({ grupo, … })`; `PainelGrupo({ grupo, totalCents, onAbrirMembro })`; `PainelAtivo({ …, onVoltarGrupo? })`.
- Produces: `PositionsView` com lista agrupada e `EstadoGaveta` incluindo `{ tipo: "grupo"; chave: string }`.

- [ ] **Step 1: Ajustar imports e estado**

1a. Nos imports de `../posicoes.ts`, usar:

```tsx
import { agruparPosicoes, capitalDe, chaveDoGrupo, rendimentoDe, type GrupoPosicoes } from "../posicoes.ts";
```

1b. Importar o painel:

```tsx
import { PainelGrupo } from "../components/PainelGrupo.tsx";
```

1c. `EstadoGaveta` ganha o modo grupo:

```tsx
type EstadoGaveta =
  | { tipo: "detalhe" }
  | { tipo: "transacao"; transacao: Transaction | null }
  | { tipo: "cadastro"; instrumento: Instrument | null; qtdTransacoes: number }
  | { tipo: "grupo"; chave: string };
```

1d. Estado novo para a origem do detalhe:

```tsx
  const [origemGrupo, setOrigemGrupo] = useState<string | null>(null);
```

- [ ] **Step 2: Reconciliação e abridores**

2a. No efeito que carrega o portfólio, acrescentar depois do `setPosicoes(...)` o fechamento do grupo que sumiu:

```tsx
        setGaveta((atual) => {
          if (atual === null || atual.tipo !== "grupo") return atual;
          return portfolio.positions.some((posicao) => chaveDoGrupo(posicao) === atual.chave) ? atual : null;
        });
```

2b. Trocar `abrirAtivo`/`fecharGaveta` por:

```tsx
  function abrirAtivo(posicao: PortfolioPosition) {
    setSelecionada(posicao);
    setOrigemGrupo(null);
    setGaveta({ tipo: "detalhe" });
  }

  function abrirGrupo(grupo: GrupoPosicoes) {
    setSelecionada(null);
    setOrigemGrupo(null);
    setGaveta({ tipo: "grupo", chave: grupo.chave });
  }

  function abrirMembroDoGrupo(posicao: PortfolioPosition) {
    if (gaveta?.tipo !== "grupo") return;
    setSelecionada(posicao);
    setOrigemGrupo(gaveta.chave);
    setGaveta({ tipo: "detalhe" });
  }

  function fecharGaveta() {
    setGaveta(null);
    setSelecionada(null);
    setOrigemGrupo(null);
  }
```

- [ ] **Step 3: Agrupar, comparar e derivar o grupo aberto**

3a. Depois do bloco que monta `visiveis` e antes do JSX, trocar os cálculos atuais de ativas/encerradas/grupos (do redesign anterior) por:

```tsx
  const encerradas = visiveis.filter((posicao) => posicao.marketValueCents === 0);

  function comparaGrupos(a: GrupoPosicoes, b: GrupoPosicoes): number {
    if (ordem === "nome") return a.nome.localeCompare(b.nome, "pt-BR");
    if (ordem === "rendimento") return (b.rendimentoCents ?? -Infinity) - (a.rendimentoCents ?? -Infinity);
    if (ordem === "rendimentoPct") return (b.rendimentoPct ?? -Infinity) - (a.rendimentoPct ?? -Infinity);
    return b.valorCents - a.valorCents;
  }

  const gruposAtivos = agruparPosicoes(visiveis.filter((posicao) => posicao.marketValueCents !== 0)).sort(comparaGrupos);
  const gruposEncerrados = agruparPosicoes(encerradas);
  const resultadoEncerradas = gruposEncerrados.reduce((soma, grupo) => soma + grupo.resultadoRealizadoCents, 0);
  const grupoDaGaveta = gaveta?.tipo === "grupo"
    ? [...gruposAtivos, ...gruposEncerrados].find((grupo) => grupo.chave === gaveta.chave) ?? null
    : null;
  const podeRenderizarGaveta = (() => {
    if (gaveta === null) return false;
    if (gaveta.tipo === "cadastro") return true;
    if (gaveta.tipo === "grupo") return grupoDaGaveta !== null;
    return selecionada !== null;
  })();
```

(`rendimentoTotal`/`capitalTotal` do cabeçalho continuam como estão, usando `rendimentoDe`/`capitalDe`.)

- [ ] **Step 4: Trocar o render da lista (cartões e encerradas)**

4a. `grupos.map(...)` de classes vira:

```tsx
          {ORDEM_CLASSE.map((classeGrupo) => {
            const doGrupo = gruposAtivos.filter((grupo) => classeDe(grupo.membros[0]) === classeGrupo);
            if (doGrupo.length === 0) return null;
            const valor = doGrupo.reduce((soma, grupo) => soma + grupo.valorCents, 0);
            const qtdPosicoes = doGrupo.reduce((soma, grupo) => soma + grupo.membros.length, 0);
            const pct = total > 0 ? (valor / total) * 100 : 0;
            return (
              <section key={classeGrupo} className="grupo-classe" aria-label={ROTULO_CLASSE[classeGrupo]}>
                <div className="grupo-cabecalho">
                  <span className="grupo-cor" style={{ background: COR_DA_CLASSE[classeGrupo] }} aria-hidden="true" />
                  <h2 className="grupo-nome">{ROTULO_CLASSE[classeGrupo]}</h2>
                  <span className="grupo-numeros">
                    {doGrupo.length} {doGrupo.length === 1 ? "grupo" : "grupos"} · {qtdPosicoes} {qtdPosicoes === 1 ? "ativo" : "ativos"} · {formataBRL(valor)} · {pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
                  </span>
                </div>
                <span className="grupo-barra" aria-hidden="true">
                  <span className="grupo-barra-fill" style={{ width: `${Math.min(100, pct)}%`, background: COR_DA_CLASSE[classeGrupo] }} />
                </span>
                <div className="grade-cartoes">
                  {doGrupo.map((grupo) => (
                    <CartaoAtivo key={grupo.chave} grupo={grupo} totalCents={total} onAbrir={abrirGrupo} />
                  ))}
                </div>
              </section>
            );
          })}
```

4b. O `<details>` de encerradas passa a listar grupos:

```tsx
          {gruposEncerrados.length > 0 && (
            <details className="encerradas">
              <summary>
                <span className="encerradas-resumo">
                  {encerradas.length} {encerradas.length === 1 ? "posição encerrada" : "posições encerradas"}
                  {gruposEncerrados.length > 1 ? ` em ${gruposEncerrados.length} grupos` : ""} (R$ <valor>) · resultado realizado{" "}
                  <strong className={resultadoEncerradas >= 0 ? "rendimento-positivo" : "rendimento-negativo"}>{formataBRLSinal(resultadoEncerradas)}</strong>
                </span>
                <span className="encerradas-toggle">mostrar</span>
              </summary>
              <ul className="encerradas-lista">
                {gruposEncerrados.map((grupo) => (
                  <li key={grupo.chave}>
                    <button type="button" className="encerrada" onClick={() => abrirGrupo(grupo)}>
                      <span className="encerrada-nome">
                        {grupo.nome}
                        {grupo.membros.length > 1 && <span className="encerradas-contagem"> · {grupo.membros.length} posições</span>}
                      </span>
                      <span className="encerrada-meta">
                        {[grupo.brokers[0], grupo.investidor].filter((valorMeta): valorMeta is string => valorMeta !== undefined && valorMeta !== null && valorMeta !== "").join(" · ")}
                      </span>
                      <span className={grupo.resultadoRealizadoCents >= 0 ? "encerrada-resultado rendimento-positivo" : "encerrada-resultado rendimento-negativo"}>
                        {formataBRLSinal(grupo.resultadoRealizadoCents)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
```

4c. `encerradas` continua sendo `visiveis.filter((posicao) => posicao.marketValueCents === 0)` (contagem de posições da faixa) — manter a linha existente.

- [ ] **Step 5: Render da gaveta**

Trocar o bloco atual `{gaveta !== null && (gaveta.tipo === "cadastro" || selecionada !== null) && (` por `podeRenderizarGaveta`, com os modos:

```tsx
      {podeRenderizarGaveta && (
        <Gaveta
          aberta
          titulo={gaveta.tipo === "grupo" ? (grupoDaGaveta?.nome ?? "Grupo") : selecionada === null ? "Novo ativo" : selecionada.name}
          onFechar={fecharGaveta}
        >
          {gaveta.tipo === "grupo" && grupoDaGaveta !== null && (
            <PainelGrupo grupo={grupoDaGaveta} totalCents={total} onAbrirMembro={abrirMembroDoGrupo} />
          )}
          {gaveta.tipo === "detalhe" && selecionada !== null && (
            <PainelAtivo
              posicao={selecionada}
              totalCents={total}
              transacoes={transacoes}
              onNovaTransacao={() => setGaveta({ tipo: "transacao", transacao: null })}
              onEditarTransacao={(transacao) => setGaveta({ tipo: "transacao", transacao })}
              onEditarCadastro={() => void editarAtivo()}
              onVoltarGrupo={origemGrupo === null ? undefined : () => { setGaveta({ tipo: "grupo", chave: origemGrupo }); setSelecionada(null); }}
            />
          )}
          {gaveta.tipo === "transacao" && selecionada !== null && (
            <FormTransacao
              posicao={selecionada}
              transacao={gaveta.transacao}
              onVoltar={() => setGaveta({ tipo: "detalhe" })}
              onConcluir={concluirMutacao}
            />
          )}
          {gaveta.tipo === "cadastro" && (
            <FormAtivo
              instrumento={gaveta.instrumento}
              qtdTransacoes={gaveta.qtdTransacoes}
              sugestoes={{ corretoras, objetivos, liquidez: sugestoesLiquidez }}
              onVoltar={() => { if (gaveta.instrumento === null) fecharGaveta(); else setGaveta({ tipo: "detalhe" }); }}
              onConcluir={concluirMutacao}
            />
          )}
        </Gaveta>
      )}
```

Nota: ao editar cadastro/transação a partir de um detalhe vindo do grupo, `origemGrupo` é preservado e o `‹ Voltar ao grupo` continua no detalhe.

- [ ] **Step 6: Typecheck, build e testes**

Run: `npm run typecheck && npm run build:web && npm test`
Expected: typecheck limpo, build ok (warning conhecido), `# pass 204`.

- [ ] **Step 7: Conferência rápida no browser**

Run: `npm run dev:web -- --port 5179` em background, abrir `http://localhost:5179`, seção Posições, e encerrar o servidor ao final.
Expected: RF com 7 cartões (`CDB-DI` com chip `17 posições`; `BB LCA POS CDI` com `3 posições`); clique no grupo abre a lista de posições; clique numa posição abre o detalhe com `‹ Voltar ao grupo`; encerradas em 5 linhas.

- [ ] **Step 8: Commit**

```bash
git add web/src/views/PositionsView.tsx
git commit -m "feat: lista de posicoes agrupada por nome e investidor"
```

---

### Task 3: Aceite no browser com dados reais + verificação final

**Files:**
- Nenhum arquivo de código; screenshots em `.superpowers/sdd/`; `ROADMAP.md` ao final

- [ ] **Step 1: Conferir a API real**

```bash
curl -s localhost:3000/api/portfolio | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  const p=JSON.parse(d);
  const key=x=>x.name.trim().toLowerCase()+'|'+(x.investor??'');
  const ativas=p.positions.filter(x=>x.marketValueCents!==0);
  const enc=p.positions.filter(x=>x.marketValueCents===0);
  const n=arr=>new Set(arr.map(key)).size;
  console.log('ativas',ativas.length,'grupos',n(ativas),'| encerradas',enc.length,'grupos',n(enc));
  const g=ativas.filter(x=>key(x)==='cdb-di|júlia');
  console.log('CDB-DI Beto:',g.length,'posicoes, R$',(g.reduce((s,x)=>s+x.marketValueCents,0)/100).toFixed(2));
});"
```

Expected (2026-09-25): `ativas 25 grupos 7 | encerradas 23 grupos 5` e `CDB-DI Beto: 17 posicoes` com o valor somado batendo com a UI no load.

- [ ] **Step 2: Conferir a lista agrupada**

Expected: RF com 7 cartões; `CDB-DI · Beto` com chip `17 posições` e valor somado; `BB LCA POS CDI · Ana` com `3 posições`; 5 cartões de 1 posição idênticos aos de hoje (taxa, meta, `vence …`); encerradas `23 posições encerradas em 5 grupos (R$ <valor>) · resultado realizado +R$ <valor>`.

- [ ] **Step 3: Conferir o modo grupo**

`CDB-DI · Beto` → gaveta com total, lista de 17 posições (vencimento, valor, rendimento %), soma batendo; clicar numa posição → detalhe com `‹ Voltar ao grupo`; `Nova transação` e `Editar cadastro` funcionam e o `‹ Voltar ao grupo` persiste depois de salvar.

- [ ] **Step 4: Conferir encerradas e filtros**

Abrir `CDB Liquidez Diária 106%` (15 posições) na faixa; ordenar por Rendimento (%) e conferir que os **grupos** trocam de posição; filtrar por Investidor `Beto` (deve sobrar o cartão `CDB-DI` e o `Tesouro Selic 2031 - Mozi`); busca por `CDB` reagrupa.

- [ ] **Step 5: Responsividade e screenshots**

Sem overflow em 1280/1024/900; screenshots `.superpowers/sdd/agrup-01-lista.png`, `agrup-02-grupo.png`.

- [ ] **Step 6: Verificação da branch e merge**

```bash
npm test && npm run typecheck && npm run build:web
```

Expected: 204 verdes, typecheck limpo, build ok. Depois: merge local na `main`, `docker compose up -d --build` + `curl localhost:3000/api/health` (healthy; reconciliação `<valor>`/`0`), atualização do `ROADMAP.md` e remoção do worktree/branch.

---

## Verificação final da branch

```bash
npm test && npm run typecheck && npm run build:web
```

Expected: 204 testes verdes (backend intocado), typecheck limpo, build ok.
