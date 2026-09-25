import { useEffect, useMemo, useState } from "react";
import { MagnifyingGlass, Plus, Table } from "@phosphor-icons/react";
import { getInstruments, getPortfolio, getTransactions, type Instrument, type PortfolioPosition, type Transaction } from "../api.ts";
import { formataBRL, formataBRLSinal, formataPercentualSinal } from "../format.ts";
import { COR_DA_CLASSE, ORDEM_CLASSE, ROTULO_CLASSE, classeDe, type Classe } from "../classes.ts";
import { FormAtivo } from "../components/FormAtivo.tsx";
import { FormTransacao } from "../components/FormTransacao.tsx";
import { Gaveta } from "../components/Gaveta.tsx";
import { PainelAtivo } from "../components/PainelAtivo.tsx";
import { PainelGrupo } from "../components/PainelGrupo.tsx";
import { CartaoAtivo } from "../components/CartaoAtivo.tsx";
import { agruparPosicoes, capitalDe, chaveDoGrupo, rendimentoDe, type GrupoPosicoes } from "../posicoes.ts";

type Ordem = "valor" | "nome" | "rendimento" | "rendimentoPct" | "pct";

type EstadoGaveta =
  | { tipo: "detalhe" }
  | { tipo: "transacao"; transacao: Transaction | null }
  | { tipo: "cadastro"; instrumento: Instrument | null; qtdTransacoes: number }
  | { tipo: "grupo"; chave: string };

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
  const [origemGrupo, setOrigemGrupo] = useState<string | null>(null);
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
        setGaveta((atual) => {
          if (atual === null || atual.tipo !== "grupo") return atual;
          return portfolio.positions.some((posicao) => chaveDoGrupo(posicao) === atual.chave) ? atual : null;
        });
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

  const rendimentoTotal = (posicoes ?? []).reduce((soma, posicao) => soma + (rendimentoDe(posicao).cents ?? 0), 0);
  const capitalTotal = (posicoes ?? []).reduce((soma, posicao) => soma + capitalDe(posicao), 0);
  const rendimentoPctTotal = capitalTotal > 0 ? (rendimentoTotal / capitalTotal) * 100 : null;

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

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Posições</h1>
          <p className="page-sub resumo-itens">
            <span>{visiveis.length} de {(posicoes ?? []).length} ativos</span>
            <span>valor total {formataBRL(total)}</span>
            <span className={rendimentoTotal >= 0 ? "rendimento-positivo" : "rendimento-negativo"}>
              rendimento {formataBRLSinal(rendimentoTotal)}
              {rendimentoPctTotal === null ? "" : ` (${formataPercentualSinal(rendimentoPctTotal)})`}
            </span>
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
        <>
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

          {gruposEncerrados.length > 0 && (
            <details className="encerradas">
              <summary>
                <span className="encerradas-resumo">
                  {encerradas.length} {encerradas.length === 1 ? "posição encerrada" : "posições encerradas"}
                  {gruposEncerrados.length > 1 ? ` em ${gruposEncerrados.length} grupos` : ""} (R$ 0,00) · resultado realizado{" "}
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
        </>
      )}

      {podeRenderizarGaveta && gaveta !== null && (
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
    </div>
  );
}
