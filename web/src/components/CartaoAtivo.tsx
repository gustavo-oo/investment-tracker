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
