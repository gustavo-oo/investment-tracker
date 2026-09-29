import { useEffect, useState } from "react";
import { Trash } from "@phosphor-icons/react";
import { deleteInstrument, getInvestidores, patchInstrument, postInstrument, type Instrument, type InstrumentPayload } from "../api.ts";
import { formataCategoria, parsePercentualParaE6 } from "../format.ts";
import { Segmented } from "./Segmented.tsx";

const MODELOS: Array<{ id: string; rotulo: string; kind: Instrument["kind"]; category: string }> = [
  { id: "rf", rotulo: "Renda fixa", kind: "fixed_income", category: "cdb" },
  { id: "etf-rf", rotulo: "ETF RF", kind: "equity", category: "etf_fixed" },
  { id: "etf-rv", rotulo: "ETF RV", kind: "equity", category: "etf_equity" },
  { id: "pgbl", rotulo: "PGBL", kind: "pension", category: "pension_ipca" },
];

const CATEGORIAS_RF: Record<string, string> = { cdb: "CDB", lca: "LCA", selic: "Selic" };

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
  const [investidores, setInvestidores] = useState<string[]>([]);

  useEffect(() => {
    let ativo = true;
    getInvestidores().then((lista) => { if (ativo) setInvestidores(lista); }).catch(() => {});
    return () => { ativo = false; };
  }, []);

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
  const investidoresDoFormulario: string[] = instrumento !== null && instrumento.investor !== null && !investidores.includes(instrumento.investor)
    ? [instrumento.investor, ...investidores]
    : investidores;
  const opcoesInvestidor: Array<{ valor: string; rotulo: string }> = [
    { valor: "", rotulo: "—" },
    ...investidoresDoFormulario.map((valor) => ({ valor, rotulo: valor })),
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
            <input value={codigoCvm} onChange={(evento) => setCodigoCvm(evento.target.value)} placeholder="253210" />
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
