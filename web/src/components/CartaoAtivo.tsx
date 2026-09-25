import type { PortfolioPosition } from "../api.ts";
import { formataBRL, formataBRLSinal, formataCategoria, formataData, formataPercentualSinal, formataQuantidade } from "../format.ts";
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
  meta.push(posicao.investor === null || posicao.investor === "" ? "sem investidor" : posicao.investor);
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
          {rendimento.cents >= 0 ? "▲" : "▼"} {formataBRLSinal(rendimento.cents)}
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
