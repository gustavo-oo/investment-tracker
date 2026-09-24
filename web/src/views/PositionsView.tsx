import { useEffect, useMemo, useState } from "react";
import { CaretDown, CaretUp, MagnifyingGlass, PencilSimple, Plus, Table, X } from "@phosphor-icons/react";
import { getInstruments, getPortfolio, getTransactions, type Instrument, type PortfolioPosition, type Transaction } from "../api.ts";
import { formataBRL, formataCategoria, formataData, formataMes, formataPercentualSinal, formataQuantidade } from "../format.ts";
import { ORDEM_CLASSE, ROTULO_CLASSE, classeDe, type Classe } from "../classes.ts";
import { FormAtivo } from "../components/FormAtivo.tsx";
import { FormTransacao } from "../components/FormTransacao.tsx";

type Ordem = "valor" | "nome" | "rendimento" | "rendimentoPct" | "pct";

function rendimentoDe(posicao: PortfolioPosition): { cents: number | null; pct: number | null } {
  if (posicao.marketValueCents === null) return { cents: null, pct: null };
  const capital = posicao.investedCents - posicao.redeemedCents;
  const cents = posicao.marketValueCents - capital;
  return { cents, pct: capital > 0 ? (cents / capital) * 100 : null };
}

function precoMedio(transacao: Transaction): string {
  if (transacao.quantityE8 === null || transacao.quantityE8 === 0) return "—";
  return formataBRL(Math.round(transacao.grossCents / (transacao.quantityE8 / 1e8)));
}

const ROTULO_OPERACAO: Record<string, string> = { BUY: "Compra", SELL: "Venda", AMORTIZATION: "Amortização", INTEREST: "Juros", DIVIDEND: "Dividendo" };

export function PositionsView({ reloadToken, filtroInicial }: {
  reloadToken: number; filtroInicial: Classe | null;
}) {
  const [posicoes, setPosicoes] = useState<PortfolioPosition[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [classe, setClasse] = useState<Classe | "todos">(filtroInicial ?? "todos");
  const [corretora, setCorretora] = useState("todas");
  const [objetivo, setObjetivo] = useState("todos");
  const [investidor, setInvestidor] = useState("todos");
  const [ordem, setOrdem] = useState<Ordem>("valor");
  const [selecionada, setSelecionada] = useState<PortfolioPosition | null>(null);
  const [transacoes, setTransacoes] = useState<Transaction[] | null>(null);
  const [recargaLocal, setRecargaLocal] = useState(0);
  const [formAtivo, setFormAtivo] = useState<{ instrumento: Instrument | null; qtdTransacoes: number } | null>(null);
  const [formTransacao, setFormTransacao] = useState<{ transacao: Transaction | null } | null>(null);

  useEffect(() => {
    setClasse(filtroInicial ?? "todos");
  }, [filtroInicial]);

  useEffect(() => {
    const controller = new AbortController();
    getPortfolio(controller.signal)
      .then((portfolio) => {
        setPosicoes(portfolio.positions);
        setSelecionada((atual) => atual === null
          ? null
          : portfolio.positions.find((posicao) => posicao.instrumentId === atual.instrumentId) ?? null);
        setErro(null);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setErro(cause instanceof Error ? cause.message : String(cause));
      });
    return () => controller.abort();
  }, [reloadToken, recargaLocal]);

  useEffect(() => {
    if (selecionada === null) return;
    const controller = new AbortController();
    setTransacoes(null);
    getTransactions(selecionada.instrumentId, controller.signal)
      .then(setTransacoes)
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setTransacoes([]);
      });
    return () => controller.abort();
  }, [selecionada?.instrumentId, recargaLocal]);

  const corretoras = useMemo(() => [...new Set((posicoes ?? []).map((posicao) => posicao.broker ?? "—"))].sort(), [posicoes]);
  const objetivos = useMemo(() => [...new Set((posicoes ?? []).map((posicao) => posicao.objective ?? "—"))].sort(), [posicoes]);
  const investidores = useMemo(
    () => [...new Set((posicoes ?? []).map((posicao) => posicao.investor ?? "—"))].sort(),
    [posicoes],
  );

  useEffect(() => {
    if (investidor !== "todos" && !investidores.includes(investidor)) setInvestidor("todos");
  }, [investidores, investidor]);

  function abrirAtivo(posicao: PortfolioPosition) {
    setSelecionada(posicao);
  }

  function concluirMutacao() {
    setFormTransacao(null);
    setFormAtivo(null);
    setRecargaLocal((valor) => valor + 1);
  }

  function novoAtivo() {
    setFormAtivo({ instrumento: null, qtdTransacoes: 0 });
  }

  async function editarAtivo() {
    if (selecionada === null || transacoes === null) return;
    try {
      const instrumentos = await getInstruments();
      const instrumento = instrumentos.find((item) => item.id === selecionada.instrumentId) ?? null;
      setFormAtivo({ instrumento, qtdTransacoes: (transacoes ?? []).length });
    } catch (cause) {
      setErro(cause instanceof Error ? cause.message : String(cause));
    }
  }

  const total = (posicoes ?? []).reduce((soma, posicao) => soma + (posicao.marketValueCents ?? 0), 0);

  const visiveis = (posicoes ?? [])
    .filter((posicao) => posicao.name.toLowerCase().includes(busca.trim().toLowerCase()))
    .filter((posicao) => classe === "todos" || classeDe(posicao) === classe)
    .filter((posicao) => corretora === "todas" || (posicao.broker ?? "—") === corretora)
    .filter((posicao) => objetivo === "todos" || (posicao.objective ?? "—") === objetivo)
    .filter((posicao) => investidor === "todos" || (posicao.investor ?? "—") === investidor)
    .sort((a, b) => {
      if (ordem === "nome") return a.name.localeCompare(b.name, "pt-BR");
      if (ordem === "rendimento") return (rendimentoDe(b).cents ?? -Infinity) - (rendimentoDe(a).cents ?? -Infinity);
      if (ordem === "rendimentoPct") return (rendimentoDe(b).pct ?? -Infinity) - (rendimentoDe(a).pct ?? -Infinity);
      if (ordem === "pct") return (b.marketValueCents ?? 0) - (a.marketValueCents ?? 0);
      return (b.marketValueCents ?? 0) - (a.marketValueCents ?? 0);
    });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Posições</h1>
          <p className="page-sub resumo-itens">
            <span>{visiveis.length} de {(posicoes ?? []).length} ativos</span>
            <span>valor total {formataBRL(total)}</span>
          </p>
        </div>
        <div className="page-head-actions">
          <button type="button" className="btn" onClick={() => void novoAtivo()}>
            <Plus size={15} aria-hidden="true" /> Novo ativo
          </button>
        </div>
      </div>

      {erro !== null && <div className="callout callout-error" role="alert"><p>{erro}</p></div>}

      <div className="card filtros">
        <label className="campo">
          <span className="stat-label">Busca</span>
          <span className="campo-com-icone">
            <MagnifyingGlass size={15} aria-hidden="true" />
            <input value={busca} onChange={(evento) => setBusca(evento.target.value)} placeholder="Nome do ativo" />
          </span>
        </label>
        <label className="campo">
          <span className="stat-label">Tipo</span>
          <select value={classe} onChange={(evento) => setClasse(evento.target.value as Classe | "todos")}>
            <option value="todos">Todos</option>
            {ORDEM_CLASSE.map((valor) => <option key={valor} value={valor}>{ROTULO_CLASSE[valor]}</option>)}
          </select>
        </label>
        <label className="campo">
          <span className="stat-label">Corretora</span>
          <select value={corretora} onChange={(evento) => setCorretora(evento.target.value)}>
            <option value="todas">Todas</option>
            {corretoras.map((valor) => <option key={valor} value={valor}>{valor}</option>)}
          </select>
        </label>
        <label className="campo">
          <span className="stat-label">Objetivo</span>
          <select value={objetivo} onChange={(evento) => setObjetivo(evento.target.value)}>
            <option value="todos">Todos</option>
            {objetivos.map((valor) => <option key={valor} value={valor}>{valor}</option>)}
          </select>
        </label>
        <label className="campo">
          <span className="stat-label">Investidor</span>
          <select value={investidor} onChange={(evento) => setInvestidor(evento.target.value)}>
            <option value="todos">Todos</option>
            {investidores.map((valor) => <option key={valor} value={valor}>{valor}</option>)}
          </select>
        </label>
        <label className="campo">
          <span className="stat-label">Ordenar por</span>
          <select value={ordem} onChange={(evento) => setOrdem(evento.target.value as Ordem)}>
            <option value="valor">Valor (↓)</option>
            <option value="nome">Nome</option>
            <option value="rendimento">Rendimento (R$)</option>
            <option value="rendimentoPct">Rendimento (%)</option>
            <option value="pct">% da carteira</option>
          </select>
        </label>
      </div>

      {visiveis.length === 0 ? (
        <div className="empty">
          <Table size={22} aria-hidden="true" />
          <p className="empty-title">Nenhum ativo</p>
          <p className="empty-hint">Ajuste os filtros ou crie um ativo em Novo ativo.</p>
        </div>
      ) : (
        <div className="table-wrap card">
          <table>
            <caption className="sr-only">Posições da carteira</caption>
            <thead>
              <tr>
                <th scope="col">Ativo</th>
                <th scope="col">Setor</th>
                <th scope="col" className="num">Valor</th>
                <th scope="col" className="num">%</th>
                <th scope="col" className="num">Rendimento</th>
                <th scope="col" className="num">Rend. %</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((posicao) => {
                const rendimento = rendimentoDe(posicao);
                return (
                  <tr key={posicao.instrumentId} onClick={() => abrirAtivo(posicao)} className="linha-clicavel">
                    <td>
                      {posicao.name}
                      {posicao.stale && <span className="badge badge-warn">desatualizado</span>}
                      {posicao.pendingRedemption && (
                        <span className="badge badge-warn">
                          {posicao.maturityDate === null ? "vencido · resgate pendente" : `vencido em ${formataData(posicao.maturityDate)} · resgate pendente`}
                        </span>
                      )}
                    </td>
                    <td>{ROTULO_CLASSE[classeDe(posicao)]}</td>
                    <td className="num">{posicao.marketValueCents === null ? "—" : formataBRL(posicao.marketValueCents)}</td>
                    <td className="num">{total > 0 && posicao.marketValueCents !== null ? formataPercentualSinal((posicao.marketValueCents / total) * 100) : "—"}</td>
                    <td className={`num ${rendimento.cents === null ? "" : rendimento.cents >= 0 ? "rendimento-positivo" : "rendimento-negativo"}`}>
                      {rendimento.cents === null ? "—" : (
                        <span className="delta-inline">
                          {rendimento.cents >= 0 ? <CaretUp size={11} aria-hidden="true" /> : <CaretDown size={11} aria-hidden="true" />}
                          {formataBRL(rendimento.cents)}
                        </span>
                      )}
                    </td>
                    <td className={`num ${rendimento.pct === null ? "" : rendimento.pct >= 0 ? "rendimento-positivo" : "rendimento-negativo"}`}>
                      {rendimento.pct === null ? "—" : formataPercentualSinal(rendimento.pct)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selecionada !== null && (
        <aside className="painel-ativo" aria-label={`Detalhes de ${selecionada.name}`}>
          <div className="section-head">
            <h2 className="section-title">{selecionada.name}</h2>
            <button type="button" className="btn btn-secondary" disabled={transacoes === null} onClick={() => void editarAtivo()}>
              <PencilSimple size={15} aria-hidden="true" /> Editar cadastro
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setSelecionada(null)}>
              <X size={15} /> Fechar
            </button>
          </div>
          <p className="tags">
            <span className="chip">{formataCategoria(selecionada.category)}</span>
            <span className="chip">{selecionada.broker ?? "—"}</span>
            <span className="chip">{ROTULO_CLASSE[classeDe(selecionada)]}</span>
            <span className="chip">{selecionada.investor ?? "sem investidor"}</span>
          </p>
          <div className="stats">
            <div className="stat"><span className="stat-label">Valor</span><span className="stat-value">{selecionada.marketValueCents === null ? "—" : formataBRL(selecionada.marketValueCents)}</span></div>
            <div className="stat"><span className="stat-label">Quantidade</span><span className="stat-value">{selecionada.quantityE8 === null ? "—" : formataQuantidade(selecionada.quantityE8)}</span></div>
            <div className="stat"><span className="stat-label">Preço</span><span className="stat-value">{selecionada.priceCents === null ? "—" : formataBRL(selecionada.priceCents)}</span></div>
            <div className="stat"><span className="stat-label">Preço em</span><span className="stat-value">{selecionada.priceDate === null ? "—" : formataMes(selecionada.priceDate.slice(0, 7))}</span></div>
          </div>
          <div className="section-head section-head-linha">
            <h3 className="section-title">Transações</h3>
            <button type="button" className="btn btn-secondary" onClick={() => setFormTransacao({ transacao: null })}>
              <Plus size={15} aria-hidden="true" /> Nova transação
            </button>
          </div>
          {transacoes === null ? (
            <p className="section-hint">Carregando...</p>
          ) : transacoes.length === 0 ? (
            <p className="section-hint">Sem transações registradas.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th scope="col">Data</th><th scope="col">Tipo</th><th scope="col" className="num">Qtd.</th><th scope="col" className="num">Preço</th><th scope="col" className="num">Valor</th><th scope="col" className="num">Taxas</th></tr>
                </thead>
                <tbody>
                  {transacoes.map((transacao) => (
                    <tr key={transacao.id} onClick={() => setFormTransacao({ transacao })} className="linha-clicavel">
                      <td>{formataData(transacao.tradeDate)}</td>
                      <td>{ROTULO_OPERACAO[transacao.kind] ?? transacao.kind}</td>
                      <td className="num">{transacao.quantityE8 === null ? "—" : formataQuantidade(transacao.quantityE8)}</td>
                      <td className="num">{precoMedio(transacao)}</td>
                      <td className="num">{formataBRL(transacao.grossCents)}</td>
                      <td className="num">{formataBRL(transacao.feesCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </aside>
      )}

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
    </div>
  );
}
