import { useEffect, useMemo, useState } from "react";
import { MagnifyingGlass, Table, X } from "@phosphor-icons/react";
import { getPortfolio, getTransactions, type PortfolioPosition, type Transaction } from "../api.ts";
import { formataBRL, formataCategoria, formataDataHora, formataMes, formataPercentualSinal, formataQuantidade } from "../format.ts";

type Ordem = "valor" | "nome" | "rendimento" | "rendimentoPct" | "pct";

function rendimentoDe(posicao: PortfolioPosition): { cents: number; pct: number | null } {
  const capital = posicao.investedCents - posicao.redeemedCents;
  const cents = (posicao.marketValueCents ?? 0) - capital;
  return { cents, pct: capital > 0 ? (cents / capital) * 100 : null };
}

function precoMedio(transacao: Transaction): string {
  if (transacao.quantityE8 === null || transacao.quantityE8 === 0) return "—";
  return formataBRL(Math.round(transacao.grossCents / (transacao.quantityE8 / 1e8)));
}

const ROTULO_KIND: Record<string, string> = { fixed_income: "Renda fixa", equity: "Renda variável", pension: "Previdência" };
const ROTULO_OPERACAO: Record<string, string> = { BUY: "Compra", SELL: "Venda", AMORTIZATION: "Amortização", INTEREST: "Juros", DIVIDEND: "Dividendo" };

export function PositionsView({ reloadToken, filtroInicial }: {
  reloadToken: number; filtroInicial: PortfolioPosition["kind"] | null;
}) {
  const [posicoes, setPosicoes] = useState<PortfolioPosition[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [kind, setKind] = useState<PortfolioPosition["kind"] | "todos">(filtroInicial ?? "todos");
  const [corretora, setCorretora] = useState("todas");
  const [objetivo, setObjetivo] = useState("todos");
  const [ordem, setOrdem] = useState<Ordem>("valor");
  const [selecionada, setSelecionada] = useState<PortfolioPosition | null>(null);
  const [transacoes, setTransacoes] = useState<Transaction[] | null>(null);

  useEffect(() => {
    setKind(filtroInicial ?? "todos");
  }, [filtroInicial]);

  useEffect(() => {
    const controller = new AbortController();
    getPortfolio(controller.signal)
      .then((portfolio) => { setPosicoes(portfolio.positions); setErro(null); })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setErro(cause instanceof Error ? cause.message : String(cause));
      });
    return () => controller.abort();
  }, [reloadToken]);

  useEffect(() => {
    if (selecionada === null) return;
    const controller = new AbortController();
    setTransacoes(null);
    getTransactions(selecionada.instrumentId, controller.signal)
      .then(setTransacoes)
      .catch(() => setTransacoes([]));
    return () => controller.abort();
  }, [selecionada]);

  const corretoras = useMemo(() => [...new Set((posicoes ?? []).map((posicao) => posicao.broker ?? "—"))].sort(), [posicoes]);
  const objetivos = useMemo(() => [...new Set((posicoes ?? []).map((posicao) => posicao.objective ?? "—"))].sort(), [posicoes]);
  const total = (posicoes ?? []).reduce((soma, posicao) => soma + (posicao.marketValueCents ?? 0), 0);

  const visiveis = (posicoes ?? [])
    .filter((posicao) => posicao.name.toLowerCase().includes(busca.trim().toLowerCase()))
    .filter((posicao) => kind === "todos" || posicao.kind === kind)
    .filter((posicao) => corretora === "todas" || (posicao.broker ?? "—") === corretora)
    .filter((posicao) => objetivo === "todos" || (posicao.objective ?? "—") === objetivo)
    .sort((a, b) => {
      if (ordem === "nome") return a.name.localeCompare(b.name, "pt-BR");
      if (ordem === "rendimento") return rendimentoDe(b).cents - rendimentoDe(a).cents;
      if (ordem === "rendimentoPct") return (rendimentoDe(b).pct ?? -Infinity) - (rendimentoDe(a).pct ?? -Infinity);
      if (ordem === "pct") return (b.marketValueCents ?? 0) - (a.marketValueCents ?? 0);
      return (b.marketValueCents ?? 0) - (a.marketValueCents ?? 0);
    });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Posições</h1>
          <p className="page-sub">{visiveis.length} de {(posicoes ?? []).length} ativos · valor total {formataBRL(total)}</p>
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
          <select value={kind} onChange={(evento) => setKind(evento.target.value as PortfolioPosition["kind"] | "todos")}>
            <option value="todos">Todos</option>
            <option value="fixed_income">Renda fixa</option>
            <option value="equity">Renda variável</option>
            <option value="pension">Previdência</option>
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
          <p className="empty-hint">Ajuste os filtros ou importe a planilha em Importar.</p>
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
              </tr>
            </thead>
            <tbody>
              {visiveis.map((posicao) => {
                const rendimento = rendimentoDe(posicao);
                return (
                  <tr key={posicao.instrumentId} onClick={() => setSelecionada(posicao)} className="linha-clicavel">
                    <td>
                      {posicao.name}
                      {posicao.stale && <span className="badge badge-warn">desatualizado</span>}
                    </td>
                    <td>{ROTULO_KIND[posicao.kind] ?? posicao.kind}</td>
                    <td className="num">{posicao.marketValueCents === null ? "—" : formataBRL(posicao.marketValueCents)}</td>
                    <td className="num">{total > 0 && posicao.marketValueCents !== null ? formataPercentualSinal((posicao.marketValueCents / total) * 100) : "—"}</td>
                    <td className={`num ${rendimento.cents >= 0 ? "rendimento-positivo" : "rendimento-negativo"}`}>
                      {formataBRL(rendimento.cents)}{rendimento.pct === null ? "" : ` (${formataPercentualSinal(rendimento.pct)})`}
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
            <button type="button" className="btn btn-secondary" onClick={() => setSelecionada(null)}>
              <X size={15} /> Fechar
            </button>
          </div>
          <p className="section-hint">
            {formataCategoria(selecionada.category)} · {selecionada.broker ?? "—"} · {ROTULO_KIND[selecionada.kind] ?? selecionada.kind}
          </p>
          <div className="stats">
            <div className="stat"><span className="stat-label">Valor</span><span className="stat-value">{selecionada.marketValueCents === null ? "—" : formataBRL(selecionada.marketValueCents)}</span></div>
            <div className="stat"><span className="stat-label">Quantidade</span><span className="stat-value">{selecionada.quantityE8 === null ? "—" : formataQuantidade(selecionada.quantityE8)}</span></div>
            <div className="stat"><span className="stat-label">Preço</span><span className="stat-value">{selecionada.priceCents === null ? "—" : formataBRL(selecionada.priceCents)}</span></div>
            <div className="stat"><span className="stat-label">Preço em</span><span className="stat-value">{selecionada.priceDate === null ? "—" : formataMes(selecionada.priceDate.slice(0, 7))}</span></div>
          </div>
          <h3 className="section-title">Transações</h3>
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
                  {transacoes.map((transacao, index) => (
                    <tr key={index}>
                      <td>{formataDataHora(`${transacao.tradeDate} 00:00:00`)}</td>
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
    </div>
  );
}
