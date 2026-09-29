# Agrupamento por nome com investidor no detalhamento — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o cartão de Posições passa a somar todas as posições do mesmo nome (sem separar por investidor) e a gaveta em modo grupo ganha seções por investidor com subtotal — 10 grupos ativos viram 6; nenhum número do aceite muda.

**Architecture:** só web. `web/src/posicoes.ts` muda a chave para nome normalizado, troca `investidor` por `investidores: string[]`, extrai a soma compartilhada (`somarMembros`) e ganha `secoesPorInvestidor` + `vencimentoComum`; `CartaoAtivo` mostra todos os nomes (com `ocultarInvestidor`) e badge de vencimento por data única; `PainelGrupo` renderiza seções quando há mais de um investidor; `PositionsView` passa o filtro adiante. Spec: `docs/superpowers/specs/2026-09-29-agrupamento-por-nome-investidor-no-detalhe-design.md` (revê a chave da spec de 2026-09-25).

**Tech Stack:** React 19 + TypeScript, Vite 8, CSS puro em `web/src/styles.css`, `@phosphor-icons/react`, `<dialog>` nativo.

## Global Constraints

- Zero `float` em dado persistido/cálculo: somas em centavos inteiros; `Number` só na borda de apresentação (percentuais).
- Artefatos e commits em pt-BR; commits convencionais sem acento.
- Web sem runner de testes (padrão do projeto; nenhum teste novo de web): a verificação automatizada é `npm run typecheck`, `npm run build:web` e `npm test` (**232 verdes** — backend intocado); o funcional é conferido no browser com dados reais.
- Cada task: ≤ 400 linhas de diff e ≤ 10 arquivos.
- `package-lock.json` não muda (sem dependência nova).
- Só tokens existentes de `web/src/styles.css` (papel quente, S7); sem tema escuro.
- Chave do grupo: `nome.trim().toLowerCase()` — **sem** investidor; nada de API/backend/migrations.
- Investidor normalizado (`investidorDe`): `null`/vazio/whitespace → `"sem investidor"`; `Ambos` é nome comum.
- Card: meta com todos os nomes (`Ana, Beto`) e **sem nomes** quando o filtro Investidor ≠ `"todos"`.
- Gaveta: >1 investidor → seções ordenadas por valor ↓ (nome como desempate), com subtotal por seção; 1 investidor → render atual sem cabeçalho de seção.
- Badge de vencimento: "vence X" quando todos os membros com data compartilham a mesma; `vencido em X · resgate pendente` idem; sem data única, sem data no badge.
- Texto de UI em pt-BR com plural correto ("1 posição"/"17 posições", "1 corretora"/"N corretoras").

---

### Task 1: Chave por nome + investidores + seções e ajustes de UI

**Files:**
- Modify: `web/src/posicoes.ts` (a partir de `export type GrupoPosicoes` até o fim)
- Modify: `web/src/components/CartaoAtivo.tsx` (arquivo inteiro)
- Modify: `web/src/components/PainelGrupo.tsx` (arquivo inteiro)
- Modify: `web/src/views/PositionsView.tsx` (dois pontos: ~L299 e ~L325)
- Modify: `web/src/styles.css` (append após `.encerradas-contagem`)

**Interfaces:**
- Consumes: `PortfolioPosition` de `web/src/api.ts`; `formataBRL`, `formataBRLSinal`, `formataCategoria`, `formataData`, `formataPercentualSinal`, `formataQuantidade` de `web/src/format.ts`; `COR_DA_CLASSE`, `ROTULO_CLASSE`, `classeDe` de `web/src/classes.ts`; `taxaTexto` de `PainelAtivo.tsx`.
- Produces: `investidorDe(posicao): string`; `vencimentoComum(membros): string | null`; `secoesPorInvestidor(membros): SecaoInvestidor[]`; tipo `SecaoInvestidor` (`investidor`, `membros`, `valorCents`, `semValor`, `capitalCents`, `resultadoRealizadoCents`, `rendimentoCents`, `rendimentoPct`); `GrupoPosicoes` com `investidores: string[]` (sem o campo `investidor`); `chaveDoGrupo(posicao: Pick<PortfolioPosition, "name">)`; `CartaoAtivo({ grupo, totalCents, ocultarInvestidor?, onAbrir })`.

- [ ] **Step 1: Atualizar `web/src/posicoes.ts`**

Manter as linhas 1–25 (imports, `capitalDe`, `rendimentoDe`, `resultadoRealizadoDe`, `participacaoPct`) e **substituir todo o restante do arquivo** (a partir de `export type GrupoPosicoes = {`) por:

```ts
/** Investidor normalizado; nulo ou vazio vira "sem investidor". */
export function investidorDe(posicao: Pick<PortfolioPosition, "investor">): string {
  const valor = (posicao.investor ?? "").trim();
  return valor === "" ? "sem investidor" : valor;
}

export type GrupoPosicoes = {
  chave: string;
  nome: string;
  investidores: string[];
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

/** Chave de agrupamento: nome normalizado (investidor fica no detalhamento). */
export function chaveDoGrupo(posicao: Pick<PortfolioPosition, "name">): string {
  return posicao.name.trim().toLowerCase();
}

/** Ordena por vencimento, do mais recente para o mais antigo (sem vencimento ao final). */
function porVencimentoDesc(a: PortfolioPosition, b: PortfolioPosition): number {
  if (a.maturityDate === b.maturityDate) return 0;
  if (a.maturityDate === null) return 1;
  if (b.maturityDate === null) return -1;
  return a.maturityDate < b.maturityDate ? 1 : -1;
}

/** Agrupa posições por nome; membros pelo vencimento mais recente primeiro. */
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

/** Data de vencimento comum a todos os membros com data; null se não houver ou se houver mais de uma. */
export function vencimentoComum(membros: PortfolioPosition[]): string | null {
  const datas = [...new Set(membros.map((membro) => membro.maturityDate).filter((data): data is string => data !== null))];
  return datas.length === 1 ? datas[0] : null;
}

type SomatorioMembros = {
  valorCents: number;
  semValor: boolean;
  capitalCents: number;
  resultadoRealizadoCents: number;
  rendimentoCents: number | null;
  rendimentoPct: number | null;
};

function somarMembros(membros: PortfolioPosition[]): SomatorioMembros {
  const semValor = membros.every((posicao) => posicao.marketValueCents === null);
  const valorCents = membros.reduce((soma, posicao) => soma + (posicao.marketValueCents ?? 0), 0);
  const capitalCents = membros.reduce((soma, posicao) => soma + capitalDe(posicao), 0);
  const resultadoRealizadoCents = membros.reduce((soma, posicao) => soma + resultadoRealizadoDe(posicao), 0);
  const rendimentoCents = semValor
    ? null
    : membros.reduce((soma, posicao) => soma + (rendimentoDe(posicao).cents ?? 0), 0);
  const rendimentoPct = rendimentoCents === null || capitalCents <= 0 ? null : (rendimentoCents / capitalCents) * 100;
  return { valorCents, semValor, capitalCents, resultadoRealizadoCents, rendimentoCents, rendimentoPct };
}

const distintos = (valores: Array<string | null>): string[] =>
  [...new Set(valores.filter((valor): valor is string => valor !== null && valor !== ""))].sort();

function agregarGrupo(chave: string, membros: PortfolioPosition[]): GrupoPosicoes {
  const ordenados = [...membros].sort(porVencimentoDesc);
  return {
    chave,
    nome: ordenados[0].name,
    investidores: distintos(ordenados.map(investidorDe)),
    membros: ordenados,
    ...somarMembros(ordenados),
    stale: ordenados.some((posicao) => posicao.stale),
    pendente: ordenados.some((posicao) => posicao.pendingRedemption),
    brokers: distintos(ordenados.map((posicao) => posicao.broker)),
    objetivos: distintos(ordenados.map((posicao) => posicao.objective)),
  };
}

export type SecaoInvestidor = SomatorioMembros & {
  investidor: string;
  membros: PortfolioPosition[];
};

/** Seções por investidor (valor ↓, nome como desempate); nulos/vazios em "sem investidor". */
export function secoesPorInvestidor(membros: PortfolioPosition[]): SecaoInvestidor[] {
  const mapa = new Map<string, PortfolioPosition[]>();
  for (const posicao of membros) {
    const investidor = investidorDe(posicao);
    const daSecao = mapa.get(investidor);
    if (daSecao === undefined) mapa.set(investidor, [posicao]);
    else daSecao.push(posicao);
  }
  return [...mapa.entries()]
    .map(([investidor, doInvestidor]) => ({
      investidor,
      membros: [...doInvestidor].sort(porVencimentoDesc),
      ...somarMembros(doInvestidor),
    }))
    .sort((a, b) => b.valorCents - a.valorCents || a.investidor.localeCompare(b.investidor, "pt-BR"));
}
```

- [ ] **Step 2: Reescrever `web/src/components/CartaoAtivo.tsx`**

```tsx
import { formataBRL, formataBRLSinal, formataCategoria, formataData, formataPercentualSinal, formataQuantidade } from "../format.ts";
import { COR_DA_CLASSE, classeDe } from "../classes.ts";
import { participacaoPct, vencimentoComum, type GrupoPosicoes } from "../posicoes.ts";
import { taxaTexto } from "./PainelAtivo.tsx";

export function CartaoAtivo({ grupo, totalCents, ocultarInvestidor = false, onAbrir }: {
  grupo: GrupoPosicoes;
  totalCents: number;
  ocultarInvestidor?: boolean;
  onAbrir: (grupo: GrupoPosicoes) => void;
}) {
  const posicao = grupo.membros[0];
  const cor = COR_DA_CLASSE[classeDe(posicao)];
  const umSo = grupo.membros.length === 1;
  const taxa = taxaTexto(posicao.rateE6, posicao.benchmark);
  const vencimento = vencimentoComum(grupo.membros);
  const participacao = participacaoPct(grupo.semValor ? null : grupo.valorCents, totalCents);

  const chip = umSo
    ? posicao.kind === "pension" ? "PGBL · IPCA"
      : posicao.category === "etf_fixed" ? "ETF RF"
        : posicao.category === "etf_equity" ? "ETF RV"
          : taxa ?? formataCategoria(posicao.category)
    : formataCategoria(posicao.category);

  const meta: string[] = [];
  if (umSo && posicao.kind !== "fixed_income") {
    if (posicao.quantityE8 !== null) meta.push(`${formataQuantidade(posicao.quantityE8)} cotas`);
    if (posicao.priceCents !== null) meta.push(formataBRL(posicao.priceCents));
  }
  if (grupo.brokers.length === 1) meta.push(grupo.brokers[0]);
  else if (grupo.brokers.length > 1) meta.push(`${grupo.brokers.length} corretoras`);
  if (!ocultarInvestidor) meta.push(grupo.investidores.join(", "));
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
            {vencimento === null ? "vencido · resgate pendente" : `vencido em ${formataData(vencimento)} · resgate pendente`}
          </span>
        )}
        {!grupo.pendente && vencimento !== null && (
          <span className="badge badge-neutro">vence {formataData(vencimento)}</span>
        )}
      </span>
    </button>
  );
}
```

- [ ] **Step 3: Reescrever `web/src/components/PainelGrupo.tsx`**

```tsx
import type { PortfolioPosition } from "../api.ts";
import { formataBRL, formataBRLSinal, formataCategoria, formataData, formataPercentualSinal } from "../format.ts";
import { COR_DA_CLASSE, ROTULO_CLASSE, classeDe } from "../classes.ts";
import { participacaoPct, rendimentoDe, resultadoRealizadoDe, secoesPorInvestidor, type GrupoPosicoes, type SecaoInvestidor } from "../posicoes.ts";

function ListaDeMembros({ membros, onAbrirMembro }: {
  membros: PortfolioPosition[];
  onAbrirMembro: (posicao: PortfolioPosition) => void;
}) {
  return (
    <ul className="membros">
      {membros.map((membro) => {
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
  );
}

function SubtotalDaSecao({ secao }: { secao: SecaoInvestidor }) {
  if (secao.semValor) return <span className="secao-subtotal">—</span>;
  const encerrada = secao.membros.every((membro) => membro.marketValueCents === 0);
  if (encerrada) {
    return (
      <span className="secao-subtotal">
        R$ <valor> · resultado realizado{" "}
        <strong className={secao.resultadoRealizadoCents >= 0 ? "rendimento-positivo" : "rendimento-negativo"}>{formataBRLSinal(secao.resultadoRealizadoCents)}</strong>
      </span>
    );
  }
  if (secao.rendimentoCents === null) {
    return <span className="secao-subtotal">{formataBRL(secao.valorCents)} · sem cotação</span>;
  }
  return (
    <span className="secao-subtotal">
      {formataBRL(secao.valorCents)} ·{" "}
      <strong className={secao.rendimentoCents >= 0 ? "rendimento-positivo" : "rendimento-negativo"}>
        {formataBRLSinal(secao.rendimentoCents)}
        {secao.rendimentoPct === null ? "" : ` (${formataPercentualSinal(secao.rendimentoPct)})`}
      </strong>
    </span>
  );
}

export function PainelGrupo({ grupo, totalCents, onAbrirMembro }: {
  grupo: GrupoPosicoes;
  totalCents: number;
  onAbrirMembro: (posicao: PortfolioPosition) => void;
}) {
  const posicao = grupo.membros[0];
  const cor = COR_DA_CLASSE[classeDe(posicao)];
  const encerrado = grupo.membros.every((membro) => membro.marketValueCents === 0);
  const participacao = participacaoPct(grupo.semValor ? null : grupo.valorCents, totalCents);
  const secoes = grupo.investidores.length > 1 ? secoesPorInvestidor(grupo.membros) : null;
  const meta: string[] = [];
  if (grupo.brokers.length === 1) meta.push(grupo.brokers[0]);
  else if (grupo.brokers.length > 1) meta.push(`${grupo.brokers.length} corretoras`);
  if (secoes === null) meta.push(grupo.investidores[0]);
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
        <p className="painel-sem-cotacao">
          {grupo.membros.length === 1 ? "posição encerrada" : "posições encerradas"} (R$ <valor>): resultado realizado {formataBRLSinal(grupo.resultadoRealizadoCents)}
        </p>
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
      {secoes === null ? (
        <>
          <h3 className="section-title membros-titulo">Posições</h3>
          <ListaDeMembros membros={grupo.membros} onAbrirMembro={onAbrirMembro} />
        </>
      ) : (
        secoes.map((secao) => (
          <section key={secao.investidor} className="secao-investidor">
            <div className="secao-cabecalho">
              <h3 className="section-title membros-titulo">{secao.investidor}</h3>
              <SubtotalDaSecao secao={secao} />
            </div>
            <ListaDeMembros membros={secao.membros} onAbrirMembro={onAbrirMembro} />
          </section>
        ))
      )}
      <p className="section-hint">Clique numa posição para ver detalhes, transações e cadastro.</p>
    </div>
  );
}
```

- [ ] **Step 4: Ajustar `web/src/views/PositionsView.tsx` (dois pontos)**

4a. No `grade-cartoes` (~L297-301), passar o filtro:

```tsx
                <div className="grade-cartoes">
                  {doGrupo.map((grupo) => (
                    <CartaoAtivo key={grupo.chave} grupo={grupo} totalCents={total} ocultarInvestidor={investidor !== "todos"} onAbrir={abrirGrupo} />
                  ))}
                </div>
```

4b. Na linha do `encerrada-meta` (~L325), trocar `grupo.investidor`:

```tsx
                      <span className="encerrada-meta">
                        {[grupo.brokers[0], grupo.investidores.join(", ")].filter((valorMeta): valorMeta is string => valorMeta !== undefined && valorMeta !== null && valorMeta !== "").join(" · ")}
                      </span>
```

- [ ] **Step 5: CSS em `web/src/styles.css` (após `.encerradas-contagem`, ~L1352)**

```css
.secao-investidor { margin-top: 18px; }
.secao-cabecalho { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.secao-cabecalho .membros-titulo { margin-top: 0; }
.secao-subtotal { font-size: 12px; color: var(--text-2); font-variant-numeric: tabular-nums; text-align: right; }
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: sem erros (qualquer referência restante a `grupo.investidor` apareceria aqui).

- [ ] **Step 7: Build e testes**

Run: `npm run build:web && npm test`
Expected: build ok (warning de chunk conhecido) e `# pass 232`.

- [ ] **Step 8: Commit**

```bash
git add web/src/posicoes.ts web/src/components/CartaoAtivo.tsx web/src/components/PainelGrupo.tsx web/src/views/PositionsView.tsx web/src/styles.css
git commit -m "feat: posicoes agrupam por nome com investidor no detalhamento"
```

---

### Task 2: Aceite no browser com dados reais + verificação final

**Files:**
- Nenhum arquivo de código; screenshots em `.superpowers/sdd/`; `ROADMAP.md` ao final

- [ ] **Step 1: Conferir a API real (agrupamento por nome)**

Com o servidor local no ar (`curl -s localhost:3000/api/health`):

```bash
curl -s localhost:3000/api/portfolio | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  const p=JSON.parse(d);
  const key=x=>x.name.trim().toLowerCase();
  const ativas=p.positions.filter(x=>x.marketValueCents!==0);
  const enc=p.positions.filter(x=>x.marketValueCents===0);
  console.log('posicoes',p.positions.length,'| ativas',ativas.length,'grupos',new Set(ativas.map(key)).size,'| encerradas',enc.length,'grupos',new Set(enc.map(key)).size);
  const selic=ativas.filter(x=>key(x)==='tesouro selic 2031');
  console.log('Tesouro Selic 2031:',selic.length,'posicoes, R$',(selic.reduce((s,x)=>s+x.marketValueCents,0)/100).toFixed(2));
  const porInv=k=>selic.filter(x=>(x.investor??'')===k).reduce((s,x)=>s+x.marketValueCents,0)/100;
  console.log('  Ana R$',porInv('Ana').toFixed(2),'| Beto R$',porInv('Beto').toFixed(2));
});"
```

Expected (2026-09-29; valores oscilam intraday, o critério é bater com a UI no load): `posicoes 51 | ativas 28 grupos 6 | encerradas 23 grupos 5` (antes: 10 grupos ativos) e `Tesouro Selic 2031: 2 posicoes` somando `R$ <valor>` (Ana `R$ <valor>` + Beto `R$ <valor>` no momento da conferência).

- [ ] **Step 2: Conferir os cartões mesclados**

Run: `npm run dev:web -- --port 5179` em background; abrir `http://localhost:5179`, aba Posições.
Expected: **6 cartões ativos** — RF 4 (`BB LCA POS CDI` com `3 posições`; `CDB-DI` com `17 posições`; `It Now Ima-B5 P2…` com `2 posições` — `etf_fixed` conta como RF; `Tesouro Selic 2031` com valor somado e badge `vence 01/03/2031`), RV 1 (`Investo FTSE Global Equities` com meta `Ana, Beto` e **sem** badge) e Previdência 1 (`BTG PACTUAL IPCA CURTA PREV…`); os 4 nomes antes duplicados aparecem uma única vez; cabeçalho segue `51 de 51 ativos` com o mesmo valor total do `/api/portfolio`.

- [ ] **Step 3: Conferir as seções na gaveta**

`Tesouro Selic 2031` → gaveta com total do grupo e duas seções: `Ana` (valor maior primeiro) e `Beto`, cada uma com subtotal `R$ … · ▲/▼ R$ … (%)`; `subtotal(Ana) + subtotal(Beto) = valor do cartão`; % da seção = Σ rendimento ÷ Σ capital da seção; clicar numa posição abre o detalhe com `‹ Voltar ao grupo`; `Nova transação` e `Editar cadastro` seguem funcionando e o botão de voltar persiste (como `CDB-DI`, que tem 1 investidor e mantém a lista atual sem cabeçalho).

- [ ] **Step 4: Conferir filtro e badges**

Filtro Investidor `Beto`: **5 cartões** (RF: B5P211, CDB-DI, Tesouro Selic 2031; RV: WRLD11; Previdência: BTG), meta **sem nomes** em todos; o cartão do `Tesouro Selic 2031` (1 membro sob o filtro) abre o detalhe do instrumento direto, como qualquer grupo de 1 posição — sem cabeçalho de seção. Badges: `Tesouro Selic 2031` com `vence 01/03/2031`; `CDB-DI`, `BB LCA` (3 vencimentos), B5P211 e WRLD11 sem badge (data nula); encerradas seguem `23 posições encerradas em 5 grupos (R$ <valor>) · resultado realizado +R$ <valor>`.

- [ ] **Step 5: Responsividade e screenshots**

Sem overflow em 1280/1024/900 (`scrollWidth === innerWidth`); screenshots `.superpowers/sdd/nome-01-lista.png` (lista com os 6 cartões) e `nome-02-secoes.png` (gaveta do Tesouro Selic com as seções).

- [ ] **Step 6: Verificação final da branch**

```bash
npm test && npm run typecheck && npm run build:web
```

Expected: **232 testes verdes** (backend intocado), typecheck limpo, build ok. Depois: `docker compose up -d --build` + `curl localhost:3000/api/health` (healthy; reconciliação `<valor>`/`0`).

- [ ] **Step 7: Merge, deploy no homelab e ROADMAP**

1. Merge local na `main` (ff) e `git push origin main`.
2. No homelab: `ssh <valor>.<valor>` → `cd ~/homelab/investment-tracker && git pull --ff-only && docker compose up -d --build`; conferir `curl localhost:3000/api/health` e a reconciliação.
3. Atualizar `ROADMAP.md`: nova linha na tabela/evidências — 10 → 6 grupos ativos, seções por investidor na gaveta, 232 testes, typecheck/build verdes, screenshots, commit do merge.
4. Remover o worktree/branch da feature, se houver.

---

## Verificação final da branch

```bash
npm test && npm run typecheck && npm run build:web
```

Expected: 232 testes verdes (backend intocado), typecheck limpo, build ok.
