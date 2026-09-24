import { useEffect, useState } from "react";
import { Trash } from "@phosphor-icons/react";
import { deleteTransaction, patchTransaction, postTransaction, type PortfolioPosition, type Transaction } from "../api.ts";
import { parseMoedaParaCents, parseQuantidadeE8 } from "../format.ts";
import { Modal } from "./Modal.tsx";

function paraTextoBRL(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function FormTransacao({ aberto, posicao, transacao, onFechar, onSalvo }: {
  aberto: boolean;
  posicao: PortfolioPosition;
  transacao: Transaction | null;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const ehRF = posicao.kind === "fixed_income";
  const [data, setData] = useState("");
  const [tipo, setTipo] = useState<"BUY" | "SELL">("BUY");
  const [valor, setValor] = useState("");
  const [taxas, setTaxas] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [nota, setNota] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    setErro(null);
    setConfirmandoExclusao(false);
    setData(transacao?.tradeDate ?? hoje);
    setTipo(transacao?.kind === "SELL" ? "SELL" : "BUY");
    setValor(transacao === null ? "" : paraTextoBRL(transacao.grossCents));
    setTaxas(transacao === null || transacao.feesCents === 0 ? "" : paraTextoBRL(transacao.feesCents));
    setQuantidade(transacao?.quantityE8 == null ? "" : (Math.abs(transacao.quantityE8) / 1e8).toString().replace(".", ","));
    setNota(transacao?.note ?? "");
  }, [aberto, transacao]);

  async function salvar() {
    const grossCents = parseMoedaParaCents(valor);
    if (data === "") return setErro("informe a data");
    if (grossCents === null || grossCents === 0) return setErro("valor inválido");
    const feesCents = taxas.trim() === "" ? 0 : parseMoedaParaCents(taxas);
    if (feesCents === null) return setErro("taxas inválidas");
    const quantityE8 = ehRF ? null : parseQuantidadeE8(quantidade);
    if (!ehRF && quantityE8 === null) return setErro("quantidade inválida");
    setSalvando(true);
    setErro(null);
    try {
      const payload = { tradeDate: data, kind: tipo, grossCents, feesCents, quantityE8, note: nota.trim() === "" ? null : nota.trim() };
      if (transacao === null) await postTransaction(posicao.instrumentId, payload);
      else await patchTransaction(transacao.id, payload);
      onSalvo();
    } catch (cause) {
      setErro(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSalvando(false);
    }
  }

  async function excluir() {
    if (transacao === null) return;
    setSalvando(true);
    setErro(null);
    try {
      await deleteTransaction(transacao.id);
      onSalvo();
    } catch (cause) {
      setErro(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal aberto={aberto} titulo={transacao === null ? `Nova transação — ${posicao.name}` : `Editar transação — ${posicao.name}`} onFechar={onFechar}>
      <div className="form-grade">
        <label className="campo">
          <span className="stat-label">Data</span>
          <input type="date" value={data} onChange={(evento) => setData(evento.target.value)} />
        </label>
        <label className="campo">
          <span className="stat-label">Tipo</span>
          <select value={tipo} onChange={(evento) => setTipo(evento.target.value as "BUY" | "SELL")}>
            <option value="BUY">Compra</option>
            <option value="SELL">Resgate</option>
          </select>
        </label>
        <label className="campo">
          <span className="stat-label">Valor (R$)</span>
          <input inputMode="decimal" value={valor} onChange={(evento) => setValor(evento.target.value)} placeholder="1.234,56" />
        </label>
        <label className="campo">
          <span className="stat-label">Taxas (R$)</span>
          <input inputMode="decimal" value={taxas} onChange={(evento) => setTaxas(evento.target.value)} placeholder="0,00" />
        </label>
        {!ehRF && (
          <label className="campo">
            <span className="stat-label">Quantidade</span>
            <input inputMode="decimal" value={quantidade} onChange={(evento) => setQuantidade(evento.target.value)} placeholder="10,5" />
          </label>
        )}
        <label className="campo campo-largo">
          <span className="stat-label">Nota</span>
          <input value={nota} maxLength={200} onChange={(evento) => setNota(evento.target.value)} placeholder="opcional" />
        </label>
      </div>
      {erro !== null && <p className="campo-erro" role="alert">{erro}</p>}
      <div className="form-acoes">
        {transacao !== null && (
          confirmandoExclusao ? (
            <>
              <button type="button" className="btn btn-danger" disabled={salvando} onClick={() => void excluir()}>Confirmar exclusão</button>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmandoExclusao(false)}>Cancelar</button>
            </>
          ) : (
            <button type="button" className="btn btn-secondary" onClick={() => setConfirmandoExclusao(true)}>
              <Trash size={15} aria-hidden="true" /> Excluir
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
