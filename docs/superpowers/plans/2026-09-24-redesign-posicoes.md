# Redesign visual da tela de Posições — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** trocar a tabela de Posições por cartões agrupados por classe (encerradas numa faixa), substituir o painel quebrado por uma gaveta lateral e mover transação e cadastro para dentro dela, com campos e formulários de verdade.

**Architecture:** só web. A lista passa a compor grupos (`ORDEM_CLASSE`) de cartões (`CartaoAtivo`) e a gaveta (`Gaveta`, `<dialog>` nativo) hospeda três modos: detalhe (`PainelAtivo`), transação (`FormTransacao`) e cadastro (`FormAtivo`). Cálculos compartilhados vão para `web/src/posicoes.ts`; cores de classe para `classes.ts`. Nenhuma mudança de API/banco. Spec: `docs/superpowers/specs/2026-09-24-redesign-posicoes-design.md`; mockups aprovados em `.superpowers/brainstorm/<valor>-<valor>/content/`.

**Tech Stack:** React 19 + TypeScript, Vite 8, CSS puro em `web/src/styles.css`, `@phosphor-icons/react`, `<dialog>` nativo.

## Global Constraints

- Zero `float` em dado persistido/cálculo: somas em centavos inteiros; `Number` só na borda de apresentação (percentuais).
- Artefatos e commits em pt-BR; commits convencionais sem acento (`feat:`, `docs:`, `fix:`).
- Web não tem runner de testes: nenhum teste automatizado novo — verificação por `npm run typecheck`, `npm run build:web`, `npm test` (204 verdes, backend intocado) e browser com dados reais.
- Cada task: ≤ 400 linhas de diff e ≤ 10 arquivos.
- `package-lock.json` não muda nesta branch (sem dependência nova).
- Texto de UI em pt-BR com plural correto ("1 ativo" / "23 ativos").
- Só os tokens de `web/src/styles.css` (paleta Papel quente, S7); sem tema escuro.
- `web/src/components/Modal.tsx` **não é removido** (Visão geral usa); Posições deixa de usá-lo.
- Sinal das transações: `grossCents` e `feesCents` são sempre ≥ 0; `quantityE8` é negativo em `SELL` — exibição usa `Math.abs`.

---

### Task 1: Fundação visual — cores de classe, campos globais e segmented

**Files:**
- Modify: `web/src/classes.ts`
- Create: `web/src/components/Segmented.tsx`
- Modify: `web/src/styles.css` (bloco de campos ~linhas 717-719; bloco `.segmented` novo)

**Interfaces:**
- Consumes: `Classe` de `web/src/classes.ts`.
- Produces: `COR_DA_CLASSE: Record<Classe, string>`; componente `Segmented` (`valor`, `opcoes`, `onMudar`, `desabilitado?`, `rotulo`); classes CSS `.segmented`, `.segmented-item`, `.segmented-item.ativo`; campos globais estilizados (`input:not([type="checkbox"])`, `select`, `textarea`).

- [ ] **Step 1: Adicionar `COR_DA_CLASSE` em `classes.ts`**

No fim de `web/src/classes.ts`:

```ts
/** Cor de cada classe econômica (cartões, cabeçalhos de grupo e gaveta). */
export const COR_DA_CLASSE: Record<Classe, string> = {
  rf: "#3F6B52",
  rv: "#47657F",
  pension: "#9A6A2A",
};
```

- [ ] **Step 2: Criar `web/src/components/Segmented.tsx`**

```tsx
export function Segmented<T extends string>({ valor, opcoes, onMudar, desabilitado = false, rotulo }: {
  valor: T;
  opcoes: Array<{ valor: T; rotulo: string }>;
  onMudar: (valor: T) => void;
  desabilitado?: boolean;
  rotulo: string;
}) {
  return (
    <span className="segmented" role="group" aria-label={rotulo}>
      {opcoes.map((opcao) => (
        <button
          key={opcao.valor}
          type="button"
          className={opcao.valor === valor ? "segmented-item ativo" : "segmented-item"}
          aria-pressed={opcao.valor === valor}
          disabled={desabilitado}
          onClick={() => onMudar(opcao.valor)}
        >
          {opcao.rotulo}
        </button>
      ))}
    </span>
  );
}
```

- [ ] **Step 3: Estilizar os campos globalmente em `styles.css`**

Substituir o bloco atual (linhas ~717-719):

```css
.campo { display: flex; flex-direction: column; gap: 4px; min-width: 150px; }
.campo-com-icone { display: flex; align-items: center; gap: 6px; border: 1px solid var(--border); border-radius: var(--radius-control); padding: 6px 8px; background: var(--surface); }
.campo-com-icone input, .campo select { border: none; background: transparent; font: inherit; color: var(--text); }
```

por:

```css
input:not([type="checkbox"]),
select,
textarea {
  font: inherit;
  font-size: 13px;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-control);
  padding: 8px 11px;
  transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease), background-color var(--dur) var(--ease);
}

input:not([type="checkbox"]):hover:not(:disabled),
select:hover:not(:disabled),
textarea:hover:not(:disabled) {
  border-color: var(--text-3);
}

input:not([type="checkbox"]):focus,
select:focus,
textarea:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: var(--ring);
}

input:not([type="checkbox"]):disabled,
select:disabled,
textarea:disabled {
  background: var(--surface-2);
  color: var(--text-3);
  cursor: not-allowed;
}

input::placeholder,
textarea::placeholder {
  color: var(--text-3);
}

select {
  appearance: none;
  padding-right: 30px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 4.5 6 8l3.5-3.5' fill='none' stroke='%238C8272' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
}

.campo { display: flex; flex-direction: column; gap: 5px; min-width: 150px; }
.campo-com-icone { display: flex; align-items: center; gap: 6px; border: 1px solid var(--border-strong); border-radius: var(--radius-control); padding: 8px 10px; background: var(--surface); color: var(--text-3); transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease); }
.campo-com-icone:hover { border-color: var(--text-3); }
.campo-com-icone:focus-within { border-color: var(--accent); box-shadow: var(--ring); }
.campo-com-icone input { border: none; background: transparent; padding: 0; }
.campo-com-icone input:hover, .campo-com-icone input:focus { border: none; box-shadow: none; }

.segmented { display: inline-flex; gap: 2px; padding: 3px; background: var(--surface-2); border-radius: var(--radius-pill); }
.segmented-item { border: 0; border-radius: var(--radius-pill); padding: 6px 14px; background: transparent; color: var(--text-2); font: inherit; font-size: 13px; cursor: pointer; transition: background-color var(--dur) var(--ease), color var(--dur) var(--ease), box-shadow var(--dur) var(--ease); }
.segmented-item:hover:not(:disabled):not(.ativo) { color: var(--text); }
.segmented-item.ativo { background: var(--surface); color: var(--text); font-weight: 600; box-shadow: 0 1px 2px rgb(46 42 36 / 8%); }
.segmented-item:focus-visible { outline: none; box-shadow: var(--ring); }
.segmented-item:disabled { color: var(--text-3); cursor: not-allowed; }
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: sem erros (o `Segmented` ainda não é usado; só precisa compilar).

- [ ] **Step 5: Build do web**

Run: `npm run build:web`
Expected: build ok (warning de chunk > 500 kB é conhecido e aceitável).

- [ ] **Step 6: Testes do backend inalterados**

Run: `npm test`
Expected: `# pass 204` / `# fail 0`.

- [ ] **Step 7: Commit**

```bash
git add web/src/classes.ts web/src/components/Segmented.tsx web/src/styles.css
git commit -m "feat: campos, segmented e cores de classe na fundacao visual"
```

---

### Task 2: Gaveta + PainelAtivo substituindo a coluna fixa

**Files:**
- Create: `web/src/posicoes.ts`
- Create: `web/src/components/Gaveta.tsx`
- Create: `web/src/components/PainelAtivo.tsx`
- Modify: `web/src/views/PositionsView.tsx` (imports ~1-7; estado ~28-40; função `abrirAtivo` ~87-89; bloco `<aside>` ~251-306)
- Modify: `web/src/styles.css` (bloco novo ao fim; a regra `.painel-ativo` ~712-715 sai)

**Interfaces:**
- Consumes: `PortfolioPosition`, `Transaction` de `web/src/api.ts`; `formataBRL`, `formataCategoria`, `formataData`, `formataPercentualSinal`, `formataQuantidade` de `web/src/format.ts`; `COR_DA_CLASSE`, `ROTULO_CLASSE`, `classeDe` de `web/src/classes.ts`.
- Produces: `capitalDe`, `rendimentoDe`, `resultadoRealizadoDe`, `participacaoPct` (todas de `web/src/posicoes.ts`); `Gaveta({ aberta, titulo, onFechar, children })`; `PainelAtivo({ posicao, totalCents, transacoes, onNovaTransacao, onEditarTransacao, onEditarCadastro })`; `taxaTexto(rateE6, benchmark)` exportada de `PainelAtivo.tsx`; CSS `.gaveta`, `.gaveta-caixa`…, `.painel-*`, `.grade-dados`, `.dado*`, `.transacoes`, `.transacao*`, `.cartao-barra`, `.chip-classe`.

- [ ] **Step 1: Criar `web/src/posicoes.ts`**

```ts
import type { PortfolioPosition } from "./api.ts";

/** Capital aportado (compras − resgates) em centavos. */
export function capitalDe(posicao: Pick<PortfolioPosition, "investedCents" | "redeemedCents">): number {
  return posicao.investedCents - posicao.redeemedCents;
}

/** Rendimento da posição: valor de mercado − capital; null quando não há cotação ou capital ≤ 0. */
export function rendimentoDe(posicao: PortfolioPosition): { cents: number | null; pct: number | null } {
  if (posicao.marketValueCents === null) return { cents: null, pct: null };
  const capital = capitalDe(posicao);
  const cents = posicao.marketValueCents - capital;
  return { cents, pct: capital > 0 ? (cents / capital) * 100 : null };
}

/** Resultado realizado de posição encerrada: resgates − aportes (pode ser negativo). */
export function resultadoRealizadoDe(posicao: Pick<PortfolioPosition, "investedCents" | "redeemedCents">): number {
  return posicao.redeemedCents - posicao.investedCents;
}

/** Participação no total em %; null sem valor de mercado ou sem total. */
export function participacaoPct(valorCents: number | null, totalCents: number): number | null {
  if (valorCents === null || totalCents <= 0) return null;
  return (valorCents / totalCents) * 100;
}
```

- [ ] **Step 2: Criar `web/src/components/Gaveta.tsx`**

```tsx
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "@phosphor-icons/react";

export function Gaveta({ aberta, titulo, onFechar, children }: {
  aberta: boolean; titulo: string; onFechar: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (aberta && !dialog.open) dialog.showModal();
    if (!aberta && dialog.open) dialog.close();
  }, [aberta]);

  return (
    <dialog
      ref={ref}
      className="gaveta"
      aria-label={titulo}
      onClose={onFechar}
      onClick={(evento) => { if (evento.target === ref.current) onFechar(); }}
    >
      <div className="gaveta-caixa">
        <button type="button" className="gaveta-fechar" onClick={onFechar}>
          <X size={16} aria-hidden="true" /> Fechar
        </button>
        {children}
      </div>
    </dialog>
  );
}
```

- [ ] **Step 3: Criar `web/src/components/PainelAtivo.tsx`**

```tsx
import { PencilSimple, Plus } from "@phosphor-icons/react";
import type { PortfolioPosition, Transaction } from "../api.ts";
import { formataBRL, formataCategoria, formataData, formataPercentualSinal, formataQuantidade } from "../format.ts";
import { COR_DA_CLASSE, ROTULO_CLASSE, classeDe } from "../classes.ts";
import { capitalDe, participacaoPct, rendimentoDe } from "../posicoes.ts";

const ROTULO_OPERACAO: Record<string, string> = {
  BUY: "Compra", SELL: "Resgate", AMORTIZATION: "Amortização", INTEREST: "Juros", DIVIDEND: "Dividendo",
};

/** "96% CDI" | "100,0996% SELIC"; null quando não há taxa. */
export function taxaTexto(rateE6: number | null, benchmark: string | null): string | null {
  if (rateE6 === null) return null;
  const pct = (rateE6 / 10_000).toLocaleString("pt-BR", { maximumFractionDigits: 4 });
  return benchmark === null ? `${pct}%` : `${pct}% ${benchmark}`;
}

function precoDaTransacao(transacao: Transaction): string {
  const quantidade = Math.abs(transacao.quantityE8 ?? 0);
  if (quantidade === 0) return "—";
  return formataBRL(Math.round(transacao.grossCents / (quantidade / 1e8)));
}

function detalheDaTransacao(transacao: Transaction): string {
  const partes: string[] = [];
  if (transacao.quantityE8 !== null) {
    partes.push(`${formataQuantidade(Math.abs(transacao.quantityE8))} × ${precoDaTransacao(transacao)}`);
  }
  if (transacao.feesCents > 0) partes.push(`taxas ${formataBRL(transacao.feesCents)}`);
  if (transacao.note !== null && transacao.note !== "") partes.push(transacao.note);
  return partes.length === 0 ? "sem taxas" : partes.join(" · ");
}

export function PainelAtivo({ posicao, totalCents, transacoes, onNovaTransacao, onEditarTransacao, onEditarCadastro }: {
  posicao: PortfolioPosition;
  totalCents: number;
  transacoes: Transaction[] | null;
  onNovaTransacao: () => void;
  onEditarTransacao: (transacao: Transaction) => void;
  onEditarCadastro: () => void;
}) {
  const rendimento = rendimentoDe(posicao);
  const capital = capitalDe(posicao);
  const pct = participacaoPct(posicao.marketValueCents, totalCents);
  const cor = COR_DA_CLASSE[classeDe(posicao)];
  const taxa = taxaTexto(posicao.rateE6, posicao.benchmark);
  const aportes = (transacoes ?? []).filter((transacao) => transacao.kind === "BUY").reduce((soma, transacao) => soma + transacao.grossCents, 0);
  const resgates = (transacoes ?? []).filter((transacao) => transacao.kind === "SELL").reduce((soma, transacao) => soma + transacao.grossCents, 0);
  const grade: Array<{ rotulo: string; valor: string }> = posicao.kind === "fixed_income"
    ? [
        { rotulo: "Taxa", valor: taxa ?? formataCategoria(posicao.category) },
        { rotulo: "Vencimento", valor: posicao.maturityDate === null ? "—" : formataData(posicao.maturityDate) },
        { rotulo: "Índice em", valor: posicao.priceDate === null ? "—" : formataData(posicao.priceDate) },
        { rotulo: "Capital", valor: formataBRL(capital) },
      ]
    : [
        { rotulo: "Cotas", valor: posicao.quantityE8 === null ? "—" : formataQuantidade(posicao.quantityE8) },
        { rotulo: posicao.kind === "pension" ? "Cota" : "Preço", valor: posicao.priceCents === null ? "—" : formataBRL(posicao.priceCents) },
        { rotulo: posicao.kind === "pension" ? "Cota em" : "Preço em", valor: posicao.priceDate === null ? "—" : formataData(posicao.priceDate) },
        { rotulo: "Capital", valor: formataBRL(capital) },
      ];

  return (
    <div className="painel-conteudo">
      <div className="gaveta-cabecalho">
        <span className="painel-ponto" style={{ background: cor }} aria-hidden="true" />
        <h2 className="gaveta-titulo">{posicao.name}</h2>
      </div>
      <p className="tags">
        <span className="chip chip-classe" style={{ color: cor, borderColor: cor }}>{ROTULO_CLASSE[classeDe(posicao)]}</span>
        <span className="chip">{formataCategoria(posicao.category)}</span>
        {posicao.broker !== null && posicao.broker !== "" && <span className="chip">{posicao.broker}</span>}
        <span className="chip">{posicao.investor ?? "sem investidor"}</span>
        {posicao.objective !== null && posicao.objective !== "" && <span className="chip">{posicao.objective}</span>}
      </p>
      <p className="painel-valor">{posicao.marketValueCents === null ? "—" : formataBRL(posicao.marketValueCents)}</p>
      {rendimento.cents === null ? (
        <p className="painel-sem-cotacao">sem cotação registrada</p>
      ) : (
        <p className={rendimento.cents >= 0 ? "painel-rendimento rendimento-positivo" : "painel-rendimento rendimento-negativo"}>
          {rendimento.cents >= 0 ? "▲" : "▼"} {formataBRL(rendimento.cents)}
          {rendimento.pct === null ? "" : ` (${formataPercentualSinal(rendimento.pct)})`}
        </p>
      )}
      {pct !== null && (
        <span className="cartao-barra painel-participacao">
          <span className="cartao-barra-fill" style={{ width: `${Math.min(100, pct)}%`, background: cor }} />
        </span>
      )}
      {pct !== null && <p className="painel-pct">{pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% da carteira</p>}
      <div className="grade-dados">
        {grade.map((item) => (
          <div key={item.rotulo} className="dado">
            <span className="dado-rotulo">{item.rotulo}</span>
            <span className="dado-valor">{item.valor}</span>
          </div>
        ))}
      </div>
      <div className="painel-acoes">
        <button type="button" className="btn btn-secondary" onClick={onEditarCadastro}>
          <PencilSimple size={15} aria-hidden="true" /> Editar cadastro
        </button>
        <button type="button" className="btn btn-primary" onClick={onNovaTransacao}>
          <Plus size={15} aria-hidden="true" /> Nova transação
        </button>
      </div>
      <div className="painel-transacoes-cabecalho">
        <h3 className="section-title">Transações <span className="contagem">{transacoes === null ? "…" : transacoes.length}</span></h3>
        <span className="painel-resumo">Aportes {formataBRL(aportes)} · Resgates {formataBRL(resgates)}</span>
      </div>
      {transacoes === null ? (
        <p className="section-hint">Carregando…</p>
      ) : transacoes.length === 0 ? (
        <p className="section-hint">Sem transações registradas.</p>
      ) : (
        <ul className="transacoes">
          {transacoes.map((transacao) => (
            <li key={transacao.id}>
              <button type="button" className="transacao" onClick={() => onEditarTransacao(transacao)}>
                <span className="transacao-topo">
                  <span className="transacao-data">{formataData(transacao.tradeDate)}</span>
                  <span className={transacao.kind === "SELL" ? "transacao-tipo tipo-resgate" : "transacao-tipo tipo-compra"}>
                    {ROTULO_OPERACAO[transacao.kind] ?? transacao.kind}
                  </span>
                  <span className="transacao-valor">{formataBRL(transacao.grossCents)}</span>
                </span>
                <span className="transacao-detalhe">{detalheDaTransacao(transacao)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="section-hint">Clique numa transação para editar ou excluir.</p>
    </div>
  );
}
```

- [ ] **Step 4: Trocar o `<aside>` por `<Gaveta>` na `PositionsView`**

Em `web/src/views/PositionsView.tsx`:

4a. Imports: trocar a linha 2 para remover `PencilSimple` e `X` (o `Table` fica para o estado vazio; `Plus` fica para "Novo ativo"):

```tsx
import { CaretDown, CaretUp, MagnifyingGlass, Plus, Table } from "@phosphor-icons/react";
```

Acrescentar:

```tsx
import { Gaveta } from "../components/Gaveta.tsx";
import { PainelAtivo } from "../components/PainelAtivo.tsx";
```

e remover a linha `function precoMedio(...) { ... }` e a constante `ROTULO_OPERACAO` (moveram para o `PainelAtivo`).

4b. Estado: manter `selecionada` e adicionar `gavetaAberta` logo depois:

```tsx
  const [selecionada, setSelecionada] = useState<PortfolioPosition | null>(null);
  const [gavetaAberta, setGavetaAberta] = useState(false);
```

4c. `abrirAtivo` e uma função de fechar:

```tsx
  function abrirAtivo(posicao: PortfolioPosition) {
    setSelecionada(posicao);
    setGavetaAberta(true);
  }

  function fecharGaveta() {
    setGavetaAberta(false);
    setSelecionada(null);
  }
```

4d. Substituir todo o bloco `<aside className="painel-ativo" …> … </aside>` (linhas ~251-306) por:

```tsx
      {gavetaAberta && selecionada !== null && (
        <Gaveta aberta titulo={selecionada.name} onFechar={fecharGaveta}>
          <PainelAtivo
            posicao={selecionada}
            totalCents={total}
            transacoes={transacoes}
            onNovaTransacao={() => setFormTransacao({ transacao: null })}
            onEditarTransacao={(transacao) => setFormTransacao({ transacao })}
            onEditarCadastro={() => void editarAtivo()}
          />
        </Gaveta>
      )}
```

(As modais de transação/cadastro seguem como estão nesta task; a Task 3 as move para dentro da gaveta.)

- [ ] **Step 5: Adicionar o CSS da gaveta e do painel em `styles.css`**

Remover a regra `.painel-ativo { … }` (linhas ~712-715) e acrescentar ao fim do arquivo:

```css
.gaveta {
  position: fixed;
  inset: 0 0 0 auto;
  width: min(440px, 100vw);
  max-width: none;
  height: 100dvh;
  max-height: none;
  margin: 0;
  padding: 0;
  border: 0;
  border-left: 1px solid var(--border-strong);
  background: var(--surface);
  box-shadow: -12px 0 32px rgb(46 42 36 / 18%);
  overflow-y: auto;
}

.gaveta::backdrop { background: rgb(46 42 36 / 45%); }

.gaveta-caixa { padding: 20px 20px 32px; }

.gaveta-fechar {
  position: absolute; top: 16px; right: 16px;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 10px; border: 1px solid var(--border); border-radius: var(--radius-control);
  background: var(--surface); color: var(--text-2); font: inherit; font-size: 12.5px; cursor: pointer;
}

.gaveta-fechar:hover { background: var(--surface-2); color: var(--text); }
.gaveta-fechar:focus-visible { outline: none; box-shadow: var(--ring); }

.gaveta-cabecalho { display: flex; align-items: center; gap: 9px; padding-right: 84px; }
.gaveta-titulo { font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
.gaveta-sub { margin-top: 2px; font-size: 12px; color: var(--text-2); }

.painel-ponto { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.painel-conteudo { display: flex; flex-direction: column; }
.chip-classe { background: color-mix(in srgb, currentColor 12%, transparent); font-weight: 600; }

.painel-valor { margin-top: 14px; font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 24px; font-weight: 600; letter-spacing: -0.02em; }
.painel-rendimento { margin-top: 2px; font-size: 13px; font-weight: 600; }
.painel-sem-cotacao { margin-top: 2px; font-size: 12.5px; color: var(--text-3); }
.painel-participacao { margin-top: 10px; }
.painel-pct { margin-top: 4px; font-size: 11.5px; color: var(--text-2); }

.cartao-barra { display: block; height: 5px; border-radius: var(--radius-pill); background: var(--surface-2); overflow: hidden; }
.cartao-barra-fill { display: block; height: 100%; border-radius: var(--radius-pill); }

.grade-dados { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 14px; }
.dado { padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-control); }
.dado-rotulo { display: block; font-size: 10.5px; color: var(--text-3); }
.dado-valor { display: block; margin-top: 2px; font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 13px; font-weight: 600; }

.painel-acoes { display: flex; gap: 8px; margin-top: 14px; }
.painel-acoes .btn { flex: 1; }

.painel-transacoes-cabecalho { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-top: 18px; }
.painel-transacoes-cabecalho .contagem { color: var(--text-3); font-weight: 400; }
.painel-resumo { font-size: 11.5px; color: var(--text-3); }

.transacoes { list-style: none; margin: 8px 0 0; padding: 0; border: 1px solid var(--border); border-radius: var(--radius-control); overflow: hidden; }
.transacoes li + li { border-top: 1px solid var(--border); }
.transacao { display: block; width: 100%; padding: 9px 11px; border: 0; background: transparent; font: inherit; text-align: left; color: var(--text); cursor: pointer; transition: background-color var(--dur) var(--ease); }
.transacao:hover { background: var(--surface-2); }
.transacao:focus-visible { outline: none; box-shadow: var(--ring); }
.transacao-topo { display: flex; align-items: center; gap: 8px; }
.transacao-data { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 12.5px; font-weight: 600; }
.transacao-tipo { border-radius: var(--radius-pill); padding: 1px 8px; font-size: 11px; font-weight: 600; }
.tipo-compra { background: var(--accent-soft); color: var(--accent); }
.tipo-resgate { background: var(--warn-soft); color: var(--warn); }
.transacao-valor { margin-left: auto; font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-weight: 600; }
.transacao-detalhe { display: block; margin-top: 3px; font-size: 11.5px; color: var(--text-2); }

@media (max-width: 640px) {
  .gaveta { width: 100vw; border-left: 0; }
}
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: sem erros.

- [ ] **Step 7: Build do web**

Run: `npm run build:web`
Expected: build ok.

- [ ] **Step 8: Conferência rápida no browser**

Run: `npm run dev:web` e abrir `http://localhost:5173`, seção Posições, clicar numa linha.
Expected: gaveta à direita com fundo escurecido; X/Esc/clique fora fecham; sem corte de números; lista de transações sem rolagem horizontal; fundo não rola com a gaveta aberta.

- [ ] **Step 9: Commit**

```bash
git add web/src/posicoes.ts web/src/components/Gaveta.tsx web/src/components/PainelAtivo.tsx web/src/views/PositionsView.tsx web/src/styles.css
git commit -m "feat: gaveta do ativo com painel de detalhe e transacoes em lista"
```

---

### Task 3: Transação e cadastro como modos da gaveta (zero modal em Posições)

**Files:**
- Modify: `web/src/components/FormTransacao.tsx` (reescrita completa)
- Modify: `web/src/components/FormAtivo.tsx` (reescrita completa)
- Modify: `web/src/views/PositionsView.tsx` (estado da gaveta ~28-40; `concluirMutacao`/`novoAtivo`/`editarAtivo` ~91-110; blocos de modal ~308-325)
- Modify: `web/src/styles.css` (bloco novo ao fim)

**Interfaces:**
- Consumes: `Segmented` (Task 1); `taxaTexto` (Task 2); `getInstruments`, `post`/`patch`/`delete` de `web/src/api.ts`; `parsePercentualParaE6`, `parseMoedaParaCents`, `parseQuantidadeE8` de `web/src/format.ts`.
- Produces: `FormTransacao({ posicao, transacao, onVoltar, onConcluir })`; `FormAtivo({ instrumento, qtdTransacoes, sugestoes, onVoltar, onConcluir })`; `EstadoGaveta` interno da `PositionsView`; classes `.gaveta-cabecalho-linha`, `.btn-voltar`, `.campo-moeda`, `.campo-sufixo`, `.form-dica`, `.campo-opcional`, `.aviso-travado`; `.btn-danger` preenchido.

- [ ] **Step 1: Reescrever `web/src/components/FormTransacao.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Trash } from "@phosphor-icons/react";
import { deleteTransaction, patchTransaction, postTransaction, type PortfolioPosition, type Transaction } from "../api.ts";
import { formataBRL, parseMoedaParaCents, parseQuantidadeE8 } from "../format.ts";
import { Segmented } from "./Segmented.tsx";
import { taxaTexto } from "./PainelAtivo.tsx";

function paraTextoBRL(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

type CampoComErro = "data" | "valor" | "taxas" | "quantidade" | "geral";

export function FormTransacao({ posicao, transacao, onVoltar, onConcluir }: {
  posicao: PortfolioPosition;
  transacao: Transaction | null;
  onVoltar: () => void;
  onConcluir: () => void;
}) {
  const ehRF = posicao.kind === "fixed_income";
  const [data, setData] = useState("");
  const [tipo, setTipo] = useState<"BUY" | "SELL">("BUY");
  const [valor, setValor] = useState("");
  const [taxas, setTaxas] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [nota, setNota] = useState("");
  const [erro, setErro] = useState<{ campo: CampoComErro; mensagem: string } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);

  useEffect(() => {
    const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    setErro(null);
    setConfirmandoExclusao(false);
    setData(transacao?.tradeDate ?? hoje);
    setTipo(transacao?.kind === "SELL" ? "SELL" : "BUY");
    setValor(transacao === null ? "" : paraTextoBRL(transacao.grossCents));
    setTaxas(transacao === null || transacao.feesCents === 0 ? "" : paraTextoBRL(transacao.feesCents));
    setQuantidade(transacao?.quantityE8 == null ? "" : (Math.abs(transacao.quantityE8) / 1e8).toString().replace(".", ","));
    setNota(transacao?.note ?? "");
  }, [posicao.instrumentId, transacao]);

  async function salvar() {
    if (data === "") return setErro({ campo: "data", mensagem: "informe a data" });
    const grossCents = parseMoedaParaCents(valor);
    if (grossCents === null || grossCents === 0) return setErro({ campo: "valor", mensagem: "valor inválido (ex.: <valor>)" });
    const feesCents = taxas.trim() === "" ? 0 : parseMoedaParaCents(taxas);
    if (feesCents === null) return setErro({ campo: "taxas", mensagem: "taxas inválidas (ex.: 12,50)" });
    const quantityE8 = ehRF ? null : parseQuantidadeE8(quantidade);
    if (!ehRF && quantityE8 === null) return setErro({ campo: "quantidade", mensagem: "quantidade inválida (ex.: 10,5)" });
    setSalvando(true);
    setErro(null);
    try {
      const payload = { tradeDate: data, kind: tipo, grossCents, feesCents, quantityE8, note: nota.trim() === "" ? null : nota.trim() };
      if (transacao === null) await postTransaction(posicao.instrumentId, payload);
      else await patchTransaction(transacao.id, payload);
      onConcluir();
    } catch (cause) {
      setErro({ campo: "geral", mensagem: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setSalvando(false);
    }
  }

  async function excluir() {
    if (transacao === null) return;
    setSalvando(true);
    setErro(null);
    try {
      await deleteTransaction(transacao.id);
      onConcluir();
    } catch (cause) {
      setErro({ campo: "geral", mensagem: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setSalvando(false);
    }
  }

  const taxa = taxaTexto(posicao.rateE6, posicao.benchmark);
  const dica = tipo === "SELL"
    ? `O resgate não pode passar do saldo da posição${posicao.marketValueCents === null ? "" : ` (${formataBRL(posicao.marketValueCents)})`}.`
    : `Compra aplica o valor nesta data${ehRF ? "" : "; informe também a quantidade de cotas"}.`;

  return (
    <div className="painel-conteudo">
      <div className="gaveta-cabecalho gaveta-cabecalho-linha">
        <div>
          <h2 className="gaveta-titulo">{transacao === null ? "Nova transação" : "Editar transação"}</h2>
          <p className="gaveta-sub">{posicao.name}{taxa === null ? "" : ` · ${taxa}`}</p>
        </div>
        <button type="button" className="btn-voltar" onClick={onVoltar}>‹ Voltar</button>
      </div>

      <div className="campo" style={{ marginTop: 14 }}>
        <span className="stat-label">Tipo</span>
        <Segmented
          rotulo="Tipo da transação"
          valor={tipo}
          onMudar={setTipo}
          opcoes={[{ valor: "BUY", rotulo: "Compra" }, { valor: "SELL", rotulo: "Resgate" }]}
        />
      </div>

      <div className="form-grade">
        <label className="campo">
          <span className="stat-label">Data</span>
          <input type="date" value={data} onChange={(evento) => setData(evento.target.value)} />
          {erro?.campo === "data" && <span className="campo-erro" role="alert">{erro.mensagem}</span>}
        </label>
        <label className="campo">
          <span className="stat-label">Valor</span>
          <span className="campo-moeda">
            <span className="campo-prefixo">R$</span>
            <input inputMode="decimal" value={valor} onChange={(evento) => setValor(evento.target.value)} placeholder="<valor>" />
          </span>
          {erro?.campo === "valor" && <span className="campo-erro" role="alert">{erro.mensagem}</span>}
        </label>
        <label className="campo">
          <span className="stat-label">Taxas <span className="campo-opcional">opcional</span></span>
          <input inputMode="decimal" value={taxas} onChange={(evento) => setTaxas(evento.target.value)} placeholder="0,00" />
          {erro?.campo === "taxas" && <span className="campo-erro" role="alert">{erro.mensagem}</span>}
        </label>
        {!ehRF && (
          <label className="campo">
            <span className="stat-label">Quantidade (cotas)</span>
            <input inputMode="decimal" value={quantidade} onChange={(evento) => setQuantidade(evento.target.value)} placeholder="10,5" />
            {erro?.campo === "quantidade" && <span className="campo-erro" role="alert">{erro.mensagem}</span>}
          </label>
        )}
        <label className="campo campo-largo">
          <span className="stat-label">Nota <span className="campo-opcional">opcional</span></span>
          <input value={nota} maxLength={200} onChange={(evento) => setNota(evento.target.value)} placeholder="ex.: aporte do mês" />
        </label>
      </div>

      <p className="form-dica">{dica}</p>
      {erro?.campo === "geral" && <p className="campo-erro" role="alert">{erro.mensagem}</p>}

      <div className="form-acoes">
        {transacao !== null && (
          confirmandoExclusao ? (
            <>
              <button type="button" className="btn btn-danger" disabled={salvando} onClick={() => void excluir()}>Confirmar exclusão</button>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmandoExclusao(false)}>Cancelar</button>
            </>
          ) : (
            <button type="button" className="btn btn-secondary" onClick={() => setConfirmandoExclusao(true)}>
              <Trash size={15} aria-hidden="true" /> Excluir
            </button>
          )
        )}
        <button type="button" className="btn btn-secondary" onClick={onVoltar}>Cancelar</button>
        <button type="button" className="btn btn-primary" disabled={salvando} onClick={() => void salvar()}>
          {salvando ? "Salvando…" : "Salvar transação"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Reescrever `web/src/components/FormAtivo.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Trash } from "@phosphor-icons/react";
import { deleteInstrument, patchInstrument, postInstrument, type Instrument, type InstrumentPayload } from "../api.ts";
import { formataCategoria, parsePercentualParaE6 } from "../format.ts";
import { Segmented } from "./Segmented.tsx";

const MODELOS: Array<{ id: string; rotulo: string; kind: Instrument["kind"]; category: string }> = [
  { id: "rf", rotulo: "Renda fixa", kind: "fixed_income", category: "cdb" },
  { id: "etf-rf", rotulo: "ETF RF", kind: "equity", category: "etf_fixed" },
  { id: "etf-rv", rotulo: "ETF RV", kind: "equity", category: "etf_equity" },
  { id: "pgbl", rotulo: "PGBL", kind: "pension", category: "pension_ipca" },
];

const CATEGORIAS_RF: Record<string, string> = { cdb: "CDB", lca: "LCA", selic: "Selic" };
const INVESTIDORES: string[] = ["Ana", "Beto"];

type CampoComErro = "nome" | "rentabilidade" | "ticker" | "codigoCvm" | "geral";

export function FormAtivo({ instrumento, qtdTransacoes, sugestoes, onVoltar, onConcluir }: {
  instrumento: Instrument | null;
  qtdTransacoes: number;
  sugestoes: { corretoras: string[]; objetivos: string[]; liquidez: string[] };
  onVoltar: () => void;
  onConcluir: () => void;
}) {
  const temTransacoes = qtdTransacoes > 0;
  const [modelo, setModelo] = useState("rf");
  const [categoria, setCategoria] = useState("cdb");
  const [nome, setNome] = useState("");
  const [ticker, setTicker] = useState("");
  const [codigoCvm, setCodigoCvm] = useState("");
  const [benchmark, setBenchmark] = useState("CDI");
  const [rentabilidade, setRentabilidade] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [liquidez, setLiquidez] = useState("");
  const [corretora, setCorretora] = useState("");
  const [objetivo, setObjetivo] = useState("");
  const [investidor, setInvestidor] = useState("");
  const [erro, setErro] = useState<{ campo: CampoComErro; mensagem: string } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);

  useEffect(() => {
    setErro(null);
    setConfirmandoExclusao(false);
    if (instrumento === null) {
      setModelo("rf"); setCategoria("cdb"); setNome(""); setTicker(""); setCodigoCvm("");
      setBenchmark("CDI"); setRentabilidade(""); setVencimento(""); setLiquidez("");
      setCorretora(""); setObjetivo(""); setInvestidor("");
      return;
    }
    const modeloAtual = instrumento.kind === "fixed_income" ? "rf"
      : instrumento.kind === "pension" ? "pgbl"
        : instrumento.category === "etf_fixed" ? "etf-rf" : "etf-rv";
    setModelo(modeloAtual);
    setCategoria(instrumento.category);
    setNome(instrumento.name);
    setTicker(instrumento.ticker ?? "");
    setCodigoCvm(instrumento.quoteSymbol ?? "");
    setBenchmark(instrumento.benchmark ?? "CDI");
    setRentabilidade(instrumento.rateE6 === null ? "" : (instrumento.rateE6 / 10_000).toString().replace(".", ","));
    setVencimento(instrumento.maturityDate ?? "");
    setLiquidez(instrumento.liquidity ?? "");
    setCorretora(instrumento.broker ?? "");
    setObjetivo(instrumento.objective ?? "");
    setInvestidor(instrumento.investor ?? "");
  }, [instrumento]);

  const definicao = MODELOS.find((item) => item.id === modelo) ?? MODELOS[0];
  const ehRF = definicao.kind === "fixed_income";
  const investidores: string[] = instrumento !== null && instrumento.investor !== null && !INVESTIDORES.includes(instrumento.investor)
    ? [instrumento.investor, ...INVESTIDORES]
    : INVESTIDORES;
  const opcoesInvestidor: Array<{ valor: string; rotulo: string }> = [
    { valor: "", rotulo: "—" },
    ...investidores.map((valor) => ({ valor, rotulo: valor })),
  ];

  async function salvar() {
    const payload: InstrumentPayload = {
      name: nome.trim(),
      kind: definicao.kind,
      category: ehRF ? categoria : definicao.category,
      benchmark: null, rateE6: null, maturityDate: null, ticker: null, quoteSymbol: null,
      liquidity: liquidez.trim() === "" ? null : liquidez.trim(),
      broker: corretora.trim() === "" ? null : corretora.trim(),
      objective: objetivo.trim() === "" ? null : objetivo.trim(),
    };
    if (instrumento === null || investidor !== (instrumento.investor ?? "")) {
      payload.investor = investidor === "" ? null : investidor;
    }
    if (payload.name === "") return setErro({ campo: "nome", mensagem: "informe o nome" });
    if (ehRF) {
      const rateE6 = parsePercentualParaE6(rentabilidade);
      if (rateE6 === null) return setErro({ campo: "rentabilidade", mensagem: "rentabilidade inválida (ex.: 105 ou 105,5)" });
      payload.benchmark = benchmark;
      payload.rateE6 = rateE6;
      payload.maturityDate = vencimento === "" ? null : vencimento;
    } else if (definicao.kind === "equity") {
      if (ticker.trim() === "") return setErro({ campo: "ticker", mensagem: "informe o ticker" });
      payload.ticker = ticker.trim().toUpperCase();
    } else {
      if (codigoCvm.trim() === "") return setErro({ campo: "codigoCvm", mensagem: "informe o código CVM" });
      payload.quoteSymbol = codigoCvm.trim();
    }
    setSalvando(true);
    setErro(null);
    try {
      if (instrumento === null) await postInstrument(payload);
      else await patchInstrument(instrumento.id, payload);
      onConcluir();
    } catch (cause) {
      setErro({ campo: "geral", mensagem: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setSalvando(false);
    }
  }

  async function excluir() {
    if (instrumento === null) return;
    setSalvando(true);
    setErro(null);
    try {
      await deleteInstrument(instrumento.id);
      onConcluir();
    } catch (cause) {
      setErro({ campo: "geral", mensagem: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="painel-conteudo">
      <div className="gaveta-cabecalho gaveta-cabecalho-linha">
        <div>
          <h2 className="gaveta-titulo">{instrumento === null ? "Novo ativo" : "Editar cadastro"}</h2>
          <p className="gaveta-sub">
            {instrumento === null ? "preencha os dados do ativo" : `${formataCategoria(instrumento.category)}${instrumento.broker === null ? "" : ` · ${instrumento.broker}`}`}
          </p>
        </div>
        <button type="button" className="btn-voltar" onClick={onVoltar}>{instrumento === null ? "Cancelar" : "‹ Voltar"}</button>
      </div>

      <div className="campo" style={{ marginTop: 14 }}>
        <span className="stat-label">Modelo</span>
        <Segmented
          rotulo="Modelo do ativo"
          valor={modelo}
          desabilitado={temTransacoes}
          onMudar={(novo) => {
            setModelo(novo);
            if (novo === "rf" && !(categoria in CATEGORIAS_RF)) setCategoria("cdb");
          }}
          opcoes={MODELOS.map((item) => ({ valor: item.id, rotulo: item.rotulo }))}
        />
      </div>

      <div className="form-grade">
        <label className="campo campo-largo">
          <span className="stat-label">Nome</span>
          <input value={nome} onChange={(evento) => setNome(evento.target.value)} placeholder="CDB Banco X 2029" />
          {erro?.campo === "nome" && <span className="campo-erro" role="alert">{erro.mensagem}</span>}
        </label>
        {ehRF && (
          <label className="campo">
            <span className="stat-label">Categoria</span>
            <select value={categoria} disabled={temTransacoes} onChange={(evento) => setCategoria(evento.target.value)}>
              {Object.entries(CATEGORIAS_RF).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
            </select>
          </label>
        )}
        {definicao.kind === "equity" && (
          <label className="campo">
            <span className="stat-label">Ticker</span>
            <input value={ticker} onChange={(evento) => setTicker(evento.target.value)} placeholder="WRLD11" />
            {erro?.campo === "ticker" && <span className="campo-erro" role="alert">{erro.mensagem}</span>}
          </label>
        )}
        {definicao.kind === "pension" && (
          <label className="campo">
            <span className="stat-label">Código CVM</span>
            <input value={codigoCvm} onChange={(evento) => setCodigoCvm(evento.target.value)} placeholder="<valor>" />
            {erro?.campo === "codigoCvm" && <span className="campo-erro" role="alert">{erro.mensagem}</span>}
          </label>
        )}
        {ehRF && (
          <>
            <label className="campo">
              <span className="stat-label">Índice</span>
              <select value={benchmark} onChange={(evento) => setBenchmark(evento.target.value)}>
                <option value="CDI">CDI</option>
                <option value="SELIC">Selic</option>
              </select>
            </label>
            <label className="campo">
              <span className="stat-label">Rentabilidade</span>
              <span className="campo-sufixo">
                <input inputMode="decimal" value={rentabilidade} onChange={(evento) => setRentabilidade(evento.target.value)} placeholder="105" />
                <span className="campo-sufixo-texto">% do {benchmark}</span>
              </span>
              {erro?.campo === "rentabilidade" && <span className="campo-erro" role="alert">{erro.mensagem}</span>}
            </label>
            <label className="campo">
              <span className="stat-label">Vencimento</span>
              <input type="date" value={vencimento} onChange={(evento) => setVencimento(evento.target.value)} />
            </label>
          </>
        )}
        <label className="campo">
          <span className="stat-label">Liquidez</span>
          <input list="sugestoes-liquidez" value={liquidez} onChange={(evento) => setLiquidez(evento.target.value)} placeholder="Diário" />
          <datalist id="sugestoes-liquidez">
            {sugestoes.liquidez.map((valor) => <option key={valor} value={valor} />)}
          </datalist>
        </label>
        <label className="campo">
          <span className="stat-label">Corretora</span>
          <input list="sugestoes-corretoras" value={corretora} onChange={(evento) => setCorretora(evento.target.value)} placeholder="BTG" />
          <datalist id="sugestoes-corretoras">
            {sugestoes.corretoras.map((valor) => <option key={valor} value={valor} />)}
          </datalist>
        </label>
        <label className="campo">
          <span className="stat-label">Objetivo</span>
          <input list="sugestoes-objetivos" value={objetivo} onChange={(evento) => setObjetivo(evento.target.value)} placeholder="Reserva" />
          <datalist id="sugestoes-objetivos">
            {sugestoes.objetivos.map((valor) => <option key={valor} value={valor} />)}
          </datalist>
        </label>
        <div className="campo">
          <span className="stat-label">Investidor</span>
          <Segmented rotulo="Investidor" valor={investidor} onMudar={setInvestidor} opcoes={opcoesInvestidor} />
        </div>
      </div>

      {temTransacoes && (
        <p className="aviso-travado">
          <strong>{qtdTransacoes} {qtdTransacoes === 1 ? "transação lançada" : "transações lançadas"}.</strong>{" "}
          Modelo e categoria travados; excluir o ativo fica indisponível até as transações saírem.
        </p>
      )}
      {erro?.campo === "geral" && <p className="campo-erro" role="alert">{erro.mensagem}</p>}

      <div className="form-acoes">
        {instrumento !== null && (
          confirmandoExclusao ? (
            <>
              <button type="button" className="btn btn-danger" disabled={salvando || temTransacoes} onClick={() => void excluir()}>Confirmar exclusão</button>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmandoExclusao(false)}>Cancelar</button>
            </>
          ) : (
            <button type="button" className="btn btn-secondary" disabled={temTransacoes} title={temTransacoes ? `${qtdTransacoes} transações lançadas` : undefined} onClick={() => setConfirmandoExclusao(true)}>
              <Trash size={15} aria-hidden="true" /> Excluir ativo
            </button>
          )
        )}
        <button type="button" className="btn btn-primary" disabled={salvando} onClick={() => void salvar()}>
          {salvando ? "Salvando…" : "Salvar cadastro"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Trocar o estado da gaveta na `PositionsView`**

3a. Substituir `const [gavetaAberta, setGavetaAberta] = useState(false);` (Task 2) por:

```tsx
type EstadoGaveta =
  | { tipo: "detalhe" }
  | { tipo: "transacao"; transacao: Transaction | null }
  | { tipo: "cadastro"; instrumento: Instrument | null; qtdTransacoes: number };
```

(no topo do arquivo, antes do componente)

```tsx
  const [gaveta, setGaveta] = useState<EstadoGaveta | null>(null);
  const [sugestoesLiquidez, setSugestoesLiquidez] = useState<string[]>([]);
```

3b. Substituir `abrirAtivo`/`fecharGaveta`/`concluirMutacao`/`novoAtivo`/`editarAtivo` por:

```tsx
  function abrirAtivo(posicao: PortfolioPosition) {
    setSelecionada(posicao);
    setGaveta({ tipo: "detalhe" });
  }

  function fecharGaveta() {
    setGaveta(null);
    setSelecionada(null);
  }

  function liquidezDe(instrumentos: Instrument[]): string[] {
    return [...new Set(instrumentos.map((item) => item.liquidity).filter((valor): valor is string => valor !== null && valor !== ""))].sort();
  }

  function novoAtivo() {
    setSelecionada(null);
    setGaveta({ tipo: "cadastro", instrumento: null, qtdTransacoes: 0 });
    getInstruments()
      .then((instrumentos) => setSugestoesLiquidez(liquidezDe(instrumentos)))
      .catch(() => undefined);
  }

  async function editarAtivo() {
    if (selecionada === null) return;
    try {
      const instrumentos = await getInstruments();
      const instrumento = instrumentos.find((item) => item.id === selecionada.instrumentId) ?? null;
      setSugestoesLiquidez(liquidezDe(instrumentos));
      setGaveta({ tipo: "cadastro", instrumento, qtdTransacoes: (transacoes ?? []).length });
    } catch (cause) {
      setErro(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function concluirMutacao() {
    setRecargaLocal((valor) => valor + 1);
    setGaveta((atual) => {
      if (atual !== null && atual.tipo === "cadastro" && atual.instrumento === null) return null;
      return selecionada === null ? null : { tipo: "detalhe" };
    });
  }
```

3c. Excluir os estados `formAtivo`/`formTransacao` (linhas ~39-40) e todo o bloco final de modais:

```tsx
      {formTransacao !== null && selecionada !== null && (
        <FormTransacao
          aberto
          posicao={selecionada}
          transacao={formTransacao.transacao}
          onFechar={() => setFormTransacao(null)}
          onSalvo={concluirMutacao}
        />
      )}
      {formAtivo !== null && (
        <FormAtivo
          aberto
          instrumento={formAtivo.instrumento}
          qtdTransacoes={formAtivo.qtdTransacoes}
          onFechar={() => setFormAtivo(null)}
          onSalvo={concluirMutacao}
        />
      )}
```

3d. Trocar o bloco da gaveta (Task 2) por:

```tsx
      {gaveta !== null && (
        <Gaveta aberta titulo={selecionada === null ? "Novo ativo" : selecionada.name} onFechar={fecharGaveta}>
          {gaveta.tipo === "detalhe" && selecionada !== null && (
            <PainelAtivo
              posicao={selecionada}
              totalCents={total}
              transacoes={transacoes}
              onNovaTransacao={() => setGaveta({ tipo: "transacao", transacao: null })}
              onEditarTransacao={(transacao) => setGaveta({ tipo: "transacao", transacao })}
              onEditarCadastro={() => void editarAtivo()}
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

3e. Excluir o marcador `—` das sugestões (os filtros continuam usando "—" para posições sem valor):

```tsx
  const corretoras = useMemo(
    () => [...new Set((posicoes ?? []).map((posicao) => posicao.broker).filter((valor): valor is string => valor !== null && valor !== ""))].sort(),
    [posicoes],
  );
  const objetivos = useMemo(
    () => [...new Set((posicoes ?? []).map((posicao) => posicao.objective).filter((valor): valor is string => valor !== null && valor !== ""))].sort(),
    [posicoes],
  );
```

- [ ] **Step 4: Completar o CSS em `styles.css`**

Acrescentar ao fim:

```css
.gaveta-cabecalho-linha { align-items: flex-start; justify-content: space-between; }

.btn-voltar {
  border: 0; background: transparent; color: var(--text-2);
  font: inherit; font-size: 12.5px; padding: 3px 6px; border-radius: 6px;
  cursor: pointer; white-space: nowrap;
}
.btn-voltar:hover { background: var(--surface-2); color: var(--text); }
.btn-voltar:focus-visible { outline: none; box-shadow: var(--ring); }

.campo-opcional { color: var(--text-3); font-weight: 400; }
.campo-moeda { display: flex; align-items: center; gap: 6px; padding-left: 11px; background: var(--surface); border: 1px solid var(--border-strong); border-radius: var(--radius-control); transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease); }
.campo-moeda:hover { border-color: var(--text-3); }
.campo-moeda:focus-within { border-color: var(--accent); box-shadow: var(--ring); }
.campo-prefixo { color: var(--text-3); font-size: 13px; }
.campo-moeda input { flex: 1; min-width: 0; border: 0; background: transparent; padding-left: 0; }
.campo-moeda input:hover, .campo-moeda input:focus { border: 0; box-shadow: none; }

.campo-sufixo { display: flex; align-items: center; gap: 6px; }
.campo-sufixo input { flex: 1; min-width: 0; }
.campo-sufixo-texto { color: var(--text-3); font-size: 12px; white-space: nowrap; }

.form-dica { margin-top: 12px; padding: 9px 12px; background: var(--surface-2); border-radius: var(--radius-control); font-size: 12px; color: var(--text-2); }
.aviso-travado { margin-top: 12px; padding: 9px 12px; background: var(--warn-soft); border-radius: var(--radius-control); font-size: 12px; color: var(--text); }
.aviso-travado strong { color: var(--warn); }

.btn-danger { background: var(--danger); border-color: var(--danger); color: var(--ink-contrast); }
.btn-danger:hover:not(:disabled) { background: color-mix(in srgb, var(--danger) 86%, var(--bg)); }
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: sem erros. Se `Modal` ficar sem uso em algum arquivo, o import correspondente também sai (`FormAtivo`/`FormTransacao` não importam mais `Modal`).

- [ ] **Step 6: Build do web**

Run: `npm run build:web`
Expected: build ok.

- [ ] **Step 7: Conferência rápida no browser**

Run: `npm run dev:web` + `http://localhost:5173`, Posições.
Expected: "Editar cadastro" e "Nova transação" abrem dentro da gaveta; "Novo ativo" abre a gaveta em branco; salvar volta ao detalhe (edição) ou fecha (novo); nenhuma modal em Posições; erro aparece abaixo do campo.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/FormTransacao.tsx web/src/components/FormAtivo.tsx web/src/views/PositionsView.tsx web/src/styles.css
git commit -m "feat: transacao e cadastro viram modos da gaveta do ativo"
```

---

### Task 4: Lista em cartões agrupados + encerradas

**Files:**
- Create: `web/src/components/CartaoAtivo.tsx`
- Modify: `web/src/views/PositionsView.tsx` (imports ~1-7; remoção da `rendimentoDe` local ~11-16; cálculos após `visiveis` ~126; bloco da tabela ~195-249)
- Modify: `web/src/styles.css` (bloco novo ao fim)

**Interfaces:**
- Consumes: `rendimentoDe`, `resultadoRealizadoDe`, `participacaoPct` de `web/src/posicoes.ts`; `COR_DA_CLASSE` de `web/src/classes.ts`; `taxaTexto` de `PainelAtivo.tsx`.
- Produces: `CartaoAtivo({ posicao, totalCents, onAbrir })`; classes `.grupo-*`, `.grade-cartoes`, `.cartao-*`, `.badge-neutro`, `.encerradas*`.

- [ ] **Step 1: Criar `web/src/components/CartaoAtivo.tsx`**

```tsx
import type { PortfolioPosition } from "../api.ts";
import { formataBRL, formataCategoria, formataData, formataPercentualSinal, formataQuantidade } from "../format.ts";
import { COR_DA_CLASSE, classeDe } from "../classes.ts";
import { participacaoPct, rendimentoDe } from "../posicoes.ts";
import { taxaTexto } from "./PainelAtivo.tsx";

export function CartaoAtivo({ posicao, totalCents, onAbrir }: {
  posicao: PortfolioPosition;
  totalCents: number;
  onAbrir: (posicao: PortfolioPosition) => void;
}) {
  const rendimento = rendimentoDe(posicao);
  const pct = participacaoPct(posicao.marketValueCents, totalCents);
  const cor = COR_DA_CLASSE[classeDe(posicao)];
  const taxa = taxaTexto(posicao.rateE6, posicao.benchmark);
  const chip = posicao.kind === "pension"
    ? "PGBL · IPCA"
    : posicao.category === "etf_fixed"
      ? "ETF RF"
      : posicao.category === "etf_equity"
        ? "ETF RV"
        : taxa ?? formataCategoria(posicao.category);
  const meta: string[] = [];
  if (posicao.kind !== "fixed_income") {
    if (posicao.quantityE8 !== null) meta.push(`${formataQuantidade(posicao.quantityE8)} cotas`);
    if (posicao.priceCents !== null) meta.push(formataBRL(posicao.priceCents));
  }
  if (posicao.broker !== null && posicao.broker !== "") meta.push(posicao.broker);
  meta.push(posicao.investor ?? "sem investidor");
  if (posicao.objective !== null && posicao.objective !== "") meta.push(posicao.objective);

  return (
    <button type="button" className="cartao-ativo" style={{ borderLeft: `3px solid ${cor}` }} onClick={() => onAbrir(posicao)}>
      <span className="cartao-topo">
        <span className="cartao-nome">{posicao.name}</span>
        <span className="cartao-chip">{chip}</span>
      </span>
      <span className="cartao-valor">{posicao.marketValueCents === null ? "—" : formataBRL(posicao.marketValueCents)}</span>
      {rendimento.cents === null ? (
        <span className="cartao-sem-cotacao">sem cotação hoje</span>
      ) : (
        <span className={rendimento.cents >= 0 ? "cartao-rendimento rendimento-positivo" : "cartao-rendimento rendimento-negativo"}>
          {rendimento.cents >= 0 ? "▲" : "▼"} {formataBRL(rendimento.cents)}
          {rendimento.pct === null ? "" : ` (${formataPercentualSinal(rendimento.pct)})`}
        </span>
      )}
      {pct !== null && (
        <span className="cartao-participacao">
          <span className="cartao-barra"><span className="cartao-barra-fill" style={{ width: `${Math.min(100, pct)}%`, background: cor }} /></span>
          <span className="cartao-pct">{pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</span>
        </span>
      )}
      <span className="cartao-meta">{meta.join(" · ")}</span>
      <span className="cartao-badges">
        {posicao.stale && <span className="badge badge-warn">desatualizado</span>}
        {posicao.pendingRedemption && (
          <span className="badge badge-warn">
            {posicao.maturityDate === null ? "vencido · resgate pendente" : `vencido em ${formataData(posicao.maturityDate)} · resgate pendente`}
          </span>
        )}
        {!posicao.pendingRedemption && posicao.maturityDate !== null && (
          <span className="badge badge-neutro">vence {formataData(posicao.maturityDate)}</span>
        )}
      </span>
    </button>
  );
}
```

- [ ] **Step 2: Calcular grupos na `PositionsView`**

2a. Imports: trocar a linha do React e a dos ícones por:

```tsx
import { useEffect, useMemo, useState } from "react";
import { MagnifyingGlass, Plus, Table } from "@phosphor-icons/react";
```

e a linha de format por:

```tsx
import { formataBRL, formataPercentualSinal } from "../format.ts";
```

Acrescentar:

```tsx
import { CartaoAtivo } from "../components/CartaoAtivo.tsx";
import { capitalDe, resultadoRealizadoDe, rendimentoDe } from "../posicoes.ts";
```

2b. Remover a função local `rendimentoDe` (linhas ~11-16) — passa a vir de `../posicoes.ts`.

2c. Depois do bloco `const visiveis = (posicoes ?? []) … .sort(…)`:

```tsx
  const rendimentoTotal = (posicoes ?? []).reduce((soma, posicao) => soma + (rendimentoDe(posicao).cents ?? 0), 0);
  const capitalTotal = (posicoes ?? []).reduce((soma, posicao) => soma + capitalDe(posicao), 0);
  const rendimentoPctTotal = capitalTotal > 0 ? (rendimentoTotal / capitalTotal) * 100 : null;

  const ativas = visiveis.filter((posicao) => posicao.marketValueCents !== 0);
  const encerradas = visiveis.filter((posicao) => posicao.marketValueCents === 0);
  const resultadoEncerradas = encerradas.reduce((soma, posicao) => soma + resultadoRealizadoDe(posicao), 0);
  const grupos = ORDEM_CLASSE
    .map((classeGrupo) => ({ classe: classeGrupo, posicoes: ativas.filter((posicao) => classeDe(posicao) === classeGrupo) }))
    .filter((grupo) => grupo.posicoes.length > 0);
```

2d. Trocar a linha secundária do cabeçalho (bloco `page-sub resumo-itens`, linhas ~133-136) por:

```tsx
          <p className="page-sub resumo-itens">
            <span>{visiveis.length} de {(posicoes ?? []).length} ativos</span>
            <span>valor total {formataBRL(total)}</span>
            <span className={rendimentoTotal >= 0 ? "rendimento-positivo" : "rendimento-negativo"}>
              rendimento {rendimentoTotal > 0 ? "+" : ""}{formataBRL(rendimentoTotal)}
              {rendimentoPctTotal === null ? "" : ` (${formataPercentualSinal(rendimentoPctTotal)})`}
            </span>
          </p>
```

- [ ] **Step 3: Substituir a tabela pelo bloco de grupos + encerradas**

Trocar todo o trecho `{visiveis.length === 0 ? ( … ) : ( <div className="table-wrap card"> … </div> )}` (linhas ~195-249) por:

```tsx
      {visiveis.length === 0 ? (
        <div className="empty">
          <Table size={22} aria-hidden="true" />
          <p className="empty-title">Nenhum ativo</p>
          <p className="empty-hint">Ajuste os filtros ou crie um ativo em Novo ativo.</p>
        </div>
      ) : (
        <>
          {grupos.map(({ classe: classeGrupo, posicoes: doGrupo }) => {
            const valor = doGrupo.reduce((soma, posicao) => soma + (posicao.marketValueCents ?? 0), 0);
            const pct = total > 0 ? (valor / total) * 100 : 0;
            return (
              <section key={classeGrupo} className="grupo-classe" aria-label={ROTULO_CLASSE[classeGrupo]}>
                <div className="grupo-cabecalho">
                  <span className="grupo-cor" style={{ background: COR_DA_CLASSE[classeGrupo] }} aria-hidden="true" />
                  <h2 className="grupo-nome">{ROTULO_CLASSE[classeGrupo]}</h2>
                  <span className="grupo-numeros">
                    {doGrupo.length} {doGrupo.length === 1 ? "ativo" : "ativos"} · {formataBRL(valor)} · {pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
                  </span>
                </div>
                <span className="grupo-barra" aria-hidden="true">
                  <span className="grupo-barra-fill" style={{ width: `${Math.min(100, pct)}%`, background: COR_DA_CLASSE[classeGrupo] }} />
                </span>
                <div className="grade-cartoes">
                  {doGrupo.map((posicao) => (
                    <CartaoAtivo key={posicao.instrumentId} posicao={posicao} totalCents={total} onAbrir={abrirAtivo} />
                  ))}
                </div>
              </section>
            );
          })}

          {encerradas.length > 0 && (
            <details className="encerradas">
              <summary>
                <span className="encerradas-resumo">
                  {encerradas.length} {encerradas.length === 1 ? "posição encerrada" : "posições encerradas"} (R$ <valor>) · resultado realizado{" "}
                  <strong className={resultadoEncerradas >= 0 ? "rendimento-positivo" : "rendimento-negativo"}>{formataBRL(resultadoEncerradas)}</strong>
                </span>
                <span className="encerradas-toggle">mostrar</span>
              </summary>
              <ul className="encerradas-lista">
                {encerradas.map((posicao) => {
                  const resultado = resultadoRealizadoDe(posicao);
                  return (
                    <li key={posicao.instrumentId}>
                      <button type="button" className="encerrada" onClick={() => abrirAtivo(posicao)}>
                        <span className="encerrada-nome">{posicao.name}</span>
                        <span className="encerrada-meta">
                          {[posicao.broker, posicao.investor].filter((valorMeta): valorMeta is string => valorMeta !== null && valorMeta !== "").join(" · ")}
                        </span>
                        <span className={resultado >= 0 ? "encerrada-resultado rendimento-positivo" : "encerrada-resultado rendimento-negativo"}>{formataBRL(resultado)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
        </>
      )}
```

- [ ] **Step 4: Completar o CSS em `styles.css`**

Acrescentar ao fim:

```css
.grupo-classe { margin-bottom: 20px; }
.grupo-cabecalho { display: flex; align-items: center; gap: 9px; }
.grupo-cor { width: 10px; height: 10px; border-radius: 3px; flex: none; }
.grupo-nome { font-size: 13.5px; font-weight: 600; }
.grupo-numeros { font-size: 12px; color: var(--text-2); }
.grupo-barra { display: block; height: 4px; margin: 8px 0 10px; border-radius: var(--radius-pill); background: var(--surface-2); overflow: hidden; }
.grupo-barra-fill { display: block; height: 100%; border-radius: var(--radius-pill); }

.grade-cartoes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }

.cartao-ativo { display: flex; flex-direction: column; gap: 6px; width: 100%; padding: 14px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card); box-shadow: var(--shadow-card); font: inherit; color: var(--text); text-align: left; cursor: pointer; transition: border-color var(--dur) var(--ease), transform var(--dur) var(--ease); }
.cartao-ativo:hover { border-color: var(--border-strong); }
.cartao-ativo:active { transform: translateY(1px); }
.cartao-ativo:focus-visible { outline: none; box-shadow: var(--ring); }

.cartao-topo { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.cartao-nome { font-weight: 600; line-height: 1.3; }
.cartao-chip { flex: none; padding: 2px 8px; border-radius: var(--radius-pill); background: var(--surface-2); color: var(--text-2); font-size: 10.5px; font-weight: 600; white-space: nowrap; }
.cartao-valor { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 19px; font-weight: 600; letter-spacing: -0.02em; }
.cartao-rendimento { font-size: 12.5px; font-weight: 600; }
.cartao-sem-cotacao { font-size: 12.5px; color: var(--text-3); }
.cartao-participacao { display: flex; align-items: center; gap: 8px; }
.cartao-participacao .cartao-barra { flex: 1; }
.cartao-pct { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 11px; color: var(--text-2); }
.cartao-meta { font-size: 11.5px; color: var(--text-2); }
.cartao-badges { display: flex; flex-wrap: wrap; gap: 4px; }
.cartao-badges .badge { margin-left: 0; }
.cartao-badges:empty { display: none; }
.badge-neutro { background: var(--surface-2); color: var(--text-2); }

.encerradas { margin-top: 4px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card); }
.encerradas summary { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 16px; cursor: pointer; list-style: none; }
.encerradas summary::-webkit-details-marker { display: none; }
.encerradas summary:focus-visible { outline: none; box-shadow: var(--ring); border-radius: var(--radius-card); }
.encerradas-resumo { font-size: 12.5px; color: var(--text-2); }
.encerradas-toggle { font-size: 12px; color: var(--text-3); }
.encerradas[open] .encerradas-toggle { visibility: hidden; }
.encerradas-lista { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--border); }
.encerradas-lista li + li { border-top: 1px solid var(--border); }
.encerrada { display: grid; grid-template-columns: minmax(0, 1fr) 160px 110px; gap: 10px; align-items: center; width: 100%; padding: 9px 16px; border: 0; background: transparent; font: inherit; text-align: left; color: var(--text); cursor: pointer; transition: background-color var(--dur) var(--ease); }
.encerrada:hover { background: var(--surface-2); }
.encerrada:focus-visible { outline: none; box-shadow: var(--ring); }
.encerrada-nome { color: var(--text-2); }
.encerrada-meta { font-size: 11.5px; color: var(--text-3); }
.encerrada-resultado { text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-weight: 600; }

@media (max-width: 1100px) { .grade-cartoes { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 700px) { .grade-cartoes { grid-template-columns: 1fr; } .encerrada { grid-template-columns: minmax(0, 1fr) 110px; } .encerrada-meta { display: none; } }
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: sem erros; nenhum import órfão (`CaretUp`/`CaretDown`/`formataData`/`formataQuantidade`/`formataCategoria` saem da `PositionsView`).

- [ ] **Step 6: Build do web**

Run: `npm run build:web`
Expected: build ok.

- [ ] **Step 7: Conferência rápida no browser**

Run: `npm run dev:web` + `http://localhost:5173`, Posições.
Expected: grupos RF · RV · Previdência com cartões; nenhum cartão R$ <valor>; faixa de encerradas abrindo; clique no cartão e na linha encerrada abre a gaveta; filtros e ordenação continuam funcionando (ordem dentro do grupo).

- [ ] **Step 8: Commit**

```bash
git add web/src/components/CartaoAtivo.tsx web/src/views/PositionsView.tsx web/src/styles.css
git commit -m "feat: lista de posicoes em cartoes agrupados por classe"
```

---

### Task 5: Aceite no browser com dados reais + verificação final

**Files:**
- Nenhum arquivo de código (verificação); screenshots em `.superpowers/sdd/`; `ROADMAP.md` ao final

**Interfaces:**
- Consumes: container `investment-tracker-app-1` em `localhost:3000` (dados reais); Vite dev (`npm run dev:web`, porta 5173, proxy `/api` → 3000).
- Produces: evidência de aceite + etapa marcada no `ROADMAP.md`.

- [ ] **Step 1: Conferir a API real**

Run:

```bash
curl -s localhost:3000/api/portfolio | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  const p=JSON.parse(d);
  const cls=x=>x.kind==='pension'?'prev':(x.kind==='fixed_income'||x.category==='etf_fixed')?'rf':'rv';
  const g={}; let encerradas=0; let resultado=0;
  for(const x of p.positions){const c=cls(x);g[c]=(g[c]??0)+((x.marketValueCents??0)>0?1:0);if(x.marketValueCents===0){encerradas++;resultado+=x.redeemedCents-x.investedCents;}}
  console.log('total',p.totals.marketValueCents,'rf',g.rf,'rv',g.rv,'prev',g.prev,'encerradas',encerradas,'resultado',resultado);
});"
```

Expected (2026-09-24): `total <valor> rf 23 rv 1 prev 1 encerradas 23 resultado <valor>`. Cotações oscilam intraday — o critério é a UI bater com a API **no momento da conferência**.

- [ ] **Step 2: Conferir a lista**

Abrir `http://localhost:5173#posicoes` (ou clicar em Posições).
Expected: 3 grupos com os mesmos totais do Step 1; nenhum cartão R$ <valor>; faixa "23 posições encerradas (R$ <valor>) · resultado realizado +R$ <valor>"; expandir mostra as linhas.

- [ ] **Step 3: Conferir a gaveta (BB LCA POS CDI)**

Clicar no cartão do BB LCA POS CDI.
Expected: gaveta com `R$ <valor>`, `▲ +R$ <valor> (+20,52%)`, chips `Renda Fixa · LCA · Banco do Brasil · Ana · Reserva`, grade `Taxa 96% CDI`, `Vencimento 09/02/2029`, `Índice em 23/09/2026`, `Capital R$ <valor>`, e 1 transação (23/04/2025 · Compra · R$ <valor>). X, Esc e clique fora fecham; com a gaveta aberta o fundo não rola.

- [ ] **Step 4: Conferir os fluxos de escrita (v2 preservado)**

Na gaveta do BB LCA: "Nova transação" → compra de `R$ <valor>` → salva e volta ao detalhe com a posição atualizada (`R$ <valor>`, 2 transações); abrir a transação criada e excluir em dois toques → volta a `R$ <valor>`; "Editar cadastro" mostra `Modelo`/`Categoria` travados com o aviso âmbar; "Novo ativo" abre a gaveta em branco e "Cancelar" fecha.

- [ ] **Step 5: Conferir regressões de teclado e overflow**

Com a gaveta aberta: `Tab` não escapa para a lista (inércia do `<dialog>` nativo); `Esc` fecha; foco visível em cartões, transações e campos.

```js
document.documentElement.scrollWidth === window.innerWidth
```

Expected: `true` em 1280, 1024 e 900; cartões em 3/2/1 colunas conforme a largura; gaveta ocupa 100% em <640.

- [ ] **Step 6: Screenshots**

Salvar `.superpowers/sdd/pos-01-lista.png` (lista com grupos), `pos-02-gaveta.png` (gaveta do BB LCA) e `pos-03-transacao.png` (modo transação).

- [ ] **Step 7: Verificação da branch**

Run:

```bash
npm test && npm run typecheck && npm run build:web
```

Expected: 204 testes verdes, typecheck limpo, build ok.

- [ ] **Step 8: Docker (após o merge, no checkout principal)**

Run: `docker compose up -d --build` e `curl localhost:3000/api/health`
Expected: container `healthy`, health sem erro de fonte.

- [ ] **Step 9: Merge e `ROADMAP.md`**

Merge local na `main` (padrão do projeto), atualizar a tabela do `ROADMAP.md` com a etapa ("Redesign da tela de Posições — cartões, gaveta e formulários — concluída") e as evidências (números do aceite + screenshots), apontando a próxima ação.

```bash
git add ROADMAP.md
git commit -m "docs: anota o redesign da tela de posicoes no roadmap"
```

---

## Verificação final da branch

```bash
npm test && npm run typecheck && npm run build:web
```

Expected: 204 testes verdes (backend intocado), typecheck limpo, build ok. Depois: merge local na `main` e atualização do `ROADMAP.md`.
