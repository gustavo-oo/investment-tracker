import { PencilSimple, Plus } from "@phosphor-icons/react";
import type { PortfolioPosition, Transaction } from "../api.ts";
import { formataBRL, formataBRLSinal, formataCategoria, formataData, formataPercentualSinal, formataQuantidade } from "../format.ts";
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

export function PainelAtivo({ posicao, totalCents, transacoes, onNovaTransacao, onEditarTransacao, onEditarCadastro, onVoltarGrupo }: {
  posicao: PortfolioPosition;
  totalCents: number;
  transacoes: Transaction[] | null;
  onNovaTransacao: () => void;
  onEditarTransacao: (transacao: Transaction) => void;
  onEditarCadastro: () => void;
  onVoltarGrupo?: () => void;
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
      <div className="gaveta-cabecalho gaveta-cabecalho-linha">
        <div className="gaveta-cabecalho-titulo">
          <span className="painel-ponto" style={{ background: cor }} aria-hidden="true" />
          <h2 className="gaveta-titulo">{posicao.name}</h2>
        </div>
        {onVoltarGrupo !== undefined && (
          <button type="button" className="btn-voltar" onClick={onVoltarGrupo}>‹ Voltar ao grupo</button>
        )}
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
          {rendimento.cents >= 0 ? "▲" : "▼"} {formataBRLSinal(rendimento.cents)}
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
        <button type="button" className="btn btn-secondary" disabled={transacoes === null} onClick={onEditarCadastro}>
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
