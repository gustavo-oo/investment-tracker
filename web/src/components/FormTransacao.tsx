import { useEffect, useState } from "react";
import { Trash } from "@phosphor-icons/react";
import { deleteTransaction, patchTransaction, postTransaction, type PortfolioPosition, type Transaction } from "../api.ts";
import { formataBRL, parseMoedaParaCents, parseQuantidadeE8 } from "../format.ts";
import { Segmented } from "./Segmented.tsx";
import { taxaTexto } from "./PainelAtivo.tsx";

function paraTextoBRL(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

type CampoComErro = "data" | "valor" | "taxas" | "quantidade" | "geral";

export function FormTransacao({ posicao, transacao, onVoltar, onConcluir }: {
  posicao: PortfolioPosition;
  transacao: Transaction | null;
  onVoltar: () => void;
  onConcluir: () => void;
}) {
  const ehRF = posicao.kind === "fixed_income";
  const [data, setData] = useState("");
  const [tipo, setTipo] = useState<"BUY" | "SELL">("BUY");
  const [valor, setValor] = useState("");
  const [taxas, setTaxas] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [nota, setNota] = useState("");
  const [erro, setErro] = useState<{ campo: CampoComErro; mensagem: string } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);

  useEffect(() => {
    const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    setErro(null);
    setConfirmandoExclusao(false);
    setData(transacao?.tradeDate ?? hoje);
    setTipo(transacao?.kind === "SELL" ? "SELL" : "BUY");
    setValor(transacao === null ? "" : paraTextoBRL(transacao.grossCents));
    setTaxas(transacao === null || transacao.feesCents === 0 ? "" : paraTextoBRL(transacao.feesCents));
    setQuantidade(transacao?.quantityE8 == null ? "" : (Math.abs(transacao.quantityE8) / 1e8).toString().replace(".", ","));
    setNota(transacao?.note ?? "");
  }, [posicao.instrumentId, transacao]);

  async function salvar() {
    if (data === "") return setErro({ campo: "data", mensagem: "informe a data" });
    const grossCents = parseMoedaParaCents(valor);
    if (grossCents === null || grossCents === 0) return setErro({ campo: "valor", mensagem: "valor inválido (ex.: 1.234,56)" });
    const feesCents = taxas.trim() === "" ? 0 : parseMoedaParaCents(taxas);
    if (feesCents === null) return setErro({ campo: "taxas", mensagem: "taxas inválidas (ex.: 12,50)" });
    const quantityE8 = ehRF ? null : parseQuantidadeE8(quantidade);
    if (!ehRF && quantityE8 === null) return setErro({ campo: "quantidade", mensagem: "quantidade inválida (ex.: 10,5)" });
    setSalvando(true);
    setErro(null);
    try {
      const payload = { tradeDate: data, kind: tipo, grossCents, feesCents, quantityE8, note: nota.trim() === "" ? null : nota.trim() };
      if (transacao === null) await postTransaction(posicao.instrumentId, payload);
      else await patchTransaction(transacao.id, payload);
      onConcluir();
    } catch (cause) {
      setErro({ campo: "geral", mensagem: cause instanceof Error ? cause.message : String(cause) });
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
      onConcluir();
    } catch (cause) {
      setErro({ campo: "geral", mensagem: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setSalvando(false);
    }
  }

  const taxa = taxaTexto(posicao.rateE6, posicao.benchmark);
  const dica = tipo === "SELL"
    ? `O resgate não pode passar do saldo da posição${posicao.marketValueCents === null ? "" : ` (${formataBRL(posicao.marketValueCents)})`}.`
    : `Compra aplica o valor nesta data${ehRF ? "" : "; informe também a quantidade de cotas"}.`;

  return (
    <div className="painel-conteudo">
      <div className="gaveta-cabecalho gaveta-cabecalho-linha">
        <div>
          <h2 className="gaveta-titulo">{transacao === null ? "Nova transação" : "Editar transação"}</h2>
          <p className="gaveta-sub">{posicao.name}{taxa === null ? "" : ` · ${taxa}`}</p>
        </div>
        <button type="button" className="btn-voltar" onClick={onVoltar}>‹ Voltar</button>
      </div>

      <div className="campo" style={{ marginTop: 14 }}>
        <span className="stat-label">Tipo</span>
        <Segmented
          rotulo="Tipo da transação"
          valor={tipo}
          onMudar={setTipo}
          opcoes={[{ valor: "BUY", rotulo: "Compra" }, { valor: "SELL", rotulo: "Resgate" }]}
        />
      </div>

      <div className="form-grade">
        <label className="campo">
          <span className="stat-label">Data</span>
          <input type="date" value={data} onChange={(evento) => setData(evento.target.value)} />
          {erro?.campo === "data" && <span className="campo-erro" role="alert">{erro.mensagem}</span>}
        </label>
        <label className="campo">
          <span className="stat-label">Valor</span>
          <span className="campo-moeda">
            <span className="campo-prefixo">R$</span>
            <input inputMode="decimal" value={valor} onChange={(evento) => setValor(evento.target.value)} placeholder="1.234,56" />
          </span>
          {erro?.campo === "valor" && <span className="campo-erro" role="alert">{erro.mensagem}</span>}
        </label>
        <label className="campo">
          <span className="stat-label">Taxas <span className="campo-opcional">opcional</span></span>
          <input inputMode="decimal" value={taxas} onChange={(evento) => setTaxas(evento.target.value)} placeholder="0,00" />
          {erro?.campo === "taxas" && <span className="campo-erro" role="alert">{erro.mensagem}</span>}
        </label>
        {!ehRF && (
          <label className="campo">
            <span className="stat-label">Quantidade (cotas)</span>
            <input inputMode="decimal" value={quantidade} onChange={(evento) => setQuantidade(evento.target.value)} placeholder="10,5" />
            {erro?.campo === "quantidade" && <span className="campo-erro" role="alert">{erro.mensagem}</span>}
          </label>
        )}
        <label className="campo campo-largo">
          <span className="stat-label">Nota <span className="campo-opcional">opcional</span></span>
          <input value={nota} maxLength={200} onChange={(evento) => setNota(evento.target.value)} placeholder="ex.: aporte do mês" />
        </label>
      </div>

      <p className="form-dica">{dica}</p>
      {erro?.campo === "geral" && <p className="campo-erro" role="alert">{erro.mensagem}</p>}

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
        <button type="button" className="btn btn-secondary" onClick={onVoltar}>Cancelar</button>
        <button type="button" className="btn btn-primary" disabled={salvando} onClick={() => void salvar()}>
          {salvando ? "Salvando…" : "Salvar transação"}
        </button>
      </div>
    </div>
  );
}
