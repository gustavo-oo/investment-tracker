import { useEffect, useState } from "react";
import { Trash } from "@phosphor-icons/react";
import {
  deleteInstrument, patchInstrument, postInstrument,
  type Instrument, type InstrumentPayload,
} from "../api.ts";
import { parsePercentualParaE6 } from "../format.ts";
import { Modal } from "./Modal.tsx";

const MODELOS: Array<{ id: string; rotulo: string; kind: Instrument["kind"]; category: string; benchmark: string | null }> = [
  { id: "rf", rotulo: "Renda fixa", kind: "fixed_income", category: "cdb", benchmark: "CDI" },
  { id: "etf-rf", rotulo: "ETF Renda Fixa", kind: "equity", category: "etf_fixed", benchmark: null },
  { id: "etf-rv", rotulo: "ETF Renda Variável", kind: "equity", category: "etf_equity", benchmark: null },
  { id: "pgbl", rotulo: "Previdência PGBL", kind: "pension", category: "pension_ipca", benchmark: null },
];

const CATEGORIAS_RF: Record<string, string> = { cdb: "CDB", lca: "LCA", selic: "Selic" };

export function FormAtivo({ aberto, instrumento, qtdTransacoes, onFechar, onSalvo }: {
  aberto: boolean;
  instrumento: Instrument | null;
  qtdTransacoes: number;
  onFechar: () => void;
  onSalvo: () => void;
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
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);

  useEffect(() => {
    if (!aberto) return;
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
  }, [aberto, instrumento]);

  const definicao = MODELOS.find((item) => item.id === modelo) ?? MODELOS[0];
  const ehRF = definicao.kind === "fixed_income";

  async function salvar() {
    const payload: InstrumentPayload = {
      name: nome.trim(),
      kind: definicao.kind,
      category: ehRF ? categoria : definicao.category,
      benchmark: null, rateE6: null, maturityDate: null, ticker: null, quoteSymbol: null,
      liquidity: liquidez.trim() === "" ? null : liquidez.trim(),
      broker: corretora.trim() === "" ? null : corretora.trim(),
      objective: objetivo.trim() === "" ? null : objetivo.trim(),
      investor: investidor === "" ? null : investidor,
    };
    if (payload.name === "") return setErro("informe o nome");
    if (ehRF) {
      const rateE6 = parsePercentualParaE6(rentabilidade);
      if (rateE6 === null) return setErro("rentabilidade inválida (ex.: 105 ou 105,5)");
      payload.benchmark = benchmark;
      payload.rateE6 = rateE6;
      payload.maturityDate = vencimento === "" ? null : vencimento;
    } else if (definicao.kind === "equity") {
      if (ticker.trim() === "") return setErro("informe o ticker");
      payload.ticker = ticker.trim().toUpperCase();
    } else {
      if (codigoCvm.trim() === "") return setErro("informe o código CVM");
      payload.quoteSymbol = codigoCvm.trim();
    }
    setSalvando(true);
    setErro(null);
    try {
      if (instrumento === null) await postInstrument(payload);
      else await patchInstrument(instrumento.id, payload);
      onSalvo();
    } catch (cause) {
      setErro(cause instanceof Error ? cause.message : String(cause));
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
      onSalvo();
    } catch (cause) {
      setErro(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal aberto={aberto} titulo={instrumento === null ? "Novo ativo" : `Editar cadastro — ${instrumento.name}`} onFechar={onFechar}>
      <div className="form-grade">
        <label className="campo">
          <span className="stat-label">Modelo</span>
          <select value={modelo} onChange={(evento) => {
            const novo = evento.target.value;
            setModelo(novo);
            if (novo === "rf" && !(categoria in CATEGORIAS_RF)) setCategoria("cdb");
          }} disabled={temTransacoes}>
            {MODELOS.map((item) => <option key={item.id} value={item.id}>{item.rotulo}</option>)}
          </select>
        </label>
        {ehRF && (
          <label className="campo">
            <span className="stat-label">Categoria</span>
            <select value={categoria} onChange={(evento) => setCategoria(evento.target.value)} disabled={temTransacoes}>
              {Object.entries(CATEGORIAS_RF).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
            </select>
          </label>
        )}
        <label className="campo campo-largo">
          <span className="stat-label">Nome</span>
          <input value={nome} onChange={(evento) => setNome(evento.target.value)} placeholder="CDB Banco X 2029" />
        </label>
        {definicao.kind === "equity" && (
          <label className="campo">
            <span className="stat-label">Ticker</span>
            <input value={ticker} onChange={(evento) => setTicker(evento.target.value)} placeholder="WRLD11" />
          </label>
        )}
        {definicao.kind === "pension" && (
          <label className="campo">
            <span className="stat-label">Código CVM</span>
            <input value={codigoCvm} onChange={(evento) => setCodigoCvm(evento.target.value)} placeholder="253210" />
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
              <span className="stat-label">Rentabilidade (%)</span>
              <input inputMode="decimal" value={rentabilidade} onChange={(evento) => setRentabilidade(evento.target.value)} placeholder="105" />
            </label>
            <label className="campo">
              <span className="stat-label">Vencimento</span>
              <input type="date" value={vencimento} onChange={(evento) => setVencimento(evento.target.value)} />
            </label>
          </>
        )}
        <label className="campo"><span className="stat-label">Liquidez</span><input value={liquidez} onChange={(evento) => setLiquidez(evento.target.value)} placeholder="Diário" /></label>
        <label className="campo"><span className="stat-label">Corretora</span><input value={corretora} onChange={(evento) => setCorretora(evento.target.value)} /></label>
        <label className="campo"><span className="stat-label">Objetivo</span><input value={objetivo} onChange={(evento) => setObjetivo(evento.target.value)} /></label>
        <label className="campo">
          <span className="stat-label">Investidor</span>
          <select value={investidor} onChange={(evento) => setInvestidor(evento.target.value)}>
            <option value="">—</option>
            <option value="Ana">Ana</option>
            <option value="Beto">Beto</option>
          </select>
        </label>
      </div>
      {temTransacoes && (
        <span className="stat-note">
          Classe/categoria travadas e exclusão indisponível: o ativo já tem {qtdTransacoes} transações.
        </span>
      )}
      {erro !== null && <p className="campo-erro" role="alert">{erro}</p>}
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
        <button type="button" className="btn" disabled={salvando} onClick={() => void salvar()}>
          {salvando ? "Salvando..." : "Salvar"}
        </button>
      </div>
    </Modal>
  );
}
