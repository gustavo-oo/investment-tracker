import { useEffect, useMemo, useState } from "react";
import { CaretDown, CaretUp, MagnifyingGlass, Plus, Table } from "@phosphor-icons/react";
import { getInstruments, getPortfolio, getTransactions, type Instrument, type PortfolioPosition, type Transaction } from "../api.ts";
import { formataBRL, formataData, formataPercentualSinal } from "../format.ts";
import { ORDEM_CLASSE, ROTULO_CLASSE, classeDe, type Classe } from "../classes.ts";
import { FormAtivo } from "../components/FormAtivo.tsx";
import { FormTransacao } from "../components/FormTransacao.tsx";
import { Gaveta } from "../components/Gaveta.tsx";
import { PainelAtivo } from "../components/PainelAtivo.tsx";

type Ordem = "valor" | "nome" | "rendimento" | "rendimentoPct" | "pct";

type EstadoGaveta =
  | { tipo: "detalhe" }
  | { tipo: "transacao"; transacao: Transaction | null }
  | { tipo: "cadastro"; instrumento: Instrument | null; qtdTransacoes: number };

function rendimentoDe(posicao: PortfolioPosition): { cents: number | null; pct: number | null } {
  if (posicao.marketValueCents === null) return { cents: null, pct: null };
  const capital = posicao.investedCents - posicao.redeemedCents;
  const cents = posicao.marketValueCents - capital;
  return { cents, pct: capital > 0 ? (cents / capital) * 100 : null };
}

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
  const [gaveta, setGaveta] = useState<EstadoGaveta | null>(null);
  const [sugestoesLiquidez, setSugestoesLiquidez] = useState<string[]>([]);
  const [transacoes, setTransacoes] = useState<Transaction[] | null>(null);
  const [recargaLocal, setRecargaLocal] = useState(0);

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

  const corretoras = useMemo(
    () => [...new Set((posicoes ?? []).map((posicao) => posicao.broker).filter((valor): valor is string => valor !== null && valor !== ""))].sort(),
    [posicoes],
  );
  const objetivos = useMemo(
    () => [...new Set((posicoes ?? []).map((posicao) => posicao.objective).filter((valor): valor is string => valor !== null && valor !== ""))].sort(),
    [posicoes],
  );
  const investidores = useMemo(
    () => [...new Set((posicoes ?? []).map((posicao) => posicao.investor ?? "—"))].sort(),
    [posicoes],
  );

  useEffect(() => {
    if (investidor !== "todos" && !investidores.includes(investidor)) setInvestidor("todos");
  }, [investidores, investidor]);

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

      {gaveta !== null && (gaveta.tipo === "cadastro" || selecionada !== null) && (
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
    </div>
  );
}
