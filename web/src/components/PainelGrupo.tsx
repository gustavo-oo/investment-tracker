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
        R$ 0,00 · resultado realizado{" "}
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
          {grupo.membros.length === 1 ? "posição encerrada" : "posições encerradas"} (R$ 0,00): resultado realizado {formataBRLSinal(grupo.resultadoRealizadoCents)}
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
