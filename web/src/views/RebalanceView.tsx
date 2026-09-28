import { useEffect, useState } from "react";
import { WarningCircle } from "@phosphor-icons/react";
import { getRebalance, saveRebalance, type Rebalance } from "../api.ts";
import { formataBRL, formataPercentual, parseMoedaParaCents, parsePercentualParaE6 } from "../format.ts";

const ROTULOS: Record<string, string> = { rf: "Renda Fixa", rv: "Renda Variável" };
const SOMA_METAS = 1_000_000;

function textoDeE6(e6: number): string {
  return (e6 / 10_000).toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

export function RebalanceView({ reloadToken }: { reloadToken: number }) {
  const [dados, setDados] = useState<Rebalance | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregado, setCarregado] = useState(false);
  const [rfTexto, setRfTexto] = useState("");
  const [rvTexto, setRvTexto] = useState("");
  const [aporteTexto, setAporteTexto] = useState("");
  const [erroEntrada, setErroEntrada] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [recado, setRecado] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setCarregado(false);
    getRebalance({}, controller.signal)
      .then((resultado) => {
        setDados(resultado);
        setRfTexto(textoDeE6(resultado.targets.rfE6));
        setRvTexto(textoDeE6(resultado.targets.rvE6));
        setAporteTexto(""); // transiente: sempre começa vazio
        setErro(null);
        setCarregado(true);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setErro(cause instanceof Error ? cause.message : String(cause));
      });
    return () => controller.abort();
  }, [reloadToken]);

  useEffect(() => {
    if (!carregado) return;
    const rfE6 = parsePercentualParaE6(rfTexto, true);
    const rvE6 = parsePercentualParaE6(rvTexto, true);
    const aporte = aporteTexto.trim() === "" ? 0 : parseMoedaParaCents(aporteTexto);
    if (rfE6 === null || rvE6 === null) return setErroEntrada("meta inválida (ex.: 80 ou 72,5)");
    if (rfE6 + rvE6 !== SOMA_METAS) return setErroEntrada("as metas precisam somar 100%");
    if (aporte === null) return setErroEntrada("valor a investir inválido");
    setErroEntrada(null);
    setRecado(null);
    const controller = new AbortController();
    const id = setTimeout(() => {
      getRebalance({ amountCents: aporte, rfE6, rvE6 }, controller.signal)
        .then((resultado) => { setDados(resultado); setErro(null); })
        .catch((cause: unknown) => {
          if (cause instanceof DOMException && cause.name === "AbortError") return;
          setErro(cause instanceof Error ? cause.message : String(cause));
        });
    }, 400);
    return () => { clearTimeout(id); controller.abort(); };
  }, [carregado, rfTexto, rvTexto, aporteTexto]);

  async function salvar() {
    const rfE6 = parsePercentualParaE6(rfTexto, true);
    const rvE6 = parsePercentualParaE6(rvTexto, true);
    if (rfE6 === null || rvE6 === null) return setErroEntrada("meta inválida (ex.: 80 ou 72,5)");
    if (rfE6 + rvE6 !== SOMA_METAS) return setErroEntrada("as metas precisam somar 100%");
    setSalvando(true);
    setRecado(null);
    try {
      await saveRebalance({ rfE6, rvE6 });
      setRecado("Metas salvas");
    } catch (cause) {
      setErroEntrada(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSalvando(false);
    }
  }

  const totalDepois = dados === null ? 0 : dados.portfolioTotalCents + dados.amountCents;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Rebalanceamento</h1>
          <p className="page-sub">Fora da reserva de emergência · sem vender posições</p>
        </div>
      </div>

      {erro !== null && (
        <div className="callout callout-error" role="alert">
          <WarningCircle size={17} aria-hidden="true" />
          <div><p className="callout-title">Não foi possível calcular</p><p>{erro}</p></div>
        </div>
      )}

      <div className="reb-topo">
        <section className="card">
          <h2 className="reb-secao-titulo">Metas</h2>
          <div className="reb-metas-linha">
            <label className="campo">
              <span className="stat-label">Renda Fixa</span>
              <span className="campo-sufixo">
                <input inputMode="decimal" value={rfTexto} onChange={(evento) => setRfTexto(evento.target.value)} placeholder="80" />
                <span className="campo-sufixo-texto">%</span>
              </span>
            </label>
            <label className="campo">
              <span className="stat-label">Renda Variável</span>
              <span className="campo-sufixo">
                <input inputMode="decimal" value={rvTexto} onChange={(evento) => setRvTexto(evento.target.value)} placeholder="20" />
                <span className="campo-sufixo-texto">%</span>
              </span>
            </label>
            <button type="button" className="btn btn-secondary" disabled={salvando} onClick={() => void salvar()}>
              {salvando ? "Salvando…" : "Salvar metas"}
            </button>
          </div>
          {erroEntrada !== null && <p className="campo-erro" role="alert">{erroEntrada}</p>}
          {recado !== null && <span className="reb-nota" role="status">{recado}</span>}
        </section>

        <section className="card">
          <span className="stat-label">Quanto vou investir</span>
          <div className="reb-base">
            <span className="campo-moeda">
              <span className="campo-prefixo">R$</span>
              <input inputMode="decimal" value={aporteTexto} onChange={(evento) => setAporteTexto(evento.target.value)} placeholder="6.500,00" />
            </span>
            <div className="reb-resumo-total">
              <span className="stat-label">Patrimônio total depois</span>
              <strong>{formataBRL(totalDepois)}</strong>
            </div>
          </div>
        </section>
      </div>

      {dados !== null && (
        <div className="reb-grade">
          {dados.groups.map((grupo) => (
            <section className="card reb-card" key={grupo.key}>
              <div className="reb-card-topo">
                <h2 className="reb-titulo">{ROTULOS[grupo.key] ?? grupo.key}</h2>
                <span className={grupo.aboveTarget ? "badge badge-warn" : "badge badge-neutro"}>
                  {grupo.aboveTarget ? "acima da meta — sem aporte novo" : `meta ${formataPercentual(grupo.targetE6 / 10_000)}`}
                </span>
              </div>
              <div className="reb-hero">
                <span className="stat-label">Investir</span>
                <strong>{formataBRL(grupo.suggestedCents)}</strong>
              </div>
              <span className="reb-caminho">
                <span className="reb-caminho-rotulo">Valor</span>
                {formataBRL(grupo.valueCents)} <span className="reb-seta">→</span> {formataBRL(grupo.afterValueCents)}
              </span>
              <span className="reb-caminho">
                <span className="reb-caminho-rotulo">Participação</span>
                {formataPercentual(grupo.pctBefore)} <span className="reb-seta">→</span> {formataPercentual(grupo.pctAfter)}
              </span>
            </section>
          ))}
        </div>
      )}

      {dados !== null && (
        <p className="reb-nota reb-rodape">
          Base do cálculo: {formataBRL(dados.baseCents)} fora da reserva ({formataBRL(dados.portfolioTotalCents - dados.baseCents)} na reserva de emergência).
          {dados.stale && " Há cotações desatualizadas — usando o último valor conhecido."}
        </p>
      )}
    </div>
  );
}
